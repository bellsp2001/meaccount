"""
Sales Service — Quotation / Sales Order / Deposit documents, conversion flow,
deposit GL posting, receipts view and sales reporting.

Conversion flow:  Quotation ──convert──▶ Sales Order ──convert──▶ Invoice (models.ar)
Deposit is standalone; posting it books an advance-received liability.
"""
from decimal import Decimal
from datetime import date
from typing import List, Optional
from collections import defaultdict
from uuid import UUID
from sqlalchemy.orm import Session
from fastapi import HTTPException

from models.sales import SalesDocument, SalesDocumentItem, SalesDocType, SalesDocStatus
from models.ar import Customer, Invoice, InvoiceStatus, Payment
from models.accounting import Account, Journal, JournalEntry, JournalStatus, NormalBalance
from services.accounting import next_journal_number
from services.ar import _find_account, create_invoice
from schemas.sales import SalesDocCreate, SalesItemCreate
from schemas.ar import InvoiceCreate, InvoiceItemCreate


_PREFIX = {
    SalesDocType.QUOTATION:   "QT",
    SalesDocType.SALES_ORDER: "SO",
    SalesDocType.DEPOSIT:     "DEP",
}


# ── Numbering ──────────────────────────────────────────────────
def next_doc_number(db: Session, doc_type: SalesDocType, d: date) -> str:
    prefix = f"{_PREFIX[doc_type]}-{d.year}{d.month:02d}-"
    last = (db.query(SalesDocument)
              .filter(SalesDocument.number.like(f"{prefix}%"))
              .order_by(SalesDocument.number.desc()).first())
    seq = int(last.number.split("-")[-1]) + 1 if last else 1
    return f"{prefix}{seq:04d}"


# ── Create / read ──────────────────────────────────────────────
def _calc_totals(items: List[SalesItemCreate], vat_rate: Decimal):
    subtotal = sum((it.amount for it in items), Decimal("0"))
    vat_amount = (subtotal * vat_rate / 100).quantize(Decimal("0.01"))
    return subtotal, vat_amount, subtotal + vat_amount


def create_sales_document(db: Session, payload: SalesDocCreate, user_id: Optional[UUID] = None) -> SalesDocument:
    customer = db.query(Customer).filter(Customer.id == payload.customer_id, Customer.is_deleted == False).first()
    if not customer:
        raise HTTPException(404, "ไม่พบลูกค้า")

    subtotal, vat_amount, total = _calc_totals(payload.items, payload.vat_rate)
    doc = SalesDocument(
        number=next_doc_number(db, payload.doc_type, payload.date),
        doc_type=payload.doc_type, customer_id=payload.customer_id,
        date=payload.date, valid_until=payload.valid_until,
        vat_rate=payload.vat_rate, subtotal=subtotal, vat_amount=vat_amount, total=total,
        deposit_amount=payload.deposit_amount if payload.doc_type == SalesDocType.DEPOSIT else Decimal("0"),
        note=payload.note, created_by=user_id,
    )
    db.add(doc); db.flush()
    for i, it in enumerate(payload.items):
        db.add(SalesDocumentItem(
            document_id=doc.id, sequence=i, description=it.description,
            quantity=it.quantity, unit=it.unit, unit_price=it.unit_price,
            discount_pct=it.discount_pct, amount=it.amount,
        ))
    db.commit(); db.refresh(doc)
    return doc


def list_sales_documents(db: Session, doc_type: SalesDocType,
                         status: Optional[SalesDocStatus] = None,
                         customer_id: Optional[UUID] = None,
                         skip=0, limit=100) -> List[SalesDocument]:
    q = db.query(SalesDocument).filter(
        SalesDocument.doc_type == doc_type,
        SalesDocument.is_deleted == False,
    )
    if status:      q = q.filter(SalesDocument.status == status)
    if customer_id: q = q.filter(SalesDocument.customer_id == customer_id)
    return q.order_by(SalesDocument.date.desc(), SalesDocument.number.desc()).offset(skip).limit(limit).all()


def get_sales_document(db: Session, doc_id: UUID) -> SalesDocument:
    doc = db.query(SalesDocument).filter(SalesDocument.id == doc_id, SalesDocument.is_deleted == False).first()
    if not doc:
        raise HTTPException(404, "ไม่พบเอกสาร")
    return doc


def set_status(db: Session, doc_id: UUID, status: SalesDocStatus) -> SalesDocument:
    doc = get_sales_document(db, doc_id)
    if doc.status in (SalesDocStatus.CONVERTED, SalesDocStatus.CANCELLED):
        raise HTTPException(400, "เอกสารนี้ถูกแปลง/ยกเลิกแล้ว ไม่สามารถเปลี่ยนสถานะ")
    doc.status = status
    db.commit(); db.refresh(doc)
    return doc


# ── Conversion ─────────────────────────────────────────────────
def convert_document(db: Session, doc_id: UUID, user_id: Optional[UUID] = None):
    """Quotation → Sales Order (new SalesDocument); Sales Order → Invoice (models.ar)."""
    doc = get_sales_document(db, doc_id)
    if doc.status in (SalesDocStatus.CONVERTED, SalesDocStatus.CANCELLED):
        raise HTTPException(400, "เอกสารนี้ถูกแปลงหรือยกเลิกไปแล้ว")
    if doc.doc_type == SalesDocType.DEPOSIT:
        raise HTTPException(400, "ใบมัดจำไม่สามารถแปลงเป็นเอกสารถัดไปได้")

    items = [SalesItemCreate(
        description=it.description, quantity=it.quantity, unit=it.unit,
        unit_price=it.unit_price, discount_pct=it.discount_pct, sequence=it.sequence,
    ) for it in doc.items]

    if doc.doc_type == SalesDocType.QUOTATION:
        subtotal, vat_amount, total = _calc_totals(items, doc.vat_rate)
        so = SalesDocument(
            number=next_doc_number(db, SalesDocType.SALES_ORDER, date.today()),
            doc_type=SalesDocType.SALES_ORDER, customer_id=doc.customer_id,
            date=date.today(), valid_until=doc.valid_until, vat_rate=doc.vat_rate,
            subtotal=subtotal, vat_amount=vat_amount, total=total,
            note=doc.note, created_by=user_id, source_doc_id=doc.id,
        )
        db.add(so); db.flush()
        for i, it in enumerate(items):
            db.add(SalesDocumentItem(
                document_id=so.id, sequence=i, description=it.description,
                quantity=it.quantity, unit=it.unit, unit_price=it.unit_price,
                discount_pct=it.discount_pct, amount=it.amount,
            ))
        doc.status = SalesDocStatus.CONVERTED
        doc.converted_to_type = "sales_order"
        doc.converted_to_id = so.id
        db.commit(); db.refresh(so)
        return {"source_id": doc.id, "target_type": "sales_order", "target_id": so.id, "target_number": so.number}

    # SALES_ORDER → Invoice
    inv = create_invoice(db, InvoiceCreate(
        customer_id=doc.customer_id, date=date.today(), vat_rate=doc.vat_rate, note=doc.note,
        items=[InvoiceItemCreate(
            description=it.description, quantity=it.quantity, unit=it.unit,
            unit_price=it.unit_price, discount_pct=it.discount_pct, sequence=it.sequence,
        ) for it in items],
    ), user_id=user_id)
    doc.status = SalesDocStatus.CONVERTED
    doc.converted_to_type = "invoice"
    doc.converted_to_id = inv.id
    db.commit()
    return {"source_id": doc.id, "target_type": "invoice", "target_id": inv.id, "target_number": inv.number}


# ── Deposit GL posting ─────────────────────────────────────────
def post_deposit_to_gl(db: Session, doc_id: UUID, user_id: Optional[UUID] = None) -> SalesDocument:
    """Deposit received → Dr เงินสด/ธนาคาร  Cr เงินมัดจำรับล่วงหน้า (liability)."""
    doc = get_sales_document(db, doc_id)
    if doc.doc_type != SalesDocType.DEPOSIT:
        raise HTTPException(400, "เอกสารนี้ไม่ใช่ใบมัดจำ")
    if doc.gl_posted:
        raise HTTPException(400, "ใบมัดจำนี้ Post ไป GL แล้ว")
    amount = doc.deposit_amount if doc.deposit_amount > 0 else doc.total
    if amount <= 0:
        raise HTTPException(400, "ยอดมัดจำต้องมากกว่า 0")

    bank_acc = _find_account(db, ["1102", "1101", "11"])
    # advance received from customers — a current liability; fall back within class 2
    dep_acc  = _find_account(db, ["2201", "2200", "2105", "22", "21"])
    if not bank_acc or not dep_acc:
        raise HTTPException(400, "ไม่พบบัญชีเงินสด/ธนาคาร หรือบัญชีเงินมัดจำรับล่วงหน้าในผังบัญชี")

    journal = Journal(
        number=next_journal_number(db, doc.date), date=doc.date,
        description=f"รับเงินมัดจำ {doc.number} — {doc.customer.name}",
        reference=doc.number, status=JournalStatus.POSTED, created_by=user_id,
    )
    db.add(journal); db.flush()
    for ed in [
        {"account_id": bank_acc.id, "debit": amount, "credit": Decimal("0"), "description": f"รับเงินมัดจำ {doc.number}"},
        {"account_id": dep_acc.id,  "debit": Decimal("0"), "credit": amount, "description": f"เงินมัดจำรับล่วงหน้า {doc.number}"},
    ]:
        db.add(JournalEntry(journal_id=journal.id, **ed))
        acc = db.query(Account).filter(Account.id == ed["account_id"]).first()
        if acc:
            if acc.normal_balance == NormalBalance.DEBIT:
                acc.balance += ed["debit"] - ed["credit"]
            else:
                acc.balance += ed["credit"] - ed["debit"]

    doc.gl_posted = True
    doc.gl_journal_id = journal.id
    doc.status = SalesDocStatus.ACCEPTED
    db.commit(); db.refresh(doc)
    return doc


# ── Tax Invoices (view over issued Invoices) ───────────────────
def list_tax_invoices(db: Session, skip=0, limit=100) -> List[Invoice]:
    """In Thai SME practice the ใบแจ้งหนี้/ใบกำกับภาษี is one document; an issued
    (GL-posted) invoice IS the tax invoice. This lists those."""
    return (db.query(Invoice)
              .filter(Invoice.gl_posted == True, Invoice.is_deleted == False)
              .order_by(Invoice.date.desc()).offset(skip).limit(limit).all())


# ── Receipts (view over Payments) ──────────────────────────────
def list_receipts(db: Session, skip=0, limit=100) -> List[dict]:
    payments = (db.query(Payment)
                  .order_by(Payment.date.desc(), Payment.created_at.desc())
                  .offset(skip).limit(limit).all())
    out = []
    for p in payments:
        inv = p.invoice
        out.append({
            "id": p.id,
            "receipt_number": f"RCPT-{p.date.year}{p.date.month:02d}-{str(p.id)[:8].upper()}",
            "invoice_id": p.invoice_id,
            "invoice_number": inv.number if inv else None,
            "customer_name": inv.customer.name if inv and inv.customer else None,
            "date": p.date,
            "amount": p.amount,
            "method": p.method.value if hasattr(p.method, "value") else str(p.method),
            "reference": p.reference,
            "gl_posted": p.gl_posted,
        })
    return out


# ── Sales report ───────────────────────────────────────────────
def sales_report(db: Session, period_from: Optional[date] = None, period_to: Optional[date] = None) -> dict:
    to_d   = period_to or date.today()
    from_d = period_from or to_d.replace(day=1)

    invoices = db.query(Invoice).filter(
        Invoice.is_deleted == False,
        Invoice.status != InvoiceStatus.CANCELLED,
        Invoice.date >= from_d, Invoice.date <= to_d,
    ).all()

    total_sales = sum((i.subtotal for i in invoices), Decimal("0"))
    total_vat   = sum((i.vat_amount for i in invoices), Decimal("0"))
    paid_amount = sum((i.paid_amount for i in invoices), Decimal("0"))
    outstanding = sum((i.balance_due for i in invoices), Decimal("0"))

    by_month_map = defaultdict(lambda: {"total": Decimal("0"), "count": 0})
    by_cust_map  = defaultdict(lambda: {"total": Decimal("0"), "count": 0})
    by_status    = defaultdict(int)
    for i in invoices:
        mk = f"{i.date.year}-{i.date.month:02d}"
        by_month_map[mk]["total"] += i.total
        by_month_map[mk]["count"] += 1
        cname = i.customer.name if i.customer else "—"
        by_cust_map[cname]["total"] += i.total
        by_cust_map[cname]["count"] += 1
        by_status[i.status.value if hasattr(i.status, "value") else str(i.status)] += 1

    by_month = [{"month": k, "total": v["total"], "count": v["count"]}
                for k, v in sorted(by_month_map.items())]
    by_customer = sorted(
        [{"customer": k, "total": v["total"], "count": v["count"]} for k, v in by_cust_map.items()],
        key=lambda x: x["total"], reverse=True,
    )[:10]

    return {
        "period_from": str(from_d), "period_to": str(to_d),
        "total_sales": total_sales, "total_vat": total_vat,
        "invoice_count": len(invoices), "paid_amount": paid_amount, "outstanding": outstanding,
        "by_month": by_month, "by_customer": by_customer, "by_status": dict(by_status),
    }
