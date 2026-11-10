import re
from collections import Counter, defaultdict
from pathlib import PureWindowsPath

from fastapi import APIRouter, HTTPException, Request

from .converter import open_excel
from .orders import number, price, records
from .payments.routes import decode_file, process
from .payments.workbooks import normalized, read_code
from .products.history import effective_date
from .supplier_catalog_store import approve_catalog, previous_catalog, seed_mappings, summaries

router = APIRouter(prefix="/api/supplier-catalogs", tags=["Supplier catalogs"])
SUPPLIERS = ("Cosmodrink", "Diageo", "Spirit Hall", "Pernod", "Amardis")
SIZE = re.compile(r"(\d+(?:[.,]\d+)?)\s*(ml|cl|lit|lt|l)\b", re.I)


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
        tab = "ΠΡΟΣΦΟΡΑ"
        fields = {"code": ("ΚΩΔΙΚΟΣ ΤΙΜΟΛΟΓΗΣΗΣ",), "name": ("ΠΕΡΙΓΡΑΦΗ",), "size": ("ΣΥΣΚΕΥΑΣΙΑ",), "price": ("ΤΙΜΗ",)}
    elif supplier == "Spirit Hall":
        tab = "Φύλλο1"
        fields = {"code": ("SKU",), "name": ("Περιγραφή",), "size": ("Size (ml)",),
                  "price": ("Τιμή (€)/ τεμάχιο",), "case": ("Τιμή για αγορά κιβωτίου",)}
    else:
        tab = book.worksheets[0].title
        fields = {"code": ("SKU",), "name": ("Product Title",), "price": ("Price (Wholesale_customer_tier1)",),
                  "availability": ("Διαθεσιμότητα",)}
    for row in sheet_rows(book, tab, fields, tuple(key for key in fields if key != "case")):
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
    with open_excel(raw, ".xlsx") as (book, names):
        for name, supplier, ext, erp in specs:
            if name not in names:
                continue
            for row in book[name].iter_rows(min_row=2, max_col=max(ext, erp) + 1, values_only=True):
                code, sku = read_code(row[ext]), read_code(row[erp])
                if code and sku and sku not in ("---", "#N/A"):
                    key = legacy_spirit_key(code) if supplier == "Spirit Hall" and type(row[ext]) in (int, float) else None
                    candidates[supplier, key or code.casefold()].add(sku)
    if not candidates:
        raise ValueError("Δεν βρέθηκαν αντιστοιχίσεις στα φύλλα AMARDISDB, COSMODRINKDB ή SPIRITHALLDB.")
    safe = [(supplier, key, next(iter(skus))) for (supplier, key), skus in candidates.items() if len(skus) == 1]
    return {"saved": seed_mappings(path, safe), "conflicts": len(candidates) - len(safe)}


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


@router.post("/{supplier}/preview")
async def upload_catalog(supplier: str, request: Request):
    path = require_path(request)
    return await process(request, lambda data: preview(path, supplier, decode_file(data, "file")))


@router.post("/{supplier}/approve")
async def save_catalog(supplier: str, request: Request):
    path = require_path(request)
    return await process(request, lambda data: commit(path, supplier, data))
