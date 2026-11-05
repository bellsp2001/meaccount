"""
Security & Compliance Models: ConsentRecord, DataSubjectRequest, ComplianceCheck

Design note: this covers the genuine technical controls a SOC2/PDPA readiness
review actually checks for at the code level. It does NOT constitute an actual
SOC2 certification or legal PDPA compliance determination — those require a
licensed auditor and legal counsel review of organizational processes that
exist outside this codebase. See services/compliance.py for the honest
breakdown of what's a real automated check vs. a process/paperwork item.
"""
import enum
from sqlalchemy import Column, String, Boolean, ForeignKey, Text, DateTime, JSON
from datetime import datetime
from sqlalchemy.orm import relationship
from core.database import Base
from models.base import UUIDMixin, TimestampMixin, UUIDType


class ConsentType(str, enum.Enum):
    DATA_PROCESSING   = "data_processing"      # PDPA มาตรา 19: ความยินยอมประมวลผลข้อมูล
    MARKETING         = "marketing"
    THIRD_PARTY_SHARE = "third_party_share"


class DSRType(str, enum.Enum):
    """Data Subject Request types under PDPA (สิทธิเจ้าของข้อมูล)"""
    ACCESS  = "access"    # มาตรา 30: สิทธิขอเข้าถึงข้อมูล
    EXPORT  = "export"    # มาตรา 31: สิทธิให้โอนย้ายข้อมูล
    DELETE  = "delete"    # มาตรา 33: สิทธิขอให้ลบข้อมูล
    RECTIFY = "rectify"   # มาตรา 35: สิทธิขอแก้ไขข้อมูล


class DSRStatus(str, enum.Enum):
    PENDING    = "pending"
    PROCESSING = "processing"
    COMPLETED  = "completed"
    REJECTED   = "rejected"


# ── Consent Record (PDPA มาตรา 19-23) ────────────────────────────
class ConsentRecord(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "consent_records"

    subject_type   = Column(String(30), nullable=False)   # "employee" | "customer" | "supplier"
    subject_id     = Column(UUIDType(), nullable=False)    # references Employee.id / Customer.id / Supplier.id (no FK — different tables)
    consent_type   = Column(String(30), nullable=False)
    granted        = Column(Boolean, nullable=False)
    granted_at     = Column(DateTime, default=datetime.utcnow, nullable=False)
    withdrawn_at   = Column(DateTime, nullable=True)
    ip_address     = Column(String(50), nullable=True)
    recorded_by    = Column(UUIDType(), ForeignKey("users.id"), nullable=True)


# ── Data Subject Request (PDPA มาตรา 30-35) ───────────────────────
class DataSubjectRequest(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "data_subject_requests"

    subject_type    = Column(String(30), nullable=False)
    subject_id      = Column(UUIDType(), nullable=False)
    request_type    = Column(String(20), nullable=False)
    status          = Column(String(20), default=DSRStatus.PENDING.value, nullable=False)

    requested_by    = Column(String(255), nullable=True)   # subject's own contact info if not a system user
    processed_by    = Column(UUIDType(), ForeignKey("users.id"), nullable=True)
    processed_at    = Column(DateTime, nullable=True)

    result_data     = Column(JSON, nullable=True)   # for ACCESS/EXPORT requests: the exported data
    rejection_reason= Column(Text, nullable=True)

    processor = relationship("User", foreign_keys=[processed_by])
