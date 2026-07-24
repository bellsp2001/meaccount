from pydantic import BaseModel, EmailStr, field_validator, model_validator
from typing import Optional, List
from uuid import UUID
from datetime import date
from decimal import Decimal
from models.ar import InvoiceStatus, PaymentMethod


# ── Customer ───────────────────────────────────────────────────
class CustomerCreate(BaseModel):
    code:         str
    name:         str
    name_en:      Optional[str] = None
    tax_id:       Optional[str] = None
    branch_code:  Optional[str] = "00000"
    address:      Optional[str] = None
    phone:        Optional[str] = None
    email:        Optional[str] = None
    contact_name: Optional[str] = None
    credit_days:  int = 30
    credit_limit: Decimal = Decimal("0")

    @field_validator("code")
    @classmethod
    def code_strip(cls, v): return v.strip().upper()


class CustomerUpdate(BaseModel):
    name:         Optional[str] = None
    tax_id:       Optional[str] = None
    address:      Optional[str] = None
    phone:        Optional[str] = None
    email:        Optional[str] = None
    contact_name: Optional[str] = None
    credit_days:  Optional[int] = None
    credit_limit: Optional[Decimal] = None
    is_active:    Optional[bool] = None


class CustomerResponse(BaseModel):
    id:           UUID
    code:         str
    name:         str
    name_en:      Optional[str]
    tax_id:       Optional[str]
    branch_code:  Optional[str]
    address:      Optional[str]
    phone:        Optional[str]
    email:        Optional[str]
    contact_name: Optional[str]
    credit_days:  int
    credit_limit: Decimal
    is_active:    bool
    model_config = {"from_attributes": True}


# ── Invoice Item ───────────────────────────────────────────────
class InvoiceItemCreate(BaseModel):
    description:  str
    quantity:     Decimal = Decimal("1")
    unit:         Optional[str] = None
    unit_price:   Decimal
    discount_pct: Decimal = Decimal("0")
    sequence:     int = 0

    @model_validator(mode="after")
    def calc_amount(self):
        disc = self.discount_pct / 100
        self.amount = (self.quantity * self.unit_price * (1 - disc)).quantize(Decimal("0.01"))
        return self

    amount: Decimal = Decimal("0")


class InvoiceItemResponse(BaseModel):
    id:           UUID
    sequence:     int
    description:  str
    quantity:     Decimal
    unit:         Optional[str]
    unit_price:   Decimal
    discount_pct: Decimal
    amount:       Decimal
    model_config = {"from_attributes": True}


# ── Invoice ────────────────────────────────────────────────────
class InvoiceCreate(BaseModel):
    customer_id: UUID
    date:        date
    due_date:    Optional[date] = None    # auto-calc from credit_days if None
    vat_rate:    Decimal = Decimal("7")
    note:        Optional[str] = None
    items:       List[InvoiceItemCreate]

    @field_validator("items")
    @classmethod
    def min_one_item(cls, v):
        if len(v) < 1:
            raise ValueError("Invoice ต้องมีอย่างน้อย 1 รายการ")
        return v


class InvoiceResponse(BaseModel):
    id:          UUID
    number:      str
    customer_id: UUID
    customer:    Optional[CustomerResponse] = None
    date:        date
    due_date:    date
    status:      InvoiceStatus
    subtotal:    Decimal
    vat_rate:    Decimal
    vat_amount:  Decimal
    total:       Decimal
    paid_amount: Decimal
    balance_due: Decimal
    note:        Optional[str]
    gl_posted:   bool
    items:       List[InvoiceItemResponse] = []
    model_config = {"from_attributes": True}


# ── Payment ────────────────────────────────────────────────────
class PaymentCreate(BaseModel):
    invoice_id: UUID
    date:       date
    amount:     Decimal
    method:     PaymentMethod = PaymentMethod.BANK_TRANSFER
    reference:  Optional[str] = None
    note:       Optional[str] = None

    @field_validator("amount")
    @classmethod
    def positive(cls, v):
        if v <= 0:
            raise ValueError("จำนวนเงินต้องมากกว่า 0")
        return v


class PaymentResponse(BaseModel):
    id:         UUID
    invoice_id: UUID
    date:       date
    amount:     Decimal
    method:     PaymentMethod
    reference:  Optional[str]
    note:       Optional[str]
    gl_posted:  bool
    model_config = {"from_attributes": True}


# ── OCR ────────────────────────────────────────────────────────
class OCRInvoiceRequest(BaseModel):
    """Base64-encoded image or PDF of invoice"""
    image_base64: str
    media_type:   str = "image/jpeg"   # image/jpeg, image/png, application/pdf


class OCRInvoiceResponse(BaseModel):
    customer_name:  Optional[str]
    invoice_number: Optional[str]
    invoice_date:   Optional[str]
    due_date:       Optional[str]
    items:          List[dict] = []
    subtotal:       Optional[float]
    vat_amount:     Optional[float]
    total:          Optional[float]
    confidence:     float
    raw_text:       Optional[str]
