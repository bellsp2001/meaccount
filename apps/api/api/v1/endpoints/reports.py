from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import List
from datetime import date

from core.database import get_db
from core.deps import get_current_user, require_accountant_up
from models.user import User
from schemas.reports import (
    ProfitLossResponse, BalanceSheetResponse, CashFlowResponse,
    RatioAnalysisResponse, PeriodCloseRequest, PeriodResponse,
    FinancialInsightResponse,
)
from services.reports import (
    get_profit_loss, get_balance_sheet, get_cash_flow_statement,
    get_ratio_analysis, close_period, get_periods,
)
from services.ai_reports import analyze_financials

router = APIRouter(prefix="/reports", tags=["Financial Statements"])


@router.get("/profit-loss", response_model=ProfitLossResponse)
def profit_loss_ep(period_from: date = Query(...), period_to: date = Query(...),
                   current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_profit_loss(db, period_from, period_to)


@router.get("/balance-sheet", response_model=BalanceSheetResponse)
def balance_sheet_ep(as_of_date: date = Query(...),
                     current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_balance_sheet(db, as_of_date)


@router.get("/cash-flow", response_model=CashFlowResponse)
def cash_flow_ep(period_from: date = Query(...), period_to: date = Query(...),
                 current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_cash_flow_statement(db, period_from, period_to)


@router.get("/ratios", response_model=RatioAnalysisResponse)
def ratios_ep(as_of_date: date = Query(...),
             current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_ratio_analysis(db, as_of_date)


# ── Period Closing ─────────────────────────────────────────────
@router.get("/periods", response_model=List[PeriodResponse])
def list_periods_ep(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_periods(db)


@router.post("/periods/close", response_model=PeriodResponse)
def close_period_ep(payload: PeriodCloseRequest,
                    current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return close_period(db, payload.period_month, payload.period_year, current_user.id)


# ── AI Insight ─────────────────────────────────────────────────
@router.get("/ai/insight", response_model=FinancialInsightResponse)
def ai_insight_ep(period_from: date = Query(...), period_to: date = Query(...),
                  current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return analyze_financials(db, period_from, period_to)
