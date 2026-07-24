"""
Webhook Service — Subscription management and signed event delivery.

Delivery is synchronous-in-request here for simplicity and testability (no
background task queue in this codebase yet); a production deployment would
move `deliver_event` onto a task queue (Celery is already in requirements.txt
for Phase 1's background jobs) so a slow/dead subscriber URL can't block the
request that triggered the event. Flagging that rather than pretending this
is already async.
"""
import hashlib, hmac, json, secrets
from datetime import datetime
from typing import Optional, List
from uuid import UUID
from sqlalchemy.orm import Session
from fastapi import HTTPException
import httpx

from models.api_platform import WebhookSubscription, WebhookDelivery, DeliveryStatus, WebhookEvent
from schemas.api_platform import WebhookSubscriptionCreate


def _generate_secret() -> str:
    return secrets.token_hex(32)


def sign_payload(secret: str, payload: dict) -> str:
    """HMAC-SHA256 signature so the receiving endpoint can verify the payload
    actually came from MeAccount and wasn't forged — same pattern Stripe/GitHub
    webhooks use. The receiver recomputes this with their copy of the secret."""
    body = json.dumps(payload, sort_keys=True, default=str).encode()
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def create_subscription(db: Session, payload: WebhookSubscriptionCreate, user_id: Optional[UUID] = None) -> WebhookSubscription:
    sub = WebhookSubscription(
        url=payload.url, events=payload.events, secret=_generate_secret(),
        description=payload.description, created_by=user_id,
    )
    db.add(sub); db.commit(); db.refresh(sub)
    return sub


def get_subscriptions(db: Session) -> List[WebhookSubscription]:
    return db.query(WebhookSubscription).filter(WebhookSubscription.is_deleted == False).all()


def deactivate_subscription(db: Session, sub_id: UUID) -> WebhookSubscription:
    sub = db.query(WebhookSubscription).filter(WebhookSubscription.id == sub_id).first()
    if not sub:
        raise HTTPException(404, "ไม่พบ Webhook Subscription")
    sub.is_active = False
    db.commit(); db.refresh(sub)
    return sub


def trigger_event(db: Session, event: str, payload: dict, timeout_seconds: float = 5.0) -> List[WebhookDelivery]:
    """
    Fan out `event` to every active subscription that's subscribed to it.
    Each delivery is attempted once here (synchronously) and recorded — a
    failed delivery is marked `failed` rather than silently dropped, so it's
    visible in the delivery log and could be retried by an operator or a
    background job later.
    """
    subs = db.query(WebhookSubscription).filter(
        WebhookSubscription.is_active == True,
        WebhookSubscription.is_deleted == False,
    ).all()

    deliveries = []
    for sub in subs:
        if event not in (sub.events or []):
            continue

        delivery = WebhookDelivery(
            subscription_id=sub.id, event=event, payload=payload,
            status=DeliveryStatus.PENDING.value, attempt_count=0,
            created_at=datetime.utcnow(),
        )
        db.add(delivery); db.flush()

        signature = sign_payload(sub.secret, payload)
        delivery.attempt_count = 1

        try:
            resp = httpx.post(
                sub.url, json=payload, timeout=timeout_seconds,
                headers={"X-MeAccount-Signature": signature, "X-MeAccount-Event": event},
            )
            delivery.response_code = resp.status_code
            delivery.response_body = resp.text[:1000]
            delivery.status = DeliveryStatus.SUCCESS.value if resp.status_code < 400 else DeliveryStatus.FAILED.value
            delivery.delivered_at = datetime.utcnow()
        except httpx.RequestError as e:
            delivery.status = DeliveryStatus.FAILED.value
            delivery.response_body = f"Request failed: {str(e)}"

        deliveries.append(delivery)

    db.commit()
    for d in deliveries:
        db.refresh(d)
    return deliveries


def get_deliveries(db: Session, subscription_id: Optional[UUID] = None) -> List[WebhookDelivery]:
    q = db.query(WebhookDelivery)
    if subscription_id:
        q = q.filter(WebhookDelivery.subscription_id == subscription_id)
    return q.order_by(WebhookDelivery.created_at.desc()).limit(100).all()
