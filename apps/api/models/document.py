"""
Document AI Models: Document (uploaded files), MatchRecord (3-way match results)
"""
import enum
from sqlalchemy import Column, String, Text, ForeignKey, Boolean, Numeric, DateTime, Integer
from datetime import datetime
from sqlalchemy.orm import relationship
from core.database import Base
from models.base import UUIDMixin, TimestampMixin, UUIDType


class DocumentType(str, enum.Enum):
    INVOICE  = "invoice"
    RECEIPT  = "receipt"
    PO       = "purchase_order"
    CONTRACT = "contract"
    OTHER    = "other"
    UNKNOWN  = "unknown"


class DocumentStatus(str, enum.Enum):
    UPLOADED   = "uploaded"
    PROCESSING = "processing"
    CLASSIFIED = "classified"
    EXTRACTED  = "extracted"
    MATCHED    = "matched"
    REVIEWED   = "reviewed"
    ARCHIVED   = "archived"
    FAILED     = "failed"


class MatchStatus(str, enum.Enum):
    PENDING       = "pending"
    MATCHED       = "matched"
    DISCREPANCY   = "discrepancy"
    UNMATCHED     = "unmatched"


# ── Document ───────────────────────────────────────────────────
class Document(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "documents"

    filename        = Column(String(500), nullable=False)
    storage_path    = Column(String(500), nullable=False)   # relative path on disk / S3 key
    mime_type       = Column(String(100), nullable=True)
    file_size_bytes = Column(Integer, nullable=True)

    document_type       = Column(String(30), default=DocumentType.UNKNOWN.value, nullable=False)
    classification_confidence = Column(Numeric(5,4), nullable=True)  # 0.0000-1.0000

    status          = Column(String(30), default=DocumentStatus.UPLOADED.value, nullable=False)

    extracted_data  = Column(Text, nullable=True)     # JSON string of extracted fields
    ocr_confidence  = Column(Numeric(5,4), nullable=True)
    ocr_raw_text    = Column(Text, nullable=True)

    reference_type  = Column(String(30), nullable=True)   # "bill" | "invoice" | "po" once linked
    reference_id    = Column(UUIDType(), nullable=True)

    uploaded_by     = Column(UUIDType(), ForeignKey("users.id"), nullable=True)
    reviewed_by     = Column(UUIDType(), ForeignKey("users.id"), nullable=True)
    reviewed_at     = Column(DateTime, nullable=True)

    uploader = relationship("User", foreign_keys=[uploaded_by])
    reviewer = relationship("User", foreign_keys=[reviewed_by])


# ── MatchRecord (3-Way Match: PO ↔ Goods Receipt ↔ Invoice) ────
class MatchRecord(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "match_records"

    po_id         = Column(UUIDType(), ForeignKey("purchase_orders.id"), nullable=True)
    bill_id       = Column(UUIDType(), ForeignKey("bills.id"), nullable=True)
    document_id   = Column(UUIDType(), ForeignKey("documents.id"), nullable=True)

    match_status  = Column(String(30), default=MatchStatus.PENDING.value, nullable=False)

    po_amount     = Column(Numeric(18,2), nullable=True)
    receipt_amount= Column(Numeric(18,2), nullable=True)
    invoice_amount= Column(Numeric(18,2), nullable=True)

    quantity_discrepancy = Column(Boolean, default=False)
    price_discrepancy    = Column(Boolean, default=False)
    discrepancy_notes    = Column(Text, nullable=True)

    resolved      = Column(Boolean, default=False)
    resolved_by   = Column(UUIDType(), ForeignKey("users.id"), nullable=True)
    resolved_note = Column(Text, nullable=True)

    po      = relationship("PurchaseOrder")
    bill    = relationship("Bill")
    document = relationship("Document")
    resolver = relationship("User", foreign_keys=[resolved_by])
