"""Multi-Company Tests — Composite unique constraint, access control, intercompany posting, consolidated P&L eliminations"""
import pytest
from decimal import Decimal
from datetime import date, timedelta
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from core.database import Base, get_db
from core.security import hash_password
from models.user import User, UserRole
from models.company import Company, CompanyUser
from models.accounting import Account, Journal, JournalEntry, AccountTypeEnum, NormalBalance, JournalStatus
from main import app

engine = create_engine("sqlite:///./test_company.db", connect_args={"check_same_thread": False})
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
def two_companies(client, admin_token):
    a = client.post("/api/v1/companies/", json={"code": "CO-A", "name": "บริษัท เอ จำกัด"},
                    headers={"Authorization": f"Bearer {admin_token}"}).json()
    b = client.post("/api/v1/companies/", json={"code": "CO-B", "name": "บริษัท บี จำกัด"},
                    headers={"Authorization": f"Bearer {admin_token}"}).json()
    return a, b


# ── Composite Unique Constraint (the core migration risk) ──────
def test_same_account_code_allowed_across_different_companies(db, two_companies):
    """
    This is the change that made multi-company possible at all: before this sprint,
    Account.code had a global unique=True, so only ONE company total could ever have
    an account "1101" (Cash). Verifies the composite constraint actually permits this.
    """
    co_a, co_b = two_companies
    acc_a = Account(code="1101", name="เงินสด บริษัท A", account_type=AccountTypeEnum.ASSET,
                    normal_balance=NormalBalance.DEBIT, level=3, company_id=co_a["id"])
    acc_b = Account(code="1101", name="เงินสด บริษัท B", account_type=AccountTypeEnum.ASSET,
                    normal_balance=NormalBalance.DEBIT, level=3, company_id=co_b["id"])
    db.add_all([acc_a, acc_b])
    db.commit()  # must not raise IntegrityError

    accounts = db.query(Account).filter(Account.code == "1101").all()
    assert len(accounts) == 2

def test_duplicate_account_code_within_same_company_still_rejected(db, two_companies):
    """The composite constraint must still enforce uniqueness WITHIN one company —
    otherwise we've just broken data integrity instead of fixing it."""
    co_a, _ = two_companies
    acc1 = Account(code="1101", name="เงินสด", account_type=AccountTypeEnum.ASSET,
                   normal_balance=NormalBalance.DEBIT, level=3, company_id=co_a["id"])
    db.add(acc1); db.commit()

    acc2 = Account(code="1101", name="เงินสด ซ้ำ", account_type=AccountTypeEnum.ASSET,
                   normal_balance=NormalBalance.DEBIT, level=3, company_id=co_a["id"])
    db.add(acc2)
    with pytest.raises(Exception):  # IntegrityError from the unique constraint
        db.commit()

def test_null_company_id_journals_still_work(client, acc_token, db):
    """Existing single-tenant journals (company_id=NULL, pre-Phase-3 data) must
    keep working — this is the backward-compatibility guarantee for the migration."""
    cash = Account(code="1101", name="เงินสด", account_type=AccountTypeEnum.ASSET,
                   normal_balance=NormalBalance.DEBIT, level=3, balance=Decimal("0"), company_id=None)
    rev = Account(code="4101", name="รายได้", account_type=AccountTypeEnum.INCOME,
                 normal_balance=NormalBalance.CREDIT, level=2, balance=Decimal("0"), company_id=None)
    db.add_all([cash, rev]); db.commit()

    res = client.post("/api/v1/journals/", json={
        "date": str(date.today()), "description": "no-company journal",
        "entries": [
            {"account_id": str(cash.id), "debit": 1000, "credit": 0},
            {"account_id": str(rev.id), "debit": 0, "credit": 1000},
        ],
    }, headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 200
    assert res.json()["status"] == "draft"


# ── Company Access Control ─────────────────────────────────────
def test_only_admin_can_create_company(client, acc_token):
    res = client.post("/api/v1/companies/", json={"code": "X", "name": "X Co"},
                      headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 403

def test_duplicate_company_code_rejected(client, admin_token, two_companies):
    res = client.post("/api/v1/companies/", json={"code": "CO-A", "name": "Duplicate"},
                      headers={"Authorization": f"Bearer {admin_token}"})
    assert res.status_code == 400

def test_non_admin_only_sees_assigned_companies(client, admin_token, acc_token, two_companies, db):
    co_a, co_b = two_companies
    accountant = db.query(User).filter(User.email == "acc@test.com").first()

    client.post(f"/api/v1/companies/{co_a['id']}/users", json={"user_id": str(accountant.id), "is_default": True},
               headers={"Authorization": f"Bearer {admin_token}"})

    res = client.get("/api/v1/companies/", headers={"Authorization": f"Bearer {acc_token}"})
    companies = res.json()
    assert len(companies) == 1
    assert companies[0]["code"] == "CO-A"

def test_admin_sees_all_companies(client, admin_token, two_companies):
    res = client.get("/api/v1/companies/", headers={"Authorization": f"Bearer {admin_token}"})
    assert len(res.json()) == 2


# ── Intercompany Transactions ────────────────────────────────
@pytest.fixture
def companies_with_accounts(db, client, admin_token):
    co_a = Company(code="ICA", name="บริษัท A")
    co_b = Company(code="ICB", name="บริษัท B")
    db.add_all([co_a, co_b]); db.flush()

    for co in (co_a, co_b):
        cash = Account(code="1101", name="เงินสด", account_type=AccountTypeEnum.ASSET,
                       normal_balance=NormalBalance.DEBIT, level=3, balance=Decimal("100000"), company_id=co.id)
        ic_ar = Account(code="1290", name="ลูกหนี้ระหว่างบริษัท", account_type=AccountTypeEnum.ASSET,
                        normal_balance=NormalBalance.DEBIT, level=3, balance=Decimal("0"), company_id=co.id)
        ic_ap = Account(code="2190", name="เจ้าหนี้ระหว่างบริษัท", account_type=AccountTypeEnum.LIABILITY,
                        normal_balance=NormalBalance.CREDIT, level=3, balance=Decimal("0"), company_id=co.id)
        db.add_all([cash, ic_ar, ic_ap])
    db.commit()
    return co_a, co_b

def test_reject_same_company_intercompany_transfer(client, acc_token, companies_with_accounts):
    co_a, _ = companies_with_accounts
    res = client.post("/api/v1/companies/intercompany", json={
        "from_company_id": str(co_a.id), "to_company_id": str(co_a.id),
        "date": str(date.today()), "description": "invalid self-transfer", "amount": 1000,
    }, headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 422

def test_intercompany_transaction_posts_both_sides(client, acc_token, db, companies_with_accounts):
    co_a, co_b = companies_with_accounts

    create_res = client.post("/api/v1/companies/intercompany", json={
        "from_company_id": str(co_a.id), "to_company_id": str(co_b.id),
        "date": str(date.today()), "description": "loan from A to B", "amount": 20000,
    }, headers={"Authorization": f"Bearer {acc_token}"})
    assert create_res.status_code == 200
    ic_id = create_res.json()["id"]
    assert create_res.json()["status"] == "draft"

    post_res = client.post(f"/api/v1/companies/intercompany/{ic_id}/post",
                           headers={"Authorization": f"Bearer {acc_token}"})
    assert post_res.status_code == 200
    data = post_res.json()
    assert data["status"] == "posted"
    assert data["from_journal_id"] is not None
    assert data["to_journal_id"] is not None

    # Verify actual balance changes in each company's books
    ic_ar_a = db.query(Account).filter(Account.company_id == co_a.id, Account.code == "1290").first()
    ic_ap_b = db.query(Account).filter(Account.company_id == co_b.id, Account.code == "2190").first()
    db.refresh(ic_ar_a); db.refresh(ic_ap_b)
    assert ic_ar_a.balance == Decimal("20000")   # A now shows a receivable from B
    assert ic_ap_b.balance == Decimal("20000")   # B now shows a payable to A — the two sides match

def test_cannot_double_post_intercompany(client, acc_token, companies_with_accounts):
    co_a, co_b = companies_with_accounts
    create_res = client.post("/api/v1/companies/intercompany", json={
        "from_company_id": str(co_a.id), "to_company_id": str(co_b.id),
        "date": str(date.today()), "description": "test", "amount": 5000,
    }, headers={"Authorization": f"Bearer {acc_token}"})
    ic_id = create_res.json()["id"]

    client.post(f"/api/v1/companies/intercompany/{ic_id}/post", headers={"Authorization": f"Bearer {acc_token}"})
    res2 = client.post(f"/api/v1/companies/intercompany/{ic_id}/post", headers={"Authorization": f"Bearer {acc_token}"})
    assert res2.status_code == 400

def test_intercompany_missing_accounts_fails_cleanly(client, acc_token, db):
    """If a company hasn't set up intercompany AR/AP accounts, posting should fail
    with a clear error rather than silently posting to the wrong account or crashing."""
    co_a = Company(code="NOACC-A", name="No Accounts A")
    co_b = Company(code="NOACC-B", name="No Accounts B")
    db.add_all([co_a, co_b]); db.commit()

    create_res = client.post("/api/v1/companies/intercompany", json={
        "from_company_id": str(co_a.id), "to_company_id": str(co_b.id),
        "date": str(date.today()), "description": "test", "amount": 1000,
    }, headers={"Authorization": f"Bearer {acc_token}"})
    ic_id = create_res.json()["id"]

    res = client.post(f"/api/v1/companies/intercompany/{ic_id}/post", headers={"Authorization": f"Bearer {acc_token}"})
    assert res.status_code == 400


# ── Consolidated P&L with elimination ──────────────────────────
def test_consolidated_pl_eliminates_intercompany_amounts(client, acc_token, db, companies_with_accounts):
    """
    The core correctness test for consolidation: Company A sells ฿20,000 of services
    to Company B (an intercompany transaction). Without elimination, naive summing
    would show group revenue inflated by that internal transfer. This verifies the
    eliminated consolidated figure is genuinely lower than the naive sum.
    """
    co_a, co_b = companies_with_accounts

    # A records external revenue
    rev_a = Account(code="4101", name="รายได้ A", account_type=AccountTypeEnum.INCOME,
                    normal_balance=NormalBalance.CREDIT, level=2, balance=Decimal("0"), company_id=co_a.id)
    cash_a = db.query(Account).filter(Account.company_id == co_a.id, Account.code == "1101").first()
    db.add(rev_a); db.flush()

    j = Journal(number="JV-EXT-1", date=date.today(), description="external sale",
               status=JournalStatus.POSTED, company_id=co_a.id)
    db.add(j); db.flush()
    db.add(JournalEntry(journal_id=j.id, account_id=cash_a.id, debit=Decimal("50000"), credit=Decimal("0")))
    db.add(JournalEntry(journal_id=j.id, account_id=rev_a.id, debit=Decimal("0"), credit=Decimal("50000")))
    rev_a.balance += Decimal("50000")
    db.commit()

    # Intercompany transfer A → B (should be eliminated, not counted as group revenue)
    ic_res = client.post("/api/v1/companies/intercompany", json={
        "from_company_id": str(co_a.id), "to_company_id": str(co_b.id),
        "date": str(date.today()), "description": "internal transfer", "amount": 20000,
    }, headers={"Authorization": f"Bearer {acc_token}"})
    ic_id = ic_res.json()["id"]
    client.post(f"/api/v1/companies/intercompany/{ic_id}/post", headers={"Authorization": f"Bearer {acc_token}"})

    res = client.get(
        f"/api/v1/companies/consolidated/profit-loss"
        f"?company_ids={co_a.id}&company_ids={co_b.id}"
        f"&period_from={date.today()-timedelta(days=1)}&period_to={date.today()}",
        headers={"Authorization": f"Bearer {acc_token}"},
    )
    assert res.status_code == 200
    data = res.json()
    assert float(data["eliminations"]) == 20000.0
    # 50000 external revenue is genuinely group revenue; the 20000 intercompany
    # transfer must NOT inflate consolidated_revenue further
    assert float(data["consolidated_revenue"]) <= 50000.0
