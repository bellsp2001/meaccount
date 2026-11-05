import enum
from decimal import Decimal
from sqlalchemy import (Column, String, Numeric, Boolean, Enum, ForeignKey,
                        Text, Date, Integer, CheckConstraint, UniqueConstraint)
from sqlalchemy.orm import relationship
from core.database import Base
from models.base import UUIDMixin, TimestampMixin, UUIDType


class AccountTypeEnum(str, enum.Enum):
    ASSET     = "asset"
    LIABILITY = "liability"
    EQUITY    = "equity"
    INCOME    = "income"
    EXPENSE   = "expense"


class NormalBalance(str, enum.Enum):
    DEBIT  = "debit"
    CREDIT = "credit"


class JournalStatus(str, enum.Enum):
    DRAFT    = "draft"
    POSTED   = "posted"
    REVERSED = "reversed"


class JournalType(str, enum.Enum):
    """The five Thai books of original entry (สมุดรายวัน 5 เล่ม)."""
    GENERAL  = "general"    # สมุดรายวันทั่วไป
    SALES    = "sales"      # สมุดรายวันขาย
    PURCHASE = "purchase"   # สมุดรายวันซื้อ
    RECEIPT  = "receipt"    # สมุดรายวันรับเงิน
    PAYMENT  = "payment"    # สมุดรายวันจ่ายเงิน


class Account(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "accounts"
    __table_args__ = (
        # Account codes only need to be unique WITHIN a company's chart of accounts —
        # every company legitimately wants "1101" for Cash. A global unique=True on
        # `code` (the pre-multi-company constraint) would make it impossible for a
        # second company to ever create a normal chart of accounts, so this replaces
        # it with a composite constraint instead of just adding company_id blindly.
        UniqueConstraint("code", "company_id", name="uq_account_code_per_company"),
    )

    code           = Column(String(20),  nullable=False, index=True)
    name           = Column(String(200), nullable=False)
    name_en        = Column(String(200), nullable=True)
    account_type   = Column(Enum(AccountTypeEnum), nullable=False)
    normal_balance = Column(Enum(NormalBalance),   nullable=False)
    parent_id      = Column(UUIDType(), ForeignKey("accounts.id"), nullable=True)
    level          = Column(Integer, default=1, nullable=False)
    is_active      = Column(Boolean, default=True)
    description    = Column(Text, nullable=True)
    balance        = Column(Numeric(18, 2), default=0, nullable=False)

    # Nullable for the same backward-compatibility reason as Journal.company_id above.
    company_id     = Column(UUIDType(), ForeignKey("companies.id"), nullable=True, index=True)

    parent   = relationship("Account", remote_side="Account.id", backref="children")
    entries  = relationship("JournalEntry", back_populates="account", lazy="dynamic")
    company  = relationship("Company", foreign_keys=[company_id])


class Journal(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "journals"

    number       = Column(String(30),  nullable=False, unique=True, index=True)
    date         = Column(Date,        nullable=False, index=True)
    description  = Column(String(500), nullable=False)
    reference    = Column(String(100), nullable=True)
    status       = Column(Enum(JournalStatus), default=JournalStatus.DRAFT, nullable=False)
    # server_default lets existing rows (added before this column) read as the general journal.
    journal_type = Column(Enum(JournalType), default=JournalType.GENERAL, nullable=False,
                          server_default=JournalType.GENERAL.name, index=True)
    created_by   = Column(UUIDType(), ForeignKey("users.id"), nullable=True)
    posted_by    = Column(UUIDType(), ForeignKey("users.id"), nullable=True)
    note         = Column(Text, nullable=True)
    ai_suggested = Column(Boolean, default=False)

    # Nullable by design: existing pre-Phase-3 journals have no company assigned
    # (single-tenant deployments). Code that filters by company must treat
    # NULL company_id as "the default/only company" rather than erroring, so
    # this migration doesn't break anyone running MeAccount as a single company.
    company_id   = Column(UUIDType(), ForeignKey("companies.id"), nullable=True, index=True)

    entries = relationship("JournalEntry", back_populates="journal",
                           cascade="all, delete-orphan", lazy="joined")
    creator = relationship("User", foreign_keys=[created_by])
    poster  = relationship("User", foreign_keys=[posted_by])
    company = relationship("Company", foreign_keys=[company_id])


class BookSide(str, enum.Enum):
    INCOME  = "income"    # รายได้
    EXPENSE = "expense"   # ค่าใช้จ่าย


class DocumentBook(Base, UUIDMixin, TimestampMixin):
    """สมุดบันทึกเอกสาร — a kind of source document (e.g. ใบแจ้งหนี้/ใบกำกับภาษี) and how it is
    booked: which of the five journals it posts to and which accounts it hits."""
    __tablename__ = "document_books"

    code         = Column(String(20),  nullable=False, unique=True, index=True)   # "INV", "EXP"
    name         = Column(String(200), nullable=False)
    side         = Column(Enum(BookSide), nullable=False, index=True)
    journal_type = Column(Enum(JournalType), nullable=False)
    # The income / expense account — what the user picks as "ประเภทรายได้/ค่าใช้จ่าย".
    account_id         = Column(UUIDType(), ForeignKey("accounts.id"), nullable=False)
    # The other side: ลูกหนี้/เจ้าหนี้ for credit documents, เงินสด/ธนาคาร for cash ones.
    counter_account_id = Column(UUIDType(), ForeignKey("accounts.id"), nullable=True)
    tax_code_id  = Column(UUIDType(), ForeignKey("tax_codes.id"), nullable=True)
    description  = Column(Text, nullable=True)
    is_active    = Column(Boolean, default=True, nullable=False)

    account         = relationship("Account", foreign_keys=[account_id])
    counter_account = relationship("Account", foreign_keys=[counter_account_id])
    tax_code        = relationship("TaxCode", foreign_keys=[tax_code_id])


class JournalEntry(Base, UUIDMixin):
    __tablename__ = "journal_entries"
    __table_args__ = (
        CheckConstraint("debit >= 0 AND credit >= 0", name="ck_entry_non_negative"),
    )

    journal_id  = Column(UUIDType(), ForeignKey("journals.id"), nullable=False)
    account_id  = Column(UUIDType(), ForeignKey("accounts.id"), nullable=False)
    debit       = Column(Numeric(18, 2), default=0, nullable=False)
    credit      = Column(Numeric(18, 2), default=0, nullable=False)
    description = Column(String(300), nullable=True)
    sequence    = Column(Integer, default=0)

    journal = relationship("Journal", back_populates="entries")
    account = relationship("Account", back_populates="entries")
