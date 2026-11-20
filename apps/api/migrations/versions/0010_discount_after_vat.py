"""bill discount before or after VAT

Revision ID: 0010_discount_after_vat
Revises: 0009_bill_discount
Create Date: 2026-11-11

  * discount_after_vat on sales_documents, purchase_documents, invoices and bills

False (the default, and every existing document) = the discount comes off the lines before VAT;
True = VAT is on the full lines and the discount comes off the total.
Checks first, since 0001 builds from the live models.
"""
import sqlalchemy as sa
from alembic import op

revision = "0010_discount_after_vat"
down_revision = "0009_bill_discount"
branch_labels = None
depends_on = None

TABLES = ("sales_documents", "purchase_documents", "invoices", "bills")


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    for table in TABLES:
        if "discount_after_vat" in {c["name"] for c in insp.get_columns(table)}:
            continue
        with op.batch_alter_table(table) as batch:
            batch.add_column(sa.Column("discount_after_vat", sa.Boolean(), nullable=False, server_default=sa.false()))


def downgrade() -> None:
    for table in TABLES:
        with op.batch_alter_table(table) as batch:
            batch.drop_column("discount_after_vat")
