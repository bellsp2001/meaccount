"""
Accounting Service — Business logic for GL, Chart of Accounts, Journals
"""
from decimal import Decimal
from datetime import date, datetime
from typing import List, Optional
from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy import func, and_
from fastapi import HTTPException

from models.accounting import Account, Journal, JournalEntry, JournalStatus, AccountTypeEnum, NormalBalance
from schemas.accounting import AccountCreate, AccountUpdate, JournalCreate


# ── Chart of Accounts ──────────────────────────────────────────

def get_accounts(db: Session, include_inactive: bool = False) -> List[Account]:
    q = db.query(Account)
    if not include_inactive:
        q = q.filter(Account.is_active == True)
    return q.filter(Account.is_deleted == False).order_by(Account.code).all()


def get_account_tree(db: Session) -> List[Account]:
    """Return only root accounts; children loaded via relationship."""
    return (
        db.query(Account)
        .filter(Account.parent_id == None, Account.is_deleted == False)
        .order_by(Account.code)
        .all()
    )


def get_account_by_code(db: Session, code: str) -> Optional[Account]:
    return db.query(Account).filter(Account.code == code, Account.is_deleted == False).first()


def create_account(db: Session, payload: AccountCreate) -> Account:
    if get_account_by_code(db, payload.code):
        raise HTTPException(400, f"รหัสบัญชี {payload.code} มีอยู่แล้ว")
    if payload.parent_id:
        parent = db.query(Account).filter(Account.id == payload.parent_id).first()
        if not parent:
            raise HTTPException(404, "ไม่พบบัญชีแม่")

    acc = Account(**payload.model_dump())
    db.add(acc)
    db.commit()
    db.refresh(acc)
    return acc


def update_account(db: Session, account_id: UUID, payload: AccountUpdate) -> Account:
    acc = db.query(Account).filter(Account.id == account_id, Account.is_deleted == False).first()
    if not acc:
        raise HTTPException(404, "ไม่พบบัญชี")
    for k, v in payload.model_dump(exclude_none=True).items():
        setattr(acc, k, v)
    db.commit()
    db.refresh(acc)
    return acc


def delete_account(db: Session, account_id: UUID):
    acc = db.query(Account).filter(Account.id == account_id).first()
    if not acc:
        raise HTTPException(404, "ไม่พบบัญชี")
    if acc.balance != 0:
        raise HTTPException(400, "ไม่สามารถลบบัญชีที่มียอดคงเหลือ")
    acc.is_deleted = True
    db.commit()


# ── Journal Number Generator ───────────────────────────────────

def next_journal_number(db: Session, journal_date: date) -> str:
    year  = journal_date.year
    month = journal_date.month
    prefix = f"JV-{year}{month:02d}-"
    last = (
        db.query(Journal)
        .filter(Journal.number.like(f"{prefix}%"))
        .order_by(Journal.number.desc())
        .first()
    )
    seq = 1
    if last:
        try:
            seq = int(last.number.split("-")[-1]) + 1
        except ValueError:
            pass
    return f"{prefix}{seq:04d}"


# ── Journal / GL ───────────────────────────────────────────────

def create_journal(db: Session, payload: JournalCreate, user_id: Optional[UUID] = None) -> Journal:
    number = next_journal_number(db, payload.date)

    journal = Journal(
        number=number,
        date=payload.date,
        description=payload.description,
        reference=payload.reference,
        note=payload.note,
        status=JournalStatus.DRAFT,
        created_by=user_id,
    )
    db.add(journal)
    db.flush()  # get journal.id

    for i, e in enumerate(payload.entries):
        acc = db.query(Account).filter(Account.id == e.account_id, Account.is_deleted == False).first()
        if not acc:
            raise HTTPException(404, f"ไม่พบบัญชี id={e.account_id}")
        entry = JournalEntry(
            journal_id=journal.id,
            account_id=e.account_id,
            debit=e.debit,
            credit=e.credit,
            description=e.description,
            sequence=i,
        )
        db.add(entry)

    db.commit()
    db.refresh(journal)
    return journal


def post_journal(db: Session, journal_id: UUID, user_id: Optional[UUID] = None) -> Journal:
    """Post journal: update account balances."""
    journal = db.query(Journal).filter(Journal.id == journal_id).first()
    if not journal:
        raise HTTPException(404, "ไม่พบ Journal")
    if journal.status == JournalStatus.POSTED:
        raise HTTPException(400, "Journal นี้ถูก Post ไปแล้ว")

    for entry in journal.entries:
        acc = db.query(Account).filter(Account.id == entry.account_id).first()
        if acc:
            # Normal balance = Debit → Dr increases, Cr decreases
            if acc.normal_balance == NormalBalance.DEBIT:
                acc.balance += entry.debit - entry.credit
            else:
                acc.balance += entry.credit - entry.debit

    journal.status = JournalStatus.POSTED
    journal.posted_by = user_id
    db.commit()
    db.refresh(journal)
    return journal


def get_journals(
    db: Session,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    status: Optional[JournalStatus] = None,
    skip: int = 0,
    limit: int = 50,
) -> List[Journal]:
    q = db.query(Journal).filter(Journal.is_deleted == False)
    if date_from:
        q = q.filter(Journal.date >= date_from)
    if date_to:
        q = q.filter(Journal.date <= date_to)
    if status:
        q = q.filter(Journal.status == status)
    return q.order_by(Journal.date.desc(), Journal.number.desc()).offset(skip).limit(limit).all()


def get_ledger(
    db: Session,
    account_id: UUID,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
) -> dict:
    """Return ledger entries + running balance for an account."""
    acc = db.query(Account).filter(Account.id == account_id).first()
    if not acc:
        raise HTTPException(404, "ไม่พบบัญชี")

    q = (
        db.query(JournalEntry)
        .join(Journal)
        .filter(
            JournalEntry.account_id == account_id,
            Journal.status == JournalStatus.POSTED,
        )
    )
    if date_from:
        q = q.filter(Journal.date >= date_from)
    if date_to:
        q = q.filter(Journal.date <= date_to)

    entries = q.order_by(Journal.date, Journal.number).all()

    running = Decimal("0")
    rows = []
    for e in entries:
        if acc.normal_balance == NormalBalance.DEBIT:
            running += e.debit - e.credit
        else:
            running += e.credit - e.debit
        rows.append({
            "journal_number": e.journal.number,
            "date":           e.journal.date,
            "description":    e.description or e.journal.description,
            "debit":          e.debit,
            "credit":         e.credit,
            "balance":        running,
        })

    return {"account": acc, "entries": rows, "closing_balance": running}
