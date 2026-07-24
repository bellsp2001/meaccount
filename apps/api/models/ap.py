import enum
from datetime import datetime
from sqlalchemy import (Column, String, Numeric, Boolean, Enum, ForeignKey,
                        Text, Date, Integer, DateTime)
from sqlalchemy.orm import relationship
from core.database import Base
from models.base import UUIDMixin, TimestampMixin, UUIDType


class BillStatus(str, enum.Enum):
    DRAFT    = "draft"
    PENDING  = "pending_approval"
    APPROVED = "approved"
    PARTIAL  = "partial"
    PAID     = "paid"
    REJECTED = "rejected"
    CANCELLED= "cancelled"


class APPaymentMethod(str, enum.Enum):
    CASH          = "cash"
    BANK_TRANSFER = "bank_transfer"
    CHECK         = "check"
    CREDIT_CARD   = "credit_card"
    PROMPTPAY     = "promptpay"


class ExpenseCategory(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "expense_categories"

    code        = Column(String(20),  nullable=False, unique=True, index=True)
    name        = Column(String(200), nullable=False)
    account_id  = Column(UUIDType(), ForeignKey("accounts.id"), nullable=True)
    is_active   = Column(Boolean, default=True)
    description = Column(Text, nullable=True)

    gl_account = relationship("Account", foreign_keys=[account_id])
    bills      = relationship("Bill", back_populates="category", lazy="dynamic")


class Supplier(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "suppliers"

    code          = Column(String(20),  nullable=False, unique=True, index=True)
    name          = Column(String(255), nullable=False, index=True)
    name_en       = Column(String(255), nullable=True)
    tax_id        = Column(String(20),  nullable=True, index=True)
    branch_code   = Column(String(10),  nullable=True)
    address       = Column(Text,        nullable=True)
    phone         = Column(String(30),  nullable=True)
    email         = Column(String(255), nullable=True)
    contact_name  = Column(String(255), nullable=True)
    payment_terms = Column(Integer,     default=30)
    bank_name     = Column(String(100), nullable=True)
    bank_account  = Column(String(30),  nullable=True)
    bank_branch   = Column(String(100), nullable=True)
    wht_type      = Column(String(10),  nullable=True)
    is_active     = Column(Boolean,     default=True)

    bills = relationship("Bill", back_populates="supplier", lazy="dynamic")


class Bill(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "bills"

    number        = Column(String(30),    nullable=False, unique=True, index=True)
    supplier_id   = Column(UUIDType(),    ForeignKey("suppliers.id"),         nullable=True)
    category_id   = Column(UUIDType(),    ForeignKey("expense_categories.id"), nullable=True)
    date          = Column(Date,          nullable=False, index=True)
    due_date      = Column(Date,          nullable=False)
    ref_number    = Column(String(100),   nullable=True)
    description   = Column(String(500),   nullable=False)
    status        = Column(Enum(BillStatus), default=BillStatus.DRAFT, nullable=False)
    subtotal      = Column(Numeric(18,2), default=0)
    vat_rate      = Column(Numeric(5,2),  default=7)
    vat_amount    = Column(Numeric(18,2), default=0)
    wht_rate      = Column(Numeric(5,2),  default=0)
    wht_amount    = Column(Numeric(18,2), default=0)
    total         = Column(Numeric(18,2), default=0)
    net_payable   = Column(Numeric(18,2), default=0)
    paid_amount   = Column(Numeric(18,2), default=0)
    balance_due   = Column(Numeric(18,2), default=0)
    note          = Column(Text,          nullable=True)
    gl_posted     = Column(Boolean,       default=False)
    created_by    = Column(UUIDType(),    ForeignKey("users.id"), nullable=True)
    approved_by   = Column(UUIDType(),    ForeignKey("users.id"), nullable=True)
    ai_categorized= Column(Boolean,       default=False)
    ocr_source    = Column(String(500),   nullable=True)

    supplier  = relationship("Supplier",         back_populates="bills")
    category  = relationship("ExpenseCategory",  back_populates="bills")
    items     = relationship("BillItem",         back_populates="bill",
                             cascade="all, delete-orphan", lazy="joined",
                             order_by="BillItem.sequence")
    payments  = relationship("APPayment",        back_populates="bill", lazy="dynamic")
    approvals = relationship("ApprovalRecord",   back_populates="bill",
                             cascade="all, delete-orphan", lazy="dynamic",
                             order_by="ApprovalRecord.created_at")
    creator   = relationship("User", foreign_keys=[created_by])
    approver  = relationship("User", foreign_keys=[approved_by])


class BillItem(Base, UUIDMixin):
    __tablename__ = "bill_items"

    bill_id     = Column(UUIDType(),    ForeignKey("bills.id"), nullable=False)
    sequence    = Column(Integer,       default=0)
    description = Column(String(500),   nullable=False)
    quantity    = Column(Numeric(12,4), default=1)
    unit        = Column(String(50),    nullable=True)
    unit_price  = Column(Numeric(18,4), nullable=False)
    amount      = Column(Numeric(18,2), nullable=False)

    bill = relationship("Bill", back_populates="items")


class ApprovalRecord(Base, UUIDMixin):
    __tablename__ = "approval_records"

    bill_id    = Column(UUIDType(), ForeignKey("bills.id"),  nullable=False)
    user_id    = Column(UUIDType(), ForeignKey("users.id"),  nullable=False)
    action     = Column(String(20), nullable=False)
    comment    = Column(Text,       nullable=True)
    created_at = Column(DateTime,   default=datetime.utcnow, nullable=False)

    bill = relationship("Bill", back_populates="approvals")
    user = relationship("User")


class APPayment(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "ap_payments"

    bill_id       = Column(UUIDType(),    ForeignKey("bills.id"),    nullable=False)
    date          = Column(Date,          nullable=False)
    amount        = Column(Numeric(18,2), nullable=False)
    method        = Column(Enum(APPaymentMethod), default=APPaymentMethod.BANK_TRANSFER)
    reference     = Column(String(100),   nullable=True)
    note          = Column(Text,          nullable=True)
    gl_posted     = Column(Boolean,       default=False)
    gl_journal_id = Column(UUIDType(),    ForeignKey("journals.id"), nullable=True)
    paid_by       = Column(UUIDType(),    ForeignKey("users.id"),    nullable=True)

    bill       = relationship("Bill", back_populates="payments")
    gl_journal = relationship("Journal", foreign_keys=[gl_journal_id])
