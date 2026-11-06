"""
Sales module — pre-invoice sales documents (Quotation, Sales Order, Deposit).

These share one table (SalesDocument) with a `doc_type` discriminator because
they carry identical structure (customer + line items + totals) and flow into
one another: Quotation → Sales Order → Invoice. Deposits are standalone docs
that post an advance-received liability to GL.

The actual Invoice / Payment (Tax Invoice / Receipt) live in models.ar — those
stay authoritative; this module only handles the documents that precede them.
"""
import enum
from sqlalchemy import (Column, String, Numeric, Boolean, Enum, ForeignKey,
                        Text, Date, Integer)
from sqlalchemy.orm import relationship
from core.database import Base
from models.base import UUIDMixin, TimestampMixin, UUIDType


class SalesDocType(str, enum.Enum):
    QUOTATION   = "quotation"      # ใบเสนอราคา
    SALES_ORDER = "sales_order"    # คำสั่งขาย
    DEPOSIT     = "deposit"        # ใบมัดจำ


class SalesDocStatus(str, enum.Enum):
    DRAFT     = "draft"
    SENT      = "sent"
    ACCEPTED  = "accepted"    # quotation accepted / SO confirmed / deposit received
    CONVERTED = "converted"   # rolled forward into the next-stage document
    CANCELLED = "cancelled"
    EXPIRED   = "expired"


class SalesDocument(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "sales_documents"

    number         = Column(String(30),    nullable=False, unique=True, index=True)
    doc_type       = Column(Enum(SalesDocType), nullable=False, index=True)
    customer_id    = Column(UUIDType(),    ForeignKey("customers.id"), nullable=False)
    date           = Column(Date,          nullable=False, index=True)
    valid_until    = Column(Date,          nullable=True)   # quotation validity / SO delivery / deposit due
    status         = Column(Enum(SalesDocStatus), default=SalesDocStatus.DRAFT, nullable=False)
    subtotal       = Column(Numeric(18,2), default=0)
    vat_rate       = Column(Numeric(5,2),  default=7)
    vat_amount     = Column(Numeric(18,2), default=0)
    total          = Column(Numeric(18,2), default=0)
    deposit_amount = Column(Numeric(18,2), default=0)       # amount received for deposit docs
    note           = Column(Text,          nullable=True)
    gl_posted      = Column(Boolean,       default=False)   # deposit → advance-received GL entry
    gl_journal_id  = Column(UUIDType(),    ForeignKey("journals.id"), nullable=True)
    # Conversion tracking — where this doc rolled forward to, and where it came from
    converted_to_type = Column(String(30), nullable=True)  # 'sales_order' | 'invoice'
    converted_to_id   = Column(UUIDType(), nullable=True)
    source_doc_id     = Column(UUIDType(), ForeignKey("sales_documents.id"), nullable=True)
    created_by     = Column(UUIDType(),    ForeignKey("users.id"), nullable=True)

    customer   = relationship("Customer")
    items      = relationship("SalesDocumentItem", back_populates="document",
                              cascade="all, delete-orphan", lazy="joined",
                              order_by="SalesDocumentItem.sequence")
    creator    = relationship("User", foreign_keys=[created_by])
    gl_journal = relationship("Journal", foreign_keys=[gl_journal_id])


class SalesDocumentItem(Base, UUIDMixin):
    __tablename__ = "sales_document_items"

    document_id  = Column(UUIDType(),    ForeignKey("sales_documents.id"), nullable=False)
    sequence     = Column(Integer,       default=0)
    description  = Column(String(500),   nullable=False)
    quantity     = Column(Numeric(12,4), default=1,  nullable=False)
    unit         = Column(String(50),    nullable=True)
    unit_price   = Column(Numeric(18,4), nullable=False)
    discount_pct = Column(Numeric(5,2),  default=0)
    amount       = Column(Numeric(18,2), nullable=False)

    document = relationship("SalesDocument", back_populates="items")
