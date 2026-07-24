from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from uuid import UUID
from datetime import datetime
from decimal import Decimal


# ── Document ───────────────────────────────────────────────────
class DocumentResponse(BaseModel):
    id:                UUID
    filename:          str
    mime_type:          Optional[str]
    file_size_bytes:      Optional[int]
    document_type:          str
    classification_confidence: Optional[Decimal]
    status:                     str
    extracted_data:               Optional[Dict[str, Any]] = None
    ocr_confidence:                 Optional[Decimal]
    reference_type:                   Optional[str]
    reference_id:                       Optional[UUID]
    created_at:                          datetime
    reviewed_at:                            Optional[datetime]
    model_config = {"from_attributes": True}


class DocumentClassifyResponse(BaseModel):
    document_id:   UUID
    document_type: str
    confidence:    float
    reasoning:     str


class DocumentExtractResponse(BaseModel):
    document_id:     UUID
    document_type:   str
    extracted_fields: Dict[str, Any]
    confidence:       float
    warnings:          List[str] = []


class LinkDocumentRequest(BaseModel):
    reference_type: str    # "bill" | "invoice" | "po"
    reference_id:   UUID


class ReviewDocumentRequest(BaseModel):
    approved: bool
    note:     Optional[str] = None


# ── 3-Way Match ────────────────────────────────────────────────
class MatchRecordResponse(BaseModel):
    id:                    UUID
    po_id:                 Optional[UUID]
    bill_id:               Optional[UUID]
    document_id:           Optional[UUID]
    match_status:            str
    po_amount:                 Optional[Decimal]
    receipt_amount:               Optional[Decimal]
    invoice_amount:                  Optional[Decimal]
    quantity_discrepancy:               bool
    price_discrepancy:                    bool
    discrepancy_notes:                       Optional[str]
    resolved:                                   bool
    resolved_note:                                Optional[str]
    model_config = {"from_attributes": True}


class RunThreeWayMatchRequest(BaseModel):
    bill_id: UUID


class ResolveMatchRequest(BaseModel):
    note: str
