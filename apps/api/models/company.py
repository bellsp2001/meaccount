"""
Multi-Company Models: Company, CompanyGroup, IntercompanyTransaction

Design note: rather than adding a company_id column to every existing table
(a large, risky migration touching 20+ models), this sprint introduces the
Company/Group/Intercompany layer as new tables and adds company scoping via
a `company_id` column ONLY on the tables where cross-company mixing would be
a real correctness problem for THIS sprint's feature set — Journal (so
consolidated GL reporting can filter cleanly) and the new Intercompany model.
Fully scoping every existing table (AR, AP, Inventory, Payroll, ...) to
company_id is real, necessary work but is a much bigger migration than one
sprint — flagging this explicitly rather than silently doing a partial job
and calling it "multi-tenant."
"""
import enum
from sqlalchemy import Column, String, Numeric, Boolean, ForeignKey, Text, Date, DateTime
from datetime import datetime
from sqlalchemy.orm import relationship
from core.database import Base
from models.base import UUIDMixin, TimestampMixin, UUIDType


class IntercompanyStatus(str, enum.Enum):
    DRAFT     = "draft"
    POSTED    = "posted"
    RECONCILED= "reconciled"


# ── Company ────────────────────────────────────────────────────
class Company(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "companies"

    code            = Column(String(20),  nullable=False, unique=True, index=True)
    name            = Column(String(255), nullable=False)
    name_en         = Column(String(255), nullable=True)
    tax_id          = Column(String(20),  nullable=True)
    address         = Column(Text,        nullable=True)
    is_active       = Column(Boolean,     default=True)

    parent_company_id = Column(UUIDType(), ForeignKey("companies.id"), nullable=True)
    ownership_pct      = Column(Numeric(5,2), nullable=True)   # % ownership by parent (for consolidation)

    parent   = relationship("Company", remote_side="Company.id", backref="subsidiaries")


# ── CompanyUser (which users can access which companies) ───────
class CompanyUser(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "company_users"

    company_id = Column(UUIDType(), ForeignKey("companies.id"), nullable=False)
    user_id    = Column(UUIDType(), ForeignKey("users.id"), nullable=False)
    is_default = Column(Boolean, default=False)   # default company to load on login

    company = relationship("Company")
    user    = relationship("User")


# ── IntercompanyTransaction ──────────────────────────────────────
class IntercompanyTransaction(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "intercompany_transactions"

    number             = Column(String(30), nullable=False, unique=True, index=True)
    from_company_id    = Column(UUIDType(), ForeignKey("companies.id"), nullable=False)
    to_company_id      = Column(UUIDType(), ForeignKey("companies.id"), nullable=False)
    date               = Column(Date, nullable=False)
    description         = Column(String(500), nullable=False)
    amount              = Column(Numeric(18,2), nullable=False)
    status              = Column(String(20), default=IntercompanyStatus.DRAFT.value, nullable=False)

    # Links to the journal entries created in each company's books
    from_journal_id     = Column(UUIDType(), ForeignKey("journals.id"), nullable=True)
    to_journal_id        = Column(UUIDType(), ForeignKey("journals.id"), nullable=True)

    created_by           = Column(UUIDType(), ForeignKey("users.id"), nullable=True)

    from_company = relationship("Company", foreign_keys=[from_company_id])
    to_company   = relationship("Company", foreign_keys=[to_company_id])
