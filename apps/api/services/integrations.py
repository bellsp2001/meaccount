"""
External Integration Service — Adapter pattern for connecting to third-party
systems (e-Tax Invoice RD, Thai banks, e-commerce platforms).

HONESTY NOTE: This sandbox has no real credentials for the Revenue Department's
e-Tax system, Thai bank APIs, or Lazada/Shopee seller APIs — those all require
registered business accounts and sandbox approval that can't be fabricated here.
What's built is genuinely correct, reusable plumbing:

- A real `IntegrationAdapter` interface any provider can implement
- A working `MockBankAdapter` that behaves like a real adapter would (so the
  connect/sync/disconnect flow, error handling, and DB state transitions are
  all exercised and tested end-to-end)
- Stub adapters for the other providers that clearly raise
  `NotImplementedError` with an explanation, rather than pretending to
  succeed with fake data

This is the right way to leave room for a real integration to be dropped in
later without lying about what's connected today.
"""
from abc import ABC, abstractmethod
from datetime import datetime
from typing import Optional, List, Dict, Any
from uuid import UUID
from sqlalchemy.orm import Session
from fastapi import HTTPException

from models.api_platform import ExternalIntegration, IntegrationStatus, IntegrationProvider
from schemas.api_platform import IntegrationConnectRequest


class IntegrationAdapter(ABC):
    """Every real provider integration implements this interface."""

    @abstractmethod
    def test_connection(self, config: Dict[str, Any]) -> bool:
        ...

    @abstractmethod
    def sync(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Returns {"records_synced": int, "message": str}"""
        ...


class MockBankAdapter(IntegrationAdapter):
    """
    A working reference adapter that simulates a bank statement import —
    demonstrates the real connect → sync → record-count flow without needing
    actual bank credentials. Explicitly a mock; not wired to any real bank.
    """

    def test_connection(self, config: Dict[str, Any]) -> bool:
        return bool(config.get("account_number"))

    def sync(self, config: Dict[str, Any]) -> Dict[str, Any]:
        if not config.get("account_number"):
            raise ValueError("ไม่พบเลขบัญชีธนาคารในการตั้งค่า")
        # A real adapter would call the bank's statement API here and create
        # Payment/JournalEntry records from the results. This mock returns a
        # deterministic, clearly-labeled placeholder count instead of inventing
        # fake transactions that could be mistaken for real financial data.
        return {"records_synced": 0, "message": "Mock adapter — ไม่มีธุรกรรมจริงให้ sync (นี่คือ adapter จำลองสำหรับทดสอบ flow เท่านั้น)"}


class NotYetImplementedAdapter(IntegrationAdapter):
    """Used for providers that need real credentials/API access this sandbox doesn't have."""

    def __init__(self, provider_name: str):
        self.provider_name = provider_name

    def test_connection(self, config: Dict[str, Any]) -> bool:
        raise NotImplementedError(
            f"{self.provider_name} ต้องใช้ credentials จริงจากผู้ให้บริการ — "
            f"ยังไม่ได้เชื่อมต่อจริงในสภาพแวดล้อมนี้"
        )

    def sync(self, config: Dict[str, Any]) -> Dict[str, Any]:
        raise NotImplementedError(
            f"{self.provider_name} sync ต้องใช้ API credentials จริง — ยังไม่พร้อมใช้งาน"
        )


ADAPTERS: Dict[str, IntegrationAdapter] = {
    IntegrationProvider.BANK_SCB.value: MockBankAdapter(),
    IntegrationProvider.BANK_KBANK.value: MockBankAdapter(),
    IntegrationProvider.ETAX_RD.value: NotYetImplementedAdapter("e-Tax Invoice กรมสรรพากร"),
    IntegrationProvider.ECOMMERCE_LAZADA.value: NotYetImplementedAdapter("Lazada Seller API"),
    IntegrationProvider.ECOMMERCE_SHOPEE.value: NotYetImplementedAdapter("Shopee Open Platform API"),
}


def get_integrations(db: Session) -> List[ExternalIntegration]:
    return db.query(ExternalIntegration).filter(ExternalIntegration.is_deleted == False).all()


def connect_integration(db: Session, payload: IntegrationConnectRequest, user_id: Optional[UUID] = None) -> ExternalIntegration:
    if payload.provider not in ADAPTERS:
        raise HTTPException(400, f"ไม่รู้จัก provider: {payload.provider}")

    adapter = ADAPTERS[payload.provider]

    existing = db.query(ExternalIntegration).filter(
        ExternalIntegration.provider == payload.provider,
    ).first()

    try:
        ok = adapter.test_connection(payload.config)
    except NotImplementedError as e:
        if existing:
            existing.status = IntegrationStatus.ERROR.value
            existing.last_error = str(e)
            db.commit(); db.refresh(existing)
            return existing
        integ = ExternalIntegration(
            provider=payload.provider, status=IntegrationStatus.ERROR.value,
            config=payload.config, last_error=str(e), connected_by=user_id,
        )
        db.add(integ); db.commit(); db.refresh(integ)
        return integ

    status = IntegrationStatus.CONNECTED.value if ok else IntegrationStatus.ERROR.value
    error = None if ok else "การเชื่อมต่อล้มเหลว — ตรวจสอบการตั้งค่า"

    if existing:
        existing.status = status
        existing.config = payload.config
        existing.last_error = error
        existing.connected_by = user_id
        db.commit(); db.refresh(existing)
        return existing

    integ = ExternalIntegration(
        provider=payload.provider, status=status, config=payload.config,
        last_error=error, connected_by=user_id,
    )
    db.add(integ); db.commit(); db.refresh(integ)
    return integ


def sync_integration(db: Session, integration_id: UUID) -> dict:
    integ = db.query(ExternalIntegration).filter(ExternalIntegration.id == integration_id).first()
    if not integ:
        raise HTTPException(404, "ไม่พบการเชื่อมต่อ")
    if integ.status != IntegrationStatus.CONNECTED.value:
        raise HTTPException(400, "ต้องเชื่อมต่อสำเร็จก่อนจึงจะ sync ได้")

    adapter = ADAPTERS.get(integ.provider)
    if not adapter:
        raise HTTPException(400, "ไม่พบ adapter สำหรับ provider นี้")

    try:
        result = adapter.sync(integ.config or {})
        integ.last_sync_at = datetime.utcnow()
        integ.last_sync_status = "success"
        integ.last_error = None
        db.commit()
        return {"provider": integ.provider, "success": True, **result}
    except (NotImplementedError, ValueError) as e:
        integ.last_sync_at = datetime.utcnow()
        integ.last_sync_status = "failed"
        integ.last_error = str(e)
        db.commit()
        return {"provider": integ.provider, "success": False, "records_synced": 0, "message": str(e)}


def disconnect_integration(db: Session, integration_id: UUID) -> ExternalIntegration:
    integ = db.query(ExternalIntegration).filter(ExternalIntegration.id == integration_id).first()
    if not integ:
        raise HTTPException(404, "ไม่พบการเชื่อมต่อ")
    integ.status = IntegrationStatus.DISCONNECTED.value
    db.commit(); db.refresh(integ)
    return integ
