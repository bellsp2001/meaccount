from pydantic import BaseModel, field_validator
from typing import Optional, List
from uuid import UUID
from datetime import datetime
from decimal import Decimal


# ── Shift ──────────────────────────────────────────────────────
class ShiftOpenRequest(BaseModel):
    warehouse_id: UUID
    opening_cash: Decimal = Decimal("0")

    @field_validator("opening_cash")
    @classmethod
    def non_negative(cls, v):
        if v < 0:
            raise ValueError("เงินสดตั้งต้นต้องไม่ติดลบ")
        return v


class ShiftCloseRequest(BaseModel):
    closing_cash_counted: Decimal
    close_note: Optional[str] = None


class ShiftResponse(BaseModel):
    id: UUID
    warehouse_id: UUID
    status: str
    opening_cash: Decimal
    opened_at: datetime
    closing_cash_counted: Optional[Decimal]
    closing_cash_expected: Optional[Decimal]
    cash_variance: Optional[Decimal]
    closed_at: Optional[datetime]
    sale_count: Optional[int] = None
    total_sales: Optional[Decimal] = None
    model_config = {"from_attributes": True}


# ── Sale ───────────────────────────────────────────────────────
class SaleItemInput(BaseModel):
    product_id: UUID
    quantity:   Decimal
    unit_price: Optional[Decimal] = None   # None = use product's sale_price
    discount_pct: Decimal = Decimal("0")

    @field_validator("quantity")
    @classmethod
    def positive_qty(cls, v):
        if v <= 0:
            raise ValueError("จำนวนต้องมากกว่า 0")
        return v


class PaymentInput(BaseModel):
    method: str
    amount: Decimal
    reference: Optional[str] = None

    @field_validator("amount")
    @classmethod
    def positive_amount(cls, v):
        if v <= 0:
            raise ValueError("จำนวนเงินต้องมากกว่า 0")
        return v


class SaleCreate(BaseModel):
    shift_id:    UUID
    customer_id: Optional[UUID] = None
    items:       List[SaleItemInput]
    payments:    List[PaymentInput]
    vat_rate:    Decimal = Decimal("7")
    discount_amount: Decimal = Decimal("0")

    @field_validator("items")
    @classmethod
    def min_one_item(cls, v):
        if not v:
            raise ValueError("ต้องมีอย่างน้อย 1 รายการสินค้า")
        return v

    @field_validator("payments")
    @classmethod
    def min_one_payment(cls, v):
        if not v:
            raise ValueError("ต้องระบุการชำระเงินอย่างน้อย 1 รายการ")
        return v


class SaleItemResponse(BaseModel):
    id: UUID
    product_id: UUID
    quantity: Decimal
    unit_price: Decimal
    discount_pct: Decimal
    amount: Decimal
    unit_cost_at_sale: Optional[Decimal]
    model_config = {"from_attributes": True}


class PaymentResponse(BaseModel):
    id: UUID
    method: str
    amount: Decimal
    reference: Optional[str]
    model_config = {"from_attributes": True}


class SaleResponse(BaseModel):
    id: UUID
    number: str
    shift_id: UUID
    warehouse_id: UUID
    customer_id: Optional[UUID]
    subtotal: Decimal
    vat_amount: Decimal
    discount_amount: Decimal
    total: Decimal
    status: str
    void_reason: Optional[str]
    gl_posted: bool
    sold_at: datetime
    items: List[SaleItemResponse] = []
    payments: List[PaymentResponse] = []
    model_config = {"from_attributes": True}


class VoidSaleRequest(BaseModel):
    reason: str


# ── Barcode Lookup ─────────────────────────────────────────────
class BarcodeLookupResponse(BaseModel):
    product_id: UUID
    sku: str
    name: str
    sale_price: Decimal
    qty_on_hand: Decimal
    unit: str
