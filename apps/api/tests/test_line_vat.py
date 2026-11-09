"""
Per-line VAT — each document line picks its own ประเภทภาษี (VAT); the document's VAT is the sum
of the lines. Lines without a code keep using the document's rate.
"""
import pytest
from decimal import Decimal
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from core.database import Base, get_db
from core.security import hash_password
from models.user import User, UserRole
from models.tax import TaxCode, TaxKind
from main import app

engine = create_engine("sqlite:///./test_line_vat.db", connect_args={"check_same_thread": False})
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
def codes(db):
    out = {}
    for code, kind, rate in (("VAT7", TaxKind.VAT, 7), ("VAT0", TaxKind.VAT, 0), ("WHT3", TaxKind.WHT, 3)):
        c = TaxCode(code=code, name=code, kind=kind, rate=rate, is_active=True)
        db.add(c); db.commit()
        out[code] = str(c.id)
    return out


@pytest.fixture
def customer(client, h):
    return client.post("/api/v1/ar/customers", json={"code": "C001", "name": "ลูกค้า ก"}, headers=h).json()


@pytest.fixture
def supplier(client, h):
    return client.post("/api/v1/ap/suppliers", json={"code": "S001", "name": "ผู้จำหน่าย ก"}, headers=h).json()


def _line(desc, price, code=None):
    return {"description": desc, "quantity": 1, "unit_price": price, "tax_code_id": code}


def test_invoice_sums_vat_per_line(client, h, codes, customer):
    inv = client.post("/api/v1/ar/invoices", headers=h, json={
        "customer_id": customer["id"], "date": "2025-03-01", "vat_rate": 7,
        "items": [_line("บริการ", 1000, codes["VAT7"]), _line("สินค้ายกเว้น VAT", 500, codes["VAT0"])]}).json()
    assert Decimal(inv["subtotal"]) == Decimal("1500.00")
    assert Decimal(inv["vat_amount"]) == Decimal("70.00") and Decimal(inv["total"]) == Decimal("1570.00")
    rates = [(it["tax_code_id"], Decimal(it["vat_rate"])) for it in inv["items"]]
    assert rates == [(codes["VAT7"], Decimal("7.00")), (codes["VAT0"], Decimal("0.00"))]


def test_code_rate_wins_over_sent_rate(client, h, codes, customer):
    line = {**_line("บริการ", 1000, codes["VAT0"]), "vat_rate": 7}   # the code says 0%
    inv = client.post("/api/v1/ar/invoices", headers=h, json={
        "customer_id": customer["id"], "date": "2025-03-01", "vat_rate": 7, "items": [line]}).json()
    assert Decimal(inv["vat_amount"]) == Decimal("0.00") and Decimal(inv["vat_rate"]) == Decimal("0.00")


def test_lines_without_code_use_document_rate(client, h, customer):
    inv = client.post("/api/v1/ar/invoices", headers=h, json={
        "customer_id": customer["id"], "date": "2025-03-01", "vat_rate": 7, "items": [_line("บริการ", 1000)]}).json()
    assert Decimal(inv["vat_amount"]) == Decimal("70.00")


def test_wht_code_is_not_a_vat_code(client, h, codes, customer):
    res = client.post("/api/v1/ar/invoices", headers=h, json={
        "customer_id": customer["id"], "date": "2025-03-01", "items": [_line("บริการ", 1000, codes["WHT3"])]})
    assert res.status_code == 400


def test_line_codes_carry_through_conversion(client, h, codes, customer):
    qt = client.post("/api/v1/ar/sales-documents", headers=h, json={
        "doc_type": "quotation", "customer_id": customer["id"], "date": "2025-03-01", "vat_rate": 7,
        "items": [_line("บริการ", 1000, codes["VAT7"]), _line("ยกเว้น", 500, codes["VAT0"])]}).json()
    assert Decimal(qt["vat_amount"]) == Decimal("70.00")
    so = client.post(f"/api/v1/ar/sales-documents/{qt['id']}/convert", headers=h).json()
    inv_ref = client.post(f"/api/v1/ar/sales-documents/{so['target_id']}/convert", headers=h).json()
    inv = client.get(f"/api/v1/ar/invoices/{inv_ref['target_id']}", headers=h).json()
    assert Decimal(inv["vat_amount"]) == Decimal("70.00")
    assert [it["tax_code_id"] for it in inv["items"]] == [codes["VAT7"], codes["VAT0"]]


def test_vat_inclusive_takes_vat_out_of_the_lines(client, h, codes, customer):
    inv = client.post("/api/v1/ar/invoices", headers=h, json={
        "customer_id": customer["id"], "date": "2025-03-01", "vat_inclusive": True,
        "items": [_line("บริการ", 1070, codes["VAT7"]), _line("ยกเว้น", 500, codes["VAT0"])]}).json()
    assert inv["vat_inclusive"] is True
    assert Decimal(inv["total"]) == Decimal("1570.00") and Decimal(inv["vat_amount"]) == Decimal("70.00")
    assert Decimal(inv["subtotal"]) == Decimal("1500.00") and Decimal(inv["balance_due"]) == Decimal("1570.00")


def test_vat_inclusive_carries_through_conversion(client, h, codes, supplier):
    po = client.post("/api/v1/ap/purchase-documents", headers=h, json={
        "doc_type": "purchase_order", "supplier_id": supplier["id"], "date": "2025-03-01", "vat_inclusive": True,
        "items": [_line("วัสดุ", 2140, codes["VAT7"])]}).json()
    assert Decimal(po["total"]) == Decimal("2140.00") and Decimal(po["subtotal"]) == Decimal("2000.00")
    ref = client.post(f"/api/v1/ap/purchase-documents/{po['id']}/convert", headers=h).json()
    bill = client.get(f"/api/v1/ap/bills/{ref['target_id']}", headers=h).json()
    assert bill["vat_inclusive"] is True
    assert Decimal(bill["vat_amount"]) == Decimal("140.00") and Decimal(bill["total"]) == Decimal("2140.00")


def test_line_product_and_detail_carry_through(client, h, db, codes, customer):
    from models.inventory import Product
    p = Product(sku="P001", name="กระดาษ A4", unit="รีม", sale_price=120)
    db.add(p); db.commit()
    line = {**_line("กระดาษ A4", 120, codes["VAT7"]), "product_id": str(p.id), "detail": "80 แกรม 500 แผ่น"}
    qt = client.post("/api/v1/ar/sales-documents", headers=h, json={
        "doc_type": "quotation", "customer_id": customer["id"], "date": "2025-03-01", "items": [line]}).json()
    assert (qt["items"][0]["product_id"], qt["items"][0]["detail"]) == (str(p.id), "80 แกรม 500 แผ่น")
    so = client.post(f"/api/v1/ar/sales-documents/{qt['id']}/convert", headers=h).json()
    inv_ref = client.post(f"/api/v1/ar/sales-documents/{so['target_id']}/convert", headers=h).json()
    inv = client.get(f"/api/v1/ar/invoices/{inv_ref['target_id']}", headers=h).json()
    assert (inv["items"][0]["product_id"], inv["items"][0]["detail"]) == (str(p.id), "80 แกรม 500 แผ่น")


def test_bill_and_purchase_order_per_line(client, h, codes, supplier):
    po = client.post("/api/v1/ap/purchase-documents", headers=h, json={
        "doc_type": "purchase_order", "supplier_id": supplier["id"], "date": "2025-03-01", "vat_rate": 7,
        "items": [_line("วัสดุ", 2000, codes["VAT7"]), _line("ค่าขนส่ง", 100, codes["VAT0"])]}).json()
    assert Decimal(po["vat_amount"]) == Decimal("140.00")
    ref = client.post(f"/api/v1/ap/purchase-documents/{po['id']}/convert", headers=h).json()
    bill = client.get(f"/api/v1/ap/bills/{ref['target_id']}", headers=h).json()
    assert Decimal(bill["vat_amount"]) == Decimal("140.00") and Decimal(bill["total"]) == Decimal("2240.00")
