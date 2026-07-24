"""Financial Statements Tests — P&L, Balance Sheet, Cash Flow, Period Closing, Ratios"""
import pytest
from decimal import Decimal
from datetime import date
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from core.database import Base, get_db
from core.security import hash_password
from models.user import User, UserRole
from models.accounting import Account, Journal, JournalEntry, AccountTypeEnum, NormalBalance, JournalStatus
from main import app

engine = create_engine("sqlite:///./test_reports.db", connect_args={"check_same_thread": False})
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

@pytest.fixture
def coa(db):
    """สร้างผังบัญชีพื้นฐานสำหรับทดสอบงบการเงิน"""
    accs = {
        "cash":    Account(code="1101", name="เงินสด", account_type=AccountTypeEnum.ASSET, normal_balance=NormalBalance.DEBIT, level=3, balance=Decimal("0")),
        "ar":      Account(code="1201", name="ลูกหนี้", account_type=AccountTypeEnum.ASSET, normal_balance=NormalBalance.DEBIT, level=3, balance=Decimal("0")),
        "ap":      Account(code="2101", name="เจ้าหนี้", account_type=AccountTypeEnum.LIABILITY, normal_balance=NormalBalance.CREDIT, level=3, balance=Decimal("0")),
        "capital": Account(code="3101", name="ทุน", account_type=AccountTypeEnum.EQUITY, normal_balance=NormalBalance.CREDIT, level=2, balance=Decimal("0")),
        "revenue": Account(code="4101", name="รายได้ขาย", account_type=AccountTypeEnum.INCOME, normal_balance=NormalBalance.CREDIT, level=2, balance=Decimal("0")),
        "cogs":    Account(code="5101", name="ต้นทุนขาย", account_type=AccountTypeEnum.EXPENSE, normal_balance=NormalBalance.DEBIT, level=2, balance=Decimal("0")),
        "expense": Account(code="5301", name="ค่าเช่า", account_type=AccountTypeEnum.EXPENSE, normal_balance=NormalBalance.DEBIT, level=2, balance=Decimal("0")),
    }
    for a in accs.values(): db.add(a)
    db.commit()
    return accs


def _post_journal(db, j_date, entries, number_suffix="TEST"):
    j = Journal(number=f"JV-TEST-{number_suffix}-{j_date.isoformat()}", date=j_date,
               description="Test entry", status=JournalStatus.POSTED)
    db.add(j); db.flush()
    for acc, debit, credit in entries:
        db.add(JournalEntry(journal_id=j.id, account_id=acc.id, debit=debit, credit=credit))
        if acc.normal_balance == NormalBalance.DEBIT:
            acc.balance += debit - credit
        else:
            acc.balance += credit - debit
    db.commit()
    return j


# ── P&L Statement ─────────────────────────────────────────────
def test_profit_loss_basic(client, token, db, coa):
    # Capital injection
    _post_journal(db, date(2025, 3, 1), [(coa["cash"], Decimal("100000"), Decimal("0")), (coa["capital"], Decimal("0"), Decimal("100000"))], "1")
    # Sale
    _post_journal(db, date(2025, 3, 5), [(coa["cash"], Decimal("50000"), Decimal("0")), (coa["revenue"], Decimal("0"), Decimal("50000"))], "2")
    # COGS
    _post_journal(db, date(2025, 3, 5), [(coa["cogs"], Decimal("20000"), Decimal("0")), (coa["cash"], Decimal("0"), Decimal("20000"))], "3")
    # Expense
    _post_journal(db, date(2025, 3, 10), [(coa["expense"], Decimal("5000"), Decimal("0")), (coa["cash"], Decimal("0"), Decimal("5000"))], "4")

    res = client.get("/api/v1/reports/profit-loss?period_from=2025-03-01&period_to=2025-03-31",
                     headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.json()
    assert float(data["revenue"]["total"]) == 50000
    assert float(data["cogs"]["total"]) == 20000
    assert float(data["gross_profit"]) == 30000
    assert float(data["expenses"]["total"]) == 5000
    assert float(data["net_profit"]) == 25000


def test_profit_loss_excludes_other_period(client, token, db, coa):
    _post_journal(db, date(2025, 2, 15), [(coa["cash"], Decimal("1000"), Decimal("0")), (coa["revenue"], Decimal("0"), Decimal("1000"))], "5")
    res = client.get("/api/v1/reports/profit-loss?period_from=2025-03-01&period_to=2025-03-31",
                     headers={"Authorization": f"Bearer {token}"})
    assert float(res.json()["revenue"]["total"]) == 0


# ── Balance Sheet ──────────────────────────────────────────────
def test_balance_sheet_balanced(client, token, db, coa):
    _post_journal(db, date(2025, 3, 1), [(coa["cash"], Decimal("100000"), Decimal("0")), (coa["capital"], Decimal("0"), Decimal("100000"))], "6")
    _post_journal(db, date(2025, 3, 5), [(coa["ar"], Decimal("30000"), Decimal("0")), (coa["revenue"], Decimal("0"), Decimal("30000"))], "7")

    res = client.get("/api/v1/reports/balance-sheet?as_of_date=2025-03-31",
                     headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.json()
    assert data["is_balanced"] is True
    assert float(data["total_assets"]) == float(data["total_liab_equity"])


def test_balance_sheet_current_assets(client, token, db, coa):
    _post_journal(db, date(2025, 3, 1), [(coa["cash"], Decimal("50000"), Decimal("0")), (coa["capital"], Decimal("0"), Decimal("50000"))], "8")
    res = client.get("/api/v1/reports/balance-sheet?as_of_date=2025-03-31",
                     headers={"Authorization": f"Bearer {token}"})
    data = res.json()
    assert float(data["current_assets"]["total"]) >= 50000


# ── Cash Flow ─────────────────────────────────────────────────
def test_cash_flow_statement(client, token, db, coa):
    _post_journal(db, date(2025, 3, 1), [(coa["cash"], Decimal("100000"), Decimal("0")), (coa["capital"], Decimal("0"), Decimal("100000"))], "9")
    res = client.get("/api/v1/reports/cash-flow?period_from=2025-03-01&period_to=2025-03-31",
                     headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.json()
    assert "operating" in data
    assert "ending_cash" in data


# ── Ratio Analysis ─────────────────────────────────────────────
def test_ratio_analysis(client, token, db, coa):
    _post_journal(db, date(2025, 3, 1), [(coa["cash"], Decimal("100000"), Decimal("0")), (coa["capital"], Decimal("0"), Decimal("100000"))], "10")
    _post_journal(db, date(2025, 3, 5), [(coa["ap"], Decimal("0"), Decimal("20000")), (coa["expense"], Decimal("20000"), Decimal("0"))], "11")

    res = client.get("/api/v1/reports/ratios?as_of_date=2025-03-31",
                     headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.json()
    assert data["current_ratio"] is not None
    assert data["current_ratio"] > 0


# ── Period Closing ─────────────────────────────────────────────
def test_close_period_success(client, token, db, coa):
    _post_journal(db, date(2025, 3, 1), [(coa["cash"], Decimal("1000"), Decimal("0")), (coa["revenue"], Decimal("0"), Decimal("1000"))], "12")
    res = client.post("/api/v1/reports/periods/close", json={"period_month": 3, "period_year": 2025},
                      headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.json()["status"] == "closed"


def test_close_period_blocked_by_draft_journal(client, token, db, coa):
    draft_j = Journal(number="JV-DRAFT-1", date=date(2025, 4, 1), description="Draft", status=JournalStatus.DRAFT)
    db.add(draft_j); db.commit()

    res = client.post("/api/v1/reports/periods/close", json={"period_month": 4, "period_year": 2025},
                      headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 400


def test_double_close_rejected(client, token, db, coa):
    _post_journal(db, date(2025, 5, 1), [(coa["cash"], Decimal("500"), Decimal("0")), (coa["revenue"], Decimal("0"), Decimal("500"))], "13")
    client.post("/api/v1/reports/periods/close", json={"period_month": 5, "period_year": 2025},
               headers={"Authorization": f"Bearer {token}"})
    res = client.post("/api/v1/reports/periods/close", json={"period_month": 5, "period_year": 2025},
                      headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 400


def test_list_periods(client, token, db, coa):
    _post_journal(db, date(2025, 6, 1), [(coa["cash"], Decimal("100"), Decimal("0")), (coa["revenue"], Decimal("0"), Decimal("100"))], "14")
    client.post("/api/v1/reports/periods/close", json={"period_month": 6, "period_year": 2025},
               headers={"Authorization": f"Bearer {token}"})
    res = client.get("/api/v1/reports/periods", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert len(res.json()) >= 1


# ── AI Insight ────────────────────────────────────────────────
def test_ai_insight(client, token, db, coa):
    _post_journal(db, date(2025, 3, 1), [(coa["cash"], Decimal("50000"), Decimal("0")), (coa["revenue"], Decimal("0"), Decimal("50000"))], "15")
    res = client.get("/api/v1/reports/ai/insight?period_from=2025-03-01&period_to=2025-03-31",
                     headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.json()
    assert "summary" in data
    assert len(data["key_observations"]) > 0
