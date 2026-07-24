"""
Financial Statements Service — P&L, Balance Sheet, Cash Flow, Period Closing
"""
from decimal import Decimal
from datetime import date, timedelta
from typing import List, Optional
from uuid import UUID
from calendar import monthrange
from sqlalchemy.orm import Session
from sqlalchemy import func
from fastapi import HTTPException

from models.accounting import Account, Journal, JournalEntry, JournalStatus, AccountTypeEnum, NormalBalance
from models.period import AccountingPeriod, PeriodStatus
from models.ar import Invoice, Payment as ARPayment
from models.ap import Bill, APPayment
from schemas.reports import (
    PLSection, PLLineItem, ProfitLossResponse,
    BSSection, BSLineItem, BalanceSheetResponse,
    CashFlowLine, CashFlowResponse, RatioAnalysisResponse,
)


# ── P&L Statement ──────────────────────────────────────────────

def get_profit_loss(db: Session, period_from: date, period_to: date) -> ProfitLossResponse:
    """คำนวณงบกำไรขาดทุนจาก Journal Entries ที่ Post แล้วในช่วงเวลาที่กำหนด"""

    def _get_movements(account_type: AccountTypeEnum, code_prefix: Optional[str] = None) -> List[PLLineItem]:
        q = db.query(
            Account.code, Account.name,
            func.sum(JournalEntry.credit - JournalEntry.debit).label("net"),
        ).join(JournalEntry, JournalEntry.account_id == Account.id
        ).join(Journal, JournalEntry.journal_id == Journal.id
        ).filter(
            Account.account_type == account_type,
            Journal.status == JournalStatus.POSTED,
            Journal.date >= period_from, Journal.date <= period_to,
        )
        if code_prefix:
            q = q.filter(Account.code.like(f"{code_prefix}%"))
        q = q.group_by(Account.code, Account.name).having(func.sum(JournalEntry.credit - JournalEntry.debit) != 0)

        items = []
        for code, name, net in q.all():
            amt = abs(net) if account_type in (AccountTypeEnum.INCOME,) else abs(net)
            items.append(PLLineItem(account_code=code, account_name=name, amount=Decimal(str(amt))))
        return sorted(items, key=lambda x: x.account_code)

    revenue_items = _get_movements(AccountTypeEnum.INCOME)
    revenue_total = sum(i.amount for i in revenue_items) or Decimal("0")

    cogs_items = _get_movements(AccountTypeEnum.EXPENSE, code_prefix="51")
    cogs_total = sum(i.amount for i in cogs_items) or Decimal("0")

    gross_profit = revenue_total - cogs_total

    # Operating expenses = all expense except COGS (51xx)
    all_expense_items = _get_movements(AccountTypeEnum.EXPENSE)
    expense_items = [i for i in all_expense_items if not i.account_code.startswith("51")]
    expense_total = sum(i.amount for i in expense_items) or Decimal("0")

    net_profit = gross_profit - expense_total

    return ProfitLossResponse(
        period_from=period_from, period_to=period_to,
        revenue=PLSection(label="รายได้", items=revenue_items, total=revenue_total),
        cogs=PLSection(label="ต้นทุนขาย", items=cogs_items, total=cogs_total),
        gross_profit=gross_profit,
        expenses=PLSection(label="ค่าใช้จ่ายดำเนินงาน", items=expense_items, total=expense_total),
        net_profit=net_profit,
    )


# ── Balance Sheet ──────────────────────────────────────────────

def get_balance_sheet(db: Session, as_of_date: date) -> BalanceSheetResponse:
    """คำนวณงบดุล ณ วันที่กำหนด จาก running balance ของ Account (cumulative up to date)"""

    def _get_balances(account_type: AccountTypeEnum, code_prefix: str) -> List[BSLineItem]:
        q = db.query(
            Account.code, Account.name,
            func.sum(JournalEntry.debit - JournalEntry.credit).label("net_dr"),
            func.sum(JournalEntry.credit - JournalEntry.debit).label("net_cr"),
            Account.normal_balance,
        ).outerjoin(JournalEntry, JournalEntry.account_id == Account.id
        ).outerjoin(Journal, JournalEntry.journal_id == Journal.id
        ).filter(
            Account.account_type == account_type,
            Account.code.like(f"{code_prefix}%"),
            Account.is_active == True, Account.is_deleted == False,
        )
        q = q.filter((Journal.status == JournalStatus.POSTED) & (Journal.date <= as_of_date) | (Journal.id == None))
        q = q.group_by(Account.code, Account.name, Account.normal_balance)

        items = []
        for code, name, net_dr, net_cr, normal_bal in q.all():
            if normal_bal == NormalBalance.DEBIT:
                bal = net_dr or Decimal("0")
            else:
                bal = net_cr or Decimal("0")
            if bal != 0:
                items.append(BSLineItem(account_code=code, account_name=name, balance=bal))
        return sorted(items, key=lambda x: x.account_code)

    # Assets
    current_assets     = _get_balances(AccountTypeEnum.ASSET, "1")
    current_assets     = [i for i in current_assets if i.account_code.startswith("11") or i.account_code.startswith("12") or i.account_code.startswith("13") or i.account_code.startswith("14")]
    non_current_assets = _get_balances(AccountTypeEnum.ASSET, "15")

    total_current_assets     = sum(i.balance for i in current_assets) or Decimal("0")
    total_non_current_assets = sum(i.balance for i in non_current_assets) or Decimal("0")
    total_assets = total_current_assets + total_non_current_assets

    # Liabilities
    current_liab     = _get_balances(AccountTypeEnum.LIABILITY, "21")
    non_current_liab = _get_balances(AccountTypeEnum.LIABILITY, "22")
    total_current_liab     = sum(i.balance for i in current_liab) or Decimal("0")
    total_non_current_liab = sum(i.balance for i in non_current_liab) or Decimal("0")
    total_liabilities = total_current_liab + total_non_current_liab

    # Equity + current period P&L rolled in
    equity_items = _get_balances(AccountTypeEnum.EQUITY, "3")
    pl = get_profit_loss(db, date(as_of_date.year, 1, 1), as_of_date)
    if pl.net_profit != 0:
        equity_items.append(BSLineItem(account_code="3103", account_name="กำไร(ขาดทุน)สะสมระหว่างปี", balance=pl.net_profit))
    total_equity = sum(i.balance for i in equity_items) or Decimal("0")

    total_liab_equity = total_liabilities + total_equity
    is_balanced = abs(total_assets - total_liab_equity) < Decimal("0.01")

    return BalanceSheetResponse(
        as_of_date=as_of_date,
        current_assets=BSSection(label="สินทรัพย์หมุนเวียน", items=current_assets, total=total_current_assets),
        non_current_assets=BSSection(label="สินทรัพย์ไม่หมุนเวียน", items=non_current_assets, total=total_non_current_assets),
        total_assets=total_assets,
        current_liabilities=BSSection(label="หนี้สินหมุนเวียน", items=current_liab, total=total_current_liab),
        non_current_liabilities=BSSection(label="หนี้สินไม่หมุนเวียน", items=non_current_liab, total=total_non_current_liab),
        total_liabilities=total_liabilities,
        equity=BSSection(label="ส่วนของผู้ถือหุ้น", items=equity_items, total=total_equity),
        total_liab_equity=total_liab_equity,
        is_balanced=is_balanced,
    )


# ── Cash Flow Statement (simplified direct method) ─────────────

def get_cash_flow_statement(db: Session, period_from: date, period_to: date) -> CashFlowResponse:
    # Operating: AR received - AP paid + net profit adjustments (simplified direct method)
    ar_received = db.query(func.sum(ARPayment.amount)).filter(
        ARPayment.date >= period_from, ARPayment.date <= period_to,
    ).scalar() or Decimal("0")

    ap_paid = db.query(func.sum(APPayment.amount)).filter(
        APPayment.date >= period_from, APPayment.date <= period_to,
    ).scalar() or Decimal("0")

    pl = get_profit_loss(db, period_from, period_to)

    operating = [
        CashFlowLine(label="เงินสดรับจากลูกหนี้", amount=ar_received),
        CashFlowLine(label="เงินสดจ่ายให้เจ้าหนี้", amount=-ap_paid),
        CashFlowLine(label="กำไร(ขาดทุน)สุทธิจากการดำเนินงาน", amount=pl.net_profit),
    ]
    operating_total = sum(l.amount for l in operating)

    # Investing — purchases of fixed assets (15xx) in period
    from models.accounting import JournalEntry as JE
    fixed_asset_purchase = db.query(func.sum(JE.debit - JE.credit)).join(
        Account, JE.account_id == Account.id
    ).join(Journal, JE.journal_id == Journal.id).filter(
        Account.code.like("15%"), Journal.status == JournalStatus.POSTED,
        Journal.date >= period_from, Journal.date <= period_to,
    ).scalar() or Decimal("0")

    investing = [CashFlowLine(label="ซื้อสินทรัพย์ถาวร", amount=-fixed_asset_purchase)]
    investing_total = sum(l.amount for l in investing)

    # Financing — loans, capital changes (22xx, 31xx) in period
    financing_amt = db.query(func.sum(JE.credit - JE.debit)).join(
        Account, JE.account_id == Account.id
    ).join(Journal, JE.journal_id == Journal.id).filter(
        (Account.code.like("22%")) | (Account.code.like("31%")),
        Journal.status == JournalStatus.POSTED,
        Journal.date >= period_from, Journal.date <= period_to,
    ).scalar() or Decimal("0")

    financing = [CashFlowLine(label="เงินกู้ยืม/ทุนเพิ่ม", amount=financing_amt)]
    financing_total = sum(l.amount for l in financing)

    net_change = operating_total + investing_total + financing_total

    # Beginning cash = cash balance before period_from
    beginning_cash = _cash_balance_as_of(db, period_from - timedelta(days=1))
    ending_cash = beginning_cash + net_change

    return CashFlowResponse(
        period_from=period_from, period_to=period_to,
        operating=operating, operating_total=operating_total,
        investing=investing, investing_total=investing_total,
        financing=financing, financing_total=financing_total,
        net_change=net_change, beginning_cash=beginning_cash, ending_cash=ending_cash,
    )


def _cash_balance_as_of(db: Session, as_of: date) -> Decimal:
    result = db.query(func.sum(JournalEntry.debit - JournalEntry.credit)).join(
        Account, JournalEntry.account_id == Account.id
    ).join(Journal, JournalEntry.journal_id == Journal.id).filter(
        Account.code.like("11%"), Journal.status == JournalStatus.POSTED, Journal.date <= as_of,
    ).scalar()
    return result or Decimal("0")


# ── Ratio Analysis ─────────────────────────────────────────────

def get_ratio_analysis(db: Session, as_of_date: date) -> RatioAnalysisResponse:
    bs = get_balance_sheet(db, as_of_date)
    pl = get_profit_loss(db, date(as_of_date.year, 1, 1), as_of_date)

    current_ratio = float(bs.current_assets.total / bs.current_liabilities.total) if bs.current_liabilities.total else None

    inventory_bal = sum(i.balance for i in bs.current_assets.items if i.account_code.startswith("13"))
    quick_assets = bs.current_assets.total - inventory_bal
    quick_ratio = float(quick_assets / bs.current_liabilities.total) if bs.current_liabilities.total else None

    gross_margin = float(pl.gross_profit / pl.revenue.total * 100) if pl.revenue.total else None
    net_margin   = float(pl.net_profit / pl.revenue.total * 100) if pl.revenue.total else None

    debt_to_equity = float(bs.total_liabilities / bs.equity.total) if bs.equity.total else None
    roe = float(pl.net_profit / bs.equity.total * 100) if bs.equity.total else None

    ar_bal = sum(i.balance for i in bs.current_assets.items if i.account_code.startswith("12"))
    ap_bal = sum(i.balance for i in bs.current_liabilities.items if i.account_code.startswith("21"))
    days_in_period = (as_of_date - date(as_of_date.year, 1, 1)).days + 1
    ar_turnover_days = float(ar_bal / pl.revenue.total * days_in_period) if pl.revenue.total else None
    ap_turnover_days = float(ap_bal / pl.cogs.total * days_in_period) if pl.cogs.total else None

    explanation = "อัตราส่วนทางการเงินคำนวณจากงบดุลและงบกำไรขาดทุน ณ วันที่ระบุ เทียบสะสมตั้งแต่ต้นปี"

    return RatioAnalysisResponse(
        current_ratio=current_ratio, quick_ratio=quick_ratio,
        gross_margin_pct=gross_margin, net_margin_pct=net_margin,
        debt_to_equity=debt_to_equity, return_on_equity=roe,
        ar_turnover_days=ar_turnover_days, ap_turnover_days=ap_turnover_days,
        explanation=explanation,
    )


# ── Period Closing ─────────────────────────────────────────────

def close_period(db: Session, period_month: int, period_year: int, user_id: Optional[UUID] = None) -> AccountingPeriod:
    period_key = f"{period_year}-{period_month:02d}"
    existing = db.query(AccountingPeriod).filter(AccountingPeriod.period_month == period_key).first()
    if existing and existing.status == PeriodStatus.CLOSED:
        raise HTTPException(400, f"งวด {period_key} ถูกปิดไปแล้ว")

    start = date(period_year, period_month, 1)
    end = date(period_year, period_month, monthrange(period_year, period_month)[1])

    # Check all journals in period are posted (no drafts)
    unposted = db.query(Journal).filter(
        Journal.date >= start, Journal.date <= end, Journal.status == JournalStatus.DRAFT,
    ).count()
    if unposted > 0:
        raise HTTPException(400, f"มี Journal {unposted} รายการที่ยังไม่ Post — ต้อง Post ให้ครบก่อนปิดงวด")

    if existing:
        existing.status = PeriodStatus.CLOSED
        existing.closed_date = date.today()
        existing.closed_by = user_id
        period = existing
    else:
        period = AccountingPeriod(
            period_month=period_key, start_date=start, end_date=end,
            status=PeriodStatus.CLOSED, closed_date=date.today(), closed_by=user_id,
        )
        db.add(period)

    db.commit(); db.refresh(period)
    return period


def get_periods(db: Session) -> List[AccountingPeriod]:
    return db.query(AccountingPeriod).order_by(AccountingPeriod.period_month.desc()).all()


def is_period_closed(db: Session, check_date: date) -> bool:
    period_key = f"{check_date.year}-{check_date.month:02d}"
    p = db.query(AccountingPeriod).filter(AccountingPeriod.period_month == period_key).first()
    return p is not None and p.status == PeriodStatus.CLOSED
