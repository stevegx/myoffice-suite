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


def all_mappings(path):
    mappings = defaultdict(dict)
    with closing(connect_readonly(path)) as db:
        for supplier, code, sku in db.execute("SELECT Supplier, ExternalKey, ErpSku FROM SupplierSkuMappings ORDER BY Supplier, ExternalKey"):
            mappings[supplier][code] = sku
    return mappings


def seed_mappings(path, mappings):
    with closing(sqlite3.connect(path, autocommit=True)) as db:
        db.execute("BEGIN IMMEDIATE")
        count = db.executemany("""
            INSERT INTO SupplierSkuMappings VALUES (?, ?, ?)
            ON CONFLICT(Supplier, ExternalKey) DO NOTHING
        """, mappings).rowcount
        db.execute("COMMIT")
    return count


def save_offer_mappings(path, supplier, changes):
    with closing(sqlite3.connect(path, autocommit=True)) as db:
        db.execute("BEGIN IMMEDIATE")
        count = db.executemany("""
            INSERT INTO SupplierSkuMappings VALUES (?, ?, ?)
            ON CONFLICT(Supplier, ExternalKey) DO UPDATE SET ErpSku = excluded.ErpSku
        """, ((supplier, code, sku) for code, sku in changes.items())).rowcount
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


def catalog_snapshots(path):
    with closing(connect_readonly(path)) as db:
        return {row["Supplier"]: [{**offer, "day": row["EffectiveOn"]} for offer in json.loads(row["RowsJson"])]
                for row in db.execute("SELECT Supplier, EffectiveOn, RowsJson FROM SupplierCatalogs")}


def current_offers(path):
    return offers_by_sku(catalog_snapshots(path))


def offers_by_sku(snapshots):
    offers = {}
    for supplier, rows in snapshots.items():
        by_sku = {}
        for offer in rows:
            sku = offer["erpSku"]
            old = by_sku.get(sku)
            if sku and (old is None or (offer["price"] is not None and (old["price"] is None or offer["price"] < old["price"]))):
                by_sku[sku] = offer
        offers[supplier] = by_sku
    return offers
