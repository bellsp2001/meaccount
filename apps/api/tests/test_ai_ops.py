"""AI Ops Tests — Prompt profile prompt assembly, feedback aggregation, A/B split statistical correctness"""
import pytest
from collections import Counter
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from core.database import Base, get_db
from core.security import hash_password
from models.user import User, UserRole
from models.ai_ops import PromptProfile, FewShotExample, ABTest
from main import app
from services.ai_ops import build_effective_system_prompt, assign_traffic, get_ab_test_results

engine = create_engine("sqlite:///./test_ai_ops.db", connect_args={"check_same_thread": False})
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


# ── Prompt Profile Assembly (the actual mechanism, verified) ────
def test_build_prompt_includes_industry_instructions():
    profile = PromptProfile(name="Retail", industry="retail", system_prompt="เชี่ยวชาญธุรกิจค้าปลีก")
    result = build_effective_system_prompt(profile)
    assert "เชี่ยวชาญธุรกิจค้าปลีก" in result

def test_build_prompt_merges_base_and_profile():
    profile = PromptProfile(name="Retail", industry="retail", system_prompt="profile-specific instructions")
    result = build_effective_system_prompt(profile, base_system_prompt="base assistant instructions")
    assert "base assistant instructions" in result
    assert "profile-specific instructions" in result

def test_build_prompt_includes_few_shot_examples():
    profile = PromptProfile(name="Retail", industry="retail", system_prompt="base")
    profile.examples = [
        FewShotExample(question="สินค้าคงคลังคำนวณยังไง", answer="ใช้ FIFO หรือ AVCO"),
    ]
    result = build_effective_system_prompt(profile)
    assert "สินค้าคงคลังคำนวณยังไง" in result
    assert "ใช้ FIFO หรือ AVCO" in result

def test_build_prompt_no_examples_still_works():
    profile = PromptProfile(name="Empty", industry="general", system_prompt="just the base")
    profile.examples = []
    result = build_effective_system_prompt(profile)
    assert result == "just the base"


# ── Prompt Profile API ─────────────────────────────────────────
def test_only_admin_can_create_profile(client, acc_token):
    res = client.post("/api/v1/ai-ops/profiles", json={
        "name": "test", "industry": "general", "system_prompt": "test prompt",
    }, headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 403

def test_create_profile_with_examples(client, admin_token):
    res = client.post("/api/v1/ai-ops/profiles", json={
        "name": "ร้านค้าปลีก", "industry": "retail", "system_prompt": "เชี่ยวชาญบัญชีค้าปลีก",
        "examples": [{"question": "Q1", "answer": "A1"}, {"question": "Q2", "answer": "A2"}],
    }, headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 200
    assert len(res.json()["examples"]) == 2

def test_invalid_industry_rejected(client, admin_token):
    res = client.post("/api/v1/ai-ops/profiles", json={
        "name": "bad", "industry": "not_a_real_industry", "system_prompt": "test",
    }, headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 422

def test_filter_profiles_by_industry(client, admin_token):
    client.post("/api/v1/ai-ops/profiles", json={"name": "Retail1", "industry": "retail", "system_prompt": "x"},
               headers={"Authorization": f"Bearer {admin_token}"})
    client.post("/api/v1/ai-ops/profiles", json={"name": "Service1", "industry": "service", "system_prompt": "x"},
               headers={"Authorization": f"Bearer {admin_token}"})

    res = client.get("/api/v1/ai-ops/profiles?industry=retail", headers={"Authorization": f"Bearer {admin_token}"})
    assert all(p["industry"] == "retail" for p in res.json())


# ── Feedback ───────────────────────────────────────────────────
def test_submit_feedback(client, acc_token):
    res = client.post("/api/v1/ai-ops/feedback", json={
        "question": "VAT เท่าไหร่", "answer": "7%", "rating": "helpful",
    }, headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    assert res.json()["rating"] == "helpful"

def test_invalid_rating_rejected(client, acc_token):
    res = client.post("/api/v1/ai-ops/feedback", json={
        "question": "q", "answer": "a", "rating": "sort_of_okay",
    }, headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 422

def test_feedback_stats_calculation_correct(client, admin_token, acc_token):
    profile_res = client.post("/api/v1/ai-ops/profiles", json={"name": "P1", "industry": "general", "system_prompt": "x"},
                              headers={"Authorization": f"Bearer {admin_token}"})
    profile_id = profile_res.json()["id"]

    # 3 helpful, 1 not helpful → 75% helpful rate
    for _ in range(3):
        client.post("/api/v1/ai-ops/feedback", json={"profile_id": profile_id, "question": "q", "answer": "a", "rating": "helpful"},
                   headers={"Authorization": f"Bearer {acc_token}"})
    client.post("/api/v1/ai-ops/feedback", json={"profile_id": profile_id, "question": "q", "answer": "a", "rating": "not_helpful"},
               headers={"Authorization": f"Bearer {acc_token}"})

    res = client.get(f"/api/v1/ai-ops/feedback/stats?profile_id={profile_id}", headers={"Authorization": f"Bearer {acc_token}"})
    data = res.json()
    assert data["total_feedback"] == 4
    assert data["helpful_count"] == 3
    assert data["helpful_rate_pct"] == 75.0

def test_feedback_stats_no_data_returns_none_rate(client, admin_token, acc_token):
    profile_res = client.post("/api/v1/ai-ops/profiles", json={"name": "Empty", "industry": "general", "system_prompt": "x"},
                              headers={"Authorization": f"Bearer {admin_token}"})
    profile_id = profile_res.json()["id"]
    res = client.get(f"/api/v1/ai-ops/feedback/stats?profile_id={profile_id}", headers={"Authorization": f"Bearer {acc_token}"})
    assert res.json()["helpful_rate_pct"] is None  # must not divide by zero


# ── A/B Testing — statistical correctness (the real risk in this sprint) ──
def test_reject_ab_test_with_same_profile_twice(client, admin_token):
    p = client.post("/api/v1/ai-ops/profiles", json={"name": "Same", "industry": "general", "system_prompt": "x"},
                    headers={"Authorization": f"Bearer {admin_token}"}).json()
    res = client.post("/api/v1/ai-ops/ab-tests", json={
        "name": "invalid test", "profile_a_id": p["id"], "profile_b_id": p["id"], "traffic_split_pct": 50,
    }, headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 422

def test_reject_invalid_traffic_split(client, admin_token):
    pa = client.post("/api/v1/ai-ops/profiles", json={"name": "A", "industry": "general", "system_prompt": "x"},
                     headers={"Authorization": f"Bearer {admin_token}"}).json()
    pb = client.post("/api/v1/ai-ops/profiles", json={"name": "B", "industry": "general", "system_prompt": "x"},
                     headers={"Authorization": f"Bearer {admin_token}"}).json()
    res = client.post("/api/v1/ai-ops/ab-tests", json={
        "name": "bad split", "profile_a_id": pa["id"], "profile_b_id": pb["id"], "traffic_split_pct": 150,
    }, headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 422

def test_traffic_split_converges_to_configured_ratio(db):
    """
    The core statistical correctness check: with a 30% split to arm B and
    2000 simulated assignments, the actual B-rate should land close to 30%
    (allowing real sampling variance) rather than being systematically wrong
    — e.g. always 50/50 regardless of config, or inverted.
    """
    profile_a = PromptProfile(name="A", industry="general", system_prompt="a")
    profile_b = PromptProfile(name="B", industry="general", system_prompt="b")
    db.add_all([profile_a, profile_b]); db.flush()

    test = ABTest(name="split test", profile_a_id=profile_a.id, profile_b_id=profile_b.id, traffic_split_pct=30)
    db.add(test); db.commit(); db.refresh(test)

    arms = []
    for _ in range(2000):
        arm, _ = assign_traffic(db, test.id)
        arms.append(arm)

    b_rate = arms.count("B") / len(arms)
    assert 0.25 <= b_rate <= 0.35, f"Expected ~30% B assignments, got {b_rate:.1%}"

def test_traffic_split_zero_percent_never_assigns_b(db):
    profile_a = PromptProfile(name="A", industry="general", system_prompt="a")
    profile_b = PromptProfile(name="B", industry="general", system_prompt="b")
    db.add_all([profile_a, profile_b]); db.flush()

    test = ABTest(name="all A", profile_a_id=profile_a.id, profile_b_id=profile_b.id, traffic_split_pct=0)
    db.add(test); db.commit(); db.refresh(test)

    arms = [assign_traffic(db, test.id)[0] for _ in range(200)]
    assert arms.count("B") == 0

def test_traffic_split_hundred_percent_always_assigns_b(db):
    profile_a = PromptProfile(name="A", industry="general", system_prompt="a")
    profile_b = PromptProfile(name="B", industry="general", system_prompt="b")
    db.add_all([profile_a, profile_b]); db.flush()

    test = ABTest(name="all B", profile_a_id=profile_a.id, profile_b_id=profile_b.id, traffic_split_pct=100)
    db.add(test); db.commit(); db.refresh(test)

    arms = [assign_traffic(db, test.id)[0] for _ in range(200)]
    assert arms.count("A") == 0

def test_ab_test_results_inconclusive_below_minimum_sample(client, admin_token, acc_token):
    pa = client.post("/api/v1/ai-ops/profiles", json={"name": "A", "industry": "general", "system_prompt": "x"},
                     headers={"Authorization": f"Bearer {admin_token}"}).json()
    pb = client.post("/api/v1/ai-ops/profiles", json={"name": "B", "industry": "general", "system_prompt": "x"},
                     headers={"Authorization": f"Bearer {admin_token}"}).json()
    test_res = client.post("/api/v1/ai-ops/ab-tests", json={
        "name": "small sample", "profile_a_id": pa["id"], "profile_b_id": pb["id"], "traffic_split_pct": 50,
    }, headers={"Authorization": f"Bearer {admin_token}"})
    ab_test_id = test_res.json()["id"]

    # Only 2 feedback entries per arm — must not declare a winner off this little data
    for _ in range(2):
        client.post("/api/v1/ai-ops/feedback", json={"profile_id": pa["id"], "question": "q", "answer": "a", "rating": "helpful"},
                   headers={"Authorization": f"Bearer {acc_token}"})
        client.post("/api/v1/ai-ops/feedback", json={"profile_id": pb["id"], "question": "q", "answer": "a", "rating": "not_helpful"},
                   headers={"Authorization": f"Bearer {acc_token}"})

    res = client.get(f"/api/v1/ai-ops/ab-tests/{ab_test_id}/results", headers={"Authorization": f"Bearer {acc_token}"})
    assert res.json()["leading_arm"] is None

def test_ab_test_results_declares_winner_with_sufficient_data_and_gap(client, admin_token, acc_token):
    pa = client.post("/api/v1/ai-ops/profiles", json={"name": "Winner", "industry": "general", "system_prompt": "x"},
                     headers={"Authorization": f"Bearer {admin_token}"}).json()
    pb = client.post("/api/v1/ai-ops/profiles", json={"name": "Loser", "industry": "general", "system_prompt": "x"},
                     headers={"Authorization": f"Bearer {admin_token}"}).json()
    test_res = client.post("/api/v1/ai-ops/ab-tests", json={
        "name": "clear winner", "profile_a_id": pa["id"], "profile_b_id": pb["id"], "traffic_split_pct": 50,
    }, headers={"Authorization": f"Bearer {admin_token}"})
    ab_test_id = test_res.json()["id"]

    for _ in range(15):  # 15/15 helpful = 100%
        client.post("/api/v1/ai-ops/feedback", json={"profile_id": pa["id"], "question": "q", "answer": "a", "rating": "helpful"},
                   headers={"Authorization": f"Bearer {acc_token}"})
    for _ in range(15):  # 0/15 helpful = 0%
        client.post("/api/v1/ai-ops/feedback", json={"profile_id": pb["id"], "question": "q", "answer": "a", "rating": "not_helpful"},
                   headers={"Authorization": f"Bearer {acc_token}"})

    res = client.get(f"/api/v1/ai-ops/ab-tests/{ab_test_id}/results", headers={"Authorization": f"Bearer {acc_token}"})
    assert res.json()["leading_arm"] == "A"
