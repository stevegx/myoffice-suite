import json
import sqlite3
from collections import Counter
from contextlib import closing
from datetime import date
from hashlib import sha256
from pathlib import Path

from ..database import connect_readonly
from ..payments.workbooks import read_cents


def effective_date(value) -> str:
    if not isinstance(value, str) or len(value) != 10:
        raise ValueError("Επίλεξε ημερομηνία καταγραφής.")
    return date.fromisoformat(value).isoformat()


def save_prices(
    path: Path, day: str, records: list[tuple[str, str, str, int | None]], batch: str | None = None,
    market: list[tuple[str, int | None, str]] | None = None,
    minimums: tuple[str, list[tuple[str, str, int | None]]] | None = None,
    catalog_skus: list[str] | None = None,
) -> int:
    source = "import" if batch else "confirmed"
    with closing(sqlite3.connect(path, autocommit=True)) as connection:
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("BEGIN IMMEDIATE")
        count = 0
        for sku, name, channel, cents in records:
            if cents is not None and batch is None:
                last = connection.execute("""
                    SELECT Cents FROM ProductPrices WHERE Sku = ? AND Channel = ? AND EffectiveOn = ?
                    ORDER BY Id DESC LIMIT 1
                """, (sku, channel, day)).fetchone()
                if last and last[0] == cents:
                    continue
            elif cents is not None and connection.execute(
                "SELECT 1 FROM ProductPrices WHERE Batch = ? AND Sku = ? AND Channel = ?", (batch, sku, channel),
            ).fetchone():
                continue
            connection.execute("""
                INSERT INTO Products (Sku, Name, NameOn) VALUES (?, ?, ?)
                ON CONFLICT(Sku) DO UPDATE SET Name = excluded.Name, NameOn = excluded.NameOn
                WHERE excluded.NameOn >= Products.NameOn
            """, (sku, name, day))
            if cents is None:
                continue
            connection.execute("""
                INSERT INTO ProductPrices (Sku, Channel, EffectiveOn, Cents, Source, Batch)
                VALUES (?, ?, ?, ?, ?, ?)
            """, (sku, channel, day, cents, source, batch))
            count += 1
        if batch is not None:
            connection.executemany("""
                UPDATE Products SET SkroutzName = ?, SkroutzNameOn = ?
                WHERE Sku = ? AND (SkroutzNameOn IS NULL OR SkroutzNameOn <= ?)
            """, ((name, day, sku, day) for sku, name, channel, _ in records if channel == "skroutz"))
        if market is not None:
            connection.executemany("""
                INSERT INTO RepricingMarket (Sku, ObservedOn, Cents, Shop, Batch)
                VALUES (?, ?, ?, ?, ?) ON CONFLICT(Sku, Batch) DO NOTHING
            """, ((sku, day, cents, shop, batch) for sku, cents, shop in market))
        if minimums is not None:
            minimum_day, floors = minimums
            connection.executemany("""
                INSERT INTO ProductMinimums VALUES (?, ?, ?, ?)
                ON CONFLICT(Sku) DO UPDATE SET Name = excluded.Name, Cents = excluded.Cents, ObservedOn = excluded.ObservedOn
                WHERE excluded.ObservedOn >= ProductMinimums.ObservedOn
            """, ((sku, name, cents, minimum_day) for sku, name, cents in floors))
        if catalog_skus:
            connection.execute("""
                INSERT INTO RepricingCatalog VALUES (1, ?, ?)
                ON CONFLICT(Id) DO UPDATE SET ObservedOn = excluded.ObservedOn, SkusJson = excluded.SkusJson
                WHERE excluded.ObservedOn >= RepricingCatalog.ObservedOn
            """, (day, json.dumps(catalog_skus, ensure_ascii=False)))
        connection.execute("COMMIT")
    return count


def record_import(
    path: Path, day: str, raw: bytes, rows: list[dict],
    minimums: tuple[str, list[tuple[str, str, int | None]]] | None = None,
) -> dict:
    duplicates = Counter(row["sku"] for row in rows if row["sku"] not in ("", "---", "#N/A"))
    records = []
    market = []
    valid_prices = 0
    for row in rows:
        sku, name = row["sku"], row["product"]
        if not sku or not name or duplicates[sku] != 1:
            continue
        cents = read_cents(row["our"])
        if cents is None or not 0 < cents <= 999_999_999:
            cents = None
        else:
            valid_prices += 1
        records.append((sku, name, "skroutz", cents))
        cheapest = read_cents(row.get("cheapest"))
        market.append((sku, cheapest if cheapest and 0 < cheapest <= 999_999_999 else None, row.get("shop", "")))
    batch = sha256(day.encode("ascii") + b"\0" + raw).hexdigest()
    saved = save_prices(path, day, records, batch, market, minimums, catalog_skus=list(duplicates))
    return {"enabled": True, "saved": saved, "skipped": len(rows) - valid_prices}


def product_history(path: Path, sku: str) -> dict | None:
    with closing(connect_readonly(path)) as connection:
        product = connection.execute("SELECT Sku AS sku, Name AS name FROM Products WHERE Sku = ?", (sku,)).fetchone()
        if product is None:
            return None
        prices = connection.execute("""
            WITH ordered AS (
                SELECT Id AS id, Channel AS channel, EffectiveOn AS day, Cents AS cents, Source AS source,
                  lag(Cents) OVER (PARTITION BY Channel ORDER BY EffectiveOn, Id) AS previous
                FROM ProductPrices WHERE Sku = ?
            )
            SELECT id, channel, day, cents, source, previous FROM ordered
            WHERE previous IS NULL OR cents <> previous ORDER BY day, id
        """, (sku,))
        return {**dict(product), "prices": [dict(price) for price in prices]}
