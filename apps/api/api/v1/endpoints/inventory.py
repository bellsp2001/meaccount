from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID
from datetime import date

from core.database import get_db
from core.deps import get_current_user, require_accountant_up
from models.user import User
from models.inventory import MovementType, POStatus
from schemas.inventory import (
    WarehouseCreate, WarehouseResponse, CategoryCreate, CategoryResponse,
    ProductCreate, ProductUpdate, ProductResponse,
    StockReceiveCreate, StockIssueCreate, StockAdjustCreate, StockMovementResponse,
    PurchaseOrderCreate, PurchaseOrderResponse, ReceivePORequest,
    ForecastResponse,
)
from services.inventory import (
    get_warehouses, create_warehouse, get_categories, create_category,
    get_products, create_product, update_product,
    receive_stock, issue_stock, adjust_stock, get_movements, post_movement_to_gl,
    create_po, submit_po, receive_po, get_pos,
)
from services.ai_inventory import forecast_product, get_reorder_suggestions

router = APIRouter(prefix="/inventory", tags=["Inventory"])


# ── Warehouse ──────────────────────────────────────────────────
@router.get("/warehouses", response_model=List[WarehouseResponse])
def list_warehouses(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_warehouses(db)

@router.post("/warehouses", response_model=WarehouseResponse)
def create_warehouse_ep(payload: WarehouseCreate, current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return create_warehouse(db, payload)


# ── Category ───────────────────────────────────────────────────
@router.get("/categories", response_model=List[CategoryResponse])
def list_categories(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_categories(db)

@router.post("/categories", response_model=CategoryResponse)
def create_category_ep(payload: CategoryCreate, current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return create_category(db, payload)


# ── Product ────────────────────────────────────────────────────
@router.get("/products", response_model=List[ProductResponse])
def list_products(search: Optional[str] = None, low_stock_only: bool = False,
                  current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_products(db, search, low_stock_only)

@router.post("/products", response_model=ProductResponse)
def create_product_ep(payload: ProductCreate, current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    from services.inventory import _product_to_dict
    p = create_product(db, payload)
    return _product_to_dict(p)

@router.patch("/products/{pid}", response_model=ProductResponse)
def update_product_ep(pid: UUID, payload: ProductUpdate, current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    from services.inventory import _product_to_dict
    p = update_product(db, pid, payload)
    return _product_to_dict(p)

@router.get("/products/{pid}", response_model=ProductResponse)
def get_product(pid: UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from models.inventory import Product
    from services.inventory import _product_to_dict
    from fastapi import HTTPException
    p = db.query(Product).filter(Product.id == pid, Product.is_deleted == False).first()
    if not p: raise HTTPException(404, "ไม่พบสินค้า")
    return _product_to_dict(p)


# ── Stock Movements ────────────────────────────────────────────
@router.post("/movements/receive", response_model=StockMovementResponse)
def receive_stock_ep(payload: StockReceiveCreate, current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return receive_stock(db, payload, current_user.id)

@router.post("/movements/issue", response_model=StockMovementResponse)
def issue_stock_ep(payload: StockIssueCreate, current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return issue_stock(db, payload, current_user.id)

@router.post("/movements/adjust", response_model=StockMovementResponse)
def adjust_stock_ep(payload: StockAdjustCreate, current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return adjust_stock(db, payload, current_user.id)

@router.get("/movements", response_model=List[StockMovementResponse])
def list_movements(product_id: Optional[UUID] = None, movement_type: Optional[MovementType] = None,
                   skip: int = 0, limit: int = 100,
                   current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_movements(db, product_id, movement_type, skip, limit)

@router.post("/movements/{mid}/post-gl", response_model=StockMovementResponse)
def post_movement_gl_ep(mid: UUID, current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return post_movement_to_gl(db, mid, current_user.id)


# ── Purchase Order ─────────────────────────────────────────────
@router.get("/po", response_model=List[PurchaseOrderResponse])
def list_po(status: Optional[POStatus] = None, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_pos(db, status)

@router.post("/po", response_model=PurchaseOrderResponse)
def create_po_ep(payload: PurchaseOrderCreate, current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return create_po(db, payload, current_user.id)

@router.post("/po/{po_id}/submit", response_model=PurchaseOrderResponse)
def submit_po_ep(po_id: UUID, current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return submit_po(db, po_id)

@router.post("/po/{po_id}/receive", response_model=PurchaseOrderResponse)
def receive_po_ep(po_id: UUID, payload: ReceivePORequest, current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return receive_po(db, po_id, payload, current_user.id)


# ── AI Forecast ────────────────────────────────────────────────
@router.get("/ai/forecast/{product_id}", response_model=ForecastResponse)
def forecast_ep(product_id: UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return forecast_product(db, product_id)

@router.get("/ai/reorder-suggestions")
def reorder_suggestions_ep(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_reorder_suggestions(db)
