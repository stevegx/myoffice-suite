import csv
from contextlib import contextmanager
from io import BytesIO, StringIO
from itertools import islice
from pathlib import PureWindowsPath
from urllib.parse import quote
from zipfile import ZipFile

import xlrd
from fastapi import APIRouter, Request, Response
from openpyxl import Workbook, load_workbook
from openpyxl.cell import WriteOnlyCell
from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE

from .payments.routes import decode_file, process
from .payments.workbooks import MAX_EXPANDED_BYTES, MAX_ROWS

router = APIRouter(prefix="/api/converter", tags=["Converter"])
DELIMITERS = (",", ";", "\t", "|", ".")
MAX_COLUMNS = 256
XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"


def decode_csv(raw: bytes) -> str:
    if raw.startswith((b"\xff\xfe", b"\xfe\xff")):
        return raw.decode("utf-16")
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError:
        try:
            return raw.decode("cp1253")
        except UnicodeDecodeError as error:
            raise ValueError("Η κωδικοποίηση του CSV δεν αναγνωρίστηκε. Αποθήκευσέ το ως UTF-8.") from error


def csv_rows(text: str, delimiter: str):
    return csv.reader(StringIO(text, newline=""), delimiter=delimiter, strict=True)


def detect_delimiter(text: str) -> str:
    matches = []
    # A period can be a decimal separator. Keep it as an explicit choice.
    for delimiter in DELIMITERS[:-1]:
        try:
            widths = [len(row) for row in islice(csv_rows(text, delimiter), 30) if row]
        except csv.Error:
            continue
        if widths and widths[0] > 1 and all(width == widths[0] for width in widths):
            matches.append(delimiter)
    if len(matches) != 1:
        raise ValueError("Η αυτόματη ανίχνευση δεν έδωσε σαφές διαχωριστικό. Επίλεξέ το χειροκίνητα.")
    return matches[0]


def csv_to_excel(raw: bytes, delimiter: str) -> bytes:
    text = decode_csv(raw)
    if not text.strip():
        raise ValueError("Το CSV είναι κενό.")
    if delimiter == "auto":
        delimiter = detect_delimiter(text)
    book = Workbook(write_only=True)
    sheet = book.create_sheet("CSV")

    # Validate before creating worksheet temp files so failed conversions leave no partial output.
    try:
        for index, row in enumerate(csv_rows(text, delimiter), start=1):
            if index > MAX_ROWS or len(row) > MAX_COLUMNS:
                raise ValueError("Το αρχείο υπερβαίνει τις 20.000 γραμμές ή τις 256 στήλες.")
            if any(len(value) > 32767 or ILLEGAL_CHARACTERS_RE.search(value) for value in row):
                raise ValueError(f"Η γραμμή {index} έχει κελί που δεν μπορεί να αποθηκευτεί στο Excel.")
    except csv.Error as error:
        raise ValueError("Το CSV έχει μη έγκυρη μορφή ή εισαγωγικά για το επιλεγμένο διαχωριστικό.") from error

    for row in csv_rows(text, delimiter):
        cells = []
        for value in row:
            cell = WriteOnlyCell(sheet, value=value.replace("\r\n", "\n").replace("\r", "\n"))
            cell.data_type = "s"
            cells.append(cell)
        sheet.append(cells)
    output = BytesIO()
    book.save(output)
    return output.getvalue()


@contextmanager
def open_excel(raw: bytes, extension: str):
    if extension == ".xls":
        book = xlrd.open_workbook(file_contents=raw, on_demand=True)
        try:
            yield book, book.sheet_names()
        finally:
            book.release_resources()
        return
    with ZipFile(BytesIO(raw)) as archive:
        if sum(item.file_size for item in archive.infolist()) > MAX_EXPANDED_BYTES:
            raise ValueError("Το αποσυμπιεσμένο Excel είναι πολύ μεγάλο.")
    book = load_workbook(BytesIO(raw), read_only=True, data_only=True, keep_links=False)
    try:
        yield book, [sheet.title for sheet in book.worksheets]
    finally:
        book.close()


def xls_value(cell, datemode: int):
    if cell.ctype == xlrd.XL_CELL_DATE:
        return xlrd.xldate_as_datetime(cell.value, datemode)
    if cell.ctype == xlrd.XL_CELL_BOOLEAN:
        return bool(cell.value)
    if cell.ctype == xlrd.XL_CELL_ERROR:
        return xlrd.error_text_from_code.get(cell.value, "#ERROR")
    return cell.value


def excel_rows(book, name: str, extension: str):
    if extension == ".xls":
        sheet = book.sheet_by_name(name)
        if sheet.nrows > MAX_ROWS or sheet.ncols > MAX_COLUMNS:
            raise ValueError("Το φύλλο υπερβαίνει τις 20.000 γραμμές ή τις 256 στήλες.")
        for row in sheet.get_rows():
            yield [xls_value(cell, book.datemode) for cell in row]
    else:
        sheet = book[name]
        sheet.reset_dimensions()
        yield from sheet.values


def excel_to_csv(raw: bytes, extension: str, name: str, delimiter: str, decimal: str) -> bytes:
    with open_excel(raw, extension) as (book, names):
        if name not in names:
            raise ValueError("Επίλεξε έγκυρο φύλλο Excel.")
        rows = []
        width = 0
        has_values = False
        for index, row in enumerate(excel_rows(book, name, extension), start=1):
            if index > MAX_ROWS or len(row) > MAX_COLUMNS:
                raise ValueError("Το φύλλο υπερβαίνει τις 20.000 γραμμές ή τις 256 στήλες.")
            width = max(width, len(row))
            has_values |= any(value is not None and value != "" for value in row)
            rows.append(row)
        if not has_values:
            raise ValueError("Το επιλεγμένο φύλλο είναι κενό.")

    output = StringIO(newline="")
    writer = csv.writer(output, delimiter=delimiter)
    for row in rows:
        values = [str(value).replace(".", decimal) if type(value) is float else value for value in row]
        writer.writerow(values + [""] * (width - len(values)))
    return output.getvalue().encode("utf-8-sig")


def file_name(data: dict) -> PureWindowsPath:
    name = data.get("filename")
    if not isinstance(name, str) or not 1 <= len(name) <= 255:
        raise ValueError("Επίλεξε έγκυρο αρχείο.")
    return PureWindowsPath(name)


def list_sheets(data: dict) -> dict:
    extension = file_name(data).suffix.lower()
    if extension not in (".xlsx", ".xls"):
        raise ValueError("Επίλεξε αρχείο .xlsx ή .xls.")
    with open_excel(decode_file(data, "file"), extension) as (_, names):
        if not names:
            raise ValueError("Δεν βρέθηκε φύλλο εργασίας στο Excel.")
        return {"sheets": names}


def convert(data: dict) -> tuple[bytes, str, str]:
    name = file_name(data)
    extension = name.suffix.lower()
    delimiter = data.get("delimiter")
    if extension == ".csv" and delimiter in (*DELIMITERS, "auto"):
        return csv_to_excel(decode_file(data, "file"), delimiter), f"{name.stem}.xlsx", XLSX_TYPE
    if extension in (".xlsx", ".xls") and delimiter in DELIMITERS and data.get("decimal") in (",", "."):
        content = excel_to_csv(decode_file(data, "file"), extension, data.get("sheet"), delimiter, data["decimal"])
        return content, f"{name.stem}.csv", "text/csv"
    raise ValueError("Έλεγξε τον τύπο αρχείου και το διαχωριστικό.")


@router.post("/sheets")
async def sheets(request: Request):
    return await process(request, list_sheets)


@router.post("/convert")
async def download(request: Request):
    content, filename, media_type = await process(request, convert)
    fallback = f"converted{PureWindowsPath(filename).suffix}"
    return Response(content, media_type=media_type, headers={
        "Content-Disposition": f'attachment; filename="{fallback}"; filename*=UTF-8\'\'{quote(filename, safe="")}',
        "Cache-Control": "no-store",
    })
