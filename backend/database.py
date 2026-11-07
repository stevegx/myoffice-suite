import sqlite3
from contextlib import closing
from pathlib import Path

SCHEMA_VERSION = 4


def initialize(path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with closing(sqlite3.connect(path, autocommit=True)) as connection:
        connection.execute("BEGIN IMMEDIATE")
        version = connection.execute("PRAGMA user_version").fetchone()[0]
        if version > SCHEMA_VERSION:
            raise RuntimeError(f"Unsupported MyOffice database version {version}")

        if version == 0:
            connection.execute("""
                CREATE TABLE IF NOT EXISTS Tools (
                    Id TEXT PRIMARY KEY NOT NULL,
                    Name TEXT NOT NULL,
                    Description TEXT NOT NULL
                )
            """)
            connection.execute(
                """
                INSERT INTO Tools (Id, Name, Description) VALUES (?, ?, ?)
                ON CONFLICT(Id) DO NOTHING
                """,
                (
                    "system-status",
                    "Κατάσταση συστήματος",
                    "Έλεγχος σύνδεσης με το API και την τοπική βάση δεδομένων.",
                ),
            )
            connection.execute("PRAGMA user_version = 1")

        if version < 2:
            connection.execute(
                """
                INSERT INTO Tools (Id, Name, Description) VALUES (?, ?, ?)
                ON CONFLICT(Id) DO NOTHING
                """,
                ("payments", "Πληρωμές", "Αντιστοίχιση πληρωμών Skroutz με κωδικούς πελατών ERP."),
            )
            connection.execute("PRAGMA user_version = 2")

        if version < 3:
            connection.execute(
                "INSERT INTO Tools VALUES (?, ?, ?) ON CONFLICT(Id) DO NOTHING",
                ("repricing", "Repricing", "Έλεγχος τιμών και εξαγωγή αλλαγών για Skroutz και site."),
            )
            connection.execute("PRAGMA user_version = 3")

        if version < 4:
            connection.execute("""
                CREATE TABLE Products (
                    Sku TEXT PRIMARY KEY NOT NULL,
                    Name TEXT NOT NULL,
                    NameOn TEXT NOT NULL
                )
            """)
            connection.execute("""
                CREATE TABLE ProductPrices (
                    Id INTEGER PRIMARY KEY,
                    Sku TEXT NOT NULL REFERENCES Products(Sku),
                    Channel TEXT NOT NULL CHECK (Channel IN ('skroutz', 'site')),
                    EffectiveOn TEXT NOT NULL,
                    Cents INTEGER NOT NULL CHECK (Cents > 0),
                    Source TEXT NOT NULL CHECK (Source IN ('import', 'confirmed')),
                    Batch TEXT,
                    UNIQUE (Batch, Sku, Channel)
                )
            """)
            connection.execute("CREATE INDEX ProductPrices_history ON ProductPrices (Sku, Channel, EffectiveOn, Id)")
            connection.execute(
                "INSERT INTO Tools VALUES (?, ?, ?) ON CONFLICT(Id) DO NOTHING",
                ("products", "Προϊόντα", "Κατάλογος SKU και ιστορικό τιμών ανά κανάλι."),
            )
            connection.execute("PRAGMA user_version = 4")

        connection.execute("COMMIT")


def connect_readonly(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True, autocommit=True)
    connection.row_factory = sqlite3.Row
    return connection
