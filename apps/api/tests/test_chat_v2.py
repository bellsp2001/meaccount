"""AI Chat 2.0 Tests — Knowledge Base RAG, Text-to-SQL templates, Conversation memory"""
import pytest
from decimal import Decimal
from datetime import date
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from core.database import Base, get_db
from core.security import hash_password
from models.user import User, UserRole
from models.knowledge import KnowledgeChunk
from main import app
from services.knowledge_base import search_knowledge, seed_thai_accounting_knowledge
from services.text_to_sql import execute_query_template, QUERY_TEMPLATES

engine = create_engine("sqlite:///./test_chat_v2.db", connect_args={"check_same_thread": False})
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
def token(client, db):
    u = User(email="acc@test.com", full_name="Test", hashed_password=hash_password("Test@1234"), role=UserRole.ACCOUNTANT, is_active=True)
    db.add(u); db.commit()
    return client.post("/api/v1/auth/login", json={"email": "acc@test.com", "password": "Test@1234"}).json()["access_token"]

@pytest.fixture
def seeded_kb(db):
    seed_thai_accounting_knowledge(db)
    return db.query(KnowledgeChunk).all()


# ── Knowledge Base Search (pure function, deterministic) ────────
def test_seed_knowledge_creates_entries(db):
    seed_thai_accounting_knowledge(db)
    chunks = db.query(KnowledgeChunk).all()
    assert len(chunks) >= 10

def test_search_knowledge_vat_query(db, seeded_kb):
    results = search_knowledge(db, "อัตราภาษีมูลค่าเพิ่มเท่าไหร่", top_k=3)
    assert len(results) > 0
    assert any("vat" in r.chunk.category.lower() or "ภาษีมูลค่าเพิ่ม" in r.chunk.title for r in results)

def test_search_knowledge_wht_query(db, seeded_kb):
    results = search_knowledge(db, "หัก ณ ที่จ่าย ค่าเช่า กี่เปอร์เซ็นต์", top_k=3)
    assert len(results) > 0
    top = results[0]
    assert top.relevance > 0

def test_search_knowledge_no_match_returns_empty_or_low(db, seeded_kb):
    results = search_knowledge(db, "xyzabc123 random gibberish", top_k=3)
    # Should return empty or very low relevance since no real overlap
    assert all(r.relevance <= 0.5 for r in results) or len(results) == 0

def test_search_knowledge_empty_kb(db):
    results = search_knowledge(db, "ภาษี", top_k=3)
    assert results == []


# ── Text-to-SQL Query Templates (pure function) ─────────────────
def test_execute_template_account_balance(db):
    from models.accounting import Account, AccountTypeEnum, NormalBalance
    a = Account(code="1101", name="เงินสด", account_type=AccountTypeEnum.ASSET, normal_balance=NormalBalance.DEBIT, level=3, balance=Decimal("5000"))
    db.add(a); db.commit()
    result = execute_query_template(db, "account_balance_by_type", {})
    assert result["type"] == "grouped"
    assert "asset" in result["data"]
    assert result["data"]["asset"] == 5000.0

def test_execute_template_overdue_invoices(db):
    from models.ar import Customer, Invoice, InvoiceStatus
    c = Customer(code="C001", name="ลูกค้า", credit_days=30)
    db.add(c); db.flush()
    inv = Invoice(number="INV-001", customer_id=c.id, date=date(2025, 1, 1), due_date=date(2025, 2, 1),
                 status=InvoiceStatus.SENT, subtotal=Decimal("1000"), total=Decimal("1070"), balance_due=Decimal("1070"))
    db.add(inv); db.commit()
    result = execute_query_template(db, "overdue_invoices", {})
    assert result["type"] == "list"
    assert len(result["data"]) == 1
    assert result["data"][0]["number"] == "INV-001"

def test_execute_template_unknown_returns_empty(db):
    result = execute_query_template(db, "nonexistent_template", {})
    assert result["type"] == "empty"

def test_query_templates_whitelist_immutable():
    """Ensure whitelist has expected safe templates only"""
    assert "revenue_by_month" in QUERY_TEMPLATES
    assert "overdue_invoices" in QUERY_TEMPLATES
    assert len(QUERY_TEMPLATES) >= 5


# ── Chat V2 API Endpoints ───────────────────────────────────────
def test_send_message_creates_conversation(client, token, seeded_kb):
    res = client.post("/api/v1/chat-v2/message", json={"message": "VAT คืออัตราเท่าไหร่?"},
                      headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    data = res.json()
    assert data["conversation_id"] is not None
    assert data["role"] == "assistant"
    assert len(data["content"]) > 0

def test_conversation_persists_across_messages(client, token, seeded_kb):
    res1 = client.post("/api/v1/chat-v2/message", json={"message": "สวัสดี"},
                       headers={"Authorization": f"Bearer {token}"})
    conv_id = res1.json()["conversation_id"]

    res2 = client.post("/api/v1/chat-v2/message", json={"conversation_id": conv_id, "message": "ขอบคุณ"},
                       headers={"Authorization": f"Bearer {token}"})
    assert res2.json()["conversation_id"] == conv_id

def test_list_conversations(client, token, seeded_kb):
    client.post("/api/v1/chat-v2/message", json={"message": "ทดสอบ"},
               headers={"Authorization": f"Bearer {token}"})
    res = client.get("/api/v1/chat-v2/conversations", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert len(res.json()) >= 1

def test_get_conversation_messages(client, token, seeded_kb):
    send_res = client.post("/api/v1/chat-v2/message", json={"message": "คำถามทดสอบ"},
                           headers={"Authorization": f"Bearer {token}"})
    conv_id = send_res.json()["conversation_id"]

    res = client.get(f"/api/v1/chat-v2/conversations/{conv_id}/messages",
                     headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    messages = res.json()
    assert len(messages) == 2  # user + assistant
    assert messages[0]["role"] == "user"
    assert messages[1]["role"] == "assistant"

def test_cannot_access_other_user_conversation(client, token, db, seeded_kb):
    send_res = client.post("/api/v1/chat-v2/message", json={"message": "私的な質問"},
                           headers={"Authorization": f"Bearer {token}"})
    conv_id = send_res.json()["conversation_id"]

    other = User(email="other@test.com", full_name="Other", hashed_password=hash_password("Test@1234"), role=UserRole.ACCOUNTANT, is_active=True)
    db.add(other); db.commit()
    other_token = client.post("/api/v1/auth/login", json={"email": "other@test.com", "password": "Test@1234"}).json()["access_token"]

    res = client.get(f"/api/v1/chat-v2/conversations/{conv_id}/messages",
                     headers={"Authorization": f"Bearer {other_token}"})
    assert res.status_code == 404


# ── Knowledge Base Endpoints ──────────────────────────────────
def test_seed_knowledge_endpoint(client, token):
    res = client.post("/api/v1/chat-v2/knowledge/seed", headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    list_res = client.get("/api/v1/chat-v2/knowledge", headers={"Authorization": f"Bearer {token}"})
    assert len(list_res.json()) >= 10

def test_create_custom_knowledge(client, token):
    res = client.post("/api/v1/chat-v2/knowledge", json={
        "category": "general", "title": "นโยบายบริษัท", "content": "ทดสอบเนื้อหา", "keywords": "test,policy",
    }, headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert res.json()["title"] == "นโยบายบริษัท"

def test_search_knowledge_endpoint(client, token, seeded_kb):
    res = client.get("/api/v1/chat-v2/knowledge/search?q=ภาษีมูลค่าเพิ่ม",
                     headers={"Authorization": f"Bearer {token}"})
    assert res.status_code == 200
    assert len(res.json()) > 0
