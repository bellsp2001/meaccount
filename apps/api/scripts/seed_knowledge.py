"""Seed Thai accounting knowledge base"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from core.database import SessionLocal, engine, Base
import models.user, models.accounting, models.ar, models.ap, models.inventory, models.payroll, models.tax, models.period, models.report, models.knowledge
from services.knowledge_base import seed_thai_accounting_knowledge

Base.metadata.create_all(bind=engine)
db = SessionLocal()
seed_thai_accounting_knowledge(db)
db.close()
print("✅ Knowledge base seeded — 10 กฎหมายบัญชี-ภาษีไทย")
