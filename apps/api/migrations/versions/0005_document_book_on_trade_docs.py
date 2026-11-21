"""document book on sales and purchase documents

Revision ID: 0005_document_book_on_trade_docs
Revises: 0004_contact_groups
Create Date: 2026-11-08

  * sales_documents.book_id / purchase_documents.book_id (FK document_books.id)

Deposits and credit/debit notes post to GL through their own สมุดบันทึก, which must be
chosen before they can be confirmed. Checks first, since 0001 builds from the live models.
"""
import sqlalchemy as sa
from alembic import op

from models.base import UUIDType

revision = "0005_document_book_on_trade_docs"
down_revision = "0004_contact_groups"
branch_labels = None
depends_on = None

TABLES = ("sales_documents", "purchase_documents")


def upgrade() -> None:
    insp = sa.inspect(op.get_bind())
    for table in TABLES:
        if "book_id" in {c["name"] for c in insp.get_columns(table)}:
            continue
        with op.batch_alter_table(table) as batch:
            batch.add_column(sa.Column("book_id", UUIDType(), nullable=True))
            batch.create_foreign_key(f"fk_{table}_book_id", "document_books", ["book_id"], ["id"])


def downgrade() -> None:
    for table in TABLES:
        with op.batch_alter_table(table) as batch:
            batch.drop_constraint(f"fk_{table}_book_id", type_="foreignkey")
            batch.drop_column("book_id")
