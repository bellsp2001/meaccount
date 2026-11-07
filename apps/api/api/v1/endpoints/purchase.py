from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID
from datetime import date

from core.database import get_db
from core.deps import get_current_user, require_accountant_up
from models.user import User
from models.purchase import PurchaseDocType
from models.sales import SalesDocStatus
from schemas.purchase import (
    PurchaseDocCreate, PurchaseDocResponse, PaymentVoucherResponse, ExpenseReportResponse,
)
from schemas.sales import ConvertResult
from schemas.ap import BillResponse
from services.purchase import (
    create_purchase_document, list_purchase_documents, get_purchase_document,
    set_status, convert_document, post_deposit_to_gl, post_note_to_gl,
    list_purchase_tax_invoices, list_payment_vouchers, expense_report, get_ap_aging,
)

router = APIRouter(prefix="/ap", tags=["Purchasing"])


# ── Purchase documents (RFQ / PO / deposit / credit & debit notes) ──
@router.get("/purchase-documents", response_model=List[PurchaseDocResponse])
def list_docs(
    doc_type:    PurchaseDocType,
    status:      Optional[SalesDocStatus] = None,
    supplier_id: Optional[UUID] = None,
    skip: int = 0, limit: int = 100,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return list_purchase_documents(db, doc_type, status, supplier_id, skip, limit)


@router.post("/purchase-documents", response_model=PurchaseDocResponse)
def create_doc(payload: PurchaseDocCreate,
               current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return create_purchase_document(db, payload, user_id=current_user.id)


@router.get("/purchase-documents/{doc_id}", response_model=PurchaseDocResponse)
def get_doc(doc_id: UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_purchase_document(db, doc_id)


@router.post("/purchase-documents/{doc_id}/status", response_model=PurchaseDocResponse)
def update_status(doc_id: UUID, status: SalesDocStatus,
                  current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return set_status(db, doc_id, status)


@router.post("/purchase-documents/{doc_id}/convert", response_model=ConvertResult)
def convert_doc(doc_id: UUID,
                current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return convert_document(db, doc_id, user_id=current_user.id)


@router.post("/purchase-documents/{doc_id}/post-deposit", response_model=PurchaseDocResponse)
def post_deposit(doc_id: UUID,
                 current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return post_deposit_to_gl(db, doc_id, user_id=current_user.id)


@router.post("/purchase-documents/{doc_id}/post-note", response_model=PurchaseDocResponse)
def post_note(doc_id: UUID,
              current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return post_note_to_gl(db, doc_id, user_id=current_user.id)


@router.post("/purchase-documents/{doc_id}/cancel", response_model=PurchaseDocResponse)
def cancel_doc(doc_id: UUID,
               current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return set_status(db, doc_id, SalesDocStatus.CANCELLED)


# ── Views ──────────────────────────────────────────────────────
@router.get("/tax-invoices", response_model=List[BillResponse])
def purchase_tax_invoices(skip: int = 0, limit: int = 100,
                          current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return list_purchase_tax_invoices(db, skip, limit)


@router.get("/payment-vouchers", response_model=List[PaymentVoucherResponse])
def payment_vouchers(skip: int = 0, limit: int = 100,
                     current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return list_payment_vouchers(db, skip, limit)


# ── Reports ────────────────────────────────────────────────────
@router.get("/reports/expenses", response_model=ExpenseReportResponse)
def report_expenses(period_from: Optional[date] = None, period_to: Optional[date] = None,
                    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return expense_report(db, period_from, period_to)


@router.get("/reports/aging")
def report_ap_aging(as_of: Optional[date] = None,
                    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_ap_aging(db, as_of)
