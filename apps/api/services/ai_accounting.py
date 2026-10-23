"""
AI Accounting Service — Claude AI แนะนำการลงบัญชีจากคำอธิบายภาษาไทย
"""
import json
from decimal import Decimal
from typing import Optional
from uuid import UUID
from sqlalchemy.orm import Session
from anthropic import Anthropic

from core.config import settings
from models.accounting import Account, AccountTypeEnum, NormalBalance
from schemas.accounting import JournalEntryCreate, AISuggestResponse


_client: Optional[Anthropic] = None

def get_ai_client() -> Optional[Anthropic]:
    global _client
    if not settings.ANTHROPIC_API_KEY:
        return None
    if not _client:
        _client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _client


def _build_account_context(db: Session) -> str:
    """สร้าง context ผังบัญชีสำหรับ AI"""
    accounts = db.query(Account).filter(
        Account.is_active == True,
        Account.is_deleted == False,
        Account.level >= 2,  # ไม่เอาหมวดใหญ่สุด
    ).order_by(Account.code).limit(80).all()

    lines = []
    for a in accounts:
        dr_cr = "Dr+" if a.normal_balance == NormalBalance.DEBIT else "Cr+"
        lines.append(f"{a.code} | {a.name} | {a.account_type.value} | {dr_cr} | id:{a.id}")
    return "\n".join(lines) if lines else "ยังไม่มีบัญชีในระบบ"


SYSTEM_PROMPT = """คุณเป็นผู้ช่วยนักบัญชีชาวไทยที่เชี่ยวชาญมาตรฐานบัญชีไทย (TFRS) และหลัก Double-Entry Bookkeeping

กฎสำคัญ:
1. ทุก Journal Entry ต้อง Debit = Credit เสมอ
2. ตอบเป็น JSON เท่านั้น ไม่มี markdown ไม่มี preamble
3. เลือกบัญชีจากผังบัญชีที่ให้มาเท่านั้น ใช้ account_id จริง
4. confidence: 0.0-1.0 (สูง=มั่นใจมาก)

รูปแบบ JSON ที่ต้องตอบ:
{
  "entries": [
    {"account_id": "<uuid>", "debit": 0, "credit": 0, "description": "คำอธิบาย"},
    ...
  ],
  "explanation": "อธิบายการลงบัญชีนี้เป็นภาษาไทย",
  "confidence": 0.95
}"""


def suggest_journal_entries(
    db: Session,
    description: str,
    amount: Decimal,
    transaction_date=None,
) -> AISuggestResponse:
    """ให้ AI แนะนำการลงบัญชีจากคำอธิบาย"""

    client = get_ai_client()

    # Fallback เมื่อไม่มี API key
    if not client:
        return _rule_based_fallback(db, description, amount)

    account_ctx = _build_account_context(db)

    user_msg = f"""ผังบัญชีที่มีในระบบ:
{account_ctx}

รายการที่ต้องการลงบัญชี:
- คำอธิบาย: {description}
- จำนวนเงิน: {amount:,.2f} บาท
{f"- วันที่: {transaction_date}" if transaction_date else ""}

กรุณาแนะนำการลงบัญชี Double-Entry ที่ถูกต้อง"""

    try:
        response = client.messages.create(
            model=settings.AI_MODEL,
            max_tokens=1000,
            system=SYSTEM_PROMPT,
            messages=[{"role": "user", "content": user_msg}],
        )
        raw = response.content[0].text.strip()
        # Strip markdown fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        data = json.loads(raw)

        entries = []
        for e in data.get("entries", []):
            entries.append(JournalEntryCreate(
                account_id=UUID(e["account_id"]),
                debit=Decimal(str(e.get("debit", 0))),
                credit=Decimal(str(e.get("credit", 0))),
                description=e.get("description"),
            ))

        return AISuggestResponse(
            suggested_entries=entries,
            explanation=data.get("explanation", "AI แนะนำการลงบัญชีอัตโนมัติ"),
            confidence=float(data.get("confidence", 0.8)),
        )
    except Exception as exc:
        # Log and fallback
        print(f"[AI] Error: {exc}")
        return _rule_based_fallback(db, description, amount)


def _rule_based_fallback(db: Session, description: str, amount: Decimal) -> AISuggestResponse:
    """Rule-based fallback เมื่อไม่มี AI key"""
    desc_lower = description.lower()

    # หาบัญชีพื้นฐาน
    def find(code_prefix: str):
        return db.query(Account).filter(
            Account.code.like(f"{code_prefix}%"),
            Account.is_active == True,
        ).first()

    cash      = find("1101") or find("11")
    revenue   = find("4101") or find("41")
    expense   = find("5101") or find("51")
    ar        = find("1201") or find("12")

    keywords_expense = ["ซื้อ","จ่าย","ค่า","expense","cost"]
    keywords_income  = ["รับ","ขาย","รายได้","income","revenue"]

    entries = []
    explanation = "Rule-based suggestion (ไม่มี AI key)"
    confidence = 0.5

    is_expense = any(k in desc_lower for k in keywords_expense)
    is_income  = any(k in desc_lower for k in keywords_income)

    if is_expense and expense and cash:
        entries = [
            JournalEntryCreate(account_id=expense.id, debit=amount, credit=Decimal("0"), description=description),
            JournalEntryCreate(account_id=cash.id, debit=Decimal("0"), credit=amount, description="จ่ายเงินสด"),
        ]
        explanation = f"บันทึกค่าใช้จ่าย: Dr {expense.name} / Cr {cash.name}"
    elif is_income and cash and revenue:
        entries = [
            JournalEntryCreate(account_id=cash.id, debit=amount, credit=Decimal("0"), description="รับเงินสด"),
            JournalEntryCreate(account_id=revenue.id, debit=Decimal("0"), credit=amount, description=description),
        ]
        explanation = f"บันทึกรายได้: Dr {cash.name} / Cr {revenue.name}"
    else:
        explanation = "ไม่สามารถระบุประเภทรายการได้ — กรุณากำหนดบัญชีเอง"

    return AISuggestResponse(
        suggested_entries=entries,
        explanation=explanation,
        confidence=confidence,
    )
