"""
Fraud Detection Models: RiskAlert, UserBehaviorProfile
"""
import enum
from sqlalchemy import Column, String, Numeric, Boolean, Enum, ForeignKey, Text, DateTime, Integer
from datetime import datetime
from sqlalchemy.orm import relationship
from core.database import Base
from models.base import UUIDMixin, TimestampMixin, UUIDType


class RiskLevel(str, enum.Enum):
    LOW      = "low"
    MEDIUM   = "medium"
    HIGH     = "high"
    CRITICAL = "critical"


class AlertStatus(str, enum.Enum):
    OPEN         = "open"
    INVESTIGATING= "investigating"
    RESOLVED     = "resolved"
    DISMISSED    = "dismissed"


class FraudPattern(str, enum.Enum):
    GHOST_VENDOR       = "ghost_vendor"        # ผู้ขายผี — บัญชีใหม่ไม่มีประวัติ จ่ายเงินก้อนใหญ่ทันที
    DUPLICATE_PAYMENT  = "duplicate_payment"    # จ่ายซ้ำ
    ROUND_TRIPPING     = "round_tripping"       # เงินหมุนวนกลับมาที่เดิม
    SPLIT_TRANSACTION  = "split_transaction"    # แตกรายการเพื่อหลบ approval threshold
    OFF_HOURS_ACTIVITY = "off_hours_activity"   # ทำรายการนอกเวลาทำการผิดปกติ
    RAPID_SEQUENCE     = "rapid_sequence"       # ทำรายการติดกันเร็วผิดปกติ (bot-like)
    UNUSUAL_APPROVER   = "unusual_approver"     # ผู้อนุมัติเดียวกับผู้สร้างรายการ
    NEW_VENDOR_LARGE   = "new_vendor_large"     # ผู้ขายใหม่ + ยอดเงินสูงผิดปกติ


# ── RiskAlert ──────────────────────────────────────────────────
class RiskAlert(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "risk_alerts"

    pattern        = Column(Enum(FraudPattern), nullable=False, index=True)
    risk_level     = Column(Enum(RiskLevel), nullable=False, index=True)
    risk_score     = Column(Numeric(5,2), nullable=False)   # 0-100

    title          = Column(String(255), nullable=False)
    description    = Column(Text, nullable=False)

    resource_type  = Column(String(30), nullable=False)   # "bill" | "payment" | "journal" | "invoice"
    resource_id    = Column(UUIDType(), nullable=True)
    reference      = Column(String(100), nullable=True)
    amount         = Column(Numeric(18,2), nullable=True)

    related_user_id= Column(UUIDType(), ForeignKey("users.id"), nullable=True)

    status         = Column(Enum(AlertStatus), default=AlertStatus.OPEN, nullable=False)
    investigated_by= Column(UUIDType(), ForeignKey("users.id"), nullable=True)
    resolution_note= Column(Text, nullable=True)
    resolved_at    = Column(DateTime, nullable=True)

    detected_at    = Column(DateTime, default=datetime.utcnow, nullable=False)

    related_user = relationship("User", foreign_keys=[related_user_id])
    investigator = relationship("User", foreign_keys=[investigated_by])


# ── UserBehaviorProfile (baseline สำหรับเทียบพฤติกรรมผิดปกติ) ────
class UserBehaviorProfile(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "user_behavior_profiles"

    user_id             = Column(UUIDType(), ForeignKey("users.id"), nullable=False, unique=True)
    avg_transactions_per_day = Column(Numeric(8,2), default=0)
    avg_transaction_amount   = Column(Numeric(18,2), default=0)
    typical_hour_start        = Column(Integer, default=8)    # ชั่วโมงเริ่มทำงานปกติ
    typical_hour_end          = Column(Integer, default=18)
    last_calculated_at        = Column(DateTime, default=datetime.utcnow)

    user = relationship("User")
