"""POS Tests — Shift lifecycle, checkout stock/GL integration, void reversal, cash reconciliation"""
import pytest
from decimal import Decimal
from datetime import date, timedelta
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from core.database import Base, get_db
from core.security import hash_password
from models.user import User, UserRole
from models.inventory import Warehouse, Product, CostMethod
from models.accounting import Account, AccountTypeEnum, NormalBalance
from main import app

engine = create_engine("sqlite:///./test_pos.db", connect_args={"check_same_thread": False})
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
    u = User(email=email, full_name="Test", hashed_password=hash_password("Test@1234"), role=role, is_active=True)
    db.add(u); db.commit(); db.refresh(u); return u

def get_token(client, email):
    return client.post("/api/v1/auth/login", json={"email": email, "password": "Test@1234"}).json()["access_token"]

@pytest.fixture
def acc_token(client, db):
    make_user(db, UserRole.ACCOUNTANT, "acc@test.com")
    return get_token(client, "acc@test.com")

@pytest.fixture
def cashier_token(client, db):
    make_user(db, UserRole.CASHIER, "cashier@test.com")
    return get_token(client, "cashier@test.com")

@pytest.fixture
def warehouse(db):
    w = Warehouse(code="WH01", name="สาขาหลัก", is_default=True)
    db.add(w); db.commit(); db.refresh(w)
    return w

@pytest.fixture
def product_with_stock(db, warehouse, acc_token, client):
    """A product with 100 units in stock at cost 50, sale price 100."""
    p = Product(sku="P001", name="สินค้าทดสอบ", unit="ชิ้น", cost_method=CostMethod.FIFO,
               sale_price=Decimal("100"), barcode="8850000000001", track_stock=True)
    db.add(p); db.commit(); db.refresh(p)
    client.post("/api/v1/inventory/movements/receive", json={
        "product_id": str(p.id), "warehouse_id": str(warehouse.id),
        "date": str(date.today()), "quantity": 100, "unit_cost": 50,
    }, headers={"Authorization": f"Bearer {acc_token}"})
    db.refresh(p)
    return p

@pytest.fixture
def gl_accounts(db):
    accs = [
        Account(code="1101", name="เงินสด", account_type=AccountTypeEnum.ASSET, normal_balance=NormalBalance.DEBIT, level=3, balance=Decimal("0")),
        Account(code="1301", name="สินค้าคงเหลือ", account_type=AccountTypeEnum.ASSET, normal_balance=NormalBalance.DEBIT, level=3, balance=Decimal("0")),
        Account(code="2103", name="VAT ขาย", account_type=AccountTypeEnum.LIABILITY, normal_balance=NormalBalance.CREDIT, level=3, balance=Decimal("0")),
        Account(code="4101", name="รายได้ขาย", account_type=AccountTypeEnum.INCOME, normal_balance=NormalBalance.CREDIT, level=2, balance=Decimal("0")),
        Account(code="5101", name="ต้นทุนขาย", account_type=AccountTypeEnum.EXPENSE, normal_balance=NormalBalance.DEBIT, level=2, balance=Decimal("0")),
    ]
    for a in accs: db.add(a)
    db.commit(); return accs


# ── Shift Lifecycle ─────────────────────────────────────────────
def test_open_shift(client, acc_token, warehouse):
    res = client.post("/api/v1/pos/shifts/open", json={"warehouse_id": str(warehouse.id), "opening_cash": 1000},
                      headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    assert res.json()["status"] == "open"
    assert float(res.json()["opening_cash"]) == 1000

def test_cannot_open_second_shift_same_warehouse(client, acc_token, warehouse):
    client.post("/api/v1/pos/shifts/open", json={"warehouse_id": str(warehouse.id), "opening_cash": 1000},
               headers={"Authorization": f"Bearer {acc_token}"})
    res = client.post("/api/v1/pos/shifts/open", json={"warehouse_id": str(warehouse.id), "opening_cash": 500},
                      headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 400

def test_negative_opening_cash_rejected(client, acc_token, warehouse):
    res = client.post("/api/v1/pos/shifts/open", json={"warehouse_id": str(warehouse.id), "opening_cash": -100},
                      headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 422


# ── Checkout — real stock + cost integration ────────────────────
def test_checkout_issues_real_stock_via_fifo(client, cashier_token, acc_token, warehouse, product_with_stock):
    shift = client.post("/api/v1/pos/shifts/open", json={"warehouse_id": str(warehouse.id), "opening_cash": 0},
                        headers={"Authorization": f"Bearer {acc_token}"}).json()

    res = client.post("/api/v1/pos/sales", json={
        "shift_id": shift["id"],
        "items": [{"product_id": str(product_with_stock.id), "quantity": 5}],
        "payments": [{"method": "cash", "amount": 535}],   # 5*100=500 + 7% VAT = 535
        "vat_rate": 7,
    }, headers={"Authorization": f"Bearer {cashier_token}"})
    assert res.status_code == 200
    data = res.json()
    assert float(data["subtotal"]) == 500
    assert float(data["vat_amount"]) == 35.0
    assert float(data["total"]) == 535
    assert data["items"][0]["unit_cost_at_sale"] is not None
    assert float(data["items"][0]["unit_cost_at_sale"]) == 50   # real FIFO cost from the seeded receive

def test_checkout_actually_reduces_stock(client, cashier_token, acc_token, warehouse, product_with_stock, db):
    shift = client.post("/api/v1/pos/shifts/open", json={"warehouse_id": str(warehouse.id), "opening_cash": 0},
                        headers={"Authorization": f"Bearer {acc_token}"}).json()
    client.post("/api/v1/pos/sales", json={
        "shift_id": shift["id"], "items": [{"product_id": str(product_with_stock.id), "quantity": 10}],
        "payments": [{"method": "cash", "amount": 1070}],
    }, headers={"Authorization": f"Bearer {cashier_token}"})

    check = client.get(f"/api/v1/inventory/products/{product_with_stock.id}",
                       headers={"Authorization": f"Bearer {acc_token}"}).json()
    assert float(check["qty_on_hand"]) == 90   # 100 - 10

def test_checkout_insufficient_stock_rejected(client, cashier_token, acc_token, warehouse, product_with_stock):
    shift = client.post("/api/v1/pos/shifts/open", json={"warehouse_id": str(warehouse.id), "opening_cash": 0},
                        headers={"Authorization": f"Bearer {acc_token}"}).json()
    res = client.post("/api/v1/pos/sales", json={
        "shift_id": shift["id"], "items": [{"product_id": str(product_with_stock.id), "quantity": 9999}],
        "payments": [{"method": "cash", "amount": 999999}],
    }, headers={"Authorization": f"Bearer {cashier_token}"})
    assert res.status_code == 400

def test_checkout_rejects_mismatched_payment_total(client, cashier_token, acc_token, warehouse, product_with_stock):
    shift = client.post("/api/v1/pos/shifts/open", json={"warehouse_id": str(warehouse.id), "opening_cash": 0},
                        headers={"Authorization": f"Bearer {acc_token}"}).json()
    res = client.post("/api/v1/pos/sales", json={
        "shift_id": shift["id"], "items": [{"product_id": str(product_with_stock.id), "quantity": 1}],
        "payments": [{"method": "cash", "amount": 1}],   # way off from the real 107 total
    }, headers={"Authorization": f"Bearer {cashier_token}"})
    assert res.status_code == 400

def test_checkout_rejects_sale_on_closed_shift(client, cashier_token, acc_token, warehouse, product_with_stock):
    shift = client.post("/api/v1/pos/shifts/open", json={"warehouse_id": str(warehouse.id), "opening_cash": 0},
                        headers={"Authorization": f"Bearer {acc_token}"}).json()
    client.post(f"/api/v1/pos/shifts/{shift['id']}/close", json={"closing_cash_counted": 0},
               headers={"Authorization": f"Bearer {acc_token}"})

    res = client.post("/api/v1/pos/sales", json={
        "shift_id": shift["id"], "items": [{"product_id": str(product_with_stock.id), "quantity": 1}],
        "payments": [{"method": "cash", "amount": 107}],
    }, headers={"Authorization": f"Bearer {cashier_token}"})
    assert res.status_code == 400

def test_checkout_split_payment_methods(client, cashier_token, acc_token, warehouse, product_with_stock):
    shift = client.post("/api/v1/pos/shifts/open", json={"warehouse_id": str(warehouse.id), "opening_cash": 0},
                        headers={"Authorization": f"Bearer {acc_token}"}).json()
    res = client.post("/api/v1/pos/sales", json={
        "shift_id": shift["id"], "items": [{"product_id": str(product_with_stock.id), "quantity": 10}],
        "payments": [{"method": "cash", "amount": 500}, {"method": "credit_card", "amount": 570, "reference": "AUTH123"}],
    }, headers={"Authorization": f"Bearer {cashier_token}"})
    assert res.status_code == 200
    assert len(res.json()["payments"]) == 2


# ── GL Posting ────────────────────────────────────────────────
def test_post_sale_to_gl(client, cashier_token, acc_token, warehouse, product_with_stock, gl_accounts, db):
    shift = client.post("/api/v1/pos/shifts/open", json={"warehouse_id": str(warehouse.id), "opening_cash": 0},
                        headers={"Authorization": f"Bearer {acc_token}"}).json()
    sale = client.post("/api/v1/pos/sales", json={
        "shift_id": shift["id"], "items": [{"product_id": str(product_with_stock.id), "quantity": 10}],
        "payments": [{"method": "cash", "amount": 1070}],
    }, headers={"Authorization": f"Bearer {cashier_token}"}).json()

    res = client.post(f"/api/v1/pos/sales/{sale['id']}/post-gl", headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    assert res.json()["gl_posted"] is True

    cash_acc = next(a for a in gl_accounts if a.code == "1101")
    revenue_acc = next(a for a in gl_accounts if a.code == "4101")
    cogs_acc = next(a for a in gl_accounts if a.code == "5101")
    db.refresh(cash_acc); db.refresh(revenue_acc); db.refresh(cogs_acc)

    assert cash_acc.balance == Decimal("1070")   # full amount received
    assert revenue_acc.balance == Decimal("1000")   # 10 * 100, ex-VAT
    assert cogs_acc.balance == Decimal("500")   # 10 units * real FIFO cost 50

def test_cannot_double_post_sale_gl(client, cashier_token, acc_token, warehouse, product_with_stock, gl_accounts):
    shift = client.post("/api/v1/pos/shifts/open", json={"warehouse_id": str(warehouse.id), "opening_cash": 0},
                        headers={"Authorization": f"Bearer {acc_token}"}).json()
    sale = client.post("/api/v1/pos/sales", json={
        "shift_id": shift["id"], "items": [{"product_id": str(product_with_stock.id), "quantity": 1}],
        "payments": [{"method": "cash", "amount": 107}],
    }, headers={"Authorization": f"Bearer {cashier_token}"}).json()
    client.post(f"/api/v1/pos/sales/{sale['id']}/post-gl", headers={"Authorization": f"Bearer {acc_token}"})

    res = client.post(f"/api/v1/pos/sales/{sale['id']}/post-gl", headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 400


# ── Void ──────────────────────────────────────────────────────
def test_void_sale_restores_stock(client, cashier_token, acc_token, warehouse, product_with_stock, db):
    shift = client.post("/api/v1/pos/shifts/open", json={"warehouse_id": str(warehouse.id), "opening_cash": 0},
                        headers={"Authorization": f"Bearer {acc_token}"}).json()
    sale = client.post("/api/v1/pos/sales", json={
        "shift_id": shift["id"], "items": [{"product_id": str(product_with_stock.id), "quantity": 20}],
        "payments": [{"method": "cash", "amount": 2140}],
    }, headers={"Authorization": f"Bearer {cashier_token}"}).json()

    before_void = client.get(f"/api/v1/inventory/products/{product_with_stock.id}",
                             headers={"Authorization": f"Bearer {acc_token}"}).json()
    assert float(before_void["qty_on_hand"]) == 80   # 100 - 20

    res = client.post(f"/api/v1/pos/sales/{sale['id']}/void", json={"reason": "ลูกค้าเปลี่ยนใจ"},
                      headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    assert res.json()["status"] == "voided"

    after_void = client.get(f"/api/v1/inventory/products/{product_with_stock.id}",
                            headers={"Authorization": f"Bearer {acc_token}"}).json()
    assert float(after_void["qty_on_hand"]) == 100   # stock restored

def test_cannot_void_already_posted_sale(client, cashier_token, acc_token, warehouse, product_with_stock, gl_accounts):
    shift = client.post("/api/v1/pos/shifts/open", json={"warehouse_id": str(warehouse.id), "opening_cash": 0},
                        headers={"Authorization": f"Bearer {acc_token}"}).json()
    sale = client.post("/api/v1/pos/sales", json={
        "shift_id": shift["id"], "items": [{"product_id": str(product_with_stock.id), "quantity": 1}],
        "payments": [{"method": "cash", "amount": 107}],
    }, headers={"Authorization": f"Bearer {cashier_token}"}).json()
    client.post(f"/api/v1/pos/sales/{sale['id']}/post-gl", headers={"Authorization": f"Bearer {acc_token}"})

    res = client.post(f"/api/v1/pos/sales/{sale['id']}/void", json={"reason": "test"},
                      headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 400

def test_cannot_void_already_voided_sale(client, cashier_token, acc_token, warehouse, product_with_stock):
    shift = client.post("/api/v1/pos/shifts/open", json={"warehouse_id": str(warehouse.id), "opening_cash": 0},
                        headers={"Authorization": f"Bearer {acc_token}"}).json()
    sale = client.post("/api/v1/pos/sales", json={
        "shift_id": shift["id"], "items": [{"product_id": str(product_with_stock.id), "quantity": 1}],
        "payments": [{"method": "cash", "amount": 107}],
    }, headers={"Authorization": f"Bearer {cashier_token}"}).json()
    client.post(f"/api/v1/pos/sales/{sale['id']}/void", json={"reason": "first void"},
               headers={"Authorization": f"Bearer {acc_token}"})

    res = client.post(f"/api/v1/pos/sales/{sale['id']}/void", json={"reason": "second void"},
                      headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 400


# ── Shift Close & Cash Reconciliation ─────────────────────────
def test_close_shift_calculates_variance_correctly(client, cashier_token, acc_token, warehouse, product_with_stock):
    shift = client.post("/api/v1/pos/shifts/open", json={"warehouse_id": str(warehouse.id), "opening_cash": 1000},
                        headers={"Authorization": f"Bearer {acc_token}"}).json()

    # Two cash sales totaling 214 (2 * 107)
    for _ in range(2):
        client.post("/api/v1/pos/sales", json={
            "shift_id": shift["id"], "items": [{"product_id": str(product_with_stock.id), "quantity": 1}],
            "payments": [{"method": "cash", "amount": 107}],
        }, headers={"Authorization": f"Bearer {cashier_token}"})

    # Expected cash: 1000 opening + 214 sales = 1214. Cashier counts 1200 (short by 14).
    res = client.post(f"/api/v1/pos/shifts/{shift['id']}/close", json={"closing_cash_counted": 1200},
                      headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    data = res.json()
    assert float(data["closing_cash_expected"]) == 1214
    assert float(data["cash_variance"]) == -14   # short

def test_close_shift_excludes_non_cash_payments_from_expected(client, cashier_token, acc_token, warehouse, product_with_stock):
    shift = client.post("/api/v1/pos/shifts/open", json={"warehouse_id": str(warehouse.id), "opening_cash": 0},
                        headers={"Authorization": f"Bearer {acc_token}"}).json()
    client.post("/api/v1/pos/sales", json={
        "shift_id": shift["id"], "items": [{"product_id": str(product_with_stock.id), "quantity": 1}],
        "payments": [{"method": "credit_card", "amount": 107, "reference": "AUTH"}],
    }, headers={"Authorization": f"Bearer {cashier_token}"})

    res = client.post(f"/api/v1/pos/shifts/{shift['id']}/close", json={"closing_cash_counted": 0},
                      headers={"Authorization": f"Bearer {acc_token}"})
    # Card payment must NOT count toward expected cash in the drawer
    assert float(res.json()["closing_cash_expected"]) == 0
    assert float(res.json()["cash_variance"]) == 0

def test_cannot_close_already_closed_shift(client, acc_token, warehouse):
    shift = client.post("/api/v1/pos/shifts/open", json={"warehouse_id": str(warehouse.id), "opening_cash": 0},
                        headers={"Authorization": f"Bearer {acc_token}"}).json()
    client.post(f"/api/v1/pos/shifts/{shift['id']}/close", json={"closing_cash_counted": 0},
               headers={"Authorization": f"Bearer {acc_token}"})
    res = client.post(f"/api/v1/pos/shifts/{shift['id']}/close", json={"closing_cash_counted": 0},
                      headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 400


# ── Barcode Lookup ────────────────────────────────────────────
def test_barcode_lookup_finds_product(client, acc_token, product_with_stock):
    res = client.get(f"/api/v1/pos/barcode/{product_with_stock.barcode}",
                     headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    assert res.json()["sku"] == "P001"

def test_barcode_lookup_falls_back_to_sku(client, acc_token, product_with_stock):
    res = client.get(f"/api/v1/pos/barcode/{product_with_stock.sku}",
                     headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200

def test_barcode_lookup_unknown_code_404s(client, acc_token):
    res = client.get("/api/v1/pos/barcode/NONEXISTENT999", headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 404
