"""contact groups — customer type groups for contacts

Revision ID: 0004_contact_groups
Revises: 0003_contacts
Create Date: 2026-11-07

  * new table contact_groups
  * contacts.group_id (FK contact_groups.id)

Each step checks first: 0001 and 0003 build from the live models, so a fresh
database already has both.
"""
import sqlalchemy as sa
from alembic import op

from models.base import UUIDType
import models.registry  # noqa: F401 — register every table on Base.metadata
from core.database import Base

revision = "0004_contact_groups"
down_revision = "0003_contacts"
branch_labels = None
depends_on = None


def upgrade() -> None:
    bind = op.get_bind()
    Base.metadata.create_all(bind=bind, tables=[Base.metadata.tables["contact_groups"]])  # checkfirst

    if "group_id" not in {c["name"] for c in sa.inspect(bind).get_columns("contacts")}:
        with op.batch_alter_table("contacts") as batch:
            batch.add_column(sa.Column("group_id", UUIDType(), nullable=True))
            batch.create_foreign_key("fk_contacts_group_id", "contact_groups", ["group_id"], ["id"])
            batch.create_index("ix_contacts_group_id", ["group_id"])


def downgrade() -> None:
    with op.batch_alter_table("contacts") as batch:
        batch.drop_index("ix_contacts_group_id")
        batch.drop_constraint("fk_contacts_group_id", type_="foreignkey")
        batch.drop_column("group_id")
    op.drop_table("contact_groups")
