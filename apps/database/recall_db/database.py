import os
from pathlib import Path

from sqlalchemy import Engine, create_engine, event, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker


DATABASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DATABASE_URL = f"sqlite:///{DATABASE_DIR / 'recall.db'}"


class Base(DeclarativeBase):
    #Base class shared by all SQLAlchemy models
    pass


def create_database_engine(database_url: str | None = None) -> Engine:
    #Create an engine for SQLite foreign-key enforcement
    url = database_url or os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)
    connect_args = {"check_same_thread": False} if url.startswith("sqlite") else {}
    engine = create_engine(url, connect_args=connect_args)

    if url.startswith("sqlite"):

        @event.listens_for(engine, "connect")
        def enable_sqlite_foreign_keys(dbapi_connection, _connection_record) -> None:
            cursor = dbapi_connection.cursor()
            cursor.execute("PRAGMA foreign_keys=ON")
            cursor.close()

    return engine


engine = create_database_engine()
SessionLocal = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)


def create_tables(target_engine: Engine = engine) -> None:
    #Create every table registered on the shared metadata
    from recall_db import models  # noqa: F401

    Base.metadata.create_all(target_engine)
    _add_missing_columns(target_engine)


# create_all() never alters tables that already exist, so columns added after the
# first release are added here for databases created before them (SQLite only).
_ADDED_COLUMNS: dict[str, dict[str, str]] = {
    "flashcards": {"needs_review": "BOOLEAN NOT NULL DEFAULT 0"},
}


def _add_missing_columns(target_engine: Engine) -> None:
    if target_engine.dialect.name != "sqlite":
        return
    inspector = inspect(target_engine)
    with target_engine.begin() as connection:
        for table, columns in _ADDED_COLUMNS.items():
            if not inspector.has_table(table):
                continue
            existing = {column["name"] for column in inspector.get_columns(table)}
            for name, ddl in columns.items():
                if name not in existing:
                    connection.execute(text(f'ALTER TABLE "{table}" ADD COLUMN "{name}" {ddl}'))
