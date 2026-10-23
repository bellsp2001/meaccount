"""
Seed script — สร้าง Admin user เริ่มต้น
Run: python scripts/seed.py
"""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from core.database import SessionLocal, engine, Base
from core.security import hash_password
from models.user import User, UserRole
import models.registry  # noqa: F401 — loads every model so FKs resolve

Base.metadata.create_all(bind=engine)

db = SessionLocal()

# ── Default users ──
users = [
    {"email": "admin@meaccount.com",      "full_name": "Admin System",     "role": UserRole.ADMIN,       "password": "Admin@1234"},
    {"email": "accountant@meaccount.com", "full_name": "นักบัญชี ทดสอบ",   "role": UserRole.ACCOUNTANT,  "password": "Test@1234"},
    {"email": "manager@meaccount.com",    "full_name": "ผู้จัดการ ทดสอบ",  "role": UserRole.MANAGER,     "password": "Test@1234"},
]

for u in users:
    exists = db.query(User).filter(User.email == u["email"]).first()
    if not exists:
        user = User(
            email=u["email"],
            full_name=u["full_name"],
            hashed_password=hash_password(u["password"]),
            role=u["role"],
            is_active=True,
            is_verified=True,
        )
        db.add(user)
        print(f"  ✓ Created: {u['email']} [{u['role']}]")
    else:
        print(f"  – Skip (exists): {u['email']}")

db.commit()
db.close()
print("\n✅ Seed complete!")
