"""Dashboard & AI Chat API tests"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from core.database import Base, get_db
from core.security import hash_password
from models.user import User, UserRole
from main import app

engine = create_engine("sqlite:///./test_dashboard.db", connect_args={"check_same_thread": False})
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
def accountant(db):
    u = User(email="acc@test.com", full_name="Test", hashed_password=hash_password("Test@1234"),
             role=UserRole.ACCOUNTANT, is_active=True)
    db.add(u); db.commit(); db.refresh(u); return u

@pytest.fixture
def token(client, accountant):
    return client.post("/api/v1/auth/login", json={"email": "acc@test.com", "password": "Test@1234"}).json()["access_token"]

def test_kpi_endpoint(client, token):
    res = client.get("/api/v1/dashboard/kpi", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.json()
    assert "revenue" in data
    assert "expense" in data
    assert "cash_balance" in data
    assert "ar_outstanding" in data
    assert "ap_outstanding" in data

def test_revenue_expense_chart(client, token):
    res = client.get("/api/v1/dashboard/charts/revenue-expense?months=3",
                     headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.json()
    assert len(data) == 3
    assert "month" in data[0]
    assert "revenue" in data[0]
    assert "expense" in data[0]

def test_cash_flow_chart(client, token):
    res = client.get("/api/v1/dashboard/charts/cash-flow?days=7",
                     headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.json()
    assert len(data) == 7
    assert "balance" in data[0]

def test_expense_breakdown(client, token):
    res = client.get("/api/v1/dashboard/charts/expense-breakdown",
                     headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert isinstance(res.json(), list)

def test_alerts(client, token):
    res = client.get("/api/v1/dashboard/alerts", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert isinstance(res.json(), list)

def test_ai_chat_no_key(client, token):
    """ทดสอบ AI chat เมื่อไม่มี API key"""
    res = client.post("/api/v1/dashboard/ai-chat",
                      json={"message": "รายได้เดือนนี้เท่าไหร่?", "history": []},
                      headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.json()
    assert "content" in data
    assert data["role"] == "assistant"

def test_chat_suggestions(client, token):
    res = client.get("/api/v1/dashboard/ai-chat/suggestions",
                     headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert len(res.json()["suggestions"]) >= 5

def test_unauthenticated_blocked(client):
    res = client.get("/api/v1/dashboard/kpi")
    assert res.status_code == 403
