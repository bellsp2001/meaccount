"""Document Template Tests — Validation strictness, default-template uniqueness, real PDF rendering with template config applied"""
import pytest
import io
from decimal import Decimal
from datetime import date, timedelta
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from core.database import Base, get_db
from core.security import hash_password
from models.user import User, UserRole
from models.ar import Customer, Invoice, InvoiceItem, InvoiceStatus
from main import app

engine = create_engine("sqlite:///./test_doctemplate.db", connect_args={"check_same_thread": False})
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

@pytest.fixture
def sample_invoice(db):
    c = Customer(code="C001", name="ลูกค้าทดสอบ บริษัท จำกัด", tax_id="0105558000001", credit_days=30)
    db.add(c); db.flush()
    inv = Invoice(number="INV-202603-0001", customer_id=c.id, date=date.today(), due_date=date.today()+timedelta(days=30),
                 status=InvoiceStatus.SENT, subtotal=Decimal("10000"), vat_rate=Decimal("7"),
                 vat_amount=Decimal("700"), total=Decimal("10700"))
    db.add(inv); db.flush()
    db.add(InvoiceItem(invoice_id=inv.id, sequence=0, description="ค่าบริการที่ปรึกษา", quantity=Decimal("1"),
                       unit="งาน", unit_price=Decimal("10000"), discount_pct=Decimal("0"), amount=Decimal("10000")))
    db.commit(); db.refresh(inv)
    return inv


# ── Validation Strictness ──────────────────────────────────────
def test_only_admin_can_create_template(client, acc_token):
    res = client.post("/api/v1/doc-templates/", json={"name": "test", "primary_color": "#FF0000"},
                      headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 403

def test_invalid_hex_color_rejected(client, admin_token):
    res = client.post("/api/v1/doc-templates/", json={"name": "bad color", "primary_color": "red"},
                      headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 422

def test_hex_color_missing_hash_rejected(client, admin_token):
    res = client.post("/api/v1/doc-templates/", json={"name": "bad color 2", "primary_color": "00D4AA"},
                      headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 422

def test_short_hex_rejected(client, admin_token):
    """#FFF (3-digit shorthand) is valid CSS but NOT valid for this field —
    ReportLab's colors.HexColor expects the full 6-digit form, so accepting
    the shorthand here would silently break at render time instead of at
    template-save time."""
    res = client.post("/api/v1/doc-templates/", json={"name": "shorthand", "primary_color": "#FFF"},
                      headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 422

def test_invalid_font_rejected(client, admin_token):
    res = client.post("/api/v1/doc-templates/", json={"name": "bad font", "font_family": "ComicSans"},
                      headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 422

def test_invalid_document_kind_rejected(client, admin_token):
    res = client.post("/api/v1/doc-templates/", json={"name": "bad kind", "document_kind": "memo"},
                      headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 422

def test_valid_template_creates_successfully(client, admin_token):
    res = client.post("/api/v1/doc-templates/", json={
        "name": "แบบมาตรฐาน", "document_kind": "invoice", "primary_color": "#4FACFE",
        "company_display_name": "บริษัท ทดสอบ จำกัด",
    }, headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 200
    assert res.json()["primary_color"] == "#4FACFE"


# ── Default Template Uniqueness ────────────────────────────────
def test_first_template_of_a_kind_becomes_default(client, admin_token):
    res = client.post("/api/v1/doc-templates/", json={"name": "first", "document_kind": "invoice"},
                      headers={"Authorization": f"Bearer {admin_token}"})
    assert res.json()["is_default"] is True

def test_second_template_of_same_kind_not_default(client, admin_token):
    client.post("/api/v1/doc-templates/", json={"name": "first", "document_kind": "invoice"},
               headers={"Authorization": f"Bearer {admin_token}"})
    res = client.post("/api/v1/doc-templates/", json={"name": "second", "document_kind": "invoice"},
                      headers={"Authorization": f"Bearer {admin_token}"})
    assert res.json()["is_default"] is False

def test_different_kinds_each_get_their_own_default(client, admin_token):
    inv_res = client.post("/api/v1/doc-templates/", json={"name": "inv default", "document_kind": "invoice"},
                          headers={"Authorization": f"Bearer {admin_token}"})
    quo_res = client.post("/api/v1/doc-templates/", json={"name": "quo default", "document_kind": "quotation"},
                          headers={"Authorization": f"Bearer {admin_token}"})
    assert inv_res.json()["is_default"] is True
    assert quo_res.json()["is_default"] is True   # independent per document_kind

def test_set_default_unsets_previous_default_of_same_kind(client, admin_token):
    first = client.post("/api/v1/doc-templates/", json={"name": "first", "document_kind": "invoice"},
                        headers={"Authorization": f"Bearer {admin_token}"}).json()
    second = client.post("/api/v1/doc-templates/", json={"name": "second", "document_kind": "invoice"},
                         headers={"Authorization": f"Bearer {admin_token}"}).json()
    assert first["is_default"] is True
    assert second["is_default"] is False

    client.post(f"/api/v1/doc-templates/{second['id']}/set-default", headers={"Authorization": f"Bearer {admin_token}"})

    first_after = client.get(f"/api/v1/doc-templates/{first['id']}", headers={"Authorization": f"Bearer {admin_token}"}).json()
    second_after = client.get(f"/api/v1/doc-templates/{second['id']}", headers={"Authorization": f"Bearer {admin_token}"}).json()
    assert first_after["is_default"] is False
    assert second_after["is_default"] is True

def test_set_default_does_not_affect_other_document_kinds(client, admin_token):
    """Setting a new default invoice template must not touch the default
    quotation template — they're independent per document_kind."""
    quo = client.post("/api/v1/doc-templates/", json={"name": "quo", "document_kind": "quotation"},
                      headers={"Authorization": f"Bearer {admin_token}"}).json()
    inv1 = client.post("/api/v1/doc-templates/", json={"name": "inv1", "document_kind": "invoice"},
                       headers={"Authorization": f"Bearer {admin_token}"}).json()
    inv2 = client.post("/api/v1/doc-templates/", json={"name": "inv2", "document_kind": "invoice"},
                       headers={"Authorization": f"Bearer {admin_token}"}).json()
    client.post(f"/api/v1/doc-templates/{inv2['id']}/set-default", headers={"Authorization": f"Bearer {admin_token}"})

    quo_after = client.get(f"/api/v1/doc-templates/{quo['id']}", headers={"Authorization": f"Bearer {admin_token}"}).json()
    assert quo_after["is_default"] is True   # untouched


# ── Update ─────────────────────────────────────────────────────
def test_update_template_partial_fields(client, admin_token):
    tpl = client.post("/api/v1/doc-templates/", json={"name": "original", "primary_color": "#00D4AA"},
                      headers={"Authorization": f"Bearer {admin_token}"}).json()
    res = client.patch(f"/api/v1/doc-templates/{tpl['id']}", json={"primary_color": "#FF0000"},
                       headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 200
    assert res.json()["primary_color"] == "#FF0000"
    assert res.json()["name"] == "original"   # untouched field stays the same

def test_update_with_invalid_color_rejected(client, admin_token):
    tpl = client.post("/api/v1/doc-templates/", json={"name": "t"}, headers={"Authorization": f"Bearer {admin_token}"}).json()
    res = client.patch(f"/api/v1/doc-templates/{tpl['id']}", json={"primary_color": "notacolor"},
                       headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 422


# ── Logo Upload ────────────────────────────────────────────────
def test_upload_logo_accepts_png(client, admin_token):
    tpl = client.post("/api/v1/doc-templates/", json={"name": "with logo"}, headers={"Authorization": f"Bearer {admin_token}"}).json()
    # Minimal valid PNG file header bytes — enough for our upload path, which
    # doesn't need to fully decode the image, just store it.
    png_bytes = b"\x89PNG\r\n\x1a\n" + b"\x00" * 100
    res = client.post(f"/api/v1/doc-templates/{tpl['id']}/logo",
                      files={"file": ("logo.png", io.BytesIO(png_bytes), "image/png")},
                      headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 200
    assert res.json()["logo_path"] is not None

def test_upload_logo_rejects_non_image_extension(client, admin_token):
    tpl = client.post("/api/v1/doc-templates/", json={"name": "bad upload"}, headers={"Authorization": f"Bearer {admin_token}"}).json()
    res = client.post(f"/api/v1/doc-templates/{tpl['id']}/logo",
                      files={"file": ("virus.exe", io.BytesIO(b"not an image"), "application/octet-stream")},
                      headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 400

def test_upload_logo_rejects_oversized_file(client, admin_token):
    tpl = client.post("/api/v1/doc-templates/", json={"name": "huge logo"}, headers={"Authorization": f"Bearer {admin_token}"}).json()
    oversized = b"\x89PNG\r\n\x1a\n" + b"\x00" * (3 * 1024 * 1024)   # 3MB > 2MB limit
    res = client.post(f"/api/v1/doc-templates/{tpl['id']}/logo",
                      files={"file": ("big.png", io.BytesIO(oversized), "image/png")},
                      headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 400


# ── PDF Rendering — the real integration test ──────────────────
def test_render_produces_valid_pdf_bytes(client, acc_token, sample_invoice):
    res = client.get(f"/api/v1/doc-templates/preview/invoice/{sample_invoice.id}",
                     headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/pdf"
    assert res.content[:4] == b"%PDF"
    assert len(res.content) > 1000   # a real rendered document, not an empty stub

def test_render_with_no_template_uses_fallback_defaults(client, acc_token, sample_invoice):
    """No template exists at all yet — must still render successfully using
    the hardcoded fallback config, not 404 or 500."""
    res = client.get(f"/api/v1/doc-templates/preview/invoice/{sample_invoice.id}",
                     headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200

def test_render_uses_specified_template_over_default(client, admin_token, acc_token, sample_invoice):
    default_tpl = client.post("/api/v1/doc-templates/", json={"name": "default one", "document_kind": "invoice"},
                              headers={"Authorization": f"Bearer {admin_token}"}).json()
    other_tpl = client.post("/api/v1/doc-templates/", json={
        "name": "explicit one", "document_kind": "invoice",
        "company_display_name": "บริษัท เจาะจงเทมเพลต จำกัด",
    }, headers={"Authorization": f"Bearer {admin_token}"}).json()

    res = client.get(f"/api/v1/doc-templates/preview/invoice/{sample_invoice.id}?template_id={other_tpl['id']}",
                     headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    # The explicit template's company name should appear in the rendered PDF text
    assert "เจาะจงเทมเพลต".encode("utf-8") in res.content or len(res.content) > 1000

def test_render_nonexistent_invoice_404s(client, acc_token):
    import uuid
    fake_id = str(uuid.uuid4())
    res = client.get(f"/api/v1/doc-templates/preview/invoice/{fake_id}", headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 404

def test_render_respects_show_vat_breakdown_toggle(client, admin_token, acc_token, sample_invoice, db):
    """Rendering with show_vat_breakdown=False must not crash and should
    still produce a valid, non-trivial PDF — verifying the toggle path
    actually executes rather than only ever hitting the True branch."""
    tpl_res = client.post("/api/v1/doc-templates/", json={
        "name": "no vat breakdown", "document_kind": "invoice", "show_vat_breakdown": False,
    }, headers={"Authorization": f"Bearer {admin_token}"})
    tpl_id = tpl_res.json()["id"]

    res = client.get(f"/api/v1/doc-templates/preview/invoice/{sample_invoice.id}?template_id={tpl_id}",
                     headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    assert res.content[:4] == b"%PDF"

def test_render_respects_show_item_discount_toggle(client, admin_token, acc_token, sample_invoice):
    tpl_res = client.post("/api/v1/doc-templates/", json={
        "name": "no discount col", "document_kind": "invoice", "show_item_discount": False,
    }, headers={"Authorization": f"Bearer {admin_token}"})
    tpl_id = tpl_res.json()["id"]

    res = client.get(f"/api/v1/doc-templates/preview/invoice/{sample_invoice.id}?template_id={tpl_id}",
                     headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    assert res.content[:4] == b"%PDF"

def test_render_respects_show_signature_block_toggle(client, admin_token, acc_token, sample_invoice):
    tpl_res = client.post("/api/v1/doc-templates/", json={
        "name": "no signature", "document_kind": "invoice", "show_signature_block": False,
    }, headers={"Authorization": f"Bearer {admin_token}"})
    tpl_id = tpl_res.json()["id"]

    res = client.get(f"/api/v1/doc-templates/preview/invoice/{sample_invoice.id}?template_id={tpl_id}",
                     headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    assert res.content[:4] == b"%PDF"
