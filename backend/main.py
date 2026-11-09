import os
import sqlite3
from contextlib import asynccontextmanager, closing
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from .converter import router as converter_router

from .database import connect_readonly, initialize
from .payments.routes import router as payments_router
from .products.routes import router as products_router
from .repricing.routes import router as repricing_router

BACKEND_DIR = Path(__file__).resolve().parent
FRONTEND_DIST = BACKEND_DIR.parent / "frontend" / "dist"
DEFAULT_DB = BACKEND_DIR / "data" / "myoffice.db"
LEGACY_DB = BACKEND_DIR / "MyOffice.Api" / "App_Data" / "myoffice.db"


def database_path() -> Path:
    configured_path = os.environ.get("MYOFFICE_DB_PATH")
    if configured_path:
        return Path(configured_path).expanduser().resolve()
    if DEFAULT_DB.exists() or not LEGACY_DB.is_file():
        return DEFAULT_DB
    return LEGACY_DB


db_path = database_path()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    initialize(db_path)
    yield


app = FastAPI(title="MyOffice Suite", lifespan=lifespan)
app.state.db_path = db_path
app.state.product_history_enabled = os.environ.get("MYOFFICE_PRODUCT_HISTORY", "1") == "1"
app.include_router(payments_router)
app.include_router(repricing_router)
app.include_router(products_router)
app.include_router(converter_router)


@app.get("/api/tools")
def list_tools() -> list[dict[str, str]]:
    with closing(connect_readonly(db_path)) as connection:
        rows = connection.execute("""
            SELECT Id AS id, Name AS name, Description AS description
            FROM Tools
            ORDER BY Name
        """)
        return [dict(row) for row in rows]


@app.get("/api/status")
def system_status() -> dict[str, bool]:
    try:
        with closing(connect_readonly(db_path)) as connection:
            connection.execute("SELECT 1 FROM Tools LIMIT 1").fetchone()
    except sqlite3.Error:
        return {"databaseAvailable": False}
    return {"databaseAvailable": True}


if (FRONTEND_DIST / "index.html").is_file():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
