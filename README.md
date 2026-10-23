# MeAccount

โปรแกรมบัญชีอัจฉริยะสำหรับธุรกิจไทย (AI-powered accounting) — monorepo

## โครงสร้าง

```
apps/
  web/      React + Vite + TypeScript (พอร์ต 5173)
  api/      FastAPI (Python)           (พอร์ต 8000)
  mobile/   React Native / Expo
infra/      ไฟล์ deploy / โครงสร้างพื้นฐาน
docs/       เอกสาร (CLOUD_SETUP, DEPLOYMENT, PROJECT_STATUS) + ภาพ UI อ้างอิง
```

## การรัน (dev)

ต้องรันทั้งสอง server — เว็บเรียก API ที่ `http://localhost:8000`

```bash
# API (พอร์ต 8000)
cd apps/api
.venv/Scripts/python.exe -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload

# Web (พอร์ต 5173)
cd apps/web
npm run dev
```

เปิด http://localhost:5173

### บัญชีทดสอบ (demo)

| บทบาท | อีเมล | รหัสผ่าน |
|-------|-------|----------|
| Admin | admin@meaccount.com | Admin@1234 |
| Accountant | accountant@meaccount.com | Test@1234 |

## ธีม

ดีไซน์แนว "tavola" — พื้น navy เข้ม + accent คอรัลนุ่ม + พาเนลลอยกระจก (sidebar เมนูหลักซ้าย · เมนูย่อยบน) ค่าเริ่มต้นเป็นธีมมืด สลับธีมได้ที่ปุ่มมุมบน

## เอกสารเพิ่มเติม

ดูในโฟลเดอร์ [`docs/`](./docs) — การตั้งค่า cloud, การ deploy, และสถานะโปรเจกต์
