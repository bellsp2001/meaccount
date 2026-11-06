"""
Add invoices.book_id and bills.book_id (สมุดบันทึก) to an existing database.

create_all() creates the document_books table on API start but never adds columns to existing
tables, so databases created earlier need this once. Safe to re-run. Existing documents keep a
NULL book and post exactly as before.

    python scripts/migrate_document_book_links.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import inspect, text  # noqa: E402

from core.database import engine  # noqa: E402
import models.registry  # noqa: E402,F401 — so document_books exists before the FK points at it
from core.database import Base  # noqa: E402


def main() -> None:
    Base.metadata.create_all(bind=engine)  # document_books, if the API hasn't created it yet
    insp = inspect(engine)
    with engine.begin() as conn:
        for table in ("invoices", "bills"):
            if "book_id" in {c["name"] for c in insp.get_columns(table)}:
                print(f"{table}.book_id already exists")
                continue
            # Same storage as models.base.UUIDType: native UUID on PostgreSQL, CHAR(36) elsewhere.
            col = "UUID" if engine.dialect.name == "postgresql" else "CHAR(36)"
            conn.execute(text(f"ALTER TABLE {table} ADD COLUMN book_id {col} REFERENCES document_books(id)"))
            conn.execute(text(f"CREATE INDEX IF NOT EXISTS ix_{table}_book_id ON {table} (book_id)"))
            print(f"added {table}.book_id")


if __name__ == "__main__":
    main()
