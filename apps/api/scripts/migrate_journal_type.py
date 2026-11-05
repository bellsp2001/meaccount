"""
Add journals.journal_type to an existing database.

create_all() only creates missing tables, never missing columns, so databases created before
the five-journal split (สมุดรายวัน 5 เล่ม) need this once. Safe to re-run: it does nothing when
the column already exists. Existing journals become the general journal (GENERAL).

    python scripts/migrate_journal_type.py
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import inspect, text  # noqa: E402

from core.database import engine  # noqa: E402


# Description prefixes the auto-posting services write (services/ar.py, ap.py, pos.py, payroll.py,
# sales.py), so journals created before the column can be sorted into the right book.
BACKFILL = [
    ("Invoice %",       "SALES"),
    ("รับชำระ %",        "RECEIPT"),
    ("ขายหน้าร้าน %",    "RECEIPT"),
    ("รับเงินมัดจำ %",   "RECEIPT"),
    ("Bill %",          "PURCHASE"),
    ("จ่ายชำระ %",       "PAYMENT"),
    ("จ่ายเงินเดือน %",  "PAYMENT"),
]


def backfill(conn) -> None:
    for pattern, jtype in BACKFILL:
        n = conn.execute(
            text("UPDATE journals SET journal_type = :t WHERE journal_type = 'GENERAL' AND description LIKE :p"),
            {"t": jtype, "p": pattern},
        ).rowcount
        print(f"  {jtype:<8} {n:>4}  ← {pattern}")


def main() -> None:
    cols = {c["name"] for c in inspect(engine).get_columns("journals")}
    added = "journal_type" not in cols
    with engine.begin() as conn:
        if added:
            # Enum is stored by member name, matching models.accounting.JournalType.
            conn.execute(text("ALTER TABLE journals ADD COLUMN journal_type VARCHAR(8) NOT NULL DEFAULT 'GENERAL'"))
            conn.execute(text("CREATE INDEX IF NOT EXISTS ix_journals_journal_type ON journals (journal_type)"))
            print("added journals.journal_type")
        # Only on first run (or when asked): later manual journals may reuse these words on purpose.
        if added or "--backfill" in sys.argv:
            print("classifying existing auto-posted journals:")
            backfill(conn)
        else:
            print("journals.journal_type already exists — nothing to do (pass --backfill to re-classify)")


if __name__ == "__main__":
    main()
