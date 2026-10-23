from pydantic import BaseModel, field_validator
from typing import Optional, List
from uuid import UUID
from datetime import date, datetime
from decimal import Decimal


# ── Leave Type ─────────────────────────────────────────────────
class LeaveTypeCreate(BaseModel):
    code: str
    name: str
    is_paid: bool = True
    default_days_per_year: Decimal = Decimal("0")
    requires_approval: bool = True

    @field_validator("code")
    @classmethod
    def code_upper(cls, v): return v.strip().upper()


class LeaveTypeResponse(BaseModel):
    id: UUID
    code: str
    name: str
    is_paid: bool
    default_days_per_year: Decimal
    requires_approval: bool
    is_active: bool
    model_config = {"from_attributes": True}


# ── Leave Balance ──────────────────────────────────────────────
class LeaveBalanceResponse(BaseModel):
    id: UUID
    employee_id: UUID
    leave_type_id: UUID
    leave_type_name: Optional[str] = None
    year: int
    entitled_days: Decimal
    used_days: Decimal
    carried_over: Decimal
    remaining_days: Decimal   # computed: entitled + carried_over - used
    model_config = {"from_attributes": True}


class InitializeBalanceRequest(BaseModel):
    employee_id: UUID
    year: int
    carry_over_unused_from_prior_year: bool = False


# ── Leave Request ──────────────────────────────────────────────
class LeaveRequestCreate(BaseModel):
    employee_id:   UUID
    leave_type_id: UUID
    start_date:    date
    end_date:      date
    days_requested: Decimal
    reason:        Optional[str] = None

    @field_validator("days_requested")
    @classmethod
    def positive_days(cls, v):
        if v <= 0:
            raise ValueError("จำนวนวันลาต้องมากกว่า 0")
        return v

    @field_validator("end_date")
    @classmethod
    def end_after_start(cls, v, info):
        if "start_date" in info.data and v < info.data["start_date"]:
            raise ValueError("วันสิ้นสุดต้องไม่ก่อนวันเริ่มต้น")
        return v


class LeaveRequestResponse(BaseModel):
    id: UUID
    employee_id: UUID
    employee_name: Optional[str] = None
    leave_type_id: UUID
    leave_type_name: Optional[str] = None
    start_date: date
    end_date: date
    days_requested: Decimal
    reason: Optional[str]
    status: str
    approved_at: Optional[datetime]
    rejection_reason: Optional[str]
    created_at: datetime
    model_config = {"from_attributes": True}


class LeaveApprovalRequest(BaseModel):
    approve: bool
    rejection_reason: Optional[str] = None


class LeaveCancelRequest(BaseModel):
    reason: Optional[str] = None


# ── Team Calendar ──────────────────────────────────────────────
class TeamCalendarEntry(BaseModel):
    employee_id: UUID
    employee_name: str
    leave_type_name: str
    start_date: date
    end_date: date
    days_requested: Decimal


class TeamCalendarResponse(BaseModel):
    period_from: date
    period_to: date
    entries: List[TeamCalendarEntry]


# ── Payroll Integration ─────────────────────────────────────────
class UnpaidLeaveDeductionResponse(BaseModel):
    employee_id: UUID
    period_month: int
    period_year: int
    unpaid_days: Decimal
    daily_rate: Decimal
    deduction_amount: Decimal
    explanation: str
