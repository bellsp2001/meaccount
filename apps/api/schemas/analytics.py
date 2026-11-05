from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from datetime import date
from decimal import Decimal


# ── Cash Flow Forecast ──────────────────────────────────────────
class ForecastPoint(BaseModel):
    date:            date
    predicted:        float
    lower_bound:      float
    upper_bound:      float


class CashFlowForecastResponse(BaseModel):
    method:            str     # "linear_regression" | "moving_average"
    historical_days:    int
    forecast_days:       int
    current_balance:      float
    trend_direction:       str     # "increasing" | "decreasing" | "stable"
    trend_slope_per_day:    float
    forecast:                 List[ForecastPoint]
    confidence:                 float
    warning:                     Optional[str] = None


# ── Revenue Prediction ──────────────────────────────────────────
class RevenueForecastResponse(BaseModel):
    method:               str
    historical_months:     int
    monthly_avg:             float
    monthly_growth_rate_pct:  Optional[float]
    seasonal_factors:          Optional[Dict[str, float]] = None
    next_month_forecast:         float
    next_3_months_forecast:        List[Dict[str, Any]]
    confidence:                     float
    explanation:                     str


# ── Expense Trend ──────────────────────────────────────────────
class ExpenseTrendItem(BaseModel):
    category:    str
    trend:        str    # "increasing" | "decreasing" | "stable"
    change_pct:    Optional[float]
    current_month:  float
    avg_past_months: float
    flag:             Optional[str] = None   # warning if growing fast


class ExpenseTrendResponse(BaseModel):
    period_months:  int
    items:            List[ExpenseTrendItem]
    total_current:      float
    total_change_pct:     Optional[float]


# ── Industry Benchmark ──────────────────────────────────────────
class BenchmarkMetric(BaseModel):
    metric:        str
    company_value:  Optional[float]
    industry_avg:    float
    industry_range:   str
    assessment:         str   # "above_average" | "average" | "below_average"


class IndustryBenchmarkResponse(BaseModel):
    industry:    str
    metrics:      List[BenchmarkMetric]
    summary:        str
