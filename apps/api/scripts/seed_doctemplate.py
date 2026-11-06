"""Seed a default invoice document template"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from core.database import SessionLocal, engine, Base
import models.registry  # noqa: F401
from models.doctemplate import DocumentTemplate

Base.metadata.create_all(bind=engine)
db = SessionLocal()

if not db.query(DocumentTemplate).filter(DocumentTemplate.document_kind == "invoice").first():
    tpl = DocumentTemplate(
        name="แบบมาตรฐาน", document_kind="invoice", is_default=True,
        primary_color="#00D4AA", accent_color="#0D1018", font_family="Helvetica",
        company_display_name="บริษัทของคุณ จำกัด",
        footer_text="ขอบคุณที่ใช้บริการ",
    )
    db.add(tpl); db.commit()
    print("  ✓ Default invoice template created")
else:
    print("  ℹ Default invoice template already exists")

db.close()
print("\n✅ Document Template seed complete")
