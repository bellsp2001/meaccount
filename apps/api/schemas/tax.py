from pydantic import BaseModel, field_validator
from typing import Optional, List
from uuid import UUID
from datetime import date
from decimal import Decimal
from models.tax import VATReturnStatus, WHTType, WHTCertStatus


# ── VAT Return ─────────────────────────────────────────────────
class VATReturnGenerateRequest(BaseModel):
    period_month: int
    period_year:  int

    @field_validator("period_month")
    @classmethod
    def valid_month(cls, v):
        if not 1 <= v <= 12:
            raise ValueError("เดือนต้องอยู่ระหว่าง 1-12")
        return v


class VATReturnResponse(BaseModel):
    id:              UUID
    period_month:    int
    period_year:     int
    status:          VATReturnStatus
    sales_amount:    Decimal
    output_vat:      Decimal
    purchase_amount: Decimal
    input_vat:       Decimal
    net_vat:         Decimal
    submitted_date:  Optional[date]
    due_date:        Optional[date]
    note:            Optional[str]
    xml_generated:   bool
    model_config = {"from_attributes": True}


# ── Withholding Certificate ────────────────────────────────────
class WHTCertificateCreate(BaseModel):
    wht_type:      WHTType
    payer_name:    str
    payer_tax_id:  Optional[str] = None
    payee_name:    str
    payee_tax_id:  Optional[str] = None
    payee_address: Optional[str] = None
    income_type:   str
    payment_date:  date
    gross_amount:  Decimal
    wht_rate:      Decimal
    reference_type: Optional[str] = None
    reference_id:   Optional[UUID] = None

    @field_validator("gross_amount")
    @classmethod
    def positive(cls, v):
        if v <= 0:
            raise ValueError("จำนวนเงินต้องมากกว่า 0")
        return v


class WHTCertificateResponse(BaseModel):
    id:            UUID
    number:        str
    wht_type:      WHTType
    payer_name:    str
    payer_tax_id:  Optional[str]
    payee_name:    str
    payee_tax_id:  Optional[str]
    payee_address: Optional[str]
    income_type:   str
    payment_date:  date
    gross_amount:  Decimal
    wht_rate:      Decimal
    wht_amount:    Decimal
    status:        WHTCertStatus
    model_config = {"from_attributes": True}


class WHTBulkGenerateRequest(BaseModel):
    """สร้างหนังสือรับรองหัก ณ ที่จ่ายจาก Bills ที่มี WHT ในงวดที่กำหนด"""
    period_month: int
    period_year:  int
    payer_name:   str
    payer_tax_id: Optional[str] = None


# ── AI Tax Check ───────────────────────────────────────────────
class VATCheckResponse(BaseModel):
    period:             str
    is_correct:          bool
    issues:               List[str]
    recommendations:      List[str]
    unposted_invoices:    int
    unposted_bills:       int
    confidence:           float


class TaxPlanningRequest(BaseModel):
    annual_revenue:  Decimal
    annual_expense:  Decimal
    business_type:   Optional[str] = None


class TaxPlanningResponse(BaseModel):
    estimated_net_profit:   Decimal
    estimated_corporate_tax: Decimal
    tax_rate_applied:        str
    suggestions:              List[str]
    explanation:              str
