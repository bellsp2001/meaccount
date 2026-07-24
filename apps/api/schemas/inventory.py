from pydantic import BaseModel, field_validator
from typing import Optional, List
from uuid import UUID
from datetime import date
from decimal import Decimal
from models.inventory import MovementType, CostMethod, POStatus


# ── Warehouse ──────────────────────────────────────────────────
class WarehouseCreate(BaseModel):
    code: str
    name: str
    address: Optional[str] = None
    is_default: bool = False


class WarehouseResponse(BaseModel):
    id: UUID
    code: str
    name: str
    address: Optional[str]
    is_active: bool
    is_default: bool
    model_config = {"from_attributes": True}


# ── ProductCategory ────────────────────────────────────────────
class CategoryCreate(BaseModel):
    code: str
    name: str


class CategoryResponse(BaseModel):
    id: UUID
    code: str
    name: str
    model_config = {"from_attributes": True}


# ── Product ────────────────────────────────────────────────────
class ProductCreate(BaseModel):
    sku:           str
    name:          str
    name_en:       Optional[str] = None
    category_id:   Optional[UUID] = None
    unit:          str = "ชิ้น"
    cost_method:   CostMethod = CostMethod.FIFO
    sale_price:    Decimal = Decimal("0")
    reorder_point: Decimal = Decimal("0")
    reorder_qty:   Decimal = Decimal("0")
    barcode:       Optional[str] = None
    track_stock:   bool = True

    @field_validator("sku")
    @classmethod
    def sku_upper(cls, v): return v.strip().upper()


class ProductUpdate(BaseModel):
    name:          Optional[str] = None
    sale_price:    Optional[Decimal] = None
    reorder_point: Optional[Decimal] = None
    reorder_qty:   Optional[Decimal] = None
    is_active:     Optional[bool] = None


class ProductResponse(BaseModel):
    id:            UUID
    sku:           str
    name:          str
    name_en:       Optional[str]
    category_id:   Optional[UUID]
    unit:          str
    cost_method:   CostMethod
    sale_price:    Decimal
    reorder_point: Decimal
    reorder_qty:   Decimal
    barcode:       Optional[str]
    is_active:     bool
    track_stock:   bool
    qty_on_hand:   Decimal
    avg_cost:      Decimal
    stock_value:   Optional[Decimal] = None  # computed
    is_low_stock:  Optional[bool] = None     # computed
    model_config = {"from_attributes": True}


# ── Stock Movement ─────────────────────────────────────────────
class StockReceiveCreate(BaseModel):
    product_id:   UUID
    warehouse_id: UUID
    date:         date
    quantity:     Decimal
    unit_cost:    Decimal
    reference:    Optional[str] = None
    note:         Optional[str] = None

    @field_validator("quantity", "unit_cost")
    @classmethod
    def positive(cls, v):
        if v <= 0:
            raise ValueError("จำนวนและราคาต้องมากกว่า 0")
        return v


class StockIssueCreate(BaseModel):
    product_id:   UUID
    warehouse_id: UUID
    date:         date
    quantity:     Decimal
    reference:    Optional[str] = None
    note:         Optional[str] = None

    @field_validator("quantity")
    @classmethod
    def positive(cls, v):
        if v <= 0:
            raise ValueError("จำนวนต้องมากกว่า 0")
        return v


class StockAdjustCreate(BaseModel):
    product_id:   UUID
    warehouse_id: UUID
    date:         date
    quantity:     Decimal            # can represent the adjustment amount (positive)
    direction:    str                # "in" | "out"
    unit_cost:    Optional[Decimal] = None
    note:         str

    @field_validator("direction")
    @classmethod
    def valid_dir(cls, v):
        if v not in ("in", "out"):
            raise ValueError("direction ต้องเป็น in หรือ out")
        return v


class StockMovementResponse(BaseModel):
    id:            UUID
    number:        str
    product_id:    UUID
    warehouse_id:  UUID
    movement_type: MovementType
    date:          date
    quantity:      Decimal
    unit_cost:     Optional[Decimal]
    total_cost:    Optional[Decimal]
    reference:     Optional[str]
    note:          Optional[str]
    gl_posted:     bool
    model_config = {"from_attributes": True}


# ── Purchase Order ─────────────────────────────────────────────
class POItemCreate(BaseModel):
    product_id: UUID
    quantity:   Decimal
    unit_cost:  Decimal
    sequence:   int = 0


class PurchaseOrderCreate(BaseModel):
    supplier_id:   Optional[UUID] = None
    warehouse_id:  UUID
    date:          date
    expected_date: Optional[date] = None
    note:          Optional[str] = None
    items:         List[POItemCreate]

    @field_validator("items")
    @classmethod
    def min_one(cls, v):
        if not v:
            raise ValueError("ต้องมีอย่างน้อย 1 รายการ")
        return v


class POItemResponse(BaseModel):
    id:           UUID
    product_id:   UUID
    sequence:     int
    quantity:     Decimal
    unit_cost:    Decimal
    qty_received: Decimal
    amount:       Decimal
    model_config = {"from_attributes": True}


class PurchaseOrderResponse(BaseModel):
    id:            UUID
    number:        str
    supplier_id:   Optional[UUID]
    warehouse_id:  UUID
    date:          date
    expected_date: Optional[date]
    status:        POStatus
    note:          Optional[str]
    total:         Decimal
    ai_generated:  bool
    items:         List[POItemResponse] = []
    model_config = {"from_attributes": True}


class ReceivePOItem(BaseModel):
    po_item_id: UUID
    quantity:   Decimal


class ReceivePORequest(BaseModel):
    items: List[ReceivePOItem]


# ── AI Forecast ────────────────────────────────────────────────
class ForecastResponse(BaseModel):
    product_id:        UUID
    product_name:       str
    current_stock:      Decimal
    avg_daily_usage:     float
    days_of_stock_left:  Optional[float]
    forecast_30d:        float
    forecast_60d:        float
    forecast_90d:        float
    reorder_recommended: bool
    recommended_qty:     Optional[float]
    confidence:          float
    explanation:         str
