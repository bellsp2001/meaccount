"""API Platform Tests — Key generation/hashing security, rate limiting, webhook signing, integration adapters"""
import pytest
import httpx
from datetime import datetime, timedelta
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from core.database import Base, get_db
from core.security import hash_password
from models.user import User, UserRole
from models.api_platform import APIKey, WebhookSubscription
from main import app
from services.api_key import create_api_key, verify_api_key, check_rate_limit, KEY_PREFIX
from services.webhook import sign_payload
from services.integrations import MockBankAdapter, NotYetImplementedAdapter
from schemas.api_platform import APIKeyCreate

engine = create_engine("sqlite:///./test_api_platform.db", connect_args={"check_same_thread": False})
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
def admin_token(client, db):
    make_user(db, UserRole.ADMIN, "admin@test.com")
    return get_token(client, "admin@test.com")

@pytest.fixture
def acc_token(client, db):
    make_user(db, UserRole.ACCOUNTANT, "acc@test.com")
    return get_token(client, "acc@test.com")


# ── API Key Security (the critical path) ────────────────────────
def test_plaintext_key_only_returned_once(db):
    """The core security property: a fresh key generation returns the plaintext,
    but nothing stored in the DB can be used to reconstruct it."""
    result = create_api_key(db, APIKeyCreate(name="test key"))
    assert result["plaintext_key"].startswith(KEY_PREFIX)

    stored = db.query(APIKey).filter(APIKey.id == result["id"]).first()
    assert stored.hashed_key != result["plaintext_key"]
    assert result["plaintext_key"] not in stored.hashed_key  # not even a substring

def test_verify_api_key_accepts_correct_key(db):
    result = create_api_key(db, APIKeyCreate(name="verify test"))
    verified = verify_api_key(db, result["plaintext_key"])
    assert verified is not None
    assert verified.id == result["id"]

def test_verify_api_key_rejects_wrong_key(db):
    create_api_key(db, APIKeyCreate(name="real key"))
    forged = f"{KEY_PREFIX}totally_made_up_value_xyz"
    verified = verify_api_key(db, forged)
    assert verified is None

def test_verify_api_key_rejects_keys_with_wrong_prefix(db):
    verified = verify_api_key(db, "sk_stripe_style_key_12345")
    assert verified is None

def test_revoked_key_no_longer_verifies(db):
    result = create_api_key(db, APIKeyCreate(name="to revoke"))
    key = db.query(APIKey).filter(APIKey.id == result["id"]).first()
    key.status = "revoked"
    db.commit()

    verified = verify_api_key(db, result["plaintext_key"])
    assert verified is None  # revoked keys must not verify even with the correct plaintext

def test_verify_increments_usage_count(db):
    result = create_api_key(db, APIKeyCreate(name="usage test"))
    verify_api_key(db, result["plaintext_key"])
    verify_api_key(db, result["plaintext_key"])

    key = db.query(APIKey).filter(APIKey.id == result["id"]).first()
    assert key.request_count == 2
    assert key.last_used_at is not None

def test_two_keys_never_collide_in_verification(db):
    """Two different keys with different prefixes should each only verify
    against their own plaintext — no cross-matching."""
    key1 = create_api_key(db, APIKeyCreate(name="key one"))
    key2 = create_api_key(db, APIKeyCreate(name="key two"))

    v1 = verify_api_key(db, key1["plaintext_key"])
    v2 = verify_api_key(db, key2["plaintext_key"])
    assert v1.id == key1["id"]
    assert v2.id == key2["id"]
    assert v1.id != v2.id


# ── Rate Limiting ────────────────────────────────────────────
def test_rate_limit_allows_within_threshold():
    fake_key = APIKey(name="rl test", key_prefix="mac_live_ab", hashed_key="x", rate_limit_per_min=5)
    fake_key.id = "rl-test-1"
    for _ in range(5):
        assert check_rate_limit(fake_key) is True

def test_rate_limit_blocks_over_threshold():
    fake_key = APIKey(name="rl test2", key_prefix="mac_live_cd", hashed_key="x", rate_limit_per_min=3)
    fake_key.id = "rl-test-2"
    for _ in range(3):
        assert check_rate_limit(fake_key) is True
    assert check_rate_limit(fake_key) is False  # 4th request in the same window should be blocked


# ── API Key Endpoints & Access Control ───────────────────────
def test_only_admin_can_create_api_key(client, acc_token):
    res = client.post("/api/v1/platform/api-keys", json={"name": "test", "rate_limit_per_min": 60},
                      headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 403

def test_admin_creates_and_lists_api_key(client, admin_token):
    create_res = client.post("/api/v1/platform/api-keys", json={"name": "my key", "rate_limit_per_min": 100},
                             headers={"Authorization": f"Bearer {admin_token}"})
    assert create_res.status_code == 200
    assert create_res.json()["plaintext_key"].startswith("mac_live_")

    list_res = client.get("/api/v1/platform/api-keys", headers={"Authorization": f"Bearer {admin_token}"})
    assert len(list_res.json()) == 1
    assert "plaintext_key" not in list_res.json()[0]  # list endpoint must never leak the secret

def test_revoke_api_key(client, admin_token):
    create_res = client.post("/api/v1/platform/api-keys", json={"name": "revoke me", "rate_limit_per_min": 60},
                             headers={"Authorization": f"Bearer {admin_token}"})
    key_id = create_res.json()["id"]

    res = client.post(f"/api/v1/platform/api-keys/{key_id}/revoke", headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 200
    assert res.json()["status"] == "revoked"

def test_cannot_revoke_already_revoked_key(client, admin_token):
    create_res = client.post("/api/v1/platform/api-keys", json={"name": "double revoke", "rate_limit_per_min": 60},
                             headers={"Authorization": f"Bearer {admin_token}"})
    key_id = create_res.json()["id"]
    client.post(f"/api/v1/platform/api-keys/{key_id}/revoke", headers={"Authorization": f"Bearer {admin_token}"})

    res = client.post(f"/api/v1/platform/api-keys/{key_id}/revoke", headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 400


# ── Webhook Signing (verifiable crypto, not just "trust me") ──
def test_signature_is_deterministic_for_same_payload():
    payload = {"event": "invoice.created", "id": "inv-123", "amount": 5000}
    sig1 = sign_payload("shared_secret", payload)
    sig2 = sign_payload("shared_secret", payload)
    assert sig1 == sig2

def test_signature_differs_with_different_secret():
    payload = {"event": "invoice.created", "id": "inv-123"}
    sig1 = sign_payload("secret_a", payload)
    sig2 = sign_payload("secret_b", payload)
    assert sig1 != sig2

def test_signature_differs_if_payload_tampered():
    """This is what actually makes webhook signing meaningful: if an attacker
    intercepts and modifies the payload in transit, the signature the receiver
    recomputes won't match — proving tampering happened."""
    original = {"event": "invoice.created", "amount": 5000}
    tampered = {"event": "invoice.created", "amount": 999999}

    sig_original = sign_payload("secret", original)
    sig_tampered = sign_payload("secret", tampered)
    assert sig_original != sig_tampered

def test_https_only_webhook_url_enforced(client, admin_token):
    res = client.post("/api/v1/platform/webhooks", json={
        "url": "http://insecure.example.com/hook", "events": ["invoice.created"],
    }, headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 422  # HTTP (not HTTPS) must be rejected

def test_invalid_webhook_event_rejected(client, admin_token):
    res = client.post("/api/v1/platform/webhooks", json={
        "url": "https://example.com/hook", "events": ["not_a_real_event"],
    }, headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 422

def test_create_valid_webhook_subscription(client, admin_token):
    res = client.post("/api/v1/platform/webhooks", json={
        "url": "https://example.com/hook", "events": ["invoice.created", "invoice.paid"],
        "description": "my integration",
    }, headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 200
    assert set(res.json()["events"]) == {"invoice.created", "invoice.paid"}


# ── Integration Adapters — honest mock/stub behavior ────────────
def test_mock_bank_adapter_requires_account_number():
    adapter = MockBankAdapter()
    assert adapter.test_connection({"account_number": "123-4-56789-0"}) is True
    assert adapter.test_connection({}) is False

def test_mock_bank_adapter_sync_returns_labeled_placeholder():
    adapter = MockBankAdapter()
    result = adapter.sync({"account_number": "123-4-56789-0"})
    assert result["records_synced"] == 0
    assert "Mock" in result["message"]  # must be honestly labeled, not disguised as a real sync

def test_unimplemented_adapter_raises_clearly():
    adapter = NotYetImplementedAdapter("Test Provider")
    with pytest.raises(NotImplementedError, match="Test Provider"):
        adapter.test_connection({})

def test_connect_unimplemented_provider_records_error_not_fake_success(client, acc_token):
    """When connecting to a provider that isn't really wired up (e-Tax, Lazada,
    Shopee), the system must record a clear error status — never silently
    report a successful connection that doesn't actually exist."""
    res = client.post("/api/v1/platform/integrations/connect", json={
        "provider": "etax_rd", "config": {},
    }, headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "error"
    assert data["last_error"] is not None

def test_connect_mock_bank_adapter_succeeds_with_valid_config(client, acc_token):
    res = client.post("/api/v1/platform/integrations/connect", json={
        "provider": "bank_scb", "config": {"account_number": "999-8-77777-0"},
    }, headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    assert res.json()["status"] == "connected"

def test_sync_requires_connected_status(client, acc_token):
    connect_res = client.post("/api/v1/platform/integrations/connect", json={
        "provider": "bank_kbank", "config": {},  # missing account_number → connection fails
    }, headers={"Authorization": f"Bearer {acc_token}"})
    integration_id = connect_res.json()["id"]

    sync_res = client.post(f"/api/v1/platform/integrations/{integration_id}/sync",
                           headers={"Authorization": f"Bearer {acc_token}"})
    assert sync_res.status_code == 400
