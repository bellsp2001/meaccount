from pydantic import BaseModel, field_validator
from typing import Optional, List
from uuid import UUID
from datetime import date
from decimal import Decimal
from models.payroll import EmployeeStatus, MaritalStatus, PayslipStatus


# ── Employee ───────────────────────────────────────────────────
class EmployeeCreate(BaseModel):
    employee_code:  str
    full_name:      str
    national_id:    Optional[str] = None
    position:       Optional[str] = None
    department:     Optional[str] = None
    start_date:     date
    marital_status: MaritalStatus = MaritalStatus.SINGLE
    num_children:   int = 0
    base_salary:    Decimal
    bank_name:      Optional[str] = None
    bank_account:   Optional[str] = None
    email:          Optional[str] = None
    phone:          Optional[str] = None
    sso_enrolled:   bool = True

    @field_validator("employee_code")
    @classmethod
    def code_upper(cls, v): return v.strip().upper()

    @field_validator("base_salary")
    @classmethod
    def positive_salary(cls, v):
        if v <= 0:
            raise ValueError("เงินเดือนต้องมากกว่า 0")
        return v


class EmployeeUpdate(BaseModel):
    full_name:      Optional[str] = None
    position:       Optional[str] = None
    department:     Optional[str] = None
    base_salary:    Optional[Decimal] = None
    status:         Optional[EmployeeStatus] = None
    marital_status: Optional[MaritalStatus] = None
    num_children:   Optional[int] = None
    bank_name:      Optional[str] = None
    bank_account:   Optional[str] = None


class EmployeeResponse(BaseModel):
    id:            UUID
    employee_code: str
    full_name:     str
    national_id:   Optional[str]
    position:      Optional[str]
    department:    Optional[str]
    start_date:    date
    status:        EmployeeStatus
    marital_status:MaritalStatus
    num_children:  int
    base_salary:   Decimal
    bank_name:     Optional[str]
    bank_account:  Optional[str]
    email:         Optional[str]
    phone:         Optional[str]
    sso_enrolled:  bool
    model_config = {"from_attributes": True}


# ── Payslip ────────────────────────────────────────────────────
class PayslipCreate(BaseModel):
    employee_id:  UUID
    period_month: int
    period_year:  int
    pay_date:     date
    ot_hours:     Decimal = Decimal("0")
    ot_rate:      Decimal = Decimal("0")
    allowance:    Decimal = Decimal("0")
    bonus:        Decimal = Decimal("0")
    other_deduction: Decimal = Decimal("0")
    note:         Optional[str] = None

    @field_validator("period_month")
    @classmethod
    def valid_month(cls, v):
        if not 1 <= v <= 12:
            raise ValueError("เดือนต้องอยู่ระหว่าง 1-12")
        return v


class PayslipResponse(BaseModel):
    id:               UUID
    number:           str
    employee_id:      UUID
    employee:         Optional[EmployeeResponse] = None
    period_month:     int
    period_year:      int
    pay_date:         date
    status:           PayslipStatus
    base_salary:      Decimal
    ot_hours:         Decimal
    ot_rate:          Decimal
    ot_amount:        Decimal
    allowance:        Decimal
    bonus:            Decimal
    gross_pay:        Decimal
    sso_employee:     Decimal
    withholding_tax:  Decimal
    other_deduction:  Decimal
    total_deduction:  Decimal
    net_pay:          Decimal
    sso_employer:     Decimal
    note:             Optional[str]
    gl_posted:        bool
    model_config = {"from_attributes": True}


# ── Bulk Run ───────────────────────────────────────────────────
class PayrollRunRequest(BaseModel):
    period_month: int
    period_year:  int
    pay_date:     date
    employee_ids: Optional[List[UUID]] = None  # None = ทุกคนที่ Active

    @field_validator("period_month")
    @classmethod
    def valid_month(cls, v):
        if not 1 <= v <= 12:
            raise ValueError("เดือนต้องอยู่ระหว่าง 1-12")
        return v


class PayrollRunResult(BaseModel):
    total_employees: int
    total_gross:     Decimal
    total_net:       Decimal
    total_sso:       Decimal
    total_wht:       Decimal
    payslips:        List[PayslipResponse]


# ── AI Tax Check ───────────────────────────────────────────────
class TaxCheckRequest(BaseModel):
    employee_id: UUID
    period_month: int
    period_year:  int


class TaxCheckResponse(BaseModel):
    is_correct:      bool
    calculated_wht:  Decimal
    system_wht:      Decimal
    difference:      Decimal
    explanation:     str
    recommendations: List[str]
