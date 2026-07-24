"""Audit Tests — Audit Log query, Balance checks, Anomaly detection, Duplicate detection"""
import pytest
from decimal import Decimal
from datetime import date, datetime, timedelta
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from core.database import Base, get_db
from core.security import hash_password
from models.user import User, UserRole, AuditLog
from models.accounting import Account, Journal, JournalEntry, AccountTypeEnum, NormalBalance, JournalStatus
from models.ar import Customer, Invoice, InvoiceStatus
from models.ap import Supplier, Bill, APPayment, BillStatus, APPaymentMethod
from main import app

engine = create_engine("sqlite:///./test_audit.db", connect_args={"check_same_thread": False})
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
def mgr_token(client, db):
    make_user(db, UserRole.MANAGER, "mgr@test.com")
    return get_token(client, "mgr@test.com")

@pytest.fixture
def coa(db):
    accs = {
        "cash": Account(code="1101", name="เงินสด", account_type=AccountTypeEnum.ASSET, normal_balance=NormalBalance.DEBIT, level=3, balance=Decimal("0")),
        "revenue": Account(code="4101", name="รายได้ขาย", account_type=AccountTypeEnum.INCOME, normal_balance=NormalBalance.CREDIT, level=2, balance=Decimal("0")),
    }
    for a in accs.values(): db.add(a)
    db.commit()
    return accs


def _post_journal(db, j_date, entries, ref=None, number_suffix="T"):
    j = Journal(number=f"JV-{number_suffix}-{j_date.isoformat()}-{id(entries)}", date=j_date,
               description="Test", status=JournalStatus.POSTED, reference=ref)
    db.add(j); db.flush()
    for acc, debit, credit in entries:
        db.add(JournalEntry(journal_id=j.id, account_id=acc.id, debit=debit, credit=credit))
        if acc.normal_balance == NormalBalance.DEBIT:
            acc.balance += debit - credit
        else:
            acc.balance += credit - debit
    db.commit()
    return j


# ── Audit Log ─────────────────────────────────────────────────
def test_audit_log_records_login(client, mgr_token, db):
    # login already created an audit log via /auth/login in acc_token fixture chain
    make_user(db, UserRole.ACCOUNTANT, "loguser@test.com")
    client.post("/api/v1/auth/login", json={"email": "loguser@test.com", "password": "Test@1234"})

    res = client.get("/api/v1/audit/logs", headers={"Authorization": f"Bearer {mgr_token}"})
    assert res.status_code == 200
    logs = res.json()
    assert any(l["action"] == "LOGIN" for l in logs)

def test_audit_log_accountant_forbidden(client, acc_token):
    res = client.get("/api/v1/audit/logs", headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 403

def test_audit_log_filter_by_action(client, mgr_token, db):
    make_user(db, UserRole.ACCOUNTANT, "filteruser@test.com")
    client.post("/api/v1/auth/login", json={"email": "filteruser@test.com", "password": "Test@1234"})
    res = client.get("/api/v1/audit/logs?action=LOGIN", headers={"Authorization": f"Bearer {mgr_token}"})
    assert res.status_code == 200
    assert all(l["action"] == "LOGIN" for l in res.json())


# ── Balance Check ─────────────────────────────────────────────
def test_balance_check_all_pass(client, acc_token, db, coa):
    _post_journal(db, date(2025, 6, 1), [(coa["cash"], Decimal("10000"), Decimal("0")), (coa["revenue"], Decimal("0"), Decimal("10000"))])
    res = client.get("/api/v1/audit/balance-check?as_of_date=2025-06-30", headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    data = res.json()
    assert data["all_passed"] is True
    assert all(c["passed"] for c in data["checks"])

def test_balance_check_no_data(client, acc_token):
    res = client.get("/api/v1/audit/balance-check?as_of_date=2025-01-01", headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    assert res.json()["all_passed"] is True  # no data = trivially balanced


# ── Anomaly Detection ─────────────────────────────────────────
def test_anomaly_scan_round_number(client, mgr_token, db, coa):
    _post_journal(db, date(2025, 6, 5), [(coa["cash"], Decimal("100000"), Decimal("0")), (coa["revenue"], Decimal("0"), Decimal("100000"))])
    res = client.get("/api/v1/audit/ai/anomalies?period_from=2025-06-01&period_to=2025-06-30",
                     headers={"Authorization": f"Bearer {mgr_token}"})
    assert res.status_code == 200
    data = res.json()
    assert data["total_scanned"] >= 1
    assert any(a["category"] == "round_number" for a in data["anomalies"])

def test_anomaly_scan_weekend_posting(client, mgr_token, db, coa):
    # Find a Saturday in June 2025
    saturday = date(2025, 6, 7)  # confirmed Saturday
    assert saturday.weekday() == 5
    _post_journal(db, saturday, [(coa["cash"], Decimal("5555"), Decimal("0")), (coa["revenue"], Decimal("0"), Decimal("5555"))])
    res = client.get("/api/v1/audit/ai/anomalies?period_from=2025-06-01&period_to=2025-06-30",
                     headers={"Authorization": f"Bearer {mgr_token}"})
    data = res.json()
    assert any(a["category"] == "weekend_posting" for a in data["anomalies"])

def test_anomaly_scan_duplicate_reference(client, mgr_token, db, coa):
    _post_journal(db, date(2025, 6, 10), [(coa["cash"], Decimal("1111"), Decimal("0")), (coa["revenue"], Decimal("0"), Decimal("1111"))], ref="SAME-REF-001", number_suffix="A")
    _post_journal(db, date(2025, 6, 11), [(coa["cash"], Decimal("2222"), Decimal("0")), (coa["revenue"], Decimal("0"), Decimal("2222"))], ref="SAME-REF-001", number_suffix="B")
    res = client.get("/api/v1/audit/ai/anomalies?period_from=2025-06-01&period_to=2025-06-30",
                     headers={"Authorization": f"Bearer {mgr_token}"})
    data = res.json()
    assert any(a["category"] == "duplicate" for a in data["anomalies"])

def test_anomaly_scan_accountant_forbidden(client, acc_token):
    res = client.get("/api/v1/audit/ai/anomalies?period_from=2025-06-01&period_to=2025-06-30",
                     headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 403


# ── Duplicate Invoice/Bill Detection ──────────────────────────
def test_duplicate_invoice_detection(client, mgr_token, db):
    c = Customer(code="C001", name="ลูกค้าทดสอบ", credit_days=30)
    db.add(c); db.flush()
    inv1 = Invoice(number="INV-001", customer_id=c.id, date=date(2025, 6, 1), due_date=date(2025, 7, 1),
                   status=InvoiceStatus.SENT, subtotal=Decimal("5000"), total=Decimal("5350"))
    inv2 = Invoice(number="INV-002", customer_id=c.id, date=date(2025, 6, 3), due_date=date(2025, 7, 3),
                   status=InvoiceStatus.SENT, subtotal=Decimal("5000"), total=Decimal("5350"))
    db.add_all([inv1, inv2]); db.commit()

    res = client.get("/api/v1/audit/ai/duplicates", headers={"Authorization": f"Bearer {mgr_token}"})
    assert res.status_code == 200
    data = res.json()
    assert data["total_found"] >= 2
    assert any(g["resource_type"] == "invoice" for g in data["groups"])

def test_duplicate_bill_payment_detection(client, mgr_token, db):
    s = Supplier(code="S001", name="ผู้ขาย", payment_terms=30)
    db.add(s); db.flush()
    bill = Bill(number="BILL-001", supplier_id=s.id, date=date(2025, 6, 1), due_date=date(2025, 7, 1),
               description="test", status=BillStatus.APPROVED, subtotal=Decimal("1000"),
               total=Decimal("1070"), net_payable=Decimal("1070"), balance_due=Decimal("0"))
    db.add(bill); db.flush()
    p1 = APPayment(bill_id=bill.id, date=date(2025, 6, 5), amount=Decimal("1070"), method=APPaymentMethod.BANK_TRANSFER)
    p2 = APPayment(bill_id=bill.id, date=date(2025, 6, 6), amount=Decimal("1070"), method=APPaymentMethod.BANK_TRANSFER)
    db.add_all([p1, p2]); db.commit()

    res = client.get("/api/v1/audit/ai/anomalies?period_from=2025-06-01&period_to=2025-06-30",
                     headers={"Authorization": f"Bearer {mgr_token}"})
    data = res.json()
    assert any(a["category"] == "duplicate" and a["resource_type"] == "payment" for a in data["anomalies"])
