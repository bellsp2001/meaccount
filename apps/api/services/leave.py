"""
Leave/HR Service — Leave types, balances, request/approval workflow, team
calendar, and unpaid-leave payroll deduction calculation.

Integration with Payroll: this module does NOT modify services/payroll.py
or Payslip directly. Instead, `calc_unpaid_leave_deduction()` computes the
deduction amount for a given employee/period, and the operator (or a future
automation) passes that number into the existing, already-tested
`PayslipCreate.other_deduction` field — the same integration pattern used
throughout this codebase (services calling into each other's public
functions, not each new sprint silently rewriting prior modules' internals).
"""
from decimal import Decimal, ROUND_HALF_UP
from datetime import date, datetime
from typing import List, Optional
from uuid import UUID
from calendar import monthrange
from sqlalchemy.orm import Session
from sqlalchemy import and_, or_
from fastapi import HTTPException

from models.leave import LeaveType, LeaveBalance, LeaveRequest, LeaveRequestStatus
from models.payroll import Employee
from schemas.leave import (
    LeaveTypeCreate, InitializeBalanceRequest,
    LeaveRequestCreate, LeaveApprovalRequest,
)


# ── Leave Type ─────────────────────────────────────────────────

def create_leave_type(db: Session, payload: LeaveTypeCreate) -> LeaveType:
    if db.query(LeaveType).filter(LeaveType.code == payload.code).first():
        raise HTTPException(400, f"รหัสประเภทการลา {payload.code} มีอยู่แล้ว")
    lt = LeaveType(**payload.model_dump())
    db.add(lt); db.commit(); db.refresh(lt)
    return lt


def get_leave_types(db: Session) -> List[LeaveType]:
    return db.query(LeaveType).filter(LeaveType.is_active == True, LeaveType.is_deleted == False).order_by(LeaveType.name).all()


def seed_default_leave_types(db: Session) -> List[LeaveType]:
    """
    Standard Thai employer policy (exceeds statutory minimums per
    พ.ร.บ.คุ้มครองแรงงาน, which sets floors of 6 annual + 30 sick days —
    most employers grant a bit more for annual leave).
    """
    defaults = [
        {"code": "ANNUAL", "name": "ลาพักร้อน", "is_paid": True, "default_days_per_year": Decimal("10"), "requires_approval": True},
        {"code": "SICK", "name": "ลาป่วย", "is_paid": True, "default_days_per_year": Decimal("30"), "requires_approval": False},
        {"code": "PERSONAL", "name": "ลากิจ", "is_paid": True, "default_days_per_year": Decimal("3"), "requires_approval": True},
        {"code": "UNPAID", "name": "ลาไม่รับค่าจ้าง", "is_paid": False, "default_days_per_year": Decimal("0"), "requires_approval": True},
    ]
    created = []
    for d in defaults:
        if not db.query(LeaveType).filter(LeaveType.code == d["code"]).first():
            lt = LeaveType(**d)
            db.add(lt)
            created.append(lt)
    db.commit()
    for lt in created:
        db.refresh(lt)
    return created


# ── Leave Balance ──────────────────────────────────────────────

def _balance_to_dict(balance: LeaveBalance) -> dict:
    remaining = balance.entitled_days + balance.carried_over - balance.used_days
    return {
        "id": balance.id, "employee_id": balance.employee_id, "leave_type_id": balance.leave_type_id,
        "leave_type_name": balance.leave_type.name if balance.leave_type else None,
        "year": balance.year, "entitled_days": balance.entitled_days, "used_days": balance.used_days,
        "carried_over": balance.carried_over, "remaining_days": remaining,
    }


def initialize_balance(db: Session, payload: InitializeBalanceRequest) -> List[dict]:
    """
    Creates a LeaveBalance row per active LeaveType for the given employee/year,
    using each type's default_days_per_year as the entitlement. If
    carry_over_unused_from_prior_year is set, brings forward whatever was
    unused from the immediately preceding year (a common Thai employer policy
    for annual leave, though the statutory minimum doesn't require it — this
    is opt-in per call, not assumed).
    """
    employee = db.query(Employee).filter(Employee.id == payload.employee_id).first()
    if not employee:
        raise HTTPException(404, "ไม่พบพนักงาน")

    leave_types = get_leave_types(db)
    results = []

    for lt in leave_types:
        existing = db.query(LeaveBalance).filter(
            LeaveBalance.employee_id == payload.employee_id,
            LeaveBalance.leave_type_id == lt.id, LeaveBalance.year == payload.year,
        ).first()
        if existing:
            results.append(existing)
            continue

        carried_over = Decimal("0")
        if payload.carry_over_unused_from_prior_year:
            prior = db.query(LeaveBalance).filter(
                LeaveBalance.employee_id == payload.employee_id,
                LeaveBalance.leave_type_id == lt.id, LeaveBalance.year == payload.year - 1,
            ).first()
            if prior:
                remaining_prior = prior.entitled_days + prior.carried_over - prior.used_days
                carried_over = max(remaining_prior, Decimal("0"))

        balance = LeaveBalance(
            employee_id=payload.employee_id, leave_type_id=lt.id, year=payload.year,
            entitled_days=lt.default_days_per_year, used_days=Decimal("0"), carried_over=carried_over,
        )
        db.add(balance)
        results.append(balance)

    db.commit()
    for b in results:
        db.refresh(b)
    return [_balance_to_dict(b) for b in results]


def get_employee_balances(db: Session, employee_id: UUID, year: int) -> List[dict]:
    balances = db.query(LeaveBalance).filter(
        LeaveBalance.employee_id == employee_id, LeaveBalance.year == year,
    ).all()
    return [_balance_to_dict(b) for b in balances]


def _get_or_create_balance(db: Session, employee_id: UUID, leave_type_id: UUID, year: int) -> LeaveBalance:
    balance = db.query(LeaveBalance).filter(
        LeaveBalance.employee_id == employee_id, LeaveBalance.leave_type_id == leave_type_id,
        LeaveBalance.year == year,
    ).first()
    if balance:
        return balance
    leave_type = db.query(LeaveType).filter(LeaveType.id == leave_type_id).first()
    balance = LeaveBalance(
        employee_id=employee_id, leave_type_id=leave_type_id, year=year,
        entitled_days=leave_type.default_days_per_year if leave_type else Decimal("0"),
        used_days=Decimal("0"), carried_over=Decimal("0"),
    )
    db.add(balance); db.flush()
    return balance


# ── Leave Request ────────────────────────────────────────────

def _has_overlapping_request(db: Session, employee_id: UUID, start: date, end: date, exclude_id: Optional[UUID] = None) -> bool:
    q = db.query(LeaveRequest).filter(
        LeaveRequest.employee_id == employee_id,
        LeaveRequest.status.in_([LeaveRequestStatus.PENDING.value, LeaveRequestStatus.APPROVED.value]),
        LeaveRequest.start_date <= end, LeaveRequest.end_date >= start,
    )
    if exclude_id:
        q = q.filter(LeaveRequest.id != exclude_id)
    return q.first() is not None


def create_leave_request(db: Session, payload: LeaveRequestCreate) -> LeaveRequest:
    employee = db.query(Employee).filter(Employee.id == payload.employee_id).first()
    if not employee:
        raise HTTPException(404, "ไม่พบพนักงาน")
    leave_type = db.query(LeaveType).filter(LeaveType.id == payload.leave_type_id).first()
    if not leave_type:
        raise HTTPException(404, "ไม่พบประเภทการลา")

    if _has_overlapping_request(db, payload.employee_id, payload.start_date, payload.end_date):
        raise HTTPException(400, "มีคำขอลาที่ซ้อนทับช่วงเวลานี้อยู่แล้ว (รอดำเนินการหรืออนุมัติแล้ว)")

    # Only check balance for paid leave types with a finite entitlement —
    # unpaid leave (default_days_per_year == 0) has no cap to check against.
    if leave_type.is_paid and leave_type.default_days_per_year > 0:
        balance = _get_or_create_balance(db, payload.employee_id, payload.leave_type_id, payload.start_date.year)
        remaining = balance.entitled_days + balance.carried_over - balance.used_days
        if payload.days_requested > remaining:
            raise HTTPException(400,
                f"วันลาคงเหลือไม่พอ (คงเหลือ {remaining} วัน, ขอ {payload.days_requested} วัน)")

    request = LeaveRequest(
        employee_id=payload.employee_id, leave_type_id=payload.leave_type_id,
        start_date=payload.start_date, end_date=payload.end_date,
        days_requested=payload.days_requested, reason=payload.reason,
        status=LeaveRequestStatus.PENDING.value,
    )
    db.add(request); db.commit(); db.refresh(request)
    return request


def _request_to_dict(request: LeaveRequest) -> dict:
    return {
        "id": request.id, "employee_id": request.employee_id,
        "employee_name": request.employee.full_name if request.employee else None,
        "leave_type_id": request.leave_type_id,
        "leave_type_name": request.leave_type.name if request.leave_type else None,
        "start_date": request.start_date, "end_date": request.end_date,
        "days_requested": request.days_requested, "reason": request.reason,
        "status": request.status, "approved_at": request.approved_at,
        "rejection_reason": request.rejection_reason, "created_at": request.created_at,
    }


def get_leave_requests(db: Session, employee_id: Optional[UUID] = None, status: Optional[str] = None) -> List[dict]:
    q = db.query(LeaveRequest).filter(LeaveRequest.is_deleted == False)
    if employee_id:
        q = q.filter(LeaveRequest.employee_id == employee_id)
    if status:
        q = q.filter(LeaveRequest.status == status)
    requests = q.order_by(LeaveRequest.created_at.desc()).all()
    return [_request_to_dict(r) for r in requests]


def process_leave_request(db: Session, request_id: UUID, payload: LeaveApprovalRequest, user_id: Optional[UUID] = None) -> dict:
    request = db.query(LeaveRequest).filter(LeaveRequest.id == request_id).first()
    if not request:
        raise HTTPException(404, "ไม่พบคำขอลา")
    if request.status != LeaveRequestStatus.PENDING.value:
        raise HTTPException(400, "คำขอนี้ถูกดำเนินการไปแล้ว")

    if not payload.approve:
        request.status = LeaveRequestStatus.REJECTED.value
        request.rejection_reason = payload.rejection_reason
        request.approved_by = user_id
        request.approved_at = datetime.utcnow()
        db.commit(); db.refresh(request)
        return _request_to_dict(request)

    leave_type = db.query(LeaveType).filter(LeaveType.id == request.leave_type_id).first()
    if leave_type and leave_type.is_paid and leave_type.default_days_per_year > 0:
        balance = _get_or_create_balance(db, request.employee_id, request.leave_type_id, request.start_date.year)
        remaining = balance.entitled_days + balance.carried_over - balance.used_days
        if request.days_requested > remaining:
            # Re-check at approval time too — balance may have shifted since
            # the request was submitted (e.g. another request approved in between).
            raise HTTPException(400,
                f"วันลาคงเหลือไม่พอในขณะนี้ (คงเหลือ {remaining} วัน) — อาจมีการอนุมัติคำขออื่นไปก่อนหน้า")
        balance.used_days += request.days_requested

    request.status = LeaveRequestStatus.APPROVED.value
    request.approved_by = user_id
    request.approved_at = datetime.utcnow()
    db.commit(); db.refresh(request)
    return _request_to_dict(request)


def cancel_leave_request(db: Session, request_id: UUID, user_id: Optional[UUID] = None) -> dict:
    """
    Cancels a request. If it was already approved (days were deducted from
    balance), refunds those days back — this is the one place balance
    changes happen outside process_leave_request, so it's kept explicit here
    rather than folded into a generic "update status" helper that could
    silently skip the refund.
    """
    request = db.query(LeaveRequest).filter(LeaveRequest.id == request_id).first()
    if not request:
        raise HTTPException(404, "ไม่พบคำขอลา")
    if request.status == LeaveRequestStatus.CANCELLED.value:
        raise HTTPException(400, "คำขอนี้ถูกยกเลิกไปแล้ว")

    if request.status == LeaveRequestStatus.APPROVED.value:
        leave_type = db.query(LeaveType).filter(LeaveType.id == request.leave_type_id).first()
        if leave_type and leave_type.is_paid and leave_type.default_days_per_year > 0:
            balance = _get_or_create_balance(db, request.employee_id, request.leave_type_id, request.start_date.year)
            balance.used_days -= request.days_requested

    request.status = LeaveRequestStatus.CANCELLED.value
    db.commit(); db.refresh(request)
    return _request_to_dict(request)


# ── Team Calendar ──────────────────────────────────────────────

def get_team_calendar(db: Session, period_from: date, period_to: date) -> dict:
    requests = db.query(LeaveRequest).filter(
        LeaveRequest.status == LeaveRequestStatus.APPROVED.value,
        LeaveRequest.start_date <= period_to, LeaveRequest.end_date >= period_from,
    ).order_by(LeaveRequest.start_date).all()

    entries = [{
        "employee_id": r.employee_id, "employee_name": r.employee.full_name if r.employee else "—",
        "leave_type_name": r.leave_type.name if r.leave_type else "—",
        "start_date": r.start_date, "end_date": r.end_date, "days_requested": r.days_requested,
    } for r in requests]

    return {"period_from": period_from, "period_to": period_to, "entries": entries}


# ── Payroll Integration ─────────────────────────────────────────

def calc_unpaid_leave_deduction(db: Session, employee_id: UUID, period_month: int, period_year: int) -> dict:
    """
    Computes the salary deduction for approved unpaid leave within the given
    payroll period. Daily rate = monthly base_salary / calendar days in month
    (a common Thai payroll convention; some employers use working-days-only,
    which would need to be a configurable policy — not assumed here since
    it varies by company).
    """
    employee = db.query(Employee).filter(Employee.id == employee_id).first()
    if not employee:
        raise HTTPException(404, "ไม่พบพนักงาน")

    unpaid_type = db.query(LeaveType).filter(LeaveType.code == "UNPAID").first()
    if not unpaid_type:
        return {
            "employee_id": employee_id, "period_month": period_month, "period_year": period_year,
            "unpaid_days": Decimal("0"), "daily_rate": Decimal("0"), "deduction_amount": Decimal("0"),
            "explanation": "ไม่พบประเภทการลา UNPAID ในระบบ — ยังไม่ได้ตั้งค่า seed_default_leave_types",
        }

    period_start = date(period_year, period_month, 1)
    period_end = date(period_year, period_month, monthrange(period_year, period_month)[1])

    requests = db.query(LeaveRequest).filter(
        LeaveRequest.employee_id == employee_id, LeaveRequest.leave_type_id == unpaid_type.id,
        LeaveRequest.status == LeaveRequestStatus.APPROVED.value,
        LeaveRequest.start_date <= period_end, LeaveRequest.end_date >= period_start,
    ).all()

    unpaid_days = sum(r.days_requested for r in requests) or Decimal("0")

    days_in_month = Decimal(str(monthrange(period_year, period_month)[1]))
    daily_rate = (employee.base_salary / days_in_month).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP) if days_in_month > 0 else Decimal("0")
    deduction = (daily_rate * unpaid_days).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)

    explanation = (
        f"ลาไม่รับค่าจ้าง {unpaid_days} วัน ในเดือน {period_month}/{period_year} "
        f"× อัตราต่อวัน ฿{daily_rate:,.2f} (เงินเดือน ÷ {days_in_month} วันในเดือน) = ฿{deduction:,.2f}"
        if unpaid_days > 0 else "ไม่มีวันลาไม่รับค่าจ้างที่อนุมัติแล้วในงวดนี้"
    )

    return {
        "employee_id": employee_id, "period_month": period_month, "period_year": period_year,
        "unpaid_days": unpaid_days, "daily_rate": daily_rate, "deduction_amount": deduction,
        "explanation": explanation,
    }
