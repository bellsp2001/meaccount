"""
Document AI Service — Classification, Smart Extraction, Document Center management
"""
import json, base64
from decimal import Decimal
from typing import Optional, List, Dict, Any
from uuid import UUID
from sqlalchemy.orm import Session
from fastapi import HTTPException
from anthropic import Anthropic

from core.config import settings
from models.document import Document, DocumentType, DocumentStatus
from schemas.document import DocumentClassifyResponse, DocumentExtractResponse

_client: Optional[Anthropic] = None

def get_client() -> Optional[Anthropic]:
    global _client
    if not settings.ANTHROPIC_API_KEY:
        return None
    if not _client:
        _client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _client


# ── Document CRUD ──────────────────────────────────────────────

def create_document(db: Session, filename: str, storage_path: str, mime_type: str,
                    file_size: int, user_id: Optional[UUID] = None) -> Document:
    doc = Document(
        filename=filename, storage_path=storage_path, mime_type=mime_type,
        file_size_bytes=file_size, status=DocumentStatus.UPLOADED.value,
        uploaded_by=user_id,
    )
    db.add(doc); db.commit(); db.refresh(doc)
    return doc


def get_documents(db: Session, status: Optional[str] = None, document_type: Optional[str] = None) -> List[Document]:
    q = db.query(Document).filter(Document.is_deleted == False)
    if status:
        q = q.filter(Document.status == status)
    if document_type:
        q = q.filter(Document.document_type == document_type)
    return q.order_by(Document.created_at.desc()).all()


def get_document(db: Session, doc_id: UUID) -> Document:
    doc = db.query(Document).filter(Document.id == doc_id, Document.is_deleted == False).first()
    if not doc:
        raise HTTPException(404, "ไม่พบเอกสาร")
    return doc


# ── Document Classification ──────────────────────────────────

CLASSIFY_SYSTEM = """คุณเป็นระบบจำแนกประเภทเอกสารทางบัญชี วิเคราะห์ภาพเอกสารแล้วจำแนกประเภท
ตอบ JSON เท่านั้น: {"document_type": "invoice|receipt|purchase_order|contract|other", "confidence": 0.0-1.0, "reasoning": "เหตุผลสั้นๆ เป็นภาษาไทย"}

หลักการจำแนก:
- invoice: มีเลขที่ใบแจ้งหนี้, รายการสินค้า/บริการ, ยอดรวม, VAT, มักมีคำว่า "ใบแจ้งหนี้" หรือ "Invoice"
- receipt: มีลักษณะใบเสร็จ, มักสั้นกว่า invoice, มีคำว่า "ใบเสร็จรับเงิน" หรือ "Receipt"
- purchase_order: มีคำว่า "ใบสั่งซื้อ" หรือ "Purchase Order", ระบุสิ่งที่ต้องการสั่งซื้อ (ยังไม่ใช่การจ่ายเงิน)
- contract: เอกสารสัญญา มีข้อตกลง เงื่อนไข ลายเซ็นคู่สัญญา
- other: ไม่เข้าเกณฑ์ข้างต้น"""


def classify_document(db: Session, doc_id: UUID, image_base64: str, media_type: str = "image/jpeg") -> DocumentClassifyResponse:
    """AI จำแนกประเภทเอกสารจากรูปภาพ"""
    doc = get_document(db, doc_id)
    client = get_client()

    if not client:
        doc.document_type = DocumentType.UNKNOWN.value
        doc.classification_confidence = Decimal("0")
        doc.status = DocumentStatus.FAILED.value
        db.commit()
        return DocumentClassifyResponse(
            document_id=doc.id, document_type="unknown", confidence=0.0,
            reasoning="ไม่มี ANTHROPIC_API_KEY — ไม่สามารถจำแนกเอกสารได้",
        )

    try:
        resp = client.messages.create(
            model=settings.AI_MODEL, max_tokens=300,
            system=CLASSIFY_SYSTEM,
            messages=[{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": image_base64}},
                {"type": "text", "text": "จำแนกประเภทเอกสารนี้"},
            ]}],
        )
        raw = resp.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1].lstrip("json")
        data = json.loads(raw)

        doc_type = data.get("document_type", "unknown")
        confidence = float(data.get("confidence", 0.5))

        doc.document_type = doc_type
        doc.classification_confidence = Decimal(str(round(confidence, 4)))
        doc.status = DocumentStatus.CLASSIFIED.value
        db.commit()

        return DocumentClassifyResponse(
            document_id=doc.id, document_type=doc_type, confidence=confidence,
            reasoning=data.get("reasoning", ""),
        )
    except Exception as e:
        doc.status = DocumentStatus.FAILED.value
        db.commit()
        return DocumentClassifyResponse(
            document_id=doc.id, document_type="unknown", confidence=0.0,
            reasoning=f"เกิดข้อผิดพลาด: {str(e)}",
        )


# ── Smart Data Extraction ───────────────────────────────────────

EXTRACT_SYSTEMS = {
    "invoice": """สกัดข้อมูลจากใบแจ้งหนี้ ตอบ JSON เท่านั้น:
{"invoice_number": "", "date": "YYYY-MM-DD", "due_date": "YYYY-MM-DD", "customer_name": "",
 "customer_tax_id": "", "items": [{"description": "", "quantity": 0, "unit_price": 0, "amount": 0}],
 "subtotal": 0, "vat_amount": 0, "total": 0, "confidence": 0.0-1.0}""",
    "receipt": """สกัดข้อมูลจากใบเสร็จ ตอบ JSON เท่านั้น:
{"receipt_number": "", "date": "YYYY-MM-DD", "vendor_name": "", "items": [{"description": "", "amount": 0}],
 "total": 0, "payment_method": "", "confidence": 0.0-1.0}""",
    "purchase_order": """สกัดข้อมูลจากใบสั่งซื้อ ตอบ JSON เท่านั้น:
{"po_number": "", "date": "YYYY-MM-DD", "supplier_name": "", "items": [{"description": "", "quantity": 0, "unit_price": 0}],
 "total_estimated": 0, "confidence": 0.0-1.0}""",
}


def extract_document_data(db: Session, doc_id: UUID, image_base64: str, media_type: str = "image/jpeg") -> DocumentExtractResponse:
    """AI สกัดข้อมูลเชิงลึกจากเอกสาร ตามประเภทที่จำแนกไว้แล้ว"""
    doc = get_document(db, doc_id)
    client = get_client()
    warnings = []

    doc_type = doc.document_type if doc.document_type in EXTRACT_SYSTEMS else "invoice"
    if doc.document_type not in EXTRACT_SYSTEMS:
        warnings.append(f"ประเภทเอกสาร '{doc.document_type}' ไม่รองรับการสกัดข้อมูลเชิงลึก ใช้ template ใบแจ้งหนี้แทน")

    if not client:
        doc.status = DocumentStatus.FAILED.value
        db.commit()
        return DocumentExtractResponse(
            document_id=doc.id, document_type=doc_type, extracted_fields={},
            confidence=0.0, warnings=["ไม่มี ANTHROPIC_API_KEY"],
        )

    try:
        resp = client.messages.create(
            model=settings.AI_MODEL, max_tokens=1500,
            system=EXTRACT_SYSTEMS[doc_type],
            messages=[{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": image_base64}},
                {"type": "text", "text": "สกัดข้อมูลจากเอกสารนี้"},
            ]}],
        )
        raw = resp.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1].lstrip("json")
        data = json.loads(raw)
        confidence = float(data.pop("confidence", 0.7))

        doc.extracted_data = json.dumps(data, ensure_ascii=False)
        doc.ocr_confidence = Decimal(str(round(confidence, 4)))
        doc.status = DocumentStatus.EXTRACTED.value
        db.commit()

        if confidence < 0.5:
            warnings.append("ความมั่นใจต่ำ — ควรตรวจสอบข้อมูลด้วยตนเอง")

        return DocumentExtractResponse(
            document_id=doc.id, document_type=doc_type, extracted_fields=data,
            confidence=confidence, warnings=warnings,
        )
    except Exception as e:
        doc.status = DocumentStatus.FAILED.value
        db.commit()
        return DocumentExtractResponse(
            document_id=doc.id, document_type=doc_type, extracted_fields={},
            confidence=0.0, warnings=[f"เกิดข้อผิดพลาด: {str(e)}"],
        )


def review_document(db: Session, doc_id: UUID, approved: bool, note: Optional[str], user_id: Optional[UUID] = None) -> Document:
    from datetime import datetime
    doc = get_document(db, doc_id)
    doc.status = DocumentStatus.REVIEWED.value if approved else DocumentStatus.FAILED.value
    doc.reviewed_by = user_id
    doc.reviewed_at = datetime.utcnow()
    db.commit(); db.refresh(doc)
    return doc


def link_document(db: Session, doc_id: UUID, reference_type: str, reference_id: UUID) -> Document:
    doc = get_document(db, doc_id)
    doc.reference_type = reference_type
    doc.reference_id = reference_id
    doc.status = DocumentStatus.MATCHED.value
    db.commit(); db.refresh(doc)
    return doc
