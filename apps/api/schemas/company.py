from pydantic import BaseModel, field_validator
from typing import Optional, List
from uuid import UUID
from datetime import date, datetime
from decimal import Decimal


# ── Company ────────────────────────────────────────────────────
class CompanyCreate(BaseModel):
    code:               str
    name:               str
    name_en:            Optional[str] = None
    tax_id:             Optional[str] = None
    address:            Optional[str] = None
    parent_company_id:  Optional[UUID] = None
    ownership_pct:      Optional[Decimal] = None

    @field_validator("code")
    @classmethod
    def code_upper(cls, v): return v.strip().upper()


class CompanyResponse(BaseModel):
    id:                 UUID
    code:               str
    name:               str
    name_en:            Optional[str]
    tax_id:             Optional[str]
    address:            Optional[str]
    is_active:          bool
    parent_company_id:   Optional[UUID]
    ownership_pct:          Optional[Decimal]
    model_config = {"from_attributes": True}


class CompanyUserAssign(BaseModel):
    user_id:    UUID
    is_default: bool = False


# ── Intercompany ───────────────────────────────────────────────
class IntercompanyCreate(BaseModel):
    from_company_id: UUID
    to_company_id:   UUID
    date:            date
    description:     str
    amount:          Decimal

    @field_validator("amount")
    @classmethod
    def positive(cls, v):
        if v <= 0:
            raise ValueError("จำนวนเงินต้องมากกว่า 0")
        return v

    @field_validator("to_company_id")
    @classmethod
    def not_same_company(cls, v, info):
        if "from_company_id" in info.data and v == info.data["from_company_id"]:
            raise ValueError("บริษัทต้นทางและปลายทางต้องไม่ใช่บริษัทเดียวกัน")
        return v


class IntercompanyResponse(BaseModel):
    id:               UUID
    number:           str
    from_company_id:  UUID
    to_company_id:    UUID
    date:             date
    description:      str
    amount:           Decimal
    status:           str
    from_journal_id:   Optional[UUID]
    to_journal_id:        Optional[UUID]
    model_config = {"from_attributes": True}


class IntercompanyBalanceCheck(BaseModel):
    """Verifies that every posted intercompany transaction nets to zero across the group
    — i.e. what Company A owes Company B equals what Company B is owed from A."""
    is_balanced:       bool
    total_transactions:  int
    net_imbalance:         Decimal
    pairs:                   List[dict]


# ── Consolidated Statements ────────────────────────────────────
class ConsolidatedPLResponse(BaseModel):
    period_from:       date
    period_to:         date
    companies_included: List[str]
    consolidated_revenue: Decimal
    consolidated_expense:   Decimal
    consolidated_net_profit:  Decimal
    eliminations:                Decimal   # intercompany amounts eliminated
    per_company:                    List[dict]
