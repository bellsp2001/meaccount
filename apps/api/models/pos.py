"""
POS Models: POSShift (cash drawer session), POSSale (ticket), POSSaleItem, POSPayment

Design: a POS sale is intentionally its own lightweight model rather than
reusing AR.Invoice directly — a POS transaction happens in seconds at a
register with a walk-in customer (often no Customer record at all), while
Invoice is built for the AR workflow (credit terms, aging, formal billing).
On checkout, a POS sale posts real GL entries and a real inventory issue
through the existing, already-tested accounting/inventory services — it
doesn't duplicate that logic, it calls into it.
"""
import enum
from sqlalchemy import Column, String, Numeric, Boolean, ForeignKey, DateTime, Integer, Text
from datetime import datetime
from sqlalchemy.orm import relationship
from core.database import Base
from models.base import UUIDMixin, TimestampMixin, UUIDType


class ShiftStatus(str, enum.Enum):
    OPEN   = "open"
    CLOSED = "closed"


class SaleStatus(str, enum.Enum):
    COMPLETED = "completed"
    VOIDED    = "voided"


class POSPaymentMethod(str, enum.Enum):
    CASH          = "cash"
    BANK_TRANSFER = "bank_transfer"
    CREDIT_CARD   = "credit_card"
    PROMPTPAY     = "promptpay"


# ── POSShift (cash drawer session — open/close, reconcile) ──────
class POSShift(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "pos_shifts"

    warehouse_id     = Column(UUIDType(), ForeignKey("warehouses.id"), nullable=False)
    opened_by        = Column(UUIDType(), ForeignKey("users.id"), nullable=True)
    closed_by        = Column(UUIDType(), ForeignKey("users.id"), nullable=True)
    status           = Column(String(20), default=ShiftStatus.OPEN.value, nullable=False)

    opening_cash     = Column(Numeric(18,2), default=0, nullable=False)   # เงินสดตั้งต้นในลิ้นชัก
    opened_at        = Column(DateTime, default=datetime.utcnow, nullable=False)

    closing_cash_counted = Column(Numeric(18,2), nullable=True)   # เงินสดที่นับได้จริงตอนปิดกะ
    closing_cash_expected = Column(Numeric(18,2), nullable=True)  # เงินสดที่ควรมี (opening + cash sales)
    cash_variance     = Column(Numeric(18,2), nullable=True)      # counted - expected (บวก=เกิน, ลบ=ขาด)
    closed_at         = Column(DateTime, nullable=True)
    close_note        = Column(Text, nullable=True)

    warehouse = relationship("Warehouse")
    opener    = relationship("User", foreign_keys=[opened_by])
    closer    = relationship("User", foreign_keys=[closed_by])
    sales     = relationship("POSSale", back_populates="shift", lazy="dynamic")


# ── POSSale (a single checkout ticket) ───────────────────────────
class POSSale(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "pos_sales"

    number       = Column(String(30), nullable=False, unique=True, index=True)   # POS-YYYYMMDD-0001
    shift_id     = Column(UUIDType(), ForeignKey("pos_shifts.id"), nullable=False)
    warehouse_id = Column(UUIDType(), ForeignKey("warehouses.id"), nullable=False)
    customer_id  = Column(UUIDType(), ForeignKey("customers.id"), nullable=True)   # nullable: most POS sales are walk-ins

    subtotal     = Column(Numeric(18,2), default=0, nullable=False)
    vat_amount   = Column(Numeric(18,2), default=0, nullable=False)
    discount_amount = Column(Numeric(18,2), default=0, nullable=False)
    total        = Column(Numeric(18,2), default=0, nullable=False)

    status       = Column(String(20), default=SaleStatus.COMPLETED.value, nullable=False)
    void_reason  = Column(Text, nullable=True)

    gl_posted    = Column(Boolean, default=False)
    gl_journal_id = Column(UUIDType(), ForeignKey("journals.id"), nullable=True)

    cashier_id   = Column(UUIDType(), ForeignKey("users.id"), nullable=True)
    sold_at      = Column(DateTime, default=datetime.utcnow, nullable=False)

    shift    = relationship("POSShift", back_populates="sales")
    warehouse = relationship("Warehouse")
    customer = relationship("Customer")
    cashier  = relationship("User", foreign_keys=[cashier_id])
    items    = relationship("POSSaleItem", back_populates="sale",
                            cascade="all, delete-orphan", lazy="joined")
    payments = relationship("POSPayment", back_populates="sale",
                            cascade="all, delete-orphan", lazy="joined")


class POSSaleItem(Base, UUIDMixin):
    __tablename__ = "pos_sale_items"

    sale_id     = Column(UUIDType(), ForeignKey("pos_sales.id"), nullable=False)
    product_id  = Column(UUIDType(), ForeignKey("products.id"), nullable=False)
    quantity    = Column(Numeric(14,4), nullable=False)
    unit_price  = Column(Numeric(18,4), nullable=False)
    discount_pct = Column(Numeric(5,2), default=0)
    amount      = Column(Numeric(18,2), nullable=False)
    unit_cost_at_sale = Column(Numeric(18,4), nullable=True)   # snapshot COGS cost at time of sale, from stock issue

    sale    = relationship("POSSale", back_populates="items")
    product = relationship("Product")


class POSPayment(Base, UUIDMixin):
    """A sale can be split across multiple payment methods (e.g. part cash, part card)."""
    __tablename__ = "pos_payments"

    sale_id = Column(UUIDType(), ForeignKey("pos_sales.id"), nullable=False)
    method  = Column(String(20), nullable=False)
    amount  = Column(Numeric(18,2), nullable=False)
    reference = Column(String(100), nullable=True)   # e.g. card auth code, PromptPay ref

    sale = relationship("POSSale", back_populates="payments")
