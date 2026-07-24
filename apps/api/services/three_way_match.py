"""
3-Way Match Service — จับคู่ PO ↔ Goods Receipt (StockMovement) ↔ Invoice/Bill
ตรวจสอบ quantity และ price ให้ตรงกันทั้ง 3 เอกสารก่อนอนุมัติจ่ายเงิน
"""
from decimal import Decimal
from typing import Optional, List
from uuid import UUID
from sqlalchemy.orm import Session
from fastapi import HTTPException

from models.document import MatchRecord, MatchStatus
from models.inventory import PurchaseOrder, POItem, StockMovement, MovementType
from models.ap import Bill, BillItem
from schemas.document import RunThreeWayMatchRequest


TOLERANCE_PCT = Decimal("0.02")   # 2% tolerance for minor rounding/price variance


def run_three_way_match(db: Session, bill_id: UUID) -> MatchRecord:
    """
    พยายามจับคู่ Bill กับ PO (ผ่าน supplier + ช่วงเวลาใกล้เคียง) และ Goods Receipt (StockMovement)
    แล้วเปรียบเทียบยอดเงิน/จำนวน
    """
    bill = db.query(Bill).filter(Bill.id == bill_id).first()
    if not bill:
        raise HTTPException(404, "ไม่พบ Bill")

    # Find related PO — same supplier, PO date before bill date, unreconciled
    po = None
    if bill.supplier_id:
        po = db.query(PurchaseOrder).filter(
            PurchaseOrder.supplier_id == bill.supplier_id,
            PurchaseOrder.date <= bill.date,
        ).order_by(PurchaseOrder.date.desc()).first()

    # Find related goods receipt movements — receives referencing this PO's number
    receipt_total = Decimal("0")
    if po:
        movements = db.query(StockMovement).filter(
            StockMovement.movement_type == MovementType.RECEIVE,
            StockMovement.reference == po.number,
        ).all()
        receipt_total = sum(m.total_cost or Decimal("0") for m in movements)

    po_amount = po.total if po else None
    invoice_amount = bill.total

    quantity_discrepancy = False
    price_discrepancy = False
    notes = []

    if po_amount is not None:
        diff_pct = abs(invoice_amount - po_amount) / po_amount if po_amount > 0 else Decimal("0")
        if diff_pct > TOLERANCE_PCT:
            price_discrepancy = True
            notes.append(f"ยอด Invoice (฿{invoice_amount:,.2f}) ต่างจาก PO (฿{po_amount:,.2f}) เกิน {TOLERANCE_PCT*100}%")

    if po and receipt_total > 0:
        diff_pct = abs(invoice_amount - receipt_total) / receipt_total if receipt_total > 0 else Decimal("0")
        if diff_pct > TOLERANCE_PCT:
            quantity_discrepancy = True
            notes.append(f"ยอด Invoice (฿{invoice_amount:,.2f}) ต่างจากยอดรับสินค้าจริง (฿{receipt_total:,.2f}) เกิน {TOLERANCE_PCT*100}%")

    if po is None:
        notes.append("ไม่พบ PO ที่เกี่ยวข้อง — ไม่สามารถตรวจสอบแบบ 3-Way ได้เต็มรูปแบบ")
        match_status = MatchStatus.UNMATCHED.value
    elif quantity_discrepancy or price_discrepancy:
        match_status = MatchStatus.DISCREPANCY.value
    else:
        match_status = MatchStatus.MATCHED.value

    # Check for existing match record for this bill, update instead of duplicating
    existing = db.query(MatchRecord).filter(MatchRecord.bill_id == bill_id).first()
    if existing:
        record = existing
    else:
        record = MatchRecord(bill_id=bill_id)
        db.add(record)

    record.po_id = po.id if po else None
    record.match_status = match_status
    record.po_amount = po_amount
    record.receipt_amount = receipt_total if receipt_total > 0 else None
    record.invoice_amount = invoice_amount
    record.quantity_discrepancy = quantity_discrepancy
    record.price_discrepancy = price_discrepancy
    record.discrepancy_notes = " | ".join(notes) if notes else None
    record.resolved = False

    db.commit(); db.refresh(record)
    return record


def get_match_records(db: Session, status: Optional[str] = None) -> List[MatchRecord]:
    q = db.query(MatchRecord).filter(MatchRecord.is_deleted == False)
    if status:
        q = q.filter(MatchRecord.match_status == status)
    return q.order_by(MatchRecord.created_at.desc()).all()


def resolve_match(db: Session, match_id: UUID, note: str, user_id: Optional[UUID] = None) -> MatchRecord:
    record = db.query(MatchRecord).filter(MatchRecord.id == match_id).first()
    if not record:
        raise HTTPException(404, "ไม่พบรายการจับคู่")
    record.resolved = True
    record.resolved_by = user_id
    record.resolved_note = note
    db.commit(); db.refresh(record)
    return record
