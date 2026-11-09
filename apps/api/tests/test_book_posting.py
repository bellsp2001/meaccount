"""
Book Posting Tests — invoices/bills that carry a สมุดบันทึก post through its journal and accounts
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

engine = create_engine("sqlite:///./test_book_posting.db", connect_args={"check_same_thread": False})
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
                role=UserRole.ACCOUNTANT, is_active=True))
    db.commit()
    tok = client.post("/api/v1/auth/login", json={"email": "acc@test.com", "password": "Test@1234"}).json()["access_token"]
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture
def acc(db):
    """code → Account. Includes the defaults the services fall back to (1201/4101/2103, 2101/1401/5401)."""
    rows = [
        ("1101", "เงินสด", AccountTypeEnum.ASSET, NormalBalance.DEBIT),
        ("1201", "ลูกหนี้การค้า", AccountTypeEnum.ASSET, NormalBalance.DEBIT),
        ("1401", "ภาษีซื้อ", AccountTypeEnum.ASSET, NormalBalance.DEBIT),
        ("2101", "เจ้าหนี้การค้า", AccountTypeEnum.LIABILITY, NormalBalance.CREDIT),
        ("2103", "ภาษีขาย", AccountTypeEnum.LIABILITY, NormalBalance.CREDIT),
        ("4101", "รายได้จากการขาย", AccountTypeEnum.INCOME, NormalBalance.CREDIT),
        ("4102", "รายได้ค่าบริการ", AccountTypeEnum.INCOME, NormalBalance.CREDIT),
        ("5201", "ค่าเช่า", AccountTypeEnum.EXPENSE, NormalBalance.DEBIT),
        ("5401", "ค่าใช้จ่ายเบ็ดเตล็ด", AccountTypeEnum.EXPENSE, NormalBalance.DEBIT),
    ]
    out = {}
    for code, name, t, nb in rows:
        a = Account(code=code, name=name, account_type=t, normal_balance=nb, level=3)
        db.add(a)
        out[code] = a
    db.commit()
    for a in out.values():
        db.refresh(a)
    return out


@pytest.fixture
def customer(client, h):
    return client.post("/api/v1/ar/customers", json={"code": "C001", "name": "ลูกค้า ก"}, headers=h).json()


def _book(client, h, **body):
    res = client.post("/api/v1/document-books/", json=body, headers=h)
    assert res.status_code == 200, res.text
    return res.json()


def _journal_for(client, h, reference):
    js = client.get("/api/v1/journals/", headers=h).json()
    j = next(j for j in js if j["reference"] == reference)
    lines = {(e["account_code"], "dr" if Decimal(e["debit"]) > 0 else "cr"): Decimal(e["debit"]) or Decimal(e["credit"])
             for e in j["entries"]}
    return j, lines


def _invoice(client, h, customer, book_id=None):
    body = {"customer_id": customer["id"], "date": "2025-03-01", "vat_rate": 7,
            "items": [{"description": "บริการ", "quantity": 1, "unit_price": 1000}]}
    if book_id:
        body["book_id"] = book_id
    return client.post("/api/v1/ar/invoices", json=body, headers=h)


# ── Invoices ──────────────────────────────────────────────────
def test_invoice_posts_through_book(client, h, acc, customer):
    book = _book(client, h, code="CS", name="ขายสด/ใบกำกับภาษี", side="income", journal_type="receipt",
                 account_id=str(acc["4102"].id), counter_account_id=str(acc["1101"].id))
    inv = _invoice(client, h, customer, book["id"]).json()
    assert inv["book"]["code"] == "CS"

    assert client.post(f"/api/v1/ar/invoices/{inv['id']}/post-gl", headers=h).status_code == 200
    j, lines = _journal_for(client, h, inv["number"])
    assert j["journal_type"] == "receipt"
    assert lines == {("1101", "dr"): Decimal("1070.00"), ("4102", "cr"): Decimal("1000.00"), ("2103", "cr"): Decimal("70.00")}


def test_invoice_book_without_counter_falls_back_to_receivable(client, h, acc, customer):
    book = _book(client, h, code="SV", name="ใบแจ้งหนี้บริการ", side="income", journal_type="sales",
                 account_id=str(acc["4102"].id))
    inv = _invoice(client, h, customer, book["id"]).json()
    client.post(f"/api/v1/ar/invoices/{inv['id']}/post-gl", headers=h)
    _, lines = _journal_for(client, h, inv["number"])
    assert ("1201", "dr") in lines and ("4102", "cr") in lines


def test_invoice_without_book_cannot_be_confirmed(client, h, acc, customer):
    # Saving a draft without a book is fine; confirming (posting) it is not.
    inv = _invoice(client, h, customer).json()
    assert inv["book"] is None
    res = client.post(f"/api/v1/ar/invoices/{inv['id']}/post-gl", headers=h)
    assert res.status_code == 400 and "สมุดบันทึก" in res.json()["detail"]
    assert client.get("/api/v1/journals/", headers=h).json() == []


def test_invoice_rejects_expense_book(client, h, acc, customer):
    book = _book(client, h, code="EXP", name="บิล", side="expense", journal_type="purchase", account_id=str(acc["5201"].id))
    assert _invoice(client, h, customer, book["id"]).status_code == 400


def test_invoice_rejects_inactive_book(client, h, acc, customer):
    book = _book(client, h, code="OLD", name="เลิกใช้", side="income", journal_type="sales", account_id=str(acc["4101"].id))
    client.patch(f"/api/v1/document-books/{book['id']}", json={"is_active": False}, headers=h)
    assert _invoice(client, h, customer, book["id"]).status_code == 400


# ── Bills ─────────────────────────────────────────────────────
def test_bill_posts_through_book(client, h, acc):
    book = _book(client, h, code="RENT", name="ค่าเช่าจ่ายสด", side="expense", journal_type="payment",
                 account_id=str(acc["5201"].id), counter_account_id=str(acc["1101"].id))
    bill = client.post("/api/v1/ap/bills", json={
        "date": "2025-03-01", "description": "ค่าเช่าสำนักงาน", "vat_rate": 7, "book_id": book["id"],
        "items": [{"description": "ค่าเช่า มี.ค.", "quantity": 1, "unit_price": 2000}],
    }, headers=h).json()
    assert bill["book"]["code"] == "RENT"

    assert client.post(f"/api/v1/ap/bills/{bill['id']}/post-gl", headers=h).status_code == 200
    j, lines = _journal_for(client, h, bill["number"])
    assert j["journal_type"] == "payment"
    assert lines == {("5201", "dr"): Decimal("2000.00"), ("1401", "dr"): Decimal("140.00"), ("1101", "cr"): Decimal("2140.00")}


def test_bill_without_book_cannot_be_confirmed(client, h, acc):
    bill = client.post("/api/v1/ap/bills", json={
        "date": "2025-03-01", "description": "ทั่วไป", "vat_rate": 0,
        "items": [{"description": "ของใช้", "quantity": 1, "unit_price": 500}],
    }, headers=h).json()
    for action in ("submit", "post-gl"):
        res = client.post(f"/api/v1/ap/bills/{bill['id']}/{action}", headers=h)
        assert res.status_code == 400 and "สมุดบันทึก" in res.json()["detail"]
    assert client.get("/api/v1/journals/", headers=h).json() == []


def test_inactive_book_blocks_confirming(client, h, acc, customer):
    book = _book(client, h, code="CASH", name="ขายสด", side="income", journal_type="receipt", account_id=str(acc["4101"].id))
    inv = _invoice(client, h, customer, book["id"]).json()
    client.patch(f"/api/v1/document-books/{book['id']}", json={"is_active": False}, headers=h)
    res = client.post(f"/api/v1/ar/invoices/{inv['id']}/post-gl", headers=h)
    assert res.status_code == 400 and "ปิดใช้งาน" in res.json()["detail"]


def test_bill_rejects_income_book(client, h, acc):
    book = _book(client, h, code="INV", name="ใบแจ้งหนี้", side="income", journal_type="sales", account_id=str(acc["4101"].id))
    res = client.post("/api/v1/ap/bills", json={
        "date": "2025-03-01", "description": "x", "book_id": book["id"],
        "items": [{"description": "x", "quantity": 1, "unit_price": 1}],
    }, headers=h)
    assert res.status_code == 400


# ── Book deletion once used ───────────────────────────────────
def test_used_book_cannot_be_deleted(client, h, acc, customer):
    book = _book(client, h, code="INV", name="ใบแจ้งหนี้", side="income", journal_type="sales", account_id=str(acc["4101"].id))
    _invoice(client, h, customer, book["id"])
    res = client.delete(f"/api/v1/document-books/{book['id']}", headers=h)
    assert res.status_code == 400
    assert "ปิดใช้งาน" in res.json()["detail"]
