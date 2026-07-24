from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID

from core.database import get_db
from core.deps import get_current_user, require_accountant_up, require_manager_up
from models.user import User
from models.payroll import EmployeeStatus
from schemas.payroll import (
    EmployeeCreate, EmployeeUpdate, EmployeeResponse,
    PayslipCreate, PayslipResponse,
    PayrollRunRequest, PayrollRunResult,
    TaxCheckRequest, TaxCheckResponse,
)
from services.payroll import (
    get_employees, create_employee, update_employee,
    create_payslip, run_payroll, get_payslips,
    approve_payslip, post_payslip_to_gl, get_payroll_summary,
)
from services.ai_payroll import check_withholding_tax, analyze_salary_structure

router = APIRouter(prefix="/payroll", tags=["Payroll & HR"])


# ── Employee ───────────────────────────────────────────────────
@router.get("/employees", response_model=List[EmployeeResponse])
def list_employees(search: Optional[str] = None, status: Optional[EmployeeStatus] = None,
                   current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_employees(db, search, status)

@router.post("/employees", response_model=EmployeeResponse)
def create_employee_ep(payload: EmployeeCreate, current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return create_employee(db, payload)

@router.get("/employees/{eid}", response_model=EmployeeResponse)
def get_employee(eid: UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from models.payroll import Employee
    from fastapi import HTTPException
    e = db.query(Employee).filter(Employee.id == eid, Employee.is_deleted == False).first()
    if not e: raise HTTPException(404, "ไม่พบพนักงาน")
    return e

@router.patch("/employees/{eid}", response_model=EmployeeResponse)
def update_employee_ep(eid: UUID, payload: EmployeeUpdate, current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return update_employee(db, eid, payload)


# ── Payslip ────────────────────────────────────────────────────
@router.get("/payslips", response_model=List[PayslipResponse])
def list_payslips(employee_id: Optional[UUID] = None, period_month: Optional[int] = None,
                  period_year: Optional[int] = None,
                  current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_payslips(db, employee_id, period_month, period_year)

@router.post("/payslips", response_model=PayslipResponse)
def create_payslip_ep(payload: PayslipCreate, current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return create_payslip(db, payload, current_user.id)

@router.post("/payslips/{pid}/approve", response_model=PayslipResponse)
def approve_payslip_ep(pid: UUID, current_user: User = Depends(require_manager_up), db: Session = Depends(get_db)):
    return approve_payslip(db, pid)

@router.post("/payslips/{pid}/post-gl", response_model=PayslipResponse)
def post_payslip_ep(pid: UUID, current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return post_payslip_to_gl(db, pid, current_user.id)


# ── Bulk Run ───────────────────────────────────────────────────
@router.post("/run", response_model=PayrollRunResult)
def run_payroll_ep(payload: PayrollRunRequest, current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return run_payroll(db, payload, current_user.id)

@router.get("/summary")
def payroll_summary_ep(year: int = Query(...), month: int = Query(...),
                       current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_payroll_summary(db, year, month)


# ── AI ─────────────────────────────────────────────────────────
@router.post("/ai/check-tax", response_model=TaxCheckResponse)
def check_tax_ep(payload: TaxCheckRequest, current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return check_withholding_tax(db, payload.employee_id, payload.period_month, payload.period_year)

@router.get("/ai/salary-analysis")
def salary_analysis_ep(current_user: User = Depends(require_manager_up), db: Session = Depends(get_db)):
    return analyze_salary_structure(db)
