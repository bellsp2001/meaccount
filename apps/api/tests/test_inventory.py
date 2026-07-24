"""Inventory Tests — Product CRUD, FIFO costing, PO workflow, AI Forecast"""
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

engine = create_engine("sqlite:///./test_inv.db", connect_args={"check_same_thread": False})
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
def warehouse(client, token):
    res = client.post("/api/v1/inventory/warehouses", json={"code": "WH01", "name": "คลังหลัก", "is_default": True},
                      headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    return res.json()

@pytest.fixture
def product(client, token):
    res = client.post("/api/v1/inventory/products", json={
        "sku": "P001", "name": "สินค้าทดสอบ", "unit": "ชิ้น",
        "cost_method": "fifo", "sale_price": 100, "reorder_point": 10,
    }, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    return res.json()

@pytest.fixture
def gl_accounts(db):
    accs = [
        Account(code="1301", name="สินค้าคงเหลือ", account_type=AccountTypeEnum.ASSET,  normal_balance=NormalBalance.DEBIT, level=3),
        Account(code="5101", name="ต้นทุนขาย",     account_type=AccountTypeEnum.EXPENSE, normal_balance=NormalBalance.DEBIT, level=2),
    ]
    for a in accs: db.add(a)
    db.commit(); return accs

# ── Warehouse & Product ───────────────────────────────────────
def test_create_warehouse(client, token):
    res = client.post("/api/v1/inventory/warehouses", json={"code": "WH01", "name": "คลังหลัก"},
                      headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200

def test_create_product(client, token):
    res = client.post("/api/v1/inventory/products", json={"sku": "P001", "name": "สินค้า A", "unit": "ชิ้น"},
                      headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert float(res.json()["qty_on_hand"]) == 0

def test_duplicate_sku_rejected(client, token, product):
    res = client.post("/api/v1/inventory/products", json={"sku": "P001", "name": "Dup"},
                      headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 400

# ── Stock Receive ─────────────────────────────────────────────
def test_receive_stock(client, token, product, warehouse):
    res = client.post("/api/v1/inventory/movements/receive", json={
        "product_id": product["id"], "warehouse_id": warehouse["id"],
        "date": "2024-03-01", "quantity": 100, "unit_cost": 50,
    }, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.json()["movement_type"] == "receive"

    p = client.get(f"/api/v1/inventory/products/{product['id']}", headers={"Authorization": f"Bearer {token}"}).json()
    assert float(p["qty_on_hand"]) == 100
    assert float(p["avg_cost"]) == 50

# ── FIFO Issue ────────────────────────────────────────────────
def test_fifo_issue_correct_cost(client, token, product, warehouse):
    # Receive 2 lots at different costs
    client.post("/api/v1/inventory/movements/receive", json={
        "product_id": product["id"], "warehouse_id": warehouse["id"],
        "date": "2024-03-01", "quantity": 50, "unit_cost": 10,
    }, headers={"Authorization": f"Bearer {token}"})
    client.post("/api/v1/inventory/movements/receive", json={
        "product_id": product["id"], "warehouse_id": warehouse["id"],
        "date": "2024-03-05", "quantity": 50, "unit_cost": 20,
    }, headers={"Authorization": f"Bearer {token}"})

    # Issue 60 units — should consume all of first lot (50@10) + 10 from second (10@20) = 500+200=700
    res = client.post("/api/v1/inventory/movements/issue", json={
        "product_id": product["id"], "warehouse_id": warehouse["id"],
        "date": "2024-03-10", "quantity": 60,
    }, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.json()
    assert float(data["total_cost"]) == 700  # FIFO: 50*10 + 10*20

    p = client.get(f"/api/v1/inventory/products/{product['id']}", headers={"Authorization": f"Bearer {token}"}).json()
    assert float(p["qty_on_hand"]) == 40  # 100 - 60

def test_issue_insufficient_stock_rejected(client, token, product, warehouse):
    client.post("/api/v1/inventory/movements/receive", json={
        "product_id": product["id"], "warehouse_id": warehouse["id"],
        "date": "2024-03-01", "quantity": 10, "unit_cost": 5,
    }, headers={"Authorization": f"Bearer {token}"})
    res = client.post("/api/v1/inventory/movements/issue", json={
        "product_id": product["id"], "warehouse_id": warehouse["id"],
        "date": "2024-03-05", "quantity": 999,
    }, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 400

# ── GL Posting ────────────────────────────────────────────────
def test_post_issue_to_gl(client, token, product, warehouse, gl_accounts, db):
    client.post("/api/v1/inventory/movements/receive", json={
        "product_id": product["id"], "warehouse_id": warehouse["id"],
        "date": "2024-03-01", "quantity": 20, "unit_cost": 15,
    }, headers={"Authorization": f"Bearer {token}"})
    issue_res = client.post("/api/v1/inventory/movements/issue", json={
        "product_id": product["id"], "warehouse_id": warehouse["id"],
        "date": "2024-03-05", "quantity": 5,
    }, headers={"Authorization": f"Bearer {token}"})
    mid = issue_res.json()["id"]

    post_res = client.post(f"/api/v1/inventory/movements/{mid}/post-gl",
                           headers={"Authorization": f"Bearer {token}"})
    assert post_res.status_code == 200
    assert post_res.json()["gl_posted"] is True

    cogs = next(a for a in gl_accounts if a.code == "5101")
    db.refresh(cogs)
    assert float(cogs.balance) == 75  # 5 * 15

# ── Purchase Order ────────────────────────────────────────────
def test_create_and_receive_po(client, token, product, warehouse):
    po_res = client.post("/api/v1/inventory/po", json={
        "warehouse_id": warehouse["id"], "date": "2024-03-01",
        "items": [{"product_id": product["id"], "quantity": 100, "unit_cost": 8}],
    }, headers={"Authorization": f"Bearer {token}"})
    assert po_res.status_code == 200
    po = po_res.json()
    assert po["status"] == "draft"
    assert float(po["total"]) == 800

    submit_res = client.post(f"/api/v1/inventory/po/{po['id']}/submit",
                             headers={"Authorization": f"Bearer {token}"})
    assert submit_res.json()["status"] == "ordered"

    item_id = po["items"][0]["id"]
    recv_res = client.post(f"/api/v1/inventory/po/{po['id']}/receive", json={
        "items": [{"po_item_id": item_id, "quantity": 100}]
    }, headers={"Authorization": f"Bearer {token}"})
    assert recv_res.status_code == 200
    assert recv_res.json()["status"] == "received"

    p = client.get(f"/api/v1/inventory/products/{product['id']}", headers={"Authorization": f"Bearer {token}"}).json()
    assert float(p["qty_on_hand"]) == 100

def test_partial_po_receive(client, token, product, warehouse):
    po_res = client.post("/api/v1/inventory/po", json={
        "warehouse_id": warehouse["id"], "date": "2024-03-01",
        "items": [{"product_id": product["id"], "quantity": 100, "unit_cost": 8}],
    }, headers={"Authorization": f"Bearer {token}"})
    po = po_res.json()
    client.post(f"/api/v1/inventory/po/{po['id']}/submit", headers={"Authorization": f"Bearer {token}"})

    item_id = po["items"][0]["id"]
    recv_res = client.post(f"/api/v1/inventory/po/{po['id']}/receive", json={
        "items": [{"po_item_id": item_id, "quantity": 40}]
    }, headers={"Authorization": f"Bearer {token}"})
    assert recv_res.json()["status"] == "partial"

# ── AI Forecast ───────────────────────────────────────────────
def test_forecast_no_history(client, token, product):
    res = client.get(f"/api/v1/inventory/ai/forecast/{product['id']}",
                     headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.json()
    assert "avg_daily_usage" in data
    assert "forecast_30d" in data

def test_reorder_suggestions(client, token, product, warehouse):
    # product has reorder_point=10, currently 0 stock → should suggest reorder
    res = client.get("/api/v1/inventory/ai/reorder-suggestions",
                     headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    suggestions = res.json()
    assert any(s["sku"] == "P001" for s in suggestions)

def test_low_stock_filter(client, token, product, warehouse):
    res = client.get("/api/v1/inventory/products?low_stock_only=true",
                     headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert len(res.json()) >= 1
