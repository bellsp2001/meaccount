from pydantic import BaseModel
from typing import Optional, List
from uuid import UUID
from datetime import date, datetime
from decimal import Decimal
from models.fraud import RiskLevel, AlertStatus, FraudPattern


# ── Risk Alert ─────────────────────────────────────────────────
class RiskAlertResponse(BaseModel):
    id:              UUID
    pattern:         FraudPattern
    risk_level:      RiskLevel
    risk_score:      Decimal
    title:           str
    description:     str
    resource_type:   str
    resource_id:     Optional[UUID]
    reference:       Optional[str]
    amount:          Optional[Decimal]
    related_user_id: Optional[UUID]
    related_user_email: Optional[str] = None
    status:          AlertStatus
    investigated_by: Optional[UUID]
    resolution_note: Optional[str]
    resolved_at:     Optional[datetime]
    detected_at:     datetime
    model_config = {"from_attributes": True}


class AlertActionRequest(BaseModel):
    status: AlertStatus
    resolution_note: Optional[str] = None


class ScanRequest(BaseModel):
    period_from: date
    period_to:   date


class FraudScanSummary(BaseModel):
    scan_date:          datetime
    period_from:         date
    period_to:           date
    total_transactions_scanned: int
    alerts_created:       int
    critical_count:        int
    high_count:            int
    medium_count:           int
    low_count:              int
    alerts:                  List[RiskAlertResponse]


# ── Risk Dashboard ─────────────────────────────────────────────
class RiskDashboardResponse(BaseModel):
    open_alerts_count:    int
    critical_open_count:   int
    total_at_risk_amount:   Decimal
    alerts_by_pattern:      dict
    alerts_by_status:        dict
    recent_alerts:            List[RiskAlertResponse]


# ── Real-time transaction check ────────────────────────────────
class TransactionRiskCheckRequest(BaseModel):
    resource_type: str      # "bill" | "payment"
    resource_id:   UUID


class TransactionRiskCheckResponse(BaseModel):
    resource_type: str
    resource_id:   UUID
    risk_score:    float
    risk_level:    RiskLevel
    flags:         List[str]
    recommendation: str
