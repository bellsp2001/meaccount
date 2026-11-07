"""
Trade Document Tests — sales credit/debit notes, the purchase document flow
(RFQ → PO → Bill, deposit, credit/debit notes), expense-side views and the ledger reports.
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

engine = create_engine("sqlite:///./test_trade_documents.db", connect_args={"check_same_thread": False})
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
    rows = [
        ("1102", "เงินฝากธนาคาร", AccountTypeEnum.ASSET, NormalBalance.DEBIT),
        ("1201", "ลูกหนี้การค้า", AccountTypeEnum.ASSET, NormalBalance.DEBIT),
        ("1401", "ภาษีซื้อ", AccountTypeEnum.ASSET, NormalBalance.DEBIT),
        ("1402", "ค่าใช้จ่ายจ่ายล่วงหน้า", AccountTypeEnum.ASSET, NormalBalance.DEBIT),
        ("2101", "เจ้าหนี้การค้า", AccountTypeEnum.LIABILITY, NormalBalance.CREDIT),
        ("2103", "ภาษีขาย", AccountTypeEnum.LIABILITY, NormalBalance.CREDIT),
        ("4101", "รายได้จากการขาย", AccountTypeEnum.INCOME, NormalBalance.CREDIT),
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


@pytest.fixture
def supplier(client, h):
    return client.post("/api/v1/ap/suppliers", json={"code": "S001", "name": "ผู้จำหน่าย ก"}, headers=h).json()


ITEMS = [{"description": "บริการ", "quantity": 1, "unit_price": 1000}]   # 1,000 + VAT 70 = 1,070


def _lines(client, h, reference):
    j = next(j for j in client.get("/api/v1/journals/", headers=h).json() if j["reference"] == reference)
    return j, {(e["account_code"], "dr" if Decimal(e["debit"]) > 0 else "cr"): Decimal(e["debit"]) or Decimal(e["credit"])
               for e in j["entries"]}


def _posted_invoice(client, h, customer, unit_price=1000):
    inv = client.post("/api/v1/ar/invoices", json={"customer_id": customer["id"], "date": "2025-03-01", "vat_rate": 7,
                      "items": [{"description": "สินค้า", "quantity": 1, "unit_price": unit_price}]}, headers=h).json()
    assert client.post(f"/api/v1/ar/invoices/{inv['id']}/post-gl", headers=h).status_code == 200
    return inv


def _sales_note(client, h, customer, inv, doc_type, unit_price=1000):
    return client.post("/api/v1/ar/sales-documents", json={
        "doc_type": doc_type, "customer_id": customer["id"], "date": "2025-03-10", "vat_rate": 7,
        "invoice_id": inv["id"], "reason": "ทดสอบ",
        "items": [{"description": "ปรับราคา", "quantity": 1, "unit_price": unit_price}]}, headers=h)


def _invoice_balance(client, h, inv_id):
    return Decimal(next(i for i in client.get("/api/v1/ar/invoices", headers=h).json() if i["id"] == inv_id)["balance_due"])


def _posted_bill(client, h, supplier, unit_price=1000):
    bill = client.post("/api/v1/ap/bills", json={"supplier_id": supplier["id"], "date": "2025-03-01", "description": "ค่าบริการ",
                       "vat_rate": 7, "items": [{"description": "บริการ", "quantity": 1, "unit_price": unit_price}]}, headers=h).json()
    assert client.post(f"/api/v1/ap/bills/{bill['id']}/post-gl", headers=h).status_code == 200
    return bill


def _purchase(client, h, supplier, doc_type, **extra):
    return client.post("/api/v1/ap/purchase-documents", json={
        "doc_type": doc_type, "supplier_id": supplier["id"], "date": "2025-03-10", "vat_rate": 7,
        "items": ITEMS, **extra}, headers=h)


# ── Sales credit / debit notes ────────────────────────────────
def test_sales_credit_note_reverses_invoice_lines(client, h, acc, customer):
    inv = _posted_invoice(client, h, customer, 2000)
    cn = _sales_note(client, h, customer, inv, "credit_note").json()
    assert cn["number"].startswith("CN-") and cn["invoice"]["number"] == inv["number"]

    res = client.post(f"/api/v1/ar/sales-documents/{cn['id']}/post-note", headers=h)
    assert res.status_code == 200, res.text
    j, lines = _lines(client, h, cn["number"])
    assert j["journal_type"] == "sales"
    assert lines == {("4101", "dr"): Decimal("1000.00"), ("2103", "dr"): Decimal("70.00"), ("1201", "cr"): Decimal("1070.00")}
    assert _invoice_balance(client, h, inv["id"]) == Decimal("1070.00")   # 2,140 − 1,070


def test_sales_credit_note_cannot_exceed_balance(client, h, acc, customer):
    inv = _posted_invoice(client, h, customer, 500)
    cn = _sales_note(client, h, customer, inv, "credit_note").json()
    assert client.post(f"/api/v1/ar/sales-documents/{cn['id']}/post-note", headers=h).status_code == 400


def test_sales_debit_note_raises_balance(client, h, acc, customer):
    inv = _posted_invoice(client, h, customer)
    dn = _sales_note(client, h, customer, inv, "debit_note").json()
    assert client.post(f"/api/v1/ar/sales-documents/{dn['id']}/post-note", headers=h).status_code == 200
    _, lines = _lines(client, h, dn["number"])
    assert lines == {("1201", "dr"): Decimal("1070.00"), ("4101", "cr"): Decimal("1000.00"), ("2103", "cr"): Decimal("70.00")}
    assert _invoice_balance(client, h, inv["id"]) == Decimal("2140.00")


def test_sales_note_needs_issued_invoice_of_same_customer(client, h, acc, customer):
    draft = client.post("/api/v1/ar/invoices", json={"customer_id": customer["id"], "date": "2025-03-01",
                        "items": ITEMS}, headers=h).json()
    assert _sales_note(client, h, customer, draft, "credit_note").status_code == 400
    other = client.post("/api/v1/ar/customers", json={"code": "C002", "name": "ลูกค้า ข"}, headers=h).json()
    inv = _posted_invoice(client, h, customer)
    assert _sales_note(client, h, other, inv, "credit_note").status_code == 400


def test_posted_note_cannot_be_cancelled_or_posted_twice(client, h, acc, customer):
    inv = _posted_invoice(client, h, customer, 2000)
    cn = _sales_note(client, h, customer, inv, "credit_note").json()
    client.post(f"/api/v1/ar/sales-documents/{cn['id']}/post-note", headers=h)
    assert client.post(f"/api/v1/ar/sales-documents/{cn['id']}/post-note", headers=h).status_code == 400
    assert client.post(f"/api/v1/ar/sales-documents/{cn['id']}/cancel", headers=h).status_code == 400


# ── Purchase documents ────────────────────────────────────────
def test_rfq_to_purchase_order_to_bill(client, h, acc, supplier):
    rfq = _purchase(client, h, supplier, "rfq", items=[{"description": "กระดาษ", "quantity": 10, "unit_price": 100, "discount_pct": 10}]).json()
    assert rfq["number"].startswith("RFQ-") and Decimal(rfq["subtotal"]) == Decimal("900.00")

    po = client.post(f"/api/v1/ap/purchase-documents/{rfq['id']}/convert", headers=h).json()
    assert po["target_type"] == "purchase_order" and po["target_number"].startswith("PUR-")

    bill_ref = client.post(f"/api/v1/ap/purchase-documents/{po['target_id']}/convert", headers=h).json()
    assert bill_ref["target_type"] == "bill"
    bill = client.get(f"/api/v1/ap/bills/{bill_ref['target_id']}", headers=h).json()
    assert Decimal(bill["subtotal"]) == Decimal("900.00") and Decimal(bill["vat_amount"]) == Decimal("63.00")

    # A converted document is closed.
    assert client.post(f"/api/v1/ap/purchase-documents/{rfq['id']}/convert", headers=h).status_code == 400


def test_purchase_deposit_posts_prepaid(client, h, acc, supplier):
    dep = _purchase(client, h, supplier, "deposit", vat_rate=0, deposit_amount=5000).json()
    assert client.post(f"/api/v1/ap/purchase-documents/{dep['id']}/post-deposit", headers=h).status_code == 200
    j, lines = _lines(client, h, dep["number"])
    assert j["journal_type"] == "payment"
    assert lines == {("1402", "dr"): Decimal("5000.00"), ("1102", "cr"): Decimal("5000.00")}
    assert client.post(f"/api/v1/ap/purchase-documents/{dep['id']}/convert", headers=h).status_code == 400


def test_purchase_credit_note_lowers_payable(client, h, acc, supplier):
    bill = _posted_bill(client, h, supplier, 2000)
    cn = _purchase(client, h, supplier, "credit_note", bill_id=bill["id"]).json()
    assert cn["bill"]["number"] == bill["number"]
    assert client.post(f"/api/v1/ap/purchase-documents/{cn['id']}/post-note", headers=h).status_code == 200
    j, lines = _lines(client, h, cn["number"])
    assert j["journal_type"] == "purchase"
    assert lines == {("2101", "dr"): Decimal("1070.00"), ("5401", "cr"): Decimal("1000.00"), ("1401", "cr"): Decimal("70.00")}
    assert Decimal(client.get(f"/api/v1/ap/bills/{bill['id']}", headers=h).json()["balance_due"]) == Decimal("1070.00")


def test_purchase_debit_note_raises_payable(client, h, acc, supplier):
    bill = _posted_bill(client, h, supplier)
    dn = _purchase(client, h, supplier, "debit_note", bill_id=bill["id"]).json()
    assert client.post(f"/api/v1/ap/purchase-documents/{dn['id']}/post-note", headers=h).status_code == 200
    _, lines = _lines(client, h, dn["number"])
    assert lines == {("5401", "dr"): Decimal("1000.00"), ("1401", "dr"): Decimal("70.00"), ("2101", "cr"): Decimal("1070.00")}
    assert Decimal(client.get(f"/api/v1/ap/bills/{bill['id']}", headers=h).json()["balance_due"]) == Decimal("2140.00")


def test_purchase_note_needs_posted_bill(client, h, acc, supplier):
    draft = client.post("/api/v1/ap/bills", json={"supplier_id": supplier["id"], "date": "2025-03-01",
                        "description": "x", "items": ITEMS}, headers=h).json()
    assert _purchase(client, h, supplier, "credit_note", bill_id=draft["id"]).status_code == 400
    assert _purchase(client, h, supplier, "credit_note").status_code == 400


# ── Expense-side views and reports ────────────────────────────
def test_purchase_tax_invoices_and_vouchers(client, h, acc, supplier):
    bill = _posted_bill(client, h, supplier)
    client.post(f"/api/v1/ap/bills/{bill['id']}/submit", headers=h)
    taxes = client.get("/api/v1/ap/tax-invoices", headers=h).json()
    assert [t["number"] for t in taxes] == [bill["number"]]
    assert client.get("/api/v1/ap/payment-vouchers", headers=h).json() == []


def test_expense_report_and_ap_aging(client, h, acc, supplier):
    _posted_bill(client, h, supplier, 1000)
    _posted_bill(client, h, supplier, 500)
    rep = client.get("/api/v1/ap/reports/expenses",
                     params={"period_from": "2025-03-01", "period_to": "2025-03-31"}, headers=h).json()
    assert Decimal(rep["total_expense"]) == Decimal("1500.00") and rep["bill_count"] == 2
    assert rep["by_supplier"][0]["supplier"] == "ผู้จำหน่าย ก"

    aging = client.get("/api/v1/ap/reports/aging", params={"as_of": "2025-03-05"}, headers=h).json()
    assert Decimal(aging["grand_total"]) == Decimal("1605.00") and aging["current"]["count"] == 2


# ── Ledger reports ────────────────────────────────────────────
def test_trial_balance_balances_and_ledger_runs(client, h, acc, customer, supplier):
    inv = _posted_invoice(client, h, customer, 2000)
    cn = _sales_note(client, h, customer, inv, "credit_note").json()
    client.post(f"/api/v1/ar/sales-documents/{cn['id']}/post-note", headers=h)
    _posted_bill(client, h, supplier)

    tb = client.get("/api/v1/reports/trial-balance",
                    params={"period_from": "2025-03-01", "period_to": "2025-03-31"}, headers=h).json()
    assert tb["balanced"] is True
    ar = next(r for r in tb["rows"] if r["code"] == "1201")
    assert Decimal(ar["closing_debit"]) == Decimal("1070.00")

    gl = client.get("/api/v1/reports/general-ledger", params={"account_id": str(acc["1201"].id),
                    "period_from": "2025-03-01", "period_to": "2025-03-31"}, headers=h).json()
    assert [Decimal(l["balance"]) for l in gl["lines"]] == [Decimal("2140.00"), Decimal("1070.00")]

    # Entries before the period roll into the opening balance.
    later = client.get("/api/v1/reports/general-ledger", params={"account_id": str(acc["1201"].id),
                       "period_from": "2025-04-01", "period_to": "2025-04-30"}, headers=h).json()
    assert Decimal(later["opening"]) == Decimal("1070.00") and later["lines"] == []
