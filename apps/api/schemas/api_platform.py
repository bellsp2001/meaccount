from pydantic import BaseModel, field_validator
from typing import Optional, List, Dict, Any
from uuid import UUID
from datetime import datetime


# ── API Key ────────────────────────────────────────────────────
class APIKeyCreate(BaseModel):
    name:                str
    rate_limit_per_min:  int = 60


class APIKeyCreateResponse(BaseModel):
    """Only returned once, at creation time — the plaintext key is never
    retrievable again after this response, matching how every real API key
    system (Stripe, GitHub, etc.) works."""
    id:          UUID
    name:        str
    key_prefix:  str
    plaintext_key: str
    rate_limit_per_min: int
    warning: str = "บันทึก API Key นี้ไว้ทันที — ระบบจะไม่แสดงค่านี้อีกครั้ง"


class APIKeyResponse(BaseModel):
    id:                 UUID
    name:               str
    key_prefix:         str
    status:             str
    rate_limit_per_min: int
    request_count:      int
    last_used_at:       Optional[datetime]
    created_at:         datetime
    model_config = {"from_attributes": True}


# ── Webhook ────────────────────────────────────────────────────
class WebhookSubscriptionCreate(BaseModel):
    url:         str
    events:      List[str]
    description: Optional[str] = None

    @field_validator("url")
    @classmethod
    def https_only(cls, v):
        if not v.startswith("https://"):
            raise ValueError("Webhook URL ต้องเป็น HTTPS เท่านั้น (เพื่อความปลอดภัยในการส่งข้อมูล)")
        return v

    @field_validator("events")
    @classmethod
    def valid_events(cls, v):
        from models.api_platform import WebhookEvent
        valid = {e.value for e in WebhookEvent}
        invalid = set(v) - valid
        if invalid:
            raise ValueError(f"Event ไม่ถูกต้อง: {invalid}")
        if not v:
            raise ValueError("ต้องเลือกอย่างน้อย 1 event")
        return v


class WebhookSubscriptionResponse(BaseModel):
    id:          UUID
    url:         str
    events:      List[str]
    is_active:   bool
    description: Optional[str]
    model_config = {"from_attributes": True}


class WebhookDeliveryResponse(BaseModel):
    id:            UUID
    event:         str
    status:        str
    response_code: Optional[int]
    attempt_count: int
    created_at:    datetime
    delivered_at:  Optional[datetime]
    model_config = {"from_attributes": True}


# ── External Integration ───────────────────────────────────────
class IntegrationConnectRequest(BaseModel):
    provider: str
    config:   Dict[str, Any] = {}


class IntegrationResponse(BaseModel):
    id:               UUID
    provider:         str
    status:           str
    config:           Optional[Dict[str, Any]]
    last_sync_at:     Optional[datetime]
    last_sync_status: Optional[str]
    last_error:       Optional[str]
    model_config = {"from_attributes": True}


class SyncResultResponse(BaseModel):
    provider:       str
    success:        bool
    records_synced: int
    message:        str
