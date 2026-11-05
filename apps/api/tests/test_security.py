"""Security & Compliance Tests — Encryption correctness, DSR data-collection, compliance scanner honesty"""
import pytest
from datetime import date, datetime, timedelta
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from core.database import Base, get_db
from core.security import hash_password
from models.user import User, UserRole
from models.payroll import Employee, MaritalStatus
from models.security import DataSubjectRequest, DSRStatus
from main import app
from core.encryption import encrypt_field, decrypt_field, mask_for_display
from services.pii_encryption import migrate_encrypt_existing_national_ids

engine = create_engine("sqlite:///./test_security.db", connect_args={"check_same_thread": False})
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


# ── Encryption Correctness (real cryptography, verified) ────────
def test_encrypt_decrypt_round_trip():
    plaintext = "1-2345-67890-12-3"
    encrypted = encrypt_field(plaintext)
    assert encrypted != plaintext   # must not be a no-op
    assert decrypt_field(encrypted) == plaintext

def test_encrypted_value_does_not_contain_plaintext():
    """The core security property: ciphertext must not leak the plaintext as
    a substring, unlike e.g. naive base64 'obfuscation'."""
    plaintext = "SENSITIVE_NATIONAL_ID_1234567890123"
    encrypted = encrypt_field(plaintext)
    assert plaintext not in encrypted

def test_same_plaintext_encrypts_differently_each_time():
    """Fernet includes a random IV per encryption — two encryptions of the
    same value should NOT produce identical ciphertext (that would leak
    which records share a value just by comparing ciphertexts)."""
    plaintext = "1234567890123"
    enc1 = encrypt_field(plaintext)
    enc2 = encrypt_field(plaintext)
    assert enc1 != enc2
    # but both must still decrypt back to the same original value
    assert decrypt_field(enc1) == decrypt_field(enc2) == plaintext

def test_decrypt_tampered_ciphertext_raises_clear_error():
    encrypted = encrypt_field("some value")
    tampered = encrypted[:-5] + "XXXXX"
    with pytest.raises(ValueError):
        decrypt_field(tampered)

def test_encrypt_none_stays_none():
    assert encrypt_field(None) is None
    assert decrypt_field(None) is None

def test_mask_for_display_hides_all_but_last_chars():
    masked = mask_for_display("1234567890123", visible_chars=4)
    assert masked == "*********0123"
    assert masked.endswith("0123")

def test_mask_shorter_than_visible_chars_fully_masked():
    masked = mask_for_display("12", visible_chars=4)
    assert masked == "**"


# ── PII Migration Helper ─────────────────────────────────────
def test_migrate_dry_run_does_not_modify_data(db):
    emp = Employee(employee_code="E001", full_name="Test", national_id="1234567890123",
                   start_date=date.today(), base_salary=30000)
    db.add(emp); db.commit()

    result = migrate_encrypt_existing_national_ids(db, dry_run=True)
    assert result["dry_run"] is True
    assert result["candidates_needing_encryption"] == 1

    db.refresh(emp)
    assert emp.national_id == "1234567890123"   # unchanged — dry run must not write

def test_migrate_actually_encrypts_when_not_dry_run(db):
    emp = Employee(employee_code="E002", full_name="Test2", national_id="9876543210123",
                   start_date=date.today(), base_salary=30000)
    db.add(emp); db.commit()

    migrate_encrypt_existing_national_ids(db, dry_run=False)

    db.refresh(emp)
    assert emp.national_id != "9876543210123"   # now encrypted
    assert decrypt_field(emp.national_id) == "9876543210123"   # but recoverable


# ── Consent Tracking ────────────────────────────────────────
def test_record_and_check_consent(client, acc_token, db):
    emp = Employee(employee_code="E003", full_name="Test3", start_date=date.today(), base_salary=30000)
    db.add(emp); db.commit()

    res = client.post("/api/v1/security/consent", json={
        "subject_type": "employee", "subject_id": str(emp.id),
        "consent_type": "data_processing", "granted": True,
    }, headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    assert res.json()["granted"] is True

def test_withdraw_consent(client, acc_token, db):
    emp = Employee(employee_code="E004", full_name="Test4", start_date=date.today(), base_salary=30000)
    db.add(emp); db.commit()

    consent_res = client.post("/api/v1/security/consent", json={
        "subject_type": "employee", "subject_id": str(emp.id),
        "consent_type": "marketing", "granted": True,
    }, headers={"Authorization": f"Bearer {acc_token}"})
    consent_id = consent_res.json()["id"]

    res = client.post(f"/api/v1/security/consent/{consent_id}/withdraw",
                      headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    assert res.json()["withdrawn_at"] is not None


# ── Data Subject Requests (the actual PDPA rights mechanism) ────
def test_create_dsr(client, acc_token, db):
    emp = Employee(employee_code="E005", full_name="Test5", start_date=date.today(), base_salary=30000)
    db.add(emp); db.commit()

    res = client.post("/api/v1/security/dsr", json={
        "subject_type": "employee", "subject_id": str(emp.id), "request_type": "access",
    }, headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    assert res.json()["status"] == "pending"

def test_process_access_dsr_returns_actual_data(client, admin_token, acc_token, db):
    emp = Employee(employee_code="E006", full_name="สมชาย ทดสอบ", start_date=date.today(), base_salary=35000)
    db.add(emp); db.commit()

    dsr_res = client.post("/api/v1/security/dsr", json={
        "subject_type": "employee", "subject_id": str(emp.id), "request_type": "access",
    }, headers={"Authorization": f"Bearer {acc_token}"})
    dsr_id = dsr_res.json()["id"]

    res = client.post(f"/api/v1/security/dsr/{dsr_id}/process", json={"approve": True},
                      headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 200
    assert res.json()["status"] == "completed"

    # Verify the DSR actually captured real data about this specific employee
    dsr = db.query(DataSubjectRequest).filter(DataSubjectRequest.id == dsr_id).first()
    assert dsr.result_data["full_name"] == "สมชาย ทดสอบ"
    assert dsr.result_data["employee_code"] == "E006"

def test_process_delete_dsr_soft_deletes_record(client, admin_token, acc_token, db):
    emp = Employee(employee_code="E007", full_name="ลบทดสอบ", start_date=date.today(), base_salary=30000)
    db.add(emp); db.commit()
    emp_id = emp.id

    dsr_res = client.post("/api/v1/security/dsr", json={
        "subject_type": "employee", "subject_id": str(emp_id), "request_type": "delete",
    }, headers={"Authorization": f"Bearer {acc_token}"})
    dsr_id = dsr_res.json()["id"]

    client.post(f"/api/v1/security/dsr/{dsr_id}/process", json={"approve": True},
               headers={"Authorization": f"Bearer {admin_token}"})

    db.expire_all()
    emp_after = db.query(Employee).filter(Employee.id == emp_id).first()
    assert emp_after.is_deleted is True

def test_reject_dsr_requires_no_data_collection(client, admin_token, acc_token, db):
    emp = Employee(employee_code="E008", full_name="ปฏิเสธทดสอบ", start_date=date.today(), base_salary=30000)
    db.add(emp); db.commit()

    dsr_res = client.post("/api/v1/security/dsr", json={
        "subject_type": "employee", "subject_id": str(emp.id), "request_type": "access",
    }, headers={"Authorization": f"Bearer {acc_token}"})
    dsr_id = dsr_res.json()["id"]

    res = client.post(f"/api/v1/security/dsr/{dsr_id}/process",
                      json={"approve": False, "rejection_reason": "ไม่สามารถยืนยันตัวตนได้"},
                      headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 200
    assert res.json()["status"] == "rejected"
    assert res.json()["rejection_reason"] == "ไม่สามารถยืนยันตัวตนได้"

def test_cannot_process_already_processed_dsr(client, admin_token, acc_token, db):
    emp = Employee(employee_code="E009", full_name="ซ้ำทดสอบ", start_date=date.today(), base_salary=30000)
    db.add(emp); db.commit()

    dsr_res = client.post("/api/v1/security/dsr", json={
        "subject_type": "employee", "subject_id": str(emp.id), "request_type": "access",
    }, headers={"Authorization": f"Bearer {acc_token}"})
    dsr_id = dsr_res.json()["id"]
    client.post(f"/api/v1/security/dsr/{dsr_id}/process", json={"approve": True},
               headers={"Authorization": f"Bearer {admin_token}"})

    res = client.post(f"/api/v1/security/dsr/{dsr_id}/process", json={"approve": True},
                      headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 400

def test_only_admin_can_process_dsr(client, acc_token, db):
    emp = Employee(employee_code="E010", full_name="Test", start_date=date.today(), base_salary=30000)
    db.add(emp); db.commit()
    dsr_res = client.post("/api/v1/security/dsr", json={
        "subject_type": "employee", "subject_id": str(emp.id), "request_type": "access",
    }, headers={"Authorization": f"Bearer {acc_token}"})
    dsr_id = dsr_res.json()["id"]

    res = client.post(f"/api/v1/security/dsr/{dsr_id}/process", json={"approve": True},
                      headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 403


# ── Compliance Scanner — honesty properties ──────────────────
def test_compliance_scan_only_admin(client, acc_token):
    res = client.get("/api/v1/security/compliance-scan", headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 403

def test_compliance_scan_distinguishes_automated_from_manual(client, admin_token):
    """The core honesty property of this scanner: it must clearly separate
    what it actually verified in code from what requires human/legal review —
    never silently claim a manual/process item passed."""
    res = client.get("/api/v1/security/compliance-scan", headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 200
    data = res.json()

    manual_controls = [c for c in data["controls"] if not c["is_automated"]]
    automated_controls = [c for c in data["controls"] if c["is_automated"]]

    assert len(manual_controls) > 0   # must have manual items, not pretend everything's automatable
    assert len(automated_controls) > 0
    # No manual-review item should ever be marked "pass" — that would be
    # falsely claiming to have verified something outside the code's reach
    assert all(c["status"] == "manual_review_required" for c in manual_controls)

def test_compliance_scan_flags_missing_encryption_key(client, admin_token):
    res = client.get("/api/v1/security/compliance-scan", headers={"Authorization": f"Bearer {admin_token}"})
    data = res.json()
    enc_control = next(c for c in data["controls"] if c["control_id"] == "ENC-01")
    # In the test environment FIELD_ENCRYPTION_KEY is not set, so this must fail, not silently pass
    assert enc_control["status"] == "fail"

def test_compliance_scan_flags_stale_dsr_requests(client, admin_token, acc_token, db):
    emp = Employee(employee_code="E011", full_name="Stale Test", start_date=date.today(), base_salary=30000)
    db.add(emp); db.commit()

    old_dsr = DataSubjectRequest(
        subject_type="employee", subject_id=emp.id, request_type="access",
        status=DSRStatus.PENDING.value,
    )
    db.add(old_dsr); db.commit()
    # backdate it past the 30-day threshold
    db.query(DataSubjectRequest).filter(DataSubjectRequest.id == old_dsr.id).update(
        {DataSubjectRequest.created_at: datetime.utcnow() - timedelta(days=45)}
    )
    db.commit()

    res = client.get("/api/v1/security/compliance-scan", headers={"Authorization": f"Bearer {admin_token}"})
    data = res.json()
    dsr_control = next(c for c in data["controls"] if c["control_id"] == "PDPA-03")
    assert dsr_control["status"] == "fail"
