"""
GL Tests — Chart of Accounts + Journal Double-Entry + Post
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

engine = create_engine("sqlite:///./test_gl.db", connect_args={"check_same_thread": False})
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
def accountant(db):
    u = User(email="acc@test.com", full_name="Accountant", hashed_password=hash_password("Test@1234"), role=UserRole.ACCOUNTANT, is_active=True)
    db.add(u); db.commit(); db.refresh(u)
    return u


@pytest.fixture
def token(client, accountant):
    res = client.post("/api/v1/auth/login", json={"email": "acc@test.com", "password": "Test@1234"})
    return res.json()["access_token"]


@pytest.fixture
def two_accounts(db):
    cash = Account(code="1101", name="เงินสด", account_type=AccountTypeEnum.ASSET, normal_balance=NormalBalance.DEBIT, level=3)
    rev  = Account(code="4101", name="รายได้ขาย", account_type=AccountTypeEnum.INCOME, normal_balance=NormalBalance.CREDIT, level=2)
    db.add_all([cash, rev]); db.commit()
    db.refresh(cash); db.refresh(rev)
    return cash, rev


# ── Account CRUD ──────────────────────────────────────────────
def test_create_account(client, token):
    res = client.post("/api/v1/accounts/", json={
        "code": "1101", "name": "เงินสด", "name_en": "Cash",
        "account_type": "asset", "normal_balance": "debit", "level": 3
    }, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.json()["code"] == "1101"


def test_duplicate_account_code(client, token, two_accounts):
    res = client.post("/api/v1/accounts/", json={
        "code": "1101", "name": "Duplicate", "account_type": "asset", "normal_balance": "debit", "level": 3
    }, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 400


def test_list_accounts(client, token, two_accounts):
    res = client.get("/api/v1/accounts/", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert len(res.json()) == 2


# ── Journal Double-Entry ──────────────────────────────────────
def test_create_balanced_journal(client, token, two_accounts):
    cash, rev = two_accounts
    res = client.post("/api/v1/journals/", json={
        "date": "2024-01-15",
        "description": "รับเงินค่าบริการ",
        "entries": [
            {"account_id": str(cash.id), "debit": 5000, "credit": 0},
            {"account_id": str(rev.id),  "debit": 0, "credit": 5000},
        ]
    }, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "draft"
    assert data["number"].startswith("JV-")
    assert len(data["entries"]) == 2


def test_unbalanced_journal_rejected(client, token, two_accounts):
    cash, rev = two_accounts
    res = client.post("/api/v1/journals/", json={
        "date": "2024-01-15",
        "description": "ไม่สมดุล",
        "entries": [
            {"account_id": str(cash.id), "debit": 5000, "credit": 0},
            {"account_id": str(rev.id),  "debit": 0, "credit": 3000},  # ผิด
        ]
    }, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 422  # validation error


def test_single_entry_rejected(client, token, two_accounts):
    cash, _ = two_accounts
    res = client.post("/api/v1/journals/", json={
        "date": "2024-01-15",
        "description": "รายการเดียว",
        "entries": [{"account_id": str(cash.id), "debit": 1000, "credit": 0}]
    }, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 422


# ── Post Journal → Updates Balance ───────────────────────────
def test_post_journal_updates_balance(client, token, two_accounts, db):
    cash, rev = two_accounts
    # Create
    res = client.post("/api/v1/journals/", json={
        "date": "2024-01-15", "description": "ขายสินค้า",
        "entries": [
            {"account_id": str(cash.id), "debit": 10000, "credit": 0},
            {"account_id": str(rev.id),  "debit": 0, "credit": 10000},
        ]
    }, headers={"Authorization": f"Bearer {token}"})
    journal_id = res.json()["id"]

    # Post
    post_res = client.post(f"/api/v1/journals/{journal_id}/post",
                           headers={"Authorization": f"Bearer {token}"})
    assert post_res.status_code == 200
    assert post_res.json()["status"] == "posted"

    # Check balances
    db.refresh(cash); db.refresh(rev)
    assert cash.balance == Decimal("10000")  # Dr+ asset
    assert rev.balance  == Decimal("10000")  # Cr+ income


def test_double_post_rejected(client, token, two_accounts):
    cash, rev = two_accounts
    res = client.post("/api/v1/journals/", json={
        "date": "2024-01-15", "description": "ทดสอบ",
        "entries": [
            {"account_id": str(cash.id), "debit": 1000, "credit": 0},
            {"account_id": str(rev.id),  "debit": 0, "credit": 1000},
        ]
    }, headers={"Authorization": f"Bearer {token}"})
    jid = res.json()["id"]
    client.post(f"/api/v1/journals/{jid}/post", headers={"Authorization": f"Bearer {token}"})
    res2 = client.post(f"/api/v1/journals/{jid}/post", headers={"Authorization": f"Bearer {token}"})
    assert res2.status_code == 400


# ── Ledger ────────────────────────────────────────────────────
def test_get_ledger(client, token, two_accounts):
    cash, rev = two_accounts
    # Post a journal first
    res = client.post("/api/v1/journals/", json={
        "date": "2024-01-15", "description": "ขายสินค้า",
        "entries": [
            {"account_id": str(cash.id), "debit": 7000, "credit": 0},
            {"account_id": str(rev.id),  "debit": 0, "credit": 7000},
        ]
    }, headers={"Authorization": f"Bearer {token}"})
    jid = res.json()["id"]
    client.post(f"/api/v1/journals/{jid}/post", headers={"Authorization": f"Bearer {token}"})

    # Get ledger
    ledger = client.get(f"/api/v1/journals/ledger/{cash.id}",
                        headers={"Authorization": f"Bearer {token}"})
    assert ledger.status_code == 200
    data = ledger.json()
    assert len(data["entries"]) == 1
    assert float(data["closing_balance"]) == 7000
