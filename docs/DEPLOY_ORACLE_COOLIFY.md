# ขึ้นระบบ MeAccount แบบ odoo.sh ฟรี — Oracle Cloud + Coolify + Cloudflare

คู่มือนี้พาตั้งระบบที่ push โค้ดแล้ว deploy เอง แยก **production** (branch `main`) กับ **staging** (branch `dev`)
มี SSL, backup รายวัน และหน้าเว็บดู log / เปิด terminal — คล้าย odoo.sh แต่รันบนเครื่องฟรีของ Oracle

```
  ผู้ใช้ ──https──▶ Cloudflare DNS ──▶ Oracle VM (Ubuntu ARM)
                                        └─ Coolify (Traefik + SSL)
                                             ├─ production  ← branch main   app.<โดเมน>
                                             │    web (nginx) ─/api─▶ api (FastAPI) ─▶ db (PostgreSQL)
                                             └─ staging     ← branch dev    staging.<โดเมน>
                                                  web ─▶ api ─▶ db (แยกฐานข้อมูล)
                                        cron: backup-db.sh ─▶ Cloudflare R2
```

ไฟล์ที่เตรียมไว้ใน repo แล้ว:

| ไฟล์ | หน้าที่ |
|---|---|
| `docker-compose.prod.yml` | stack ของ 1 environment: db + api + web |
| `apps/api/Dockerfile`, `apps/api/docker-entrypoint.sh` | image ของ API — รัน `alembic upgrade head` ทุกครั้งก่อนเปิดรับ request |
| `apps/web/Dockerfile`, `infra/nginx.prod.conf` | build หน้าเว็บเป็นไฟล์ static แล้วเสิร์ฟด้วย nginx พร้อมส่ง `/api` ต่อให้ API |
| `apps/api/migrations/versions/0001_baseline.py` | migration ตั้งต้นของฐานข้อมูล |
| `infra/scripts/backup-db.sh` | backup PostgreSQL รายวันขึ้น Cloudflare R2 |

> ⚠️ เงื่อนไขฟรีของ Oracle เปลี่ยนได้ (ปี 2026 มีรายงานว่าลด Ampere A1 จาก 4 OCPU/24 GB เหลือ 2 OCPU/12 GB)
> เช็กหน้า **Always Free Resources** ของ Oracle ก่อนสร้างเครื่อง และอย่าสร้างเกินโควตา
> มีรายงานว่าเครื่องที่เกินโควตาจะถูกปิดและลบหลัง 30 วัน

---

## 1. สร้างเครื่องฟรีบน Oracle Cloud

1. สมัครที่ cloud.oracle.com (ต้องใช้บัตรเครดิตยืนยันตัวตน)
   - **Home Region เปลี่ยนภายหลังไม่ได้** และเครื่องฟรีแบบ Ampere สร้างได้เฉพาะใน Home Region — แนะนำ **Singapore**
2. เมนู **Compute → Instances → Create instance**
   - Image: **Ubuntu 24.04** (เลือกรุ่นที่เป็น aarch64)
   - Shape: **Ampere → VM.Standard.A1.Flex** ตั้ง OCPU และ Memory ไม่เกินโควตาฟรีปัจจุบัน (เช่น 2 OCPU / 12 GB)
   - Boot volume: 100 GB (โควตาฟรีรวมของ block volume ราว 200 GB)
   - SSH keys: อัปโหลด public key ของคุณ หรือให้ Oracle สร้างแล้วเก็บ private key ไว้ให้ดี
   - ถ้าขึ้น **"Out of host capacity"** ให้ลองเปลี่ยน Availability Domain หรือลองใหม่ช่วงเวลาอื่น
3. หลังสร้างเสร็จ จด **Public IP** ไว้ (ถ้าจะให้ IP ไม่เปลี่ยน ให้ตั้งเป็น Reserved Public IP ในหน้า VNIC)
4. เปิดพอร์ตฝั่ง Oracle: **Networking → Virtual Cloud Network → Security List → Add Ingress Rules**
   - Source `0.0.0.0/0`, TCP ปลายทางพอร์ต **80**, **443**, และ **8000** (8000 คือหน้า Coolify — ปิดได้หลังผูกโดเมนให้ Coolify แล้ว)
5. SSH เข้าเครื่อง แล้วเปิดไฟร์วอลล์ในเครื่องด้วย (image Ubuntu ของ Oracle บล็อกทุกพอร์ตยกเว้น 22 ไว้):

```bash
ssh ubuntu@<PUBLIC_IP>
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 8000 -j ACCEPT
sudo netfilter-persistent save
```

> Oracle อาจเรียกคืนเครื่อง Always Free ที่ "ว่างงาน" นาน ๆ (CPU ต่ำมากต่อเนื่องหลายวัน)
> ระบบบัญชีที่มีคนใช้ทุกวันมักไม่โดน แต่ถ้ากังวล อัปเกรดบัญชีเป็น Pay As You Go ได้ — ทรัพยากรในโควตายังฟรี แต่ส่วนที่เกินจะถูกเก็บเงิน

## 2. ติดตั้ง Coolify

บนเครื่อง Oracle (คำสั่งติดตั้งทางการจาก coolify.io — รองรับ ARM):

```bash
curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash
```

เสร็จแล้วเปิด `http://<PUBLIC_IP>:8000` สร้างบัญชีแอดมินทันที (ใครเปิดก่อนได้เป็นแอดมิน)

## 3. ตั้งโดเมนที่ Cloudflare

1. เพิ่มโดเมนใน Cloudflare (แพลนฟรี) แล้วเปลี่ยน **nameserver** ที่ผู้รับจดโดเมนเป็นของ Cloudflare — ไม่ต้องย้ายที่จดโดเมน
2. สร้าง DNS record แบบ **A** ชี้ไป Public IP ของเครื่อง:

| Name | ใช้กับ |
|---|---|
| `coolify` | หน้าจัดการ Coolify |
| `app` | production |
| `staging` | staging |

3. ช่วงแรกให้ตั้ง Proxy status เป็น **DNS only (เมฆสีเทา)** เพื่อให้ Coolify ขอใบรับรอง SSL จาก Let's Encrypt ได้
   ภายหลังถ้าจะเปิด proxy (เมฆสีส้ม) ให้ตั้ง SSL/TLS ใน Cloudflare เป็น **Full (strict)**
4. ใน Coolify: **Settings → Instance Domain** ใส่ `https://coolify.<โดเมน>` แล้วปิดพอร์ต 8000 ใน Security List ได้

## 4. สร้าง production

1. Coolify → **Sources → + Add → GitHub App** แล้วอนุญาตให้เข้าถึง repo MeAccount
2. **Projects → + Add** ตั้งชื่อ `MeAccount` (มี environment `production` ให้อยู่แล้ว)
3. ใน `production`: **+ New → Private Repository (with GitHub App)** → เลือก repo
   - Branch: `main`
   - Build Pack: **Docker Compose**
   - Docker Compose Location: `/docker-compose.prod.yml`
4. แท็บ **Environment Variables** — ใส่ค่าต่อไปนี้ (สร้างค่าสุ่มบนเครื่องไหนก็ได้):

```bash
# POSTGRES_PASSWORD และ SECRET_KEY
openssl rand -hex 32
# FIELD_ENCRYPTION_KEY (Fernet key)
python3 -c "import base64,os; print(base64.urlsafe_b64encode(os.urandom(32)).decode())"
```

| ตัวแปร | ค่า |
|---|---|
| `POSTGRES_PASSWORD` | ค่าสุ่ม |
| `SECRET_KEY` | ค่าสุ่ม |
| `FIELD_ENCRYPTION_KEY` | Fernet key ด้านบน — **ทำหาย = ถอดรหัสข้อมูลที่เข้ารหัสไว้ไม่ได้** เก็บสำรองไว้ที่ปลอดภัย |
| `ANTHROPIC_API_KEY` | ใส่ถ้าใช้ฟีเจอร์ AI (มีค่าใช้จ่ายตามการใช้งาน) |

5. ในรายการ service ของ resource กดที่ **web** แล้วใส่ Domain: `https://app.<โดเมน>` (service อื่นไม่ต้องใส่โดเมน)
6. กด **Deploy** — ครั้งแรกใช้เวลาหลายนาทีเพราะต้อง build image บนเครื่อง ARM
7. เปิด **Auto Deploy** (ค่าเริ่มต้นของ GitHub App) เพื่อให้ push ขึ้น `main` แล้ว deploy เอง

### ข้อมูลตั้งต้น (ทำครั้งเดียว)

Coolify → resource → **Terminal** → เลือก container `api`:

```bash
python scripts/seed.py       # สร้างแอดมิน admin@meaccount.com / Admin@1234
python scripts/seed_coa.py   # ผังบัญชีมาตรฐาน
```

แล้ว **เข้าเว็บเปลี่ยนรหัสแอดมินทันที** จากนั้นเรียก `GET /api/v1/ops/readiness` (ล็อกอินเป็นแอดมิน)
และแก้ทุกข้อที่ `blocking: true` ตาม `docs/DEPLOYMENT.md`

## 5. สร้าง staging

1. ในโปรเจกต์ `MeAccount` → **+ Add Environment** ชื่อ `staging`
2. ทำแบบข้อ 4 แต่ใช้ **Branch: `dev`** และโดเมน `https://staging.<โดเมน>`
3. ใช้ `POSTGRES_PASSWORD` / `SECRET_KEY` / `FIELD_ENCRYPTION_KEY` **คนละชุดกับ production**
   และ **เว้น `ANTHROPIC_API_KEY` ว่าง** เพื่อไม่ให้ staging ใช้เครดิตจริง

### คัดลอกข้อมูล production มา staging (แบบ odoo.sh)

ใช้ทดสอบกับข้อมูลจริงก่อนปล่อยขึ้น production — รันบนเครื่อง Oracle:

```bash
docker ps --format '{{.Names}}' | grep '^db-'      # หาชื่อ container db ของแต่ละ environment
docker exec <db-production> pg_dump -U meaccount -d meaccount -Fc > /tmp/prod.dump
docker exec -i <db-staging> pg_restore -U meaccount -d meaccount --clean --if-exists < /tmp/prod.dump
rm /tmp/prod.dump
```

> ⚠️ ถ้า staging กับ production ใช้ `FIELD_ENCRYPTION_KEY` คนละตัว ข้อมูลที่เข้ารหัสไว้จะอ่านไม่ได้บน staging —
> ถ้าต้องทดสอบส่วนนั้น ให้ใช้คีย์เดียวกัน และระวังว่า staging จะเห็นข้อมูลส่วนบุคคลจริง (PDPA)

## 6. Backup รายวันขึ้น Cloudflare R2

1. Cloudflare → **R2** → สร้าง bucket ชื่อ `meaccount-backups` แล้วสร้าง **API token** แบบ Object Read & Write
2. บนเครื่อง Oracle ติดตั้ง rclone แล้วสร้าง remote ชื่อ **`r2`** (เลือก provider Cloudflare R2 ใส่ Access Key / Secret / Endpoint จาก token):

```bash
sudo apt-get install -y rclone
rclone config            # ตั้งชื่อ remote ว่า r2
```

3. วางสคริปต์ backup และตั้ง cron (ตี 2:15 ทุกวัน):

```bash
sudo mkdir -p /opt/meaccount
sudo curl -fsSL -o /opt/meaccount/backup-db.sh \
  https://raw.githubusercontent.com/<owner>/<repo>/main/infra/scripts/backup-db.sh   # หรือ scp จากเครื่องตัวเอง
sudo chmod +x /opt/meaccount/backup-db.sh
sudo /opt/meaccount/backup-db.sh <db-production> production    # ลองรันครั้งแรก
sudo crontab -e
# เพิ่มบรรทัด:
15 2 * * * /opt/meaccount/backup-db.sh <db-production> production >> /var/log/meaccount-backup.log 2>&1
```

> rclone ต้องตั้งค่าภายใต้ผู้ใช้ที่ cron รัน (`sudo rclone config` ถ้าใช้ crontab ของ root)
> ชื่อ container db เปลี่ยนเมื่อสร้าง resource ใหม่ — ถ้าลบแล้วสร้างใหม่ต้องแก้ cron ด้วย

**กู้คืน** (ลองทำกับ staging เป็นระยะ เพื่อยืนยันว่า backup ใช้ได้จริง):

```bash
docker exec -i <db-container> pg_restore -U meaccount -d meaccount --clean --if-exists < meaccount-production-YYYYMMDD-HHMMSS.dump
```

## 7. การทำงานประจำวัน

```
feature branch ─PR─▶ dev ──auto deploy──▶ staging  (ทดสอบ)
                      └──merge──▶ main ──auto deploy──▶ production
```

**เปลี่ยนโครงสร้างฐานข้อมูล** (เพิ่มตาราง/คอลัมน์) ต้องมี Alembic revision ทุกครั้ง —
`create_all` ปิดไว้ใน production แล้ว จึงไม่สร้างให้เอง:

```bash
cd apps/api
alembic revision -m "add xyz to invoices"     # แล้วเขียน op.add_column(...) ในไฟล์ที่ได้
alembic upgrade head                           # ทดสอบกับฐานข้อมูลในเครื่อง
```

commit ไฟล์ revision ไปพร้อมโค้ด — ตอน deploy, entrypoint จะรัน `alembic upgrade head` ให้ก่อนเปิดระบบ
**ห้ามแก้ `0001_baseline.py`** เพราะฐานข้อมูลที่ stamp แล้วจะไม่รันซ้ำ

**ฐานข้อมูล dev ในเครื่อง** stamp ไว้ที่ `0001_baseline` แล้ว — ใครมีไฟล์ SQLite เก่าที่สร้างก่อนหน้านี้
ให้รัน `python scripts/migrate_journal_type.py`, `python scripts/migrate_document_book_links.py`
แล้ว `alembic stamp 0001_baseline` ครั้งเดียว

## 8. Checklist ก่อนเปิดใช้จริง

- [ ] เปลี่ยนรหัสแอดมินเริ่มต้นแล้ว และ `/api/v1/ops/readiness` ไม่มีข้อ blocking
- [ ] `FIELD_ENCRYPTION_KEY` และรหัสผ่านทั้งหมดเก็บสำรองไว้นอกเครื่อง
- [ ] backup รันอัตโนมัติ มีไฟล์ขึ้น R2 และ **ทดลองกู้คืนบน staging สำเร็จ**
- [ ] ปิดพอร์ต 8000 แล้ว (เข้า Coolify ผ่าน `https://coolify.<โดเมน>`)
- [ ] เช็กโควตา Oracle Always Free อีกครั้งว่าไม่เกิน
- [ ] ระยะเวลาเก็บข้อมูล/เอกสารบัญชีเป็นไปตามกฎหมาย (ยืนยันกับผู้สอบบัญชี) — เก็บ backup ระยะยาวแยกจาก 14 วันล่าสุด
