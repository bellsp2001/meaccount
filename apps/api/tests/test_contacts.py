"""
Contact Tests — one partner record with customer/supplier roles, kept in step with the role rows.
"""
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from core.database import Base, get_db
from core.security import hash_password
from models.user import User, UserRole
from models.ar import Customer
from models.ap import Supplier
from services.contacts import backfill_contacts
from main import app

engine = create_engine("sqlite:///./test_contacts.db", connect_args={"check_same_thread": False})
TestDB = sessionmaker(autocommit=False, autoflush=False, bind=engine)

TAX = "0105555000001"


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
def h(client, db):
    db.add(User(email="acc@test.com", full_name="Acc", hashed_password=hash_password("Test@1234"),
                role=UserRole.ACCOUNTANT, is_active=True))
    db.commit()
    tok = client.post("/api/v1/auth/login", json={"email": "acc@test.com", "password": "Test@1234"}).json()["access_token"]
    return {"Authorization": f"Bearer {tok}"}


def _create(client, h, **body):
    return client.post("/api/v1/contacts/", json=body, headers=h)


def test_create_contact_with_both_roles(client, h):
    res = _create(client, h, name="บริษัท ก", tax_id=TAX, customer={"credit_days": 45}, supplier={"payment_terms": 15})
    assert res.status_code == 200, res.text
    c = res.json()
    assert c["code"] == "CT0001" and c["roles"] == ["customer", "supplier"]
    assert c["customer"]["code"] == "C0001" and c["customer"]["credit_days"] == 45
    assert c["supplier"]["code"] == "S0001" and c["supplier"]["payment_terms"] == 15

    # The role rows are what documents use, and they carry the shared fields.
    cust = client.get("/api/v1/ar/customers", headers=h).json()[0]
    sup = client.get("/api/v1/ap/suppliers", headers=h).json()[0]
    assert cust["name"] == sup["name"] == "บริษัท ก" and cust["tax_id"] == sup["tax_id"] == TAX


def test_contact_needs_a_role(client, h):
    assert _create(client, h, name="ไม่มีบทบาท").status_code == 400


def test_duplicate_tax_id_and_branch_rejected(client, h):
    _create(client, h, name="บริษัท ก", tax_id=TAX, customer={})
    assert _create(client, h, name="บริษัท ก (ซ้ำ)", tax_id=TAX, supplier={}).status_code == 400
    # Another branch of the same company is a separate contact.
    assert _create(client, h, name="บริษัท ก สาขา 1", tax_id=TAX, branch_code="00001", supplier={}).status_code == 200

    dup = client.get("/api/v1/contacts/check-duplicate", params={"tax_id": TAX}, headers=h).json()
    assert dup["duplicate"] is True and dup["contact"]["name"] == "บริษัท ก"


def test_editing_contact_updates_both_roles(client, h):
    c = _create(client, h, name="บริษัท ก", tax_id=TAX, customer={}, supplier={}).json()
    res = client.patch(f"/api/v1/contacts/{c['id']}", json={"name": "บริษัท ก จำกัด", "address": "กรุงเทพฯ"}, headers=h)
    assert res.status_code == 200
    cust = client.get("/api/v1/ar/customers", headers=h).json()[0]
    sup = client.get("/api/v1/ap/suppliers", headers=h).json()[0]
    assert cust["name"] == sup["name"] == "บริษัท ก จำกัด" and sup["address"] == "กรุงเทพฯ"


def test_editing_role_directly_flows_to_contact_and_other_role(client, h):
    c = _create(client, h, name="บริษัท ก", customer={}, supplier={}).json()
    client.patch(f"/api/v1/ar/customers/{c['customer']['id']}", json={"phone": "021234567"}, headers=h)
    assert client.get(f"/api/v1/contacts/{c['id']}", headers=h).json()["phone"] == "021234567"
    assert client.get("/api/v1/ap/suppliers", headers=h).json()[0]["phone"] == "021234567"


def test_add_and_remove_roles(client, h):
    c = _create(client, h, name="บริษัท ก", customer={}).json()
    c = client.patch(f"/api/v1/contacts/{c['id']}", json={"supplier": {"payment_terms": 7}}, headers=h).json()
    assert c["roles"] == ["customer", "supplier"]

    customer_id = c["customer"]["id"]
    c = client.patch(f"/api/v1/contacts/{c['id']}", json={"remove_customer": True}, headers=h).json()
    assert c["roles"] == ["supplier"]
    # A removed role drops out of the document pickers.
    assert client.get("/api/v1/ar/customers", headers=h).json() == []
    # Re-adding the role reactivates the same customer row.
    c = client.patch(f"/api/v1/contacts/{c['id']}", json={"customer": {"credit_days": 60}}, headers=h).json()
    assert c["customer"]["id"] == customer_id and c["customer"]["credit_days"] == 60

    # The last role can't go while the contact is active.
    client.patch(f"/api/v1/contacts/{c['id']}", json={"remove_customer": True}, headers=h)
    assert client.patch(f"/api/v1/contacts/{c['id']}", json={"remove_supplier": True}, headers=h).status_code == 400


def test_role_filter(client, h):
    _create(client, h, name="ลูกค้าอย่างเดียว", customer={})
    _create(client, h, name="ผู้จำหน่ายอย่างเดียว", supplier={})
    _create(client, h, name="ทั้งสอง", customer={}, supplier={})
    names = lambda role: sorted(c["name"] for c in client.get("/api/v1/contacts/", params={"role": role}, headers=h).json())
    assert names("customer") == ["ทั้งสอง", "ลูกค้าอย่างเดียว"]
    assert names("supplier") == ["ทั้งสอง", "ผู้จำหน่ายอย่างเดียว"]
    assert len(client.get("/api/v1/contacts/", headers=h).json()) == 3


def test_old_endpoints_join_matching_contact(client, h):
    client.post("/api/v1/ar/customers", json={"code": "C001", "name": "บริษัท ก", "tax_id": TAX}, headers=h)
    client.post("/api/v1/ap/suppliers", json={"code": "S001", "name": "บริษัท ก (ฝ่ายจัดซื้อ)", "tax_id": TAX}, headers=h)
    contacts = client.get("/api/v1/contacts/", headers=h).json()
    assert len(contacts) == 1 and contacts[0]["roles"] == ["customer", "supplier"]
    # The supplier takes the contact's shared fields.
    assert client.get("/api/v1/ap/suppliers", headers=h).json()[0]["name"] == "บริษัท ก"


def test_backfill_links_existing_rows(db, client, h):
    # Rows inserted directly, as seed scripts do, with no contact.
    db.add_all([
        Customer(code="C1", name="บริษัท ก", tax_id=TAX, branch_code="00000"),
        Supplier(code="S1", name="บริษัท ก", tax_id=TAX, branch_code="00000"),
        Supplier(code="S2", name="ร้าน ข"),
        Customer(code="C2", name="ร้าน ข"),
        Customer(code="C3", name="ลูกค้า ค"),
    ])
    db.commit()
    assert backfill_contacts(db) == 5
    contacts = {c["name"]: c["roles"] for c in client.get("/api/v1/contacts/", headers=h).json()}
    assert contacts == {"บริษัท ก": ["customer", "supplier"], "ร้าน ข": ["customer", "supplier"], "ลูกค้า ค": ["customer"]}
    assert backfill_contacts(db) == 0


def test_groups_assign_filter_and_count(client, h):
    g = client.post("/api/v1/contact-groups/", json={"name": "ขายส่ง"}, headers=h).json()
    assert g["code"] == "G0001" and g["contact_count"] == 0
    other = client.post("/api/v1/contact-groups/", json={"code": "vip", "name": "VIP"}, headers=h).json()
    assert other["code"] == "VIP"
    assert client.post("/api/v1/contact-groups/", json={"code": "VIP", "name": "ซ้ำ"}, headers=h).status_code == 400

    a = _create(client, h, name="ร้าน ก", customer={}, group_id=g["id"]).json()
    _create(client, h, name="ร้าน ข", customer={})
    assert a["group"]["name"] == "ขายส่ง"
    in_group = client.get("/api/v1/contacts/", params={"group_id": g["id"]}, headers=h).json()
    assert [c["name"] for c in in_group] == ["ร้าน ก"]
    counts = {x["code"]: x["contact_count"] for x in client.get("/api/v1/contact-groups/", headers=h).json()}
    assert counts == {"G0001": 1, "VIP": 0}

    # Moving, then clearing with an explicit null; leaving group_id out keeps it.
    a = client.patch(f"/api/v1/contacts/{a['id']}", json={"group_id": other["id"]}, headers=h).json()
    assert a["group"]["code"] == "VIP"
    a = client.patch(f"/api/v1/contacts/{a['id']}", json={"phone": "02"}, headers=h).json()
    assert a["group"]["code"] == "VIP"
    a = client.patch(f"/api/v1/contacts/{a['id']}", json={"group_id": None}, headers=h).json()
    assert a["group"] is None and a["group_id"] is None


def test_group_in_use_cannot_be_deleted(client, h):
    g = client.post("/api/v1/contact-groups/", json={"name": "ขายปลีก"}, headers=h).json()
    c = _create(client, h, name="ร้าน ก", customer={}, group_id=g["id"]).json()
    assert client.delete(f"/api/v1/contact-groups/{g['id']}", headers=h).status_code == 400
    # Deactivating is allowed while in use.
    assert client.patch(f"/api/v1/contact-groups/{g['id']}", json={"is_active": False}, headers=h).json()["is_active"] is False

    client.patch(f"/api/v1/contacts/{c['id']}", json={"group_id": None}, headers=h)
    assert client.delete(f"/api/v1/contact-groups/{g['id']}", headers=h).status_code == 200
    assert client.get("/api/v1/contact-groups/", headers=h).json() == []
    assert _create(client, h, name="ร้าน ข", customer={}, group_id=g["id"]).status_code == 400


def test_open_balances(client, h, db):
    from models.accounting import Account, AccountTypeEnum, NormalBalance
    for code, t, nb in (("1201", AccountTypeEnum.ASSET, NormalBalance.DEBIT), ("4101", AccountTypeEnum.INCOME, NormalBalance.CREDIT),
                        ("2103", AccountTypeEnum.LIABILITY, NormalBalance.CREDIT)):
        db.add(Account(code=code, name=code, account_type=t, normal_balance=nb, level=3))
    db.commit()
    c = _create(client, h, name="บริษัท ก", customer={}, supplier={}).json()
    inv = client.post("/api/v1/ar/invoices", json={"customer_id": c["customer"]["id"], "date": "2025-03-01", "vat_rate": 7,
                      "items": [{"description": "x", "quantity": 1, "unit_price": 1000}]}, headers=h).json()
    client.post(f"/api/v1/ar/invoices/{inv['id']}/post-gl", headers=h)
    got = client.get(f"/api/v1/contacts/{c['id']}", headers=h).json()
    assert float(got["receivable"]) == 1070.0 and float(got["payable"]) == 0.0
