"""
Inventory Service — FIFO/AVCO costing, Stock movements, PO, Auto-GL posting
"""
from decimal import Decimal
from datetime import date
from typing import List, Optional
from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy import or_
from fastapi import HTTPException

from models.inventory import (
    Warehouse, ProductCategory, Product, StockLot, StockMovement,
    MovementType, CostMethod, PurchaseOrder, POItem, POStatus,
)
from models.accounting import Account, Journal, JournalEntry, JournalStatus, NormalBalance
from services.accounting import next_journal_number
from schemas.inventory import (
    WarehouseCreate, CategoryCreate, ProductCreate, ProductUpdate,
    StockReceiveCreate, StockIssueCreate, StockAdjustCreate,
    PurchaseOrderCreate, ReceivePORequest,
)


# ── Warehouse ──────────────────────────────────────────────────

def get_warehouses(db: Session) -> List[Warehouse]:
    return db.query(Warehouse).filter(Warehouse.is_active == True, Warehouse.is_deleted == False).all()


def create_warehouse(db: Session, payload: WarehouseCreate) -> Warehouse:
    if db.query(Warehouse).filter(Warehouse.code == payload.code).first():
        raise HTTPException(400, f"รหัสคลัง {payload.code} มีอยู่แล้ว")
    if payload.is_default:
        db.query(Warehouse).update({Warehouse.is_default: False})
    w = Warehouse(**payload.model_dump())
    db.add(w); db.commit(); db.refresh(w)
    return w


# ── Category ───────────────────────────────────────────────────

def get_categories(db: Session) -> List[ProductCategory]:
    return db.query(ProductCategory).filter(ProductCategory.is_deleted == False).all()


def create_category(db: Session, payload: CategoryCreate) -> ProductCategory:
    if db.query(ProductCategory).filter(ProductCategory.code == payload.code).first():
        raise HTTPException(400, f"รหัสหมวดหมู่ {payload.code} มีอยู่แล้ว")
    c = ProductCategory(**payload.model_dump())
    db.add(c); db.commit(); db.refresh(c)
    return c


# ── Product ────────────────────────────────────────────────────

def get_products(db: Session, search: Optional[str] = None, low_stock_only: bool = False) -> List[dict]:
    q = db.query(Product).filter(Product.is_deleted == False)
    if search:
        q = q.filter(or_(Product.name.ilike(f"%{search}%"), Product.sku.ilike(f"%{search}%")))
    products = q.order_by(Product.name).all()

    result = []
    for p in products:
        is_low = p.track_stock and p.reorder_point > 0 and p.qty_on_hand <= p.reorder_point
        if low_stock_only and not is_low:
            continue
        result.append(_product_to_dict(p, is_low))
    return result


def _product_to_dict(p: Product, is_low: Optional[bool] = None) -> dict:
    if is_low is None:
        is_low = p.track_stock and p.reorder_point > 0 and p.qty_on_hand <= p.reorder_point
    return {
        "id": p.id, "sku": p.sku, "name": p.name, "name_en": p.name_en,
        "category_id": p.category_id, "unit": p.unit, "cost_method": p.cost_method,
        "sale_price": p.sale_price, "reorder_point": p.reorder_point, "reorder_qty": p.reorder_qty,
        "barcode": p.barcode, "is_active": p.is_active, "track_stock": p.track_stock,
        "qty_on_hand": p.qty_on_hand, "avg_cost": p.avg_cost,
        "stock_value": (p.qty_on_hand * p.avg_cost).quantize(Decimal("0.01")) if p.avg_cost else Decimal("0"),
        "is_low_stock": is_low,
    }


def create_product(db: Session, payload: ProductCreate) -> Product:
    if db.query(Product).filter(Product.sku == payload.sku).first():
        raise HTTPException(400, f"SKU {payload.sku} มีอยู่แล้ว")
    p = Product(**payload.model_dump())
    db.add(p); db.commit(); db.refresh(p)
    return p


def update_product(db: Session, pid: UUID, payload: ProductUpdate) -> Product:
    p = db.query(Product).filter(Product.id == pid, Product.is_deleted == False).first()
    if not p:
        raise HTTPException(404, "ไม่พบสินค้า")
    for k, v in payload.model_dump(exclude_none=True).items():
        setattr(p, k, v)
    db.commit(); db.refresh(p)
    return p


# ── Movement Number ────────────────────────────────────────────

def next_movement_number(db: Session, m_date: date, prefix: str) -> str:
    p = f"{prefix}-{m_date.year}{m_date.month:02d}-"
    last = db.query(StockMovement).filter(StockMovement.number.like(f"{p}%")).order_by(StockMovement.number.desc()).first()
    seq = int(last.number.split("-")[-1]) + 1 if last else 1
    return f"{p}{seq:04d}"


# ── Receive Stock (GR) ─────────────────────────────────────────

def receive_stock(db: Session, payload: StockReceiveCreate, user_id: Optional[UUID] = None) -> StockMovement:
    product = db.query(Product).filter(Product.id == payload.product_id, Product.is_deleted == False).first()
    if not product:
        raise HTTPException(404, "ไม่พบสินค้า")

    total_cost = payload.quantity * payload.unit_cost

    # Create FIFO lot
    lot = StockLot(
        product_id=product.id, warehouse_id=payload.warehouse_id,
        received_date=payload.date, unit_cost=payload.unit_cost,
        qty_received=payload.quantity, qty_remaining=payload.quantity,
        reference=payload.reference,
    )
    db.add(lot)

    # Update product running stock + avg cost (AVCO)
    old_value = product.qty_on_hand * product.avg_cost
    new_qty   = product.qty_on_hand + payload.quantity
    new_value = old_value + total_cost
    product.qty_on_hand = new_qty
    product.avg_cost    = (new_value / new_qty).quantize(Decimal("0.0001")) if new_qty > 0 else Decimal("0")

    movement = StockMovement(
        number=next_movement_number(db, payload.date, "GR"),
        product_id=product.id, warehouse_id=payload.warehouse_id,
        movement_type=MovementType.RECEIVE, date=payload.date,
        quantity=payload.quantity, unit_cost=payload.unit_cost, total_cost=total_cost,
        reference=payload.reference, note=payload.note, created_by=user_id,
    )
    db.add(movement)
    db.commit(); db.refresh(movement)
    return movement


# ── Issue Stock (GI) — FIFO/AVCO cost calculation ──────────────

def issue_stock(db: Session, payload: StockIssueCreate, user_id: Optional[UUID] = None) -> StockMovement:
    product = db.query(Product).filter(Product.id == payload.product_id, Product.is_deleted == False).first()
    if not product:
        raise HTTPException(404, "ไม่พบสินค้า")
    if product.qty_on_hand < payload.quantity:
        raise HTTPException(400, f"สินค้าคงเหลือไม่พอ (มี {product.qty_on_hand} {product.unit})")

    if product.cost_method == CostMethod.FIFO:
        total_cost = _consume_fifo(db, product.id, payload.warehouse_id, payload.quantity)
        unit_cost  = (total_cost / payload.quantity).quantize(Decimal("0.0001"))
    else:
        unit_cost  = product.avg_cost
        total_cost = (unit_cost * payload.quantity).quantize(Decimal("0.01"))

    product.qty_on_hand -= payload.quantity
    # avg_cost unchanged on issue for AVCO; for FIFO avg_cost is informational

    movement = StockMovement(
        number=next_movement_number(db, payload.date, "GI"),
        product_id=product.id, warehouse_id=payload.warehouse_id,
        movement_type=MovementType.ISSUE, date=payload.date,
        quantity=payload.quantity, unit_cost=unit_cost, total_cost=total_cost,
        reference=payload.reference, note=payload.note, created_by=user_id,
    )
    db.add(movement)
    db.commit(); db.refresh(movement)
    return movement


def _consume_fifo(db: Session, product_id: UUID, warehouse_id: UUID, qty_needed: Decimal) -> Decimal:
    """Consume stock lots FIFO order, return total cost consumed"""
    lots = db.query(StockLot).filter(
        StockLot.product_id == product_id,
        StockLot.warehouse_id == warehouse_id,
        StockLot.qty_remaining > 0,
        StockLot.is_deleted == False,
    ).order_by(StockLot.received_date, StockLot.created_at).all()

    remaining = qty_needed
    total_cost = Decimal("0")
    for lot in lots:
        if remaining <= 0:
            break
        take = min(lot.qty_remaining, remaining)
        total_cost += take * lot.unit_cost
        lot.qty_remaining -= take
        remaining -= take

    if remaining > 0:
        # Fallback: not enough lots tracked (e.g. legacy stock) — use last known avg cost
        product = db.query(Product).filter(Product.id == product_id).first()
        total_cost += remaining * (product.avg_cost or Decimal("0"))

    return total_cost


# ── Adjust Stock ───────────────────────────────────────────────

def adjust_stock(db: Session, payload: StockAdjustCreate, user_id: Optional[UUID] = None) -> StockMovement:
    product = db.query(Product).filter(Product.id == payload.product_id, Product.is_deleted == False).first()
    if not product:
        raise HTTPException(404, "ไม่พบสินค้า")

    if payload.direction == "in":
        unit_cost = payload.unit_cost or product.avg_cost or Decimal("0")
        total_cost = payload.quantity * unit_cost
        lot = StockLot(product_id=product.id, warehouse_id=payload.warehouse_id,
                       received_date=payload.date, unit_cost=unit_cost,
                       qty_received=payload.quantity, qty_remaining=payload.quantity,
                       reference="ADJUST")
        db.add(lot)
        old_value = product.qty_on_hand * product.avg_cost
        new_qty = product.qty_on_hand + payload.quantity
        product.qty_on_hand = new_qty
        product.avg_cost = ((old_value + total_cost) / new_qty).quantize(Decimal("0.0001")) if new_qty > 0 else Decimal("0")
        mtype = MovementType.ADJUST_IN
    else:
        if product.qty_on_hand < payload.quantity:
            raise HTTPException(400, "จำนวนปรับปรุงมากกว่าสต็อกคงเหลือ")
        unit_cost = product.avg_cost
        total_cost = payload.quantity * unit_cost
        if product.cost_method == CostMethod.FIFO:
            total_cost = _consume_fifo(db, product.id, payload.warehouse_id, payload.quantity)
        product.qty_on_hand -= payload.quantity
        mtype = MovementType.ADJUST_OUT

    movement = StockMovement(
        number=next_movement_number(db, payload.date, "ADJ"),
        product_id=product.id, warehouse_id=payload.warehouse_id,
        movement_type=mtype, date=payload.date,
        quantity=payload.quantity, unit_cost=unit_cost, total_cost=total_cost,
        note=payload.note, created_by=user_id,
    )
    db.add(movement)
    db.commit(); db.refresh(movement)
    return movement


def get_movements(db: Session, product_id: Optional[UUID] = None,
                  movement_type: Optional[MovementType] = None,
                  skip: int = 0, limit: int = 100) -> List[StockMovement]:
    q = db.query(StockMovement)
    if product_id:      q = q.filter(StockMovement.product_id == product_id)
    if movement_type:   q = q.filter(StockMovement.movement_type == movement_type)
    return q.order_by(StockMovement.date.desc(), StockMovement.number.desc()).offset(skip).limit(limit).all()


# ── GL Posting for COGS (on issue) ─────────────────────────────

def post_movement_to_gl(db: Session, movement_id: UUID, user_id: Optional[UUID] = None) -> StockMovement:
    m = db.query(StockMovement).filter(StockMovement.id == movement_id).first()
    if not m:
        raise HTTPException(404, "ไม่พบรายการเคลื่อนไหว")
    if m.gl_posted:
        raise HTTPException(400, "รายการนี้ Post GL แล้ว")
    if m.movement_type not in (MovementType.ISSUE, MovementType.ADJUST_OUT):
        raise HTTPException(400, "Post GL ได้เฉพาะรายการจ่ายออก (COGS)")

    cogs_acc = _find_acc(db, ["5101","51"])
    inv_acc  = _find_acc(db, ["1301","1300","13"])
    if not cogs_acc or not inv_acc:
        raise HTTPException(400, "ไม่พบบัญชีต้นทุนขายหรือสินค้าคงเหลือในผังบัญชี")

    j = Journal(
        number=next_journal_number(db, m.date), date=m.date,
        description=f"ต้นทุนสินค้าขาย {m.number}", reference=m.number,
        status=JournalStatus.POSTED, created_by=user_id,
    )
    db.add(j); db.flush()

    entries = [
        {"account_id": cogs_acc.id, "debit": m.total_cost, "credit": Decimal("0"), "description": f"COGS {m.number}"},
        {"account_id": inv_acc.id,  "debit": Decimal("0"), "credit": m.total_cost, "description": f"ตัดสต็อก {m.number}"},
    ]
    for ed in entries:
        db.add(JournalEntry(journal_id=j.id, **ed))
        acc = db.query(Account).filter(Account.id == ed["account_id"]).first()
        if acc:
            if acc.normal_balance == NormalBalance.DEBIT:
                acc.balance += ed["debit"] - ed["credit"]
            else:
                acc.balance += ed["credit"] - ed["debit"]

    m.gl_posted = True
    db.commit(); db.refresh(m)
    return m


# ── Purchase Order ─────────────────────────────────────────────

def next_po_number(db: Session, po_date: date) -> str:
    prefix = f"PO-{po_date.year}{po_date.month:02d}-"
    last = db.query(PurchaseOrder).filter(PurchaseOrder.number.like(f"{prefix}%")).order_by(PurchaseOrder.number.desc()).first()
    seq = int(last.number.split("-")[-1]) + 1 if last else 1
    return f"{prefix}{seq:04d}"


def create_po(db: Session, payload: PurchaseOrderCreate, user_id: Optional[UUID] = None,
              ai_generated: bool = False) -> PurchaseOrder:
    total = sum(it.quantity * it.unit_cost for it in payload.items)
    po = PurchaseOrder(
        number=next_po_number(db, payload.date),
        supplier_id=payload.supplier_id, warehouse_id=payload.warehouse_id,
        date=payload.date, expected_date=payload.expected_date,
        note=payload.note, total=total, created_by=user_id,
        ai_generated=ai_generated,
    )
    db.add(po); db.flush()
    for i, it in enumerate(payload.items):
        db.add(POItem(po_id=po.id, product_id=it.product_id, sequence=i,
                      quantity=it.quantity, unit_cost=it.unit_cost,
                      amount=it.quantity * it.unit_cost))
    db.commit(); db.refresh(po)
    return po


def submit_po(db: Session, po_id: UUID) -> PurchaseOrder:
    po = db.query(PurchaseOrder).filter(PurchaseOrder.id == po_id).first()
    if not po:
        raise HTTPException(404, "ไม่พบ PO")
    if po.status != POStatus.DRAFT:
        raise HTTPException(400, "เฉพาะ PO สถานะ Draft เท่านั้นที่ส่งได้")
    po.status = POStatus.ORDERED
    db.commit(); db.refresh(po)
    return po


def receive_po(db: Session, po_id: UUID, payload: ReceivePORequest, user_id: Optional[UUID] = None) -> PurchaseOrder:
    po = db.query(PurchaseOrder).filter(PurchaseOrder.id == po_id).first()
    if not po:
        raise HTTPException(404, "ไม่พบ PO")
    if po.status not in (POStatus.ORDERED, POStatus.PARTIAL):
        raise HTTPException(400, "PO ต้องอยู่ในสถานะ Ordered หรือ Partial")

    for recv_item in payload.items:
        po_item = db.query(POItem).filter(POItem.id == recv_item.po_item_id, POItem.po_id == po_id).first()
        if not po_item:
            continue
        remaining = po_item.quantity - po_item.qty_received
        recv_qty = min(recv_item.quantity, remaining)
        if recv_qty <= 0:
            continue

        # Receive into stock (creates FIFO lot + updates avg cost)
        receive_stock(db, StockReceiveCreate(
            product_id=po_item.product_id, warehouse_id=po.warehouse_id,
            date=date.today(), quantity=recv_qty, unit_cost=po_item.unit_cost,
            reference=po.number,
        ), user_id=user_id)

        po_item.qty_received += recv_qty

    # Update PO status
    all_received = all(it.qty_received >= it.quantity for it in po.items)
    any_received = any(it.qty_received > 0 for it in po.items)
    po.status = POStatus.RECEIVED if all_received else (POStatus.PARTIAL if any_received else po.status)

    db.commit(); db.refresh(po)
    return po


def get_pos(db: Session, status: Optional[POStatus] = None) -> List[PurchaseOrder]:
    q = db.query(PurchaseOrder).filter(PurchaseOrder.is_deleted == False)
    if status:
        q = q.filter(PurchaseOrder.status == status)
    return q.order_by(PurchaseOrder.date.desc()).all()


def _find_acc(db: Session, prefixes: List[str]) -> Optional[Account]:
    for p in prefixes:
        a = db.query(Account).filter(Account.code.like(f"{p}%"), Account.is_active == True, Account.is_deleted == False).first()
        if a:
            return a
    return None
