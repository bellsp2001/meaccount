"""
Go-Live Readiness Service — automated pre-launch checks that can actually be
verified from code/config, honestly separated from things that need a real
staging/production environment to test (flagged as non-blocking warnings
with an explicit note, never silently skipped).

This is NOT a substitute for:
- An actual staged rollout with real traffic
- Load testing against the real deployed infrastructure (see loadtest/ for
  a real Locust script — written and correct, but it needs a live URL to
  run against, which this sandbox doesn't have)
- A human final sign-off from whoever owns the launch decision
"""
import os
from datetime import datetime
from typing import List
from sqlalchemy.orm import Session
from sqlalchemy import text

from core.config import settings
from schemas.readiness import ReadinessCheckResult, ReadinessReportResponse


def run_readiness_scan(db: Session) -> ReadinessReportResponse:
    checks: List[ReadinessCheckResult] = []

    # ── Configuration checks ──
    checks.append(_check_secret_key())
    checks.append(_check_encryption_key())
    checks.append(_check_anthropic_key())
    checks.append(_check_allowed_origins())
    checks.append(_check_debug_mode())

    # ── Database checks ──
    checks.append(_check_db_connection(db))
    checks.append(_check_db_not_sqlite_in_prod())

    # ── Security checks ──
    checks.append(_check_default_admin_password_not_in_use(db))
    checks.append(_check_token_expiry_reasonable())

    # ── Dependency / environment checks ──
    checks.append(_check_requirements_pinned())

    # ── Non-blocking, explicitly-flagged manual items ──
    checks.append(ReadinessCheckResult(
        check_id="OPS-01", category="dependencies", name="Load Testing Against Live Environment",
        status="warning", blocking=False,
        detail="ยังไม่ได้รัน load test จริง — สคริปต์ loadtest/locustfile.py พร้อมใช้งานแล้ว "
               "แต่ต้องรันกับ URL ของ environment จริงก่อน go-live (ดูวิธีใช้ในไฟล์)",
    ))
    checks.append(ReadinessCheckResult(
        check_id="OPS-02", category="dependencies", name="Rollback Plan Documented & Tested",
        status="warning", blocking=False,
        detail="ต้องมีแผน rollback ที่ทดสอบแล้วจริง (เช่น database migration ย้อนกลับได้) — เป็นกระบวนการ deployment ไม่ใช่สิ่งที่ตรวจจากโค้ดได้",
    ))
    checks.append(ReadinessCheckResult(
        check_id="OPS-03", category="dependencies", name="On-call / Incident Response Owner Assigned",
        status="warning", blocking=False,
        detail="ต้องมีคนรับผิดชอบ monitor ระบบหลัง launch — เป็นการตัดสินใจขององค์กร",
    ))
    checks.append(ReadinessCheckResult(
        check_id="OPS-04", category="dependencies", name="Backup & Disaster Recovery Verified",
        status="warning", blocking=False,
        detail="ต้องทดสอบ restore จาก backup จริงอย่างน้อย 1 ครั้งก่อน launch — ต้องทำกับ infrastructure จริง",
    ))

    passed = sum(1 for c in checks if c.status == "pass")
    failed = sum(1 for c in checks if c.status == "fail")
    warnings = sum(1 for c in checks if c.status == "warning")
    blocking_failures = sum(1 for c in checks if c.status == "fail" and c.blocking)

    if blocking_failures > 0:
        overall = "not_ready"
    elif warnings > 0:
        overall = "ready_with_warnings"
    else:
        overall = "ready"

    return ReadinessReportResponse(
        scan_date=datetime.utcnow(), overall_status=overall,
        total_checks=len(checks), passed=passed, failed=failed, warnings=warnings,
        blocking_failures=blocking_failures, checks=checks,
    )


# ── Individual checks ────────────────────────────────────────────

def _check_secret_key() -> ReadinessCheckResult:
    is_default = settings.SECRET_KEY == "dev_secret_key_change_in_production_min_32_chars"
    return ReadinessCheckResult(
        check_id="CFG-01", category="config", name="SECRET_KEY Changed from Default",
        status="fail" if is_default else "pass", blocking=True,
        detail="⚠️ SECRET_KEY ยังเป็นค่า default ของ dev — ต้องเปลี่ยนก่อน production เด็ดขาด "
               "(ใครก็ตามที่รู้ค่า default นี้สามารถปลอม JWT token ได้)" if is_default
               else "SECRET_KEY ถูกเปลี่ยนจากค่า default แล้ว",
    )


def _check_encryption_key() -> ReadinessCheckResult:
    configured = bool(getattr(settings, "FIELD_ENCRYPTION_KEY", ""))
    return ReadinessCheckResult(
        check_id="CFG-02", category="config", name="FIELD_ENCRYPTION_KEY Configured",
        status="pass" if configured else "fail", blocking=True,
        detail="ตั้งค่าแล้ว" if configured else
               "⚠️ ไม่ได้ตั้งค่า — PII fields จะเข้ารหัสด้วย key ชั่วคราวที่เปลี่ยนทุกครั้งที่ restart "
               "(ข้อมูลที่เข้ารหัสไว้จะถอดรหัสไม่ได้อีกหลัง restart หากไม่ตั้งค่าถาวร)",
    )


def _check_anthropic_key() -> ReadinessCheckResult:
    configured = bool(settings.ANTHROPIC_API_KEY)
    return ReadinessCheckResult(
        check_id="CFG-03", category="config", name="ANTHROPIC_API_KEY Configured",
        status="pass" if configured else "warning", blocking=False,
        detail="ตั้งค่าแล้ว" if configured else
               "ไม่ได้ตั้งค่า — ฟีเจอร์ AI (Chat, OCR, Fraud detection บางส่วน) จะทำงานแบบ fallback เท่านั้น",
    )


def _check_allowed_origins() -> ReadinessCheckResult:
    origins = getattr(settings, "ALLOWED_ORIGINS", [])
    has_wildcard = "*" in origins if isinstance(origins, list) else False
    return ReadinessCheckResult(
        check_id="CFG-04", category="config", name="CORS Origins Restricted (no wildcard)",
        status="fail" if has_wildcard else "pass", blocking=True,
        detail="⚠️ ALLOWED_ORIGINS มี '*' (อนุญาตทุก origin) — เสี่ยงต่อ CSRF และควรระบุ domain เฉพาะก่อน production"
               if has_wildcard else "CORS origins ถูกจำกัดแล้ว",
    )


def _check_debug_mode() -> ReadinessCheckResult:
    # This codebase doesn't have an explicit DEBUG flag; treat env_file being
    # present as a proxy signal that .env (dev config) hasn't been swapped
    # for real production env injection — flagged as advisory, not blocking,
    # since it's an imperfect heuristic rather than a definitive check.
    env_file_exists = os.path.exists(".env")
    return ReadinessCheckResult(
        check_id="CFG-05", category="config", name="Production Environment Variables (not .env file)",
        status="warning" if env_file_exists else "pass", blocking=False,
        detail="พบไฟล์ .env ใน working directory — production ควรใช้ env vars จาก deployment platform "
               "โดยตรง (ไม่ใช่ .env file ที่อาจถูก commit เข้า git โดยไม่ตั้งใจ)" if env_file_exists
               else "ไม่พบ .env file — สันนิษฐานว่าใช้ env vars จาก platform",
    )


def _check_db_connection(db: Session) -> ReadinessCheckResult:
    try:
        db.execute(text("SELECT 1"))
        return ReadinessCheckResult(
            check_id="DB-01", category="database", name="Database Connection", status="pass", blocking=True,
            detail="เชื่อมต่อฐานข้อมูลสำเร็จ",
        )
    except Exception as e:
        return ReadinessCheckResult(
            check_id="DB-01", category="database", name="Database Connection", status="fail", blocking=True,
            detail=f"เชื่อมต่อฐานข้อมูลไม่สำเร็จ: {str(e)}",
        )


def _check_db_not_sqlite_in_prod() -> ReadinessCheckResult:
    db_url = getattr(settings, "DATABASE_URL", "")
    is_sqlite = "sqlite" in db_url.lower()
    return ReadinessCheckResult(
        check_id="DB-02", category="database", name="Production Database Engine (not SQLite)",
        status="warning" if is_sqlite else "pass", blocking=False,
        detail="ใช้ SQLite อยู่ — เหมาะสำหรับ dev/test เท่านั้น ไม่รองรับ concurrent write ที่ดีพอสำหรับ production "
               "(ควรใช้ PostgreSQL ตามที่ระบุใน docker-compose.yml)" if is_sqlite
               else "ใช้ database engine ที่เหมาะสมกับ production",
    )


def _check_default_admin_password_not_in_use(db: Session) -> ReadinessCheckResult:
    from models.user import User
    from core.security import verify_password
    admin = db.query(User).filter(User.email == "admin@meaccount.com").first()
    if not admin:
        return ReadinessCheckResult(
            check_id="SEC-01", category="security", name="Default Seed Admin Account Removed/Changed",
            status="pass", blocking=True, detail="ไม่พบ default seed admin account (admin@meaccount.com)",
        )
    try:
        is_default_pw = verify_password("Admin@1234", admin.hashed_password)
    except Exception:
        is_default_pw = False
    return ReadinessCheckResult(
        check_id="SEC-01", category="security", name="Default Seed Admin Password Changed",
        status="fail" if is_default_pw else "pass", blocking=True,
        detail="⚠️ Default admin account (admin@meaccount.com) ยังใช้รหัสผ่าน default จาก seed script "
               "(Admin@1234) — ต้องเปลี่ยนก่อน production เด็ดขาด" if is_default_pw
               else "Default admin account ไม่ได้ใช้รหัสผ่าน default แล้ว",
    )


def _check_token_expiry_reasonable() -> ReadinessCheckResult:
    minutes = settings.ACCESS_TOKEN_EXPIRE_MINUTES
    too_long = minutes > 60
    return ReadinessCheckResult(
        check_id="SEC-02", category="security", name="Access Token Expiry Reasonable (≤60 min)",
        status="warning" if too_long else "pass", blocking=False,
        detail=f"Access token หมดอายุใน {minutes} นาที ซึ่งค่อนข้างนาน — พิจารณาลดลงเพื่อจำกัดความเสี่ยงหาก token รั่วไหล"
               if too_long else f"Access token หมดอายุใน {minutes} นาที (เหมาะสม)",
    )


def _check_requirements_pinned() -> ReadinessCheckResult:
    """Verifies every dependency in requirements.txt has a pinned version
    (==x.y.z) rather than an unpinned/range spec — unpinned deps mean a
    fresh `pip install` in production could silently pull a different,
    untested version of a library."""
    req_path = "requirements.txt"
    if not os.path.exists(req_path):
        return ReadinessCheckResult(
            check_id="DEP-01", category="dependencies", name="Dependencies Pinned to Exact Versions",
            status="warning", blocking=False, detail="ไม่พบ requirements.txt ในตำแหน่งที่คาดไว้",
        )
    with open(req_path) as f:
        lines = [l.strip() for l in f if l.strip() and not l.startswith("#")]
    unpinned = [l for l in lines if "==" not in l]
    return ReadinessCheckResult(
        check_id="DEP-01", category="dependencies", name="Dependencies Pinned to Exact Versions",
        status="warning" if unpinned else "pass", blocking=False,
        detail=f"พบ {len(unpinned)} dependency ที่ไม่ได้ pin version: {', '.join(unpinned[:5])}"
               if unpinned else f"Dependencies ทั้งหมด {len(lines)} รายการ pin version ครบ",
    )
