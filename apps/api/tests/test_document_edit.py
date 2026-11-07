"""
Document Edit Tests — sales/purchase documents, invoices and bills can be rewritten
until they are posted, converted, cancelled or paid.
"""
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

engine = create_engine("sqlite:///./test_document_edit.db", connect_args={"check_same_thread": False})
TestDB = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(autouse=True)
def setup():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db():
    s = TestDB()
    try:
        yield s
    finally:
        s.close()


@pytest.fixture
def client(db):
    app.dependency_overrides[get_db] = lambda: db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def h(client, db):
    db.add(User(email="acc@test.com", full_name="Acc", hashed_password=hash_password("Test@1234"),
                role=UserRole.ADMIN, is_active=True))   # admin, so bills can be rejected
    db.commit()
    tok = client.post("/api/v1/auth/login", json={"email": "acc@test.com", "password": "Test@1234"}).json()["access_token"]
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture
def acc(db):
    for code, t, nb in (("1102", AccountTypeEnum.ASSET, NormalBalance.DEBIT), ("1201", AccountTypeEnum.ASSET, NormalBalance.DEBIT),
                        ("1401", AccountTypeEnum.ASSET, NormalBalance.DEBIT), ("2101", AccountTypeEnum.LIABILITY, NormalBalance.CREDIT),
                        ("2103", AccountTypeEnum.LIABILITY, NormalBalance.CREDIT), ("4101", AccountTypeEnum.INCOME, NormalBalance.CREDIT),
                        ("5401", AccountTypeEnum.EXPENSE, NormalBalance.DEBIT)):
        db.add(Account(code=code, name=code, account_type=t, normal_balance=nb, level=3))
    db.commit()


@pytest.fixture
def customer(client, h):
    return client.post("/api/v1/ar/customers", json={"code": "C001", "name": "ลูกค้า ก"}, headers=h).json()


@pytest.fixture
def supplier(client, h):
    return client.post("/api/v1/ap/suppliers", json={"code": "S001", "name": "ผู้จำหน่าย ก"}, headers=h).json()


def _items(price, n=1):
    return [{"description": f"รายการ {i+1}", "quantity": 1, "unit_price": price} for i in range(n)]


def test_edit_quotation(client, h, customer):
    body = {"doc_type": "quotation", "customer_id": customer["id"], "date": "2025-03-01", "vat_rate": 7, "items": _items(1000)}
    doc = client.post("/api/v1/ar/sales-documents", json=body, headers=h).json()

    res = client.put(f"/api/v1/ar/sales-documents/{doc['id']}", headers=h,
                     json={**body, "date": "2025-03-05", "note": "แก้แล้ว", "items": _items(500, 3)})
    assert res.status_code == 200, res.text
    got = res.json()
    assert got["number"] == doc["number"] and got["date"] == "2025-03-05" and got["note"] == "แก้แล้ว"
    assert len(got["items"]) == 3 and Decimal(got["total"]) == Decimal("1605.00")

    # Type can't change; a converted document is locked.
    assert client.put(f"/api/v1/ar/sales-documents/{doc['id']}", json={**body, "doc_type": "sales_order"}, headers=h).status_code == 400
    client.post(f"/api/v1/ar/sales-documents/{doc['id']}/convert", headers=h)
    assert client.put(f"/api/v1/ar/sales-documents/{doc['id']}", json=body, headers=h).status_code == 400


def test_edit_purchase_order(client, h, supplier):
    body = {"doc_type": "purchase_order", "supplier_id": supplier["id"], "date": "2025-03-01", "vat_rate": 7, "items": _items(1000)}
    doc = client.post("/api/v1/ap/purchase-documents", json=body, headers=h).json()
    got = client.put(f"/api/v1/ap/purchase-documents/{doc['id']}", headers=h,
                     json={**body, "ref_number": "SUP-9", "items": _items(2000)}).json()
    assert got["ref_number"] == "SUP-9" and Decimal(got["total"]) == Decimal("2140.00")

    client.post(f"/api/v1/ap/purchase-documents/{doc['id']}/cancel", headers=h)
    assert client.put(f"/api/v1/ap/purchase-documents/{doc['id']}", json=body, headers=h).status_code == 400


def test_edit_invoice_until_posted(client, h, acc, customer):
    body = {"customer_id": customer["id"], "date": "2025-03-01", "vat_rate": 7, "items": _items(1000)}
    inv = client.post("/api/v1/ar/invoices", json=body, headers=h).json()
    got = client.put(f"/api/v1/ar/invoices/{inv['id']}", json={**body, "items": _items(1000, 2)}, headers=h).json()
    assert got["number"] == inv["number"] and Decimal(got["total"]) == Decimal("2140.00")
    assert Decimal(got["balance_due"]) == Decimal("2140.00") and len(got["items"]) == 2

    assert client.post(f"/api/v1/ar/invoices/{inv['id']}/post-gl", headers=h).status_code == 200
    assert client.put(f"/api/v1/ar/invoices/{inv['id']}", json=body, headers=h).status_code == 400


def test_edit_bill_draft_and_rejected(client, h, acc, supplier):
    body = {"supplier_id": supplier["id"], "date": "2025-03-01", "description": "ค่าบริการ",
            "vat_rate": 7, "wht_rate": 3, "items": _items(1000)}
    bill = client.post("/api/v1/ap/bills", json=body, headers=h).json()
    got = client.put(f"/api/v1/ap/bills/{bill['id']}", json={**body, "description": "ค่าบริการ (แก้)", "items": _items(2000)}, headers=h).json()
    # 2,000 + VAT 140 − WHT 60
    assert got["number"] == bill["number"] and got["description"] == "ค่าบริการ (แก้)"
    assert Decimal(got["total"]) == Decimal("2140.00") and Decimal(got["net_payable"]) == Decimal("2080.00")

    # Pending approval is locked; once rejected it can be fixed and goes back to draft.
    assert client.post(f"/api/v1/ap/bills/{bill['id']}/submit", headers=h).status_code == 200
    assert client.put(f"/api/v1/ap/bills/{bill['id']}", json=body, headers=h).status_code == 400
    rej = client.post(f"/api/v1/ap/bills/{bill['id']}/approve", json={"action": "rejected", "comment": "ผิด"}, headers=h)
    assert rej.status_code == 200, rej.text
    got = client.put(f"/api/v1/ap/bills/{bill['id']}", json=body, headers=h)
    assert got.status_code == 200 and got.json()["status"] == "draft"
