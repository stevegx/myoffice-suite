import re
from collections import Counter, defaultdict
from io import BytesIO
from pathlib import PureWindowsPath
from zipfile import ZipFile
from xml.etree import ElementTree as ET

from fastapi import APIRouter, HTTPException, Request, Response
from openpyxl import load_workbook

from .converter import XLSX_TYPE, open_excel
from .orders import number, price, records
from .payments.routes import decode_file, process
from .payments.workbooks import normalized, read_code
from .products.history import effective_date
from .supplier_catalog_store import all_mappings, approve_catalog, previous_catalog, save_offer_mappings, seed_mappings, summaries
from .supplier_merge_export import update_merge

router = APIRouter(prefix="/api/supplier-catalogs", tags=["Supplier catalogs"])
SUPPLIERS = ("Cosmodrink", "Diageo", "Spirit Hall", "Pernod", "Amardis")
SIZE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(ml|cl|lit|lt|l)\b", re.I)
MAPPING_TAB = "Offer SKU Mappings"
MAPPING_HEADERS = ("Προμηθευτής", "Κωδικός προμηθευτή", "SKU ERP")


def legacy_spirit_key(code):
    return f"legacy-num:{int(code)}" if code.isascii() and code.isdigit() else None


def volume(value, fallback=""):
    for candidate in (value, fallback):
        matches = SIZE.findall(str(candidate or ""))
        if matches:
            amount, unit = matches[-1]
            return round(float(amount.replace(",", ".")) * {"ml": 1, "cl": 10}.get(unit.lower(), 1000))
        if amount := number(candidate):
            if 0 < amount <= 50000:
                return round(amount * (1000 if amount < 5 else 1))
    return None


def sheet_rows(book, sheet_name, fields, required):
    sheet = next((sheet for sheet in book.worksheets if sheet.title.strip().casefold() == sheet_name.casefold()), None)
    rows = records(sheet, fields, required) if sheet is not None else None
    if rows is None:
        raise ValueError(f"Δεν βρέθηκαν οι αναμενόμενες στήλες στο φύλλο «{sheet_name}».")
    return rows


def simple_rows(book, supplier):
    if supplier == "Cosmodrink":
        fields = {"code": ("ΚΩΔΙΚΟΣ ΤΙΜΟΛΟΓΗΣΗΣ",), "name": ("ΠΕΡΙΓΡΑΦΗ",), "size": ("ΣΥΣΚΕΥΑΣΙΑ",), "price": ("ΤΙΜΗ",)}
        candidates = sorted(book.worksheets, key=lambda sheet: normalized(sheet.title) != normalized("ΠΡΟΣΦΟΡΑ"))
        for sheet in candidates:
            rows = records(sheet, fields, ("code", "name", "price"))
            if rows is not None:
                tab = sheet.title
                break
        else:
            raise ValueError("Δεν βρέθηκαν οι στήλες ΚΩΔΙΚΟΣ ΤΙΜΟΛΟΓΗΣΗΣ, ΠΕΡΙΓΡΑΦΗ και ΤΙΜΗ στον κατάλογο Cosmodrink.")
    elif supplier == "Spirit Hall":
        tab = "Φύλλο1"
        fields = {"code": ("SKU",), "name": ("Περιγραφή",), "size": ("Size (ml)",),
                  "price": ("Τιμή (€)/ τεμάχιο",), "case": ("Τιμή για αγορά κιβωτίου",)}
    else:
        tab = book.worksheets[0].title
        fields = {"code": ("SKU",), "name": ("Product Title",), "price": ("Price (Wholesale_customer_tier1)",),
                  "availability": ("Διαθεσιμότητα",)}
    if supplier != "Cosmodrink":
        rows = sheet_rows(book, tab, fields, tuple(key for key in fields if key != "case"))
    for row in rows:
        code, name = read_code(row["code"]), read_code(row["name"])
        if not code or not name:
            continue
        base, case = price(row["price"]), price(row.get("case"))
        use_case = case is not None and (base is None or case < base)
        yield {"key": code.casefold(), "code": code, "name": name, "volume": volume(row.get("size"), name),
               "price": case if use_case else base, "availability": read_code(row.get("availability")),
               "source": f"{tab} · κιβώτιο" if use_case else tab}


def complex_rows(book, supplier):
    if supplier == "Diageo":
        sheets = (("STD1", "ΤΕΛΙΚΗ ΤΙΜΗ ΜΕ ΕΦΚΟΠ ΧΩΡΙΣ ΦΠΑ"),
                  ("RSV2", "TOTAL ΕΚΠΤΩΣΗ ΕΠ ΜΕΤΑ ΤΗΝ ΕΠΙ ΤΙΜΟΛΟΓΙΟΥ ΕΚΠΤΩΣΗ"))
        fields = {"name": ("ΠΕΡΙΓΡΑΦΗ",), "size": ("ΠΕΡΙΕΧ.",), "pack": ("ΣΥΣΚ/ΣΙΑ", "ΣΥΣΚ/ΣΙΑ/ΚΙΒ.")}
    else:
        sheets = (("PREMIUM", "ΤΙΜΗ ΜΕ ΕΦΚΟΠ ΜΕ ΜΕΤΡΗΤΟΙΣ (3,5%) + ΤΖΙΡΟΥ (6%+2%+2%)"),
                  ("ULTRA PREMIUM", "ΤΙΜΗ ΜΕ ΕΦΚΟΠ + ΜΕΤΡΗΤΟΙΣ + ΤΖΙΡΟΥ"))
        fields = {"code": ("ΠΡΟΪΟΝΤΟΣ",), "barcode": ("BARCODE",), "name": ("ΠΕΡΙΓΡΑΦΗ",), "size": ("ΠΕΡ.",)}
    for tab, header in sheets:
        for row in sheet_rows(book, tab, {**fields, "price": (header,)}, ("name", "size", "price")):
            name = read_code(row["name"])
            size = volume(row["size"], name)
            if not name or size is None:
                continue
            code, barcode = read_code(row.get("code")), read_code(row.get("barcode"))
            pack = read_code(row.get("pack"))
            identity = f"{normalized(name)}|{size}|{pack}"
            key = f"code:{code.casefold()}" if code else f"{tab.casefold()}:{barcode}|{identity}"
            yield {"key": key, "code": code or barcode, "name": name, "volume": size,
                   "price": price(row["price"]), "availability": "", "source": f"{tab} · κιβ. {pack}" if pack else tab}


def parse_catalog(raw, supplier):
    if supplier not in SUPPLIERS:
        raise ValueError("Επίλεξε υποστηριζόμενο προμηθευτή.")
    unique = {}
    with open_excel(raw, ".xlsx") as (book, _):
        rows = complex_rows(book, supplier) if supplier in ("Pernod", "Diageo") else simple_rows(book, supplier)
        for row in rows:
            key = row["key"]
            if key in unique and unique[key] != row:
                raise ValueError(f"Διπλή διαφορετική εγγραφή για «{row['code'] or row['name']}». Έλεγξε τον κατάλογο.")
            unique[key] = row
    if not any(row["price"] is not None for row in unique.values()):
        raise ValueError("Δεν βρέθηκαν έγκυρες τιμές στον κατάλογο. Έλεγξε το αρχείο και τις στήλες τιμής.")
    return list(unique.values())


def import_mappings(raw, path):
    specs = (("AMARDISDB", "Amardis", 0, 6), ("COSMODRINKDB", "Cosmodrink", 0, 4), ("SPIRITHALLDB", "Spirit Hall", 5, 0))
    candidates = defaultdict(set)
    confirmed = defaultdict(dict)
    with open_excel(raw, ".xlsx") as (book, names):
        if MAPPING_TAB in names:
            for supplier, code, sku in book[MAPPING_TAB].iter_rows(min_row=2, max_col=3, values_only=True):
                supplier, code, sku = map(read_code, (supplier, code, sku))
                if supplier and code and sku and sku not in ("---", "#N/A"):
                    confirmed[supplier][code.casefold()] = sku
        for name, supplier, ext, erp in specs:
            if name not in names:
                continue
            for row in book[name].iter_rows(min_row=2, max_col=max(ext, erp) + 1, values_only=True):
                code, sku = read_code(row[ext]), read_code(row[erp])
                if code and sku and sku not in ("---", "#N/A"):
                    key = legacy_spirit_key(code) if supplier == "Spirit Hall" and type(row[ext]) in (int, float) else None
                    candidates[supplier, key or code.casefold()].add(sku)
    if not candidates and not confirmed:
        raise ValueError("Δεν βρέθηκαν αντιστοιχίσεις στα φύλλα AMARDISDB, COSMODRINKDB ή SPIRITHALLDB.")
    safe = [(supplier, key, next(iter(skus))) for (supplier, key), skus in candidates.items() if len(skus) == 1]
    saved = seed_mappings(path, safe)
    for supplier, changes in confirmed.items():
        saved += save_offer_mappings(path, supplier, changes)
    return {"saved": saved, "conflicts": len(candidates) - len(safe)}


def offer_mappings(raw, supplier):
    tabs = {"Amardis": ("amardis", "AMARDISDB", 0, 6), "Cosmodrink": ("cosmodrink", "COSMODRINKDB", 0, 4),
            "Spirit Hall": ("spirithall", "SPIRITHALLDB", 5, 0)}
    spec = tabs.get(supplier)
    candidates = defaultdict(set)
    overrides = {}
    with open_excel(raw, ".xlsx") as (book, names):
        if MAPPING_TAB in names:
            for name, code, sku in book[MAPPING_TAB].iter_rows(min_row=2, max_col=3, values_only=True):
                if read_code(name).casefold() == supplier.casefold() and code and sku:
                    overrides[read_code(code).casefold()] = read_code(sku)
        for name in names:
            if not spec:
                break
            merge_tab, db_tab, external, erp = spec
            if name.casefold() not in (merge_tab.casefold(), db_tab.casefold()):
                continue
            for row in book[name].iter_rows(min_row=2, max_col=max(external, erp) + 1, values_only=True):
                code, sku = read_code(row[external]), read_code(row[erp])
                if code and sku and sku not in ("---", "#N/A"):
                    candidates[code.casefold()].add(sku)
    return {**{code: next(iter(skus)) for code, skus in candidates.items() if len(skus) == 1}, **overrides}


def reference_codes(raw, supplier):
    layouts = {
        "Amardis": (("amardis", "amardisdb"), 0, None),
        "Cosmodrink": (("cosmodrink", "cosmodrinkdb"), 0, None),
        "Spirit Hall": (("spirithall", "spirithalldb"), 5, None),
        "Pernod": (("pernod",), 1, 2),
        "Diageo": (("diageo",), 0, None),
    }
    tabs, index, fallback = layouts[supplier]
    codes = set()
    with open_excel(raw, ".xlsx") as (book, names):
        for name in names:
            if name == MAPPING_TAB:
                for owner, code in book[name].iter_rows(min_row=2, max_col=2, values_only=True):
                    if read_code(owner).casefold() == supplier.casefold() and read_code(code):
                        codes.add(read_code(code).casefold())
            elif name.casefold() in tabs:
                width = max(index, fallback if fallback is not None else index) + 1
                for row in book[name].iter_rows(min_row=2, max_col=width, values_only=True):
                    code = read_code(row[index])
                    if not code and fallback is not None:
                        code = read_code(row[fallback])
                    if code and code not in ("---", "#N/A"):
                        codes.add(code.casefold())
                        if supplier == "Spirit Hall" and type(row[index]) in (int, float):
                            codes.add(legacy_spirit_key(code) or code.casefold())
    return sorted(codes)


def mapping_changes(data):
    supplier, rows = data.get("supplier"), data.get("rows")
    if not isinstance(supplier, str) or not 1 <= len(supplier.strip()) <= 80 or not isinstance(rows, list) or not 1 <= len(rows) <= 20_000:
        raise ValueError("Χρειάζονται προμηθευτής και αντιστοιχίσεις SKU.")
    changes = {}
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("Μη έγκυρη αντιστοίχιση.")
        code, sku = row.get("code"), row.get("sku")
        if not all(isinstance(value, str) and 1 <= len(value.strip()) <= 120 and value.strip() not in ("---", "#N/A") for value in (code, sku)):
            raise ValueError("Μη έγκυρος κωδικός στην αντιστοίχιση.")
        key, sku = code.strip().casefold(), sku.strip()
        if key in changes and changes[key] != sku:
            raise ValueError(f"Ο κωδικός {code} έχει δύο διαφορετικά SKU ERP.")
        changes[key] = sku
    return supplier.strip(), changes


@router.post("/offer-mappings")
async def persist_offer_mappings(request: Request):
    path = require_path(request)

    def save(data):
        supplier, changes = mapping_changes(data)
        return {"saved": save_offer_mappings(path, supplier, changes)}

    return await process(request, save)


def build_mapping_workbook(data):
    supplier, changes = mapping_changes(data)
    return update_mapping_workbook(decode_file(data, "file"), {supplier: changes})


def update_mapping_workbook(raw, mappings):
    with open_excel(raw, ".xlsx"):
        pass
    with BytesIO(raw) as source:
        book = load_workbook(source)
        try:
            sheet = book[MAPPING_TAB] if MAPPING_TAB in book.sheetnames else book.create_sheet(MAPPING_TAB)
            if sheet["A1"].value is None:
                for index, title in enumerate(MAPPING_HEADERS, 1):
                    sheet.cell(1, index, title)
                sheet.freeze_panes = "A2"
            elif tuple(cell.value for cell in sheet[1][:3]) != MAPPING_HEADERS:
                raise ValueError("Το φύλλο αντιστοιχίσεων έχει διαφορετικές επικεφαλίδες.")
            indices = {(read_code(name).casefold(), read_code(code).casefold()): index
                       for index, (name, code, _) in enumerate(sheet.iter_rows(min_row=2, max_col=3, values_only=True), 2)
                       if name and code}
            next_row = sheet.max_row + 1
            for supplier, changes in mappings.items():
                for code, sku in changes.items():
                    key = supplier.casefold(), code.casefold()
                    if key not in indices:
                        indices[key] = next_row
                        next_row += 1
                    for column, value in enumerate((supplier, code, sku), 1):
                        cell = sheet.cell(indices[key], column)
                        cell.value, cell.data_type = value, "s"
            output = BytesIO()
            book.save(output)
            # openpyxl rewrites formula cells without their cached values.
            # Restore the original worksheet XML for sheets we did not edit.
            restored = BytesIO()
            with ZipFile(BytesIO(raw)) as original, ZipFile(output) as updated, ZipFile(restored, "w") as archive:
                original_parts = set(original.namelist())
                for entry in updated.infolist():
                    name = entry.filename
                    content = updated.read(entry)
                    if re.fullmatch(r"xl/worksheets/sheet\d+\.xml", name) and name in original_parts:
                        # Keep the rewritten structure and restore only cached formula values.
                        ns = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
                        source_cells = {cell.get("r"): cell for cell in ET.fromstring(original.read(name)).iter(ns + "c")
                                        if cell.find(ns + "f") is not None and cell.find(ns + "v") is not None}
                        target = ET.fromstring(content)
                        for cell in target.iter(ns + "c"):
                            prior = source_cells.get(cell.get("r"))
                            value = cell.find(ns + "v")
                            if prior is not None and value is not None and cell.find(ns + "f") is not None and prior.get("t") != "s":
                                value.text = prior.find(ns + "v").text
                                if prior.get("t"):
                                    cell.set("t", prior.get("t"))
                        content = ET.tostring(target, encoding="utf-8")
                    archive.writestr(entry, content)
            return restored.getvalue()

        finally:
            book.close()


@router.post("/offer-mapping-workbook")
async def offer_mapping_workbook(request: Request):
    return Response(await process(request, build_mapping_workbook), media_type=XLSX_TYPE,
                    headers={"Content-Disposition": 'attachment; filename="catalog-with-sku-mappings.xlsx"'})


def preview(path, supplier, raw):
    rows = parse_catalog(raw, supplier)
    revision, previous, mappings = previous_catalog(path, supplier)
    previous_by_key = {item["key"]: item for item in previous}
    seen = {row["key"] for row in rows}
    legacy_counts = Counter(legacy_spirit_key(row["code"]) for row in rows) if supplier == "Spirit Hall" else Counter()

    def mapped_sku(row):
        legacy = legacy_spirit_key(row["code"]) if supplier == "Spirit Hall" else None
        fallback = mappings.get(legacy, "") if legacy and legacy_counts[legacy] == 1 else ""
        return mappings.get(row["key"], fallback)

    return {"revision": revision, "removed": [row for row in previous if row["key"] not in seen],
            "rows": [{**row, "erpSku": mapped_sku(row),
                      "previousPrice": previous_by_key.get(row["key"], {}).get("price"),
                      "existing": row["key"] in previous_by_key} for row in rows]}


def read_offer(data, path=None):
    supplier = data.get("supplier")
    if not isinstance(supplier, str) or len(supplier.strip()) > 80:
        raise ValueError("Μη έγκυρο όνομα προμηθευτή.")
    supplier = supplier.strip()
    raw = decode_file(data, "file")
    with open_excel(raw, ".xlsx") as (book, names):
        if "ΠΡΟΣΦΟΡΑ ΠΕΛΑΤΗ" in names and "amardis" in str(book["ΠΡΟΣΦΟΡΑ ΠΕΛΑΤΗ"]["D1"].value).casefold():
            supplier = "Amardis"
    if not supplier:
        raise ValueError("Συμπλήρωσε το όνομα του προμηθευτή.")
    known = next((name for name in SUPPLIERS if name.casefold() == supplier.casefold()), None)
    if known:
        try:
            rows = parse_catalog(raw, known)
        except ValueError:
            rows = None
    else:
        rows = None
    if rows is None:
        fields = {"code": ("ΚΩΔΙΚΟΣ ΤΙΜΟΛΟΓΗΣΗΣ", "Κωδικός Είδους", "Κωδικός Προμηθευτή", "Supplier SKU", "SKU", "Κωδικός",
                           "Κωδικός προϊόντος", "Unique ID", "ERP SKU", "sku_Gr"),
                  "name": ("Περιγραφή", "Product", "Name", "Όνομα"),
                  "price": ("Τελική Τιμή Φιάλης Με ΕΦΚ", "Μετρητοίς", "Τιμή προσφοράς", "Τιμή", "Price"),
                  "minimumQuantity": ("Ελάχιστη Ποσότητα Παραγγελίας Φιαλών",), "erpSku": ("ERP SKU", "sku_Gr")}
        with open_excel(raw, ".xlsx") as (book, _):
            for sheet in book.worksheets:
                items = records(sheet, fields, ("code", "name", "price"))
                if items is not None:
                    rows = [{**row, "code": code, "name": read_code(row["name"]), "key": code.casefold(),
                             "erpSku": read_code(row["erpSku"]), "price": price(row["price"]),
                             "minimumQuantity": number(row["minimumQuantity"])}
                            for row in items if (code := read_code(row["code"])) and read_code(row["name"])
                            and (supplier.casefold() != "jannec" or re.fullmatch(r"[0-9]{2}2[0-9]*", code))]
                    break
            else:
                raise ValueError("Χρειάζονται στήλες κωδικού είδους, περιγραφής και τιμής προσφοράς.")
    if not any(row["price"] is not None for row in rows):
        raise ValueError("Δεν βρέθηκαν προϊόντα με έγκυρη τιμή προσφοράς.")
    mappings = {}
    for field in ("merge", "mapping"):
        if data.get(field):
            mappings.update(offer_mappings(decode_file(data, field), known or supplier))
    if path:
        mappings.update(previous_catalog(path, known or supplier)[2])
    return {"supplier": supplier, "rows": [
        {**row, "erpSku": row.get("erpSku") or mappings.get(row["key"], "")} for row in rows
    ]}


@router.post("/offer-preview")
async def offer_preview(request: Request):
    path = request.app.state.db_path if request.app.state.product_history_enabled else None
    return await process(request, lambda data: read_offer(data, path))


def commit(path, supplier, data):
    rows = parse_catalog(decode_file(data, "file"), supplier)
    revision, decisions = data.get("revision"), data.get("decisions")
    edits = data.get("edits", {})
    filename, day = data.get("filename"), effective_date(data.get("day"))
    keys = {row["key"] for row in rows}
    if (type(revision) is not int or revision < 0 or not isinstance(decisions, dict) or decisions.keys() != keys
            or not all(isinstance(sku, str) and len(sku) <= 80 for sku in decisions.values())
            or not isinstance(filename, str) or not 1 <= len(filename) <= 255):
        raise ValueError("Η έγκριση δεν ταιριάζει με τις γραμμές του αρχείου. Κάνε νέα προεπισκόπηση.")
    if not isinstance(edits, dict) or not edits.keys() <= keys:
        raise ValueError("Μη έγκυρες διορθώσεις καταλόγου.")
    for edit in edits.values():
        if not isinstance(edit, dict) or not edit.keys() <= {"price", "availability"}:
            raise ValueError("Μη έγκυρο πεδίο διόρθωσης.")
        value, availability = edit.get("price"), edit.get("availability", "")
        if value is not None and (type(value) is not int or not 0 < value < 100_000_000_000):
            raise ValueError("Μη έγκυρη τιμή προμηθευτή.")
        if not isinstance(availability, str) or len(availability) > 120:
            raise ValueError("Μη έγκυρη διαθεσιμότητα προμηθευτή.")
    mapped = {key: sku.strip() for key, sku in decisions.items() if sku.strip() not in ("---", "#N/A")}
    approved = [{**row, **edits.get(row["key"], {}), "erpSku": mapped.get(row["key"], "")} for row in rows]
    if not any(row["erpSku"] and row["price"] is not None for row in approved):
        raise ValueError("Αντιστοίχισε τουλάχιστον μία γραμμή με έγκυρη τιμή πριν την έγκριση.")
    approve_catalog(path, supplier, revision, day, PureWindowsPath(filename).name, approved, mapped)
    return {"rows": len(approved), "mapped": sum(bool(row["erpSku"]) for row in approved)}


def require_path(request):
    if not request.app.state.product_history_enabled:
        raise HTTPException(403, "Η αποθήκευση καταλόγων είναι απενεργοποιημένη σε αυτή την εγκατάσταση.")
    return request.app.state.db_path


@router.get("")
def list_catalogs(request: Request):
    enabled = request.app.state.product_history_enabled
    return {"enabled": enabled, "catalogs": summaries(request.app.state.db_path) if enabled else []}


@router.post("/mappings")
async def upload_mappings(request: Request):
    path = require_path(request)
    return await process(request, lambda data: import_mappings(decode_file(data, "file"), path))


@router.post("/export-merge")
async def export_merge(request: Request):
    path = require_path(request)
    return Response(await process(request, lambda data: update_merge(path, decode_file(data, "file"), data.get("suppliers"))),
                    media_type=XLSX_TYPE,
                    headers={"Content-Disposition": 'attachment; filename="catalog-merge-updated.xlsx"'})


@router.post("/export-mappings")
async def export_mappings(request: Request):
    path = require_path(request)
    content = await process(request, lambda data: update_mapping_workbook(decode_file(data, "file"), all_mappings(path)))
    return Response(content, media_type=XLSX_TYPE,
                    headers={"Content-Disposition": 'attachment; filename="catalog-db-updated.xlsx"'})


@router.post("/{supplier}/preview")
async def upload_catalog(supplier: str, request: Request):
    path = require_path(request)
    return await process(request, lambda data: preview(path, supplier, decode_file(data, "file")))


@router.post("/{supplier}/reference-codes")
async def read_reference_codes(supplier: str, request: Request):
    require_path(request)
    if supplier not in SUPPLIERS:
        raise HTTPException(422, "Επίλεξε υποστηριζόμενο προμηθευτή.")
    return await process(request, lambda data: reference_codes(decode_file(data, "file"), supplier))


@router.post("/{supplier}/approve")
async def save_catalog(supplier: str, request: Request):
    path = require_path(request)
    return await process(request, lambda data: commit(path, supplier, data))
