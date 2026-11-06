"""Seed POS demo data — เปิดกะตัวอย่าง สำหรับทดสอบหน้า POS Terminal"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from datetime import date
from decimal import Decimal
from core.database import SessionLocal, engine, Base
import models.registry  # noqa: F401
from models.inventory import Warehouse

Base.metadata.create_all(bind=engine)
db = SessionLocal()

wh = db.query(Warehouse).filter(Warehouse.code == "WH01").first()
if not wh:
    print("  ⚠ ไม่พบคลัง WH01 — กรุณารัน make seed-inventory ก่อน")
else:
    print(f"  ✓ พร้อมใช้งาน POS ที่คลัง: {wh.name}")
    print("  ℹ ใช้ API POST /api/v1/pos/shifts/open เพื่อเปิดกะการขายจริง")

db.close()
print("\n✅ POS ready-check complete")
