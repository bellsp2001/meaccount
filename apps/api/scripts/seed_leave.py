"""Seed Leave/HR demo data — ประเภทการลามาตรฐาน + วันลาเริ่มต้นสำหรับพนักงานที่มีอยู่"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from datetime import date
from core.database import SessionLocal, engine, Base
import models.registry  # noqa: F401
from models.payroll import Employee
from services.leave import seed_default_leave_types, initialize_balance
from schemas.leave import InitializeBalanceRequest

Base.metadata.create_all(bind=engine)
db = SessionLocal()

created = seed_default_leave_types(db)
if created:
    for lt in created:
        print(f"  ✓ Leave type: {lt.name}")
else:
    print("  ℹ ประเภทการลาถูกสร้างไว้แล้ว")

employees = db.query(Employee).filter(Employee.status == "active").all()
current_year = date.today().year
for emp in employees:
    initialize_balance(db, InitializeBalanceRequest(employee_id=emp.id, year=current_year))
    print(f"  ✓ Initialized {current_year} balances: {emp.full_name}")

db.close()
print(f"\n✅ Leave/HR seed complete — {len(employees)} employees")
