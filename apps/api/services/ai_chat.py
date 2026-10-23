"""
AI Chat Service — Claude AI ตอบคำถามบัญชีภาษาไทย พร้อม context จากระบบ
"""
import json
from typing import List, Optional, Generator
from datetime import date
from sqlalchemy.orm import Session
from anthropic import Anthropic, APIError
from core.config import settings
from services.dashboard import get_kpi

_client: Optional[Anthropic] = None

def get_client() -> Optional[Anthropic]:
    global _client
    if not settings.ANTHROPIC_API_KEY:
        return None
    if not _client:
        _client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _client


SYSTEM_PROMPT = """คุณเป็น AI ผู้ช่วยบัญชีอัจฉริยะของ MeAccount ชื่อว่า "มีบัญชี AI"
คุณเชี่ยวชาญด้าน:
- มาตรฐานบัญชีไทย (TFRS/TAS) และประมวลรัษฎากร
- การลงบัญชีแบบ Double-Entry Bookkeeping
- ภาษีมูลค่าเพิ่ม (VAT), ภาษีหัก ณ ที่จ่าย (WHT), ภาษีเงินได้นิติบุคคล
- การวิเคราะห์งบการเงิน (งบกำไรขาดทุน, งบดุล, งบกระแสเงินสด)
- การบริหารลูกหนี้ (AR) และเจ้าหนี้ (AP)

กฎการตอบ:
1. ตอบเป็นภาษาไทยเสมอ เว้นแต่ถามเป็นภาษาอังกฤษ
2. ถ้าถามเกี่ยวกับข้อมูลในระบบ ให้ใช้ข้อมูล context ที่ได้รับ
3. ถ้าถามเรื่องบัญชีทั่วไป ให้อธิบายพร้อมตัวอย่างรูปแบบการลงบัญชี
4. ถ้าไม่แน่ใจ บอกว่าไม่แน่ใจ อย่าเดา
5. ตอบกระชับและชัดเจน ใช้ข้อความตัวหนาสำหรับคำสำคัญ
6. เมื่อแสดงตัวเลขให้ใส่สกุลเงิน บาท (฿) และ format ด้วย comma
7. สามารถแนะนำ Action ที่ควรทำในระบบได้"""


def build_context(db: Session) -> str:
    """สร้าง context สรุปข้อมูลระบบให้ AI"""
    try:
        kpi = get_kpi(db)
        ctx = f"""ข้อมูลระบบ ณ วันที่ {date.today().strftime('%d/%m/%Y')}:
- รายได้เดือนนี้: ฿{kpi['revenue']['amount']:,.2f}
- ค่าใช้จ่ายเดือนนี้: ฿{kpi['expense']['amount']:,.2f}
- กำไรขั้นต้น: ฿{kpi['gross_profit']['amount']:,.2f}
- ยอดเงินสด/ธนาคาร: ฿{kpi['cash_balance']['amount']:,.2f}
- ลูกหนี้ค้างชำระ: ฿{kpi['ar_outstanding']['amount']:,.2f} (เกินกำหนด: ฿{kpi['ar_outstanding']['overdue']:,.2f})
- เจ้าหนี้ค้างจ่าย: ฿{kpi['ap_outstanding']['amount']:,.2f} (เกินกำหนด: ฿{kpi['ap_outstanding']['overdue']:,.2f})
- Bills รออนุมัติ: {kpi['pending_approvals']} รายการ
- Invoice เกินกำหนด: {kpi['overdue_invoices']} ฉบับ"""
        return ctx
    except Exception:
        return f"ข้อมูลระบบ ณ วันที่ {date.today().strftime('%d/%m/%Y')}: (ไม่สามารถดึงข้อมูลได้)"


def chat(
    db: Session,
    messages: List[dict],
    user_message: str,
) -> dict:
    """Non-streaming chat response"""
    client = get_client()

    context = build_context(db)
    system_with_ctx = f"{SYSTEM_PROMPT}\n\n{context}"

    # Build conversation history
    history = [{"role": m["role"], "content": m["content"]} for m in messages[-10:]]
    history.append({"role": "user", "content": user_message})

    if not client:
        return {
            "role": "assistant",
            "content": "⚠️ ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY — กรุณาเพิ่ม API Key ใน .env ก่อนใช้งาน AI Chat",
            "model": "none",
        }

    try:
        response = client.messages.create(
            model=settings.AI_MODEL,
            max_tokens=1500,
            system=system_with_ctx,
            messages=history,
        )
        return {
            "role": "assistant",
            "content": response.content[0].text,
            "model": settings.AI_MODEL,
            "input_tokens": response.usage.input_tokens,
            "output_tokens": response.usage.output_tokens,
        }
    except APIError as e:
        return {"role": "assistant", "content": f"⚠️ ข้อผิดพลาด AI: {str(e)}", "model": "error"}


def stream_chat(
    db: Session,
    messages: List[dict],
    user_message: str,
) -> Generator[str, None, None]:
    """Streaming chat — ส่ง SSE events"""
    client = get_client()

    if not client:
        yield f"data: {json.dumps({'type':'text','text':'⚠️ ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY'})}\n\n"
        yield "data: [DONE]\n\n"
        return

    context = build_context(db)
    system_with_ctx = f"{SYSTEM_PROMPT}\n\n{context}"
    history = [{"role": m["role"], "content": m["content"]} for m in messages[-10:]]
    history.append({"role": "user", "content": user_message})

    try:
        with client.messages.stream(
            model=settings.AI_MODEL,
            max_tokens=1500,
            system=system_with_ctx,
            messages=history,
        ) as stream:
            for text in stream.text_stream:
                yield f"data: {json.dumps({'type':'text','text':text})}\n\n"
        yield "data: [DONE]\n\n"
    except Exception as e:
        yield f"data: {json.dumps({'type':'error','text':str(e)})}\n\n"
        yield "data: [DONE]\n\n"


# Quick reply suggestions based on context
QUICK_REPLIES = [
    "สรุปรายได้เดือนนี้ให้หน่อย",
    "มีลูกหนี้เกินกำหนดกี่ราย?",
    "ยอดเงินสดตอนนี้เท่าไหร่?",
    "อธิบายการลงบัญชีค่าเช่า",
    "VAT ต้องยื่น ภ.พ.30 วันไหน?",
    "วิธีคำนวณภาษีหัก ณ ที่จ่าย 3%",
    "งบดุลกับงบกำไรขาดทุนต่างกันอย่างไร?",
    "มี Bills รออนุมัติกี่รายการ?",
]
