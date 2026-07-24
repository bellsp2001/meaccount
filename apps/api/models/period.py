"""
Period Closing Model — ปิดบัญชีประจำงวด
"""
import enum
from sqlalchemy import Column, String, Date, Enum, ForeignKey, Text, Boolean
from sqlalchemy.orm import relationship
from core.database import Base
from models.base import UUIDMixin, TimestampMixin, UUIDType


class PeriodStatus(str, enum.Enum):
    OPEN   = "open"
    CLOSED = "closed"


class AccountingPeriod(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "accounting_periods"

    period_month = Column(String(7), nullable=False, unique=True, index=True)  # "2025-03"
    start_date   = Column(Date, nullable=False)
    end_date     = Column(Date, nullable=False)
    status       = Column(Enum(PeriodStatus), default=PeriodStatus.OPEN, nullable=False)
    closed_date  = Column(Date, nullable=True)
    closed_by    = Column(UUIDType(), ForeignKey("users.id"), nullable=True)
    note         = Column(Text, nullable=True)

    # Snapshot of closing journal (P&L → Retained Earnings)
    closing_journal_id = Column(UUIDType(), ForeignKey("journals.id"), nullable=True)
