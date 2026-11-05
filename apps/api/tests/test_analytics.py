"""Predictive Analytics Tests — Linear regression math verification, forecasting, benchmarks"""
import pytest
from decimal import Decimal
from datetime import date, timedelta
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from core.database import Base, get_db
from core.security import hash_password
from models.user import User, UserRole
from models.accounting import Account, Journal, JournalEntry, AccountTypeEnum, NormalBalance, JournalStatus
from models.ar import Customer, Invoice, Payment as ARPayment, InvoiceStatus, PaymentMethod
from models.ap import Supplier, Bill, APPayment, BillStatus, APPaymentMethod, ExpenseCategory
from main import app
from services.predictive_analytics import _linear_regression, _residual_stdev

engine = create_engine("sqlite:///./test_analytics.db", connect_args={"check_same_thread": False})
TestDB = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@pytest.fixture(autouse=True)
def setup():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)

@pytest.fixture
def db():
    s = TestDB(); yield s; s.close()

@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as c: yield c
    app.dependency_overrides.clear()

@pytest.fixture
def token(client, db):
    u = User(email="acc@test.com", full_name="Test", hashed_password=hash_password("Test@1234"), role=UserRole.ACCOUNTANT, is_active=True)
    db.add(u); db.commit()
    return client.post("/api/v1/auth/login", json={"email": "acc@test.com", "password": "Test@1234"}).json()["access_token"]


# ── Linear Regression Math (pure function — exact verification) ─
def test_linear_regression_perfect_line():
    """y = 2x + 3 exactly — regression should recover slope=2, intercept=3"""
    x = [0, 1, 2, 3, 4]
    y = [3, 5, 7, 9, 11]
    slope, intercept = _linear_regression(x, y)
    assert slope == pytest.approx(2.0, abs=0.001)
    assert intercept == pytest.approx(3.0, abs=0.001)

def test_linear_regression_flat_line():
    x = [0, 1, 2, 3]
    y = [10, 10, 10, 10]
    slope, intercept = _linear_regression(x, y)
    assert slope == pytest.approx(0.0, abs=0.001)
    assert intercept == pytest.approx(10.0, abs=0.001)

def test_linear_regression_single_point():
    slope, intercept = _linear_regression([0], [5])
    assert slope == 0.0
    assert intercept == 5

def test_linear_regression_empty():
    slope, intercept = _linear_regression([], [])
    assert slope == 0.0
    assert intercept == 0.0

def test_residual_stdev_perfect_fit_is_zero():
    x = [0, 1, 2, 3]
    y = [1, 3, 5, 7]  # y = 2x + 1 exactly
    slope, intercept = _linear_regression(x, y)
    resid = _residual_stdev(x, y, slope, intercept)
    assert resid == pytest.approx(0.0, abs=0.01)


# ── Cash Flow Forecast API ──────────────────────────────────────
def test_cash_flow_forecast_no_data(client, token):
    res = client.get("/api/v1/analytics/cash-flow-forecast", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.json()
    assert data["confidence"] == 0.0
    assert data["warning"] is not None

def test_cash_flow_forecast_increasing_trend(client, token, db):
    c = Customer(code="C001", name="ลูกค้า", credit_days=30)
    db.add(c); db.flush()
    inv = Invoice(number="INV-001", customer_id=c.id, date=date.today()-timedelta(days=30), due_date=date.today(),
                 status=InvoiceStatus.SENT, subtotal=Decimal("50000"), total=Decimal("53500"), balance_due=Decimal("53500"))
    db.add(inv); db.flush()

    # Simulate steadily increasing daily AR receipts over 20 days
    for i in range(20):
        p = ARPayment(invoice_id=inv.id, date=date.today()-timedelta(days=20-i), amount=Decimal("1000"), method=PaymentMethod.BANK_TRANSFER)
        db.add(p)
    db.commit()

    res = client.get("/api/v1/analytics/cash-flow-forecast?historical_days=30&forecast_days=14",
                     headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.json()
    assert data["trend_direction"] == "increasing"
    assert len(data["forecast"]) == 14
    assert data["trend_slope_per_day"] > 0

def test_forecast_confidence_interval_widens_over_time(client, token, db):
    c = Customer(code="C002", name="ลูกค้า2", credit_days=30)
    db.add(c); db.flush()
    inv = Invoice(number="INV-002", customer_id=c.id, date=date.today()-timedelta(days=30), due_date=date.today(),
                 status=InvoiceStatus.SENT, subtotal=Decimal("10000"), total=Decimal("10700"), balance_due=Decimal("10700"))
    db.add(inv); db.flush()
    for i in range(15):
        p = ARPayment(invoice_id=inv.id, date=date.today()-timedelta(days=15-i), amount=Decimal("500") if i % 3 == 0 else Decimal("100"), method=PaymentMethod.CASH)
        db.add(p)
    db.commit()

    res = client.get("/api/v1/analytics/cash-flow-forecast?forecast_days=30",
                     headers={"Authorization": f"Bearer {token}"})
    data = res.json()
    if len(data["forecast"]) >= 2:
        first_range = data["forecast"][0]["upper_bound"] - data["forecast"][0]["lower_bound"]
        last_range = data["forecast"][-1]["upper_bound"] - data["forecast"][-1]["lower_bound"]
        assert last_range >= first_range  # uncertainty should widen further into the future


# ── Revenue Forecast API ─────────────────────────────────────
def test_revenue_forecast_no_data(client, token):
    res = client.get("/api/v1/analytics/revenue-forecast", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.json()["method"] == "insufficient_data"

def _post_journal(db, j_date, entries, suffix):
    j = Journal(number=f"JV-REV-{suffix}", date=j_date, description="test", status=JournalStatus.POSTED)
    db.add(j); db.flush()
    for acc, debit, credit in entries:
        db.add(JournalEntry(journal_id=j.id, account_id=acc.id, debit=debit, credit=credit))
    db.commit()

def test_revenue_forecast_with_growth(client, token, db):
    cash = Account(code="1101", name="เงินสด", account_type=AccountTypeEnum.ASSET, normal_balance=NormalBalance.DEBIT, level=3, balance=Decimal("0"))
    rev  = Account(code="4101", name="รายได้ขาย", account_type=AccountTypeEnum.INCOME, normal_balance=NormalBalance.CREDIT, level=2, balance=Decimal("0"))
    db.add_all([cash, rev]); db.commit()

    today = date.today()
    # 4 months of increasing revenue: 10k, 20k, 30k, 40k
    for i, amt in enumerate([10000, 20000, 30000, 40000]):
        months_back = 3 - i
        d = today.replace(day=1) - timedelta(days=months_back * 28)
        _post_journal(db, d.replace(day=5), [(cash, Decimal(str(amt)), Decimal("0")), (rev, Decimal("0"), Decimal(str(amt)))], f"m{i}")

    res = client.get("/api/v1/analytics/revenue-forecast?historical_months=4",
                     headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.json()
    assert data["monthly_growth_rate_pct"] is not None
    assert data["monthly_growth_rate_pct"] > 0  # should detect growth
    assert data["next_month_forecast"] > 0
    assert len(data["next_3_months_forecast"]) == 3


# ── Expense Trends ────────────────────────────────────────────
def test_expense_trend_flags_large_increase(client, token, db):
    cat = ExpenseCategory(code="EXP001", name="ค่าเดินทาง")
    db.add(cat); db.flush()
    sup = Supplier(code="S001", name="ผู้ขาย", payment_terms=30)
    db.add(sup); db.flush()

    today = date.today()
    # Past 3 months: small consistent expense (~1000/month)
    for i in range(1, 4):
        d = today.replace(day=1) - timedelta(days=i*28)
        b = Bill(number=f"BILL-PAST-{i}", supplier_id=sup.id, category_id=cat.id, date=d, due_date=d+timedelta(days=30),
                description="past", status=BillStatus.PAID, subtotal=Decimal("1000"), total=Decimal("1070"),
                net_payable=Decimal("1070"), balance_due=Decimal("0"), gl_posted=True)
        db.add(b)
    # Current month: huge spike (10000 = 10x normal)
    current_start = today.replace(day=1)
    b_now = Bill(number="BILL-NOW", supplier_id=sup.id, category_id=cat.id, date=today, due_date=today+timedelta(days=30),
                description="spike", status=BillStatus.APPROVED, subtotal=Decimal("10000"), total=Decimal("10700"),
                net_payable=Decimal("10700"), balance_due=Decimal("10700"), gl_posted=True)
    db.add(b_now)
    db.commit()

    res = client.get("/api/v1/analytics/expense-trends?period_months=3",
                     headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.json()
    travel_item = next((i for i in data["items"] if i["category"] == "ค่าเดินทาง"), None)
    assert travel_item is not None
    assert travel_item["trend"] == "increasing"
    assert travel_item["flag"] is not None  # should be flagged as anomalous growth


# ── Industry Benchmark ────────────────────────────────────────
def test_industry_benchmark_general(client, token):
    res = client.get("/api/v1/analytics/industry-benchmark?industry=general",
                     headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.json()
    assert data["industry"] == "general"
    assert len(data["metrics"]) == 5
    assert "summary" in data

def test_industry_benchmark_retail(client, token):
    res = client.get("/api/v1/analytics/industry-benchmark?industry=retail",
                     headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.json()["industry"] == "retail"

def test_industry_benchmark_invalid_industry_rejected(client, token):
    res = client.get("/api/v1/analytics/industry-benchmark?industry=nonexistent",
                     headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 422
