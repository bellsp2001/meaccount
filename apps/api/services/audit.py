"""
Audit Service — Audit Log query, Balance integrity checks
"""
from decimal import Decimal
from datetime import date, datetime, timedelta
from typing import List, Optional
from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy import func, or_

from models.user import User, AuditLog
from models.accounting import Account, Journal, JournalEntry, JournalStatus, NormalBalance
from schemas.audit import AuditLogResponse, BalanceCheckItem, BalanceCheckResponse


# ── Audit Log Query ────────────────────────────────────────────

def get_audit_logs(
    db: Session,
    user_id: Optional[UUID] = None,
    action: Optional[str] = None,
    resource: Optional[str] = None,
    date_from: Optional[date] = None,
    date_to: Optional[date] = None,
    skip: int = 0, limit: int = 100,
) -> List[dict]:
    q = db.query(AuditLog)
    if user_id:    q = q.filter(AuditLog.user_id == user_id)
    if action:     q = q.filter(AuditLog.action == action)
    if resource:   q = q.filter(AuditLog.resource == resource)
    if date_from:  q = q.filter(AuditLog.created_at >= date_from)
    if date_to:    q = q.filter(AuditLog.created_at <= datetime.combine(date_to, datetime.max.time()))

    logs = q.order_by(AuditLog.created_at.desc()).offset(skip).limit(limit).all()

    result = []
    for log in logs:
        user = db.query(User).filter(User.id == log.user_id).first() if log.user_id else None
        result.append({
            "id": log.id, "user_id": log.user_id,
            "user_email": user.email if user else None,
            "action": log.action, "resource": log.resource,
            "resource_id": log.resource_id, "detail": log.detail,
            "ip_address": log.ip_address, "created_at": log.created_at,
        })
    return result


def log_action(db: Session, user_id: Optional[UUID], action: str, resource: str,
               resource_id: Optional[str] = None, detail: Optional[str] = None,
               ip_address: Optional[str] = None):
    """Helper สำหรับบันทึก Audit Log จาก endpoint อื่นๆ"""
    log = AuditLog(user_id=user_id, action=action, resource=resource,
                   resource_id=resource_id, detail=detail, ip_address=ip_address)
    db.add(log)
    db.commit()


# ── Balance Integrity Checks ────────────────────────────────────

def run_balance_checks(db: Session, as_of_date: date) -> BalanceCheckResponse:
    """ตรวจสอบความสมดุลของบัญชีทุกระดับ"""
    checks: List[BalanceCheckItem] = []

    # 1. Trial balance: total debit = total credit across all posted journals
    totals = db.query(
        func.sum(JournalEntry.debit).label("td"),
        func.sum(JournalEntry.credit).label("tc"),
    ).join(Journal, JournalEntry.journal_id == Journal.id).filter(
        Journal.status == JournalStatus.POSTED, Journal.date <= as_of_date,
    ).first()
    td = totals.td or Decimal("0")
    tc = totals.tc or Decimal("0")
    balanced = abs(td - tc) < Decimal("0.01")
    checks.append(BalanceCheckItem(
        check_name="Trial Balance (Debit = Credit)",
        passed=balanced,
        detail=f"Total Debit: ฿{td:,.2f} | Total Credit: ฿{tc:,.2f}" + (f" | ส่วนต่าง: ฿{abs(td-tc):,.2f}" if not balanced else ""),
        severity="high" if not balanced else "info",
    ))

    # 2. Each individual journal must balance
    unbalanced_journals = db.query(Journal).join(JournalEntry).filter(
        Journal.status == JournalStatus.POSTED, Journal.date <= as_of_date,
    ).group_by(Journal.id).having(
        func.sum(JournalEntry.debit) != func.sum(JournalEntry.credit)
    ).all()
    checks.append(BalanceCheckItem(
        check_name="Individual Journal Balance",
        passed=len(unbalanced_journals) == 0,
        detail=f"พบ Journal ไม่สมดุล {len(unbalanced_journals)} รายการ" if unbalanced_journals
               else "ทุก Journal สมดุล (Dr = Cr)",
        severity="high" if unbalanced_journals else "info",
    ))

    # 3. Balance Sheet equation: Assets = Liabilities + Equity
    from services.reports import get_balance_sheet
    bs = get_balance_sheet(db, as_of_date)
    checks.append(BalanceCheckItem(
        check_name="Balance Sheet Equation",
        passed=bs.is_balanced,
        detail=f"สินทรัพย์ ฿{bs.total_assets:,.2f} vs หนี้สิน+ทุน ฿{bs.total_liab_equity:,.2f}",
        severity="high" if not bs.is_balanced else "info",
    ))

    # 4. No accounts with negative balance where not expected (assets/expense should be >= 0 typically)
    negative_assets = db.query(Account).filter(
        Account.account_type.in_(["asset"]),
        Account.balance < 0, Account.is_active == True,
    ).all()
    checks.append(BalanceCheckItem(
        check_name="No Negative Asset Balances",
        passed=len(negative_assets) == 0,
        detail=f"พบบัญชีสินทรัพย์ติดลบ {len(negative_assets)} บัญชี: " + ", ".join(a.name for a in negative_assets[:3])
               if negative_assets else "ไม่พบบัญชีสินทรัพย์ติดลบ",
        severity="medium" if negative_assets else "info",
    ))

    # 5. Orphaned journal entries (entry without valid journal)
    orphan_count = db.query(JournalEntry).outerjoin(Journal).filter(Journal.id == None).count()
    checks.append(BalanceCheckItem(
        check_name="No Orphaned Journal Entries",
        passed=orphan_count == 0,
        detail=f"พบ Journal Entry ที่ไม่มี Journal แม่ {orphan_count} รายการ" if orphan_count else "ไม่พบ Orphaned Entries",
        severity="high" if orphan_count else "info",
    ))

    all_passed = all(c.passed for c in checks)
    return BalanceCheckResponse(as_of_date=as_of_date, all_passed=all_passed, checks=checks)
