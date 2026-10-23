from pydantic import BaseModel, field_validator, model_validator
from typing import Optional, List
from uuid import UUID
from datetime import date
from decimal import Decimal
from models.accounting import AccountTypeEnum, NormalBalance, JournalStatus


# ── Account Schemas ────────────────────────────────────────────
class AccountCreate(BaseModel):
    code:           str
    name:           str
    name_en:        Optional[str] = None
    account_type:   AccountTypeEnum
    normal_balance: NormalBalance
    parent_id:      Optional[UUID] = None
    level:          int = 1
    description:    Optional[str] = None

    @field_validator("code")
    @classmethod
    def code_format(cls, v: str) -> str:
        v = v.strip()
        if not v.isdigit():
            raise ValueError("รหัสบัญชีต้องเป็นตัวเลขเท่านั้น")
        return v


class AccountUpdate(BaseModel):
    name:        Optional[str] = None
    name_en:     Optional[str] = None
    description: Optional[str] = None
    is_active:   Optional[bool] = None


class AccountResponse(BaseModel):
    id:             UUID
    code:           str
    name:           str
    name_en:        Optional[str]
    account_type:   AccountTypeEnum
    normal_balance: NormalBalance
    parent_id:      Optional[UUID]
    level:          int
    is_active:      bool
    balance:        Decimal
    description:    Optional[str]
    children:       List["AccountResponse"] = []

    model_config = {"from_attributes": True}

AccountResponse.model_rebuild()


# ── JournalEntry Schemas ───────────────────────────────────────
class JournalEntryCreate(BaseModel):
    account_id:  UUID
    debit:       Decimal = Decimal("0")
    credit:      Decimal = Decimal("0")
    description: Optional[str] = None
    sequence:    int = 0

    @model_validator(mode="after")
    def one_side_only(self):
        d, c = self.debit, self.credit
        if d < 0 or c < 0:
            raise ValueError("จำนวนเงินต้องไม่ติดลบ")
        if d == 0 and c == 0:
            raise ValueError("ต้องระบุ Debit หรือ Credit อย่างน้อยหนึ่งฝั่ง")
        if d > 0 and c > 0:
            raise ValueError("ไม่สามารถมีทั้ง Debit และ Credit ในบรรทัดเดียวกัน")
        return self


class JournalEntryResponse(BaseModel):
    id:          UUID
    account_id:  UUID
    account_code: Optional[str] = None
    account_name: Optional[str] = None
    debit:       Decimal
    credit:      Decimal
    description: Optional[str]
    sequence:    int

    model_config = {"from_attributes": True}


# ── Journal Schemas ────────────────────────────────────────────
class JournalCreate(BaseModel):
    date:        date
    description: str
    reference:   Optional[str] = None
    note:        Optional[str] = None
    entries:     List[JournalEntryCreate]

    @field_validator("entries")
    @classmethod
    def min_two_entries(cls, v):
        if len(v) < 2:
            raise ValueError("Journal ต้องมีอย่างน้อย 2 รายการ")
        total_debit  = sum(e.debit  for e in v)
        total_credit = sum(e.credit for e in v)
        if total_debit != total_credit:
            raise ValueError(f"Debit ({total_debit}) ≠ Credit ({total_credit}) — บัญชีไม่สมดุล")
        return v


class JournalResponse(BaseModel):
    id:           UUID
    number:       str
    date:         date
    description:  str
    reference:    Optional[str]
    status:       JournalStatus
    note:         Optional[str]
    ai_suggested: bool
    entries:      List[JournalEntryResponse] = []
    total_debit:  Optional[Decimal] = None
    total_credit: Optional[Decimal] = None

    model_config = {"from_attributes": True}


# ── AI Suggestion ──────────────────────────────────────────────
class AISuggestRequest(BaseModel):
    description: str          # "ซื้อกระดาษ A4 สำนักงาน 500 บาท"
    amount:      Decimal
    date:        Optional[date] = None


class AISuggestResponse(BaseModel):
    suggested_entries: List[JournalEntryCreate]
    explanation:       str
    confidence:        float        # 0.0 – 1.0
