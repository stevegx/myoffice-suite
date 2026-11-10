import json
import sqlite3
from contextlib import closing

from .database import connect_readonly


def read_products(path):
    with closing(connect_readonly(path)) as db:
        return [json.loads(row["ProductJson"]) for row in db.execute("SELECT ProductJson FROM ErpOrderProducts WHERE Active = 1 ORDER BY rowid")]


def merge_products(path, incoming, includes_offers):
    with closing(sqlite3.connect(path, autocommit=True)) as db:
        db.execute("BEGIN IMMEDIATE")
        previous = {sku: json.loads(payload) for sku, payload in db.execute("SELECT Sku, ProductJson FROM ErpOrderProducts")}
        products = {}
        for fresh in incoming:
            sku = fresh["sku"]
            old = previous.get(sku, {})
            product = {**old, **fresh}
            for key in ("minBuy", "lastBuy", "minimumSkroutz"):
                if fresh.get(key) is None:
                    product[key] = old.get(key)
            if not includes_offers:
                for key in ("offers", "availability", "marked", "duplicate"):
                    if key in old:
                        product[key] = old[key]
            products[sku] = product
        active_skus = set(products)
        if includes_offers:
            for sku, old in previous.items():
                if sku not in products:
                    products[sku] = {**old, "offers": {}, "availability": "", "marked": False, "duplicate": False}
        db.executemany("""
            INSERT INTO ErpOrderProducts (Sku, ProductJson, Active) VALUES (?, ?, ?)
            ON CONFLICT(Sku) DO UPDATE SET ProductJson = excluded.ProductJson, Active = excluded.Active
        """, ((sku, json.dumps(product, ensure_ascii=False), sku in active_skus) for sku, product in products.items()))
        db.execute("COMMIT")


def update_costs(path, values):
    updated = unknown = 0
    with closing(sqlite3.connect(path, autocommit=True)) as db:
        db.execute("BEGIN IMMEDIATE")
        products = {sku: json.loads(payload) for sku, payload in db.execute("SELECT Sku, ProductJson FROM ErpOrderProducts WHERE Active = 1")}
        for sku, costs in values.items():
            product = products.get(sku)
            if product is None:
                unknown += 1
                continue
            changes = {key: value for key, value in costs.items() if value is not None and value != product[key]}
            if changes:
                db.execute("UPDATE ErpOrderProducts SET ProductJson = ? WHERE Sku = ?",
                           (json.dumps({**product, **changes}, ensure_ascii=False), sku))
                updated += 1
        db.execute("COMMIT")
    return {"updated": updated, "unknown": unknown}
