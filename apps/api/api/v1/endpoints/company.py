from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import List
from uuid import UUID
from datetime import date

from core.database import get_db
from core.deps import get_current_user, require_admin, require_accountant_up
from models.user import User
from schemas.company import (
    CompanyCreate, CompanyResponse, CompanyUserAssign,
    IntercompanyCreate, IntercompanyResponse, IntercompanyBalanceCheck,
    ConsolidatedPLResponse,
)
from services.company import (
    get_companies, create_company, assign_user_to_company,
    create_intercompany_transaction, post_intercompany_transaction,
    check_intercompany_balance, get_consolidated_pl,
)

router = APIRouter(prefix="/companies", tags=["Multi-Company & Consolidation"])


@router.get("/", response_model=List[CompanyResponse])
def list_companies_ep(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    # Admins see every company; other roles only see companies they've been assigned to.
    user_id = None if current_user.role.value == "admin" else current_user.id
    return get_companies(db, user_id)


@router.post("/", response_model=CompanyResponse)
def create_company_ep(payload: CompanyCreate, current_user: User = Depends(require_admin), db: Session = Depends(get_db)):
    return create_company(db, payload)


@router.post("/{company_id}/users", status_code=200)
def assign_user_ep(company_id: UUID, payload: CompanyUserAssign,
                   current_user: User = Depends(require_admin), db: Session = Depends(get_db)):
    assign_user_to_company(db, company_id, payload.user_id, payload.is_default)
    return {"message": "เพิ่มสิทธิ์เข้าถึงบริษัทเรียบร้อย"}


# ── Intercompany ─────────────────────────────────────────────
@router.post("/intercompany", response_model=IntercompanyResponse)
def create_ic_ep(payload: IntercompanyCreate, current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return create_intercompany_transaction(db, payload, current_user.id)


@router.post("/intercompany/{ic_id}/post", response_model=IntercompanyResponse)
def post_ic_ep(ic_id: UUID, current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return post_intercompany_transaction(db, ic_id, current_user.id)


@router.get("/intercompany/balance-check", response_model=IntercompanyBalanceCheck)
def ic_balance_check_ep(current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return check_intercompany_balance(db)


# ── Consolidated Statements ────────────────────────────────────
@router.get("/consolidated/profit-loss", response_model=ConsolidatedPLResponse)
def consolidated_pl_ep(
    company_ids: List[UUID] = Query(...),
    period_from: date = Query(...), period_to: date = Query(...),
    current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db),
):
    return get_consolidated_pl(db, company_ids, period_from, period_to)
