from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID
from datetime import date

from core.database import get_db
from core.deps import get_current_user, require_accountant_up
from models.user import User
from models.accounting import JournalStatus
from schemas.accounting import (
    JournalCreate, JournalResponse,
    AISuggestRequest, AISuggestResponse,
)
from services.accounting import (
    create_journal, post_journal,
    get_journals, get_ledger,
)
from services.ai_accounting import suggest_journal_entries

router = APIRouter(prefix="/journals", tags=["General Ledger"])


@router.get("/", response_model=List[JournalResponse])
def list_journals(
    date_from:  Optional[date] = None,
    date_to:    Optional[date] = None,
    status:     Optional[JournalStatus] = None,
    skip:       int = 0,
    limit:      int = 50,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    journals = get_journals(db, date_from, date_to, status, skip, limit)
    # attach totals
    from decimal import Decimal
    result = []
    for j in journals:
        td = sum(e.debit  for e in j.entries)
        tc = sum(e.credit for e in j.entries)
        jr = JournalResponse.model_validate(j)
        jr.total_debit  = td
        jr.total_credit = tc
        # attach account info to entries
        for er, entry in zip(jr.entries, j.entries):
            if entry.account:
                er.account_code = entry.account.code
                er.account_name = entry.account.name
        result.append(jr)
    return result


@router.post("/", response_model=JournalResponse)
def create_journal_endpoint(
    payload: JournalCreate,
    current_user: User = Depends(require_accountant_up),
    db: Session = Depends(get_db),
):
    return create_journal(db, payload, user_id=current_user.id)


@router.get("/{journal_id}", response_model=JournalResponse)
def get_journal(
    journal_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from models.accounting import Journal
    from fastapi import HTTPException
    j = db.query(Journal).filter(Journal.id == journal_id).first()
    if not j:
        raise HTTPException(404, "ไม่พบ Journal")
    return j


@router.post("/{journal_id}/post", response_model=JournalResponse)
def post_journal_endpoint(
    journal_id: UUID,
    current_user: User = Depends(require_accountant_up),
    db: Session = Depends(get_db),
):
    return post_journal(db, journal_id, user_id=current_user.id)


@router.get("/ledger/{account_id}")
def get_account_ledger(
    account_id: UUID,
    date_from:  Optional[date] = None,
    date_to:    Optional[date] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return get_ledger(db, account_id, date_from, date_to)


# ── AI Endpoint ────────────────────────────────────────────────
@router.post("/ai/suggest", response_model=AISuggestResponse)
def ai_suggest(
    payload: AISuggestRequest,
    current_user: User = Depends(require_accountant_up),
    db: Session = Depends(get_db),
):
    """AI แนะนำการลงบัญชีจากคำอธิบายภาษาไทย"""
    return suggest_journal_entries(
        db,
        description=payload.description,
        amount=payload.amount,
        transaction_date=payload.date,
    )
