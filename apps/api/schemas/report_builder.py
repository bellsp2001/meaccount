from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from uuid import UUID
from datetime import date, datetime
from models.report import ReportSourceType, ScheduleFrequency


# ── Field Metadata (for UI to know what columns are available) ──
class FieldMeta(BaseModel):
    key:   str
    label: str
    type:  str   # "string" | "number" | "date" | "currency"


class SourceFieldsResponse(BaseModel):
    source_type: ReportSourceType
    fields:      List[FieldMeta]


# ── Custom Report Builder ────────────────────────────────────────
class ReportFilter(BaseModel):
    field:    str
    operator: str    # "eq" | "gte" | "lte" | "contains"
    value:     Any


class CustomReportRequest(BaseModel):
    source_type: ReportSourceType
    columns:     List[str]
    filters:     List[ReportFilter] = []
    sort_by:     Optional[str] = None
    limit:       int = 500


class CustomReportResponse(BaseModel):
    source_type: ReportSourceType
    columns:     List[str]
    rows:        List[Dict[str, Any]]
    total_rows:   int


# ── Saved Report ───────────────────────────────────────────────
class SavedReportCreate(BaseModel):
    name:         str
    source_type:  ReportSourceType
    columns:      List[str]
    filters:      Optional[List[ReportFilter]] = None
    sort_by:      Optional[str] = None
    is_public:    bool = False


class SavedReportResponse(BaseModel):
    id:           UUID
    name:         str
    source_type:  ReportSourceType
    columns:      List[str]
    filters:      Optional[List[dict]]
    sort_by:      Optional[str]
    is_public:    bool
    model_config = {"from_attributes": True}


# ── Natural Language Report ──────────────────────────────────────
class NLReportRequest(BaseModel):
    question: str    # "สรุปรายได้เดือนนี้"


class NLReportResponse(BaseModel):
    question:     str
    interpretation: str
    answer:         str
    data:           Optional[Dict[str, Any]] = None
    chart_suggestion: Optional[str] = None   # "bar" | "line" | "pie" | None


# ── Scheduled Report ──────────────────────────────────────────
class ScheduledReportCreate(BaseModel):
    name:         str
    report_type:  str
    frequency:    ScheduleFrequency
    recipients:   List[str]
    format:       str = "pdf"
    saved_report_id: Optional[UUID] = None


class ScheduledReportResponse(BaseModel):
    id:           UUID
    name:         str
    report_type:  str
    frequency:    ScheduleFrequency
    recipients:   List[str]
    format:       str
    is_active:    bool
    last_sent_at: Optional[str]
    model_config = {"from_attributes": True}
