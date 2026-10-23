from fastapi import APIRouter, Depends, UploadFile, File, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID
import io

from core.database import get_db
from core.deps import get_current_user, require_admin, require_accountant_up
from models.user import User
from schemas.doctemplate import (
    DocumentTemplateCreate, DocumentTemplateUpdate, DocumentTemplateResponse,
)
from services.doctemplate import (
    create_template, get_templates, get_template, update_template,
    set_default_template, upload_logo, render_invoice_pdf,
    render_sales_document_pdf, render_receipt_pdf,
)


def _pdf_response(content: bytes, filename: str):
    return StreamingResponse(
        io.BytesIO(content), media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename={filename}"},
    )

router = APIRouter(prefix="/doc-templates", tags=["Document Template Editor"])


@router.post("/", response_model=DocumentTemplateResponse)
def create_template_ep(payload: DocumentTemplateCreate,
                       current_user: User = Depends(require_admin), db: Session = Depends(get_db)):
    return create_template(db, payload, current_user.id)


@router.get("/", response_model=List[DocumentTemplateResponse])
def list_templates_ep(document_kind: Optional[str] = None,
                      current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_templates(db, document_kind)


@router.get("/{template_id}", response_model=DocumentTemplateResponse)
def get_template_ep(template_id: UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_template(db, template_id)


@router.patch("/{template_id}", response_model=DocumentTemplateResponse)
def update_template_ep(template_id: UUID, payload: DocumentTemplateUpdate,
                       current_user: User = Depends(require_admin), db: Session = Depends(get_db)):
    return update_template(db, template_id, payload)


@router.post("/{template_id}/set-default", response_model=DocumentTemplateResponse)
def set_default_ep(template_id: UUID, current_user: User = Depends(require_admin), db: Session = Depends(get_db)):
    return set_default_template(db, template_id)


@router.post("/{template_id}/logo", response_model=DocumentTemplateResponse)
async def upload_logo_ep(template_id: UUID, file: UploadFile = File(...),
                         current_user: User = Depends(require_admin), db: Session = Depends(get_db)):
    content = await file.read()
    return upload_logo(db, template_id, file.filename, content)


@router.get("/preview/invoice/{invoice_id}")
def preview_invoice_ep(invoice_id: UUID, template_id: Optional[UUID] = Query(None),
                       current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return _pdf_response(render_invoice_pdf(db, invoice_id, template_id), "invoice.pdf")


@router.get("/preview/tax-invoice/{invoice_id}")
def preview_tax_invoice_ep(invoice_id: UUID, template_id: Optional[UUID] = Query(None),
                           current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return _pdf_response(render_invoice_pdf(db, invoice_id, template_id, as_tax_invoice=True), "tax_invoice.pdf")


@router.get("/preview/sales-document/{doc_id}")
def preview_sales_document_ep(doc_id: UUID, template_id: Optional[UUID] = Query(None),
                              current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return _pdf_response(render_sales_document_pdf(db, doc_id, template_id), "sales_document.pdf")


@router.get("/preview/receipt/{payment_id}")
def preview_receipt_ep(payment_id: UUID, template_id: Optional[UUID] = Query(None),
                       current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return _pdf_response(render_receipt_pdf(db, payment_id, template_id), "receipt.pdf")
