"""
AI AP Service — จัดหมวดหมู่ค่าใช้จ่ายอัตโนมัติ + OCR ใบเสร็จ
"""
import json
from decimal import Decimal
from typing import Optional
from sqlalchemy.orm import Session
from anthropic import Anthropic
from core.config import settings
from models.ap import ExpenseCategory
from schemas.ap import AICategorizeResponse

_client: Optional[Anthropic] = None

def get_client() -> Optional[Anthropic]:
    global _client
    if not settings.ANTHROPIC_API_KEY:
        return None
    if not _client:
        _client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _client


def categorize_expense(db: Session, description: str, amount: Decimal) -> AICategorizeResponse:
    """AI จัดหมวดหมู่ค่าใช้จ่ายจากคำอธิบาย"""
    client = get_client()

    # Build category context
    categories = db.query(ExpenseCategory).filter(ExpenseCategory.is_active == True).all()
    cat_ctx = "\n".join(
        f"{c.code} | {c.name} | account: {c.gl_account.code if c.gl_account else 'N/A'}"
        for c in categories
    ) if categories else "ยังไม่มีหมวดหมู่"

    # Rule-based fallback
    if not client:
        return _rule_based_category(description, categories)

    system = """คุณเป็น AI ผู้ช่วยบัญชีที่ช่วยจัดหมวดหมู่ค่าใช้จ่ายของบริษัท
ตอบเป็น JSON เท่านั้น ไม่มี markdown:
{
  "category_code": "EXP001",
  "category_name": "ชื่อหมวดหมู่",
  "account_code": "5401",
  "explanation": "เหตุผล",
  "confidence": 0.9
}
ถ้าไม่มั่นใจให้ใส่ null สำหรับ category_code"""

    try:
        resp = client.messages.create(
            model=settings.AI_MODEL, max_tokens=400,
            system=system,
            messages=[{"role": "user", "content":
                f"หมวดหมู่ที่มี:\n{cat_ctx}\n\nค่าใช้จ่าย: {description}\nจำนวน: {amount:,.2f} บาท\nจัดหมวดหมู่ให้หน่อย"}],
        )
        raw = resp.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"): raw = raw[4:]
        data = json.loads(raw)
        return AICategorizeResponse(
            category_code=data.get("category_code"),
            category_name=data.get("category_name"),
            account_code=data.get("account_code"),
            explanation=data.get("explanation", ""),
            confidence=float(data.get("confidence", 0.7)),
        )
    except Exception as e:
        return _rule_based_category(description, categories)


def _rule_based_category(description: str, categories: list) -> AICategorizeResponse:
    desc = description.lower()
    keywords = {
        "EXP001": ["กระดาษ","ปากกา","เครื่องเขียน","สำนักงาน","วัสดุ"],
        "EXP002": ["ไฟฟ้า","น้ำ","สาธารณูปโภค","ค่าน้ำ","ค่าไฟ"],
        "EXP003": ["เช่า","rent","ค่าเช่า"],
        "EXP004": ["ซ่อม","บำรุง","repair","maintenance"],
        "EXP005": ["โทรศัพท์","internet","อินเทอร์เน็ต","wifi"],
        "EXP006": ["โฆษณา","การตลาด","market","ads"],
        "EXP007": ["ประกัน","insurance"],
        "EXP008": ["เดินทาง","น้ำมัน","taxi","grab","travel"],
    }
    best_code, best_score = "EXP009", 0
    for code, kws in keywords.items():
        score = sum(1 for k in kws if k in desc)
        if score > best_score:
            best_score, best_code = score, code

    cat = next((c for c in categories if c.code == best_code), None)
    return AICategorizeResponse(
        category_code=best_code if cat else None,
        category_name=cat.name if cat else "ค่าใช้จ่ายอื่นๆ",
        account_code=cat.gl_account.code if cat and cat.gl_account else None,
        explanation="Rule-based categorization",
        confidence=0.6 if best_score > 0 else 0.3,
    )


def ocr_receipt(image_base64: str, media_type: str = "image/jpeg") -> dict:
    """OCR ใบเสร็จรับเงินด้วย Claude Vision"""
    client = get_client()
    if not client:
        return {"supplier_name": None, "date": None, "total": None,
                "items": [], "confidence": 0, "error": "ไม่มี API key"}
    try:
        resp = client.messages.create(
            model=settings.AI_MODEL, max_tokens=1000,
            system="""อ่านใบเสร็จรับเงิน/บิลและตอบ JSON เท่านั้น:
{
  "supplier_name": "ชื่อร้าน/บริษัท หรือ null",
  "tax_id": "เลขประจำตัวผู้เสียภาษี หรือ null",
  "date": "YYYY-MM-DD หรือ null",
  "ref_number": "เลขที่ใบเสร็จ หรือ null",
  "items": [{"description": "ชื่อ", "amount": 0}],
  "subtotal": 0, "vat_amount": 0, "total": 0,
  "confidence": 0.9
}""",
            messages=[{"role": "user", "content": [
                {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": image_base64}},
                {"type": "text", "text": "อ่านข้อมูลจากใบเสร็จนี้"},
            ]}],
        )
        raw = resp.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"): raw = raw[4:]
        return json.loads(raw)
    except Exception as e:
        return {"error": str(e), "confidence": 0}
