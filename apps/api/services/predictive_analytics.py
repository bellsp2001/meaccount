"""
Predictive Analytics Service — Statistical forecasting (linear regression + moving average)

Note: uses transparent, verifiable statistics (least-squares linear regression, weighted
moving averages) rather than a claimed "LSTM" — an LSTM neural net requires a trained model
with substantial historical data and a training pipeline, which isn't honestly deliverable
without real infrastructure. These methods are simpler but their math is correct and their
confidence intervals are real.
"""
from decimal import Decimal
from datetime import date, timedelta
from typing import List, Optional, Dict
from statistics import mean, stdev
from sqlalchemy.orm import Session
from sqlalchemy import func

from models.accounting import Account, Journal, JournalEntry, JournalStatus, AccountTypeEnum
from models.ar import Payment as ARPayment
from models.ap import APPayment, ExpenseCategory, Bill
from schemas.analytics import (
    ForecastPoint, CashFlowForecastResponse,
    RevenueForecastResponse, ExpenseTrendItem, ExpenseTrendResponse,
    BenchmarkMetric, IndustryBenchmarkResponse,
)


# ── Linear Regression (least squares, no external ML library needed) ──

def _linear_regression(x: List[float], y: List[float]) -> tuple:
    """Returns (slope, intercept) via ordinary least squares"""
    n = len(x)
    if n < 2:
        return 0.0, y[0] if y else 0.0
    x_mean = mean(x)
    y_mean = mean(y)
    numerator = sum((x[i] - x_mean) * (y[i] - y_mean) for i in range(n))
    denominator = sum((x[i] - x_mean) ** 2 for i in range(n))
    if denominator == 0:
        return 0.0, y_mean
    slope = numerator / denominator
    intercept = y_mean - slope * x_mean
    return slope, intercept


def _residual_stdev(x: List[float], y: List[float], slope: float, intercept: float) -> float:
    if len(x) < 3:
        return 0.0
    residuals = [y[i] - (slope * x[i] + intercept) for i in range(len(x))]
    try:
        return stdev(residuals)
    except Exception:
        return 0.0


# ── Cash Flow Forecast ──────────────────────────────────────────

def forecast_cash_flow(db: Session, historical_days: int = 60, forecast_days: int = 30) -> CashFlowForecastResponse:
    """พยากรณ์กระแสเงินสดล่วงหน้าด้วย Linear Regression บนข้อมูลย้อนหลัง"""
    today = date.today()
    start = today - timedelta(days=historical_days)

    # Build daily net cash flow series
    daily_flows: Dict[date, float] = {}
    d = start
    while d <= today:
        daily_flows[d] = 0.0
        d += timedelta(days=1)

    ar_payments = db.query(ARPayment).filter(ARPayment.date >= start, ARPayment.date <= today).all()
    ap_payments = db.query(APPayment).filter(APPayment.date >= start, APPayment.date <= today).all()

    for p in ar_payments:
        if p.date in daily_flows:
            daily_flows[p.date] += float(p.amount)
    for p in ap_payments:
        if p.date in daily_flows:
            daily_flows[p.date] -= float(p.amount)

    # Cumulative balance series
    sorted_dates = sorted(daily_flows.keys())
    cumulative = []
    running = 0.0
    for d in sorted_dates:
        running += daily_flows[d]
        cumulative.append(running)

    x = list(range(len(cumulative)))
    y = cumulative

    if len(x) < 3 or all(v == 0 for v in y):
        return CashFlowForecastResponse(
            method="linear_regression", historical_days=historical_days, forecast_days=forecast_days,
            current_balance=0.0, trend_direction="stable", trend_slope_per_day=0.0,
            forecast=[], confidence=0.0,
            warning="ไม่มีข้อมูลกระแสเงินสดเพียงพอสำหรับการพยากรณ์ — ต้องมีข้อมูลอย่างน้อย 3 วัน",
        )

    slope, intercept = _linear_regression(x, y)
    residual_sd = _residual_stdev(x, y, slope, intercept)

    current_balance = y[-1]
    trend_direction = "increasing" if slope > 1 else ("decreasing" if slope < -1 else "stable")

    forecast_points = []
    last_x = x[-1]
    for i in range(1, forecast_days + 1):
        future_x = last_x + i
        predicted = slope * future_x + intercept
        margin = residual_sd * 1.96 * (1 + i * 0.02)  # widening confidence interval further out
        forecast_points.append(ForecastPoint(
            date=today + timedelta(days=i),
            predicted=round(predicted, 2),
            lower_bound=round(predicted - margin, 2),
            upper_bound=round(predicted + margin, 2),
        ))

    # Confidence based on how well the line fits (inverse of relative residual size)
    data_range = max(y) - min(y) if max(y) != min(y) else 1
    confidence = max(0.3, min(0.9, 1 - (residual_sd / data_range))) if data_range else 0.5

    warning = None
    if forecast_points and forecast_points[-1].predicted < 0:
        warning = "⚠️ คาดการณ์ว่ากระแสเงินสดอาจติดลบภายในช่วงพยากรณ์ ควรวางแผนสภาพคล่องล่วงหน้า"

    return CashFlowForecastResponse(
        method="linear_regression", historical_days=historical_days, forecast_days=forecast_days,
        current_balance=round(current_balance, 2), trend_direction=trend_direction,
        trend_slope_per_day=round(slope, 2), forecast=forecast_points,
        confidence=round(confidence, 2), warning=warning,
    )


# ── Revenue Forecast ─────────────────────────────────────────────

def forecast_revenue(db: Session, historical_months: int = 6) -> RevenueForecastResponse:
    """พยากรณ์รายได้เดือนถัดไปด้วย Linear Regression บนยอดรายเดือนย้อนหลัง"""
    today = date.today()
    monthly_revenue: List[float] = []
    month_labels: List[str] = []

    for i in range(historical_months - 1, -1, -1):
        d = today.replace(day=1) - timedelta(days=i * 28)
        m_start = d.replace(day=1)
        if m_start.month == 12:
            m_end = m_start.replace(month=12, day=31)
        else:
            m_end = m_start.replace(month=m_start.month + 1, day=1) - timedelta(days=1)

        rev = db.query(func.sum(JournalEntry.credit - JournalEntry.debit)).join(
            Journal, JournalEntry.journal_id == Journal.id
        ).join(Account, JournalEntry.account_id == Account.id).filter(
            Account.account_type == AccountTypeEnum.INCOME,
            Journal.status == JournalStatus.POSTED,
            Journal.date >= m_start, Journal.date <= m_end,
        ).scalar() or Decimal("0")
        monthly_revenue.append(float(abs(rev)))
        month_labels.append(m_start.strftime("%Y-%m"))

    if len(monthly_revenue) < 2 or all(v == 0 for v in monthly_revenue):
        return RevenueForecastResponse(
            method="insufficient_data", historical_months=historical_months,
            monthly_avg=0, monthly_growth_rate_pct=None, next_month_forecast=0,
            next_3_months_forecast=[], confidence=0.0,
            explanation="ข้อมูลรายได้ย้อนหลังไม่เพียงพอสำหรับการพยากรณ์",
        )

    avg_revenue = mean(monthly_revenue)
    x = list(range(len(monthly_revenue)))
    slope, intercept = _linear_regression(x, monthly_revenue)

    growth_rate = None
    if monthly_revenue[0] > 0:
        # Compound growth rate across the period
        periods = len(monthly_revenue) - 1
        if periods > 0 and monthly_revenue[-1] > 0:
            growth_rate = ((monthly_revenue[-1] / monthly_revenue[0]) ** (1 / periods) - 1) * 100

    next_x = len(monthly_revenue)
    next_forecast = max(0, slope * next_x + intercept)

    next_3 = []
    for i in range(3):
        fx = next_x + i
        val = max(0, slope * fx + intercept)
        future_date = today.replace(day=1) + timedelta(days=32 * (i + 1))
        next_3.append({"month": future_date.strftime("%Y-%m"), "forecast": round(val, 2)})

    residual_sd = _residual_stdev(x, monthly_revenue, slope, intercept)
    confidence = max(0.3, min(0.85, 1 - (residual_sd / avg_revenue))) if avg_revenue > 0 else 0.3

    explanation = (
        f"พยากรณ์จากแนวโน้มรายได้ {historical_months} เดือนย้อนหลัง "
        f"(เฉลี่ย ฿{avg_revenue:,.2f}/เดือน) ด้วยวิธี Linear Regression"
    )
    if growth_rate is not None:
        explanation += f" — อัตราเติบโตเฉลี่ย {growth_rate:+.1f}% ต่อเดือน"

    return RevenueForecastResponse(
        method="linear_regression", historical_months=historical_months,
        monthly_avg=round(avg_revenue, 2), monthly_growth_rate_pct=round(growth_rate, 2) if growth_rate is not None else None,
        next_month_forecast=round(next_forecast, 2), next_3_months_forecast=next_3,
        confidence=round(confidence, 2), explanation=explanation,
    )


# ── Expense Trend Analysis ────────────────────────────────────

def analyze_expense_trends(db: Session, period_months: int = 3) -> ExpenseTrendResponse:
    """วิเคราะห์แนวโน้มค่าใช้จ่ายแยกตามหมวดหมู่ — เทียบเดือนปัจจุบันกับค่าเฉลี่ยย้อนหลัง"""
    today = date.today()
    current_month_start = today.replace(day=1)
    if today.month == 12:
        current_month_end = today.replace(month=12, day=31)
    else:
        current_month_end = today.replace(month=today.month + 1, day=1) - timedelta(days=1)

    past_start = current_month_start - timedelta(days=period_months * 30)

    categories = db.query(ExpenseCategory).filter(ExpenseCategory.is_active == True).all()
    items = []

    for cat in categories:
        current = db.query(func.sum(Bill.subtotal)).filter(
            Bill.category_id == cat.id, Bill.date >= current_month_start, Bill.date <= current_month_end,
            Bill.gl_posted == True,
        ).scalar() or Decimal("0")

        past_total = db.query(func.sum(Bill.subtotal)).filter(
            Bill.category_id == cat.id, Bill.date >= past_start, Bill.date < current_month_start,
            Bill.gl_posted == True,
        ).scalar() or Decimal("0")
        avg_past = float(past_total) / max(period_months, 1)

        if current == 0 and avg_past == 0:
            continue

        change_pct = None
        trend = "stable"
        flag = None
        if avg_past > 0:
            change_pct = (float(current) - avg_past) / avg_past * 100
            if change_pct > 20:
                trend = "increasing"
                if change_pct > 50:
                    flag = f"⚠️ เพิ่มขึ้น {change_pct:.0f}% ผิดปกติ ควรตรวจสอบ"
            elif change_pct < -20:
                trend = "decreasing"

        items.append(ExpenseTrendItem(
            category=cat.name, trend=trend, change_pct=round(change_pct, 1) if change_pct is not None else None,
            current_month=float(current), avg_past_months=round(avg_past, 2), flag=flag,
        ))

    items.sort(key=lambda i: i.current_month, reverse=True)
    total_current = sum(i.current_month for i in items)
    total_past = sum(i.avg_past_months for i in items)
    total_change = ((total_current - total_past) / total_past * 100) if total_past > 0 else None

    return ExpenseTrendResponse(
        period_months=period_months, items=items,
        total_current=round(total_current, 2),
        total_change_pct=round(total_change, 1) if total_change is not None else None,
    )


# ── Industry Benchmark (static reference ranges — Thai SME general benchmarks) ──

INDUSTRY_BENCHMARKS = {
    "general": {
        "gross_margin_pct":  {"avg": 30.0, "range": "20-45%"},
        "net_margin_pct":    {"avg": 8.0,  "range": "3-15%"},
        "current_ratio":      {"avg": 1.8,  "range": "1.2-2.5"},
        "debt_to_equity":       {"avg": 1.0,  "range": "0.5-2.0"},
        "ar_turnover_days":       {"avg": 45.0, "range": "30-60 วัน"},
    },
    "retail": {
        "gross_margin_pct":  {"avg": 35.0, "range": "25-50%"},
        "net_margin_pct":    {"avg": 5.0,  "range": "2-10%"},
        "current_ratio":      {"avg": 1.5,  "range": "1.0-2.0"},
        "debt_to_equity":       {"avg": 1.2,  "range": "0.6-2.2"},
        "ar_turnover_days":       {"avg": 20.0, "range": "10-35 วัน"},
    },
    "services": {
        "gross_margin_pct":  {"avg": 45.0, "range": "30-60%"},
        "net_margin_pct":    {"avg": 12.0, "range": "5-20%"},
        "current_ratio":      {"avg": 2.0,  "range": "1.3-3.0"},
        "debt_to_equity":       {"avg": 0.7,  "range": "0.3-1.5"},
        "ar_turnover_days":       {"avg": 50.0, "range": "35-70 วัน"},
    },
}


def get_industry_benchmark(db: Session, industry: str = "general") -> IndustryBenchmarkResponse:
    """เทียบอัตราส่วนการเงินของบริษัทกับค่าเฉลี่ยอุตสาหกรรม (ข้อมูลอ้างอิงทั่วไป)"""
    from services.reports import get_ratio_analysis
    today = date.today()
    ratios = get_ratio_analysis(db, today)

    benchmarks = INDUSTRY_BENCHMARKS.get(industry, INDUSTRY_BENCHMARKS["general"])
    metrics = []

    company_values = {
        "gross_margin_pct": ratios.gross_margin_pct,
        "net_margin_pct":    ratios.net_margin_pct,
        "current_ratio":      ratios.current_ratio,
        "debt_to_equity":       ratios.debt_to_equity,
        "ar_turnover_days":       ratios.ar_turnover_days,
    }

    labels = {
        "gross_margin_pct": "อัตรากำไรขั้นต้น", "net_margin_pct": "อัตรากำไรสุทธิ",
        "current_ratio": "สภาพคล่อง (Current Ratio)", "debt_to_equity": "หนี้สินต่อทุน",
        "ar_turnover_days": "ระยะเวลาเก็บหนี้ (วัน)",
    }

    for key, bench in benchmarks.items():
        company_val = company_values.get(key)
        assessment = "average"
        if company_val is not None:
            diff_pct = (company_val - bench["avg"]) / bench["avg"] * 100 if bench["avg"] else 0
            # For debt_to_equity and ar_turnover_days, lower is better
            inverse = key in ("debt_to_equity", "ar_turnover_days")
            if inverse:
                assessment = "above_average" if diff_pct < -10 else ("below_average" if diff_pct > 10 else "average")
            else:
                assessment = "above_average" if diff_pct > 10 else ("below_average" if diff_pct < -10 else "average")

        metrics.append(BenchmarkMetric(
            metric=labels.get(key, key), company_value=company_val,
            industry_avg=bench["avg"], industry_range=bench["range"], assessment=assessment,
        ))

    above = sum(1 for m in metrics if m.assessment == "above_average")
    below = sum(1 for m in metrics if m.assessment == "below_average")
    if above > below:
        summary = f"บริษัทมีผลประกอบการดีกว่าค่าเฉลี่ยอุตสาหกรรมในหลายด้าน ({above}/{len(metrics)} ตัวชี้วัด)"
    elif below > above:
        summary = f"บริษัทมีผลประกอบการต่ำกว่าค่าเฉลี่ยอุตสาหกรรมในหลายด้าน ({below}/{len(metrics)} ตัวชี้วัด) ควรทบทวนกลยุทธ์"
    else:
        summary = "ผลประกอบการอยู่ในระดับใกล้เคียงค่าเฉลี่ยอุตสาหกรรม"

    return IndustryBenchmarkResponse(industry=industry, metrics=metrics, summary=summary)
