"""AR Tests — Customer CRUD, Invoice lifecycle, Payment, Aging Report"""
import pytest
from decimal import Decimal
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from core.database import Base, get_db
from core.security import hash_password
from models.user import User, UserRole
from models.accounting import Account, AccountTypeEnum, NormalBalance
from main import app

engine = create_engine("sqlite:///./test_ar.db", connect_args={"check_same_thread": False})
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
def accountant(db):
    u = User(email="acc@test.com", full_name="Accountant",
             hashed_password=hash_password("Test@1234"), role=UserRole.ACCOUNTANT, is_active=True)
    db.add(u); db.commit(); db.refresh(u); return u

@pytest.fixture
def token(client, accountant):
    return client.post("/api/v1/auth/login", json={"email":"acc@test.com","password":"Test@1234"}).json()["access_token"]

@pytest.fixture
def gl_accounts(db):
    """Create minimum GL accounts for AR auto-posting"""
    accs = [
        Account(code="1101", name="เงินสด",     account_type=AccountTypeEnum.ASSET,  normal_balance=NormalBalance.DEBIT,  level=3),
        Account(code="1102", name="เงินฝากธนาคาร", account_type=AccountTypeEnum.ASSET, normal_balance=NormalBalance.DEBIT, level=3),
        Account(code="1201", name="ลูกหนี้การค้า", account_type=AccountTypeEnum.ASSET, normal_balance=NormalBalance.DEBIT, level=3),
        Account(code="2103", name="VAT Output",  account_type=AccountTypeEnum.LIABILITY, normal_balance=NormalBalance.CREDIT, level=3),
        Account(code="4101", name="รายได้ขาย",  account_type=AccountTypeEnum.INCOME, normal_balance=NormalBalance.CREDIT, level=2),
    ]
    for a in accs: db.add(a)
    db.commit()
    return accs

@pytest.fixture
def customer(client, token):
    res = client.post("/api/v1/ar/customers", json={
        "code": "C001", "name": "บริษัท ทดสอบ จำกัด",
        "tax_id": "0105555000001", "credit_days": 30,
    }, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    return res.json()

# ── Customer ──────────────────────────────────────────────────
def test_create_customer(client, token):
    res = client.post("/api/v1/ar/customers", json={
        "code": "C001", "name": "บริษัท ABC", "credit_days": 30,
    }, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.json()["code"] == "C001"

def test_duplicate_customer_code(client, token, customer):
    res = client.post("/api/v1/ar/customers", json={
        "code": "C001", "name": "Another", "credit_days": 30,
    }, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 400

def test_list_customers(client, token, customer):
    res = client.get("/api/v1/ar/customers", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert len(res.json()) >= 1

# ── Invoice ───────────────────────────────────────────────────
def test_create_invoice(client, token, customer):
    res = client.post("/api/v1/ar/invoices", json={
        "customer_id": customer["id"],
        "date": "2024-01-15",
        "vat_rate": 7,
        "items": [
            {"description": "ค่าบริการพัฒนาซอฟต์แวร์", "quantity": 1, "unit_price": 50000},
            {"description": "ค่า Hosting รายปี",         "quantity": 1, "unit_price": 12000},
        ]
    }, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.json()
    assert data["number"].startswith("INV-")
    assert float(data["subtotal"]) == 62000
    assert float(data["vat_amount"]) == pytest.approx(4340, rel=0.01)
    assert float(data["total"]) == pytest.approx(66340, rel=0.01)
    assert data["status"] == "draft"

def test_invoice_no_items_rejected(client, token, customer):
    res = client.post("/api/v1/ar/invoices", json={
        "customer_id": customer["id"], "date": "2024-01-15", "items": []
    }, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 422

def test_post_invoice_to_gl(client, token, customer, gl_accounts, db):
    inv_res = client.post("/api/v1/ar/invoices", json={
        "customer_id": customer["id"], "date": "2024-01-15",
        "items": [{"description": "บริการ", "quantity": 1, "unit_price": 10000}]
    }, headers={"Authorization": f"Bearer {token}"})
    inv_id = inv_res.json()["id"]

    post_res = client.post(f"/api/v1/ar/invoices/{inv_id}/post-gl",
                           headers={"Authorization": f"Bearer {token}"})
    assert post_res.status_code == 200
    assert post_res.json()["gl_posted"] is True
    assert post_res.json()["status"] == "sent"

    # AR account balance should increase
    ar_acc = next(a for a in gl_accounts if a.code == "1201")
    db.refresh(ar_acc)
    assert ar_acc.balance > 0

# ── Payment ───────────────────────────────────────────────────
def test_receive_payment_full(client, token, customer, gl_accounts):
    inv_res = client.post("/api/v1/ar/invoices", json={
        "customer_id": customer["id"], "date": "2024-01-15",
        "items": [{"description": "บริการ", "quantity": 1, "unit_price": 5000}]
    }, headers={"Authorization": f"Bearer {token}"})
    inv = inv_res.json()
    total = inv["total"]

    # Post to GL first
    client.post(f"/api/v1/ar/invoices/{inv['id']}/post-gl",
                headers={"Authorization": f"Bearer {token}"})

    pay_res = client.post("/api/v1/ar/payments", json={
        "invoice_id": inv["id"], "date": "2024-01-20",
        "amount": total, "method": "bank_transfer", "reference": "TRANS001",
    }, headers={"Authorization": f"Bearer {token}"})
    assert pay_res.status_code == 200

    # Invoice should be PAID
    inv_check = client.get(f"/api/v1/ar/invoices/{inv['id']}",
                           headers={"Authorization": f"Bearer {token}"})
    assert inv_check.json()["status"] == "paid"
    assert float(inv_check.json()["balance_due"]) == 0

def test_overpayment_rejected(client, token, customer, gl_accounts):
    inv_res = client.post("/api/v1/ar/invoices", json={
        "customer_id": customer["id"], "date": "2024-01-15",
        "items": [{"description": "บริการ", "quantity": 1, "unit_price": 1000}]
    }, headers={"Authorization": f"Bearer {token}"})
    inv = inv_res.json()
    res = client.post("/api/v1/ar/payments", json={
        "invoice_id": inv["id"], "date": "2024-01-20",
        "amount": 99999, "method": "cash",
    }, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 400

def test_partial_payment(client, token, customer, gl_accounts):
    inv_res = client.post("/api/v1/ar/invoices", json={
        "customer_id": customer["id"], "date": "2024-01-15",
        "items": [{"description": "บริการ", "quantity": 1, "unit_price": 10000}]
    }, headers={"Authorization": f"Bearer {token}"})
    inv = inv_res.json()
    client.post(f"/api/v1/ar/invoices/{inv['id']}/post-gl", headers={"Authorization": f"Bearer {token}"})

    client.post("/api/v1/ar/payments", json={
        "invoice_id": inv["id"], "date": "2024-01-20", "amount": 5000, "method": "cash",
    }, headers={"Authorization": f"Bearer {token}"})

    inv_check = client.get(f"/api/v1/ar/invoices/{inv['id']}",
                           headers={"Authorization": f"Bearer {token}"})
    assert inv_check.json()["status"] == "partial"
    assert float(inv_check.json()["balance_due"]) > 0

def test_aging_report(client, token, customer, gl_accounts):
    res = client.get("/api/v1/ar/reports/aging", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.json()
    assert "current" in data
    assert "1_30" in data
    assert "grand_total" in data
