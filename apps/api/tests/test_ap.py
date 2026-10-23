"""AP Tests — Supplier, Bill lifecycle, Approval Workflow, Payment, GL posting"""
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

engine = create_engine("sqlite:///./test_ap.db", connect_args={"check_same_thread": False})
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

def make_user(db, role, email):
    u = User(email=email, full_name=f"Test {role}", hashed_password=hash_password("Test@1234"), role=role, is_active=True)
    db.add(u); db.commit(); db.refresh(u); return u

def get_token(client, email):
    return client.post("/api/v1/auth/login", json={"email": email, "password": "Test@1234"}).json()["access_token"]

@pytest.fixture
def accountant(db): return make_user(db, UserRole.ACCOUNTANT, "acc@test.com")
@pytest.fixture
def manager(db): return make_user(db, UserRole.MANAGER, "mgr@test.com")
@pytest.fixture
def acc_token(client, accountant): return get_token(client, "acc@test.com")
@pytest.fixture
def mgr_token(client, manager): return get_token(client, "mgr@test.com")

@pytest.fixture
def gl_accounts(db):
    accs = [
        Account(code="1102", name="เงินฝากธนาคาร", account_type=AccountTypeEnum.ASSET,  normal_balance=NormalBalance.DEBIT,  level=3),
        Account(code="1401", name="VAT Input",      account_type=AccountTypeEnum.ASSET,  normal_balance=NormalBalance.DEBIT,  level=3),
        Account(code="2101", name="เจ้าหนี้การค้า",account_type=AccountTypeEnum.LIABILITY, normal_balance=NormalBalance.CREDIT, level=3),
        Account(code="5401", name="ค่าวัสดุสำนักงาน",account_type=AccountTypeEnum.EXPENSE, normal_balance=NormalBalance.DEBIT, level=2),
    ]
    for a in accs: db.add(a)
    db.commit(); return accs

@pytest.fixture
def supplier(client, acc_token):
    res = client.post("/api/v1/ap/suppliers", json={
        "code": "S001", "name": "บริษัท ซัพพลายเออร์ จำกัด",
        "tax_id": "0105555111111", "payment_terms": 30,
    }, headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    return res.json()

# ── Supplier ──────────────────────────────────────────────────
def test_create_supplier(client, acc_token):
    res = client.post("/api/v1/ap/suppliers", json={"code": "S001", "name": "ซัพพลายเออร์", "payment_terms": 30},
                      headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    assert res.json()["code"] == "S001"

def test_duplicate_supplier_code(client, acc_token, supplier):
    res = client.post("/api/v1/ap/suppliers", json={"code": "S001", "name": "Dup", "payment_terms": 30},
                      headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 400

# ── Bill ──────────────────────────────────────────────────────
def test_create_bill(client, acc_token, supplier):
    res = client.post("/api/v1/ap/bills", json={
        "supplier_id": supplier["id"], "date": "2024-02-01", "description": "ค่าวัสดุสำนักงาน",
        "vat_rate": 7, "wht_rate": 3,
        "items": [{"description": "กระดาษ A4", "quantity": 5, "unit_price": 200}],
    }, headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    data = res.json()
    assert data["number"].startswith("BILL-")
    assert float(data["subtotal"]) == 1000
    assert float(data["vat_amount"]) == pytest.approx(70, rel=0.01)
    assert float(data["wht_amount"]) == pytest.approx(30, rel=0.01)
    assert float(data["total"]) == pytest.approx(1070, rel=0.01)
    assert float(data["net_payable"]) == pytest.approx(1040, rel=0.01)
    assert data["status"] == "draft"

def test_bill_no_items_rejected(client, acc_token, supplier):
    res = client.post("/api/v1/ap/bills", json={
        "supplier_id": supplier["id"], "date": "2024-02-01",
        "description": "ทดสอบ", "items": [],
    }, headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 422

# ── Approval Workflow ─────────────────────────────────────────
def test_submit_for_approval(client, acc_token, supplier):
    bill = client.post("/api/v1/ap/bills", json={
        "supplier_id": supplier["id"], "date": "2024-02-01", "description": "ค่าเช่า",
        "items": [{"description": "ค่าเช่าสำนักงาน", "quantity": 1, "unit_price": 15000}],
    }, headers={"Authorization": f"Bearer {acc_token}"}).json()

    res = client.post(f"/api/v1/ap/bills/{bill['id']}/submit",
                      headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    assert res.json()["status"] == "pending_approval"

def test_manager_can_approve(client, acc_token, mgr_token, supplier, db):
    bill = client.post("/api/v1/ap/bills", json={
        "supplier_id": supplier["id"], "date": "2024-02-01", "description": "ค่าไฟ",
        "items": [{"description": "ค่าไฟฟ้า", "quantity": 1, "unit_price": 3000}],
    }, headers={"Authorization": f"Bearer {acc_token}"}).json()
    client.post(f"/api/v1/ap/bills/{bill['id']}/submit", headers={"Authorization": f"Bearer {acc_token}"})

    res = client.post(f"/api/v1/ap/bills/{bill['id']}/approve",
                      json={"action": "approved", "comment": "อนุมัติแล้ว"},
                      headers={"Authorization": f"Bearer {mgr_token}"})
    assert res.status_code == 200
    assert res.json()["status"] == "approved"

def test_accountant_cannot_approve(client, acc_token, supplier):
    bill = client.post("/api/v1/ap/bills", json={
        "supplier_id": supplier["id"], "date": "2024-02-01", "description": "ทดสอบ",
        "items": [{"description": "รายการ", "quantity": 1, "unit_price": 1000}],
    }, headers={"Authorization": f"Bearer {acc_token}"}).json()
    client.post(f"/api/v1/ap/bills/{bill['id']}/submit", headers={"Authorization": f"Bearer {acc_token}"})

    res = client.post(f"/api/v1/ap/bills/{bill['id']}/approve",
                      json={"action": "approved"},
                      headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 403

def test_reject_bill(client, acc_token, mgr_token, supplier):
    bill = client.post("/api/v1/ap/bills", json={
        "supplier_id": supplier["id"], "date": "2024-02-01", "description": "ค่าใช้จ่ายไม่สมเหตุ",
        "items": [{"description": "อื่นๆ", "quantity": 1, "unit_price": 50000}],
    }, headers={"Authorization": f"Bearer {acc_token}"}).json()
    client.post(f"/api/v1/ap/bills/{bill['id']}/submit", headers={"Authorization": f"Bearer {acc_token}"})

    res = client.post(f"/api/v1/ap/bills/{bill['id']}/approve",
                      json={"action": "rejected", "comment": "ราคาสูงเกินไป"},
                      headers={"Authorization": f"Bearer {mgr_token}"})
    assert res.status_code == 200
    assert res.json()["status"] == "rejected"

# ── GL Posting ────────────────────────────────────────────────
def test_post_bill_to_gl(client, acc_token, mgr_token, supplier, gl_accounts, db):
    bill = client.post("/api/v1/ap/bills", json={
        "supplier_id": supplier["id"], "date": "2024-02-01", "description": "ค่าวัสดุ",
        "items": [{"description": "กระดาษ", "quantity": 1, "unit_price": 5000}],
    }, headers={"Authorization": f"Bearer {acc_token}"}).json()

    res = client.post(f"/api/v1/ap/bills/{bill['id']}/post-gl",
                      headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    assert res.json()["gl_posted"] is True

    # AP account balance should increase
    ap_acc = next(a for a in gl_accounts if a.code == "2101")
    db.refresh(ap_acc)
    assert ap_acc.balance > 0

# ── Payment ───────────────────────────────────────────────────
def test_pay_bill(client, acc_token, mgr_token, supplier, gl_accounts, db):
    bill = client.post("/api/v1/ap/bills", json={
        "supplier_id": supplier["id"], "date": "2024-02-01", "description": "ค่าเช่า",
        "items": [{"description": "ค่าเช่า", "quantity": 1, "unit_price": 20000}],
    }, headers={"Authorization": f"Bearer {acc_token}"}).json()
    client.post(f"/api/v1/ap/bills/{bill['id']}/submit", headers={"Authorization": f"Bearer {acc_token}"})
    client.post(f"/api/v1/ap/bills/{bill['id']}/approve", json={"action": "approved"},
                headers={"Authorization": f"Bearer {mgr_token}"})

    pay_res = client.post("/api/v1/ap/payments", json={
        "bill_id": bill["id"], "date": "2024-02-10",
        "amount": bill["net_payable"], "method": "bank_transfer",
    }, headers={"Authorization": f"Bearer {acc_token}"})
    assert pay_res.status_code == 200

    bill_check = client.get(f"/api/v1/ap/bills/{bill['id']}",
                            headers={"Authorization": f"Bearer {acc_token}"})
    assert bill_check.json()["status"] == "paid"

def test_overpayment_rejected(client, acc_token, mgr_token, supplier, gl_accounts):
    bill = client.post("/api/v1/ap/bills", json={
        "supplier_id": supplier["id"], "date": "2024-02-01", "description": "ทดสอบ",
        "items": [{"description": "x", "quantity": 1, "unit_price": 1000}],
    }, headers={"Authorization": f"Bearer {acc_token}"}).json()
    client.post(f"/api/v1/ap/bills/{bill['id']}/submit", headers={"Authorization": f"Bearer {acc_token}"})
    client.post(f"/api/v1/ap/bills/{bill['id']}/approve", json={"action": "approved"},
                headers={"Authorization": f"Bearer {mgr_token}"})
    res = client.post("/api/v1/ap/payments", json={
        "bill_id": bill["id"], "date": "2024-02-10", "amount": 999999, "method": "cash",
    }, headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 400

def test_ap_summary(client, acc_token):
    res = client.get("/api/v1/ap/summary", headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    data = res.json()
    assert "total_payable" in data
    assert "pending_approval" in data
