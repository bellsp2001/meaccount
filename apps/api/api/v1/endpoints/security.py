from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID

from core.database import get_db
from core.deps import get_current_user, require_admin, require_accountant_up
from models.user import User
from schemas.security import (
    ConsentCreate, ConsentResponse,
    DSRCreate, DSRResponse, DSRProcessRequest,
    ComplianceScanResponse,
)
from services.compliance import (
    record_consent, withdraw_consent, get_consent_history,
    create_dsr, get_dsrs, process_dsr, run_compliance_scan,
)

router = APIRouter(prefix="/security", tags=["Security & Compliance"])


# ── Consent ────────────────────────────────────────────────────
@router.post("/consent", response_model=ConsentResponse)
def record_consent_ep(payload: ConsentCreate, request: Request,
                      current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    ip = request.client.host if request.client else None
    return record_consent(db, payload, ip, current_user.id)


@router.post("/consent/{consent_id}/withdraw", response_model=ConsentResponse)
def withdraw_consent_ep(consent_id: UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return withdraw_consent(db, consent_id)


@router.get("/consent/{subject_type}/{subject_id}", response_model=List[ConsentResponse])
def get_consent_history_ep(subject_type: str, subject_id: UUID,
                           current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return get_consent_history(db, subject_type, subject_id)


# ── Data Subject Requests ────────────────────────────────────
@router.post("/dsr", response_model=DSRResponse)
def create_dsr_ep(payload: DSRCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return create_dsr(db, payload)


@router.get("/dsr", response_model=List[DSRResponse])
def list_dsr_ep(status: Optional[str] = None,
               current_user: User = Depends(require_admin), db: Session = Depends(get_db)):
    return get_dsrs(db, status)


@router.post("/dsr/{dsr_id}/process", response_model=DSRResponse)
def process_dsr_ep(dsr_id: UUID, payload: DSRProcessRequest,
                   current_user: User = Depends(require_admin), db: Session = Depends(get_db)):
    return process_dsr(db, dsr_id, payload.approve, payload.rejection_reason, current_user.id)


# ── Compliance Scanner ────────────────────────────────────────
@router.get("/compliance-scan", response_model=ComplianceScanResponse)
def compliance_scan_ep(current_user: User = Depends(require_admin), db: Session = Depends(get_db)):
    return run_compliance_scan(db)
