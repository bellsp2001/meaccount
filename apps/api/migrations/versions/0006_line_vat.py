"""per-line VAT on document items

Revision ID: 0006_line_vat
Revises: 0005_document_book_on_trade_docs
Create Date: 2026-11-08

  * tax_code_id (FK tax_codes.id) and vat_rate on sales_document_items, purchase_document_items,
    invoice_items and bill_items

Each line picks its own ประเภทภาษี (VAT); existing lines keep null and use their document's rate.
Checks first, since 0001 builds from the live models.
"""
import sqlalchemy as sa
from alembic import op

from models.base import UUIDType

revision = "0006_line_vat"
down_revision = "0005_document_book_on_trade_docs"
branch_labels = None
depends_on = None

TABLES = ("sales_document_items", "purchase_document_items", "invoice_items", "bill_items")


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    for table in TABLES:
        cols = {c["name"] for c in insp.get_columns(table)}
        with op.batch_alter_table(table) as batch:
            if "tax_code_id" not in cols:
                batch.add_column(sa.Column("tax_code_id", UUIDType(), nullable=True))
                batch.create_foreign_key(f"fk_{table}_tax_code_id", "tax_codes", ["tax_code_id"], ["id"])
            if "vat_rate" not in cols:
                batch.add_column(sa.Column("vat_rate", sa.Numeric(5, 2), nullable=True))


def downgrade() -> None:
    for table in TABLES:
        with op.batch_alter_table(table) as batch:
            batch.drop_constraint(f"fk_{table}_tax_code_id", type_="foreignkey")
            batch.drop_column("tax_code_id")
            batch.drop_column("vat_rate")
