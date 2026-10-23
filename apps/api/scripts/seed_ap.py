"""Seed AP demo data — ผู้จำหน่ายและ Bills ตัวอย่าง"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from datetime import date, timedelta
from decimal import Decimal
from core.database import SessionLocal, engine, Base
from models.ap import Supplier, Bill, BillItem, BillStatus, ExpenseCategory
import models.registry  # noqa: F401 — loads every model so FKs resolve

Base.metadata.create_all(bind=engine)
db = SessionLocal()

# Seed categories first
from services.ap import seed_default_categories
seed_default_categories(db)
print("✓ Categories seeded")

suppliers_data = [
    dict(code="S001", name="บริษัท ออฟฟิศเมท จำกัด",   tax_id="0105444000001", payment_terms=30, wht_type="3%",  bank_name="ธ.กสิกรไทย",  bank_account="123-4-00001-0"),
    dict(code="S002", name="การไฟฟ้านครหลวง",            tax_id="0107537000001", payment_terms=15, bank_name="ธ.กรุงไทย",    bank_account="456-7-00002-0"),
    dict(code="S003", name="นาย สมชาย ค่าเช่า",         tax_id="1234567890001", payment_terms=30, wht_type="5%"),
    dict(code="S004", name="บริษัท โทรคมนาคมแห่งชาติ",  tax_id="0107528000001", payment_terms=15, bank_name="ธ.ไทยพาณิชย์", bank_account="789-0-00003-0"),
]

sup_objs = []
for sd in suppliers_data:
    s = db.query(Supplier).filter(Supplier.code == sd["code"]).first()
    if not s:
        s = Supplier(**sd); db.add(s); db.flush()
        print(f"  ✓ Supplier: {sd['name']}")
    sup_objs.append(s)
db.commit()

if sup_objs:
    from services.ap import next_bill_number
    cats = {c.code: c for c in db.query(ExpenseCategory).all()}

    bills_data = [
        (sup_objs[0], date.today()-timedelta(days=20), "ค่าวัสดุสำนักงานเดือนที่แล้ว",
         [("กระดาษ A4 80g 5 รีม", 5, Decimal("180")), ("ปากกา Blue Ink 1 กล่อง", 2, Decimal("95"))],
         "EXP001", BillStatus.APPROVED),
        (sup_objs[1], date.today()-timedelta(days=10), "ค่าไฟฟ้าเดือนปัจจุบัน",
         [("ค่าไฟฟ้า", 1, Decimal("3850"))],
         "EXP002", BillStatus.PENDING),
        (sup_objs[2], date.today()-timedelta(days=5), "ค่าเช่าสำนักงานเดือนนี้",
         [("ค่าเช่าสำนักงานชั้น 3", 1, Decimal("25000"))],
         "EXP003", BillStatus.DRAFT),
        (sup_objs[3], date.today(), "ค่าอินเทอร์เน็ตและโทรศัพท์",
         [("Internet 1Gbps รายเดือน", 1, Decimal("1800")), ("โทรศัพท์สำนักงาน", 1, Decimal("650"))],
         "EXP005", BillStatus.DRAFT),
    ]

    for sup, bill_date, desc, items_data, cat_code, status in bills_data:
        num = next_bill_number(db, bill_date)
        subtotal = sum(q * p for _, q, p in items_data)
        vat = (subtotal * Decimal("7") / 100).quantize(Decimal("0.01"))
        wht_rate = Decimal("3") if sup.wht_type == "3%" else Decimal("5") if sup.wht_type == "5%" else Decimal("0")
        wht = (subtotal * wht_rate / 100).quantize(Decimal("0.01"))
        total = subtotal + vat
        net = total - wht
        cat = cats.get(cat_code)
        bill = Bill(
            number=num, supplier_id=sup.id,
            category_id=cat.id if cat else None,
            date=bill_date, due_date=bill_date + timedelta(days=sup.payment_terms),
            description=desc, status=status,
            subtotal=subtotal, vat_rate=Decimal("7"), vat_amount=vat,
            wht_rate=wht_rate, wht_amount=wht, total=total,
            net_payable=net, paid_amount=Decimal("0"), balance_due=net,
        )
        db.add(bill); db.flush()
        for i, (d, q, p) in enumerate(items_data):
            db.add(BillItem(bill_id=bill.id, sequence=i, description=d, quantity=q, unit_price=p, amount=q*p))
        print(f"  ✓ Bill {num}: {desc}")

db.commit(); db.close()
print("\n✅ AP seed complete")
