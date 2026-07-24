"""
Natural Language Report Service — ถามคำถามภาษาไทย แล้ว AI แปลงเป็น query + สร้างคำตอบ
"""
import json, re
from decimal import Decimal
from datetime import date, timedelta
from typing import Optional
from sqlalchemy.orm import Session
from anthropic import Anthropic

from core.config import settings
from services.dashboard import get_kpi
from services.reports import get_profit_loss, get_balance_sheet
from services.ar import get_aging_report
from schemas.report_builder import NLReportResponse

_client: Optional[Anthropic] = None

def get_client() -> Optional[Anthropic]:
    global _client
    if not settings.ANTHROPIC_API_KEY:
        return None
    if not _client:
        _client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _client


def generate_nl_report(db: Session, question: str) -> NLReportResponse:
    """แปลงคำถามภาษาไทยเป็นรายงาน — ใช้ pattern matching + data fetch + AI summary"""
    q_lower = question.lower()
    today = date.today()
    month_start = today.replace(day=1)

    data = None
    interpretation = ""
    chart_suggestion = None

    # Pattern: รายได้ / กำไร / ขาดทุน
    if any(k in q_lower for k in ["รายได้", "กำไร", "ขาดทุน", "revenue", "profit"]):
        pl = get_profit_loss(db, month_start, today)
        data = {
            "revenue": float(pl.revenue.total), "cogs": float(pl.cogs.total),
            "gross_profit": float(pl.gross_profit), "expenses": float(pl.expenses.total),
            "net_profit": float(pl.net_profit),
        }
        interpretation = "คำถามเกี่ยวกับรายได้/กำไร — ดึงข้อมูลจากงบกำไรขาดทุนเดือนปัจจุบัน"
        chart_suggestion = "bar"
        answer = (
            f"เดือนนี้ ({month_start.strftime('%B %Y')}) บริษัทมีรายได้ ฿{data['revenue']:,.2f} "
            f"ต้นทุนขาย ฿{data['cogs']:,.2f} กำไรขั้นต้น ฿{data['gross_profit']:,.2f} "
            f"ค่าใช้จ่ายดำเนินงาน ฿{data['expenses']:,.2f} "
            f"และ{'กำไร' if data['net_profit'] >= 0 else 'ขาดทุน'}สุทธิ ฿{abs(data['net_profit']):,.2f}"
        )

    # Pattern: ลูกหนี้ / เกินกำหนด
    elif any(k in q_lower for k in ["ลูกหนี้", "เกินกำหนด", "ค้างชำระ", "receivable", "overdue"]):
        aging = get_aging_report(db, today)
        data = aging
        interpretation = "คำถามเกี่ยวกับลูกหนี้ — ดึงข้อมูลจาก Aging Report"
        chart_suggestion = "pie"
        overdue_count = aging["1_30"]["count"] + aging["31_60"]["count"] + aging["61_90"]["count"] + aging["over_90"]["count"]
        answer = (
            f"ลูกหนี้ค้างชำระทั้งหมด ฿{aging['grand_total']:,.2f} "
            f"แบ่งเป็นยังไม่ถึงกำหนด ฿{aging['current']['total']:,.2f} ({aging['current']['count']} ราย) "
            f"และเกินกำหนดชำระ {overdue_count} ราย รวม ฿{aging['grand_total'] - aging['current']['total']:,.2f}"
        )

    # Pattern: เงินสด / ธนาคาร
    elif any(k in q_lower for k in ["เงินสด", "ธนาคาร", "cash", "bank"]):
        kpi = get_kpi(db)
        data = {"cash_balance": kpi["cash_balance"]["amount"]}
        interpretation = "คำถามเกี่ยวกับเงินสด — ดึงข้อมูลจาก Dashboard KPI"
        answer = f"ยอดเงินสดและเงินฝากธนาคารปัจจุบันมีทั้งหมด ฿{data['cash_balance']:,.2f}"

    # Pattern: สินทรัพย์ / หนี้สิน / งบดุล
    elif any(k in q_lower for k in ["สินทรัพย์", "หนี้สิน", "งบดุล", "asset", "liability"]):
        bs = get_balance_sheet(db, today)
        data = {"total_assets": float(bs.total_assets), "total_liabilities": float(bs.total_liabilities), "total_equity": float(bs.equity.total)}
        interpretation = "คำถามเกี่ยวกับงบดุล — ดึงข้อมูลจาก Balance Sheet"
        chart_suggestion = "bar"
        answer = (
            f"ณ วันที่ {today.strftime('%d/%m/%Y')} บริษัทมีสินทรัพย์รวม ฿{data['total_assets']:,.2f} "
            f"หนี้สินรวม ฿{data['total_liabilities']:,.2f} และส่วนของผู้ถือหุ้น ฿{data['total_equity']:,.2f}"
        )

    # Pattern: Bills รออนุมัติ / pending
    elif any(k in q_lower for k in ["รออนุมัติ", "pending", "อนุมัติ"]):
        kpi = get_kpi(db)
        data = {"pending_approvals": kpi["pending_approvals"]}
        interpretation = "คำถามเกี่ยวกับรายการรออนุมัติ"
        answer = f"ขณะนี้มี Bills ที่รออนุมัติทั้งหมด {kpi['pending_approvals']} รายการ"

    else:
        # Fallback: general KPI summary
        kpi = get_kpi(db)
        data = kpi
        interpretation = "ไม่พบรูปแบบคำถามที่ตรงกัน แสดงข้อมูลสรุปทั่วไปแทน"
        answer = (
            f"สรุปข้อมูลทั่วไป: รายได้เดือนนี้ ฿{kpi['revenue']['amount']:,.2f}, "
            f"เงินสด ฿{kpi['cash_balance']['amount']:,.2f}, "
            f"ลูกหนี้ค้างชำระ ฿{kpi['ar_outstanding']['amount']:,.2f}"
        )

    # AI enhancement — make answer more natural if API available
    client = get_client()
    if client:
        try:
            resp = client.messages.create(
                model=settings.AI_MODEL, max_tokens=400,
                system="คุณเป็นผู้ช่วยบัญชี AI สรุปข้อมูลทางการเงินให้เข้าใจง่าย ตอบเป็นภาษาไทยกระชับ 2-3 ประโยค",
                messages=[{"role": "user", "content": f"คำถาม: {question}\nข้อมูลดิบ: {json.dumps(data, ensure_ascii=False, default=str)}\nสรุปให้เข้าใจง่าย"}],
            )
            ai_answer = resp.content[0].text.strip()
            if ai_answer:
                answer = ai_answer
        except Exception:
            pass  # keep rule-based answer

    return NLReportResponse(
        question=question, interpretation=interpretation, answer=answer,
        data=data, chart_suggestion=chart_suggestion,
    )
