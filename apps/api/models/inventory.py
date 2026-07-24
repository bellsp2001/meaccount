"""
Inventory Models: Warehouse, ProductCategory, Product, StockLot (FIFO), StockMovement, PurchaseOrder
"""
import enum
from sqlalchemy import (Column, String, Numeric, Boolean, Enum, ForeignKey,
                        Text, Date, Integer, DateTime)
from datetime import datetime
from sqlalchemy.orm import relationship
from core.database import Base
from models.base import UUIDMixin, TimestampMixin, UUIDType


class MovementType(str, enum.Enum):
    RECEIVE   = "receive"     # รับสินค้าเข้า (GR)
    ISSUE     = "issue"       # จ่ายสินค้าออก (GI)
    ADJUST_IN = "adjust_in"   # ปรับปรุงเพิ่ม
    ADJUST_OUT= "adjust_out"  # ปรับปรุงลด
    TRANSFER  = "transfer"    # โอนย้ายคลัง


class CostMethod(str, enum.Enum):
    FIFO = "fifo"
    AVCO = "avco"   # Weighted Average


class POStatus(str, enum.Enum):
    DRAFT     = "draft"
    ORDERED   = "ordered"
    RECEIVED  = "received"
    PARTIAL   = "partial"
    CANCELLED = "cancelled"


# ── Warehouse ──────────────────────────────────────────────────
class Warehouse(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "warehouses"

    code      = Column(String(20),  nullable=False, unique=True, index=True)
    name      = Column(String(200), nullable=False)
    address   = Column(Text,        nullable=True)
    is_active = Column(Boolean,     default=True)
    is_default= Column(Boolean,     default=False)


# ── ProductCategory ────────────────────────────────────────────
class ProductCategory(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "product_categories"

    code = Column(String(20),  nullable=False, unique=True, index=True)
    name = Column(String(200), nullable=False)


# ── Product ────────────────────────────────────────────────────
class Product(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "products"

    sku           = Column(String(30),  nullable=False, unique=True, index=True)
    name          = Column(String(255), nullable=False, index=True)
    name_en       = Column(String(255), nullable=True)
    category_id   = Column(UUIDType(),  ForeignKey("product_categories.id"), nullable=True)
    unit          = Column(String(30),  nullable=False, default="ชิ้น")
    cost_method   = Column(Enum(CostMethod), default=CostMethod.FIFO, nullable=False)
    sale_price    = Column(Numeric(18,2), default=0)
    reorder_point = Column(Numeric(12,2), default=0)   # จุดสั่งซื้อ (manual)
    reorder_qty   = Column(Numeric(12,2), default=0)   # ปริมาณสั่งซื้อแนะนำ
    barcode       = Column(String(50),  nullable=True)
    is_active     = Column(Boolean,     default=True)
    track_stock   = Column(Boolean,     default=True)  # false = บริการ ไม่ต้อง track

    # cached current stock (updated on movement)
    qty_on_hand   = Column(Numeric(14,4), default=0)
    avg_cost      = Column(Numeric(18,4), default=0)   # สำหรับ AVCO

    category   = relationship("ProductCategory")
    lots       = relationship("StockLot", back_populates="product", lazy="dynamic")
    movements  = relationship("StockMovement", back_populates="product", lazy="dynamic")


# ── StockLot (สำหรับ FIFO costing) ─────────────────────────────
class StockLot(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "stock_lots"

    product_id     = Column(UUIDType(), ForeignKey("products.id"),   nullable=False)
    warehouse_id   = Column(UUIDType(), ForeignKey("warehouses.id"), nullable=False)
    received_date  = Column(Date,       nullable=False)
    unit_cost      = Column(Numeric(18,4), nullable=False)
    qty_received   = Column(Numeric(14,4), nullable=False)
    qty_remaining  = Column(Numeric(14,4), nullable=False)   # ลดลงเมื่อ issue (FIFO consumption)
    reference      = Column(String(100), nullable=True)      # PO number, GR number

    product   = relationship("Product", back_populates="lots")
    warehouse = relationship("Warehouse")


# ── StockMovement (ประวัติการเคลื่อนไหว) ───────────────────────
class StockMovement(Base, UUIDMixin):
    __tablename__ = "stock_movements"

    number        = Column(String(30),  nullable=False, unique=True, index=True)
    product_id    = Column(UUIDType(),  ForeignKey("products.id"),   nullable=False)
    warehouse_id  = Column(UUIDType(),  ForeignKey("warehouses.id"), nullable=False)
    movement_type = Column(Enum(MovementType), nullable=False)
    date          = Column(Date,        nullable=False, index=True)
    quantity      = Column(Numeric(14,4), nullable=False)      # positive number
    unit_cost     = Column(Numeric(18,4), nullable=True)       # snapshot cost at time of movement
    total_cost    = Column(Numeric(18,2), nullable=True)
    reference     = Column(String(100), nullable=True)         # PO/SO/Bill number
    note          = Column(Text,        nullable=True)
    gl_posted     = Column(Boolean,     default=False)
    created_by    = Column(UUIDType(),  ForeignKey("users.id"),  nullable=True)
    created_at    = Column(DateTime,    default=datetime.utcnow, nullable=False)

    product   = relationship("Product", back_populates="movements")
    warehouse = relationship("Warehouse")
    creator   = relationship("User", foreign_keys=[created_by])


# ── PurchaseOrder ──────────────────────────────────────────────
class PurchaseOrder(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "purchase_orders"

    number       = Column(String(30),  nullable=False, unique=True, index=True)
    supplier_id  = Column(UUIDType(),  ForeignKey("suppliers.id"), nullable=True)
    warehouse_id = Column(UUIDType(),  ForeignKey("warehouses.id"), nullable=False)
    date         = Column(Date,        nullable=False)
    expected_date= Column(Date,        nullable=True)
    status       = Column(Enum(POStatus), default=POStatus.DRAFT, nullable=False)
    note         = Column(Text,        nullable=True)
    total        = Column(Numeric(18,2), default=0)
    created_by   = Column(UUIDType(),  ForeignKey("users.id"), nullable=True)
    ai_generated = Column(Boolean,     default=False)  # สร้างโดย AI Auto-reorder

    items    = relationship("POItem", back_populates="po",
                            cascade="all, delete-orphan", lazy="joined",
                            order_by="POItem.sequence")
    supplier = relationship("Supplier")
    warehouse= relationship("Warehouse")


class POItem(Base, UUIDMixin):
    __tablename__ = "po_items"

    po_id        = Column(UUIDType(),  ForeignKey("purchase_orders.id"), nullable=False)
    product_id   = Column(UUIDType(),  ForeignKey("products.id"), nullable=False)
    sequence     = Column(Integer,     default=0)
    quantity     = Column(Numeric(14,4), nullable=False)
    unit_cost    = Column(Numeric(18,4), nullable=False)
    qty_received = Column(Numeric(14,4), default=0)
    amount       = Column(Numeric(18,2), nullable=False)

    po      = relationship("PurchaseOrder", back_populates="items")
    product = relationship("Product")
