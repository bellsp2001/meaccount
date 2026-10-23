from pydantic import BaseModel
from typing import Optional, List, Any
from uuid import UUID
from datetime import date, datetime
from decimal import Decimal


# ── Audit Log Query ────────────────────────────────────────────
class AuditLogResponse(BaseModel):
    id:          UUID
    user_id:     Optional[UUID]
    user_email:  Optional[str] = None
    action:      str
    resource:    str
    resource_id: Optional[str]
    detail:      Optional[str]
    ip_address:  Optional[str]
    created_at:  datetime
    model_config = {"from_attributes": True}


# ── Anomaly Detection ──────────────────────────────────────────
class AnomalyItem(BaseModel):
    severity:     str          # "high" | "medium" | "low"
    category:     str          # "duplicate" | "unusual_amount" | "unbalanced" | "weekend_posting" | "round_number"
    title:        str
    description:  str
    resource_type: str         # "journal" | "invoice" | "bill" | "payment"
    resource_id:   Optional[UUID]
    reference:     Optional[str]
    amount:        Optional[Decimal]
    date:          Optional[date]
    risk_score:    float       # 0-100


class AnomalyScanResponse(BaseModel):
    scan_date:       datetime
    period_from:      date
    period_to:        date
    total_scanned:     int
    anomalies_found:   int
    high_risk_count:   int
    medium_risk_count: int
    low_risk_count:    int
    anomalies:          List[AnomalyItem]


# ── Balance Check ──────────────────────────────────────────────
class BalanceCheckItem(BaseModel):
    check_name:  str
    passed:      bool
    detail:      str
    severity:    str


class BalanceCheckResponse(BaseModel):
    as_of_date:  date
    all_passed:  bool
    checks:      List[BalanceCheckItem]


# ── Duplicate Detection ────────────────────────────────────────
class DuplicateGroup(BaseModel):
    resource_type: str
    match_reason:  str
    items:         List[dict]
    confidence:    float


class DuplicateScanResponse(BaseModel):
    scan_date:  datetime
    groups:      List[DuplicateGroup]
    total_found: int
