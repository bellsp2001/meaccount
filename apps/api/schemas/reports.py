from pydantic import BaseModel
from typing import Optional, List
from uuid import UUID
from datetime import date
from decimal import Decimal


# ── P&L (Income Statement) ─────────────────────────────────────
class PLLineItem(BaseModel):
    account_code: str
    account_name: str
    amount:       Decimal


class PLSection(BaseModel):
    label: str
    items: List[PLLineItem]
    total: Decimal


class ProfitLossResponse(BaseModel):
    period_from:  date
    period_to:    date
    revenue:      PLSection
    cogs:         PLSection
    gross_profit: Decimal
    expenses:     PLSection
    net_profit:   Decimal


# ── Balance Sheet ──────────────────────────────────────────────
class BSLineItem(BaseModel):
    account_code: str
    account_name: str
    balance:      Decimal


class BSSection(BaseModel):
    label: str
    items: List[BSLineItem]
    total: Decimal


class BalanceSheetResponse(BaseModel):
    as_of_date:        date
    current_assets:     BSSection
    non_current_assets: BSSection
    total_assets:        Decimal
    current_liabilities: BSSection
    non_current_liabilities: BSSection
    total_liabilities:   Decimal
    equity:              BSSection
    total_liab_equity:   Decimal
    is_balanced:          bool


# ── Cash Flow Statement ────────────────────────────────────────
class CashFlowLine(BaseModel):
    label:  str
    amount: Decimal


class CashFlowResponse(BaseModel):
    period_from:  date
    period_to:    date
    operating:    List[CashFlowLine]
    operating_total: Decimal
    investing:    List[CashFlowLine]
    investing_total: Decimal
    financing:    List[CashFlowLine]
    financing_total: Decimal
    net_change:      Decimal
    beginning_cash:  Decimal
    ending_cash:     Decimal


# ── Ratio Analysis ─────────────────────────────────────────────
class RatioAnalysisResponse(BaseModel):
    current_ratio:      Optional[float]
    quick_ratio:        Optional[float]
    gross_margin_pct:   Optional[float]
    net_margin_pct:     Optional[float]
    debt_to_equity:     Optional[float]
    return_on_equity:   Optional[float]
    ar_turnover_days:   Optional[float]
    ap_turnover_days:   Optional[float]
    explanation:         str


# ── Period Closing ─────────────────────────────────────────────
class PeriodCloseRequest(BaseModel):
    period_month: int
    period_year:  int


class PeriodResponse(BaseModel):
    id:           UUID
    period_month: str
    start_date:   date
    end_date:     date
    status:       str
    closed_date:  Optional[date]
    note:         Optional[str]
    model_config = {"from_attributes": True}


# ── AI Financial Insight ───────────────────────────────────────
class FinancialInsightResponse(BaseModel):
    summary:          str
    key_observations:  List[str]
    risks:              List[str]
    recommendations:    List[str]
    trend_vs_last_period: Optional[str]
