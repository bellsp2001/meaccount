"""
Leave/HR Models: LeaveType, LeaveBalance, LeaveRequest

Thai labor law reference (พ.ร.บ.คุ้มครองแรงงาน): employees are entitled to
at least 6 paid annual leave days after 1 full year of service (many
employers grant more), 30 paid sick leave days/year, and unlimited unpaid
personal leave subject to employer discretion. This module implements the
common employer policy (sick/annual/personal/unpaid) as configurable
LeaveType records rather than hardcoding the statutory minimums, since real
companies' actual policies vary and often exceed the legal floor.
"""
import enum
from sqlalchemy import Column, String, Numeric, Boolean, ForeignKey, Text, Date, Integer, DateTime
from datetime import datetime
from sqlalchemy.orm import relationship
from core.database import Base
from models.base import UUIDMixin, TimestampMixin, UUIDType


class LeaveRequestStatus(str, enum.Enum):
    PENDING   = "pending"
    APPROVED  = "approved"
    REJECTED  = "rejected"
    CANCELLED = "cancelled"


# ── LeaveType (configurable per company: annual, sick, personal, unpaid) ──
class LeaveType(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "leave_types"

    code          = Column(String(20),  nullable=False, unique=True, index=True)
    name          = Column(String(100), nullable=False)
    is_paid       = Column(Boolean, default=True, nullable=False)
    default_days_per_year = Column(Numeric(6,2), default=0, nullable=False)   # 0 for unpaid/unlimited types
    requires_approval = Column(Boolean, default=True, nullable=False)
    is_active     = Column(Boolean, default=True)


# ── LeaveBalance (per employee, per leave type, per year) ────────
class LeaveBalance(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "leave_balances"

    employee_id   = Column(UUIDType(), ForeignKey("employees.id"), nullable=False)
    leave_type_id = Column(UUIDType(), ForeignKey("leave_types.id"), nullable=False)
    year          = Column(Integer, nullable=False)

    entitled_days = Column(Numeric(6,2), default=0, nullable=False)   # allocated this year
    used_days     = Column(Numeric(6,2), default=0, nullable=False)   # consumed via approved requests
    carried_over  = Column(Numeric(6,2), default=0, nullable=False)   # brought forward from prior year

    employee   = relationship("Employee")
    leave_type = relationship("LeaveType")


# ── LeaveRequest ───────────────────────────────────────────────
class LeaveRequest(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "leave_requests"

    employee_id   = Column(UUIDType(), ForeignKey("employees.id"), nullable=False)
    leave_type_id = Column(UUIDType(), ForeignKey("leave_types.id"), nullable=False)
    start_date    = Column(Date, nullable=False)
    end_date      = Column(Date, nullable=False)
    days_requested = Column(Numeric(6,2), nullable=False)   # supports half-days
    reason        = Column(Text, nullable=True)

    status        = Column(String(20), default=LeaveRequestStatus.PENDING.value, nullable=False)
    approved_by   = Column(UUIDType(), ForeignKey("users.id"), nullable=True)
    approved_at   = Column(DateTime, nullable=True)
    rejection_reason = Column(Text, nullable=True)

    employee   = relationship("Employee")
    leave_type = relationship("LeaveType")
    approver   = relationship("User", foreign_keys=[approved_by])
