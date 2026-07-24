# MeAccount — Cloud Setup Guide
> สำหรับ Cloud Dev Environment (ไม่ใช้ Docker)

## 🔧 ตัวเลือก Cloud ที่แนะนำ

| Platform | ใช้ฟรี | เหมาะกับ |
|----------|--------|---------|
| **Railway** | $5 credit/เดือน | ง่ายสุด, มี PostgreSQL+Redis ในตัว |
| **Render** | Free tier | Backend + Static site ฟรี |
| **Replit** | Free | Dev/ทดสอบ (ช้าหน่อย) |
| **Supabase** | Free | PostgreSQL ฟรี + Auth built-in |

---

## 🚀 วิธีเริ่มต้น — Railway (แนะนำ)

### 1. สร้าง Database บน Railway
1. ไปที่ [railway.app](https://railway.app) → New Project
2. เลือก **Add PostgreSQL** → Copy `DATABASE_URL`
3. เลือก **Add Redis** → Copy `REDIS_URL`

### 2. ตั้งค่า Environment Variables
สร้างไฟล์ `.env` จาก `.env.example`:
```bash
cp .env.example .env
```
แล้วแก้ค่าเหล่านี้:
```env
POSTGRES_HOST=<จาก Railway>
POSTGRES_PORT=5432
POSTGRES_DB=railway
POSTGRES_USER=postgres
POSTGRES_PASSWORD=<จาก Railway>
REDIS_HOST=<จาก Railway>
REDIS_PASSWORD=<จาก Railway>
SECRET_KEY=<สร้างเองอย่างน้อย 32 ตัวอักษร>
ANTHROPIC_API_KEY=<จาก console.anthropic.com>
```

---

## 💻 รันบน Local (ไม่มี Docker)

### Prerequisites
- Python 3.12+
- Node.js 20+
- PostgreSQL 16 (local หรือ cloud)

### Backend Setup
```bash
# 1. เข้าโฟลเดอร์ API
cd apps/api

# 2. สร้าง virtual environment
python -m venv .venv
source .venv/bin/activate        # macOS/Linux
# หรือ .venv\Scripts\activate   # Windows

# 3. ติดตั้ง dependencies
pip install -r requirements.txt

# 4. สร้าง .env (copy จาก root)
cp ../../.env.example .env

# 5. Run database migrations
alembic upgrade head

# 6. Seed ข้อมูลเริ่มต้น
python scripts/seed.py

# 7. Start server
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```
✅ API พร้อมที่ http://localhost:8000
📖 Docs ที่ http://localhost:8000/docs

### Frontend Setup
```bash
# terminal ใหม่
cd apps/web

# 1. ติดตั้ง dependencies
npm install

# 2. Start dev server
npm run dev
```
✅ Web พร้อมที่ http://localhost:5173

---

## 🧪 รัน Tests
```bash
# Backend
cd apps/api && pytest tests/ -v

# Frontend type check
cd apps/web && npx tsc --noEmit
```

---

## 🔑 Default Login (หลัง seed)
| Role | Email | Password |
|------|-------|----------|
| Admin | admin@meaccount.com | Admin@1234 |
| Accountant | accountant@meaccount.com | Test@1234 |
| Manager | manager@meaccount.com | Test@1234 |

> ⚠️ เปลี่ยนรหัสผ่านทันทีหลัง deploy จริง

---

## 📁 Project Structure
```
meaccount/
├── .env.example          ← copy เป็น .env แล้วแก้ค่า
├── .github/workflows/    ← CI/CD (GitHub Actions)
├── Makefile              ← คำสั่งลัด
├── apps/
│   ├── api/              ← FastAPI Backend
│   │   ├── core/         ← config, db, security, deps
│   │   ├── models/       ← SQLAlchemy models
│   │   ├── schemas/      ← Pydantic schemas
│   │   ├── api/v1/       ← API endpoints
│   │   ├── services/     ← Business logic
│   │   ├── migrations/   ← Alembic migrations
│   │   ├── scripts/      ← seed.py, utils
│   │   └── tests/        ← pytest tests
│   └── web/              ← React Frontend
│       └── src/
│           ├── pages/    ← หน้าจอต่างๆ
│           ├── components/
│           ├── hooks/    ← React Query hooks
│           ├── store/    ← Zustand state
│           ├── lib/      ← axios instance
│           └── types/    ← TypeScript types
└── infra/                ← Docker, Nginx (ใช้ถ้ามี Docker)
```
