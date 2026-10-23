"""
POS Service — Shift management, checkout, void, shift close reconciliation.

Integration approach: rather than reimplementing stock-costing or GL-posting
logic, checkout calls directly into the already-tested
`services.inventory.issue_stock` (for real FIFO/AVCO costing + stock
movement records) and posts its own sale-specific journal (Dr Cash/AR,
Cr Revenue + VAT Output, Dr COGS, Cr Inventory) using the same account-
lookup-by-prefix pattern established in services/inventory.py and
services/ar.py, so it's consistent with how every other module in this
codebase posts to the GL.
"""
from decimal import Decimal
from datetime import date, datetime
from typing import List, Optional
from uuid import UUID
from sqlalchemy.orm import Session
from fastapi import HTTPException

from models.pos import POSShift, POSSale, POSSaleItem, POSPayment, ShiftStatus, SaleStatus
from models.inventory import Product
from models.accounting import Account, Journal, JournalEntry, JournalStatus, NormalBalance
from services.accounting import next_journal_number
from services.inventory import issue_stock
from schemas.inventory import StockIssueCreate, StockReceiveCreate
from schemas.pos import ShiftOpenRequest, ShiftCloseRequest, SaleCreate, VoidSaleRequest


# ── Shift Management ──────────────────────────────────────────

def open_shift(db: Session, payload: ShiftOpenRequest, user_id: Optional[UUID] = None) -> POSShift:
    existing_open = db.query(POSShift).filter(
        POSShift.warehouse_id == payload.warehouse_id, POSShift.status == ShiftStatus.OPEN.value,
    ).first()
    if existing_open:
        raise HTTPException(400, "คลังนี้มีกะที่เปิดอยู่แล้ว — ต้องปิดกะเดิมก่อนเปิดใหม่")

    shift = POSShift(
        warehouse_id=payload.warehouse_id, opened_by=user_id,
        status=ShiftStatus.OPEN.value, opening_cash=payload.opening_cash,
        opened_at=datetime.utcnow(),
    )
    db.add(shift); db.commit(); db.refresh(shift)
    return shift


def get_shift(db: Session, shift_id: UUID) -> POSShift:
    shift = db.query(POSShift).filter(POSShift.id == shift_id, POSShift.is_deleted == False).first()
    if not shift:
        raise HTTPException(404, "ไม่พบกะการขาย")
    return shift


def get_open_shift(db: Session, warehouse_id: UUID) -> Optional[POSShift]:
    return db.query(POSShift).filter(
        POSShift.warehouse_id == warehouse_id, POSShift.status == ShiftStatus.OPEN.value,
    ).first()


def close_shift(db: Session, shift_id: UUID, payload: ShiftCloseRequest, user_id: Optional[UUID] = None) -> POSShift:
    shift = get_shift(db, shift_id)
    if shift.status != ShiftStatus.OPEN.value:
        raise HTTPException(400, "กะนี้ปิดไปแล้ว")

    completed_sales = [s for s in shift.sales if s.status == SaleStatus.COMPLETED.value]
    cash_sales_total = sum(
        p.amount for s in completed_sales for p in s.payments if p.method == "cash"
    ) or Decimal("0")

    expected = shift.opening_cash + cash_sales_total
    variance = payload.closing_cash_counted - expected

    shift.closing_cash_counted = payload.closing_cash_counted
    shift.closing_cash_expected = expected
    shift.cash_variance = variance
    shift.status = ShiftStatus.CLOSED.value
    shift.closed_by = user_id
    shift.closed_at = datetime.utcnow()
    shift.close_note = payload.close_note

    db.commit(); db.refresh(shift)
    return shift


def get_shift_summary(db: Session, shift_id: UUID) -> dict:
    shift = get_shift(db, shift_id)
    completed = [s for s in shift.sales if s.status == SaleStatus.COMPLETED.value]
    return {
        "id": shift.id, "warehouse_id": shift.warehouse_id, "status": shift.status,
        "opening_cash": shift.opening_cash, "opened_at": shift.opened_at,
        "closing_cash_counted": shift.closing_cash_counted,
        "closing_cash_expected": shift.closing_cash_expected,
        "cash_variance": shift.cash_variance, "closed_at": shift.closed_at,
        "sale_count": len(completed),
        "total_sales": sum(s.total for s in completed) or Decimal("0"),
    }


# ── Checkout ───────────────────────────────────────────────────

def next_sale_number(db: Session, sale_date: date) -> str:
    prefix = f"POS-{sale_date.strftime('%Y%m%d')}-"
    last = db.query(POSSale).filter(POSSale.number.like(f"{prefix}%")).order_by(POSSale.number.desc()).first()
    seq = int(last.number.split("-")[-1]) + 1 if last else 1
    return f"{prefix}{seq:04d}"


def checkout(db: Session, payload: SaleCreate, user_id: Optional[UUID] = None) -> POSSale:
    shift = get_shift(db, payload.shift_id)
    if shift.status != ShiftStatus.OPEN.value:
        raise HTTPException(400, "กะนี้ปิดไปแล้ว ไม่สามารถขายสินค้าได้")

    today = date.today()

    # Validate stock availability up-front, before touching anything, so a
    # mid-cart failure doesn't leave a half-issued sale.
    products: dict = {}
    for item in payload.items:
        product = db.query(Product).filter(Product.id == item.product_id, Product.is_deleted == False).first()
        if not product:
            raise HTTPException(404, f"ไม่พบสินค้า {item.product_id}")
        if product.track_stock and product.qty_on_hand < item.quantity:
            raise HTTPException(400, f"สินค้า '{product.name}' คงเหลือไม่พอ (มี {product.qty_on_hand} {product.unit})")
        products[str(item.product_id)] = product

    # Build sale + line items, issuing stock (real FIFO/AVCO cost) per item.
    subtotal = Decimal("0")
    sale_items_data = []
    for item in payload.items:
        product = products[str(item.product_id)]
        unit_price = item.unit_price if item.unit_price is not None else product.sale_price
        line_amount = (unit_price * item.quantity * (1 - item.discount_pct / 100)).quantize(Decimal("0.01"))
        subtotal += line_amount

        unit_cost_at_sale = None
        if product.track_stock:
            movement = issue_stock(db, StockIssueCreate(
                product_id=product.id, warehouse_id=shift.warehouse_id,
                date=today, quantity=item.quantity, reference="POS",
            ), user_id=user_id)
            unit_cost_at_sale = movement.unit_cost

        sale_items_data.append({
            "product_id": product.id, "quantity": item.quantity, "unit_price": unit_price,
            "discount_pct": item.discount_pct, "amount": line_amount,
            "unit_cost_at_sale": unit_cost_at_sale,
        })

    vat_amount = (subtotal * payload.vat_rate / 100).quantize(Decimal("0.01"))
    total = subtotal + vat_amount - payload.discount_amount

    payment_total = sum(p.amount for p in payload.payments)
    if abs(payment_total - total) > Decimal("0.01"):
        raise HTTPException(400,
            f"ยอดชำระ (฿{payment_total:,.2f}) ไม่ตรงกับยอดขาย (฿{total:,.2f})")

    sale = POSSale(
        number=next_sale_number(db, today), shift_id=shift.id, warehouse_id=shift.warehouse_id,
        customer_id=payload.customer_id, subtotal=subtotal, vat_amount=vat_amount,
        discount_amount=payload.discount_amount, total=total,
        status=SaleStatus.COMPLETED.value, cashier_id=user_id, sold_at=datetime.utcnow(),
    )
    db.add(sale); db.flush()

    for item_data in sale_items_data:
        db.add(POSSaleItem(sale_id=sale.id, **item_data))
    for p in payload.payments:
        db.add(POSPayment(sale_id=sale.id, method=p.method, amount=p.amount, reference=p.reference))

    db.commit(); db.refresh(sale)
    return sale


def post_sale_to_gl(db: Session, sale_id: UUID, user_id: Optional[UUID] = None) -> POSSale:
    sale = db.query(POSSale).filter(POSSale.id == sale_id).first()
    if not sale:
        raise HTTPException(404, "ไม่พบรายการขาย")
    if sale.gl_posted:
        raise HTTPException(400, "รายการนี้ Post GL แล้ว")
    if sale.status != SaleStatus.COMPLETED.value:
        raise HTTPException(400, "Post GL ได้เฉพาะรายการที่สถานะ Completed")

    cash_acc = _find_acc(db, ["1101", "11"])
    revenue_acc = _find_acc(db, ["4101", "41", "4"])
    vat_output_acc = _find_acc(db, ["2103", "21"])
    cogs_acc = _find_acc(db, ["5101", "51"])
    inventory_acc = _find_acc(db, ["1301", "13"])

    if not cash_acc or not revenue_acc:
        raise HTTPException(400, "ไม่พบบัญชีเงินสดหรือรายได้ในผังบัญชี")

    total_cogs = sum(
        (i.unit_cost_at_sale or Decimal("0")) * i.quantity for i in sale.items
    )

    entries = [
        {"account_id": cash_acc.id, "debit": sale.total, "credit": Decimal("0"), "description": f"รับเงินขาย POS {sale.number}"},
        {"account_id": revenue_acc.id, "debit": Decimal("0"), "credit": sale.subtotal, "description": f"รายได้ขาย {sale.number}"},
    ]
    if sale.vat_amount > 0 and vat_output_acc:
        entries.append({"account_id": vat_output_acc.id, "debit": Decimal("0"), "credit": sale.vat_amount, "description": f"VAT ขาย {sale.number}"})

    if total_cogs > 0 and cogs_acc and inventory_acc:
        entries.append({"account_id": cogs_acc.id, "debit": total_cogs, "credit": Decimal("0"), "description": f"ต้นทุนขาย {sale.number}"})
        entries.append({"account_id": inventory_acc.id, "debit": Decimal("0"), "credit": total_cogs, "description": f"ตัดสต็อก {sale.number}"})

    j = Journal(
        number=next_journal_number(db, sale.sold_at.date()), date=sale.sold_at.date(),
        description=f"ขายหน้าร้าน {sale.number}", reference=sale.number,
        status=JournalStatus.POSTED, created_by=user_id,
    )
    db.add(j); db.flush()
    for ed in entries:
        db.add(JournalEntry(journal_id=j.id, **ed))
        acc = db.query(Account).filter(Account.id == ed["account_id"]).first()
        if acc:
            if acc.normal_balance == NormalBalance.DEBIT:
                acc.balance += ed["debit"] - ed["credit"]
            else:
                acc.balance += ed["credit"] - ed["debit"]

    sale.gl_posted = True
    sale.gl_journal_id = j.id
    db.commit(); db.refresh(sale)
    return sale


def void_sale(db: Session, sale_id: UUID, payload: VoidSaleRequest, user_id: Optional[UUID] = None) -> POSSale:
    """
    Voids a completed sale: restores the stock that was issued (as a
    RECEIVE-style reversal via receive_stock, since re-adding to FIFO lots
    correctly needs the same code path as any other stock-in) and marks the
    sale voided. Does not touch GL if the sale was never posted; if it WAS
    posted, voiding after posting is deliberately blocked — that needs an
    explicit reversing journal entry, not a silent GL rewrite.
    """
    sale = db.query(POSSale).filter(POSSale.id == sale_id).first()
    if not sale:
        raise HTTPException(404, "ไม่พบรายการขาย")
    if sale.status == SaleStatus.VOIDED.value:
        raise HTTPException(400, "รายการนี้ถูกยกเลิกไปแล้ว")
    if sale.gl_posted:
        raise HTTPException(400, "รายการนี้ Post GL แล้ว ไม่สามารถยกเลิกได้โดยตรง — ต้องทำรายการปรับปรุงย้อนกลับแทน")

    from services.inventory import receive_stock

    for item in sale.items:
        product = db.query(Product).filter(Product.id == item.product_id).first()
        if product and product.track_stock:
            receive_stock(db, StockReceiveCreate(
                product_id=item.product_id, warehouse_id=sale.warehouse_id,
                date=date.today(), quantity=item.quantity,
                unit_cost=item.unit_cost_at_sale or product.avg_cost or Decimal("0"),
                reference=f"VOID-{sale.number}",
            ), user_id=user_id)

    sale.status = SaleStatus.VOIDED.value
    sale.void_reason = payload.reason
    db.commit(); db.refresh(sale)
    return sale


def get_sales(db: Session, shift_id: Optional[UUID] = None, status: Optional[str] = None) -> List[POSSale]:
    q = db.query(POSSale).filter(POSSale.is_deleted == False)
    if shift_id:
        q = q.filter(POSSale.shift_id == shift_id)
    if status:
        q = q.filter(POSSale.status == status)
    return q.order_by(POSSale.sold_at.desc()).all()


def lookup_barcode(db: Session, barcode: str) -> Product:
    product = db.query(Product).filter(
        (Product.barcode == barcode) | (Product.sku == barcode),
        Product.is_active == True, Product.is_deleted == False,
    ).first()
    if not product:
        raise HTTPException(404, "ไม่พบสินค้าจากบาร์โค้ด/รหัสนี้")
    return product


def _find_acc(db: Session, prefixes: List[str]) -> Optional[Account]:
    for p in prefixes:
        a = db.query(Account).filter(Account.code.like(f"{p}%"), Account.is_active == True, Account.is_deleted == False).first()
        if a:
            return a
    return None
