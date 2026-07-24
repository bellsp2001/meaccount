"""Seed Inventory demo data — คลัง, หมวดหมู่, สินค้า, สต็อกเริ่มต้น"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from datetime import date, timedelta
from decimal import Decimal
from core.database import SessionLocal, engine, Base
from models.inventory import Warehouse, ProductCategory, Product, CostMethod
import models.user, models.accounting, models.ar, models.ap, models.inventory
from services.inventory import receive_stock
from schemas.inventory import StockReceiveCreate

Base.metadata.create_all(bind=engine)
db = SessionLocal()

# Warehouse
wh = db.query(Warehouse).filter(Warehouse.code == "WH01").first()
if not wh:
    wh = Warehouse(code="WH01", name="คลังสินค้าหลัก", is_default=True)
    db.add(wh); db.flush()
    print(f"  ✓ Warehouse: {wh.name}")
db.commit()

# Categories
cats_data = [("CAT01", "อุปกรณ์สำนักงาน"), ("CAT02", "อิเล็กทรอนิกส์"), ("CAT03", "วัสดุสิ้นเปลือง")]
cat_objs = {}
for code, name in cats_data:
    c = db.query(ProductCategory).filter(ProductCategory.code == code).first()
    if not c:
        c = ProductCategory(code=code, name=name)
        db.add(c); db.flush()
        print(f"  ✓ Category: {name}")
    cat_objs[code] = c
db.commit()

# Products
products_data = [
    ("P001", "กระดาษ A4 80g", "CAT01", "รีม", Decimal("120"), Decimal("50"), Decimal("100")),
    ("P002", "หมึกพิมพ์เลเซอร์", "CAT01", "ตลับ", Decimal("890"), Decimal("5"),  Decimal("10")),
    ("P003", "เมาส์ไร้สาย", "CAT02", "ชิ้น", Decimal("350"), Decimal("10"), Decimal("20")),
    ("P004", "แฟ้มเอกสาร A4", "CAT03", "อัน", Decimal("45"),  Decimal("20"), Decimal("50")),
]

for sku, name, cat_code, unit, price, reorder_pt, reorder_qty in products_data:
    p = db.query(Product).filter(Product.sku == sku).first()
    if not p:
        p = Product(
            sku=sku, name=name, category_id=cat_objs[cat_code].id,
            unit=unit, cost_method=CostMethod.FIFO, sale_price=price,
            reorder_point=reorder_pt, reorder_qty=reorder_qty,
        )
        db.add(p); db.flush()
        print(f"  ✓ Product: {name}")
db.commit()

# Initial stock receive
initial_stock = [
    ("P001", Decimal("200"), Decimal("85")),
    ("P002", Decimal("15"),  Decimal("650")),
    ("P003", Decimal("8"),   Decimal("250")),   # below reorder point → low stock alert
    ("P004", Decimal("60"),  Decimal("32")),
]

for sku, qty, cost in initial_stock:
    p = db.query(Product).filter(Product.sku == sku).first()
    if p and p.qty_on_hand == 0:
        receive_stock(db, StockReceiveCreate(
            product_id=p.id, warehouse_id=wh.id,
            date=date.today() - timedelta(days=15),
            quantity=qty, unit_cost=cost, reference="INITIAL-STOCK",
        ))
        print(f"  ✓ Initial stock: {sku} x{qty}")

db.commit(); db.close()
print("\n✅ Inventory seed complete")
