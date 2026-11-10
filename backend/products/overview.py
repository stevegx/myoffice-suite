import json
import sqlite3
from contextlib import closing

from ..database import connect_readonly
from ..supplier_catalog_store import current_offers
from .catalog_search import catalog_search, search_key
from .history import product_history

PAGE_SIZE = 30
REPRICING_SKUS = "SELECT value AS Sku FROM RepricingCatalog, json_each(SkusJson)"
ALL_SKUS = f"""
    SELECT Sku FROM ErpOrderProducts WHERE Active = 1
    UNION SELECT Sku FROM Products
    UNION SELECT Sku FROM ProductMinimums
    UNION {REPRICING_SKUS}
"""
OVERVIEW = """
    WITH keys AS ({keys}), catalog AS (
        SELECT k.Sku AS sku,
               COALESCE(json_extract(e.ProductJson, '$.name'), p.SkroutzName, p.Name, m.Name, k.Sku) AS name,
               json_extract(e.ProductJson, '$.name') AS erpName, p.SkroutzName AS skroutzName,
               CASE WHEN p.SkroutzName IS NULL THEN p.Name END AS legacyName,
               e.ProductJson AS erp, m.Cents AS floorCents, m.ObservedOn AS floorDay,
               o.Units AS optimizer
        FROM keys k
        LEFT JOIN ErpOrderProducts e ON e.Sku = k.Sku AND e.Active = 1
        LEFT JOIN Products p ON p.Sku = k.Sku
        LEFT JOIN ProductMinimums m ON m.Sku = k.Sku
        LEFT JOIN ProductOptimizerPrices o ON o.Sku = k.Sku
    )
"""
PRICES = """
    (SELECT Cents FROM ProductPrices WHERE Sku = c.sku AND Channel = 'skroutz'
     ORDER BY EffectiveOn DESC, Id DESC LIMIT 1) AS skroutz,
    (SELECT Cents FROM ProductPrices WHERE Sku = c.sku AND Channel = 'site'
     ORDER BY EffectiveOn DESC, Id DESC LIMIT 1) AS site
"""


def optimizer_prices(path):
    with closing(connect_readonly(path)) as db:
        return dict(db.execute("SELECT Sku, Units FROM ProductOptimizerPrices"))


def replace_optimizer_prices(path, values):
    rows = [(sku, row["skroutz"]) for sku, row in values.items() if row["skroutz"] is not None]
    if not rows:
        raise ValueError("Δεν βρέθηκαν έγκυρες τιμές Price Optimizer στο αρχείο.")
    with closing(sqlite3.connect(path, autocommit=True)) as db:
        db.execute("BEGIN IMMEDIATE")
        db.execute("DELETE FROM ProductOptimizerPrices")
        db.executemany("INSERT INTO ProductOptimizerPrices VALUES (?, ?)", rows)
        db.execute("COMMIT")


def product_fields(row, suppliers):
    sku = row["sku"]
    erp = json.loads(row["erp"]) if row["erp"] else {}
    offers = {supplier: {"supplier": supplier, "price": value, "availability": erp.get("availability", "") if supplier == "Amardis" else "",
                         "day": None}
              for supplier, value in erp.get("offers", {}).items()}
    for supplier, latest in suppliers.items():
        offers.pop(supplier, None)
        offer = latest.get(sku)
        if offer is not None and (offer["price"] is not None or offer["availability"]):
            offers[supplier] = {"supplier": supplier, "price": offer["price"], "availability": offer["availability"], "day": offer["day"]}
    prices = sorted(offers.values(), key=lambda item: (item["price"] is None, item["price"] or 0, item["supplier"]))
    return {"sku": sku, "name": row["name"], "erpName": row["erpName"], "skroutzName": row["skroutzName"],
            "legacyName": row["legacyName"], "skroutz": row["skroutz"], "site": row["site"],
            "minimum": (row["floorCents"] * 100 if row["floorCents"] is not None else None)
            if row["floorDay"] else erp.get("minimumSkroutz"),
            "minimumSource": "repricing" if row["floorDay"] else "erp" if erp.get("minimumSkroutz") is not None else None,
            "minimumDay": row["floorDay"], "optimizer": row["optimizer"],
            "minBuy": erp.get("minBuy"), "lastBuy": erp.get("lastBuy"),
            "bestOffer": next((offer for offer in prices if offer["price"] is not None), None), "offers": prices}


def list_catalog(path, query, page):
    overview = OVERVIEW.format(keys=REPRICING_SKUS)
    search = search_key(query.strip())
    where = "WHERE matches_catalog(concat_ws(' ', sku, name, NULLIF(skroutzName, name), NULLIF(legacyName, name)))" if search else ""
    with closing(connect_readonly(path)) as db:
        db.execute("BEGIN")
        if search:
            db.create_function("matches_catalog", 1, catalog_search(query), deterministic=True)
        db.create_function("search_key", 1, search_key, deterministic=True)
        total = db.execute(overview + f"SELECT count(*) FROM catalog {where}").fetchone()[0]
        rows = db.execute(overview + f"""
            SELECT c.*, {PRICES} FROM catalog c {where}
            ORDER BY (instr(search_key(sku), ?) = 1) DESC, sku LIMIT ? OFFSET ?
        """, (search, PAGE_SIZE, (page - 1) * PAGE_SIZE)).fetchall()
    suppliers = current_offers(path) if rows else {}
    items = []
    for row in rows:
        fields = product_fields(row, suppliers)
        del fields["offers"]
        items.append(fields)
    return {"items": items, "total": total, "pageSize": PAGE_SIZE}


def detail(path, sku):
    overview = OVERVIEW.format(keys=ALL_SKUS)
    with closing(connect_readonly(path)) as db:
        row = db.execute(overview + f"SELECT c.*, {PRICES} FROM catalog c WHERE c.sku = ?", (sku,)).fetchone()
    if row is None:
        return None
    history = product_history(path, sku)
    return {**product_fields(row, current_offers(path)), "prices": history["prices"] if history else []}
