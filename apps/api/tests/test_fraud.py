"""Fraud Detection Tests — Pattern detectors, Alert management, Risk dashboard"""
import pytest
from decimal import Decimal
from datetime import date, datetime, timedelta
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from core.database import Base, get_db
from core.security import hash_password
from models.user import User, UserRole, AuditLog
from models.ap import Supplier, Bill, BillStatus, APPayment, APPaymentMethod
from models.accounting import Journal, JournalEntry, Account, AccountTypeEnum, NormalBalance, JournalStatus
from main import app

engine = create_engine("sqlite:///./test_fraud.db", connect_args={"check_same_thread": False})
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
def mgr_token(client, db):
    make_user(db, UserRole.MANAGER, "mgr@test.com")
    return get_token(client, "mgr@test.com")

@pytest.fixture
def acc_token(client, db):
    make_user(db, UserRole.ACCOUNTANT, "acc@test.com")
    return get_token(client, "acc@test.com")


# ── Ghost Vendor Detection ─────────────────────────────────────
def test_detect_ghost_vendor(client, mgr_token, db):
    # Supplier created "today" (within scan window) with a large immediate bill
    sup = Supplier(code="S999", name="ผู้ขายใหม่ผิดปกติ", payment_terms=30)
    db.add(sup); db.flush()
    bill = Bill(number="BILL-GHOST-1", supplier_id=sup.id, date=date.today(), due_date=date.today()+timedelta(days=30),
               description="ทดสอบ", status=BillStatus.APPROVED, subtotal=Decimal("80000"),
               total=Decimal("85600"), net_payable=Decimal("85600"), balance_due=Decimal("85600"))
    db.add(bill); db.commit()

    res = client.post("/api/v1/fraud/scan", json={
        "period_from": str(date.today() - timedelta(days=7)), "period_to": str(date.today()),
    }, headers={"Authorization": f"Bearer {mgr_token}"})
    assert res.status_code == 200
    data = res.json()
    assert any(a["pattern"] == "ghost_vendor" for a in data["alerts"])

def test_no_ghost_vendor_alert_for_small_amount(client, mgr_token, db):
    sup = Supplier(code="S998", name="ผู้ขายใหม่ปกติ", payment_terms=30)
    db.add(sup); db.flush()
    bill = Bill(number="BILL-SMALL-1", supplier_id=sup.id, date=date.today(), due_date=date.today()+timedelta(days=30),
               description="เล็ก", status=BillStatus.APPROVED, subtotal=Decimal("500"),
               total=Decimal("535"), net_payable=Decimal("535"), balance_due=Decimal("535"))
    db.add(bill); db.commit()

    res = client.post("/api/v1/fraud/scan", json={
        "period_from": str(date.today() - timedelta(days=7)), "period_to": str(date.today()),
    }, headers={"Authorization": f"Bearer {mgr_token}"})
    data = res.json()
    assert not any(a["pattern"] == "ghost_vendor" and a["reference"] == "S998" for a in data["alerts"])


# ── Duplicate Payment Detection ─────────────────────────────────
def test_detect_duplicate_payment(client, mgr_token, db):
    sup = Supplier(code="S001", name="ผู้ขาย", payment_terms=30)
    db.add(sup); db.flush()
    bill = Bill(number="BILL-001", supplier_id=sup.id, date=date.today()-timedelta(days=10), due_date=date.today()+timedelta(days=20),
               description="test", status=BillStatus.APPROVED, subtotal=Decimal("10000"),
               total=Decimal("10700"), net_payable=Decimal("10700"), balance_due=Decimal("0"))
    db.add(bill); db.flush()
    p1 = APPayment(bill_id=bill.id, date=date.today()-timedelta(days=5), amount=Decimal("10700"), method=APPaymentMethod.BANK_TRANSFER)
    p2 = APPayment(bill_id=bill.id, date=date.today()-timedelta(days=3), amount=Decimal("10700"), method=APPaymentMethod.BANK_TRANSFER)
    db.add_all([p1, p2]); db.commit()

    res = client.post("/api/v1/fraud/scan", json={
        "period_from": str(date.today()-timedelta(days=15)), "period_to": str(date.today()),
    }, headers={"Authorization": f"Bearer {mgr_token}"})
    data = res.json()
    assert any(a["pattern"] == "duplicate_payment" for a in data["alerts"])
    dup_alert = next(a for a in data["alerts"] if a["pattern"] == "duplicate_payment")
    assert dup_alert["risk_level"] in ("high", "critical")


# ── Split Transaction Detection ──────────────────────────────
def test_detect_split_transaction(client, mgr_token, db):
    sup = Supplier(code="S002", name="ผู้ขายแตกรายการ", payment_terms=30)
    db.add(sup); db.flush()
    same_date = date.today()
    for i in range(4):
        bill = Bill(number=f"BILL-SPLIT-{i}", supplier_id=sup.id, date=same_date, due_date=same_date+timedelta(days=30),
                   description=f"split {i}", status=BillStatus.APPROVED, subtotal=Decimal("15000"),
                   total=Decimal("16050"), net_payable=Decimal("16050"), balance_due=Decimal("16050"))
        db.add(bill)
    db.commit()

    res = client.post("/api/v1/fraud/scan", json={
        "period_from": str(same_date - timedelta(days=1)), "period_to": str(same_date),
    }, headers={"Authorization": f"Bearer {mgr_token}"})
    data = res.json()
    assert any(a["pattern"] == "split_transaction" for a in data["alerts"])


# ── New Vendor Large Amount ────────────────────────────────────
def test_detect_new_vendor_large_amount(client, mgr_token, db):
    # Create baseline suppliers/bills with varied normal amounts (must not be identical,
    # or stdev=0 and the z-score check is a no-op by design)
    baseline_amounts = [Decimal("1800"), Decimal("2100"), Decimal("1950"), Decimal("2300"), Decimal("1700"), Decimal("2050")]
    for i, amt in enumerate(baseline_amounts):
        sup = Supplier(code=f"SN{i}", name=f"ผู้ขายปกติ {i}", payment_terms=30)
        db.add(sup); db.flush()
        b = Bill(number=f"BILL-NORM-{i}", supplier_id=sup.id, date=date.today()-timedelta(days=60),
                due_date=date.today()-timedelta(days=30), description="normal", status=BillStatus.PAID,
                subtotal=amt, total=amt*Decimal("1.07"), net_payable=amt*Decimal("1.07"),
                balance_due=Decimal("0"), gl_posted=True)
        db.add(b)
    db.commit()

    # New vendor with huge outlier amount
    outlier_sup = Supplier(code="SOUT", name="ผู้ขายยอดสูงผิดปกติ", payment_terms=30)
    db.add(outlier_sup); db.flush()
    outlier_bill = Bill(number="BILL-OUTLIER", supplier_id=outlier_sup.id, date=date.today(),
                        due_date=date.today()+timedelta(days=30), description="huge",
                        status=BillStatus.APPROVED, subtotal=Decimal("500000"),
                        total=Decimal("535000"), net_payable=Decimal("535000"),
                        balance_due=Decimal("535000"), gl_posted=True)
    db.add(outlier_bill); db.commit()

    res = client.post("/api/v1/fraud/scan", json={
        "period_from": str(date.today()-timedelta(days=1)), "period_to": str(date.today()),
    }, headers={"Authorization": f"Bearer {mgr_token}"})
    data = res.json()
    assert any(a["pattern"] == "new_vendor_large" for a in data["alerts"])


# ── Access Control ────────────────────────────────────────────
def test_accountant_cannot_run_scan(client, acc_token):
    res = client.post("/api/v1/fraud/scan", json={
        "period_from": str(date.today()), "period_to": str(date.today()),
    }, headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 403

def test_accountant_cannot_view_alerts(client, acc_token):
    res = client.get("/api/v1/fraud/alerts", headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 403


# ── Alert Management ────────────────────────────────────────────
def test_resolve_alert(client, mgr_token, db):
    sup = Supplier(code="S003", name="ทดสอบ", payment_terms=30)
    db.add(sup); db.flush()
    bill = Bill(number="BILL-002", supplier_id=sup.id, date=date.today()-timedelta(days=1), due_date=date.today()+timedelta(days=29),
               description="test", status=BillStatus.APPROVED, subtotal=Decimal("10000"),
               total=Decimal("10700"), net_payable=Decimal("10700"), balance_due=Decimal("0"))
    db.add(bill); db.flush()
    p1 = APPayment(bill_id=bill.id, date=date.today(), amount=Decimal("10700"), method=APPaymentMethod.CASH)
    p2 = APPayment(bill_id=bill.id, date=date.today(), amount=Decimal("10700"), method=APPaymentMethod.CASH)
    db.add_all([p1, p2]); db.commit()

    scan_res = client.post("/api/v1/fraud/scan", json={
        "period_from": str(date.today()-timedelta(days=2)), "period_to": str(date.today()),
    }, headers={"Authorization": f"Bearer {mgr_token}"})
    alert_id = next(a["id"] for a in scan_res.json()["alerts"] if a["pattern"] == "duplicate_payment")

    res = client.post(f"/api/v1/fraud/alerts/{alert_id}/action", json={
        "status": "resolved", "resolution_note": "ตรวจสอบแล้วเป็นการจ่ายซ้ำจริง คืนเงินแล้ว",
    }, headers={"Authorization": f"Bearer {mgr_token}"})
    assert res.status_code == 200
    assert res.json()["status"] == "resolved"
    assert res.json()["resolved_at"] is not None

def test_scan_does_not_create_duplicate_alerts(client, mgr_token, db):
    sup = Supplier(code="S004", name="ทดสอบซ้ำ", payment_terms=30)
    db.add(sup); db.flush()
    bill = Bill(number="BILL-003", supplier_id=sup.id, date=date.today(), due_date=date.today()+timedelta(days=30),
               description="test", status=BillStatus.APPROVED, subtotal=Decimal("100000"),
               total=Decimal("107000"), net_payable=Decimal("107000"), balance_due=Decimal("107000"))
    db.add(bill); db.commit()

    period = {"period_from": str(date.today()-timedelta(days=1)), "period_to": str(date.today())}
    res1 = client.post("/api/v1/fraud/scan", json=period, headers={"Authorization": f"Bearer {mgr_token}"})
    res2 = client.post("/api/v1/fraud/scan", json=period, headers={"Authorization": f"Bearer {mgr_token}"})

    ghost_alerts_1 = [a for a in res1.json()["alerts"] if a["pattern"] == "ghost_vendor"]
    all_alerts_res = client.get("/api/v1/fraud/alerts?risk_level=critical",
                                headers={"Authorization": f"Bearer {mgr_token}"})
    # Should not have duplicated the same alert across two scans
    matching = [a for a in all_alerts_res.json() if a.get("reference") == "S004"]
    assert len(matching) <= 1


# ── Risk Dashboard ────────────────────────────────────────────
def test_risk_dashboard(client, mgr_token, db):
    sup = Supplier(code="S005", name="Dashboard Test", payment_terms=30)
    db.add(sup); db.flush()
    bill = Bill(number="BILL-DASH", supplier_id=sup.id, date=date.today(), due_date=date.today()+timedelta(days=30),
               description="test", status=BillStatus.APPROVED, subtotal=Decimal("60000"),
               total=Decimal("64200"), net_payable=Decimal("64200"), balance_due=Decimal("64200"))
    db.add(bill); db.commit()

    client.post("/api/v1/fraud/scan", json={
        "period_from": str(date.today()-timedelta(days=1)), "period_to": str(date.today()),
    }, headers={"Authorization": f"Bearer {mgr_token}"})

    res = client.get("/api/v1/fraud/dashboard", headers={"Authorization": f"Bearer {mgr_token}"})
    assert res.status_code == 200
    data = res.json()
    assert "open_alerts_count" in data
    assert "alerts_by_pattern" in data
