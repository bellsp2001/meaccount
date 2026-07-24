"""
AI Tax Service — ตรวจสอบ VAT + วางแผนภาษีนิติบุคคล
"""
import json
from decimal import Decimal
from datetime import date, timedelta
from typing import Optional, List
from sqlalchemy.orm import Session
from anthropic import Anthropic

from core.config import settings
from models.ar import Invoice
from models.ap import Bill
from schemas.tax import VATCheckResponse, TaxPlanningResponse

_client: Optional[Anthropic] = None

def get_client() -> Optional[Anthropic]:
    global _client
    if not settings.ANTHROPIC_API_KEY:
        return None
    if not _client:
        _client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _client


def check_vat_compliance(db: Session, period_month: int, period_year: int) -> VATCheckResponse:
    """ตรวจสอบความถูกต้องของ VAT ก่อนยื่น — หา Invoice/Bill ที่ยังไม่ Post GL"""
    period_start = date(period_year, period_month, 1)
    if period_month == 12:
        period_end = date(period_year, 12, 31)
    else:
        period_end = date(period_year, period_month + 1, 1) - timedelta(days=1)

    unposted_invoices = db.query(Invoice).filter(
        Invoice.date >= period_start, Invoice.date <= period_end,
        Invoice.gl_posted == False, Invoice.status != "cancelled",
        Invoice.is_deleted == False,
    ).count()

    unposted_bills = db.query(Bill).filter(
        Bill.date >= period_start, Bill.date <= period_end,
        Bill.gl_posted == False, Bill.status != "cancelled",
        Bill.is_deleted == False,
    ).count()

    issues = []
    recommendations = []

    if unposted_invoices > 0:
        issues.append(f"พบ Invoice ที่ยังไม่ Post GL {unposted_invoices} ฉบับ — จะไม่ถูกนับใน VAT ขาย")
        recommendations.append("ตรวจสอบและ Post GL Invoice ที่ค้างอยู่ก่อนยื่น ภ.พ.30")

    if unposted_bills > 0:
        issues.append(f"พบ Bill ที่ยังไม่ Post GL {unposted_bills} รายการ — จะไม่ถูกนับใน VAT ซื้อ")
        recommendations.append("ตรวจสอบและ Post GL Bill ที่ค้างอยู่ก่อนยื่น ภ.พ.30")

    # Check for invoices without VAT set correctly
    zero_vat_invoices = db.query(Invoice).filter(
        Invoice.date >= period_start, Invoice.date <= period_end,
        Invoice.subtotal > 0, Invoice.vat_amount == 0,
        Invoice.is_deleted == False,
    ).count()
    if zero_vat_invoices > 0:
        issues.append(f"พบ Invoice ที่มียอดขายแต่ VAT = 0 จำนวน {zero_vat_invoices} ฉบับ")
        recommendations.append("ตรวจสอบว่า Invoice เหล่านี้ควรมี VAT หรือเป็นรายการยกเว้นภาษี")

    is_correct = len(issues) == 0
    confidence = 0.9 if is_correct else 0.6

    if not recommendations:
        recommendations.append("ข้อมูลครบถ้วน พร้อมยื่น ภ.พ.30")

    # AI enhancement
    client = get_client()
    if client and issues:
        try:
            resp = client.messages.create(
                model=settings.AI_MODEL, max_tokens=400,
                system="คุณเป็นผู้เชี่ยวชาญภาษีมูลค่าเพิ่มไทย ให้คำแนะนำเพิ่มเติมแบบสั้นกระชับ ตอบ JSON: {\"tips\": [\"tip1\"]}",
                messages=[{"role": "user", "content": f"พบปัญหาก่อนยื่น ภ.พ.30: {'; '.join(issues)}\nมีคำแนะนำเพิ่มเติมไหม?"}],
            )
            raw = resp.content[0].text.strip()
            if raw.startswith("```"):
                raw = raw.split("```")[1].lstrip("json")
            data = json.loads(raw)
            recommendations.extend(data.get("tips", []))
        except Exception:
            pass

    return VATCheckResponse(
        period=f"{period_month:02d}/{period_year}",
        is_correct=is_correct, issues=issues, recommendations=recommendations,
        unposted_invoices=unposted_invoices, unposted_bills=unposted_bills,
        confidence=confidence,
    )


# ── Corporate Tax Planning ──────────────────────────────────────
# อัตราภาษีนิติบุคคล SME (ทุนจดทะเบียน ≤5 ล้าน, รายได้ ≤30 ล้าน)
CORP_TAX_BRACKETS_SME = [
    (Decimal("300000"),  Decimal("0")),      # ยกเว้น 300,000 แรก
    (Decimal("3000000"), Decimal("0.15")),   # 300,001 - 3,000,000 = 15%
    (None,                Decimal("0.20")),   # เกิน 3,000,000 = 20%
]


def calc_corporate_tax_sme(net_profit: Decimal) -> Decimal:
    if net_profit <= 0:
        return Decimal("0")
    tax = Decimal("0")
    lower = Decimal("0")
    for upper, rate in CORP_TAX_BRACKETS_SME:
        if upper is None:
            tax += (net_profit - lower) * rate
            break
        if net_profit > upper:
            tax += (upper - lower) * rate
            lower = upper
        else:
            tax += (net_profit - lower) * rate
            break
    return tax.quantize(Decimal("1"))


def plan_corporate_tax(payload) -> TaxPlanningResponse:
    net_profit = payload.annual_revenue - payload.annual_expense
    estimated_tax = calc_corporate_tax_sme(net_profit)

    suggestions = [
        "เก็บหลักฐานค่าใช้จ่ายทางธุรกิจให้ครบถ้วนเพื่อหักลดหย่อนได้เต็มที่",
        "พิจารณาซื้อสินทรัพย์ที่จำเป็นก่อนสิ้นปีบัญชีเพื่อหักค่าเสื่อมราคา",
        "ตรวจสอบสิทธิประโยชน์ทางภาษีจาก BOI หากมีการลงทุนในกิจการที่ส่งเสริม",
    ]
    if net_profit > Decimal("3000000"):
        suggestions.append("กำไรเกิน 3 ล้านบาท เข้าอัตราภาษี 20% ควรวางแผนกระจายรายได้หรือลงทุนเพิ่มเพื่อลดฐานภาษี")

    explanation = (
        f"กำไรสุทธิประมาณการ {net_profit:,.2f} บาท "
        f"อัตราภาษี SME: ยกเว้น 300,000 บาทแรก, 15% สำหรับ 300,001-3,000,000, 20% ส่วนที่เกิน "
        f"ภาษีประมาณการ {estimated_tax:,.2f} บาท"
    )

    client = get_client()
    if client:
        try:
            resp = client.messages.create(
                model=settings.AI_MODEL, max_tokens=500,
                system="คุณเป็นที่ปรึกษาภาษีนิติบุคคลไทย ให้คำแนะนำวางแผนภาษีที่ถูกกฎหมาย 3-5 ข้อ เป็นภาษาไทย ตอบ JSON: {\"suggestions\": [\"...\"]}",
                messages=[{"role": "user", "content":
                    f"บริษัทมีรายได้ {payload.annual_revenue:,.0f} บาท/ปี ค่าใช้จ่าย {payload.annual_expense:,.0f} บาท/ปี "
                    f"ประเภทธุรกิจ: {payload.business_type or 'ทั่วไป'} มีคำแนะนำวางแผนภาษีอย่างไร?"}],
            )
            raw = resp.content[0].text.strip()
            if raw.startswith("```"):
                raw = raw.split("```")[1].lstrip("json")
            data = json.loads(raw)
            if data.get("suggestions"):
                suggestions = data["suggestions"]
        except Exception:
            pass

    return TaxPlanningResponse(
        estimated_net_profit=net_profit, estimated_corporate_tax=estimated_tax,
        tax_rate_applied="SME progressive (0%/15%/20%)",
        suggestions=suggestions, explanation=explanation,
    )
