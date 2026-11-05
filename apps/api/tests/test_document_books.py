"""
Document Book Tests — สมุดบันทึก CRUD + account/tax validation
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
from models.tax import TaxCode, TaxKind
from main import app

engine = create_engine("sqlite:///./test_document_books.db", connect_args={"check_same_thread": False})
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


def _login(client, db, email, role):
    db.add(User(email=email, full_name=role.value, hashed_password=hash_password("Test@1234"), role=role, is_active=True))
    db.commit()
    tok = client.post("/api/v1/auth/login", json={"email": email, "password": "Test@1234"}).json()["access_token"]
    return {"Authorization": f"Bearer {tok}"}


@pytest.fixture
def h(client, db):
    return _login(client, db, "acc@test.com", UserRole.ACCOUNTANT)


@pytest.fixture
def coa(db):
    def acc(code, name, t, nb):
        a = Account(code=code, name=name, account_type=t, normal_balance=nb, level=3)
        db.add(a)
        return a
    accs = {
        "ar":   acc("1201", "ลูกหนี้การค้า", AccountTypeEnum.ASSET, NormalBalance.DEBIT),
        "inv":  acc("1301", "สินค้าคงเหลือ", AccountTypeEnum.ASSET, NormalBalance.DEBIT),
        "ap":   acc("2101", "เจ้าหนี้การค้า", AccountTypeEnum.LIABILITY, NormalBalance.CREDIT),
        "rev":  acc("4101", "รายได้จากการขาย", AccountTypeEnum.INCOME, NormalBalance.CREDIT),
        "exp":  acc("5201", "ค่าเช่า", AccountTypeEnum.EXPENSE, NormalBalance.DEBIT),
        "eq":   acc("3101", "ทุนจดทะเบียน", AccountTypeEnum.EQUITY, NormalBalance.CREDIT),
    }
    vat = TaxCode(code="VAT7", name="VAT 7%", kind=TaxKind.VAT, rate=Decimal("7"))
    db.add(vat)
    db.commit()
    for a in accs.values():
        db.refresh(a)
    db.refresh(vat)
    accs["vat"] = vat
    return accs


def _invoice_book(coa, **over):
    body = {"code": "inv", "name": "ใบแจ้งหนี้/ใบกำกับภาษี", "side": "income", "journal_type": "sales",
            "account_id": str(coa["rev"].id), "counter_account_id": str(coa["ar"].id),
            "tax_code_id": str(coa["vat"].id)}
    body.update(over)
    return body


def test_create_and_list_income_book(client, h, coa):
    res = client.post("/api/v1/document-books/", json=_invoice_book(coa), headers=h)
    assert res.status_code == 200, res.text
    b = res.json()
    assert b["code"] == "INV"                       # normalised to upper case
    assert b["journal_type"] == "sales"
    assert b["account"]["code"] == "4101"
    assert b["counter_account"]["code"] == "1201"
    assert b["tax_code"]["code"] == "VAT7"

    rows = client.get("/api/v1/document-books/?side=income", headers=h).json()
    assert [r["code"] for r in rows] == ["INV"]
    assert client.get("/api/v1/document-books/?side=expense", headers=h).json() == []


def test_duplicate_code_rejected(client, h, coa):
    client.post("/api/v1/document-books/", json=_invoice_book(coa), headers=h)
    res = client.post("/api/v1/document-books/", json=_invoice_book(coa, name="อีกเล่ม"), headers=h)
    assert res.status_code == 400


def test_income_book_needs_income_account(client, h, coa):
    res = client.post("/api/v1/document-books/", json=_invoice_book(coa, account_id=str(coa["exp"].id)), headers=h)
    assert res.status_code == 400


def test_expense_book_accepts_expense_or_asset(client, h, coa):
    for code, acc in (("EXP", "exp"), ("STK", "inv")):
        res = client.post("/api/v1/document-books/", json={
            "code": code, "name": "บิล " + code, "side": "expense", "journal_type": "purchase",
            "account_id": str(coa[acc].id), "counter_account_id": str(coa["ap"].id),
        }, headers=h)
        assert res.status_code == 200, res.text
    res = client.post("/api/v1/document-books/", json={
        "code": "BAD", "name": "ผิดประเภท", "side": "expense", "journal_type": "purchase",
        "account_id": str(coa["rev"].id),
    }, headers=h)
    assert res.status_code == 400


def test_counter_account_must_be_balance_sheet(client, h, coa):
    res = client.post("/api/v1/document-books/", json=_invoice_book(coa, counter_account_id=str(coa["eq"].id)), headers=h)
    assert res.status_code == 400


def test_update_and_clear_links(client, h, coa):
    b = client.post("/api/v1/document-books/", json=_invoice_book(coa), headers=h).json()
    res = client.patch(f"/api/v1/document-books/{b['id']}", json={
        "name": "ใบกำกับภาษีเต็มรูป", "journal_type": "receipt", "clear_tax_code": True, "is_active": False,
    }, headers=h)
    assert res.status_code == 200, res.text
    u = res.json()
    assert u["name"] == "ใบกำกับภาษีเต็มรูป"
    assert u["journal_type"] == "receipt"
    assert u["tax_code"] is None
    assert u["counter_account"]["code"] == "1201"   # untouched
    assert u["is_active"] is False
    assert u["side"] == "income"


def test_update_rejects_wrong_account_type(client, h, coa):
    b = client.post("/api/v1/document-books/", json=_invoice_book(coa), headers=h).json()
    res = client.patch(f"/api/v1/document-books/{b['id']}", json={"account_id": str(coa["exp"].id)}, headers=h)
    assert res.status_code == 400


def test_delete(client, h, coa):
    b = client.post("/api/v1/document-books/", json=_invoice_book(coa), headers=h).json()
    assert client.delete(f"/api/v1/document-books/{b['id']}", headers=h).status_code == 200
    assert client.get("/api/v1/document-books/", headers=h).json() == []
    # the code is free again after a delete
    assert client.post("/api/v1/document-books/", json=_invoice_book(coa), headers=h).status_code == 200


def test_cashier_cannot_change_books(client, db, h, coa):
    cashier = _login(client, db, "cash@test.com", UserRole.CASHIER)
    assert client.post("/api/v1/document-books/", json=_invoice_book(coa), headers=cashier).status_code == 403
    assert client.get("/api/v1/document-books/", headers=cashier).status_code == 200
