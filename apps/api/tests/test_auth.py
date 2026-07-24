import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from core.database import Base, get_db
from core.security import hash_password
from models.user import User, UserRole
from main import app

SQLALCHEMY_TEST_URL = "sqlite:///./test.db"
engine = create_engine(SQLALCHEMY_TEST_URL, connect_args={"check_same_thread": False})
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


@pytest.fixture(autouse=True)
def setup_db():
    Base.metadata.create_all(bind=engine)
    yield
    Base.metadata.drop_all(bind=engine)


@pytest.fixture
def db():
    session = TestingSessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def client(db):
    def override_get_db():
        yield db
    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


@pytest.fixture
def admin_user(db):
    user = User(
        email="admin@meaccount.com",
        full_name="Admin User",
        hashed_password=hash_password("admin1234"),
        role=UserRole.ADMIN,
        is_active=True,
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def test_login_success(client, admin_user):
    res = client.post("/api/v1/auth/login", json={"email": "admin@meaccount.com", "password": "admin1234"})
    assert res.status_code == 200
    data = res.json()
    assert "access_token" in data
    assert "refresh_token" in data
    assert data["user"]["email"] == "admin@meaccount.com"


def test_login_wrong_password(client, admin_user):
    res = client.post("/api/v1/auth/login", json={"email": "admin@meaccount.com", "password": "wrongpass"})
    assert res.status_code == 401


def test_get_me(client, admin_user):
    login = client.post("/api/v1/auth/login", json={"email": "admin@meaccount.com", "password": "admin1234"})
    token = login.json()["access_token"]
    res = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.json()["role"] == "admin"


def test_create_user_as_admin(client, admin_user):
    login = client.post("/api/v1/auth/login", json={"email": "admin@meaccount.com", "password": "admin1234"})
    token = login.json()["access_token"]
    res = client.post("/api/v1/users/", json={
        "email": "accountant@meaccount.com",
        "full_name": "Test Accountant",
        "password": "pass1234",
        "role": "accountant"
    }, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.json()["role"] == "accountant"
