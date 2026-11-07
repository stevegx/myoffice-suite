import binascii
import json
from base64 import b64decode
from struct import error as StructError
from urllib.parse import quote
from xml.etree.ElementTree import ParseError
from zipfile import BadZipFile

from defusedxml.common import DefusedXmlException
from fastapi import APIRouter, HTTPException, Request, Response
from openpyxl.utils.exceptions import InvalidFileException
from starlette.concurrency import run_in_threadpool
from xlrd import XLRDError
from xlrd.compdoc import CompDocError

from .matching import period, reconcile
from .workbooks import MAX_ROWS, export_workbook, read_erp, read_skroutz

MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_REQUEST_BYTES = 24 * 1024 * 1024
router = APIRouter(prefix="/api/payments", tags=["Payments"])


async def payload(request: Request, *, allow_form: bool = False) -> dict:
    body = bytearray()
    async for chunk in request.stream():
        if len(body) + len(chunk) > MAX_REQUEST_BYTES:
            raise HTTPException(413, "Τα αρχεία είναι πολύ μεγάλα. Μέγιστο μέγεθος 8 MB ανά αρχείο.")
        body.extend(chunk)
    try:
        if allow_form and request.headers.get("content-type", "").split(";", 1)[0] == "text/plain":
            if not body.startswith(b"payload="):
                raise ValueError("Missing form payload")
            del body[:len(b"payload=")]
        data = json.loads(body)
    except (ValueError, RecursionError) as error:
        raise HTTPException(400, "Μη έγκυρο αίτημα.") from error
    if not isinstance(data, dict):
        raise HTTPException(400, "Μη έγκυρο αίτημα.")
    return data


def decode_file(data: dict, field: str) -> bytes:
    value = data.get(field)
    if not isinstance(value, str) or not value:
        raise ValueError("Επίλεξε τα απαιτούμενα αρχεία.")
    if len(value) > 4 * ((MAX_FILE_BYTES + 2) // 3):
        raise ValueError("Μέγιστο μέγεθος 8 MB ανά αρχείο.")
    decoded = b64decode(value, validate=True)
    if len(decoded) > MAX_FILE_BYTES:
        raise ValueError("Μέγιστο μέγεθος 8 MB ανά αρχείο.")
    return decoded


async def process(request: Request, action, *, allow_form: bool = False):
    data = await payload(request, allow_form=allow_form)
    try:
        return await run_in_threadpool(action, data)
    except (binascii.Error, XLRDError, CompDocError, InvalidFileException, BadZipFile, DefusedXmlException,
            ParseError, StructError, IndexError, KeyError, OverflowError) as error:
        raise HTTPException(422, "Το αρχείο Excel είναι κατεστραμμένο ή σε μη υποστηριζόμενη μορφή.") from error
    except ValueError as error:
        raise HTTPException(422, str(error)) from error


def inspect_payment(data: dict) -> dict:
    *_, orders = read_skroutz(decode_file(data, "skroutz"))
    return period(orders)


def match_payment(data: dict) -> dict:
    *_, orders = read_skroutz(decode_file(data, "skroutz"))
    customers, days = read_erp(decode_file(data, "erp"))
    names_by_code = {}
    for customer in customers:
        names_by_code.setdefault(customer.code, {})[customer.name] = None
    return {
        "rows": reconcile(orders, customers),
        "erpFirst": min(days),
        "erpLast": max(days),
        "erpNamesByCode": {code: list(names) for code, names in names_by_code.items()},
    }


def build_export(data: dict) -> tuple[bytes, str]:
    raw_codes = data.get("codes")
    if not isinstance(raw_codes, dict) or len(raw_codes) > MAX_ROWS:
        raise ValueError("Μη έγκυρη λίστα κωδικών πελάτη.")
    codes = {}
    for row, code in raw_codes.items():
        if not row.isascii() or not row.isdecimal() or len(row) > 5 or not isinstance(code, str) or len(code) > 100:
            raise ValueError("Μη έγκυρος κωδικός πελάτη ή αριθμός γραμμής.")
        codes[int(row)] = code.strip()
    filename = data.get("filename")
    stem = filename[:-4] if isinstance(filename, str) and filename.lower().endswith(".xls") else "skroutz"
    stem = "".join(ch for ch in stem if ch.isalnum() or ch in " -_")[:120].strip() or "skroutz"
    return export_workbook(decode_file(data, "skroutz"), codes), f"{stem}-matched-ERP.xlsx"


@router.post("/period")
async def payment_period(request: Request):
    return await process(request, inspect_payment)


@router.post("/match")
async def payment_match(request: Request):
    return await process(request, match_payment)


@router.post("/export")
async def payment_export(request: Request):
    content, filename = await process(request, build_export, allow_form=True)
    return Response(
        content,
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={
            "Content-Disposition": f'attachment; filename="skroutz-matched-ERP.xlsx"; filename*=UTF-8\'\'{quote(filename)}',
            "Cache-Control": "no-store",
        },
    )
