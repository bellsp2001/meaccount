"""Leave/HR Tests — Balance math, overlap detection, approval workflow, cancel-refund, payroll deduction correctness"""
import pytest
from decimal import Decimal
from datetime import date, timedelta
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from core.database import Base, get_db
from core.security import hash_password
from models.user import User, UserRole
from models.payroll import Employee
from main import app

engine = create_engine("sqlite:///./test_leave.db", connect_args={"check_same_thread": False})
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
def employee(db):
    e = Employee(employee_code="E001", full_name="สมชาย ทดสอบ", start_date=date(2023, 1, 1), base_salary=Decimal("30000"))
    db.add(e); db.commit(); db.refresh(e)
    return e

@pytest.fixture
def leave_types(client, acc_token):
    res = client.post("/api/v1/leave/types/seed-defaults", headers={"Authorization": f"Bearer {acc_token}"})
    types = {t["code"]: t for t in res.json()}
    return types


# ── Leave Type ─────────────────────────────────────────────────
def test_seed_default_leave_types(client, acc_token):
    res = client.post("/api/v1/leave/types/seed-defaults", headers={"Authorization": f"Bearer {acc_token}"})
    codes = {t["code"] for t in res.json()}
    assert codes == {"ANNUAL", "SICK", "PERSONAL", "UNPAID"}

def test_duplicate_leave_type_code_rejected(client, acc_token, leave_types):
    res = client.post("/api/v1/leave/types", json={"code": "ANNUAL", "name": "dup"},
                      headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 400

def test_seed_defaults_idempotent(client, acc_token, leave_types):
    """Re-seeding must not create duplicates — same guard pattern as the
    existing accounting/inventory seed helpers in this codebase."""
    res2 = client.post("/api/v1/leave/types/seed-defaults", headers={"Authorization": f"Bearer {acc_token}"})
    assert res2.json() == []   # nothing new created since all 4 already exist
    all_types = client.get("/api/v1/leave/types", headers={"Authorization": f"Bearer {acc_token}"}).json()
    assert len(all_types) == 4


# ── Balance Initialization & Math ────────────────────────────
def test_initialize_balance_creates_one_per_leave_type(client, acc_token, employee, leave_types):
    res = client.post("/api/v1/leave/balances/initialize", json={
        "employee_id": str(employee.id), "year": 2026,
    }, headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    assert len(res.json()) == 4

def test_balance_remaining_days_calculated_correctly(client, acc_token, employee, leave_types):
    client.post("/api/v1/leave/balances/initialize", json={"employee_id": str(employee.id), "year": 2026},
               headers={"Authorization": f"Bearer {acc_token}"})
    res = client.get(f"/api/v1/leave/balances/{employee.id}?year=2026", headers={"Authorization": f"Bearer {acc_token}"})
    annual = next(b for b in res.json() if b["leave_type_name"] == "ลาพักร้อน")
    assert float(annual["entitled_days"]) == 10
    assert float(annual["used_days"]) == 0
    assert float(annual["remaining_days"]) == 10

def test_initialize_balance_idempotent_per_year(client, acc_token, employee, leave_types):
    client.post("/api/v1/leave/balances/initialize", json={"employee_id": str(employee.id), "year": 2026},
               headers={"Authorization": f"Bearer {acc_token}"})
    res2 = client.post("/api/v1/leave/balances/initialize", json={"employee_id": str(employee.id), "year": 2026},
                       headers={"Authorization": f"Bearer {acc_token}"})
    balances = client.get(f"/api/v1/leave/balances/{employee.id}?year=2026", headers={"Authorization": f"Bearer {acc_token}"}).json()
    assert len(balances) == 4   # not duplicated

def test_carry_over_brings_forward_unused_days(client, acc_token, employee, leave_types, db):
    client.post("/api/v1/leave/balances/initialize", json={"employee_id": str(employee.id), "year": 2025},
               headers={"Authorization": f"Bearer {acc_token}"})
    # Manually simulate 4 unused annual days from 2025 (entitled 10, used 6)
    from models.leave import LeaveBalance, LeaveType
    annual_type = db.query(LeaveType).filter(LeaveType.code == "ANNUAL").first()
    bal_2025 = db.query(LeaveBalance).filter(
        LeaveBalance.employee_id == employee.id, LeaveBalance.leave_type_id == annual_type.id, LeaveBalance.year == 2025,
    ).first()
    bal_2025.used_days = Decimal("6")
    db.commit()

    res = client.post("/api/v1/leave/balances/initialize", json={
        "employee_id": str(employee.id), "year": 2026, "carry_over_unused_from_prior_year": True,
    }, headers={"Authorization": f"Bearer {acc_token}"})
    annual_2026 = next(b for b in res.json() if b["leave_type_name"] == "ลาพักร้อน")
    assert float(annual_2026["carried_over"]) == 4   # 10 - 6
    assert float(annual_2026["remaining_days"]) == 14   # 10 entitled + 4 carried


# ── Leave Request Workflow ─────────────────────────────────────
def test_create_leave_request(client, acc_token, employee, leave_types):
    client.post("/api/v1/leave/balances/initialize", json={"employee_id": str(employee.id), "year": 2026},
               headers={"Authorization": f"Bearer {acc_token}"})
    res = client.post("/api/v1/leave/requests", json={
        "employee_id": str(employee.id), "leave_type_id": leave_types["ANNUAL"]["id"],
        "start_date": "2026-03-10", "end_date": "2026-03-11", "days_requested": 2,
    }, headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    assert res.json()["status"] == "pending"

def test_request_exceeding_balance_rejected(client, acc_token, employee, leave_types):
    client.post("/api/v1/leave/balances/initialize", json={"employee_id": str(employee.id), "year": 2026},
               headers={"Authorization": f"Bearer {acc_token}"})
    res = client.post("/api/v1/leave/requests", json={
        "employee_id": str(employee.id), "leave_type_id": leave_types["ANNUAL"]["id"],
        "start_date": "2026-03-10", "end_date": "2026-03-25", "days_requested": 15,   # only 10 entitled
    }, headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 400

def test_unpaid_leave_request_not_capped_by_balance(client, acc_token, employee, leave_types):
    """UNPAID has default_days_per_year=0, meaning no cap — must not be
    blocked the way a real finite-entitlement type would be."""
    res = client.post("/api/v1/leave/requests", json={
        "employee_id": str(employee.id), "leave_type_id": leave_types["UNPAID"]["id"],
        "start_date": "2026-03-10", "end_date": "2026-03-20", "days_requested": 10,
    }, headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200

def test_overlapping_request_rejected(client, acc_token, employee, leave_types):
    client.post("/api/v1/leave/balances/initialize", json={"employee_id": str(employee.id), "year": 2026},
               headers={"Authorization": f"Bearer {acc_token}"})
    client.post("/api/v1/leave/requests", json={
        "employee_id": str(employee.id), "leave_type_id": leave_types["ANNUAL"]["id"],
        "start_date": "2026-03-10", "end_date": "2026-03-15", "days_requested": 5,
    }, headers={"Authorization": f"Bearer {acc_token}"})

    res = client.post("/api/v1/leave/requests", json={
        "employee_id": str(employee.id), "leave_type_id": leave_types["PERSONAL"]["id"],
        "start_date": "2026-03-13", "end_date": "2026-03-14", "days_requested": 1,   # overlaps 3/13-3/14
    }, headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 400

def test_non_overlapping_request_allowed(client, acc_token, employee, leave_types):
    client.post("/api/v1/leave/balances/initialize", json={"employee_id": str(employee.id), "year": 2026},
               headers={"Authorization": f"Bearer {acc_token}"})
    client.post("/api/v1/leave/requests", json={
        "employee_id": str(employee.id), "leave_type_id": leave_types["ANNUAL"]["id"],
        "start_date": "2026-03-10", "end_date": "2026-03-11", "days_requested": 2,
    }, headers={"Authorization": f"Bearer {acc_token}"})

    res = client.post("/api/v1/leave/requests", json={
        "employee_id": str(employee.id), "leave_type_id": leave_types["PERSONAL"]["id"],
        "start_date": "2026-03-20", "end_date": "2026-03-20", "days_requested": 1,
    }, headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200

def test_end_before_start_rejected(client, employee, leave_types, acc_token):
    res = client.post("/api/v1/leave/requests", json={
        "employee_id": str(employee.id), "leave_type_id": leave_types["ANNUAL"]["id"],
        "start_date": "2026-03-15", "end_date": "2026-03-10", "days_requested": 1,
    }, headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 422


# ── Approval Workflow ──────────────────────────────────────────
def test_approve_leave_deducts_balance(client, acc_token, mgr_token, employee, leave_types):
    client.post("/api/v1/leave/balances/initialize", json={"employee_id": str(employee.id), "year": 2026},
               headers={"Authorization": f"Bearer {acc_token}"})
    req = client.post("/api/v1/leave/requests", json={
        "employee_id": str(employee.id), "leave_type_id": leave_types["ANNUAL"]["id"],
        "start_date": "2026-03-10", "end_date": "2026-03-13", "days_requested": 4,
    }, headers={"Authorization": f"Bearer {acc_token}"}).json()

    res = client.post(f"/api/v1/leave/requests/{req['id']}/process", json={"approve": True},
                      headers={"Authorization": f"Bearer {mgr_token}"})
    assert res.status_code == 200
    assert res.json()["status"] == "approved"

    balances = client.get(f"/api/v1/leave/balances/{employee.id}?year=2026", headers={"Authorization": f"Bearer {acc_token}"}).json()
    annual = next(b for b in balances if b["leave_type_name"] == "ลาพักร้อน")
    assert float(annual["used_days"]) == 4
    assert float(annual["remaining_days"]) == 6   # 10 - 4

def test_reject_leave_does_not_touch_balance(client, acc_token, mgr_token, employee, leave_types):
    client.post("/api/v1/leave/balances/initialize", json={"employee_id": str(employee.id), "year": 2026},
               headers={"Authorization": f"Bearer {acc_token}"})
    req = client.post("/api/v1/leave/requests", json={
        "employee_id": str(employee.id), "leave_type_id": leave_types["ANNUAL"]["id"],
        "start_date": "2026-03-10", "end_date": "2026-03-11", "days_requested": 2,
    }, headers={"Authorization": f"Bearer {acc_token}"}).json()

    client.post(f"/api/v1/leave/requests/{req['id']}/process",
               json={"approve": False, "rejection_reason": "งานสำคัญช่วงนั้น"},
               headers={"Authorization": f"Bearer {mgr_token}"})

    balances = client.get(f"/api/v1/leave/balances/{employee.id}?year=2026", headers={"Authorization": f"Bearer {acc_token}"}).json()
    annual = next(b for b in balances if b["leave_type_name"] == "ลาพักร้อน")
    assert float(annual["used_days"]) == 0

def test_only_manager_up_can_approve(client, acc_token, employee, leave_types):
    req = client.post("/api/v1/leave/requests", json={
        "employee_id": str(employee.id), "leave_type_id": leave_types["PERSONAL"]["id"],
        "start_date": "2026-03-10", "end_date": "2026-03-10", "days_requested": 1,
    }, headers={"Authorization": f"Bearer {acc_token}"}).json()
    res = client.post(f"/api/v1/leave/requests/{req['id']}/process", json={"approve": True},
                      headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 403

def test_cannot_process_already_processed_request(client, acc_token, mgr_token, employee, leave_types):
    req = client.post("/api/v1/leave/requests", json={
        "employee_id": str(employee.id), "leave_type_id": leave_types["PERSONAL"]["id"],
        "start_date": "2026-03-10", "end_date": "2026-03-10", "days_requested": 1,
    }, headers={"Authorization": f"Bearer {acc_token}"}).json()
    client.post(f"/api/v1/leave/requests/{req['id']}/process", json={"approve": True},
               headers={"Authorization": f"Bearer {mgr_token}"})

    res = client.post(f"/api/v1/leave/requests/{req['id']}/process", json={"approve": True},
                      headers={"Authorization": f"Bearer {mgr_token}"})
    assert res.status_code == 400


# ── Cancel & Refund ────────────────────────────────────────────
def test_cancel_approved_leave_refunds_balance(client, acc_token, mgr_token, employee, leave_types):
    client.post("/api/v1/leave/balances/initialize", json={"employee_id": str(employee.id), "year": 2026},
               headers={"Authorization": f"Bearer {acc_token}"})
    req = client.post("/api/v1/leave/requests", json={
        "employee_id": str(employee.id), "leave_type_id": leave_types["ANNUAL"]["id"],
        "start_date": "2026-03-10", "end_date": "2026-03-13", "days_requested": 4,
    }, headers={"Authorization": f"Bearer {acc_token}"}).json()
    client.post(f"/api/v1/leave/requests/{req['id']}/process", json={"approve": True},
               headers={"Authorization": f"Bearer {mgr_token}"})

    res = client.post(f"/api/v1/leave/requests/{req['id']}/cancel", json={},
                      headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    assert res.json()["status"] == "cancelled"

    balances = client.get(f"/api/v1/leave/balances/{employee.id}?year=2026", headers={"Authorization": f"Bearer {acc_token}"}).json()
    annual = next(b for b in balances if b["leave_type_name"] == "ลาพักร้อน")
    assert float(annual["used_days"]) == 0   # refunded back
    assert float(annual["remaining_days"]) == 10

def test_cancel_pending_leave_does_not_double_refund(client, acc_token, employee, leave_types):
    client.post("/api/v1/leave/balances/initialize", json={"employee_id": str(employee.id), "year": 2026},
               headers={"Authorization": f"Bearer {acc_token}"})
    req = client.post("/api/v1/leave/requests", json={
        "employee_id": str(employee.id), "leave_type_id": leave_types["ANNUAL"]["id"],
        "start_date": "2026-03-10", "end_date": "2026-03-11", "days_requested": 2,
    }, headers={"Authorization": f"Bearer {acc_token}"}).json()

    client.post(f"/api/v1/leave/requests/{req['id']}/cancel", json={}, headers={"Authorization": f"Bearer {acc_token}"})
    balances = client.get(f"/api/v1/leave/balances/{employee.id}?year=2026", headers={"Authorization": f"Bearer {acc_token}"}).json()
    annual = next(b for b in balances if b["leave_type_name"] == "ลาพักร้อน")
    assert float(annual["used_days"]) == 0

def test_cannot_cancel_already_cancelled(client, acc_token, employee, leave_types):
    req = client.post("/api/v1/leave/requests", json={
        "employee_id": str(employee.id), "leave_type_id": leave_types["PERSONAL"]["id"],
        "start_date": "2026-03-10", "end_date": "2026-03-10", "days_requested": 1,
    }, headers={"Authorization": f"Bearer {acc_token}"}).json()
    client.post(f"/api/v1/leave/requests/{req['id']}/cancel", json={}, headers={"Authorization": f"Bearer {acc_token}"})

    res = client.post(f"/api/v1/leave/requests/{req['id']}/cancel", json={}, headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 400


# ── Team Calendar ─────────────────────────────────────────────
def test_team_calendar_shows_only_approved(client, acc_token, mgr_token, employee, leave_types):
    approved_req = client.post("/api/v1/leave/requests", json={
        "employee_id": str(employee.id), "leave_type_id": leave_types["PERSONAL"]["id"],
        "start_date": "2026-03-10", "end_date": "2026-03-10", "days_requested": 1,
    }, headers={"Authorization": f"Bearer {acc_token}"}).json()
    client.post(f"/api/v1/leave/requests/{approved_req['id']}/process", json={"approve": True},
               headers={"Authorization": f"Bearer {mgr_token}"})

    # A second, unrelated pending request must not show up
    client.post("/api/v1/leave/requests", json={
        "employee_id": str(employee.id), "leave_type_id": leave_types["UNPAID"]["id"],
        "start_date": "2026-04-01", "end_date": "2026-04-02", "days_requested": 2,
    }, headers={"Authorization": f"Bearer {acc_token}"})

    res = client.get("/api/v1/leave/calendar?period_from=2026-03-01&period_to=2026-04-30",
                     headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    assert len(res.json()["entries"]) == 1
    assert res.json()["entries"][0]["leave_type_name"] == "ลากิจ"


# ── Payroll Integration — the correctness-critical calculation ──
def test_unpaid_leave_deduction_zero_when_no_leave(client, acc_token, employee, leave_types):
    res = client.get(f"/api/v1/leave/payroll/unpaid-deduction/{employee.id}?period_month=3&period_year=2026",
                     headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    assert float(res.json()["unpaid_days"]) == 0
    assert float(res.json()["deduction_amount"]) == 0

def test_unpaid_leave_deduction_calculated_correctly(client, acc_token, mgr_token, employee, leave_types):
    """
    Employee earns ฿30,000/month. March 2026 has 31 days, so daily rate =
    30000/31 = 967.7419... rounded to 967.74. 3 unpaid days approved →
    deduction should be exactly 3 * 967.74 = 2903.22, verified as exact math
    here rather than just checking it's "some positive number."
    """
    req = client.post("/api/v1/leave/requests", json={
        "employee_id": str(employee.id), "leave_type_id": leave_types["UNPAID"]["id"],
        "start_date": "2026-03-05", "end_date": "2026-03-07", "days_requested": 3,
    }, headers={"Authorization": f"Bearer {acc_token}"}).json()
    client.post(f"/api/v1/leave/requests/{req['id']}/process", json={"approve": True},
               headers={"Authorization": f"Bearer {mgr_token}"})

    res = client.get(f"/api/v1/leave/payroll/unpaid-deduction/{employee.id}?period_month=3&period_year=2026",
                     headers={"Authorization": f"Bearer {acc_token}"})
    data = res.json()
    assert float(data["unpaid_days"]) == 3
    assert float(data["daily_rate"]) == 967.74   # 30000 / 31, rounded
    assert float(data["deduction_amount"]) == 2903.22   # 3 * 967.74 exactly

def test_unpaid_leave_deduction_only_counts_approved_not_pending(client, acc_token, employee, leave_types):
    client.post("/api/v1/leave/requests", json={
        "employee_id": str(employee.id), "leave_type_id": leave_types["UNPAID"]["id"],
        "start_date": "2026-03-05", "end_date": "2026-03-07", "days_requested": 3,
    }, headers={"Authorization": f"Bearer {acc_token}"})   # left pending, never approved

    res = client.get(f"/api/v1/leave/payroll/unpaid-deduction/{employee.id}?period_month=3&period_year=2026",
                     headers={"Authorization": f"Bearer {acc_token}"})
    assert float(res.json()["unpaid_days"]) == 0   # pending leave must not reduce pay

def test_unpaid_leave_deduction_only_counts_requested_period(client, acc_token, mgr_token, employee, leave_types):
    """Leave approved for February must not bleed into a March deduction calculation."""
    req = client.post("/api/v1/leave/requests", json={
        "employee_id": str(employee.id), "leave_type_id": leave_types["UNPAID"]["id"],
        "start_date": "2026-02-20", "end_date": "2026-02-22", "days_requested": 3,
    }, headers={"Authorization": f"Bearer {acc_token}"}).json()
    client.post(f"/api/v1/leave/requests/{req['id']}/process", json={"approve": True},
               headers={"Authorization": f"Bearer {mgr_token}"})

    res = client.get(f"/api/v1/leave/payroll/unpaid-deduction/{employee.id}?period_month=3&period_year=2026",
                     headers={"Authorization": f"Bearer {acc_token}"})
    assert float(res.json()["unpaid_days"]) == 0
