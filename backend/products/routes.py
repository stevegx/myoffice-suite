from fastapi import APIRouter, HTTPException, Query, Request

from ..payments.routes import process
from ..payments.workbooks import MAX_ROWS
from .history import effective_date, list_products, product_history, save_prices

router = APIRouter(prefix="/api/products", tags=["Products"])


def require_history(request: Request):
    if not request.app.state.product_history_enabled:
        raise HTTPException(403, "Το ιστορικό προϊόντων είναι απενεργοποιημένο σε αυτή την εγκατάσταση.")
    return request.app.state.db_path


@router.get("")
def catalog(request: Request, q: str = Query("", max_length=150), page: int = Query(1, ge=1, le=10000)):
    if not request.app.state.product_history_enabled:
        return {"enabled": False, "items": [], "total": 0, "pageSize": 30}
    return {"enabled": True, **list_products(request.app.state.db_path, q, page)}


@router.get("/history")
def history(request: Request, sku: str = Query(min_length=1, max_length=1024)):
    data = product_history(require_history(request), sku)
    if data is None:
        raise HTTPException(404, "Δεν βρέθηκε το SKU.")
    return data


@router.post("/confirm")
async def confirm(request: Request):
    path = require_history(request)

    def save(data: dict):
        day = effective_date(data.get("day"))
        items = data.get("rows")
        if not isinstance(items, list) or not 0 < len(items) <= MAX_ROWS:
            raise ValueError("Δεν υπάρχουν τιμές για καταχώριση.")
        records = []
        seen = set()
        for item in items:
            if not isinstance(item, dict):
                raise ValueError("Μη έγκυρη εγγραφή προϊόντος.")
            sku, name = item.get("sku"), item.get("product")
            if not all(isinstance(value, str) and value.strip() and len(value) <= 1024 for value in (sku, name)):
                raise ValueError("Απαιτείται SKU και όνομα προϊόντος.")
            sku, name = sku.strip(), name.strip()
            if sku in seen:
                raise ValueError("Διπλό SKU στην καταχώριση.")
            seen.add(sku)
            for channel in ("skroutz", "site"):
                cents = item.get(channel)
                if cents is not None:
                    if type(cents) is not int or not 0 < cents <= 999_999_999:
                        raise ValueError("Μη έγκυρη τιμή προϊόντος.")
                    records.append((sku, name, channel, cents))
        if not records:
            raise ValueError("Δεν υπάρχουν τιμές για καταχώριση.")
        return {"saved": save_prices(path, day, records)}

    return await process(request, save)
