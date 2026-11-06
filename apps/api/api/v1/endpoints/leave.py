from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID
from datetime import date

from core.database import get_db
from core.deps import get_current_user, require_accountant_up, require_manager_up
from models.user import User
from schemas.leave import (
    LeaveTypeCreate, LeaveTypeResponse,
    LeaveBalanceResponse, InitializeBalanceRequest,
    LeaveRequestCreate, LeaveRequestResponse, LeaveApprovalRequest, LeaveCancelRequest,
    TeamCalendarResponse, UnpaidLeaveDeductionResponse,
)
from services.leave import (
    create_leave_type, get_leave_types, seed_default_leave_types,
    initialize_balance, get_employee_balances,
    create_leave_request, get_leave_requests, process_leave_request, cancel_leave_request,
    get_team_calendar, calc_unpaid_leave_deduction,
)

router = APIRouter(prefix="/leave", tags=["Leave & HR Management"])


# ── Leave Type ─────────────────────────────────────────────────
@router.post("/types", response_model=LeaveTypeResponse)
def create_type_ep(payload: LeaveTypeCreate, current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return create_leave_type(db, payload)


@router.get("/types", response_model=List[LeaveTypeResponse])
def list_types_ep(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_leave_types(db)


@router.post("/types/seed-defaults", response_model=List[LeaveTypeResponse])
def seed_defaults_ep(current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return seed_default_leave_types(db)


# ── Balance ────────────────────────────────────────────────────
@router.post("/balances/initialize")
def initialize_balance_ep(payload: InitializeBalanceRequest,
                          current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return initialize_balance(db, payload)


@router.get("/balances/{employee_id}")
def get_balances_ep(employee_id: UUID, year: int = Query(...),
                    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_employee_balances(db, employee_id, year)


# ── Leave Request ──────────────────────────────────────────────
@router.post("/requests")
def create_request_ep(payload: LeaveRequestCreate,
                      current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from services.leave import _request_to_dict
    r = create_leave_request(db, payload)
    return _request_to_dict(r)


@router.get("/requests")
def list_requests_ep(employee_id: Optional[UUID] = None, status: Optional[str] = None,
                     current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_leave_requests(db, employee_id, status)


@router.post("/requests/{request_id}/process")
def process_request_ep(request_id: UUID, payload: LeaveApprovalRequest,
                       current_user: User = Depends(require_manager_up), db: Session = Depends(get_db)):
    return process_leave_request(db, request_id, payload, current_user.id)


@router.post("/requests/{request_id}/cancel")
def cancel_request_ep(request_id: UUID,
                      current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return cancel_leave_request(db, request_id, current_user.id)


# ── Team Calendar ──────────────────────────────────────────────
@router.get("/calendar", response_model=TeamCalendarResponse)
def team_calendar_ep(period_from: date = Query(...), period_to: date = Query(...),
                     current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_team_calendar(db, period_from, period_to)


# ── Payroll Integration ─────────────────────────────────────────
@router.get("/payroll/unpaid-deduction/{employee_id}", response_model=UnpaidLeaveDeductionResponse)
def unpaid_deduction_ep(employee_id: UUID, period_month: int = Query(...), period_year: int = Query(...),
                        current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return calc_unpaid_leave_deduction(db, employee_id, period_month, period_year)
