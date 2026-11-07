"""trade documents — sales credit/debit notes and the purchase document set

Revision ID: 0002_trade_documents
Revises: 0001_baseline
Create Date: 2026-11-07

  * sales_documents gains invoice_id + reason (credit/debit notes adjust an invoice)
  * salesdoctype gains CREDIT_NOTE / DEBIT_NOTE (PostgreSQL native enum only)
  * new tables purchase_documents + purchase_document_items

Each step checks first: 0001 builds from the live models, so a database created fresh at
0001 already has all of this and this revision must then change nothing.
"""
import sqlalchemy as sa
from alembic import op

from models.base import UUIDType
import models.registry  # noqa: F401 — register every table on Base.metadata
from core.database import Base

revision = "0002_trade_documents"
down_revision = "0001_baseline"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = sa.inspect(bind)

    if bind.dialect.name == "postgresql":
        # Enum values are stored by member name.
        for value in ("CREDIT_NOTE", "DEBIT_NOTE"):
            op.execute(f"ALTER TYPE salesdoctype ADD VALUE IF NOT EXISTS '{value}'")

    cols = {c["name"] for c in insp.get_columns("sales_documents")}
    with op.batch_alter_table("sales_documents") as batch:
        if "invoice_id" not in cols:
            batch.add_column(sa.Column("invoice_id", UUIDType(), nullable=True))
            batch.create_foreign_key("fk_sales_documents_invoice_id", "invoices", ["invoice_id"], ["id"])
            batch.create_index("ix_sales_documents_invoice_id", ["invoice_id"])
        if "reason" not in cols:
            batch.add_column(sa.Column("reason", sa.String(500), nullable=True))

    tables = [Base.metadata.tables[n] for n in ("purchase_documents", "purchase_document_items")]
    Base.metadata.create_all(bind=bind, tables=tables)  # checkfirst


def downgrade() -> None:
    op.drop_table("purchase_document_items")
    op.drop_table("purchase_documents")
    with op.batch_alter_table("sales_documents") as batch:
        batch.drop_index("ix_sales_documents_invoice_id")
        batch.drop_constraint("fk_sales_documents_invoice_id", type_="foreignkey")
        batch.drop_column("reason")
        batch.drop_column("invoice_id")
    # PostgreSQL cannot drop enum values; CREDIT_NOTE / DEBIT_NOTE stay on salesdoctype.
