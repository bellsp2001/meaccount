"""Report Builder Tests — Custom Report Query, Excel/PDF Export, NL Report, Scheduled Reports"""
import pytest
from decimal import Decimal
from datetime import date
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from core.database import Base, get_db
from core.security import hash_password
from models.user import User, UserRole
from models.ar import Customer, Invoice, InvoiceStatus
from models.accounting import Account, Journal, JournalEntry, AccountTypeEnum, NormalBalance, JournalStatus
from main import app

engine = create_engine("sqlite:///./test_report_builder.db", connect_args={"check_same_thread": False})
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
def sample_invoices(db):
    c = Customer(code="C001", name="ลูกค้าทดสอบ", credit_days=30)
    db.add(c); db.flush()
    invs = []
    for i in range(3):
        inv = Invoice(number=f"INV-00{i+1}", customer_id=c.id, date=date(2025, 6, i+1), due_date=date(2025, 7, i+1),
                     status=InvoiceStatus.SENT, subtotal=Decimal(str(1000*(i+1))), total=Decimal(str(1070*(i+1))),
                     balance_due=Decimal(str(1070*(i+1))))
        db.add(inv)
        invs.append(inv)
    db.commit()
    return invs

@pytest.fixture
def coa_with_data(db):
    cash = Account(code="1101", name="เงินสด", account_type=AccountTypeEnum.ASSET, normal_balance=NormalBalance.DEBIT, level=3, balance=Decimal("0"))
    revenue = Account(code="4101", name="รายได้ขาย", account_type=AccountTypeEnum.INCOME, normal_balance=NormalBalance.CREDIT, level=2, balance=Decimal("0"))
    db.add_all([cash, revenue]); db.flush()
    j = Journal(number="JV-NL-1", date=date.today().replace(day=1), description="test", status=JournalStatus.POSTED)
    db.add(j); db.flush()
    db.add(JournalEntry(journal_id=j.id, account_id=cash.id, debit=Decimal("20000"), credit=Decimal("0")))
    db.add(JournalEntry(journal_id=j.id, account_id=revenue.id, debit=Decimal("0"), credit=Decimal("20000")))
    cash.balance += Decimal("20000")
    revenue.balance += Decimal("20000")
    db.commit()
    return {"cash": cash, "revenue": revenue}


# ── Field Metadata ────────────────────────────────────────────
def test_get_source_fields(client, token):
    res = client.get("/api/v1/report-builder/fields/invoice", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    fields = res.json()["fields"]
    assert any(f["key"] == "number" for f in fields)


# ── Custom Report Query ────────────────────────────────────────
def test_run_custom_report_invoice(client, token, sample_invoices):
    res = client.post("/api/v1/report-builder/run", json={
        "source_type": "invoice", "columns": ["number", "customer_name", "total"], "filters": [],
    }, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.json()
    assert data["total_rows"] == 3
    assert data["rows"][0]["customer_name"] == "ลูกค้าทดสอบ"

def test_custom_report_with_filter(client, token, sample_invoices):
    res = client.post("/api/v1/report-builder/run", json={
        "source_type": "invoice", "columns": ["number", "total"],
        "filters": [{"field": "status", "operator": "eq", "value": "sent"}],
    }, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.json()["total_rows"] == 3

def test_custom_report_gte_filter(client, token, sample_invoices):
    res = client.post("/api/v1/report-builder/run", json={
        "source_type": "invoice", "columns": ["number", "total"],
        "filters": [{"field": "date", "operator": "gte", "value": "2025-06-02"}],
    }, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.json()["total_rows"] == 2  # excludes 2025-06-01


# ── Export ─────────────────────────────────────────────────────
def test_export_excel(client, token, sample_invoices):
    res = client.post("/api/v1/report-builder/run/export-excel", json={
        "source_type": "invoice", "columns": ["number", "total"], "filters": [],
    }, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    assert len(res.content) > 1000  # valid xlsx has substantial byte size

def test_export_pdf(client, token, sample_invoices):
    res = client.post("/api/v1/report-builder/run/export-pdf", json={
        "source_type": "invoice", "columns": ["number", "total"], "filters": [],
    }, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/pdf"
    assert res.content[:4] == b"%PDF"

def test_export_pl_excel(client, token, coa_with_data):
    res = client.get(f"/api/v1/report-builder/export/profit-loss-excel?period_from={date.today().replace(day=1)}&period_to={date.today()}",
                     headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert len(res.content) > 1000


# ── Saved Reports ──────────────────────────────────────────────
def test_create_saved_report(client, token):
    res = client.post("/api/v1/report-builder/saved", json={
        "name": "รายงานลูกหนี้รายเดือน", "source_type": "invoice",
        "columns": ["number", "total"], "is_public": True,
    }, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.json()["name"] == "รายงานลูกหนี้รายเดือน"

def test_list_saved_reports(client, token):
    client.post("/api/v1/report-builder/saved", json={
        "name": "Test Report", "source_type": "bill", "columns": ["number"],
    }, headers={"Authorization": f"Bearer {token}"})
    res = client.get("/api/v1/report-builder/saved", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert len(res.json()) >= 1


# ── Natural Language Report ────────────────────────────────────
def test_nl_report_revenue_question(client, token, coa_with_data):
    res = client.post("/api/v1/report-builder/nl-query", json={"question": "สรุปรายได้เดือนนี้ให้หน่อย"},
                      headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.json()
    assert "รายได้" in data["answer"]
    assert data["data"] is not None

def test_nl_report_cash_question(client, token, coa_with_data):
    res = client.post("/api/v1/report-builder/nl-query", json={"question": "เงินสดตอนนี้เท่าไหร่"},
                      headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert "เงินสด" in res.json()["answer"]

def test_nl_report_fallback_unknown_question(client, token):
    res = client.post("/api/v1/report-builder/nl-query", json={"question": "สวัสดีครับวันนี้อากาศดีไหม"},
                      headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.json()["answer"] is not None  # falls back to general summary


# ── Scheduled Reports ────────────────────────────────────────
def test_create_scheduled_report(client, token):
    res = client.post("/api/v1/report-builder/scheduled", json={
        "name": "รายงานประจำสัปดาห์", "report_type": "profit_loss",
        "frequency": "weekly", "recipients": ["boss@company.com"], "format": "pdf",
    }, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.json()["is_active"] is True

def test_toggle_scheduled_report(client, token):
    sr = client.post("/api/v1/report-builder/scheduled", json={
        "name": "Test Schedule", "report_type": "aging", "frequency": "daily", "recipients": ["a@b.com"],
    }, headers={"Authorization": f"Bearer {token}"}).json()
    res = client.post(f"/api/v1/report-builder/scheduled/{sr['id']}/toggle",
                      headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.json()["is_active"] is False
