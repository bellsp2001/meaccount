"""VAT-inclusive prices on documents

Revision ID: 0007_vat_inclusive
Revises: 0006_line_vat
Create Date: 2026-11-09

  * vat_inclusive (bool, default false) on sales_documents, purchase_documents, invoices and bills

True = the line amounts already include VAT (ราคารวม VAT); existing documents stay VAT-exclusive.
Checks first, since 0001 builds from the live models.
"""
import sqlalchemy as sa
from alembic import op

revision = "0007_vat_inclusive"
down_revision = "0006_line_vat"
branch_labels = None
depends_on = None

TABLES = ("sales_documents", "purchase_documents", "invoices", "bills")


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    for table in TABLES:
        if "vat_inclusive" not in {c["name"] for c in insp.get_columns(table)}:
            with op.batch_alter_table(table) as batch:
                batch.add_column(sa.Column("vat_inclusive", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    for table in TABLES:
        with op.batch_alter_table(table) as batch:
            batch.drop_column("vat_inclusive")
