"""contacts — one partner record behind customers and suppliers

Revision ID: 0003_contacts
Revises: 0002_trade_documents
Create Date: 2026-11-07

  * new table contacts
  * customers.contact_id / suppliers.contact_id (unique, FK contacts.id)
  * backfill: every existing customer and supplier is linked to a contact; a supplier
    with the same tax ID + branch as a customer (or the same name when neither has a
    tax ID) joins that customer's contact

Each schema step checks first, since 0001 builds from the live models.
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.orm import Session

from models.base import UUIDType
import models.registry  # noqa: F401 — register every table on Base.metadata
from core.database import Base

revision = "0003_contacts"
down_revision = "0002_trade_documents"
branch_labels = None
depends_on = None

ROLE_TABLES = ("customers", "suppliers")


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind, tables=[Base.metadata.tables["contacts"]])  # checkfirst

    insp = sa.inspect(bind)
    for table in ROLE_TABLES:
        if "contact_id" in {c["name"] for c in insp.get_columns(table)}:
            continue
        with op.batch_alter_table(table) as batch:
            batch.add_column(sa.Column("contact_id", UUIDType(), nullable=True))
            batch.create_foreign_key(f"fk_{table}_contact_id", "contacts", ["contact_id"], ["id"])
            batch.create_unique_constraint(f"uq_{table}_contact_id", ["contact_id"])

    from services.contacts import backfill_contacts
    session = Session(bind=bind)
    backfill_contacts(session)
    session.flush()


def downgrade() -> None:
    for table in ROLE_TABLES:
        with op.batch_alter_table(table) as batch:
            batch.drop_constraint(f"uq_{table}_contact_id", type_="unique")
            batch.drop_constraint(f"fk_{table}_contact_id", type_="foreignkey")
            batch.drop_column("contact_id")
    op.drop_table("contacts")
