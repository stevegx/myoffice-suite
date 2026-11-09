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


def save_prices(path: Path, day: str, records: list[tuple[str, str, str, int | None]], batch: str | None = None) -> int:
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
                INSERT INTO Products VALUES (?, ?, ?)
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
        connection.execute("COMMIT")
    return count


def record_import(path: Path, day: str, raw: bytes, rows: list[dict]) -> dict:
    duplicates = Counter(row["sku"] for row in rows if row["sku"])
    records = []
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
    batch = sha256(day.encode("ascii") + b"\0" + raw).hexdigest()
    return {"enabled": True, "saved": save_prices(path, day, records, batch), "skipped": len(rows) - valid_prices}


def list_products(path: Path, query: str, page: int) -> dict:
    size = 30
    where = "WHERE instr(casefold(Sku), ?) > 0 OR instr(casefold(Name), ?) > 0"
    search = query.strip().casefold()
    with closing(connect_readonly(path)) as connection:
        connection.create_function("casefold", 1, str.casefold, deterministic=True)
        total = connection.execute(f"SELECT count(*) FROM Products {where}", (search, search)).fetchone()[0]
        rows = connection.execute(f"""
            SELECT Sku AS sku, Name AS name,
              (SELECT Cents FROM ProductPrices WHERE Sku = p.Sku AND Channel = 'skroutz'
               ORDER BY EffectiveOn DESC, Id DESC LIMIT 1) AS skroutz,
              (SELECT Cents FROM ProductPrices WHERE Sku = p.Sku AND Channel = 'site'
               ORDER BY EffectiveOn DESC, Id DESC LIMIT 1) AS site
            FROM Products p {where}
            ORDER BY (instr(casefold(Sku), ?) = 1) DESC, Sku LIMIT ? OFFSET ?
        """, (search, search, search, size, (page - 1) * size))
        return {"items": [dict(row) for row in rows], "total": total, "pageSize": size}


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
