"""Run once to add sharing fields to an existing Recall database.

Back up your database before applying schema changes.
"""
from sqlalchemy import inspect, text
from recall_db.database import engine

with engine.begin() as conn:
    inspector = inspect(conn)
    existing = {col["name"] for col in inspector.get_columns("decks")}
    dialect = conn.dialect.name
    if "is_public" not in existing:
        public_type = "BOOLEAN" if dialect != "sqlite" else "INTEGER"
        conn.execute(text(f"ALTER TABLE decks ADD COLUMN is_public {public_type} NOT NULL DEFAULT 0"))
    if "description" not in existing:
        conn.execute(text("ALTER TABLE decks ADD COLUMN description TEXT NOT NULL DEFAULT ''"))
    if "subject" not in existing:
        conn.execute(text("ALTER TABLE decks ADD COLUMN subject VARCHAR(100) NOT NULL DEFAULT ''"))
print("Deck sharing columns available.")
