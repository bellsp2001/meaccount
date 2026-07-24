from pydantic import BaseModel, field_validator, model_validator
from typing import Optional, List
from uuid import UUID
from datetime import date
from decimal import Decimal
from models.ap import BillStatus, APPaymentMethod


# ── ExpenseCategory ────────────────────────────────────────────
class ExpenseCategoryCreate(BaseModel):
    code:        str
    name:        str
    account_id:  Optional[UUID] = None
    description: Optional[str] = None


class ExpenseCategoryResponse(BaseModel):
    id:          UUID
    code:        str
    name:        str
    account_id:  Optional[UUID]
    description: Optional[str]
    is_active:   bool
    model_config = {"from_attributes": True}


# ── Supplier ───────────────────────────────────────────────────
class SupplierCreate(BaseModel):
    code:          str
    name:          str
    name_en:       Optional[str] = None
    tax_id:        Optional[str] = None
    branch_code:   Optional[str] = "00000"
    address:       Optional[str] = None
    phone:         Optional[str] = None
    email:         Optional[str] = None
    contact_name:  Optional[str] = None
    payment_terms: int = 30
    bank_name:     Optional[str] = None
    bank_account:  Optional[str] = None
    bank_branch:   Optional[str] = None
    wht_type:      Optional[str] = None

    @field_validator("code")
    @classmethod
    def code_upper(cls, v): return v.strip().upper()


class SupplierUpdate(BaseModel):
    name:          Optional[str] = None
    tax_id:        Optional[str] = None
    address:       Optional[str] = None
    phone:         Optional[str] = None
    email:         Optional[str] = None
    contact_name:  Optional[str] = None
    payment_terms: Optional[int] = None
    bank_name:     Optional[str] = None
    bank_account:  Optional[str] = None
    wht_type:      Optional[str] = None
    is_active:     Optional[bool] = None


class SupplierResponse(BaseModel):
    id:            UUID
    code:          str
    name:          str
    name_en:       Optional[str]
    tax_id:        Optional[str]
    branch_code:   Optional[str]
    address:       Optional[str]
    phone:         Optional[str]
    email:         Optional[str]
    contact_name:  Optional[str]
    payment_terms: int
    bank_name:     Optional[str]
    bank_account:  Optional[str]
    bank_branch:   Optional[str]
    wht_type:      Optional[str]
    is_active:     bool
    model_config = {"from_attributes": True}


# ── BillItem ───────────────────────────────────────────────────
class BillItemCreate(BaseModel):
    description: str
    quantity:    Decimal = Decimal("1")
    unit:        Optional[str] = None
    unit_price:  Decimal
    sequence:    int = 0

    @model_validator(mode="after")
    def calc_amount(self):
        self.amount = (self.quantity * self.unit_price).quantize(Decimal("0.01"))
        return self

    amount: Decimal = Decimal("0")


class BillItemResponse(BaseModel):
    id:          UUID
    sequence:    int
    description: str
    quantity:    Decimal
    unit:        Optional[str]
    unit_price:  Decimal
    amount:      Decimal
    model_config = {"from_attributes": True}


# ── Bill ───────────────────────────────────────────────────────
class BillCreate(BaseModel):
    supplier_id:  Optional[UUID] = None
    category_id:  Optional[UUID] = None
    date:         date
    due_date:     Optional[date] = None
    ref_number:   Optional[str] = None
    description:  str
    vat_rate:     Decimal = Decimal("7")
    wht_rate:     Decimal = Decimal("0")
    note:         Optional[str] = None
    items:        List[BillItemCreate]

    @field_validator("items")
    @classmethod
    def min_one(cls, v):
        if not v:
            raise ValueError("ต้องมีอย่างน้อย 1 รายการ")
        return v


class BillResponse(BaseModel):
    id:            UUID
    number:        str
    supplier_id:   Optional[UUID]
    supplier:      Optional[SupplierResponse] = None
    category_id:   Optional[UUID]
    category:      Optional[ExpenseCategoryResponse] = None
    date:          date
    due_date:      date
    ref_number:    Optional[str]
    description:   str
    status:        BillStatus
    subtotal:      Decimal
    vat_rate:      Decimal
    vat_amount:    Decimal
    wht_rate:      Decimal
    wht_amount:    Decimal
    total:         Decimal
    net_payable:   Decimal
    paid_amount:   Decimal
    balance_due:   Decimal
    note:          Optional[str]
    gl_posted:     bool
    ai_categorized:bool
    items:         List[BillItemResponse] = []
    model_config = {"from_attributes": True}


# ── Approval ───────────────────────────────────────────────────
class ApprovalAction(BaseModel):
    action:  str    # "approved" | "rejected"
    comment: Optional[str] = None

    @field_validator("action")
    @classmethod
    def valid_action(cls, v):
        if v not in ("approved", "rejected"):
            raise ValueError("action ต้องเป็น approved หรือ rejected เท่านั้น")
        return v


# ── APPayment ──────────────────────────────────────────────────
class APPaymentCreate(BaseModel):
    bill_id:   UUID
    date:      date
    amount:    Decimal
    method:    APPaymentMethod = APPaymentMethod.BANK_TRANSFER
    reference: Optional[str] = None
    note:      Optional[str] = None

    @field_validator("amount")
    @classmethod
    def positive(cls, v):
        if v <= 0:
            raise ValueError("จำนวนเงินต้องมากกว่า 0")
        return v


class APPaymentResponse(BaseModel):
    id:        UUID
    bill_id:   UUID
    date:      date
    amount:    Decimal
    method:    APPaymentMethod
    reference: Optional[str]
    note:      Optional[str]
    gl_posted: bool
    model_config = {"from_attributes": True}


# ── AI Categorize ──────────────────────────────────────────────
class AICategorizeRequest(BaseModel):
    description: str
    amount:      Decimal


class AICategorizeResponse(BaseModel):
    category_code: Optional[str]
    category_name: Optional[str]
    account_code:  Optional[str]
    explanation:   str
    confidence:    float
