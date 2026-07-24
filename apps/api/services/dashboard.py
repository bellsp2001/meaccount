"""
Dashboard Service — KPI aggregation, charts data, AI insights
"""
from decimal import Decimal
from datetime import date, timedelta, datetime
from typing import Optional, List, Dict
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, extract

from models.ar import Invoice, Payment as ARPayment, InvoiceStatus
from models.ap import Bill, APPayment, BillStatus
from models.accounting import Account, Journal, JournalEntry, JournalStatus, AccountTypeEnum


def get_kpi(db: Session) -> dict:
    """หน้า Dashboard KPI cards"""
    today = date.today()
    month_start = today.replace(day=1)
    last_month_start = (month_start - timedelta(days=1)).replace(day=1)
    last_month_end   = month_start - timedelta(days=1)

    # Revenue this month (posted journals in 4xxx accounts)
    revenue_this  = _sum_account_type(db, AccountTypeEnum.INCOME, month_start, today)
    revenue_last  = _sum_account_type(db, AccountTypeEnum.INCOME, last_month_start, last_month_end)

    # Expenses this month
    expense_this  = _sum_account_type(db, AccountTypeEnum.EXPENSE, month_start, today)
    expense_last  = _sum_account_type(db, AccountTypeEnum.EXPENSE, last_month_start, last_month_end)

    # AR outstanding
    ar_outstanding = db.query(func.sum(Invoice.balance_due)).filter(
        Invoice.balance_due > 0,
        Invoice.status.in_([InvoiceStatus.SENT, InvoiceStatus.PARTIAL, InvoiceStatus.OVERDUE]),
        Invoice.is_deleted == False,
    ).scalar() or Decimal("0")

    ar_overdue = db.query(func.sum(Invoice.balance_due)).filter(
        Invoice.due_date < today,
        Invoice.balance_due > 0,
        Invoice.is_deleted == False,
    ).scalar() or Decimal("0")

    # AP outstanding
    ap_outstanding = db.query(func.sum(Bill.balance_due)).filter(
        Bill.balance_due > 0,
        Bill.status.in_([BillStatus.APPROVED, BillStatus.PARTIAL]),
        Bill.is_deleted == False,
    ).scalar() or Decimal("0")

    ap_overdue = db.query(func.sum(Bill.balance_due)).filter(
        Bill.due_date < today,
        Bill.balance_due > 0,
        Bill.is_deleted == False,
    ).scalar() or Decimal("0")

    # Cash & Bank balance (account 1101 + 1102)
    cash_acc = db.query(func.sum(Account.balance)).filter(
        Account.code.like("11%"),
        Account.account_type == AccountTypeEnum.ASSET,
        Account.is_active == True,
    ).scalar() or Decimal("0")

    gross_profit = revenue_this - expense_this
    rev_change   = _pct_change(revenue_last, revenue_this)
    exp_change   = _pct_change(expense_last, expense_this)

    return {
        "revenue":       {"amount": float(revenue_this), "change_pct": rev_change,   "period": "เดือนนี้"},
        "expense":       {"amount": float(expense_this), "change_pct": exp_change,   "period": "เดือนนี้"},
        "gross_profit":  {"amount": float(gross_profit), "period": "เดือนนี้"},
        "cash_balance":  {"amount": float(cash_acc)},
        "ar_outstanding":{"amount": float(ar_outstanding), "overdue": float(ar_overdue)},
        "ap_outstanding":{"amount": float(ap_outstanding), "overdue": float(ap_overdue)},
        "pending_approvals": db.query(Bill).filter(Bill.status == BillStatus.PENDING).count(),
        "overdue_invoices":  db.query(Invoice).filter(Invoice.due_date < today, Invoice.balance_due > 0).count(),
    }


def get_revenue_expense_chart(db: Session, months: int = 6) -> List[dict]:
    """รายได้/รายจ่ายย้อนหลัง N เดือน"""
    today = date.today()
    result = []
    for i in range(months - 1, -1, -1):
        d = today.replace(day=1) - timedelta(days=i * 28)
        m_start = d.replace(day=1)
        if d.month == 12:
            m_end = d.replace(month=12, day=31)
        else:
            m_end = d.replace(month=d.month + 1, day=1) - timedelta(days=1)

        rev = _sum_account_type(db, AccountTypeEnum.INCOME,  m_start, m_end)
        exp = _sum_account_type(db, AccountTypeEnum.EXPENSE, m_start, m_end)
        result.append({
            "month":   m_start.strftime("%b %y"),
            "month_th": _month_th(m_start.month) + " " + str(m_start.year + 543)[-2:],
            "revenue": float(rev),
            "expense": float(exp),
            "profit":  float(rev - exp),
        })
    return result


def get_cash_flow_chart(db: Session, days: int = 30) -> List[dict]:
    """กระแสเงินสด 30 วันล่าสุด"""
    today = date.today()
    result = []
    running = float(_get_cash_balance(db))
    # Walk backwards then reverse
    daily = []
    for i in range(days):
        d = today - timedelta(days=i)
        inflow  = _daily_ar_received(db, d)
        outflow = _daily_ap_paid(db, d)
        daily.append({"date": d.strftime("%d/%m"), "inflow": inflow, "outflow": outflow})
    daily.reverse()
    cumulative = running - sum(x["inflow"] - x["outflow"] for x in daily)
    for row in daily:
        cumulative += row["inflow"] - row["outflow"]
        result.append({**row, "balance": round(cumulative, 2)})
    return result


def get_expense_breakdown(db: Session) -> List[dict]:
    """ค่าใช้จ่ายแบ่งตามหมวดหมู่เดือนนี้"""
    today   = date.today()
    m_start = today.replace(day=1)
    from models.ap import ExpenseCategory
    cats = db.query(ExpenseCategory).filter(ExpenseCategory.is_active == True).all()
    result = []
    for cat in cats:
        total = db.query(func.sum(Bill.subtotal)).filter(
            Bill.category_id == cat.id,
            Bill.date >= m_start,
            Bill.date <= today,
            Bill.status.in_([BillStatus.APPROVED, BillStatus.PARTIAL, BillStatus.PAID]),
            Bill.is_deleted == False,
        ).scalar() or 0
        if total > 0:
            result.append({"name": cat.name, "code": cat.code, "amount": float(total)})
    result.sort(key=lambda x: x["amount"], reverse=True)
    return result[:8]


def get_alerts(db: Session) -> List[dict]:
    """Smart alerts สำหรับ Dashboard"""
    alerts = []
    today  = date.today()

    # Overdue invoices
    overdue_inv = db.query(Invoice).filter(
        Invoice.due_date < today,
        Invoice.balance_due > 0,
        Invoice.is_deleted == False,
    ).count()
    if overdue_inv > 0:
        total = db.query(func.sum(Invoice.balance_due)).filter(
            Invoice.due_date < today, Invoice.balance_due > 0,
        ).scalar() or 0
        alerts.append({"type": "warning", "icon": "⚠", "title": f"ลูกหนี้เกินกำหนด {overdue_inv} ราย", "detail": f"ยอดรวม ฿{float(total):,.2f}", "module": "ar"})

    # Bills pending approval
    pending = db.query(Bill).filter(Bill.status == BillStatus.PENDING).count()
    if pending > 0:
        alerts.append({"type": "info", "icon": "📋", "title": f"รออนุมัติ {pending} รายการ", "detail": "Bills ที่ต้องการอนุมัติ", "module": "ap"})

    # Bills due soon (7 days)
    due_soon = db.query(func.sum(Bill.balance_due)).filter(
        Bill.due_date <= today + timedelta(days=7),
        Bill.due_date >= today,
        Bill.balance_due > 0,
        Bill.status.in_([BillStatus.APPROVED, BillStatus.PARTIAL]),
    ).scalar() or 0
    if due_soon > 0:
        alerts.append({"type": "warning", "icon": "💸", "title": "ค่าใช้จ่ายครบกำหนดใน 7 วัน", "detail": f"฿{float(due_soon):,.2f}", "module": "ap"})

    # Low cash warning
    cash = float(_get_cash_balance(db))
    monthly_exp = float(_sum_account_type(db, AccountTypeEnum.EXPENSE, today.replace(day=1), today))
    if monthly_exp > 0 and cash < monthly_exp:
        alerts.append({"type": "danger", "icon": "🔴", "title": "เงินสดต่ำกว่าค่าใช้จ่ายรายเดือน", "detail": f"เงินสด: ฿{cash:,.2f}", "module": "dashboard"})

    return alerts


# ── Helpers ────────────────────────────────────────────────────

def _sum_account_type(db: Session, atype: AccountTypeEnum, d_from: date, d_to: date) -> Decimal:
    result = db.query(func.sum(JournalEntry.credit - JournalEntry.debit)).join(
        Journal, JournalEntry.journal_id == Journal.id
    ).join(
        Account, JournalEntry.account_id == Account.id
    ).filter(
        Account.account_type == atype,
        Journal.status == JournalStatus.POSTED,
        Journal.date >= d_from,
        Journal.date <= d_to,
    ).scalar()
    v = result or Decimal("0")
    return abs(v)


def _get_cash_balance(db: Session) -> Decimal:
    result = db.query(func.sum(Account.balance)).filter(
        Account.code.like("11%"),
        Account.account_type == AccountTypeEnum.ASSET,
        Account.is_active == True,
    ).scalar()
    return result or Decimal("0")


def _daily_ar_received(db: Session, d: date) -> float:
    v = db.query(func.sum(ARPayment.amount)).filter(ARPayment.date == d).scalar()
    return float(v or 0)


def _daily_ap_paid(db: Session, d: date) -> float:
    v = db.query(func.sum(APPayment.amount)).filter(APPayment.date == d).scalar()
    return float(v or 0)


def _pct_change(old: Decimal, new: Decimal) -> Optional[float]:
    if not old or old == 0:
        return None
    return round(float((new - old) / old * 100), 1)


def _month_th(m: int) -> str:
    return ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.",
            "ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."][m - 1]
