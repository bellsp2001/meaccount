import enum
from sqlalchemy import (Column, String, Numeric, Boolean, Enum, ForeignKey,
                        Text, Date, Integer)
from sqlalchemy.orm import relationship
from core.database import Base
from models.base import UUIDMixin, TimestampMixin, UUIDType


class InvoiceStatus(str, enum.Enum):
    DRAFT     = "draft"
    SENT      = "sent"
    PARTIAL   = "partial"
    PAID      = "paid"
    OVERDUE   = "overdue"
    CANCELLED = "cancelled"


class PaymentMethod(str, enum.Enum):
    CASH          = "cash"
    BANK_TRANSFER = "bank_transfer"
    CHECK         = "check"
    CREDIT_CARD   = "credit_card"
    PROMPTPAY     = "promptpay"


class Customer(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "customers"

    code         = Column(String(20),    nullable=False, unique=True, index=True)
    name         = Column(String(255),   nullable=False, index=True)
    name_en      = Column(String(255),   nullable=True)
    tax_id       = Column(String(20),    nullable=True, index=True)
    branch_code  = Column(String(10),    nullable=True)
    address      = Column(Text,          nullable=True)
    phone        = Column(String(30),    nullable=True)
    email        = Column(String(255),   nullable=True)
    contact_name = Column(String(255),   nullable=True)
    credit_days  = Column(Integer,       default=30, nullable=False)
    credit_limit = Column(Numeric(18,2), default=0,  nullable=False)
    is_active    = Column(Boolean,       default=True)

    invoices = relationship("Invoice", back_populates="customer", lazy="dynamic")


class Invoice(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "invoices"

    number      = Column(String(30),    nullable=False, unique=True, index=True)
    customer_id = Column(UUIDType(),    ForeignKey("customers.id"), nullable=False)
    date        = Column(Date,          nullable=False, index=True)
    due_date    = Column(Date,          nullable=False)
    status      = Column(Enum(InvoiceStatus), default=InvoiceStatus.DRAFT, nullable=False)
    subtotal    = Column(Numeric(18,2), default=0)
    vat_rate    = Column(Numeric(5,2),  default=7)
    vat_amount  = Column(Numeric(18,2), default=0)
    total       = Column(Numeric(18,2), default=0)
    paid_amount = Column(Numeric(18,2), default=0)
    balance_due = Column(Numeric(18,2), default=0)
    note        = Column(Text,          nullable=True)
    gl_posted   = Column(Boolean,       default=False)
    created_by  = Column(UUIDType(),    ForeignKey("users.id"), nullable=True)
    ocr_source  = Column(String(500),   nullable=True)
    ocr_raw     = Column(Text,          nullable=True)

    customer = relationship("Customer", back_populates="invoices")
    items    = relationship("InvoiceItem", back_populates="invoice",
                            cascade="all, delete-orphan", lazy="joined",
                            order_by="InvoiceItem.sequence")
    payments = relationship("Payment", back_populates="invoice", lazy="dynamic")
    creator  = relationship("User", foreign_keys=[created_by])


class InvoiceItem(Base, UUIDMixin):
    __tablename__ = "invoice_items"

    invoice_id   = Column(UUIDType(),    ForeignKey("invoices.id"), nullable=False)
    sequence     = Column(Integer,       default=0)
    description  = Column(String(500),   nullable=False)
    quantity     = Column(Numeric(12,4), default=1,  nullable=False)
    unit         = Column(String(50),    nullable=True)
    unit_price   = Column(Numeric(18,4), nullable=False)
    discount_pct = Column(Numeric(5,2),  default=0)
    amount       = Column(Numeric(18,2), nullable=False)

    invoice = relationship("Invoice", back_populates="items")


class Payment(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "payments"

    invoice_id    = Column(UUIDType(),  ForeignKey("invoices.id"), nullable=False)
    date          = Column(Date,        nullable=False)
    amount        = Column(Numeric(18,2), nullable=False)
    method        = Column(Enum(PaymentMethod), default=PaymentMethod.BANK_TRANSFER)
    reference     = Column(String(100), nullable=True)
    note          = Column(Text,        nullable=True)
    gl_posted     = Column(Boolean,     default=False)
    gl_journal_id = Column(UUIDType(),  ForeignKey("journals.id"), nullable=True)
    received_by   = Column(UUIDType(),  ForeignKey("users.id"),    nullable=True)

    invoice    = relationship("Invoice", back_populates="payments")
    gl_journal = relationship("Journal", foreign_keys=[gl_journal_id])
