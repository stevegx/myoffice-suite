import json
import sqlite3
from collections import defaultdict
from contextlib import closing

from .database import connect_readonly


def summaries(path):
    with closing(connect_readonly(path)) as db:
        return [
            {"supplier": row["Supplier"], "revision": row["Revision"], "day": row["EffectiveOn"],
             "filename": row["Filename"], "rows": len(items), "mapped": sum(bool(item["erpSku"]) for item in items)}
            for row in db.execute("SELECT * FROM SupplierCatalogs ORDER BY Supplier")
            for items in [json.loads(row["RowsJson"])]
        ]


def previous_catalog(path, supplier):
    with closing(connect_readonly(path)) as db:
        db.execute("BEGIN")
        current = db.execute("SELECT * FROM SupplierCatalogs WHERE Supplier = ?", (supplier,)).fetchone()
        mappings = dict(db.execute("SELECT ExternalKey, ErpSku FROM SupplierSkuMappings WHERE Supplier = ?", (supplier,)))
        return current["Revision"] if current else 0, json.loads(current["RowsJson"]) if current else [], mappings


def seed_mappings(path, mappings):
    with closing(sqlite3.connect(path, autocommit=True)) as db:
        db.execute("BEGIN IMMEDIATE")
        count = db.executemany("""
            INSERT INTO SupplierSkuMappings VALUES (?, ?, ?)
            ON CONFLICT(Supplier, ExternalKey) DO NOTHING
        """, mappings).rowcount
        db.execute("COMMIT")
    return count


def approve_catalog(path, supplier, revision, day, filename, rows, decisions):
    with closing(sqlite3.connect(path, autocommit=True)) as db:
        db.execute("BEGIN IMMEDIATE")
        existing = db.execute(
            "SELECT Revision, EffectiveOn FROM SupplierCatalogs WHERE Supplier = ?", (supplier,)
        ).fetchone()
        if revision != (existing[0] if existing else 0):
            raise ValueError("Ο κατάλογος ενημερώθηκε στο μεταξύ. Ανέβασε ξανά το αρχείο για νέο έλεγχο.")
        if existing and day < existing[1]:
            raise ValueError("Η ημερομηνία είναι παλαιότερη από τον τελευταίο εγκεκριμένο κατάλογο.")
        db.executemany("""
            INSERT INTO SupplierSkuMappings VALUES (?, ?, ?)
            ON CONFLICT(Supplier, ExternalKey) DO UPDATE SET ErpSku = excluded.ErpSku
        """, ((supplier, key, sku) for key, sku in decisions.items() if sku))
        db.execute("""
            INSERT INTO SupplierCatalogs VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(Supplier) DO UPDATE SET Revision = excluded.Revision, EffectiveOn = excluded.EffectiveOn,
                Filename = excluded.Filename, RowsJson = excluded.RowsJson
        """, (supplier, revision + 1, day, filename, json.dumps(rows, ensure_ascii=False)))
        db.execute("COMMIT")


def current_offers(path):
    offers = {}
    with closing(connect_readonly(path)) as db:
        for row in db.execute("SELECT Supplier, EffectiveOn, RowsJson FROM SupplierCatalogs"):
            by_sku = defaultdict(list)
            for offer in json.loads(row["RowsJson"]):
                if offer["erpSku"]:
                    by_sku[offer["erpSku"]].append({**offer, "day": row["EffectiveOn"]})
            offers[row["Supplier"]] = {
                sku: min(items, key=lambda item: item["price"] if item["price"] is not None else float("inf"))
                for sku, items in by_sku.items()
            }
    return offers
