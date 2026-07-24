"""Seed Payroll demo data — พนักงานตัวอย่าง"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from datetime import date
from decimal import Decimal
from core.database import SessionLocal, engine, Base
from models.payroll import Employee, MaritalStatus
import models.user, models.accounting, models.ar, models.ap, models.inventory, models.payroll

Base.metadata.create_all(bind=engine)
db = SessionLocal()

employees_data = [
    dict(employee_code="EMP001", full_name="สมชาย ใจดี",   position="Senior Developer", department="IT",
         start_date=date(2022, 3, 1), base_salary=Decimal("45000"),
         marital_status=MaritalStatus.MARRIED, num_children=1,
         bank_name="ธ.กสิกรไทย", bank_account="123-4-56789-0"),
    dict(employee_code="EMP002", full_name="สมหญิง รักงาน", position="นักบัญชี", department="Accounting",
         start_date=date(2023, 1, 15), base_salary=Decimal("32000"),
         marital_status=MaritalStatus.SINGLE, num_children=0,
         bank_name="ธ.ไทยพาณิชย์", bank_account="234-5-67890-1"),
    dict(employee_code="EMP003", full_name="วิชัย ขยันทำงาน", position="Sales Manager", department="Sales",
         start_date=date(2021, 6, 1), base_salary=Decimal("55000"),
         marital_status=MaritalStatus.MARRIED, num_children=2,
         bank_name="ธ.กรุงไทย", bank_account="345-6-78901-2"),
    dict(employee_code="EMP004", full_name="นภา สดใส",     position="HR Officer", department="HR",
         start_date=date(2023, 8, 1), base_salary=Decimal("28000"),
         marital_status=MaritalStatus.SINGLE, num_children=0,
         bank_name="ธ.กสิกรไทย", bank_account="456-7-89012-3"),
]

for ed in employees_data:
    e = db.query(Employee).filter(Employee.employee_code == ed["employee_code"]).first()
    if not e:
        e = Employee(**ed)
        db.add(e)
        print(f"  ✓ Employee: {ed['full_name']} — ฿{ed['base_salary']:,.0f}/เดือน")

db.commit(); db.close()
print("\n✅ Payroll seed complete — 4 employees")
