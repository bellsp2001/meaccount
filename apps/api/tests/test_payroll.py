"""Payroll Tests — Tax calculation accuracy, Employee CRUD, Payslip generation, GL posting"""
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
from services.tax_calc import calc_social_security, calc_monthly_withholding_tax, calc_payslip

engine = create_engine("sqlite:///./test_payroll.db", connect_args={"check_same_thread": False})
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
def gl_accounts(db):
    accs = [
        Account(code="1102", name="เงินฝากธนาคาร",  account_type=AccountTypeEnum.ASSET,     normal_balance=NormalBalance.DEBIT,  level=3),
        Account(code="2104", name="WHT ค้างจ่าย",    account_type=AccountTypeEnum.LIABILITY, normal_balance=NormalBalance.CREDIT, level=3),
        Account(code="2106", name="ประกันสังคมค้างจ่าย", account_type=AccountTypeEnum.LIABILITY, normal_balance=NormalBalance.CREDIT, level=3),
        Account(code="5201", name="เงินเดือน",       account_type=AccountTypeEnum.EXPENSE,   normal_balance=NormalBalance.DEBIT,  level=2),
        Account(code="5202", name="ประกันสังคม",     account_type=AccountTypeEnum.EXPENSE,   normal_balance=NormalBalance.DEBIT,  level=2),
    ]
    for a in accs: db.add(a)
    db.commit(); return accs

@pytest.fixture
def employee(client, acc_token):
    res = client.post("/api/v1/payroll/employees", json={
        "employee_code": "EMP001", "full_name": "สมชาย ทดสอบ",
        "start_date": "2023-01-01", "base_salary": 30000,
        "marital_status": "single", "num_children": 0,
    }, headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    return res.json()


# ── Tax Calculation Engine (pure function tests) ────────────────
def test_social_security_normal():
    assert calc_social_security(Decimal("10000")) == Decimal("500")  # 5% of 10000

def test_social_security_capped():
    # Salary above 15000 base → capped at 750
    assert calc_social_security(Decimal("50000")) == Decimal("750")

def test_social_security_low_salary():
    assert calc_social_security(Decimal("5000")) == Decimal("250")  # 5% of 5000

def test_withholding_tax_below_threshold():
    """เงินเดือนต่ำ ไม่ควรมีภาษี (อยู่ในช่วงยกเว้น)"""
    wht = calc_monthly_withholding_tax(Decimal("15000"), "single", 0)
    assert wht == Decimal("0")

def test_withholding_tax_mid_salary():
    """เงินเดือนปานกลาง ควรมีภาษีบวก"""
    wht = calc_monthly_withholding_tax(Decimal("50000"), "single", 0)
    assert wht > Decimal("0")

def test_withholding_tax_married_less_than_single():
    """คนแต่งงาน ลดหย่อนมากกว่า → ภาษีน้อยกว่าคนโสดเงินเดือนเท่ากัน"""
    single_wht  = calc_monthly_withholding_tax(Decimal("60000"), "single", 0)
    married_wht = calc_monthly_withholding_tax(Decimal("60000"), "married", 0)
    assert married_wht <= single_wht

def test_withholding_tax_with_children_lower():
    """มีบุตร ลดหย่อนเพิ่ม → ภาษีลดลง"""
    no_child = calc_monthly_withholding_tax(Decimal("60000"), "single", 0)
    with_child = calc_monthly_withholding_tax(Decimal("60000"), "single", 2)
    assert with_child <= no_child

def test_calc_payslip_full():
    result = calc_payslip(
        base_salary=Decimal("30000"), ot_hours=Decimal("10"), ot_rate=Decimal("150"),
        allowance=Decimal("2000"), bonus=Decimal("0"),
        marital_status="single", num_children=0, sso_enrolled=True,
    )
    assert result["ot_amount"] == Decimal("1500.00")
    assert result["gross_pay"] == Decimal("33500")
    assert result["sso_employee"] == Decimal("750")  # capped
    assert result["net_pay"] == result["gross_pay"] - result["total_deduction"]


# ── Employee CRUD API ─────────────────────────────────────────
def test_create_employee(client, acc_token):
    res = client.post("/api/v1/payroll/employees", json={
        "employee_code": "EMP002", "full_name": "สมหญิง ใจดี",
        "start_date": "2024-01-01", "base_salary": 25000,
    }, headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    assert res.json()["employee_code"] == "EMP002"

def test_duplicate_employee_code(client, acc_token, employee):
    res = client.post("/api/v1/payroll/employees", json={
        "employee_code": "EMP001", "full_name": "Dup", "start_date": "2024-01-01", "base_salary": 20000,
    }, headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 400

def test_negative_salary_rejected(client, acc_token):
    res = client.post("/api/v1/payroll/employees", json={
        "employee_code": "EMP003", "full_name": "Test", "start_date": "2024-01-01", "base_salary": -1000,
    }, headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 422


# ── Payslip Generation ────────────────────────────────────────
def test_create_payslip(client, acc_token, employee):
    res = client.post("/api/v1/payroll/payslips", json={
        "employee_id": employee["id"], "period_month": 2, "period_year": 2025,
        "pay_date": "2025-02-28",
    }, headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    data = res.json()
    assert data["number"] == "PS-202502-EMP001"
    assert data["status"] == "draft"
    assert float(data["net_pay"]) > 0

def test_duplicate_payslip_rejected(client, acc_token, employee):
    client.post("/api/v1/payroll/payslips", json={
        "employee_id": employee["id"], "period_month": 3, "period_year": 2025, "pay_date": "2025-03-31",
    }, headers={"Authorization": f"Bearer {acc_token}"})
    res = client.post("/api/v1/payroll/payslips", json={
        "employee_id": employee["id"], "period_month": 3, "period_year": 2025, "pay_date": "2025-03-31",
    }, headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 400


# ── Bulk Payroll Run ──────────────────────────────────────────
def test_bulk_payroll_run(client, acc_token, employee):
    res = client.post("/api/v1/payroll/run", json={
        "period_month": 4, "period_year": 2025, "pay_date": "2025-04-30",
    }, headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    data = res.json()
    assert data["total_employees"] == 1
    assert float(data["total_net"]) > 0


# ── Approval Workflow ─────────────────────────────────────────
def test_approve_payslip(client, acc_token, mgr_token, employee):
    ps = client.post("/api/v1/payroll/payslips", json={
        "employee_id": employee["id"], "period_month": 5, "period_year": 2025, "pay_date": "2025-05-31",
    }, headers={"Authorization": f"Bearer {acc_token}"}).json()

    res = client.post(f"/api/v1/payroll/payslips/{ps['id']}/approve",
                      headers={"Authorization": f"Bearer {mgr_token}"})
    assert res.status_code == 200
    assert res.json()["status"] == "approved"

def test_accountant_cannot_approve(client, acc_token, employee):
    ps = client.post("/api/v1/payroll/payslips", json={
        "employee_id": employee["id"], "period_month": 6, "period_year": 2025, "pay_date": "2025-06-30",
    }, headers={"Authorization": f"Bearer {acc_token}"}).json()
    res = client.post(f"/api/v1/payroll/payslips/{ps['id']}/approve",
                      headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 403


# ── GL Posting ────────────────────────────────────────────────
def test_post_payslip_to_gl(client, acc_token, mgr_token, employee, gl_accounts, db):
    ps = client.post("/api/v1/payroll/payslips", json={
        "employee_id": employee["id"], "period_month": 7, "period_year": 2025, "pay_date": "2025-07-31",
    }, headers={"Authorization": f"Bearer {acc_token}"}).json()

    res = client.post(f"/api/v1/payroll/payslips/{ps['id']}/post-gl",
                      headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    assert res.json()["gl_posted"] is True
    assert res.json()["status"] == "paid"

    salary_acc = next(a for a in gl_accounts if a.code == "5201")
    db.refresh(salary_acc)
    assert salary_acc.balance > 0


# ── AI Tax Check ──────────────────────────────────────────────
def test_ai_check_tax(client, acc_token, employee):
    client.post("/api/v1/payroll/payslips", json={
        "employee_id": employee["id"], "period_month": 8, "period_year": 2025, "pay_date": "2025-08-31",
    }, headers={"Authorization": f"Bearer {acc_token}"})

    res = client.post("/api/v1/payroll/ai/check-tax", json={
        "employee_id": employee["id"], "period_month": 8, "period_year": 2025,
    }, headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    assert res.json()["is_correct"] is True  # should match since we just calculated it


def test_salary_analysis(client, mgr_token, employee):
    res = client.get("/api/v1/payroll/ai/salary-analysis", headers={"Authorization": f"Bearer {mgr_token}"})
    assert res.status_code == 200
    assert res.json()["total_employees"] == 1
