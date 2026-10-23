"""
Text-to-SQL Service — แปลงคำถามภาษาไทยเป็น query ปลอดภัย (whitelist-based, ไม่ execute raw SQL จาก AI โดยตรง)

หลักการความปลอดภัย: แทนที่จะให้ AI สร้าง SQL string มา execute ตรงๆ (เสี่ยง injection/destructive),
เราให้ AI เลือก "query template" จาก whitelist ที่กำหนดไว้ล่วงหน้า พร้อม parameters เท่านั้น
"""
import json
from decimal import Decimal
from datetime import date, timedelta
from typing import Optional, Dict, Any, Tuple
from sqlalchemy.orm import Session
from sqlalchemy import func
from anthropic import Anthropic

from core.config import settings
from models.accounting import Account, Journal, JournalEntry, JournalStatus, AccountTypeEnum
from models.ar import Invoice, InvoiceStatus
from models.ap import Bill, BillStatus

_client: Optional[Anthropic] = None

def get_client() -> Optional[Anthropic]:
    global _client
    if not settings.ANTHROPIC_API_KEY:
        return None
    if not _client:
        _client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _client


# ── Whitelist ของ query templates ที่ AI เลือกได้ ─────────────────
QUERY_TEMPLATES = {
    "revenue_by_month": "รายได้แยกตามเดือน",
    "expense_by_category": "ค่าใช้จ่ายแยกตามหมวดหมู่",
    "top_customers_by_revenue": "ลูกค้าที่มียอดขายสูงสุด",
    "top_suppliers_by_expense": "ผู้จำหน่ายที่มีค่าใช้จ่ายสูงสุด",
    "overdue_invoices": "ใบแจ้งหนี้ที่เกินกำหนด",
    "account_balance_by_type": "ยอดคงเหลือแยกตามประเภทบัญชี",
    "monthly_transaction_count": "จำนวนรายการต่อเดือน",
}

SELECTION_SYSTEM = f"""คุณเป็นระบบแปลงคำถามภาษาไทยเป็น Query Template
เลือก template ที่เหมาะสมที่สุดจากรายการนี้เท่านั้น:
{json.dumps(QUERY_TEMPLATES, ensure_ascii=False, indent=2)}

ตอบ JSON เท่านั้น: {{"template": "<key>", "params": {{"months": 6}}, "reasoning": "เหตุผลสั้นๆ"}}
ถ้าไม่มี template ใดตรงกับคำถาม ตอบ {{"template": null, "reasoning": "เหตุผล"}}"""


def select_query_template(question: str) -> Tuple[Optional[str], dict, str]:
    """AI เลือก template + parameters จากคำถาม (whitelist-safe)"""
    client = get_client()
    if not client:
        return None, {}, "ไม่มี AI API key — ใช้ keyword matching แทน"

    try:
        resp = client.messages.create(
            model=settings.AI_MODEL, max_tokens=300,
            system=SELECTION_SYSTEM,
            messages=[{"role": "user", "content": question}],
        )
        raw = resp.content[0].text.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1].lstrip("json")
        data = json.loads(raw)
        return data.get("template"), data.get("params", {}), data.get("reasoning", "")
    except Exception as e:
        return None, {}, f"Error: {e}"


def execute_query_template(db: Session, template: str, params: dict) -> Dict[str, Any]:
    """Execute a whitelisted query template safely — no raw SQL from AI ever runs"""

    if template == "revenue_by_month":
        months = min(int(params.get("months", 6)), 12)
        today = date.today()
        result = []
        for i in range(months - 1, -1, -1):
            d = today.replace(day=1) - timedelta(days=i * 28)
            m_start = d.replace(day=1)
            m_end = (m_start.replace(month=m_start.month % 12 + 1, day=1) - timedelta(days=1)) if m_start.month < 12 else m_start.replace(month=12, day=31)
            rev = db.query(func.sum(JournalEntry.credit - JournalEntry.debit)).join(
                Journal, JournalEntry.journal_id == Journal.id
            ).join(Account, JournalEntry.account_id == Account.id).filter(
                Account.account_type == AccountTypeEnum.INCOME,
                Journal.status == JournalStatus.POSTED,
                Journal.date >= m_start, Journal.date <= m_end,
            ).scalar() or Decimal("0")
            result.append({"month": m_start.strftime("%Y-%m"), "revenue": float(abs(rev))})
        return {"type": "monthly_series", "data": result}

    elif template == "overdue_invoices":
        today = date.today()
        invoices = db.query(Invoice).filter(
            Invoice.due_date < today, Invoice.balance_due > 0, Invoice.is_deleted == False,
        ).order_by(Invoice.due_date).limit(20).all()
        return {"type": "list", "data": [
            {"number": i.number, "customer": i.customer.name if i.customer else None,
             "due_date": str(i.due_date), "balance_due": float(i.balance_due)}
            for i in invoices
        ]}

    elif template == "account_balance_by_type":
        accounts = db.query(Account).filter(Account.is_active == True, Account.is_deleted == False).all()
        by_type: Dict[str, float] = {}
        for a in accounts:
            key = a.account_type.value if hasattr(a.account_type, "value") else str(a.account_type)
            by_type[key] = by_type.get(key, 0) + float(a.balance)
        return {"type": "grouped", "data": by_type}

    elif template == "top_customers_by_revenue":
        limit = min(int(params.get("limit", 5)), 20)
        from models.ar import Customer
        results = db.query(
            Customer.name, func.sum(Invoice.total).label("total")
        ).join(Invoice, Invoice.customer_id == Customer.id).filter(
            Invoice.gl_posted == True,
        ).group_by(Customer.id, Customer.name).order_by(func.sum(Invoice.total).desc()).limit(limit).all()
        return {"type": "ranked_list", "data": [{"name": r[0], "total": float(r[1])} for r in results]}

    elif template == "top_suppliers_by_expense":
        limit = min(int(params.get("limit", 5)), 20)
        from models.ap import Supplier
        results = db.query(
            Supplier.name, func.sum(Bill.total).label("total")
        ).join(Bill, Bill.supplier_id == Supplier.id).filter(
            Bill.gl_posted == True,
        ).group_by(Supplier.id, Supplier.name).order_by(func.sum(Bill.total).desc()).limit(limit).all()
        return {"type": "ranked_list", "data": [{"name": r[0], "total": float(r[1])} for r in results]}

    elif template == "monthly_transaction_count":
        months = min(int(params.get("months", 6)), 12)
        today = date.today()
        result = []
        for i in range(months - 1, -1, -1):
            d = today.replace(day=1) - timedelta(days=i * 28)
            m_start = d.replace(day=1)
            m_end = (m_start.replace(month=m_start.month % 12 + 1, day=1) - timedelta(days=1)) if m_start.month < 12 else m_start.replace(month=12, day=31)
            count = db.query(Journal).filter(Journal.date >= m_start, Journal.date <= m_end).count()
            result.append({"month": m_start.strftime("%Y-%m"), "count": count})
        return {"type": "monthly_series", "data": result}

    elif template == "expense_by_category":
        from models.ap import ExpenseCategory
        cats = db.query(ExpenseCategory).all()
        result = []
        for cat in cats:
            total = db.query(func.sum(Bill.subtotal)).filter(
                Bill.category_id == cat.id, Bill.gl_posted == True,
            ).scalar() or 0
            if total > 0:
                result.append({"category": cat.name, "amount": float(total)})
        return {"type": "grouped_list", "data": sorted(result, key=lambda x: x["amount"], reverse=True)}

    return {"type": "empty", "data": None}
