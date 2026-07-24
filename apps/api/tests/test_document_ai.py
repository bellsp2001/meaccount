"""Document AI Tests — Upload, classify/extract fallback behavior, 3-Way Match discrepancy detection"""
import pytest
import io
from decimal import Decimal
from datetime import date, timedelta
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from core.database import Base, get_db
from core.security import hash_password
from models.user import User, UserRole
from models.ap import Supplier, Bill, BillStatus
from models.inventory import Warehouse, Product, PurchaseOrder, POItem, POStatus, StockMovement, MovementType
from main import app

engine = create_engine("sqlite:///./test_document_ai.db", connect_args={"check_same_thread": False})
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
def acc_token(client, db):
    u = User(email="acc@test.com", full_name="Test", hashed_password=hash_password("Test@1234"), role=UserRole.ACCOUNTANT, is_active=True)
    db.add(u); db.commit()
    return client.post("/api/v1/auth/login", json={"email": "acc@test.com", "password": "Test@1234"}).json()["access_token"]


# ── Document Upload ────────────────────────────────────────────
def test_upload_document(client, acc_token):
    file_content = b"fake image bytes for testing"
    res = client.post("/api/v1/documents/upload",
        files={"file": ("test_invoice.jpg", io.BytesIO(file_content), "image/jpeg")},
        headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    data = res.json()
    assert data["filename"] == "test_invoice.jpg"
    assert data["status"] == "uploaded"
    assert data["file_size_bytes"] == len(file_content)

def test_list_documents(client, acc_token):
    client.post("/api/v1/documents/upload",
        files={"file": ("doc1.jpg", io.BytesIO(b"content1"), "image/jpeg")},
        headers={"Authorization": f"Bearer {acc_token}"})
    res = client.get("/api/v1/documents/", headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    assert len(res.json()) == 1

def test_get_document_by_id(client, acc_token):
    upload_res = client.post("/api/v1/documents/upload",
        files={"file": ("doc2.jpg", io.BytesIO(b"content2"), "image/jpeg")},
        headers={"Authorization": f"Bearer {acc_token}"})
    doc_id = upload_res.json()["id"]
    res = client.get(f"/api/v1/documents/{doc_id}", headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    assert res.json()["id"] == doc_id


# ── Classification / Extraction (no API key → deterministic fallback) ──
def test_classify_without_api_key_returns_unknown_gracefully(client, acc_token):
    """Without ANTHROPIC_API_KEY set, classification should fail gracefully, not crash"""
    upload_res = client.post("/api/v1/documents/upload",
        files={"file": ("doc3.jpg", io.BytesIO(b"content3"), "image/jpeg")},
        headers={"Authorization": f"Bearer {acc_token}"})
    doc_id = upload_res.json()["id"]

    res = client.post(f"/api/v1/documents/{doc_id}/classify", headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    data = res.json()
    assert data["document_type"] == "unknown"
    assert data["confidence"] == 0.0

    # Document status should reflect the failure, not silently stay "uploaded"
    doc_res = client.get(f"/api/v1/documents/{doc_id}", headers={"Authorization": f"Bearer {acc_token}"})
    assert doc_res.json()["status"] == "failed"

def test_extract_without_api_key_returns_empty_gracefully(client, acc_token):
    upload_res = client.post("/api/v1/documents/upload",
        files={"file": ("doc4.jpg", io.BytesIO(b"content4"), "image/jpeg")},
        headers={"Authorization": f"Bearer {acc_token}"})
    doc_id = upload_res.json()["id"]

    res = client.post(f"/api/v1/documents/{doc_id}/extract", headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    data = res.json()
    assert data["extracted_fields"] == {}
    assert len(data["warnings"]) > 0


# ── Document Review & Linking ───────────────────────────────
def test_review_document_approve(client, acc_token):
    upload_res = client.post("/api/v1/documents/upload",
        files={"file": ("doc5.jpg", io.BytesIO(b"content5"), "image/jpeg")},
        headers={"Authorization": f"Bearer {acc_token}"})
    doc_id = upload_res.json()["id"]

    res = client.post(f"/api/v1/documents/{doc_id}/review",
        json={"approved": True, "note": "ตรวจสอบแล้วถูกต้อง"},
        headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    assert res.json()["status"] == "reviewed"

def test_link_document_to_bill(client, acc_token, db):
    sup = Supplier(code="S001", name="ผู้ขาย", payment_terms=30)
    db.add(sup); db.flush()
    bill = Bill(number="BILL-001", supplier_id=sup.id, date=date.today(), due_date=date.today()+timedelta(days=30),
               description="test", status=BillStatus.APPROVED, subtotal=Decimal("1000"),
               total=Decimal("1070"), net_payable=Decimal("1070"), balance_due=Decimal("1070"))
    db.add(bill); db.commit()

    upload_res = client.post("/api/v1/documents/upload",
        files={"file": ("doc6.jpg", io.BytesIO(b"content6"), "image/jpeg")},
        headers={"Authorization": f"Bearer {acc_token}"})
    doc_id = upload_res.json()["id"]

    res = client.post(f"/api/v1/documents/{doc_id}/link",
        json={"reference_type": "bill", "reference_id": str(bill.id)},
        headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    assert res.json()["reference_id"] == str(bill.id)
    assert res.json()["status"] == "matched"


# ── 3-Way Match ────────────────────────────────────────────────
@pytest.fixture
def match_setup(db):
    wh = Warehouse(code="WH01", name="คลังหลัก", is_default=True)
    sup = Supplier(code="S001", name="ผู้ขาย 3-way", payment_terms=30)
    db.add_all([wh, sup]); db.flush()

    product = Product(sku="P001", name="สินค้าทดสอบ", unit="ชิ้น")
    db.add(product); db.flush()

    po = PurchaseOrder(number="PO-001", supplier_id=sup.id, warehouse_id=wh.id,
                       date=date.today()-timedelta(days=10), status=POStatus.RECEIVED, total=Decimal("10000"))
    db.add(po); db.flush()
    db.add(POItem(po_id=po.id, product_id=product.id, quantity=Decimal("100"), unit_cost=Decimal("100"),
                  qty_received=Decimal("100"), amount=Decimal("10000")))
    db.commit()

    return {"po": po, "supplier": sup, "warehouse": wh, "product": product}

def test_three_way_match_perfect_match(client, acc_token, db, match_setup):
    po = match_setup["po"]
    sup = match_setup["supplier"]

    # Goods receipt matching PO exactly
    movement = StockMovement(number="GR-001", product_id=match_setup["product"].id,
                             warehouse_id=match_setup["warehouse"].id, movement_type=MovementType.RECEIVE,
                             date=date.today()-timedelta(days=8), quantity=Decimal("100"),
                             unit_cost=Decimal("100"), total_cost=Decimal("10000"), reference=po.number)
    db.add(movement)

    # Bill matching PO exactly
    bill = Bill(number="BILL-3WAY-1", supplier_id=sup.id, date=date.today(), due_date=date.today()+timedelta(days=30),
               description="3-way test", status=BillStatus.APPROVED, subtotal=Decimal("10000"),
               total=Decimal("10000"), net_payable=Decimal("10000"), balance_due=Decimal("10000"))
    db.add(bill); db.commit()

    res = client.post("/api/v1/documents/match/run", json={"bill_id": str(bill.id)},
                      headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    data = res.json()
    assert data["match_status"] == "matched"
    assert data["price_discrepancy"] is False
    assert data["quantity_discrepancy"] is False

def test_three_way_match_price_discrepancy(client, acc_token, db, match_setup):
    """Bill amount significantly higher than PO → should flag price_discrepancy"""
    po = match_setup["po"]
    sup = match_setup["supplier"]

    bill = Bill(number="BILL-3WAY-2", supplier_id=sup.id, date=date.today(), due_date=date.today()+timedelta(days=30),
               description="overpriced", status=BillStatus.APPROVED, subtotal=Decimal("15000"),
               total=Decimal("15000"), net_payable=Decimal("15000"), balance_due=Decimal("15000"))
    db.add(bill); db.commit()

    res = client.post("/api/v1/documents/match/run", json={"bill_id": str(bill.id)},
                      headers={"Authorization": f"Bearer {acc_token}"})
    data = res.json()
    assert data["match_status"] == "discrepancy"
    assert data["price_discrepancy"] is True
    assert "ต่างจาก PO" in data["discrepancy_notes"]

def test_three_way_match_no_po_found(client, acc_token, db):
    sup = Supplier(code="S999", name="ผู้ขายไม่มี PO", payment_terms=30)
    db.add(sup); db.flush()
    bill = Bill(number="BILL-NOPPO", supplier_id=sup.id, date=date.today(), due_date=date.today()+timedelta(days=30),
               description="no po", status=BillStatus.APPROVED, subtotal=Decimal("5000"),
               total=Decimal("5000"), net_payable=Decimal("5000"), balance_due=Decimal("5000"))
    db.add(bill); db.commit()

    res = client.post("/api/v1/documents/match/run", json={"bill_id": str(bill.id)},
                      headers={"Authorization": f"Bearer {acc_token}"})
    data = res.json()
    assert data["match_status"] == "unmatched"
    assert data["po_id"] is None

def test_three_way_match_within_tolerance_passes(client, acc_token, db, match_setup):
    """1% difference should be within the 2% tolerance and pass as matched"""
    sup = match_setup["supplier"]
    bill = Bill(number="BILL-3WAY-3", supplier_id=sup.id, date=date.today(), due_date=date.today()+timedelta(days=30),
               description="minor variance", status=BillStatus.APPROVED, subtotal=Decimal("10050"),
               total=Decimal("10050"), net_payable=Decimal("10050"), balance_due=Decimal("10050"))
    db.add(bill); db.commit()

    res = client.post("/api/v1/documents/match/run", json={"bill_id": str(bill.id)},
                      headers={"Authorization": f"Bearer {acc_token}"})
    data = res.json()
    assert data["price_discrepancy"] is False  # 0.5% variance, within 2% tolerance

def test_resolve_match_discrepancy(client, acc_token, db, match_setup):
    sup = match_setup["supplier"]
    bill = Bill(number="BILL-3WAY-4", supplier_id=sup.id, date=date.today(), due_date=date.today()+timedelta(days=30),
               description="resolve test", status=BillStatus.APPROVED, subtotal=Decimal("20000"),
               total=Decimal("20000"), net_payable=Decimal("20000"), balance_due=Decimal("20000"))
    db.add(bill); db.commit()

    match_res = client.post("/api/v1/documents/match/run", json={"bill_id": str(bill.id)},
                            headers={"Authorization": f"Bearer {acc_token}"})
    match_id = match_res.json()["id"]

    res = client.post(f"/api/v1/documents/match/{match_id}/resolve",
                      json={"note": "ตรวจสอบแล้ว มีการสั่งซื้อเพิ่มเติมนอกเหนือจาก PO เดิม"},
                      headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    assert res.json()["resolved"] is True

def test_rerun_match_updates_not_duplicates(client, acc_token, db, match_setup):
    """Running match twice on the same bill should update the existing record, not create a duplicate"""
    sup = match_setup["supplier"]
    bill = Bill(number="BILL-3WAY-5", supplier_id=sup.id, date=date.today(), due_date=date.today()+timedelta(days=30),
               description="rerun test", status=BillStatus.APPROVED, subtotal=Decimal("10000"),
               total=Decimal("10000"), net_payable=Decimal("10000"), balance_due=Decimal("10000"))
    db.add(bill); db.commit()

    client.post("/api/v1/documents/match/run", json={"bill_id": str(bill.id)}, headers={"Authorization": f"Bearer {acc_token}"})
    client.post("/api/v1/documents/match/run", json={"bill_id": str(bill.id)}, headers={"Authorization": f"Bearer {acc_token}"})

    all_records = client.get("/api/v1/documents/match/records", headers={"Authorization": f"Bearer {acc_token}"}).json()
    matching = [r for r in all_records if r["bill_id"] == str(bill.id)]
    assert len(matching) == 1
