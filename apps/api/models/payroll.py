"""
Payroll Models: Employee, SalaryStructure, Payslip, PayslipItem
"""
import enum
from sqlalchemy import (Column, String, Numeric, Boolean, Enum, ForeignKey,
                        Text, Date, Integer)
from sqlalchemy.orm import relationship
from core.database import Base
from models.base import UUIDMixin, TimestampMixin, UUIDType


class EmployeeStatus(str, enum.Enum):
    ACTIVE     = "active"
    ON_LEAVE   = "on_leave"
    TERMINATED = "terminated"


class MaritalStatus(str, enum.Enum):
    SINGLE  = "single"
    MARRIED = "married"


class PayslipStatus(str, enum.Enum):
    DRAFT     = "draft"
    APPROVED  = "approved"
    PAID      = "paid"
    CANCELLED = "cancelled"


# ── Employee ───────────────────────────────────────────────────
class Employee(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "employees"

    employee_code = Column(String(20),  nullable=False, unique=True, index=True)
    full_name     = Column(String(255), nullable=False, index=True)
    national_id   = Column(String(20),  nullable=True)   # เลขบัตรประชาชน
    position      = Column(String(200), nullable=True)
    department    = Column(String(200), nullable=True)
    start_date    = Column(Date,        nullable=False)
    end_date      = Column(Date,        nullable=True)
    status        = Column(Enum(EmployeeStatus), default=EmployeeStatus.ACTIVE, nullable=False)
    marital_status= Column(Enum(MaritalStatus),  default=MaritalStatus.SINGLE)
    num_children  = Column(Integer, default=0)     # จำนวนบุตร (สำหรับลดหย่อนภาษี)

    base_salary   = Column(Numeric(18,2), default=0, nullable=False)
    bank_name     = Column(String(100), nullable=True)
    bank_account  = Column(String(30),  nullable=True)
    email         = Column(String(255), nullable=True)
    phone         = Column(String(30),  nullable=True)

    # Social Security opt-in (บางกรณีอาจไม่เข้าประกันสังคม)
    sso_enrolled  = Column(Boolean, default=True)

    payslips = relationship("Payslip", back_populates="employee", lazy="dynamic")


# ── Payslip (สลิปเงินเดือนรายเดือน) ─────────────────────────────
class Payslip(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "payslips"

    number       = Column(String(30),  nullable=False, unique=True, index=True)  # PS-202502-EMP001
    employee_id  = Column(UUIDType(),  ForeignKey("employees.id"), nullable=False)
    period_month = Column(Integer,     nullable=False)   # 1-12
    period_year  = Column(Integer,     nullable=False)
    pay_date     = Column(Date,        nullable=False)
    status       = Column(Enum(PayslipStatus), default=PayslipStatus.DRAFT, nullable=False)

    # Earnings
    base_salary   = Column(Numeric(18,2), default=0)
    ot_hours      = Column(Numeric(8,2),  default=0)
    ot_rate       = Column(Numeric(8,2),  default=0)      # บาท/ชม.
    ot_amount     = Column(Numeric(18,2), default=0)
    allowance     = Column(Numeric(18,2), default=0)      # เบี้ยเลี้ยง/ค่าตำแหน่ง
    bonus         = Column(Numeric(18,2), default=0)
    gross_pay     = Column(Numeric(18,2), default=0)      # รวมรายได้ทั้งหมด

    # Deductions
    sso_employee  = Column(Numeric(18,2), default=0)      # ประกันสังคม (พนักงาน 5%, สูงสุด 750)
    withholding_tax = Column(Numeric(18,2), default=0)    # ภาษีหัก ณ ที่จ่าย
    other_deduction = Column(Numeric(18,2), default=0)
    total_deduction = Column(Numeric(18,2), default=0)

    net_pay       = Column(Numeric(18,2), default=0)      # รับสุทธิ

    # Employer contribution (คนละส่วนจากพนักงาน)
    sso_employer  = Column(Numeric(18,2), default=0)      # นายจ้างสมทบ 5% เช่นกัน

    note          = Column(Text, nullable=True)
    gl_posted     = Column(Boolean, default=False)
    created_by    = Column(UUIDType(), ForeignKey("users.id"), nullable=True)

    employee = relationship("Employee", back_populates="payslips")
    creator  = relationship("User", foreign_keys=[created_by])
