"""
API Key Service — Generation, hashing, verification, rate limiting.

Security design: the plaintext key is generated once and shown to the user
exactly once. Only a bcrypt hash of it is ever stored, same as a password —
so a database leak doesn't hand out working API keys. The `key_prefix`
(first 12 chars) IS stored in plaintext so the UI can show "mac_live_ab...xyz"
for identification without ever re-exposing the full secret.
"""
import secrets
from datetime import datetime, timedelta
from typing import Optional, List
from uuid import UUID
from sqlalchemy.orm import Session
from fastapi import HTTPException
from passlib.context import CryptContext

from models.api_platform import APIKey, APIKeyStatus
from schemas.api_platform import APIKeyCreate

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")

KEY_PREFIX = "mac_live_"


def _generate_key() -> tuple[str, str]:
    """Returns (plaintext_key, prefix_for_display)"""
    random_part = secrets.token_urlsafe(32)
    plaintext = f"{KEY_PREFIX}{random_part}"
    display_prefix = plaintext[:len(KEY_PREFIX) + 4]  # e.g. "mac_live_ab12"
    return plaintext, display_prefix


def create_api_key(db: Session, payload: APIKeyCreate, user_id: Optional[UUID] = None) -> dict:
    plaintext, prefix = _generate_key()
    hashed = pwd_context.hash(plaintext)

    key = APIKey(
        name=payload.name, key_prefix=prefix, hashed_key=hashed,
        rate_limit_per_min=payload.rate_limit_per_min, created_by=user_id,
    )
    db.add(key); db.commit(); db.refresh(key)

    return {
        "id": key.id, "name": key.name, "key_prefix": key.key_prefix,
        "plaintext_key": plaintext, "rate_limit_per_min": key.rate_limit_per_min,
    }


def get_api_keys(db: Session) -> List[APIKey]:
    return db.query(APIKey).filter(APIKey.is_deleted == False).order_by(APIKey.created_at.desc()).all()


def revoke_api_key(db: Session, key_id: UUID, user_id: Optional[UUID] = None) -> APIKey:
    key = db.query(APIKey).filter(APIKey.id == key_id).first()
    if not key:
        raise HTTPException(404, "ไม่พบ API Key")
    if key.status == APIKeyStatus.REVOKED.value:
        raise HTTPException(400, "API Key นี้ถูกเพิกถอนไปแล้ว")
    key.status = APIKeyStatus.REVOKED.value
    key.revoked_at = datetime.utcnow()
    key.revoked_by = user_id
    db.commit(); db.refresh(key)
    return key


def verify_api_key(db: Session, plaintext_key: str) -> Optional[APIKey]:
    """
    Verifies a plaintext key against stored hashes. Since bcrypt hashes can't be
    looked up directly (that's the point), we narrow candidates by key_prefix
    first — O(1) via the indexed prefix column — then bcrypt-verify against
    just that candidate, rather than checking against every key in the table.
    """
    if not plaintext_key.startswith(KEY_PREFIX):
        return None

    prefix = plaintext_key[:len(KEY_PREFIX) + 4]
    candidates = db.query(APIKey).filter(
        APIKey.key_prefix == prefix,
        APIKey.status == APIKeyStatus.ACTIVE.value,
        APIKey.is_deleted == False,
    ).all()

    for candidate in candidates:
        if pwd_context.verify(plaintext_key, candidate.hashed_key):
            candidate.request_count += 1
            candidate.last_used_at = datetime.utcnow()
            db.commit()
            return candidate

    return None


# ── Simple in-process rate limiting ─────────────────────────────
# Note: this is a per-process sliding window, sufficient for a single API
# instance. A multi-instance deployment would need this backed by Redis
# instead — flagging that explicitly rather than silently shipping something
# that only half-works once you scale horizontally.
_rate_limit_windows: dict = {}


def check_rate_limit(api_key: APIKey) -> bool:
    now = datetime.utcnow()
    window_start = now - timedelta(minutes=1)

    key_id = str(api_key.id)
    timestamps = _rate_limit_windows.get(key_id, [])
    timestamps = [t for t in timestamps if t > window_start]

    if len(timestamps) >= api_key.rate_limit_per_min:
        _rate_limit_windows[key_id] = timestamps
        return False

    timestamps.append(now)
    _rate_limit_windows[key_id] = timestamps
    return True
