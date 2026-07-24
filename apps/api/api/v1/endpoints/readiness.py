from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from core.database import get_db
from core.deps import require_admin
from models.user import User
from schemas.readiness import ReadinessReportResponse, RouteInventoryResponse
from services.readiness import run_readiness_scan
from services.route_inventory import get_route_inventory

router = APIRouter(prefix="/ops", tags=["Go-Live Readiness"])


@router.get("/readiness", response_model=ReadinessReportResponse)
def readiness_scan_ep(current_user: User = Depends(require_admin), db: Session = Depends(get_db)):
    return run_readiness_scan(db)


@router.get("/routes", response_model=RouteInventoryResponse)
def route_inventory_ep(request: Request, current_user: User = Depends(require_admin)):
    return get_route_inventory(request.app)
