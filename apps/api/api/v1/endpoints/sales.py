from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID
from datetime import date

from core.database import get_db
from core.deps import get_current_user, require_accountant_up
from models.user import User
from models.sales import SalesDocType, SalesDocStatus
from schemas.sales import (
    SalesDocCreate, SalesDocResponse, ConvertResult,
    ReceiptResponse, SalesReportResponse,
)
from schemas.ar import InvoiceResponse
from services.sales import (
    create_sales_document, list_sales_documents, get_sales_document,
    set_status, convert_document, post_deposit_to_gl,
    list_tax_invoices, list_receipts, sales_report,
)

router = APIRouter(prefix="/ar", tags=["Sales"])


# ── Sales documents (quotation / sales order / deposit) ────────
@router.get("/sales-documents", response_model=List[SalesDocResponse])
def list_docs(
    doc_type:    SalesDocType,
    status:      Optional[SalesDocStatus] = None,
    customer_id: Optional[UUID] = None,
    skip: int = 0, limit: int = 100,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return list_sales_documents(db, doc_type, status, customer_id, skip, limit)


@router.post("/sales-documents", response_model=SalesDocResponse)
def create_doc(
    payload: SalesDocCreate,
    current_user: User = Depends(require_accountant_up),
    db: Session = Depends(get_db),
):
    return create_sales_document(db, payload, user_id=current_user.id)


@router.get("/sales-documents/{doc_id}", response_model=SalesDocResponse)
def get_doc(doc_id: UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_sales_document(db, doc_id)


@router.post("/sales-documents/{doc_id}/status", response_model=SalesDocResponse)
def update_status(
    doc_id: UUID, status: SalesDocStatus,
    current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db),
):
    return set_status(db, doc_id, status)


@router.post("/sales-documents/{doc_id}/convert", response_model=ConvertResult)
def convert_doc(
    doc_id: UUID,
    current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db),
):
    return convert_document(db, doc_id, user_id=current_user.id)


@router.post("/sales-documents/{doc_id}/post-deposit", response_model=SalesDocResponse)
def post_deposit(
    doc_id: UUID,
    current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db),
):
    return post_deposit_to_gl(db, doc_id, user_id=current_user.id)


@router.post("/sales-documents/{doc_id}/cancel", response_model=SalesDocResponse)
def cancel_doc(
    doc_id: UUID,
    current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db),
):
    return set_status(db, doc_id, SalesDocStatus.CANCELLED)


# ── Tax invoices (issued invoices) ─────────────────────────────
@router.get("/tax-invoices", response_model=List[InvoiceResponse])
def tax_invoices(
    skip: int = 0, limit: int = 100,
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    return list_tax_invoices(db, skip, limit)


# ── Receipts (payments) ────────────────────────────────────────
@router.get("/receipts", response_model=List[ReceiptResponse])
def receipts(
    skip: int = 0, limit: int = 100,
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    return list_receipts(db, skip, limit)


# ── Sales report ───────────────────────────────────────────────
@router.get("/reports/sales", response_model=SalesReportResponse)
def report_sales(
    period_from: Optional[date] = None,
    period_to:   Optional[date] = None,
    current_user: User = Depends(get_current_user), db: Session = Depends(get_db),
):
    return sales_report(db, period_from, period_to)
