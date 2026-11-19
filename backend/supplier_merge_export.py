import posixpath
import re
from io import BytesIO
from xml.etree import ElementTree as ET
from xml.sax.saxutils import escape
from zipfile import ZipFile

from openpyxl.utils.cell import column_index_from_string, get_column_letter

from .converter import open_excel
from .orders import SKU, SUPPLIERS, column, price
from .payments.workbooks import normalized, read_code
from .supplier_catalog_store import catalog_snapshots, offers_by_sku

MAIN = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
ROW = re.compile(r'<row\b[^>]*\br="(\d+)"[^>]*(?<!/)>.*?</row>', re.DOTALL)
CELL = re.compile(r'<c\b[^>]*\br="([A-Z]+)\d+"[^>]*?(?:/>|>.*?</c>)', re.DOTALL)
SUPPLIER_TABS = {
    "Amardis": ("amardis", ("SKU", "Product Title", "Categories", "Price (Wholesale_customer_tier1)",
                           "Διαθεσιμότητα", "Παραγγελία σε Φιάλες", "sku")),
    "Cosmodrink": ("cosmodrink", ("ΚΩΔΙΚΟΣ ΤΙΜΟΛΟΓΗΣΗΣ", "ΠΕΡΙΓΡΑΦΗ", "ΣΥΣΚΕΥΑΣΙΑ", "ΤΙΜΗ", "sku")),
    "Diageo": ("diageo", ("ΠΕΡΙΓΡΑΦΗ", "ΠΕΡΙΕΧ.", "ΤΕΛΙΚΗ ΤΙΜΗ ΜΕ ΕΦΚΟΠ ΧΩΡΙΣ ΦΠΑ", "SKU")),
    "Pernod": ("pernod", ("code", "ΠΡΟΪΟΝΤΟΣ", "name", "price", "ETAIREIA", "SKU")),
    "Spirit Hall": ("spirithall", ("SKU DIKO MAS", "Περιγραφή", "Alc %", "Size (ml)", "Τιμή (€)/ τεμάχιο", "SKU")),
}


def supplier_values(supplier, row, original):
    code, name, sku = row["code"], row["name"], row["erpSku"] or "---"
    amount = row["price"] / 10000 if row["price"] is not None else "---"
    size = row["volume"] or ""
    if supplier == "Amardis":
        return (code, name, original[2], amount, row["availability"], original[5], sku)
    if supplier == "Cosmodrink":
        return (code, name, original[2] or (f"{size} ml" if size else ""), amount, sku)
    if supplier == "Diageo":
        return (name, original[1] or (f"{size} ml" if size else ""), amount, sku)
    if supplier == "Pernod":
        return (original[0], code, name, amount, original[4] or "pernod", sku)
    return (sku, name, original[2], size, amount, code)


def supplier_key(supplier, row):
    return {"Amardis": lambda: row[0], "Cosmodrink": lambda: row[0], "Diageo": lambda: row[0],
            "Pernod": lambda: row[1] or row[2], "Spirit Hall": lambda: row[5]}[supplier]()


def write_supplier_tab(xml, values, width):
    header = next((match[0] for match in ROW.finditer(xml) if match[1] == "1"), None)
    if header is None:
        raise ValueError("Δεν βρέθηκε η επικεφαλίδα στο φύλλο προμηθευτή.")
    rows = [header]
    for index, row in enumerate(values, 2):
        changes = {col: value for col, value in enumerate(row, 1)
                   if type(value) in (int, float, str) and value != ""}
        rows.append(update_row(f'<row r="{index}"></row>', index, changes))
    xml = re.sub(r"(<sheetData\b[^>]*>).*?(</sheetData>)",
                 lambda match: match[1] + "".join(rows) + match[2], xml, count=1, flags=re.DOTALL)
    extent = f"A1:{get_column_letter(width)}{len(rows)}"
    xml = re.sub(r'(<dimension\s+ref=")[^"]+', lambda match: match[1] + extent, xml, count=1)
    return re.sub(r'(<autoFilter\s+ref=")[^"]+', lambda match: match[1] + extent, xml, count=1)


def update_row(xml, row, updates):
    remaining = dict(updates)

    def cell_xml(col, value, style=""):
        ref = f"{get_column_letter(col)}{row}"
        if isinstance(value, str):
            return f'<c r="{ref}"{style} t="inlineStr"><is><t>{escape(value)}</t></is></c>'
        return f'<c r="{ref}"{style}><v>{value}</v></c>'

    def replace(match):
        col = column_index_from_string(match[1])
        before = "".join(cell_xml(key, remaining.pop(key)) for key in sorted(remaining) if key < col)
        if col not in remaining:
            return before + match[0]
        style = re.search(r'\ss="[^"]+"', match[0].split(">", 1)[0])
        return before + cell_xml(col, remaining.pop(col), style[0] if style else "")

    updated = CELL.sub(replace, xml)
    tail = "".join(cell_xml(col, remaining[col]) for col in sorted(remaining))
    return updated[:-6] + tail + "</row>"


def update_merge(path, raw, suppliers=None):
    snapshots = catalog_snapshots(path)
    approved = offers_by_sku(snapshots)
    if suppliers is not None:
        if not isinstance(suppliers, list) or not all(isinstance(name, str) and name in approved for name in suppliers):
            raise ValueError("Επίλεξε εγκεκριμένους προμηθευτές για την ενημέρωση του Merge.")
        approved = {name: approved[name] for name in suppliers}
    if not approved:
        raise ValueError("Έγκρινε πρώτα τουλάχιστον έναν κατάλογο προμηθευτή.")
    with open_excel(raw, ".xlsx") as (book, names):
        if "Sheet2" not in names:
            raise ValueError("Επίλεξε το Catalog Merge με το συγκεντρωτικό φύλλο Sheet2.")
        rows = book["Sheet2"].iter_rows(max_col=100, values_only=True)
        for header_row, header in zip(range(1, 11), rows):
            headers = {normalized(value): i for i, value in enumerate(header) if value is not None}
            sku_col = column(headers, SKU)
            supplier_cols = {supplier: headers[normalized(label)] for supplier, label in SUPPLIERS.items()
                             if normalized(label) in headers}
            if sku_col is not None and supplier_cols:
                break
        else:
            raise ValueError("Δεν βρέθηκαν οι στήλες SKU και τιμών προμηθευτή στο Sheet2.")
        missing = approved.keys() - supplier_cols.keys()
        if missing:
            raise ValueError("Λείπουν στήλες προμηθευτών από το Merge · " + ", ".join(sorted(missing)))
        tabs = {}
        for supplier, snapshot in snapshots.items():
            if supplier not in approved or supplier not in SUPPLIER_TABS:
                continue
            tab, expected = SUPPLIER_TABS[supplier]
            if tab not in names:
                raise ValueError(f"Λείπει το φύλλο «{tab}» από το Catalog Merge.")
            original = book[tab].iter_rows(max_col=len(expected), values_only=True)
            supplier_header = next(original, ())
            if tuple(map(normalized, supplier_header)) != tuple(map(normalized, expected)):
                raise ValueError(f"Οι στήλες στο φύλλο «{tab}» δεν ταιριάζουν με το Catalog Merge.")
            existing = {normalized(supplier_key(supplier, row)): row for row in original}
            def former(offer):
                key = offer["name"] if supplier == "Diageo" else offer["code"] or offer["name"]
                return existing.get(normalized(key), (None,) * len(expected))

            tabs[tab] = ([supplier_values(supplier, offer, former(offer)) for offer in snapshot], len(expected))
        updates = {}
        for index, row in enumerate(rows, header_row + 1):
            sku = read_code(row[sku_col])
            if not sku or sku in ("---", "#N/A"):
                continue
            current = {}
            changed = {}
            for supplier, col in supplier_cols.items():
                offer = approved.get(supplier, {}).get(sku, {})
                amount = offer.get("price") if supplier in approved else price(row[col])
                if amount is not None:
                    current[supplier] = amount
                if supplier in approved:
                    changed[col + 1] = amount / 10000 if amount is not None else "---"
                    if col > 0 and normalized(header[col - 1]).endswith("name"):
                        changed[col] = offer.get("name") or "---"
            best = min(current, key=current.get) if current else None
            for label, value in (("min price", current[best] / 10000 if best else 0), ("cheaper", SUPPLIERS[best] if best else "---")):
                if normalized(label) in headers:
                    changed[headers[normalized(label)] + 1] = value
            updates[index] = changed
    if not updates:
        raise ValueError("Δεν βρέθηκαν προϊόντα στο Sheet2.")

    output = BytesIO()
    with ZipFile(BytesIO(raw)) as original, ZipFile(output, "w") as archive:
        workbook = ET.fromstring(original.read("xl/workbook.xml"))
        relations = ET.fromstring(original.read("xl/_rels/workbook.xml.rels"))
        targets = {node.get("Id"): node.attrib["Target"] for node in relations}
        parts = {}
        for sheet in workbook.iter(MAIN + "sheet"):
            target = targets[sheet.get(REL)]
            part = target.lstrip("/") if target.startswith("/") else posixpath.normpath(posixpath.join("xl", target))
            parts[part] = sheet.get("name")
        for entry in original.infolist():
            content = original.read(entry)
            name = parts.get(entry.filename)
            if name == "Sheet2":
                def replace(match):
                    row = int(match[1])
                    return update_row(match[0], row, updates.pop(row)) if row in updates else match[0]

                content = ROW.sub(replace, content.decode("utf-8")).encode("utf-8")
            elif name in tabs:
                content = write_supplier_tab(content.decode("utf-8"), *tabs[name]).encode("utf-8")
            archive.writestr(entry, content)
    if updates:
        raise ValueError("Δεν ήταν δυνατή η ενημέρωση όλων των γραμμών του Sheet2.")
    return output.getvalue()
