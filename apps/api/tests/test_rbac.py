"""
RBAC tests — ตรวจสอบว่าแต่ละ Role เข้าถึงได้ถูกต้อง
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from core.database import Base, get_db
from core.security import hash_password
from models.user import User, UserRole
from main import app

engine = create_engine("sqlite:///./test_rbac.db", connect_args={"check_same_thread": False})
TestingDB = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(autouse=True)
def setup():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db():
    s = TestingDB()
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


def make_user(db, role: UserRole, suffix: str = "") -> User:
    u = User(
        email=f"{role.value}{suffix}@test.com",
        full_name=f"Test {role.value}",
        hashed_password=hash_password("Test@1234"),
        role=role, is_active=True,
    )
    db.add(u); db.commit(); db.refresh(u)
    return u


def get_token(client, role: UserRole, suffix: str = "") -> str:
    res = client.post("/api/v1/auth/login", json={"email": f"{role.value}{suffix}@test.com", "password": "Test@1234"})
    assert res.status_code == 200, res.text
    return res.json()["access_token"]


# ── Test: Only admin can list users ──────────────────────────
def test_admin_can_list_users(client, db):
    make_user(db, UserRole.ADMIN)
    token = get_token(client, UserRole.ADMIN)
    res = client.get("/api/v1/users/", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200


@pytest.mark.parametrize("role", [UserRole.ACCOUNTANT, UserRole.CASHIER, UserRole.MANAGER, UserRole.AUDITOR, UserRole.INVENTORY])
def test_non_admin_cannot_list_users(client, db, role):
    make_user(db, role)
    token = get_token(client, role)
    res = client.get("/api/v1/users/", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 403


# ── Test: Admin can create users ─────────────────────────────
def test_admin_can_create_user(client, db):
    make_user(db, UserRole.ADMIN)
    token = get_token(client, UserRole.ADMIN)
    res = client.post("/api/v1/users/", headers={"Authorization": f"Bearer {token}"},
        json={"email": "new@test.com", "full_name": "New User", "password": "NewPass@123", "role": "cashier"})
    assert res.status_code == 200
    assert res.json()["role"] == "cashier"


# ── Test: Each role can access /auth/me ──────────────────────
@pytest.mark.parametrize("role", list(UserRole))
def test_all_roles_can_get_me(client, db, role):
    make_user(db, role)
    token = get_token(client, role)
    res = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.json()["role"] == role.value


# ── Test: Inactive user cannot login ─────────────────────────
def test_inactive_user_cannot_login(client, db):
    u = make_user(db, UserRole.ACCOUNTANT, suffix="_inactive")
    u.is_active = False
    db.commit()
    res = client.post("/api/v1/auth/login", json={"email": "accountant_inactive@test.com", "password": "Test@1234"})
    assert res.status_code == 403


# ── Test: Invalid token returns 401 ──────────────────────────
def test_invalid_token(client, db):
    res = client.get("/api/v1/auth/me", headers={"Authorization": "Bearer invalidtoken"})
    assert res.status_code == 401


# ── Test: Admin can toggle user active status ─────────────────
def test_admin_can_toggle_user(client, db):
    make_user(db, UserRole.ADMIN)
    target = make_user(db, UserRole.CASHIER, suffix="_target")
    token = get_token(client, UserRole.ADMIN)
    res = client.patch(f"/api/v1/users/{target.id}", headers={"Authorization": f"Bearer {token}"},
        json={"is_active": False})
    assert res.status_code == 200
    assert res.json()["is_active"] is False
