from openpyxl.cell.cell import ILLEGAL_CHARACTERS_RE
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter


FORMATS = {"text": "@", "price": "#,##0.00", "integer": "0", "percent": "0.0%"}


def append_report(book, report: dict, total: int) -> None:
    if not isinstance(report, dict):
        raise ValueError("Μη έγκυρη αναλυτική αναφορά.")
    columns, rows = report.get("columns"), report.get("rows")
    if (not isinstance(columns, list) or not 1 <= len(columns) <= 24
            or not isinstance(rows, list) or len(rows) != total):
        raise ValueError("Μη έγκυρες στήλες ή γραμμές αναφοράς.")

    headers = []
    formats = []
    widths = []
    for column in columns:
        if not isinstance(column, dict):
            raise ValueError("Μη έγκυρη στήλη αναφοράς.")
        label, kind, width = column.get("label"), column.get("format"), column.get("width")
        if (not isinstance(label, str) or not 1 <= len(label.strip()) <= 80
                or not isinstance(kind, str) or kind not in FORMATS
                or type(width) is not int or not 10 <= width <= 65):
            raise ValueError("Μη έγκυρη στήλη αναφοράς.")
        headers.append(label)
        formats.append(FORMATS[kind])
        widths.append(width)

    sheet = book.create_sheet("Αναλυτική αναφορά")
    sheet.freeze_panes = "A2"
    sheet.sheet_view.showGridLines = False
    sheet.row_dimensions[1].height = 28
    sheet.append([ILLEGAL_CHARACTERS_RE.sub("", label) for label in headers])
    heading_font = Font(bold=True, color="FFFFFF")
    heading_fill = PatternFill("solid", fgColor="20364D")
    wrapped = Alignment(vertical="top", wrap_text=True)
    top = Alignment(vertical="top")
    for cell, width in zip(sheet[1], widths):
        cell.data_type = "s"
        cell.font = heading_font
        cell.fill = heading_fill
        cell.alignment = wrapped
        sheet.column_dimensions[cell.column_letter].width = width

    for row_index, row in enumerate(rows, start=2):
        if not isinstance(row, list) or len(row) != len(columns):
            raise ValueError("Μη έγκυρη γραμμή αναφοράς.")
        for index, (value, number_format) in enumerate(zip(row, formats), start=1):
            if value is None:
                continue
            if isinstance(value, str):
                cell = sheet.cell(row_index, index, ILLEGAL_CHARACTERS_RE.sub("", value))
                cell.data_type = "s"
                cell.alignment = wrapped
            elif type(value) in (int, float) and abs(value) <= 999_999_999_999_999:
                cell = sheet.cell(row_index, index, value)
                cell.number_format = number_format
                cell.alignment = top
            else:
                raise ValueError("Μη έγκυρη τιμή στην αναλυτική αναφορά.")

    sheet.auto_filter.ref = f"A1:{get_column_letter(len(columns))}{total + 1}"
