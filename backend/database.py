import sqlite3
from contextlib import closing
from pathlib import Path

SCHEMA_VERSION = 12


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

        if version < 5:
            connection.execute(
                "INSERT INTO Tools VALUES (?, ?, ?) ON CONFLICT(Id) DO NOTHING",
                ("converter", "CSV ↔ Excel", "Μετατροπή αρχείων με επιλογή φύλλου και διαχωριστικού."),
            )
            connection.execute("PRAGMA user_version = 5")

        if version < 6:
            connection.execute(
                "INSERT INTO Tools VALUES (?, ?, ?) ON CONFLICT(Id) DO NOTHING",
                ("price-calculator", "Price Calculator", "Υπολογισμός ελάχιστης τιμής Skroutz ή μέγιστης τιμής αγοράς με επιλογή ΦΠΑ."),
            )
            connection.execute("PRAGMA user_version = 6")

        if version < 7:
            connection.execute("""
                CREATE TABLE RepricingMarket (
                    Id INTEGER PRIMARY KEY,
                    Sku TEXT NOT NULL,
                    ObservedOn TEXT NOT NULL,
                    Cents INTEGER CHECK (Cents > 0),
                    Shop TEXT NOT NULL,
                    Batch TEXT NOT NULL,
                    UNIQUE (Sku, Batch)
                )
            """)
            connection.execute("CREATE INDEX RepricingMarket_latest ON RepricingMarket (Sku, ObservedOn, Id)")
            connection.execute(
                "INSERT INTO Tools VALUES (?, ?, ?) ON CONFLICT(Id) DO NOTHING",
                ("orders", "Παραγγελίες", "Σύγκριση τιμών προμηθευτών και ετοιμασία παραγγελίας ανά SKU."),
            )
            connection.execute("PRAGMA user_version = 7")

        if version < 8:
            connection.execute("""
                CREATE TABLE SupplierCatalogs (
                    Supplier TEXT PRIMARY KEY,
                    Revision INTEGER NOT NULL,
                    EffectiveOn TEXT NOT NULL,
                    Filename TEXT NOT NULL,
                    RowsJson TEXT NOT NULL
                )
            """)
            connection.execute("""
                CREATE TABLE SupplierSkuMappings (
                    Supplier TEXT NOT NULL,
                    ExternalKey TEXT NOT NULL,
                    ErpSku TEXT NOT NULL,
                    PRIMARY KEY (Supplier, ExternalKey)
                )
            """)
            connection.execute(
                "INSERT INTO Tools VALUES (?, ?, ?) ON CONFLICT(Id) DO NOTHING",
                ("supplier-catalogs", "Κατάλογοι προμηθευτών", "Έλεγχος αντιστοιχίσεων και ενημέρωση τιμών για τις Παραγγελίες."),
            )
            connection.execute("PRAGMA user_version = 8")

        if version < 9:
            connection.execute("""
                CREATE TABLE ErpOrderProducts (
                    Sku TEXT PRIMARY KEY,
                    ProductJson TEXT NOT NULL
                )
            """)
            connection.execute("PRAGMA user_version = 9")

        if version < 10:
            connection.execute("""
                CREATE TABLE ProductMinimums (
                    Sku TEXT PRIMARY KEY,
                    Name TEXT NOT NULL,
                    Cents INTEGER CHECK (Cents > 0),
                    ObservedOn TEXT NOT NULL
                )
            """)
            connection.execute("""
                CREATE TABLE ProductOptimizerPrices (
                    Sku TEXT PRIMARY KEY,
                    Units INTEGER NOT NULL CHECK (Units > 0)
                )
            """)
            connection.execute(
                "UPDATE Tools SET Description = ? WHERE Id = 'products'",
                ("Κεντρική καρτέλα SKU με τιμές ERP, προσφορές προμηθευτών και ιστορικό Skroutz.",),
            )
            connection.execute("PRAGMA user_version = 10")

        if version < 11:
            connection.execute("ALTER TABLE Products ADD COLUMN SkroutzName TEXT")
            connection.execute("ALTER TABLE Products ADD COLUMN SkroutzNameOn TEXT")
            connection.execute("PRAGMA user_version = 11")

        if version < 12:
            connection.execute("ALTER TABLE ErpOrderProducts ADD COLUMN Active INTEGER NOT NULL DEFAULT 1")
            connection.execute("""
                CREATE TABLE RepricingCatalog (
                    Id INTEGER PRIMARY KEY CHECK (Id = 1),
                    ObservedOn TEXT NOT NULL,
                    SkusJson TEXT NOT NULL
                )
            """)
            connection.execute("""
                INSERT INTO RepricingCatalog
                SELECT 1, max(ObservedOn), json_group_array(DISTINCT Sku)
                FROM RepricingMarket
                WHERE Batch = (SELECT Batch FROM RepricingMarket ORDER BY ObservedOn DESC, Id DESC LIMIT 1)
                HAVING count(*) > 0
            """)
            connection.execute("""
                INSERT INTO RepricingCatalog
                SELECT 1, max(EffectiveOn), json_group_array(DISTINCT Sku)
                FROM ProductPrices
                WHERE NOT EXISTS (SELECT 1 FROM RepricingCatalog)
                  AND Batch = (SELECT Batch FROM ProductPrices
                               WHERE Source = 'import' AND Channel = 'skroutz'
                               ORDER BY EffectiveOn DESC, Id DESC LIMIT 1)
                HAVING count(*) > 0
            """)
            connection.execute("PRAGMA user_version = 12")

        connection.execute("COMMIT")


def connect_readonly(path: Path) -> sqlite3.Connection:
    connection = sqlite3.connect(f"{path.as_uri()}?mode=ro", uri=True, autocommit=True)
    connection.row_factory = sqlite3.Row
    return connection
