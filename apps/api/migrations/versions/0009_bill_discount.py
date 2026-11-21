"""bill discount (ส่วนลดท้ายบิล) on documents

Revision ID: 0009_bill_discount
Revises: 0008_line_product_detail
Create Date: 2026-11-10

  * discount_value, discount_is_pct and discount_amount on sales_documents, purchase_documents,
    invoices and bills

The discount comes off the lines before VAT; existing documents have none.
Checks first, since 0001 builds from the live models.
"""
import sqlalchemy as sa
from alembic import op

revision = "0009_bill_discount"
down_revision = "0008_line_product_detail"
branch_labels = None
depends_on = None

TABLES = ("sales_documents", "purchase_documents", "invoices", "bills")


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    for table in TABLES:
        cols = {c["name"] for c in insp.get_columns(table)}
        with op.batch_alter_table(table) as batch:
            if "discount_value" not in cols:
                batch.add_column(sa.Column("discount_value", sa.Numeric(18, 2), nullable=False, server_default="0"))
            if "discount_is_pct" not in cols:
                batch.add_column(sa.Column("discount_is_pct", sa.Boolean(), nullable=False, server_default=sa.false()))
            if "discount_amount" not in cols:
                batch.add_column(sa.Column("discount_amount", sa.Numeric(18, 2), nullable=False, server_default="0"))


def downgrade() -> None:
    for table in TABLES:
        with op.batch_alter_table(table) as batch:
            batch.drop_column("discount_value")
            batch.drop_column("discount_is_pct")
            batch.drop_column("discount_amount")
