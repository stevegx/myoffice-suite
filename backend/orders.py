from contextlib import closing
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from io import BytesIO

from fastapi import APIRouter, HTTPException, Request, Response
from openpyxl import Workbook
from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from openpyxl.worksheet.page import PageMargins

from .converter import XLSX_TYPE, open_excel
from .database import connect_readonly
from .order_catalog_store import merge_products, read_products, update_costs
from .payments.routes import decode_file, process
from .payments.workbooks import MAX_ROWS, normalized, read_code
from .products.overview import optimizer_prices, replace_optimizer_prices
from .supplier_catalog_store import current_offers

router = APIRouter(prefix="/api/orders", tags=["Orders"])
SUPPLIERS = {
    "Cosmodrink": "cosmodrink price", "Diageo": "diageo price", "Pernod": "pernod price",
    "Αθηναϊκή": "athinaiki price", "Amardis": "amardis price", "PGM": "pgm price",
    "Spirit Hall": "spirit hall price", "Jannec": "jannec price",
}
SKU = ("sku_Gr", "Κωδικός", "Κωδικός προϊόντος", "SKU", "Unique ID")
SOURCE_FIELDS = {
    "stock": {"stock": ("ΤΜΧ", "Stock", "Απόθεμα")},
    "salesRecent": {"salesRecent": ("Ποσότητα", "Πωλήσεις")},
    "salesOther": {"salesOther": ("Ποσότητα", "Πωλήσεις")},
    "costs": {"minBuy": ("MinBuyPrice",), "lastBuy": ("ΤΤΑ", "TTA")},
    "skroutz": {"skroutz": ("Price Optimizer price",)},
}
SOURCE_SHEETS = {"stock": "stock", "salesRecent": "sales", "salesOther": "Sheet5", "costs": "Sheet1", "skroutz": "skroutz"}


def number(value) -> Decimal | None:
    if value is None or isinstance(value, bool):
        return None
    text = str(value).strip().replace("€", "").replace(" ", "").replace("\xa0", "")
    if "," in text:
        text = text.replace(".", "").replace(",", ".")
    try:
        parsed = Decimal(text)
        return parsed if parsed.is_finite() and abs(parsed) <= 9_999_999 else None
    except InvalidOperation:
        return None


def price(value) -> int | None:
    amount = number(value)
    units = int((amount * 10_000).quantize(Decimal("1"), rounding=ROUND_HALF_UP)) if amount is not None else 0
    return units if units > 0 else None


def column(headers: dict, aliases: tuple[str, ...]):
    return next((headers[normalized(alias)] for alias in aliases if normalized(alias) in headers), None)


def records(sheet, fields: dict, required: tuple[str, ...], any_of: tuple[str, ...] = ()):
    def valid(indices):
        return all(indices[key] is not None for key in required) and (not any_of or any(indices[key] is not None for key in any_of))

    rows = sheet.iter_rows(max_col=100, values_only=True)
    for _ in range(10):
        row = next(rows, None)
        if row is None:
            break
        headers = {normalized(value): i for i, value in enumerate(row) if value is not None}
        indices = {key: column(headers, aliases) for key, aliases in fields.items()}
        if valid(indices):
            break
    else:
        return None
    if row is None or not valid(indices):
        return None

    def values():
        for index, row in enumerate(rows, start=1):
            if index > MAX_ROWS:
                raise ValueError("Το φύλλο υπερβαίνει τις 20.000 γραμμές.")
            yield {key: row[i] if i is not None else None for key, i in indices.items()}
    return values()


def parse_products(raw: bytes):
    fields = {"sku": SKU, "name": ("Περιγραφή", "Όνομα", "Προϊόν", "Description", "Name"),
              "minBuy": ("MinBuyPrice",), "lastBuy": ("ΤΤΑ", "TTA"),
              "minimumSkroutz": ("Skoutz(Com+Tax)", "Skroutz(Com+Tax)")}
    offer_fields = {key: (header,) for key, header in SUPPLIERS.items()}
    products = {}
    with open_excel(raw, ".xlsx") as (book, names):
        offers = records(book["Sheet2"], {**fields, **offer_fields, "marked": ("paraggelia", "Παραγγελία")},
                         ("sku", "name", *SUPPLIERS)) if "Sheet2" in names else None
        includes_offers = offers is not None
        availability = {}
        if includes_offers and "amardis" in names:
            amardis = records(book["amardis"], {"sku": ("sku_Gr", "ERP SKU", "SKU"), "available": ("Διαθεσιμότητα",)}, ("sku", "available"))
            # The source contains two SKU headers. The last one holds the ERP SKU.
            for row in amardis or ():
                sku = read_code(row["sku"])
                if sku and row["available"] is not None:
                    availability.setdefault(sku, str(row["available"]).strip())
        duplicates = set()
        for row in offers or ():
            sku, name = read_code(row["sku"]), read_code(row["name"])
            if not sku or sku in ("---", "#N/A") or not name:
                continue
            if sku in products:
                duplicates.add(sku)
                continue
            products[sku] = {
                "sku": sku, "name": name, "minBuy": price(row["minBuy"]), "lastBuy": price(row["lastBuy"]),
                "minimumSkroutz": price(row["minimumSkroutz"]),
                "offers": {key: value for key in SUPPLIERS if (value := price(row[key])) is not None},
                "availability": availability.get(sku, ""),
                "marked": read_code(row["marked"]).upper() in ("Y", "Υ"),
                "duplicate": False,
            }
        product_rows = None
        master_sheets = [name for name in names if name == "Sheet1"] if includes_offers else sorted(names, key=lambda name: name != "Sheet1")
        for name in master_sheets:
            product_rows = records(book[name], fields, ("sku", "name"))
            if product_rows is not None:
                break
        for row in product_rows or ():
            sku, name = read_code(row["sku"]), read_code(row["name"])
            if not sku or sku in ("---", "#N/A") or not name:
                continue
            record = {"sku": sku, "name": name, "minBuy": price(row["minBuy"]), "lastBuy": price(row["lastBuy"]),
                      "minimumSkroutz": price(row["minimumSkroutz"]),
                      "offers": {}, "availability": "", "marked": False, "duplicate": False}
            if not includes_offers and sku in products and record != products[sku]:
                raise ValueError(f"Το SKU {sku} έχει διαφορετικά στοιχεία στο ίδιο αρχείο ERP.")
            if sku in products and includes_offers:
                for key in ("minBuy", "lastBuy", "minimumSkroutz"):
                    if products[sku][key] is None:
                        products[sku][key] = record[key]
            else:
                products.setdefault(sku, record)
    if not products:
        raise ValueError("Δεν βρέθηκαν προϊόντα στον κατάλογο.")
    for sku in duplicates:
        products[sku]["offers"] = {}
        products[sku]["duplicate"] = True
    return list(products.values()), includes_offers


def catalog_data(products, db_path=None) -> dict:
    if db_path is not None and products:
        for supplier, latest in current_offers(db_path).items():
            for product in products:
                product["offers"].pop(supplier, None)
                offer = latest.get(product["sku"])
                if offer is not None and offer["price"] is not None:
                    product["offers"][supplier] = offer["price"]
                if supplier == "Amardis":
                    product["availability"] = offer["availability"] if offer is not None else ""
    return {"products": products, "suppliers": list(SUPPLIERS), "duplicates": sum(bool(p.get("duplicate")) for p in products),
            "market": market_prices(db_path) if db_path is not None and products else {},
            "optimizer": optimizer_prices(db_path) if db_path is not None and products else {}, "persistent": db_path is not None}


def catalog(raw: bytes, db_path=None) -> dict:
    products, _ = parse_products(raw)
    return catalog_data(products, db_path)


def save_catalog(raw: bytes, path) -> dict:
    products, includes_offers = parse_products(raw)
    if path is not None:
        merge_products(path, products, includes_offers)
        products = read_products(path)
    return catalog_data(products, path)


def market_prices(path) -> dict:
    with closing(connect_readonly(path)) as db:
        return {row["Sku"]: {"price": row["Cents"], "shop": row["Shop"], "day": row["ObservedOn"]}
                for row in db.execute("""
                    SELECT m.Sku, m.Cents, m.Shop, m.ObservedOn
                    FROM RepricingMarket m
                    WHERE m.Id = (SELECT Id FROM RepricingMarket
                                  WHERE Sku = m.Sku ORDER BY ObservedOn DESC, Id DESC LIMIT 1)
                """)}


def source(raw: bytes, kind: str) -> dict:
    if kind not in SOURCE_FIELDS:
        raise ValueError("Μη έγκυρος τύπος αρχείου ERP.")
    fields = SOURCE_FIELDS[kind]
    with open_excel(raw, ".xlsx") as (book, names):
        preferred = SOURCE_SHEETS[kind]
        for name in sorted(names, key=lambda name: name.casefold() != preferred.casefold()):
            rows = records(book[name], {"sku": SKU, **fields},
                           ("sku",) if kind == "costs" else ("sku", *fields),
                           tuple(fields) if kind == "costs" else ())
            if rows is not None:
                break
        else:
            raise ValueError("Δεν βρέθηκαν οι αναμενόμενες στήλες κωδικού και τιμής ή ποσότητας.")
        results = {}
        conflicts = set()
        for row in rows:
            sku = read_code(row["sku"])
            if not sku or sku in ("---", "#N/A"):
                continue
            values = {}
            for key in fields:
                value = number(row[key]) if kind in ("stock", "salesRecent", "salesOther") else price(row[key])
                values[key] = float(value) if isinstance(value, Decimal) else value
            if sku in results and results[sku] != values:
                conflicts.add(sku)
            results[sku] = values
        for sku in conflicts:
            results[sku] = dict.fromkeys(fields)
        if not results:
            raise ValueError("Το αρχείο δεν περιέχει κωδικούς προϊόντων.")
        return {"values": results, "conflicts": len(conflicts)}


HEADERS = (
    ("sku", "SKU", 15), ("name", "Περιγραφή", 37), ("lastBuy", "ΤΤΑ", 11),
    ("minBuy", "MinBuyPrice", 13), ("amardis", "Τιμή Amardis", 14), ("availability", "Διαθεσιμότητα Amardis", 17),
    ("purchase", "Αγορά", 11), ("supplier", "Προμηθευτής", 16), ("quantity", "Φιάλες", 9), ("vat", "ΦΠΑ", 8),
    ("ownMin", "Ελάχ. δική μας", 14), ("skroutz", "Ελάχ. Skroutz", 14), ("competitor", "Φθηνότερος Skroutz", 16),
    ("stock", "Stock", 9), ("salesRecent", "Πωλήσεις τριμήνου", 14), ("salesOther", "Πωλήσεις 2ης περιόδου", 14),
    ("skrCheck", "Έλεγχος Skroutz", 14), ("buyCheck", "Γρηγορίου", 13), ("notes", "Σημειώσεις", 24),
)
TEXT_KEYS = {"sku", "name", "availability", "supplier", "skrCheck", "buyCheck", "notes"}
PRICE_KEYS = {"lastBuy", "minBuy", "amardis", "purchase", "ownMin", "skroutz", "competitor"}


def export(data: dict) -> bytes:
    rows = data.get("rows")
    if not isinstance(rows, list) or not 1 <= len(rows) <= MAX_ROWS:
        raise ValueError("Πρόσθεσε προϊόντα πριν την εξαγωγή.")
    for row in rows:
        if not isinstance(row, dict) or not all(isinstance(row.get(key), str) and row[key].strip() for key in ("sku", "name")):
            raise ValueError("Η παραγγελία περιέχει μη έγκυρη γραμμή.")
        for key, _, _ in HEADERS:
            value = row.get(key)
            if value is None:
                continue
            if key in TEXT_KEYS:
                valid = isinstance(value, str) and len(value) <= 1024
            else:
                valid = type(value) in (int, float) and abs(value) <= 1_000_000_000_000
            if not valid:
                raise ValueError("Η παραγγελία περιέχει μη έγκυρη τιμή.")
    periods = data.get("periods", ["", ""])
    if not isinstance(periods, list) or len(periods) != 2 or not all(isinstance(value, str) and len(value) <= 40 for value in periods):
        raise ValueError("Μη έγκυρες περίοδοι πωλήσεων.")
    sales_labels = dict(zip(("salesRecent", "salesOther"), periods))
    book = Workbook()
    sheet = book.active
    sheet.title = "Παραγγελία"
    sheet.append(["Παραγγελία ανά προμηθευτή"])
    sheet.merge_cells(start_row=1, start_column=1, end_row=1, end_column=len(HEADERS))
    sheet["A1"].font = Font(size=16, bold=True, color="20364D")
    sheet.append([f"{header}\n{sales_labels[key]}" if sales_labels.get(key) else header for key, header, _ in HEADERS])
    navy = PatternFill("solid", fgColor="20364D")
    for index, (cell, (_, _, width)) in enumerate(zip(sheet[2], HEADERS), start=1):
        cell.font = Font(color="FFFFFF", bold=True)
        cell.fill = navy
        cell.alignment = Alignment(wrap_text=True, vertical="center")
        sheet.column_dimensions[get_column_letter(index)].width = width
    sheet.row_dimensions[2].height = 40 if any(periods) else 31
    grouped = sorted(rows, key=lambda row: ((row.get("supplier") or "").casefold() or "\uffff", row["name"].casefold()))
    group_border = Border(top=Side(style="medium", color="9EB5CA"))
    previous_supplier = None
    for index, row in enumerate(grouped, start=3):
        supplier = (row.get("supplier") or "").casefold()
        for col, (key, _, _) in enumerate(HEADERS, start=1):
            value = row.get(key)
            cell = sheet.cell(index, col)
            if supplier != previous_supplier:
                cell.border = group_border
            if value is None:
                continue
            if isinstance(value, str):
                cell.value = ILLEGAL_CHARACTERS_RE.sub("", value)
                cell.data_type = "s"
                cell.alignment = Alignment(wrap_text=True, vertical="top")
            else:
                cell.value = value
                if key in PRICE_KEYS:
                    cell.number_format = "0.00##"
                elif key == "vat":
                    cell.number_format = "0.##%"
        previous_supplier = supplier
    sheet.freeze_panes = "C3"
    sheet.auto_filter.ref = f"A2:{get_column_letter(len(HEADERS))}{sheet.max_row}"
    sheet.print_title_rows = "1:2"
    sheet.print_area = f"A1:{get_column_letter(len(HEADERS))}{sheet.max_row}"
    sheet.page_setup.orientation = "landscape"
    sheet.page_setup.paperSize = sheet.PAPERSIZE_A4
    sheet.sheet_properties.pageSetUpPr.fitToPage = True
    sheet.page_setup.fitToWidth = 1
    sheet.page_setup.fitToHeight = 0
    sheet.page_margins = PageMargins(left=0.2, right=0.2, top=0.3, bottom=0.3, header=0.1, footer=0.1)
    result = BytesIO()
    book.save(result)
    return result.getvalue()


@router.get("/catalog")
def saved_catalog(request: Request):
    path = request.app.state.db_path if request.app.state.product_history_enabled else None
    return catalog_data(read_products(path) if path is not None else [], path)


@router.post("/catalog")
async def import_catalog(request: Request):
    path = request.app.state.db_path if request.app.state.product_history_enabled else None
    return await process(request, lambda data: save_catalog(decode_file(data, "file"), path))


@router.post("/master-costs")
async def import_master_costs(request: Request):
    if not request.app.state.product_history_enabled:
        raise HTTPException(403, "Η μόνιμη ενημέρωση ERP είναι απενεργοποιημένη σε αυτή την εγκατάσταση.")
    path = request.app.state.db_path

    def save(data):
        result = source(decode_file(data, "file"), "costs")
        changes = update_costs(path, result["values"])
        return {"catalog": catalog_data(read_products(path), path), **changes, "conflicts": result["conflicts"]}

    return await process(request, save)


@router.post("/sources/{kind}")
async def import_source(kind: str, request: Request):
    def load(data):
        result = source(decode_file(data, "file"), kind)
        if kind == "skroutz" and request.app.state.product_history_enabled:
            replace_optimizer_prices(request.app.state.db_path, result["values"])
        return result

    return await process(request, load)


@router.post("/export")
async def export_order(request: Request):
    return Response(await process(request, export), media_type=XLSX_TYPE, headers={
        "Content-Disposition": 'attachment; filename="purchase-order.xlsx"', "Cache-Control": "no-store",
    })
