from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session

from core.database import get_db
from core.deps import get_current_user
from models.user import User
from schemas.analytics import (
    CashFlowForecastResponse, RevenueForecastResponse,
    ExpenseTrendResponse, IndustryBenchmarkResponse,
)
from services.predictive_analytics import (
    forecast_cash_flow, forecast_revenue, analyze_expense_trends, get_industry_benchmark,
)

router = APIRouter(prefix="/analytics", tags=["Predictive Analytics & BI"])


@router.get("/cash-flow-forecast", response_model=CashFlowForecastResponse)
def cash_flow_forecast_ep(
    historical_days: int = Query(60, ge=14, le=180),
    forecast_days: int = Query(30, ge=7, le=90),
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    return forecast_cash_flow(db, historical_days, forecast_days)


@router.get("/revenue-forecast", response_model=RevenueForecastResponse)
def revenue_forecast_ep(
    historical_months: int = Query(6, ge=2, le=24),
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    return forecast_revenue(db, historical_months)


@router.get("/expense-trends", response_model=ExpenseTrendResponse)
def expense_trends_ep(
    period_months: int = Query(3, ge=1, le=12),
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    return analyze_expense_trends(db, period_months)


@router.get("/industry-benchmark", response_model=IndustryBenchmarkResponse)
def industry_benchmark_ep(
    industry: str = Query("general", pattern="^(general|retail|services)$"),
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    return get_industry_benchmark(db, industry)
