from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID

from core.database import get_db
from core.deps import get_current_user, require_admin, require_accountant_up
from models.user import User
from schemas.api_platform import (
    APIKeyCreate, APIKeyCreateResponse, APIKeyResponse,
    WebhookSubscriptionCreate, WebhookSubscriptionResponse, WebhookDeliveryResponse,
    IntegrationConnectRequest, IntegrationResponse, SyncResultResponse,
)
from services.api_key import create_api_key, get_api_keys, revoke_api_key
from services.webhook import create_subscription, get_subscriptions, deactivate_subscription, get_deliveries
from services.integrations import get_integrations, connect_integration, sync_integration, disconnect_integration

router = APIRouter(prefix="/platform", tags=["API Platform & Integrations"])


# ── API Keys ───────────────────────────────────────────────────
@router.post("/api-keys", response_model=APIKeyCreateResponse)
def create_key_ep(payload: APIKeyCreate, current_user: User = Depends(require_admin), db: Session = Depends(get_db)):
    return create_api_key(db, payload, current_user.id)


@router.get("/api-keys", response_model=List[APIKeyResponse])
def list_keys_ep(current_user: User = Depends(require_admin), db: Session = Depends(get_db)):
    return get_api_keys(db)


@router.post("/api-keys/{key_id}/revoke", response_model=APIKeyResponse)
def revoke_key_ep(key_id: UUID, current_user: User = Depends(require_admin), db: Session = Depends(get_db)):
    return revoke_api_key(db, key_id, current_user.id)


# ── Webhooks ───────────────────────────────────────────────────
@router.post("/webhooks", response_model=WebhookSubscriptionResponse)
def create_webhook_ep(payload: WebhookSubscriptionCreate, current_user: User = Depends(require_admin), db: Session = Depends(get_db)):
    return create_subscription(db, payload, current_user.id)


@router.get("/webhooks", response_model=List[WebhookSubscriptionResponse])
def list_webhooks_ep(current_user: User = Depends(require_admin), db: Session = Depends(get_db)):
    return get_subscriptions(db)


@router.post("/webhooks/{sub_id}/deactivate", response_model=WebhookSubscriptionResponse)
def deactivate_webhook_ep(sub_id: UUID, current_user: User = Depends(require_admin), db: Session = Depends(get_db)):
    return deactivate_subscription(db, sub_id)


@router.get("/webhooks/deliveries", response_model=List[WebhookDeliveryResponse])
def list_deliveries_ep(subscription_id: Optional[UUID] = None,
                       current_user: User = Depends(require_admin), db: Session = Depends(get_db)):
    return get_deliveries(db, subscription_id)


# ── Integrations ───────────────────────────────────────────────
@router.get("/integrations", response_model=List[IntegrationResponse])
def list_integrations_ep(current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return get_integrations(db)


@router.post("/integrations/connect", response_model=IntegrationResponse)
def connect_integration_ep(payload: IntegrationConnectRequest,
                           current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return connect_integration(db, payload, current_user.id)


@router.post("/integrations/{integration_id}/sync", response_model=SyncResultResponse)
def sync_integration_ep(integration_id: UUID, current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return sync_integration(db, integration_id)


@router.post("/integrations/{integration_id}/disconnect", response_model=IntegrationResponse)
def disconnect_integration_ep(integration_id: UUID, current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return disconnect_integration(db, integration_id)
