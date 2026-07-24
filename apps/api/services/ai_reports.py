"""
AI Financial Analysis Service — วิเคราะห์งบการเงินและให้คำแนะนำ
"""
import json
from decimal import Decimal
from datetime import date
from typing import Optional
from sqlalchemy.orm import Session
from anthropic import Anthropic

from core.config import settings
from schemas.reports import FinancialInsightResponse
from services.reports import get_profit_loss, get_balance_sheet, get_ratio_analysis

_client: Optional[Anthropic] = None

def get_client() -> Optional[Anthropic]:
    global _client
    if not settings.ANTHROPIC_API_KEY:
        return None
    if not _client:
        _client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _client


def analyze_financials(db: Session, period_from: date, period_to: date) -> FinancialInsightResponse:
    """AI วิเคราะห์งบการเงินภาพรวม พร้อม fallback แบบ rule-based"""
    pl = get_profit_loss(db, period_from, period_to)
    bs = get_balance_sheet(db, period_to)
    ratios = get_ratio_analysis(db, period_to)

    observations = []
    risks = []
    recommendations = []

    # Rule-based baseline analysis
    if pl.net_profit > 0:
        observations.append(f"บริษัทมีกำไรสุทธิ ฿{pl.net_profit:,.2f} ในช่วงเวลาที่วิเคราะห์")
    else:
        observations.append(f"บริษัทขาดทุนสุทธิ ฿{abs(pl.net_profit):,.2f} ในช่วงเวลาที่วิเคราะห์")
        risks.append("ผลประกอบการขาดทุน ควรทบทวนโครงสร้างต้นทุนและรายได้")

    if ratios.current_ratio is not None:
        if ratios.current_ratio < 1:
            risks.append(f"Current Ratio ต่ำกว่า 1 ({ratios.current_ratio:.2f}) — สภาพคล่องอาจไม่เพียงพอต่อหนี้สินระยะสั้น")
            recommendations.append("พิจารณาเร่งเก็บหนี้ลูกหนี้หรือหาแหล่งเงินทุนหมุนเวียนเพิ่ม")
        elif ratios.current_ratio > 3:
            observations.append(f"Current Ratio สูง ({ratios.current_ratio:.2f}) — มีสภาพคล่องส่วนเกิน อาจใช้เงินทุนได้มีประสิทธิภาพมากขึ้น")

    if ratios.gross_margin_pct is not None:
        observations.append(f"อัตรากำไรขั้นต้น {ratios.gross_margin_pct:.1f}%")
        if ratios.gross_margin_pct < 20:
            risks.append("อัตรากำไรขั้นต้นค่อนข้างต่ำ ควรพิจารณาทบทวนราคาขายหรือต้นทุนสินค้า")

    if not bs.is_balanced:
        risks.append("⚠ งบดุลไม่สมดุล (สินทรัพย์ ≠ หนี้สิน+ทุน) ควรตรวจสอบรายการบัญชี")

    if ratios.debt_to_equity is not None and ratios.debt_to_equity > 2:
        risks.append(f"อัตราส่วนหนี้สินต่อทุนสูง ({ratios.debt_to_equity:.2f}) — ความเสี่ยงทางการเงินเพิ่มขึ้น")
        recommendations.append("พิจารณาลดการพึ่งพาหนี้สินและเพิ่มทุนของกิจการ")

    if not recommendations:
        recommendations.append("ผลประกอบการอยู่ในเกณฑ์ปกติ ควรติดตามอย่างต่อเนื่อง")

    summary = (
        f"ช่วง {period_from} ถึง {period_to}: รายได้ ฿{pl.revenue.total:,.2f}, "
        f"กำไรสุทธิ ฿{pl.net_profit:,.2f} "
        f"({'กำไร' if pl.net_profit >= 0 else 'ขาดทุน'})"
    )

    # AI enhancement
    client = get_client()
    if client:
        try:
            resp = client.messages.create(
                model=settings.AI_MODEL, max_tokens=800,
                system="""คุณเป็นนักวิเคราะห์การเงินมืออาชีพ วิเคราะห์งบการเงินและให้ข้อสังเกต ความเสี่ยง และคำแนะนำเป็นภาษาไทย
ตอบ JSON เท่านั้น: {"summary": "...", "key_observations": ["..."], "risks": ["..."], "recommendations": ["..."]}""",
                messages=[{"role": "user", "content":
                    f"งบกำไรขาดทุน: รายได้ {pl.revenue.total:,.0f}, ต้นทุนขาย {pl.cogs.total:,.0f}, "
                    f"กำไรขั้นต้น {pl.gross_profit:,.0f}, ค่าใช้จ่าย {pl.expenses.total:,.0f}, กำไรสุทธิ {pl.net_profit:,.0f}\n"
                    f"งบดุล: สินทรัพย์รวม {bs.total_assets:,.0f}, หนี้สินรวม {bs.total_liabilities:,.0f}, ทุน {bs.equity.total:,.0f}\n"
                    f"อัตราส่วน: Current Ratio {ratios.current_ratio}, Gross Margin {ratios.gross_margin_pct}%, Net Margin {ratios.net_margin_pct}%\n"
                    f"วิเคราะห์และให้คำแนะนำเชิงลึก"}],
            )
            raw = resp.content[0].text.strip()
            if raw.startswith("```"):
                raw = raw.split("```")[1].lstrip("json")
            data = json.loads(raw)
            return FinancialInsightResponse(
                summary=data.get("summary", summary),
                key_observations=data.get("key_observations", observations),
                risks=data.get("risks", risks),
                recommendations=data.get("recommendations", recommendations),
                trend_vs_last_period=None,
            )
        except Exception:
            pass

    return FinancialInsightResponse(
        summary=summary, key_observations=observations, risks=risks,
        recommendations=recommendations, trend_vs_last_period=None,
    )
