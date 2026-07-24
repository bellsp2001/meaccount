"""
Report Builder Models: SavedReport, ScheduledReport
"""
import enum
from sqlalchemy import Column, String, Boolean, Enum, ForeignKey, Text, JSON, Integer
from sqlalchemy.orm import relationship
from core.database import Base
from models.base import UUIDMixin, TimestampMixin, UUIDType


class ReportSourceType(str, enum.Enum):
    JOURNAL   = "journal"
    INVOICE   = "invoice"
    BILL      = "bill"
    PRODUCT   = "product"
    EMPLOYEE  = "employee"
    ACCOUNT   = "account"


class ScheduleFrequency(str, enum.Enum):
    DAILY   = "daily"
    WEEKLY  = "weekly"
    MONTHLY = "monthly"


# ── SavedReport (Custom Report Builder configs) ─────────────────
class SavedReport(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "saved_reports"

    name         = Column(String(200), nullable=False)
    source_type  = Column(Enum(ReportSourceType), nullable=False)
    columns      = Column(JSON, nullable=False)   # list of field names to include
    filters      = Column(JSON, nullable=True)    # dict of filter conditions
    sort_by      = Column(String(100), nullable=True)
    created_by   = Column(UUIDType(), ForeignKey("users.id"), nullable=True)
    is_public    = Column(Boolean, default=False)  # shared with all users


# ── ScheduledReport (Auto-send reports) ─────────────────────────
class ScheduledReport(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "scheduled_reports"

    name          = Column(String(200), nullable=False)
    report_type   = Column(String(50),  nullable=False)   # "profit_loss" | "balance_sheet" | "aging" | "custom"
    saved_report_id = Column(UUIDType(), ForeignKey("saved_reports.id"), nullable=True)
    frequency     = Column(Enum(ScheduleFrequency), nullable=False)
    recipients    = Column(JSON, nullable=False)   # list of email addresses
    format        = Column(String(10), default="pdf")  # "pdf" | "xlsx"
    is_active     = Column(Boolean, default=True)
    last_sent_at  = Column(String(50), nullable=True)
    created_by    = Column(UUIDType(), ForeignKey("users.id"), nullable=True)
