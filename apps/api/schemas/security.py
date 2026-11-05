from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from uuid import UUID
from datetime import datetime


# ── Consent ────────────────────────────────────────────────────
class ConsentCreate(BaseModel):
    subject_type: str    # "employee" | "customer" | "supplier"
    subject_id:   UUID
    consent_type: str
    granted:      bool


class ConsentResponse(BaseModel):
    id:           UUID
    subject_type: str
    subject_id:   UUID
    consent_type: str
    granted:      bool
    granted_at:   datetime
    withdrawn_at: Optional[datetime]
    model_config = {"from_attributes": True}


# ── Data Subject Request ────────────────────────────────────────
class DSRCreate(BaseModel):
    subject_type: str
    subject_id:   UUID
    request_type: str    # "access" | "export" | "delete" | "rectify"
    requested_by: Optional[str] = None


class DSRResponse(BaseModel):
    id:              UUID
    subject_type:    str
    subject_id:      UUID
    request_type:    str
    status:          str
    requested_by:    Optional[str]
    processed_at:    Optional[datetime]
    rejection_reason:Optional[str]
    created_at:      datetime
    model_config = {"from_attributes": True}


class DSRProcessRequest(BaseModel):
    approve:          bool
    rejection_reason: Optional[str] = None


# ── Compliance Scanner ──────────────────────────────────────────
class ComplianceControlResult(BaseModel):
    control_id:   str
    category:     str    # "access_control" | "encryption" | "audit_logging" | "data_rights"
    name:         str
    status:       str    # "pass" | "fail" | "manual_review_required"
    detail:       str
    is_automated: bool   # False = this is a process/paperwork item, not something code can verify


class ComplianceScanResponse(BaseModel):
    scan_date:            datetime
    total_controls:       int
    automated_pass:       int
    automated_fail:       int
    manual_review_count:  int
    controls:             List[ComplianceControlResult]
