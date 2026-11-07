"""
Ledger Reports — งบทดลอง (trial balance) and บัญชีแยกประเภท (general ledger),
computed from posted journal entries rather than the running Account.balance.
"""
from decimal import Decimal
from datetime import date
from typing import Optional
from uuid import UUID
from collections import defaultdict
from sqlalchemy import func
from sqlalchemy.orm import Session
from fastapi import HTTPException

from models.accounting import Account, Journal, JournalEntry, JournalStatus, NormalBalance

ZERO = Decimal("0")


def _posted(q):
    return q.filter(Journal.status == JournalStatus.POSTED, Journal.is_deleted == False)


def _signed(acc: Account, debit: Decimal, credit: Decimal) -> Decimal:
    """Balance in the account's normal direction (positive = normal side)."""
    return debit - credit if acc.normal_balance == NormalBalance.DEBIT else credit - debit


def trial_balance(db: Session, period_from: date, period_to: date) -> dict:
    if period_from > period_to:
        raise HTTPException(400, "วันที่เริ่มต้องไม่เกินวันที่สิ้นสุด")

    def sums(*conds):
        q = (db.query(JournalEntry.account_id,
                      func.coalesce(func.sum(JournalEntry.debit), 0),
                      func.coalesce(func.sum(JournalEntry.credit), 0))
               .join(Journal, Journal.id == JournalEntry.journal_id))
        rows = _posted(q).filter(*conds).group_by(JournalEntry.account_id).all()
        return {aid: (Decimal(str(d)), Decimal(str(c))) for aid, d, c in rows}

    opening = sums(Journal.date < period_from)
    period  = sums(Journal.date >= period_from, Journal.date <= period_to)

    ids = set(opening) | set(period)
    accounts = (db.query(Account).filter(Account.id.in_(ids)).order_by(Account.code).all() if ids else [])

    rows, totals = [], defaultdict(lambda: ZERO)
    for acc in accounts:
        od, oc = opening.get(acc.id, (ZERO, ZERO))
        pd, pc = period.get(acc.id, (ZERO, ZERO))
        net = (od + pd) - (oc + pc)          # closing, debit-positive
        row = {
            "account_id": acc.id, "code": acc.code, "name": acc.name,
            "account_type": acc.account_type.value,
            "opening": _signed(acc, od, oc),
            "debit": pd, "credit": pc,
            "closing_debit":  net if net > 0 else ZERO,
            "closing_credit": -net if net < 0 else ZERO,
        }
        rows.append(row)
        for k in ("debit", "credit", "closing_debit", "closing_credit"):
            totals[k] += row[k]

    return {
        "period_from": str(period_from), "period_to": str(period_to),
        "rows": rows, "totals": dict(totals) or {k: ZERO for k in ("debit", "credit", "closing_debit", "closing_credit")},
        "balanced": totals["closing_debit"] == totals["closing_credit"],
    }


def general_ledger(db: Session, account_id: UUID, period_from: date, period_to: date) -> dict:
    acc = db.query(Account).filter(Account.id == account_id, Account.is_deleted == False).first()
    if not acc:
        raise HTTPException(404, "ไม่พบบัญชี")

    od, oc = (_posted(db.query(func.coalesce(func.sum(JournalEntry.debit), 0),
                               func.coalesce(func.sum(JournalEntry.credit), 0))
                        .join(Journal, Journal.id == JournalEntry.journal_id))
              .filter(JournalEntry.account_id == account_id, Journal.date < period_from).one())
    opening = _signed(acc, Decimal(str(od)), Decimal(str(oc)))

    entries = (_posted(db.query(JournalEntry, Journal).join(Journal, Journal.id == JournalEntry.journal_id))
               .filter(JournalEntry.account_id == account_id,
                       Journal.date >= period_from, Journal.date <= period_to)
               .order_by(Journal.date, Journal.number).all())

    balance, lines = opening, []
    for e, j in entries:
        balance += _signed(acc, e.debit, e.credit)
        lines.append({
            "date": str(j.date), "journal_id": j.id, "journal_number": j.number,
            "journal_type": j.journal_type.value if j.journal_type else None,
            "reference": j.reference, "description": e.description or j.description,
            "debit": e.debit, "credit": e.credit, "balance": balance,
        })

    return {
        "account": {"id": acc.id, "code": acc.code, "name": acc.name,
                    "normal_balance": acc.normal_balance.value},
        "period_from": str(period_from), "period_to": str(period_to),
        "opening": opening, "closing": balance,
        "total_debit": sum((l["debit"] for l in lines), ZERO),
        "total_credit": sum((l["credit"] for l in lines), ZERO),
        "lines": lines,
    }
