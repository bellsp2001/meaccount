"""
AI Payroll Service — ตรวจสอบความถูกต้องภาษีหัก ณ ที่จ่าย + วิเคราะห์โครงสร้างเงินเดือน
"""
import json
from decimal import Decimal
from typing import Optional
from sqlalchemy.orm import Session
from anthropic import Anthropic

from core.config import settings
from models.payroll import Employee, Payslip
from services.tax_calc import calc_payslip
from schemas.payroll import TaxCheckResponse

_client: Optional[Anthropic] = None

def get_client() -> Optional[Anthropic]:
    global _client
    if not settings.ANTHROPIC_API_KEY:
        return None
    if not _client:
        _client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _client


def check_withholding_tax(db: Session, employee_id, period_month: int, period_year: int) -> TaxCheckResponse:
    """ตรวจสอบว่าภาษีหัก ณ ที่จ่ายที่คำนวณไว้ถูกต้องหรือไม่ (recompute + compare)"""
    emp = db.query(Employee).filter(Employee.id == employee_id).first()
    if not emp:
        raise ValueError("ไม่พบพนักงาน")

    payslip = db.query(Payslip).filter(
        Payslip.employee_id == employee_id,
        Payslip.period_month == period_month,
        Payslip.period_year == period_year,
    ).first()

    # Recalculate from scratch
    calc = calc_payslip(
        base_salary=emp.base_salary,
        marital_status=emp.marital_status.value if hasattr(emp.marital_status, "value") else emp.marital_status,
        num_children=emp.num_children, sso_enrolled=emp.sso_enrolled,
    )
    calculated_wht = calc["withholding_tax"]
    system_wht = payslip.withholding_tax if payslip else Decimal("0")
    diff = abs(calculated_wht - system_wht)
    is_correct = diff <= Decimal("1")  # tolerance 1 บาท (rounding)

    recommendations = []
    if not is_correct:
        recommendations.append(f"พบส่วนต่างภาษี {diff:,.2f} บาท ควรตรวจสอบการคำนวณใหม่")
    if emp.marital_status.value == "married" if hasattr(emp.marital_status, "value") else emp.marital_status == "married":
        recommendations.append("ตรวจสอบว่าคู่สมรสมีรายได้หรือไม่ — หากมีรายได้ไม่สามารถหักลดหย่อนคู่สมรสได้")
    if emp.num_children > 0:
        recommendations.append(f"มีบุตร {emp.num_children} คน ตรวจสอบเอกสารรับรองบุตรให้ครบถ้วน")

    explanation = (
        f"คำนวณใหม่ได้ภาษี {calculated_wht:,.2f} บาท/เดือน "
        f"เทียบกับระบบ {system_wht:,.2f} บาท "
        + ("ตรงกัน ✓" if is_correct else f"ต่างกัน {diff:,.2f} บาท ⚠")
    )

    # AI enhancement (optional)
    client = get_client()
    if client:
        try:
            resp = client.messages.create(
                model=settings.AI_MODEL, max_tokens=400,
                system="คุณเป็นผู้เชี่ยวชาญภาษีเงินได้บุคคลธรรมดาไทย ตรวจสอบและให้คำแนะนำเพิ่มเติมแบบสั้นกระชับเป็นภาษาไทย ตอบ JSON: {\"additional_tips\": [\"tip1\",\"tip2\"]}",
                messages=[{"role": "user", "content":
                    f"พนักงานเงินเดือน {emp.base_salary:,.0f} บาท สถานะ {emp.marital_status}, บุตร {emp.num_children} คน "
                    f"ภาษีคำนวณได้ {calculated_wht:,.2f} บาท/เดือน มีคำแนะนำเพิ่มเติมเรื่องการวางแผนภาษีไหม?"}],
            )
            raw = resp.content[0].text.strip()
            if raw.startswith("```"):
                raw = raw.split("```")[1].lstrip("json")
            data = json.loads(raw)
            recommendations.extend(data.get("additional_tips", []))
        except Exception:
            pass

    return TaxCheckResponse(
        is_correct=is_correct, calculated_wht=calculated_wht, system_wht=system_wht,
        difference=diff, explanation=explanation, recommendations=recommendations,
    )


def analyze_salary_structure(db: Session) -> dict:
    """วิเคราะห์โครงสร้างเงินเดือนทั้งบริษัท"""
    employees = db.query(Employee).filter(Employee.status == "active", Employee.is_deleted == False).all()
    if not employees:
        return {"message": "ไม่มีข้อมูลพนักงาน", "departments": []}

    by_dept = {}
    for e in employees:
        dept = e.department or "ไม่ระบุแผนก"
        by_dept.setdefault(dept, []).append(float(e.base_salary))

    dept_stats = []
    for dept, salaries in by_dept.items():
        dept_stats.append({
            "department": dept, "count": len(salaries),
            "avg_salary": round(sum(salaries) / len(salaries), 2),
            "min_salary": min(salaries), "max_salary": max(salaries),
            "total_cost": round(sum(salaries), 2),
        })

    total_payroll = sum(float(e.base_salary) for e in employees)
    return {
        "total_employees": len(employees),
        "total_monthly_payroll": round(total_payroll, 2),
        "avg_salary": round(total_payroll / len(employees), 2),
        "departments": sorted(dept_stats, key=lambda x: x["total_cost"], reverse=True),
    }
