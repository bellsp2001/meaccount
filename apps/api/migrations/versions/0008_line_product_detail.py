"""product link and คำอธิบาย on document lines

Revision ID: 0008_line_product_detail
Revises: 0007_vat_inclusive
Create Date: 2026-11-09

  * product_id (FK products.id) and detail (text) on sales_document_items, purchase_document_items,
    invoice_items and bill_items

A line's description stays its item name (picked from สินค้า/บริการ or typed); detail is the
optional คำอธิบาย under it. Checks first, since 0001 builds from the live models.
"""
import sqlalchemy as sa
from alembic import op

from models.base import UUIDType

revision = "0008_line_product_detail"
down_revision = "0007_vat_inclusive"
branch_labels = None
depends_on = None

TABLES = ("sales_document_items", "purchase_document_items", "invoice_items", "bill_items")


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    for table in TABLES:
        cols = {c["name"] for c in insp.get_columns(table)}
        with op.batch_alter_table(table) as batch:
            if "product_id" not in cols:
                batch.add_column(sa.Column("product_id", UUIDType(), nullable=True))
                batch.create_foreign_key(f"fk_{table}_product_id", "products", ["product_id"], ["id"])
            if "detail" not in cols:
                batch.add_column(sa.Column("detail", sa.Text(), nullable=True))


def downgrade() -> None:
    for table in TABLES:
        with op.batch_alter_table(table) as batch:
            batch.drop_constraint(f"fk_{table}_product_id", type_="foreignkey")
            batch.drop_column("product_id")
            batch.drop_column("detail")
