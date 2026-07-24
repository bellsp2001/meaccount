"""
Tax Models: VATReturn (ภ.พ.30), WithholdingCertificate (หนังสือรับรองหัก ณ ที่จ่าย)
"""
import enum
from sqlalchemy import (Column, String, Numeric, Boolean, Enum, ForeignKey,
                        Text, Date, Integer)
from sqlalchemy.orm import relationship
from core.database import Base
from models.base import UUIDMixin, TimestampMixin, UUIDType


class VATReturnStatus(str, enum.Enum):
    DRAFT     = "draft"
    SUBMITTED = "submitted"
    ACCEPTED  = "accepted"


class WHTType(str, enum.Enum):
    PND1  = "pnd1"    # หัก ณ ที่จ่ายเงินเดือน
    PND3  = "pnd3"    # หัก ณ ที่จ่ายบุคคลธรรมดา
    PND53 = "pnd53"   # หัก ณ ที่จ่ายนิติบุคคล


class WHTCertStatus(str, enum.Enum):
    DRAFT   = "draft"
    ISSUED  = "issued"
    FILED   = "filed"


# ── VAT Return (ภ.พ.30) ─────────────────────────────────────────
class VATReturn(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "vat_returns"

    period_month     = Column(Integer, nullable=False)   # 1-12
    period_year      = Column(Integer, nullable=False)
    status           = Column(Enum(VATReturnStatus), default=VATReturnStatus.DRAFT, nullable=False)

    # Output VAT (ขาย)
    sales_amount     = Column(Numeric(18,2), default=0)   # ยอดขายไม่รวม VAT
    output_vat       = Column(Numeric(18,2), default=0)   # VAT ขาย (7%)

    # Input VAT (ซื้อ)
    purchase_amount  = Column(Numeric(18,2), default=0)
    input_vat        = Column(Numeric(18,2), default=0)   # VAT ซื้อ (7%)

    net_vat          = Column(Numeric(18,2), default=0)   # output - input (บวก=ต้องจ่าย, ลบ=ขอคืน)
    submitted_date   = Column(Date, nullable=True)
    due_date         = Column(Date, nullable=True)         # วันที่ 15 ของเดือนถัดไป

    note             = Column(Text, nullable=True)
    xml_generated    = Column(Boolean, default=False)
    created_by       = Column(UUIDType(), ForeignKey("users.id"), nullable=True)


# ── Withholding Tax Certificate (หนังสือรับรองหัก ณ ที่จ่าย) ─────
class WithholdingCertificate(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "withholding_certificates"

    number         = Column(String(30),  nullable=False, unique=True, index=True)  # WHT-202502-0001
    wht_type       = Column(Enum(WHTType), nullable=False)
    payer_name     = Column(String(255), nullable=False)   # ชื่อผู้จ่ายเงิน (บริษัทเรา)
    payer_tax_id   = Column(String(20),  nullable=True)
    payee_name     = Column(String(255), nullable=False)   # ชื่อผู้รับเงิน
    payee_tax_id   = Column(String(20),  nullable=True)
    payee_address  = Column(Text,        nullable=True)

    income_type    = Column(String(200), nullable=False)   # ประเภทเงินได้ (ค่าจ้าง, ค่าบริการ, ค่าเช่า ฯลฯ)
    payment_date   = Column(Date,        nullable=False)
    gross_amount   = Column(Numeric(18,2), nullable=False)
    wht_rate       = Column(Numeric(5,2),  nullable=False)
    wht_amount     = Column(Numeric(18,2), nullable=False)

    status         = Column(Enum(WHTCertStatus), default=WHTCertStatus.DRAFT, nullable=False)
    reference_type = Column(String(20),  nullable=True)   # "bill" | "payslip"
    reference_id   = Column(UUIDType(),  nullable=True)   # link to Bill.id or Payslip.id

    created_by     = Column(UUIDType(), ForeignKey("users.id"), nullable=True)
