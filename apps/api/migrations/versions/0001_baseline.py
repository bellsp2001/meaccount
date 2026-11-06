"""baseline — the full schema as of the move to Alembic

Revision ID: 0001_baseline
Revises:
Create Date: 2026-11-05

Until now the schema was created by Base.metadata.create_all() at startup, plus two one-off
scripts (scripts/migrate_journal_type.py, scripts/migrate_document_book_links.py). This revision
builds that same schema from the models, so:

  * a NEW database:      alembic upgrade head        (creates everything)
  * an EXISTING database that already has the tables (e.g. the dev SQLite file after the two
    scripts above):      alembic stamp 0001_baseline (records it as up to date, changes nothing)

Every later change must be its own revision with explicit op.* calls — never edit this file,
because databases already stamped at 0001 would never see the edit.
"""
from alembic import op

from core.database import Base
import models.registry  # noqa: F401 — register every table on Base.metadata

revision = "0001_baseline"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # checkfirst (the default) makes this a no-op for tables that already exist.
    Base.metadata.create_all(bind=op.get_bind())


def downgrade() -> None:
    Base.metadata.drop_all(bind=op.get_bind())
