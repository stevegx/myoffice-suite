import re
import unicodedata
from datetime import date, datetime
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from io import BytesIO
from zipfile import ZipFile

import xlrd
from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

from .matching import ADMIN_CODE, Customer, Order

MAX_ROWS = 20000
MAX_COLUMNS = 100
MAX_EXPANDED_BYTES = 64 * 1024 * 1024


def normalized(value) -> str:
    text = unicodedata.normalize("NFD", str(value or "").casefold())
    return "".join(ch for ch in text if not unicodedata.combining(ch)).replace("i", "ι").strip()


def columns(row, *required: str) -> dict[str, int] | None:
    headers = {normalized(value): index for index, value in enumerate(row)}
    if all(normalized(label) in headers for label in required):
        return {label: headers[normalized(label)] for label in required}
    return None


def read_day(value) -> date | None:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    if isinstance(value, str) and value.strip():
        token = value.strip().split()[0]
        for fmt in ("%d/%m/%Y", "%d-%m-%Y", "%Y-%m-%d"):
            try:
                return datetime.strptime(token, fmt).date()
            except ValueError:
                continue
    return None


def read_cents(value) -> int | None:
    if isinstance(value, bool) or value is None:
        return None
    text = str(value).strip().replace("€", "").replace("\xa0", "").replace(" ", "")
    if "," in text:
        text = text.replace(".", "").replace(",", ".")
    if not re.fullmatch(r"[+-]?\d{1,12}(?:\.\d{1,10})?", text):
        return None
    try:
        return int((Decimal(text) * 100).quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    except InvalidOperation:
        return None


def read_code(value) -> str:
    if value is None or isinstance(value, bool):
        return ""
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    return str(value).strip()


def cell_value(book, cell):
    if cell.ctype == xlrd.XL_CELL_DATE:
        return xlrd.xldate_as_datetime(cell.value, book.datemode)
    if cell.ctype == xlrd.XL_CELL_BOOLEAN:
        return bool(cell.value)
    if cell.ctype == xlrd.XL_CELL_ERROR:
        return xlrd.error_text_from_code.get(cell.value, "#VALUE!")
    return cell.value


def read_skroutz(content: bytes, *, formatting: bool = False):
    if xlrd.inspect_format(content=content) != "xls":
        raise ValueError("Χρειάζεται το αρχικό αρχείο Skroutz σε μορφή .xls.")
    book = xlrd.open_workbook(file_contents=content, on_demand=True, formatting_info=formatting)
    try:
        sheet = book.sheet_by_index(0)
        if not 1 < sheet.nrows <= MAX_ROWS or sheet.ncols > MAX_COLUMNS:
            raise ValueError("Το αρχείο Skroutz είναι κενό ή υπερβαίνει τα όρια γραμμών ή στηλών.")
        header = columns(sheet.row_values(0), "Κωδικός Παραγγελίας", "Πελάτης", "Καταχωρήθηκε", "Κόστος προϊόντων")
        if header is None or book.nsheets != 1:
            raise ValueError("Το αρχείο Skroutz πρέπει να έχει ένα φύλλο με τις αρχικές στήλες πληρωμής.")

        orders = []
        for index in range(1, sheet.nrows):
            name = str(sheet.cell_value(index, header["Πελάτης"]) or "")
            raw_day = cell_value(book, sheet.cell(index, header["Καταχωρήθηκε"]))
            if not raw_day and not name.strip():
                continue  # Totals and footer text have neither field.
            day = read_day(raw_day)
            if day is None:
                raise ValueError(f"Μη αναγνωρίσιμη ημερομηνία Skroutz στη γραμμή {index + 1}.")
            orders.append(Order(
                index + 1, read_code(sheet.cell_value(index, header["Κωδικός Παραγγελίας"])),
                day, name, read_cents(sheet.cell_value(index, header["Κόστος προϊόντων"])),
            ))
        if not orders:
            raise ValueError("Το αρχείο Skroutz δεν περιέχει εγγραφές πληρωμής.")
        return book, sheet, header["Πελάτης"], orders
    finally:
        book.release_resources()


def read_erp(content: bytes) -> tuple[list[Customer], list[date]]:
    with ZipFile(BytesIO(content)) as archive:
        if sum(entry.file_size for entry in archive.infolist()) > MAX_EXPANDED_BYTES:
            raise ValueError("Το ERP Excel υπερβαίνει το όριο αποσυμπιεσμένου μεγέθους.")
    with BytesIO(content) as source:
        workbook = load_workbook(source, read_only=True, data_only=True, keep_links=False)
        try:
            return read_erp_sheet(workbook.worksheets[0])
        finally:
            workbook.close()


def read_erp_sheet(sheet) -> tuple[list[Customer], list[date]]:
    if (sheet.max_row or 0) > MAX_ROWS or (sheet.max_column or 0) > MAX_COLUMNS:
        raise ValueError("Το export ERP υπερβαίνει τα όρια γραμμών ή στηλών.")
    rows = sheet.iter_rows(max_col=MAX_COLUMNS, values_only=True)
    for index, row in enumerate(rows):
        header = columns(row, "Ημερ/νία", "Επωνυμία", "Συνολική", "Κωδικός")
        if header is not None or index >= 9:
            break
    else:
        header = None
    if header is None:
        raise ValueError("Το ERP export χρειάζεται τις στήλες Ημερ/νία, Επωνυμία, Συνολική και Κωδικός.")
    void_column = next((i for i, value in enumerate(row) if normalized(value) == "ακυρο"), None)
    customers, days = [], []
    for index, row in enumerate(rows, start=index + 2):
        if index > MAX_ROWS:
            raise ValueError("Το export ERP υπερβαίνει το όριο γραμμών.")
        day = read_day(row[header["Ημερ/νία"]])
        if day is None:
            continue
        days.append(day)
        if void_column is not None and normalized(row[void_column]) in {"ναι", "yes", "1", "true"}:
            continue
        name = str(row[header["Επωνυμία"]] or "").strip()
        code = read_code(row[header["Κωδικός"]])
        cents = read_cents(row[header["Συνολική"]])
        if code and name and cents is not None:
            customers.append(Customer(code, day, name, cents))
    if not customers:
        raise ValueError("Το ERP export δεν περιέχει έγκυρες εγγραφές με ημερομηνία, πελάτη, κωδικό και ποσό.")
    return customers, days


def export_workbook(content: bytes, codes: dict[int, str]) -> bytes:
    source, sheet, name_column, orders = read_skroutz(content, formatting=True)
    if codes.keys() - {order.row for order in orders}:
        raise ValueError("Οι κωδικοί δεν αντιστοιχούν στις γραμμές του αρχείου Skroutz.")
    final_codes = codes | {order.row: ADMIN_CODE for order in orders if order.is_admin}
    workbook = Workbook()
    target = workbook.active
    target.title = re.sub(r"[\\/*?:\[\]]", "-", sheet.name)[:31]
    code_column = name_column + 2

    def shifted(index: int) -> int:
        return index + 1 + (index > name_column)

    def rgb(index: int) -> str | None:
        colour = source.colour_map.get(index)
        return "%02X%02X%02X" % colour if colour is not None else None

    styles = {}
    for row_index in range(sheet.nrows):
        row_info = sheet.rowinfo_map.get(row_index)
        if row_info and row_info.height:
            target.row_dimensions[row_index + 1].height = row_info.height / 20
        for column, original in enumerate(sheet.row(row_index)):
            if original.ctype == xlrd.XL_CELL_EMPTY:
                continue
            cell = target.cell(row_index + 1, shifted(column), cell_value(source, original))
            if isinstance(cell.value, str):
                cell.data_type = "e" if original.ctype == xlrd.XL_CELL_ERROR else "s"
            if original.xf_index not in styles:
                xf = source.xf_list[original.xf_index]
                font = source.font_list[xf.font_index]
                background = rgb(xf.background.pattern_colour_index)
                styles[original.xf_index] = (
                    Font(name=font.name, size=font.height / 20 or 11, bold=bool(font.bold),
                         italic=bool(font.italic), color=rgb(font.colour_index)),
                    PatternFill("solid", fgColor=background) if background and xf.background.fill_pattern else PatternFill(),
                    Alignment(wrap_text=bool(xf.alignment.text_wrapped)),
                    source.format_map[xf.format_key].format_str,
                )
            cell.font, cell.fill, cell.alignment, cell.number_format = styles[original.xf_index]
        value = "Κωδικός πελάτη ERP" if row_index == 0 else final_codes.get(row_index + 1)
        if value:
            cell = target.cell(row_index + 1, code_column, value)
            cell.data_type = "s"
            cell.number_format = "@"
            if row_index == 0:
                original_header = target.cell(1, name_column + 1)
                cell.font, cell.fill = styles[sheet.cell(0, name_column).xf_index][:2]
                cell.alignment = Alignment(wrap_text=bool(original_header.alignment.wrap_text))
    for column, info in sheet.colinfo_map.items():
        target.column_dimensions[get_column_letter(shifted(column))].width = info.width / 256
    target.column_dimensions[get_column_letter(code_column)].width = 24
    last_column = get_column_letter(shifted(sheet.ncols - 1))
    target.auto_filter.ref = f"A1:{last_column}{orders[-1].row}"
    with BytesIO() as output:
        workbook.save(output)
        return output.getvalue()
