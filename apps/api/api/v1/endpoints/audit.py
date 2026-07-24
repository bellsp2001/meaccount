from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID
from datetime import date

from core.database import get_db
from core.deps import get_current_user, require_manager_up
from models.user import User
from schemas.audit import (
    AuditLogResponse, AnomalyScanResponse, BalanceCheckResponse, DuplicateScanResponse,
)
from services.audit import get_audit_logs, run_balance_checks
from services.ai_audit import scan_anomalies, scan_duplicates

router = APIRouter(prefix="/audit", tags=["Audit & Compliance"])


@router.get("/logs", response_model=List[AuditLogResponse])
def get_logs_ep(
    user_id: Optional[UUID] = None, action: Optional[str] = None, resource: Optional[str] = None,
    date_from: Optional[date] = None, date_to: Optional[date] = None,
    skip: int = 0, limit: int = 100,
    current_user: User = Depends(require_manager_up), db: Session = Depends(get_db),
):
    return get_audit_logs(db, user_id, action, resource, date_from, date_to, skip, limit)


@router.get("/balance-check", response_model=BalanceCheckResponse)
def balance_check_ep(
    as_of_date: date = Query(...),
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    return run_balance_checks(db, as_of_date)


@router.get("/ai/anomalies", response_model=AnomalyScanResponse)
def anomaly_scan_ep(
    period_from: date = Query(...), period_to: date = Query(...),
    current_user: User = Depends(require_manager_up), db: Session = Depends(get_db),
):
    return scan_anomalies(db, period_from, period_to)


@router.get("/ai/duplicates", response_model=DuplicateScanResponse)
def duplicate_scan_ep(
    current_user: User = Depends(require_manager_up), db: Session = Depends(get_db),
):
    return scan_duplicates(db)
