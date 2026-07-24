"""
AI Inventory Service — Demand Forecasting + Smart Reorder Point
"""
import json
from decimal import Decimal
from datetime import date, timedelta
from typing import Optional, List
from sqlalchemy.orm import Session
from sqlalchemy import func
from anthropic import Anthropic

from core.config import settings
from models.inventory import Product, StockMovement, MovementType
from schemas.inventory import ForecastResponse

_client: Optional[Anthropic] = None

def get_client() -> Optional[Anthropic]:
    global _client
    if not settings.ANTHROPIC_API_KEY:
        return None
    if not _client:
        _client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _client


def _get_usage_history(db: Session, product_id, days: int = 90) -> List[dict]:
    """ดึงประวัติการเบิกจ่าย (issue) ย้อนหลัง N วัน"""
    since = date.today() - timedelta(days=days)
    movements = db.query(StockMovement).filter(
        StockMovement.product_id == product_id,
        StockMovement.movement_type == MovementType.ISSUE,
        StockMovement.date >= since,
    ).order_by(StockMovement.date).all()
    return [{"date": str(m.date), "quantity": float(m.quantity)} for m in movements]


def forecast_product(db: Session, product_id) -> ForecastResponse:
    """พยากรณ์ความต้องการสินค้า — statistical baseline + AI enhancement"""
    product = db.query(Product).filter(Product.id == product_id).first()
    if not product:
        raise ValueError("ไม่พบสินค้า")

    history = _get_usage_history(db, product_id, 90)
    total_used = sum(h["quantity"] for h in history)
    days_with_data = 90 if history else 1
    avg_daily = total_used / days_with_data if days_with_data > 0 else 0

    current_stock = float(product.qty_on_hand)
    days_left = (current_stock / avg_daily) if avg_daily > 0 else None

    forecast_30 = avg_daily * 30
    forecast_60 = avg_daily * 60
    forecast_90 = avg_daily * 90

    reorder_recommended = False
    recommended_qty = None
    explanation = "คำนวณจากอัตราการเบิกจ่ายเฉลี่ยย้อนหลัง 90 วัน"
    confidence = 0.6 if history else 0.2

    if days_left is not None and days_left <= 14:
        reorder_recommended = True
        recommended_qty = round(forecast_30 - current_stock + (avg_daily * 7), 2)  # buffer 7 days
        recommended_qty = max(recommended_qty, float(product.reorder_qty or 0))

    # Try AI enhancement if available
    client = get_client()
    if client and history:
        try:
            resp = client.messages.create(
                model=settings.AI_MODEL, max_tokens=350,
                system="""คุณเป็น AI นักวิเคราะห์สินค้าคงคลัง วิเคราะห์แนวโน้มการใช้สินค้าและให้คำแนะนำ
ตอบ JSON เท่านั้น: {"trend": "increasing/stable/decreasing", "recommended_qty": number, "confidence": 0.0-1.0, "explanation": "เหตุผลภาษาไทย"}""",
                messages=[{"role": "user", "content":
                    f"สินค้า: {product.name}\nสต็อกปัจจุบัน: {current_stock} {product.unit}\n"
                    f"ประวัติการเบิก 90 วัน: {json.dumps(history[-20:], ensure_ascii=False)}\n"
                    f"อัตราเฉลี่ย/วัน: {avg_daily:.2f}\nวิเคราะห์แนวโน้มและแนะนำปริมาณสั่งซื้อ"}],
            )
            raw = resp.content[0].text.strip()
            if raw.startswith("```"):
                raw = raw.split("```")[1].lstrip("json")
            data = json.loads(raw)
            if data.get("recommended_qty"):
                recommended_qty = float(data["recommended_qty"])
            confidence = float(data.get("confidence", confidence))
            explanation = data.get("explanation", explanation)
        except Exception:
            pass  # fallback to statistical result

    return ForecastResponse(
        product_id=product.id, product_name=product.name,
        current_stock=Decimal(str(current_stock)),
        avg_daily_usage=round(avg_daily, 2),
        days_of_stock_left=round(days_left, 1) if days_left else None,
        forecast_30d=round(forecast_30, 2),
        forecast_60d=round(forecast_60, 2),
        forecast_90d=round(forecast_90, 2),
        reorder_recommended=reorder_recommended,
        recommended_qty=recommended_qty,
        confidence=confidence,
        explanation=explanation,
    )


def get_reorder_suggestions(db: Session) -> List[dict]:
    """สินค้าทั้งหมดที่ควรสั่งซื้อเพิ่ม (สำหรับ Dashboard widget)"""
    products = db.query(Product).filter(
        Product.is_active == True, Product.track_stock == True, Product.is_deleted == False,
    ).all()

    suggestions = []
    for p in products:
        if p.reorder_point > 0 and p.qty_on_hand <= p.reorder_point:
            suggestions.append({
                "product_id": str(p.id), "sku": p.sku, "name": p.name,
                "qty_on_hand": float(p.qty_on_hand), "reorder_point": float(p.reorder_point),
                "reorder_qty": float(p.reorder_qty or 0), "unit": p.unit,
            })
    return suggestions
