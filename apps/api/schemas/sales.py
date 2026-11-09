from pydantic import BaseModel, field_validator, model_validator
from typing import Optional, List
from uuid import UUID
from datetime import date
from decimal import Decimal
from models.sales import SalesDocType, SalesDocStatus
from schemas.ar import CustomerResponse
from schemas.accounting import DocumentBookRef


# ── Line item ──────────────────────────────────────────────────
class SalesItemCreate(BaseModel):
    description:  str
    quantity:     Decimal = Decimal("1")
    unit:         Optional[str] = None
    unit_price:   Decimal
    discount_pct: Decimal = Decimal("0")
    sequence:     int = 0
    tax_code_id:  Optional[UUID] = None     # ประเภทภาษี (VAT) for this line — its rate wins
    product_id:   Optional[UUID] = None     # the สินค้า/บริการ the line was picked from
    detail:       Optional[str]  = None     # คำอธิบาย under the item name
    vat_rate:     Optional[Decimal] = None  # the line's VAT %; None = the document's vat_rate

    @model_validator(mode="after")
    def calc_amount(self):
        disc = self.discount_pct / 100
        self.amount = (self.quantity * self.unit_price * (1 - disc)).quantize(Decimal("0.01"))
        return self

    amount: Decimal = Decimal("0")


class SalesItemResponse(BaseModel):
    id:           UUID
    sequence:     int
    description:  str
    quantity:     Decimal
    unit:         Optional[str]
    unit_price:   Decimal
    discount_pct: Decimal
    amount:       Decimal
    tax_code_id:  Optional[UUID] = None
    product_id:   Optional[UUID] = None     # the สินค้า/บริการ the line was picked from
    detail:       Optional[str]  = None     # คำอธิบาย under the item name
    vat_rate:     Optional[Decimal] = None
    model_config = {"from_attributes": True}


# ── Sales document ─────────────────────────────────────────────
class SalesDocCreate(BaseModel):
    doc_type:       SalesDocType
    customer_id:    UUID
    date:           date
    valid_until:    Optional[date] = None
    vat_rate:       Decimal = Decimal("7")
    vat_inclusive: bool = False   # True = line amounts include VAT (ราคารวม VAT)
    deposit_amount: Decimal = Decimal("0")
    note:           Optional[str] = None
    invoice_id:     Optional[UUID] = None   # credit/debit notes: the invoice being adjusted
    reason:         Optional[str] = None
    book_id:        Optional[UUID] = None   # สมุดบันทึก — needed to confirm a deposit or note
    items:          List[SalesItemCreate]

    @field_validator("items")
    @classmethod
    def min_one_item(cls, v):
        if len(v) < 1:
            raise ValueError("เอกสารต้องมีอย่างน้อย 1 รายการ")
        return v


class DocRef(BaseModel):
    """The adjusted invoice/bill as shown on a credit or debit note."""
    id:     UUID
    number: str
    model_config = {"from_attributes": True}


class SalesDocResponse(BaseModel):
    id:             UUID
    number:         str
    doc_type:       SalesDocType
    customer_id:    UUID
    customer:       Optional[CustomerResponse] = None
    date:           date
    valid_until:    Optional[date]
    status:         SalesDocStatus
    subtotal:       Decimal
    vat_rate:       Decimal
    vat_inclusive: bool = False   # True = line amounts include VAT (ราคารวม VAT)
    vat_amount:     Decimal
    total:          Decimal
    deposit_amount: Decimal
    note:           Optional[str]
    gl_posted:      bool
    converted_to_type: Optional[str]
    converted_to_id:   Optional[UUID]
    source_doc_id:     Optional[UUID]
    invoice_id:     Optional[UUID] = None
    invoice:        Optional[DocRef] = None
    reason:         Optional[str] = None
    book_id:        Optional[UUID] = None
    book:           Optional[DocumentBookRef] = None
    items:          List[SalesItemResponse] = []
    model_config = {"from_attributes": True}


class ConvertResult(BaseModel):
    source_id:    UUID
    target_type:  str            # 'sales_order' | 'invoice'
    target_id:    UUID
    target_number: str


# ── Receipt (view over Payment) ────────────────────────────────
class ReceiptResponse(BaseModel):
    id:              UUID
    receipt_number:  str
    invoice_id:      UUID
    invoice_number:  Optional[str]
    customer_name:   Optional[str]
    date:            date
    amount:          Decimal
    method:          str
    reference:       Optional[str]
    gl_posted:       bool


# ── Sales report ───────────────────────────────────────────────
class SalesReportResponse(BaseModel):
    period_from:   str
    period_to:     str
    total_sales:   Decimal        # sum of invoice totals (issued)
    total_vat:     Decimal
    invoice_count: int
    paid_amount:   Decimal
    outstanding:   Decimal
    by_month:      List[dict]     # [{month, total, count}]
    by_customer:   List[dict]     # [{customer, total, count}]
    by_status:     dict           # {status: count}
