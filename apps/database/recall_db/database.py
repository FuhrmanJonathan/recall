import os
from pathlib import Path

from sqlalchemy import Engine, create_engine, event
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
