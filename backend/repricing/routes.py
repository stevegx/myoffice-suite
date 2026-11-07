import csv
from collections import Counter, defaultdict
from io import BytesIO, StringIO
from zipfile import ZipFile

import xlwt
from fastapi import APIRouter, Request, Response
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Font, PatternFill

from ..payments.routes import decode_file, process
from ..payments.workbooks import MAX_EXPANDED_BYTES, MAX_ROWS, normalized, read_cents
from ..products.history import effective_date, record_import

router = APIRouter(prefix="/api/repricing", tags=["Repricing"])
MARKET_COLUMNS = ("Product", "SKU", "Our price", "Cheapest", "Shop", "Rank", "Competitors")
BUCKETS = ("0,01–0,10 €", "0,11–0,50 €", "0,51–1,00 €", "Πάνω από 1,00 €")


def text(value) -> str:
    return str(value).strip() if value is not None else ""


def price(value) -> str:
    cents = read_cents(value)
    return decimal_price(cents) if cents is not None else text(value)


def decimal_price(cents: int) -> str:
    return f"{cents // 100},{cents % 100:02d}" if cents >= 0 else f"-{decimal_price(-cents)}"


def read_market(raw: bytes) -> list[dict]:
    try:
        content = raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        content = raw.decode("cp1253")
    first_line = content.partition("\n")[0]
    delimiter = ";" if ";" in first_line else ","
    reader = csv.DictReader(StringIO(content), delimiter=delimiter, strict=True)
    if not reader.fieldnames or not set(MARKET_COLUMNS).issubset(reader.fieldnames):
        raise ValueError("Το CSV χρειάζεται τις στήλες " + ", ".join(MARKET_COLUMNS) + ".")
    rows = []
    for row in reader:
        if len(rows) >= MAX_ROWS:
            raise ValueError("Το CSV υπερβαίνει το όριο γραμμών.")
        if None in row or any(row[key] is None for key in MARKET_COLUMNS):
            raise ValueError(f"Μη έγκυρη γραμμή CSV κοντά στη γραμμή {reader.line_num}.")
        rows.append({
            "id": len(rows) + 1, "product": text(row["Product"]), "sku": text(row["SKU"]),
            "our": price(row["Our price"]), "cheapest": price(row["Cheapest"]), "shop": text(row["Shop"]),
            "rank": text(row["Rank"]), "competitors": text(row["Competitors"]),
        })
    if not rows:
        raise ValueError("Το CSV δεν περιέχει προϊόντα.")
    return rows


def read_minimums(raw: bytes) -> dict[str, list[dict]]:
    with ZipFile(BytesIO(raw)) as archive:
        if sum(entry.file_size for entry in archive.infolist()) > MAX_EXPANDED_BYTES:
            raise ValueError("Το αρχείο ελαχίστων υπερβαίνει το όριο μεγέθους.")
    workbook = load_workbook(BytesIO(raw), read_only=True, data_only=True, keep_links=False)
    try:
        rows = workbook.worksheets[0].iter_rows(max_col=100, values_only=True)
        for _, header in zip(range(10), rows):
            indices = {normalized(value): i for i, value in enumerate(header)}
            skroutz = next((indices[key] for key in (normalized("Skoutz(Com+Tax)"), normalized("Skroutz(Com+Tax)")) if key in indices), None)
            sku, name, site = (indices.get(normalized(key)) for key in ("sku_Gr", "Περιγραφή", "Ελαχ.Site"))
            if None not in (sku, name, site, skroutz):
                break
        else:
            raise ValueError("Δεν βρέθηκαν οι στήλες sku_Gr, Περιγραφή, Skroutz(Com+Tax) και Ελαχ.Site.")
        result = defaultdict(list)
        for index, row in enumerate(rows):
            if index >= MAX_ROWS:
                raise ValueError("Το αρχείο ελαχίστων υπερβαίνει το όριο γραμμών.")
            if key := text(row[sku]):
                result[key].append({"name": text(row[name]), "minSkr": price(row[skroutz]), "minSite": price(row[site])})
        if not result:
            raise ValueError("Το αρχείο ελαχίστων δεν περιέχει SKU.")
        return dict(result)
    finally:
        workbook.close()


def import_files(data: dict, path=None) -> dict:
    raw = decode_file(data, "market")
    try:
        market = read_market(raw)
    except csv.Error as error:
        raise ValueError("Το αρχείο repricing περιέχει μη έγκυρη μορφοποίηση CSV.") from error
    minimums = read_minimums(decode_file(data, "minimums"))
    history = {"enabled": path is not None, "saved": 0, "skipped": 0}
    if path is not None and data.get("observedOn") is not None:
        history = record_import(path, effective_date(data["observedOn"]), raw, market)
    return {"rows": market, "minimums": minimums, "history": history}


def export_rows(data: dict, channel: str) -> list[list]:
    rows = data.get("rows")
    if not isinstance(rows, list) or not 0 < len(rows) <= MAX_ROWS:
        raise ValueError("Δεν υπάρχουν εγκεκριμένες αλλαγές για εξαγωγή.")
    seen = set()
    result = []
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("Μη έγκυρη γραμμή εξαγωγής.")
        sku, product = row.get("sku"), row.get("product")
        if not all(isinstance(value, str) and value.strip() and len(value) <= 1024 for value in (sku, product)):
            raise ValueError("Κάθε αλλαγή χρειάζεται έγκυρο SKU και όνομα.")
        sku = sku.strip()
        if sku in seen:
            raise ValueError(f"Διπλό SKU στο export ({sku}).")
        seen.add(sku)
        fields = ("site", "skr") if channel == "site" else ("skr",)
        cents = [row.get(key) for key in fields]
        if not all(type(value) is int and 0 < value <= 999_999_999 for value in cents):
            raise ValueError("Οι τιμές εξαγωγής πρέπει να είναι θετικές.")
        if channel == "site" and cents[0] >= cents[1]:
            raise ValueError("Η τιμή site πρέπει να είναι χαμηλότερη από την τιμή Skroutz.")
        result.append([sku, product, *(decimal_price(value) for value in cents)])
    return result


def export_skroutz(data: dict) -> bytes:
    rows = export_rows(data, "skroutz")
    book = xlwt.Workbook()
    sheet = book.add_sheet("Skroutz")
    for i, row in enumerate([["SKU", "Όνομα", "Νέα τιμή"], *rows]):
        for j, value in enumerate(row):
            sheet.write(i, j, value)
    stream = BytesIO()
    book.save(stream)
    return stream.getvalue()


def export_site(data: dict) -> bytes:
    rows = export_rows(data, "site")
    output = StringIO(newline="")
    writer = csv.writer(output, delimiter=";")
    writer.writerow(("Κωδικός προϊόντος", "Όνομα", "Κανονική τιμή", "Meta: dicha_skroutz_feed_price"))
    writer.writerows(rows)
    return output.getvalue().encode("utf-8-sig")


def export_summary(data: dict) -> bytes:
    deltas, total = data.get("deltas"), data.get("total")
    if (not isinstance(deltas, list) or type(total) is not int or not len(deltas) <= total <= MAX_ROWS
            or not all(type(value) is int and value != 0 for value in deltas)):
        raise ValueError("Μη έγκυρα δεδομένα σύνοψης.")
    counts = Counter((0 if abs(value) <= 10 else 1 if abs(value) <= 50 else 2 if abs(value) <= 100 else 3, value > 0) for value in deltas)
    book = Workbook()
    sheet = book.active
    sheet.title = "Σύνοψη"
    sheet.append(["Σύνοψη repricing Skroutz"])
    sheet.append([])
    sheet.append(["Εύρος μεταβολής €", "Αυξήσεις", "Μειώσεις"])
    for index, label in enumerate(BUCKETS):
        sheet.append([label, counts[index, True], counts[index, False]])
    sheet.append(["Σύνολο αλλαγών", sum(value > 0 for value in deltas), sum(value < 0 for value in deltas)])
    sheet.append([])
    sheet.append(["Χωρίς αλλαγή προς εξαγωγή", total - len(deltas)])
    sheet.append(["Συνολικές αλλαγές", len(deltas)])
    sheet.append(["Συνολικά προϊόντα", total])
    sheet.append(["Διαφορά = τελική τιμή Skroutz − αρχική Our price"])
    for cell in sheet[3]:
        cell.font = Font(bold=True, color="FFFFFF")
        cell.fill = PatternFill("solid", fgColor="20364D")
    for cell in sheet[8]:
        cell.font = Font(bold=True)
        cell.fill = PatternFill("solid", fgColor="E5EDF5")
    for index in range(4, 8):
        sheet[f"B{index}"].fill = PatternFill("solid", fgColor="E7EFFA")
        sheet[f"C{index}"].fill = PatternFill("solid", fgColor="FAEEE7")
    for column, width in (("A", 53), ("B", 16), ("C", 16)):
        sheet.column_dimensions[column].width = width
    stream = BytesIO()
    book.save(stream)
    return stream.getvalue()


@router.post("/import")
async def upload(request: Request):
    path = request.app.state.db_path if request.app.state.product_history_enabled else None
    return await process(request, lambda data: import_files(data, path))


@router.post("/export/{kind}")
async def export(kind: str, request: Request):
    outputs = {
        "skroutz": (export_skroutz, "repricing-skroutz.xls", "application/vnd.ms-excel"),
        "site": (export_site, "repricing-site.csv", "text/csv"),
        "summary": (export_summary, "repricing-summary.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
    }
    if kind not in outputs:
        return Response(status_code=404)
    action, filename, media_type = outputs[kind]
    return Response(await process(request, action, allow_form=True), media_type=media_type,
                    headers={"Content-Disposition": f'attachment; filename="{filename}"', "Cache-Control": "no-store"})
