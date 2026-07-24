from fastapi import APIRouter, Depends, Query
from fastapi.responses import PlainTextResponse
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID

from core.database import get_db
from core.deps import get_current_user, require_accountant_up
from models.user import User
from schemas.tax import (
    VATReturnGenerateRequest, VATReturnResponse,
    WHTCertificateCreate, WHTCertificateResponse, WHTBulkGenerateRequest,
    VATCheckResponse, TaxPlanningRequest, TaxPlanningResponse,
)
from services.tax import (
    generate_vat_return, get_vat_returns, submit_vat_return, generate_vat_xml,
    create_wht_certificate, bulk_generate_wht_from_bills,
    get_wht_certificates, issue_certificate,
)
from services.ai_tax import check_vat_compliance, plan_corporate_tax

router = APIRouter(prefix="/tax", tags=["Tax Management"])


# ── VAT Return ─────────────────────────────────────────────────
@router.get("/vat-returns", response_model=List[VATReturnResponse])
def list_vat_returns(year: Optional[int] = None,
                     current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_vat_returns(db, year)

@router.post("/vat-returns/generate", response_model=VATReturnResponse)
def generate_vat_ep(payload: VATReturnGenerateRequest,
                    current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return generate_vat_return(db, payload, current_user.id)

@router.post("/vat-returns/{vr_id}/submit", response_model=VATReturnResponse)
def submit_vat_ep(vr_id: UUID, current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return submit_vat_return(db, vr_id)

@router.get("/vat-returns/{vr_id}/xml", response_class=PlainTextResponse)
def get_vat_xml_ep(vr_id: UUID, current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return generate_vat_xml(db, vr_id)


# ── Withholding Certificate ─────────────────────────────────────
@router.get("/wht-certificates", response_model=List[WHTCertificateResponse])
def list_wht_ep(period_month: Optional[int] = None, period_year: Optional[int] = None,
                current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_wht_certificates(db, period_month, period_year)

@router.post("/wht-certificates", response_model=WHTCertificateResponse)
def create_wht_ep(payload: WHTCertificateCreate,
                  current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return create_wht_certificate(db, payload, current_user.id)

@router.post("/wht-certificates/bulk-generate", response_model=List[WHTCertificateResponse])
def bulk_wht_ep(payload: WHTBulkGenerateRequest,
                current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return bulk_generate_wht_from_bills(db, payload, current_user.id)

@router.post("/wht-certificates/{cert_id}/issue", response_model=WHTCertificateResponse)
def issue_wht_ep(cert_id: UUID, current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return issue_certificate(db, cert_id)


# ── AI ─────────────────────────────────────────────────────────
@router.get("/ai/check-vat", response_model=VATCheckResponse)
def check_vat_ep(period_month: int = Query(...), period_year: int = Query(...),
                 current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return check_vat_compliance(db, period_month, period_year)

@router.post("/ai/plan-corporate-tax", response_model=TaxPlanningResponse)
def plan_tax_ep(payload: TaxPlanningRequest, current_user: User = Depends(require_accountant_up)):
    return plan_corporate_tax(payload)
