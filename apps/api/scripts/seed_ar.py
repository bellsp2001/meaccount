"""Seed AR demo data — ลูกค้าและ Invoice ตัวอย่าง"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from datetime import date, timedelta
from decimal import Decimal
from core.database import SessionLocal, engine, Base
from models.ar import Customer, Invoice, InvoiceItem, InvoiceStatus
import models.registry  # noqa: F401 — loads every model so FKs resolve

Base.metadata.create_all(bind=engine)
db = SessionLocal()

customers_data = [
    dict(code="C001", name="บริษัท ซอฟต์แวร์ไทย จำกัด",    tax_id="0105555000001", credit_days=30, phone="02-111-1111", email="billing@softthai.co.th"),
    dict(code="C002", name="ห้างหุ้นส่วนจำกัด เทคโนโลยีใหม่", tax_id="0105555000002", credit_days=15, phone="081-222-3333"),
    dict(code="C003", name="บริษัท นำเข้าส่งออก จำกัด",      tax_id="0105555000003", credit_days=60, credit_limit=Decimal("500000")),
]

cust_objs = []
for cd in customers_data:
    c = db.query(Customer).filter(Customer.code == cd["code"]).first()
    if not c:
        c = Customer(**cd)
        db.add(c); db.flush()
        print(f"  ✓ Customer: {cd['name']}")
    cust_objs.append(c)
db.commit()

if cust_objs:
    from services.ar import next_invoice_number
    inv_data = [
        (cust_objs[0], date.today() - timedelta(days=45), [
            ("พัฒนาระบบ ERP Module 1", 1, Decimal("120000")),
            ("ค่า License รายปี",      1, Decimal("24000")),
        ], InvoiceStatus.SENT),
        (cust_objs[1], date.today() - timedelta(days=10), [
            ("ออกแบบ UI/UX Mobile App", 1, Decimal("35000")),
        ], InvoiceStatus.PARTIAL),
        (cust_objs[2], date.today(), [
            ("ที่ปรึกษาระบบบัญชี 3 วัน", 3, Decimal("15000")),
            ("ค่าเดินทาง", 1, Decimal("2500")),
        ], InvoiceStatus.DRAFT),
    ]

    for cust, inv_date, items_data, status in inv_data:
        num = next_invoice_number(db, inv_date)
        subtotal = sum(q * p for _, q, p in items_data)
        vat = (subtotal * Decimal("7") / 100).quantize(Decimal("0.01"))
        total = subtotal + vat
        paid = total * Decimal("0.5") if status == InvoiceStatus.PARTIAL else Decimal("0")
        inv = Invoice(
            number=num, customer_id=cust.id,
            date=inv_date, due_date=inv_date + timedelta(days=cust.credit_days),
            status=status, subtotal=subtotal, vat_rate=Decimal("7"),
            vat_amount=vat, total=total, paid_amount=paid, balance_due=total-paid,
        )
        db.add(inv); db.flush()
        for i, (desc, qty, price) in enumerate(items_data):
            db.add(InvoiceItem(invoice_id=inv.id, sequence=i, description=desc,
                               quantity=qty, unit_price=price, amount=qty*price))
        print(f"  ✓ Invoice {num}: {cust.name}")

db.commit(); db.close()
print("\n✅ AR seed complete")
