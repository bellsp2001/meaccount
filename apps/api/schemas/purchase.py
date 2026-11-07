from pydantic import BaseModel, field_validator
from typing import Optional, List
from uuid import UUID
from datetime import date
from decimal import Decimal
from models.purchase import PurchaseDocType
from models.sales import SalesDocStatus
from schemas.ap import SupplierResponse
from schemas.sales import SalesItemCreate, SalesItemResponse, DocRef


class PurchaseDocCreate(BaseModel):
    doc_type:       PurchaseDocType
    supplier_id:    UUID
    date:           date
    valid_until:    Optional[date] = None
    vat_rate:       Decimal = Decimal("7")
    deposit_amount: Decimal = Decimal("0")
    ref_number:     Optional[str] = None
    note:           Optional[str] = None
    bill_id:        Optional[UUID] = None   # credit/debit notes: the bill being adjusted
    reason:         Optional[str] = None
    items:          List[SalesItemCreate]

    @field_validator("items")
    @classmethod
    def min_one_item(cls, v):
        if len(v) < 1:
            raise ValueError("เอกสารต้องมีอย่างน้อย 1 รายการ")
        return v


class PurchaseDocResponse(BaseModel):
    id:             UUID
    number:         str
    doc_type:       PurchaseDocType
    supplier_id:    UUID
    supplier:       Optional[SupplierResponse] = None
    date:           date
    valid_until:    Optional[date]
    status:         SalesDocStatus
    subtotal:       Decimal
    vat_rate:       Decimal
    vat_amount:     Decimal
    total:          Decimal
    deposit_amount: Decimal
    ref_number:     Optional[str]
    note:           Optional[str]
    gl_posted:      bool
    converted_to_type: Optional[str]
    converted_to_id:   Optional[UUID]
    source_doc_id:     Optional[UUID]
    bill_id:        Optional[UUID] = None
    bill:           Optional[DocRef] = None
    reason:         Optional[str] = None
    items:          List[SalesItemResponse] = []
    model_config = {"from_attributes": True}


class PaymentVoucherResponse(BaseModel):
    """ใบสำคัญจ่าย — a view over AP payments."""
    id:             UUID
    voucher_number: str
    bill_id:        UUID
    bill_number:    Optional[str]
    supplier_name:  Optional[str]
    date:           date
    amount:         Decimal
    method:         str
    reference:      Optional[str]
    gl_posted:      bool


class ExpenseReportResponse(BaseModel):
    period_from:   str
    period_to:     str
    total_expense: Decimal        # sum of bill subtotals (before VAT)
    total_vat:     Decimal        # input VAT
    total_wht:     Decimal
    bill_count:    int
    paid_amount:   Decimal
    outstanding:   Decimal
    by_month:      List[dict]     # [{month, total, count}]
    by_category:   List[dict]     # [{category, total, count}]
    by_supplier:   List[dict]     # [{supplier, total, count}]
