from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID

from core.database import get_db
from core.deps import get_current_user, require_manager_up
from models.user import User
from models.fraud import RiskLevel, AlertStatus
from schemas.fraud import (
    ScanRequest, FraudScanSummary, RiskAlertResponse,
    AlertActionRequest, RiskDashboardResponse,
)
from services.fraud_detection import (
    run_fraud_scan, get_alerts, update_alert_status, get_risk_dashboard,
)

router = APIRouter(prefix="/fraud", tags=["AI Fraud Detection"])


@router.post("/scan", response_model=FraudScanSummary)
def run_scan_ep(payload: ScanRequest,
                current_user: User = Depends(require_manager_up), db: Session = Depends(get_db)):
    return run_fraud_scan(db, payload)


@router.get("/alerts", response_model=List[RiskAlertResponse])
def list_alerts_ep(status: Optional[AlertStatus] = None, risk_level: Optional[RiskLevel] = None,
                   current_user: User = Depends(require_manager_up), db: Session = Depends(get_db)):
    alerts = get_alerts(db, status, risk_level)
    result = []
    for a in alerts:
        r = RiskAlertResponse.model_validate(a)
        if a.related_user:
            r.related_user_email = a.related_user.email
        result.append(r)
    return result


@router.post("/alerts/{alert_id}/action", response_model=RiskAlertResponse)
def alert_action_ep(alert_id: UUID, payload: AlertActionRequest,
                    current_user: User = Depends(require_manager_up), db: Session = Depends(get_db)):
    return update_alert_status(db, alert_id, payload.status, payload.resolution_note, current_user.id)


@router.get("/dashboard", response_model=RiskDashboardResponse)
def risk_dashboard_ep(current_user: User = Depends(require_manager_up), db: Session = Depends(get_db)):
    return get_risk_dashboard(db)
