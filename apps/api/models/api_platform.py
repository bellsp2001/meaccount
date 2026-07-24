"""
API Platform Models: APIKey, WebhookSubscription, WebhookDelivery, ExternalIntegration
"""
import enum
from sqlalchemy import Column, String, Boolean, ForeignKey, Text, DateTime, Integer, JSON
from datetime import datetime
from sqlalchemy.orm import relationship
from core.database import Base
from models.base import UUIDMixin, TimestampMixin, UUIDType


class APIKeyStatus(str, enum.Enum):
    ACTIVE  = "active"
    REVOKED = "revoked"


class WebhookEvent(str, enum.Enum):
    INVOICE_CREATED   = "invoice.created"
    INVOICE_PAID      = "invoice.paid"
    BILL_APPROVED     = "bill.approved"
    PAYMENT_RECEIVED  = "payment.received"
    JOURNAL_POSTED    = "journal.posted"
    FRAUD_ALERT       = "fraud.alert_created"


class DeliveryStatus(str, enum.Enum):
    PENDING = "pending"
    SUCCESS = "success"
    FAILED  = "failed"
    RETRYING= "retrying"


class IntegrationProvider(str, enum.Enum):
    ETAX_RD  = "etax_rd"        # e-Tax Invoice กรมสรรพากร
    BANK_SCB = "bank_scb"
    BANK_KBANK = "bank_kbank"
    ECOMMERCE_LAZADA = "ecommerce_lazada"
    ECOMMERCE_SHOPEE = "ecommerce_shopee"


class IntegrationStatus(str, enum.Enum):
    DISCONNECTED = "disconnected"
    CONNECTED    = "connected"
    ERROR        = "error"


# ── API Key ────────────────────────────────────────────────────
class APIKey(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "api_keys"

    name           = Column(String(200), nullable=False)
    key_prefix     = Column(String(12),  nullable=False, index=True)   # e.g. "mac_live_ab" — shown to user
    hashed_key     = Column(String(255), nullable=False)               # bcrypt hash of the full key, never store plaintext
    status         = Column(String(20),  default=APIKeyStatus.ACTIVE.value, nullable=False)

    rate_limit_per_min = Column(Integer, default=60, nullable=False)
    request_count       = Column(Integer, default=0, nullable=False)   # lifetime counter
    last_used_at         = Column(DateTime, nullable=True)

    created_by      = Column(UUIDType(), ForeignKey("users.id"), nullable=True)
    revoked_at        = Column(DateTime, nullable=True)
    revoked_by         = Column(UUIDType(), ForeignKey("users.id"), nullable=True)

    creator  = relationship("User", foreign_keys=[created_by])
    revoker  = relationship("User", foreign_keys=[revoked_by])


# ── Webhook ────────────────────────────────────────────────────
class WebhookSubscription(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "webhook_subscriptions"

    url          = Column(String(500), nullable=False)
    events       = Column(JSON,        nullable=False)   # list[str] of WebhookEvent values
    secret       = Column(String(64),  nullable=False)   # for HMAC signing of delivered payloads
    is_active    = Column(Boolean,     default=True)
    description  = Column(String(255), nullable=True)
    created_by   = Column(UUIDType(),  ForeignKey("users.id"), nullable=True)

    deliveries = relationship("WebhookDelivery", back_populates="subscription", lazy="dynamic")


class WebhookDelivery(Base, UUIDMixin):
    __tablename__ = "webhook_deliveries"

    subscription_id = Column(UUIDType(), ForeignKey("webhook_subscriptions.id"), nullable=False)
    event           = Column(String(50), nullable=False)
    payload         = Column(JSON, nullable=False)
    status          = Column(String(20), default=DeliveryStatus.PENDING.value, nullable=False)
    response_code   = Column(Integer, nullable=True)
    response_body   = Column(Text, nullable=True)
    attempt_count   = Column(Integer, default=0, nullable=False)
    created_at      = Column(DateTime, default=datetime.utcnow, nullable=False)
    delivered_at    = Column(DateTime, nullable=True)

    subscription = relationship("WebhookSubscription", back_populates="deliveries")


# ── External Integration (bank / e-tax / e-commerce connections) ─
class ExternalIntegration(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "external_integrations"

    provider     = Column(String(30), nullable=False)
    status       = Column(String(20), default=IntegrationStatus.DISCONNECTED.value, nullable=False)
    config       = Column(JSON, nullable=True)    # non-secret config (account numbers, store IDs, etc)
    credential_ref = Column(String(255), nullable=True)  # reference to where the actual secret lives (never store secrets in this table)

    last_sync_at   = Column(DateTime, nullable=True)
    last_sync_status = Column(String(20), nullable=True)
    last_error       = Column(Text, nullable=True)

    connected_by      = Column(UUIDType(), ForeignKey("users.id"), nullable=True)

    connector = relationship("User", foreign_keys=[connected_by])
