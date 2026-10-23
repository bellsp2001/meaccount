"""Tax Tests — VAT calculation, WHT certificate generation, AI checks, corporate tax planning"""
import pytest
from decimal import Decimal
from datetime import date
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from core.database import Base, get_db
from core.security import hash_password
from models.user import User, UserRole
from models.accounting import Account, AccountTypeEnum, NormalBalance
from models.ar import Customer, Invoice, InvoiceStatus
from models.ap import Supplier, Bill, BillStatus
from main import app
from services.ai_tax import calc_corporate_tax_sme

engine = create_engine("sqlite:///./test_tax.db", connect_args={"check_same_thread": False})
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
def sample_invoice(db):
    c = Customer(code="C001", name="ลูกค้าทดสอบ", credit_days=30)
    db.add(c); db.flush()
    inv = Invoice(
        number="INV-202503-0001", customer_id=c.id, date=date(2025, 3, 15), due_date=date(2025, 4, 14),
        status=InvoiceStatus.SENT, subtotal=Decimal("10000"), vat_rate=Decimal("7"),
        vat_amount=Decimal("700"), total=Decimal("10700"), gl_posted=True,
    )
    db.add(inv); db.commit(); db.refresh(inv)
    return inv

@pytest.fixture
def sample_bill(db):
    s = Supplier(code="S001", name="ผู้ขายทดสอบ", payment_terms=30)
    db.add(s); db.flush()
    bill = Bill(
        number="BILL-202503-0001", supplier_id=s.id, date=date(2025, 3, 10), due_date=date(2025, 4, 9),
        description="ค่าบริการ", status=BillStatus.APPROVED,
        subtotal=Decimal("5000"), vat_rate=Decimal("7"), vat_amount=Decimal("350"),
        wht_rate=Decimal("3"), wht_amount=Decimal("150"),
        total=Decimal("5350"), net_payable=Decimal("5200"), gl_posted=True,
    )
    db.add(bill); db.commit(); db.refresh(bill)
    return bill


# ── VAT Return Generation ────────────────────────────────────────
def test_generate_vat_return(client, token, sample_invoice, sample_bill):
    res = client.post("/api/v1/tax/vat-returns/generate", json={"period_month": 3, "period_year": 2025},
                      headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.json()
    assert float(data["sales_amount"]) == 10000
    assert float(data["output_vat"]) == 700
    assert float(data["purchase_amount"]) == 5000
    assert float(data["input_vat"]) == 350
    assert float(data["net_vat"]) == 350  # 700 - 350
    assert data["status"] == "draft"

def test_duplicate_vat_return_rejected(client, token, sample_invoice):
    client.post("/api/v1/tax/vat-returns/generate", json={"period_month": 3, "period_year": 2025},
               headers={"Authorization": f"Bearer {token}"})
    res = client.post("/api/v1/tax/vat-returns/generate", json={"period_month": 3, "period_year": 2025},
                      headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 400

def test_vat_return_excludes_unposted(client, token, db):
    """Invoice ที่ยังไม่ Post GL ไม่ควรรวมใน VAT"""
    c = Customer(code="C002", name="ลูกค้า 2", credit_days=30)
    db.add(c); db.flush()
    inv = Invoice(number="INV-202504-0001", customer_id=c.id, date=date(2025, 4, 1), due_date=date(2025, 5, 1),
                 status=InvoiceStatus.DRAFT, subtotal=Decimal("5000"), vat_amount=Decimal("350"),
                 total=Decimal("5350"), gl_posted=False)
    db.add(inv); db.commit()

    res = client.post("/api/v1/tax/vat-returns/generate", json={"period_month": 4, "period_year": 2025},
                      headers={"Authorization": f"Bearer {token}"})
    assert float(res.json()["sales_amount"]) == 0  # excluded since not posted

def test_submit_vat_return(client, token, sample_invoice):
    gen = client.post("/api/v1/tax/vat-returns/generate", json={"period_month": 3, "period_year": 2025},
                      headers={"Authorization": f"Bearer {token}"}).json()
    res = client.post(f"/api/v1/tax/vat-returns/{gen['id']}/submit",
                      headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.json()["status"] == "submitted"

def test_vat_xml_export(client, token, sample_invoice):
    gen = client.post("/api/v1/tax/vat-returns/generate", json={"period_month": 3, "period_year": 2025},
                      headers={"Authorization": f"Bearer {token}"}).json()
    res = client.get(f"/api/v1/tax/vat-returns/{gen['id']}/xml",
                     headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert "VATReturn" in res.text
    assert "PP30" in res.text


# ── WHT Certificate ───────────────────────────────────────────
def test_create_wht_certificate(client, token):
    res = client.post("/api/v1/tax/wht-certificates", json={
        "wht_type": "pnd53", "payer_name": "บริษัท เรา จำกัด",
        "payee_name": "บริษัท ผู้รับ จำกัด", "income_type": "ค่าบริการ",
        "payment_date": "2025-03-15", "gross_amount": 10000, "wht_rate": 3,
    }, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.json()
    assert data["number"].startswith("WHT-")
    assert float(data["wht_amount"]) == 300  # 3% of 10000

def test_bulk_generate_wht_from_bills(client, token, sample_bill):
    res = client.post("/api/v1/tax/wht-certificates/bulk-generate", json={
        "period_month": 3, "period_year": 2025, "payer_name": "บริษัท เรา จำกัด",
    }, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    certs = res.json()
    assert len(certs) == 1
    assert float(certs[0]["wht_amount"]) == 150  # from sample_bill

def test_bulk_wht_no_duplicate(client, token, sample_bill):
    client.post("/api/v1/tax/wht-certificates/bulk-generate", json={
        "period_month": 3, "period_year": 2025, "payer_name": "บริษัท เรา จำกัด",
    }, headers={"Authorization": f"Bearer {token}"})
    res2 = client.post("/api/v1/tax/wht-certificates/bulk-generate", json={
        "period_month": 3, "period_year": 2025, "payer_name": "บริษัท เรา จำกัด",
    }, headers={"Authorization": f"Bearer {token}"})
    assert len(res2.json()) == 0  # already generated, skip

def test_issue_certificate(client, token):
    cert = client.post("/api/v1/tax/wht-certificates", json={
        "wht_type": "pnd3", "payer_name": "บริษัท เรา", "payee_name": "นาย ก.",
        "income_type": "ค่าจ้าง", "payment_date": "2025-03-01", "gross_amount": 5000, "wht_rate": 5,
    }, headers={"Authorization": f"Bearer {token}"}).json()
    res = client.post(f"/api/v1/tax/wht-certificates/{cert['id']}/issue",
                      headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.json()["status"] == "issued"


# ── AI VAT Check ──────────────────────────────────────────────
def test_ai_check_vat_all_clear(client, token, sample_invoice, sample_bill):
    res = client.get("/api/v1/tax/ai/check-vat?period_month=3&period_year=2025",
                     headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.json()
    assert data["is_correct"] is True
    assert data["unposted_invoices"] == 0

def test_ai_check_vat_finds_unposted(client, token, db):
    c = Customer(code="C003", name="ลูกค้า", credit_days=30)
    db.add(c); db.flush()
    inv = Invoice(number="INV-202505-0001", customer_id=c.id, date=date(2025, 5, 1), due_date=date(2025, 6, 1),
                 status=InvoiceStatus.DRAFT, subtotal=Decimal("1000"), gl_posted=False)
    db.add(inv); db.commit()

    res = client.get("/api/v1/tax/ai/check-vat?period_month=5&period_year=2025",
                     headers={"Authorization": f"Bearer {token}"})
    data = res.json()
    assert data["is_correct"] is False
    assert data["unposted_invoices"] == 1
    assert len(data["issues"]) > 0


# ── Corporate Tax Calculation (pure function) ──────────────────
def test_corp_tax_zero_below_exemption():
    assert calc_corporate_tax_sme(Decimal("200000")) == Decimal("0")

def test_corp_tax_mid_bracket():
    # 300,000 exempt + (1,000,000-300,000)*15% = 105,000
    tax = calc_corporate_tax_sme(Decimal("1000000"))
    assert tax == Decimal("105000")

def test_corp_tax_high_bracket():
    # exempt 300k + 2.7M*15% + (5M-3M)*20%
    tax = calc_corporate_tax_sme(Decimal("5000000"))
    expected = Decimal("2700000") * Decimal("0.15") + Decimal("2000000") * Decimal("0.20")
    assert tax == expected.quantize(Decimal("1"))

def test_corp_tax_planning_api(client, token):
    res = client.post("/api/v1/tax/ai/plan-corporate-tax", json={
        "annual_revenue": 5000000, "annual_expense": 3000000, "business_type": "software",
    }, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.json()
    assert float(data["estimated_net_profit"]) == 2000000
    assert float(data["estimated_corporate_tax"]) > 0
    assert len(data["suggestions"]) > 0
