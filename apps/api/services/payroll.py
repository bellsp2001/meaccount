"""
Payroll Service — Employee CRUD, Payslip generation, Bulk run, Auto-GL posting
"""
from decimal import Decimal
from datetime import date
from typing import List, Optional
from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy import or_, and_
from fastapi import HTTPException

from models.payroll import Employee, Payslip, EmployeeStatus, PayslipStatus
from models.accounting import Account, Journal, JournalEntry, JournalStatus, NormalBalance
from services.accounting import next_journal_number
from services.tax_calc import calc_payslip
from schemas.payroll import EmployeeCreate, EmployeeUpdate, PayslipCreate, PayrollRunRequest


# ── Employee ───────────────────────────────────────────────────

def get_employees(db: Session, search: Optional[str] = None,
                  status: Optional[EmployeeStatus] = None) -> List[Employee]:
    q = db.query(Employee).filter(Employee.is_deleted == False)
    if search:
        q = q.filter(or_(Employee.full_name.ilike(f"%{search}%"), Employee.employee_code.ilike(f"%{search}%")))
    if status:
        q = q.filter(Employee.status == status)
    return q.order_by(Employee.employee_code).all()


def create_employee(db: Session, payload: EmployeeCreate) -> Employee:
    if db.query(Employee).filter(Employee.employee_code == payload.employee_code).first():
        raise HTTPException(400, f"รหัสพนักงาน {payload.employee_code} มีอยู่แล้ว")
    e = Employee(**payload.model_dump())
    db.add(e); db.commit(); db.refresh(e)
    return e


def update_employee(db: Session, eid: UUID, payload: EmployeeUpdate) -> Employee:
    e = db.query(Employee).filter(Employee.id == eid, Employee.is_deleted == False).first()
    if not e:
        raise HTTPException(404, "ไม่พบพนักงาน")
    for k, v in payload.model_dump(exclude_none=True).items():
        setattr(e, k, v)
    db.commit(); db.refresh(e)
    return e


# ── Payslip Number ─────────────────────────────────────────────

def next_payslip_number(db: Session, employee_code: str, year: int, month: int) -> str:
    return f"PS-{year}{month:02d}-{employee_code}"


# ── Generate single payslip ────────────────────────────────────

def create_payslip(db: Session, payload: PayslipCreate, user_id: Optional[UUID] = None) -> Payslip:
    emp = db.query(Employee).filter(Employee.id == payload.employee_id, Employee.is_deleted == False).first()
    if not emp:
        raise HTTPException(404, "ไม่พบพนักงาน")

    number = next_payslip_number(db, emp.employee_code, payload.period_year, payload.period_month)
    if db.query(Payslip).filter(Payslip.number == number).first():
        raise HTTPException(400, f"มีสลิปเงินเดือนของ {emp.employee_code} งวด {payload.period_month}/{payload.period_year} แล้ว")

    calc = calc_payslip(
        base_salary=emp.base_salary,
        ot_hours=payload.ot_hours, ot_rate=payload.ot_rate,
        allowance=payload.allowance, bonus=payload.bonus,
        other_deduction=payload.other_deduction,
        marital_status=emp.marital_status.value if hasattr(emp.marital_status, "value") else emp.marital_status,
        num_children=emp.num_children,
        sso_enrolled=emp.sso_enrolled,
    )

    payslip = Payslip(
        number=number, employee_id=emp.id,
        period_month=payload.period_month, period_year=payload.period_year,
        pay_date=payload.pay_date, status=PayslipStatus.DRAFT,
        base_salary=emp.base_salary, ot_hours=payload.ot_hours, ot_rate=payload.ot_rate,
        ot_amount=calc["ot_amount"], allowance=payload.allowance, bonus=payload.bonus,
        gross_pay=calc["gross_pay"], sso_employee=calc["sso_employee"],
        withholding_tax=calc["withholding_tax"], other_deduction=payload.other_deduction,
        total_deduction=calc["total_deduction"], net_pay=calc["net_pay"],
        sso_employer=calc["sso_employer"], note=payload.note, created_by=user_id,
    )
    db.add(payslip); db.commit(); db.refresh(payslip)
    return payslip


# ── Bulk Payroll Run ────────────────────────────────────────────

def run_payroll(db: Session, payload: PayrollRunRequest, user_id: Optional[UUID] = None) -> dict:
    q = db.query(Employee).filter(Employee.status == EmployeeStatus.ACTIVE, Employee.is_deleted == False)
    if payload.employee_ids:
        q = q.filter(Employee.id.in_(payload.employee_ids))
    employees = q.all()

    if not employees:
        raise HTTPException(400, "ไม่พบพนักงานที่ Active")

    payslips = []
    skipped = []
    for emp in employees:
        number = next_payslip_number(db, emp.employee_code, payload.period_year, payload.period_month)
        if db.query(Payslip).filter(Payslip.number == number).first():
            skipped.append(emp.employee_code)
            continue

        calc = calc_payslip(
            base_salary=emp.base_salary,
            marital_status=emp.marital_status.value if hasattr(emp.marital_status, "value") else emp.marital_status,
            num_children=emp.num_children, sso_enrolled=emp.sso_enrolled,
        )
        ps = Payslip(
            number=number, employee_id=emp.id,
            period_month=payload.period_month, period_year=payload.period_year,
            pay_date=payload.pay_date, status=PayslipStatus.DRAFT,
            base_salary=emp.base_salary, gross_pay=calc["gross_pay"],
            sso_employee=calc["sso_employee"], withholding_tax=calc["withholding_tax"],
            total_deduction=calc["total_deduction"], net_pay=calc["net_pay"],
            sso_employer=calc["sso_employer"], created_by=user_id,
        )
        db.add(ps)
        payslips.append(ps)

    db.commit()
    for ps in payslips:
        db.refresh(ps)

    return {
        "total_employees": len(payslips),
        "total_gross": sum(p.gross_pay for p in payslips),
        "total_net":   sum(p.net_pay for p in payslips),
        "total_sso":   sum(p.sso_employee for p in payslips),
        "total_wht":   sum(p.withholding_tax for p in payslips),
        "payslips": payslips,
        "skipped": skipped,
    }


def get_payslips(db: Session, employee_id: Optional[UUID] = None,
                 period_month: Optional[int] = None, period_year: Optional[int] = None) -> List[Payslip]:
    q = db.query(Payslip)
    if employee_id:   q = q.filter(Payslip.employee_id == employee_id)
    if period_month:  q = q.filter(Payslip.period_month == period_month)
    if period_year:   q = q.filter(Payslip.period_year == period_year)
    return q.order_by(Payslip.period_year.desc(), Payslip.period_month.desc()).all()


def approve_payslip(db: Session, payslip_id: UUID) -> Payslip:
    ps = db.query(Payslip).filter(Payslip.id == payslip_id).first()
    if not ps:
        raise HTTPException(404, "ไม่พบสลิปเงินเดือน")
    if ps.status != PayslipStatus.DRAFT:
        raise HTTPException(400, "เฉพาะสลิปสถานะ Draft เท่านั้นที่อนุมัติได้")
    ps.status = PayslipStatus.APPROVED
    db.commit(); db.refresh(ps)
    return ps


# ── GL Posting ─────────────────────────────────────────────────

def post_payslip_to_gl(db: Session, payslip_id: UUID, user_id: Optional[UUID] = None) -> Payslip:
    """
    Post payslip → GL:
    Dr เงินเดือนและค่าจ้าง (gross_pay)
    Dr ประกันสังคม (นายจ้างสมทบ)
       Cr เงินสด/ธนาคาร (net_pay)
       Cr ภาษีหัก ณ ที่จ่ายค้างจ่าย (WHT)
       Cr ประกันสังคมค้างจ่าย (SSO employee + employer)
    """
    ps = db.query(Payslip).filter(Payslip.id == payslip_id).first()
    if not ps:
        raise HTTPException(404, "ไม่พบสลิปเงินเดือน")
    if ps.gl_posted:
        raise HTTPException(400, "สลิปนี้ Post GL แล้ว")
    if ps.status not in (PayslipStatus.APPROVED, PayslipStatus.DRAFT):
        raise HTTPException(400, "สลิปต้องอยู่ในสถานะ Approved ก่อน Post GL")

    salary_acc = _find_acc(db, ["5201","52"])
    sso_exp_acc= _find_acc(db, ["5202","52"])
    bank_acc   = _find_acc(db, ["1102","1101","11"])
    wht_acc    = _find_acc(db, ["2104","21"])
    sso_pay_acc= _find_acc(db, ["2106","2105","21"])

    if not salary_acc or not bank_acc:
        raise HTTPException(400, "ไม่พบบัญชีเงินเดือนหรือธนาคารในผังบัญชี")

    total_sso = ps.sso_employee + ps.sso_employer

    entries = [
        {"account_id": salary_acc.id, "debit": ps.gross_pay, "credit": Decimal("0"), "description": f"เงินเดือน {ps.number}"},
    ]
    if sso_exp_acc and ps.sso_employer > 0:
        entries.append({"account_id": sso_exp_acc.id, "debit": ps.sso_employer, "credit": Decimal("0"), "description": f"ประกันสังคมนายจ้าง {ps.number}"})

    entries.append({"account_id": bank_acc.id, "debit": Decimal("0"), "credit": ps.net_pay, "description": f"จ่ายเงินเดือนสุทธิ {ps.number}"})

    if wht_acc and ps.withholding_tax > 0:
        entries.append({"account_id": wht_acc.id, "debit": Decimal("0"), "credit": ps.withholding_tax, "description": f"ภาษีหัก ณ ที่จ่าย {ps.number}"})

    if sso_pay_acc and total_sso > 0:
        entries.append({"account_id": sso_pay_acc.id, "debit": Decimal("0"), "credit": total_sso, "description": f"ประกันสังคมค้างนำส่ง {ps.number}"})

    j = Journal(
        number=next_journal_number(db, ps.pay_date), date=ps.pay_date,
        description=f"จ่ายเงินเดือน {ps.number}", reference=ps.number,
        status=JournalStatus.POSTED, created_by=user_id,
    )
    db.add(j); db.flush()
    for ed in entries:
        db.add(JournalEntry(journal_id=j.id, **ed))
        acc = db.query(Account).filter(Account.id == ed["account_id"]).first()
        if acc:
            if acc.normal_balance == NormalBalance.DEBIT:
                acc.balance += ed["debit"] - ed["credit"]
            else:
                acc.balance += ed["credit"] - ed["debit"]

    ps.gl_posted = True
    ps.status = PayslipStatus.PAID
    db.commit(); db.refresh(ps)
    return ps


def get_payroll_summary(db: Session, year: int, month: int) -> dict:
    payslips = db.query(Payslip).filter(Payslip.period_year == year, Payslip.period_month == month).all()
    return {
        "period": f"{month:02d}/{year}",
        "employee_count": len(payslips),
        "total_gross": float(sum(p.gross_pay for p in payslips)),
        "total_net":   float(sum(p.net_pay for p in payslips)),
        "total_sso_employee": float(sum(p.sso_employee for p in payslips)),
        "total_sso_employer": float(sum(p.sso_employer for p in payslips)),
        "total_wht":   float(sum(p.withholding_tax for p in payslips)),
        "posted_count": sum(1 for p in payslips if p.gl_posted),
    }


def _find_acc(db: Session, prefixes: List[str]) -> Optional[Account]:
    for p in prefixes:
        a = db.query(Account).filter(Account.code.like(f"{p}%"), Account.is_active == True, Account.is_deleted == False).first()
        if a:
            return a
    return None
