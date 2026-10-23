"""
OCR Service — Claude Vision อ่านใบแจ้งหนี้/ใบเสร็จจากรูปภาพ
"""
import json, base64
from typing import Optional
from anthropic import Anthropic
from core.config import settings
from schemas.ar import OCRInvoiceResponse

_client: Optional[Anthropic] = None

def get_client() -> Optional[Anthropic]:
    global _client
    if not settings.ANTHROPIC_API_KEY:
        return None
    if not _client:
        _client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _client


OCR_SYSTEM = """คุณเป็นระบบ OCR สำหรับอ่านใบแจ้งหนี้และใบเสร็จรับเงินภาษาไทย
ตอบเป็น JSON เท่านั้น ไม่มี markdown ไม่มี preamble

รูปแบบที่ต้องตอบ:
{
  "customer_name": "ชื่อลูกค้า หรือ null",
  "invoice_number": "เลขที่ใบแจ้งหนี้ หรือ null",
  "invoice_date": "YYYY-MM-DD หรือ null",
  "due_date": "YYYY-MM-DD หรือ null",
  "items": [
    {"description": "ชื่อสินค้า/บริการ", "quantity": 1, "unit_price": 0, "amount": 0}
  ],
  "subtotal": 0,
  "vat_amount": 0,
  "total": 0,
  "confidence": 0.9
}

ถ้าอ่านข้อมูลใดไม่ได้ให้ใส่ null ห้ามเดา"""


def extract_invoice_from_image(image_base64: str, media_type: str = "image/jpeg") -> OCRInvoiceResponse:
    client = get_client()
    if not client:
        return OCRInvoiceResponse(
            customer_name=None, invoice_number=None, invoice_date=None,
            due_date=None, items=[], subtotal=None, vat_amount=None,
            total=None, confidence=0, raw_text="ไม่มี ANTHROPIC_API_KEY",
        )

    try:
        response = client.messages.create(
            model=settings.AI_MODEL,
            max_tokens=1500,
            system=OCR_SYSTEM,
            messages=[{
                "role": "user",
                "content": [
                    {
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": image_base64,
                        },
                    },
                    {"type": "text", "text": "กรุณาอ่านข้อมูลจากใบแจ้งหนี้/ใบเสร็จนี้"}
                ],
            }],
        )
        raw = response.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]

        data = json.loads(raw)
        return OCRInvoiceResponse(
            customer_name=data.get("customer_name"),
            invoice_number=data.get("invoice_number"),
            invoice_date=data.get("invoice_date"),
            due_date=data.get("due_date"),
            items=data.get("items", []),
            subtotal=data.get("subtotal"),
            vat_amount=data.get("vat_amount"),
            total=data.get("total"),
            confidence=float(data.get("confidence", 0.8)),
            raw_text=raw,
        )
    except Exception as e:
        return OCRInvoiceResponse(
            customer_name=None, invoice_number=None, invoice_date=None,
            due_date=None, items=[], subtotal=None, vat_amount=None,
            total=None, confidence=0, raw_text=f"Error: {str(e)}",
        )
