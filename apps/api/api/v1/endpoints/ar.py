from fastapi import APIRouter, Depends, Query, UploadFile, File
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID
from datetime import date
import base64

from core.database import get_db
from core.deps import get_current_user, require_accountant_up
from models.user import User
from models.ar import InvoiceStatus
from schemas.ar import (
    CustomerCreate, CustomerUpdate, CustomerResponse,
    InvoiceCreate, InvoiceResponse,
    PaymentCreate, PaymentResponse,
    OCRInvoiceRequest, OCRInvoiceResponse,
)
from services.ar import (
    get_customers, create_customer, update_customer,
    create_invoice, post_invoice_to_gl, receive_payment,
    get_aging_report,
)
from services.ocr import extract_invoice_from_image

router = APIRouter(prefix="/ar", tags=["Accounts Receivable"])


# ── Customer ───────────────────────────────────────────────────
@router.get("/customers", response_model=List[CustomerResponse])
def list_customers(
    search: Optional[str] = None, skip: int = 0, limit: int = 50,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return get_customers(db, search, skip, limit)


@router.post("/customers", response_model=CustomerResponse)
def create_customer_endpoint(
    payload: CustomerCreate,
    current_user: User = Depends(require_accountant_up),
    db: Session = Depends(get_db),
):
    return create_customer(db, payload)


@router.get("/customers/{cid}", response_model=CustomerResponse)
def get_customer(cid: UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from models.ar import Customer
    from fastapi import HTTPException
    c = db.query(Customer).filter(Customer.id == cid, Customer.is_deleted == False).first()
    if not c:
        raise HTTPException(404, "ไม่พบลูกค้า")
    return c


@router.patch("/customers/{cid}", response_model=CustomerResponse)
def update_customer_endpoint(
    cid: UUID, payload: CustomerUpdate,
    current_user: User = Depends(require_accountant_up),
    db: Session = Depends(get_db),
):
    return update_customer(db, cid, payload)


# ── Invoice ────────────────────────────────────────────────────
@router.get("/invoices", response_model=List[InvoiceResponse])
def list_invoices(
    status:      Optional[InvoiceStatus] = None,
    customer_id: Optional[UUID] = None,
    date_from:   Optional[date] = None,
    date_to:     Optional[date] = None,
    skip: int = 0, limit: int = 50,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from models.ar import Invoice
    q = db.query(Invoice).filter(Invoice.is_deleted == False)
    if status:      q = q.filter(Invoice.status == status)
    if customer_id: q = q.filter(Invoice.customer_id == customer_id)
    if date_from:   q = q.filter(Invoice.date >= date_from)
    if date_to:     q = q.filter(Invoice.date <= date_to)
    return q.order_by(Invoice.date.desc()).offset(skip).limit(limit).all()


@router.post("/invoices", response_model=InvoiceResponse)
def create_invoice_endpoint(
    payload: InvoiceCreate,
    current_user: User = Depends(require_accountant_up),
    db: Session = Depends(get_db),
):
    return create_invoice(db, payload, user_id=current_user.id)


@router.get("/invoices/{inv_id}", response_model=InvoiceResponse)
def get_invoice(inv_id: UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from models.ar import Invoice
    from fastapi import HTTPException
    inv = db.query(Invoice).filter(Invoice.id == inv_id).first()
    if not inv:
        raise HTTPException(404, "ไม่พบ Invoice")
    return inv


@router.post("/invoices/{inv_id}/post-gl", response_model=InvoiceResponse)
def post_invoice(
    inv_id: UUID,
    current_user: User = Depends(require_accountant_up),
    db: Session = Depends(get_db),
):
    return post_invoice_to_gl(db, inv_id, user_id=current_user.id)


@router.post("/invoices/{inv_id}/cancel")
def cancel_invoice(
    inv_id: UUID,
    current_user: User = Depends(require_accountant_up),
    db: Session = Depends(get_db),
):
    from models.ar import Invoice
    from fastapi import HTTPException
    inv = db.query(Invoice).filter(Invoice.id == inv_id).first()
    if not inv:
        raise HTTPException(404, "ไม่พบ Invoice")
    if inv.status == InvoiceStatus.PAID:
        raise HTTPException(400, "ไม่สามารถยกเลิก Invoice ที่ชำระแล้ว")
    inv.status = InvoiceStatus.CANCELLED
    db.commit()
    return {"message": "ยกเลิก Invoice เรียบร้อย"}


# ── Payment ────────────────────────────────────────────────────
@router.post("/payments", response_model=PaymentResponse)
def create_payment(
    payload: PaymentCreate,
    current_user: User = Depends(require_accountant_up),
    db: Session = Depends(get_db),
):
    return receive_payment(db, payload, user_id=current_user.id)


@router.get("/payments")
def list_payments(
    invoice_id: Optional[UUID] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from models.ar import Payment
    q = db.query(Payment)
    if invoice_id:
        q = q.filter(Payment.invoice_id == invoice_id)
    return q.order_by(Payment.date.desc()).limit(100).all()


# ── Reports ────────────────────────────────────────────────────
@router.get("/reports/aging")
def aging_report(
    as_of: Optional[date] = None,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return get_aging_report(db, as_of)


# ── OCR ────────────────────────────────────────────────────────
@router.post("/ocr/invoice", response_model=OCRInvoiceResponse)
async def ocr_invoice_upload(
    file: UploadFile = File(...),
    current_user: User = Depends(require_accountant_up),
):
    """อัปโหลดรูปภาพ/PDF แล้ว AI อ่านข้อมูล Invoice"""
    content = await file.read()
    image_b64 = base64.b64encode(content).decode()
    media_type = file.content_type or "image/jpeg"
    return extract_invoice_from_image(image_b64, media_type)


@router.post("/ocr/invoice-base64", response_model=OCRInvoiceResponse)
def ocr_invoice_base64(
    payload: OCRInvoiceRequest,
    current_user: User = Depends(require_accountant_up),
):
    """ส่ง base64 image แล้ว AI อ่านข้อมูล Invoice"""
    return extract_invoice_from_image(payload.image_base64, payload.media_type)
