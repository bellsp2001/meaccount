from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID

from core.database import get_db
from core.deps import get_current_user, require_accountant_up
from models.user import User
from schemas.pos import (
    ShiftOpenRequest, ShiftCloseRequest, ShiftResponse,
    SaleCreate, SaleResponse, VoidSaleRequest, BarcodeLookupResponse,
)
from services.pos import (
    open_shift, get_shift, get_open_shift, close_shift, get_shift_summary,
    checkout, post_sale_to_gl, void_sale, get_sales, lookup_barcode,
)

router = APIRouter(prefix="/pos", tags=["POS — Point of Sale"])


# ── Shift ──────────────────────────────────────────────────────
@router.post("/shifts/open", response_model=ShiftResponse)
def open_shift_ep(payload: ShiftOpenRequest, current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return open_shift(db, payload, current_user.id)


@router.get("/shifts/open-for-warehouse/{warehouse_id}", response_model=Optional[ShiftResponse])
def get_open_shift_ep(warehouse_id: UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_open_shift(db, warehouse_id)


@router.get("/shifts/{shift_id}", response_model=ShiftResponse)
def get_shift_summary_ep(shift_id: UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_shift_summary(db, shift_id)


@router.post("/shifts/{shift_id}/close", response_model=ShiftResponse)
def close_shift_ep(shift_id: UUID, payload: ShiftCloseRequest,
                   current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return close_shift(db, shift_id, payload, current_user.id)


# ── Checkout ───────────────────────────────────────────────────
@router.post("/sales", response_model=SaleResponse)
def checkout_ep(payload: SaleCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return checkout(db, payload, current_user.id)


@router.get("/sales", response_model=List[SaleResponse])
def list_sales_ep(shift_id: Optional[UUID] = None, status: Optional[str] = None,
                  current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_sales(db, shift_id, status)


@router.post("/sales/{sale_id}/post-gl", response_model=SaleResponse)
def post_sale_gl_ep(sale_id: UUID, current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return post_sale_to_gl(db, sale_id, current_user.id)


@router.post("/sales/{sale_id}/void", response_model=SaleResponse)
def void_sale_ep(sale_id: UUID, payload: VoidSaleRequest,
                 current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return void_sale(db, sale_id, payload, current_user.id)


# ── Barcode Lookup ─────────────────────────────────────────────
@router.get("/barcode/{code}", response_model=BarcodeLookupResponse)
def barcode_lookup_ep(code: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    p = lookup_barcode(db, code)
    return BarcodeLookupResponse(
        product_id=p.id, sku=p.sku, name=p.name, sale_price=p.sale_price,
        qty_on_hand=p.qty_on_hand, unit=p.unit,
    )
