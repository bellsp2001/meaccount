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
from models.accounting import Account, BookSide, Journal, JournalEntry, JournalStatus, JournalType, NormalBalance
from services.accounting import next_journal_number
from services.document_books import resolve_book, require_book
from services.vat import document_totals
from services.ar import _find_account, create_invoice
from services.ap import _create_posted_journal
from schemas.sales import SalesDocCreate, SalesItemCreate
from schemas.ar import InvoiceCreate, InvoiceItemCreate


_PREFIX = {
    SalesDocType.QUOTATION:   "QT",
    SalesDocType.SALES_ORDER: "SO",
    SalesDocType.DEPOSIT:     "DEP",
    SalesDocType.CREDIT_NOTE: "CN",
    SalesDocType.DEBIT_NOTE:  "DN",
}
NOTE_TYPES = (SalesDocType.CREDIT_NOTE, SalesDocType.DEBIT_NOTE)


# ── Numbering ──────────────────────────────────────────────────
def next_doc_number(db: Session, doc_type: SalesDocType, d: date) -> str:
    prefix = f"{_PREFIX[doc_type]}-{d.year}{d.month:02d}-"
    last = (db.query(SalesDocument)
              .filter(SalesDocument.number.like(f"{prefix}%"))
              .order_by(SalesDocument.number.desc()).first())
    seq = int(last.number.split("-")[-1]) + 1 if last else 1
    return f"{prefix}{seq:04d}"


# ── Create / read ──────────────────────────────────────────────
def _calc_totals(db: Session, items: List[SalesItemCreate], vat_rate: Decimal, inclusive: bool = False):
    """(subtotal, VAT, total, document rate) — VAT is worked out per line (services.vat)."""
    return document_totals(db, items, vat_rate, inclusive)


def _item_fields(it) -> dict:
    """The stored fields of a document line, from a create payload line or another document's line."""
    return dict(description=it.description, quantity=it.quantity, unit=it.unit, unit_price=it.unit_price,
                discount_pct=it.discount_pct, amount=it.amount, tax_code_id=it.tax_code_id, vat_rate=it.vat_rate, product_id=it.product_id, detail=it.detail)


def create_sales_document(db: Session, payload: SalesDocCreate, user_id: Optional[UUID] = None) -> SalesDocument:
    customer = db.query(Customer).filter(Customer.id == payload.customer_id, Customer.is_deleted == False).first()
    if not customer:
        raise HTTPException(404, "ไม่พบลูกค้า")
    is_note = payload.doc_type in NOTE_TYPES
    if is_note:
        _issued_invoice_for(db, payload.invoice_id, payload.customer_id)

    subtotal, vat_amount, total, vat_rate = _calc_totals(db, payload.items, payload.vat_rate, payload.vat_inclusive)
    doc = SalesDocument(
        number=next_doc_number(db, payload.doc_type, payload.date),
        doc_type=payload.doc_type, customer_id=payload.customer_id,
        date=payload.date, valid_until=payload.valid_until, vat_inclusive=payload.vat_inclusive,
        vat_rate=vat_rate, subtotal=subtotal, vat_amount=vat_amount, total=total,
        deposit_amount=payload.deposit_amount if payload.doc_type == SalesDocType.DEPOSIT else Decimal("0"),
        note=payload.note, created_by=user_id,
        invoice_id=payload.invoice_id if is_note else None,
        reason=payload.reason if is_note else None,
        book_id=resolve_book(db, payload.book_id, BookSide.INCOME) and payload.book_id,
    )
    db.add(doc); db.flush()
    for i, it in enumerate(payload.items):
        db.add(SalesDocumentItem(document_id=doc.id, sequence=i, **_item_fields(it)))
    db.commit(); db.refresh(doc)
    return doc


EDITABLE = (SalesDocStatus.DRAFT, SalesDocStatus.SENT)


def update_sales_document(db: Session, doc_id: UUID, payload: SalesDocCreate) -> SalesDocument:
    """Rewrite a document's header and items. Only while it is a draft or sent and not
    yet posted to GL; the number and type stay."""
    doc = get_sales_document(db, doc_id)
    if doc.gl_posted or doc.status not in EDITABLE:
        raise HTTPException(400, "แก้ไขได้เฉพาะเอกสารที่ยังไม่ Post GL และยังไม่ถูกแปลง/ยกเลิก")
    if payload.doc_type != doc.doc_type:
        raise HTTPException(400, "เปลี่ยนประเภทเอกสารไม่ได้")
    if not db.query(Customer).filter(Customer.id == payload.customer_id, Customer.is_deleted == False).first():
        raise HTTPException(404, "ไม่พบลูกค้า")
    is_note = doc.doc_type in NOTE_TYPES
    if is_note:
        _issued_invoice_for(db, payload.invoice_id, payload.customer_id)

    doc.subtotal, doc.vat_amount, doc.total, doc.vat_rate = _calc_totals(db, payload.items, payload.vat_rate, payload.vat_inclusive)
    doc.vat_inclusive = payload.vat_inclusive
    doc.customer_id, doc.date, doc.valid_until = payload.customer_id, payload.date, payload.valid_until
    doc.note = payload.note
    doc.book_id = resolve_book(db, payload.book_id, BookSide.INCOME) and payload.book_id
    if doc.doc_type == SalesDocType.DEPOSIT:
        doc.deposit_amount = payload.deposit_amount
    if is_note:
        doc.invoice_id, doc.reason = payload.invoice_id, payload.reason
    doc.items = [SalesDocumentItem(sequence=i, **_item_fields(it)) for i, it in enumerate(payload.items)]
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
    if doc.gl_posted and status == SalesDocStatus.CANCELLED:
        raise HTTPException(400, "เอกสารนี้ Post ไป GL แล้ว ไม่สามารถยกเลิกได้")
    # Deposits and notes are confirmed by posting them (post-deposit / post-note), never by a bare status.
    if status == SalesDocStatus.ACCEPTED and not doc.gl_posted and doc.doc_type in (SalesDocType.DEPOSIT, *NOTE_TYPES):
        raise HTTPException(400, "ยืนยันเอกสารนี้ด้วยการลงบัญชี (Post GL)")
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
    if doc.doc_type in NOTE_TYPES:
        raise HTTPException(400, "ใบลดหนี้/ใบเพิ่มหนี้ไม่สามารถแปลงเป็นเอกสารถัดไปได้")

    items = [SalesItemCreate(
        description=it.description, quantity=it.quantity, unit=it.unit,
        unit_price=it.unit_price, discount_pct=it.discount_pct, sequence=it.sequence,
        tax_code_id=it.tax_code_id, vat_rate=it.vat_rate, product_id=it.product_id, detail=it.detail,
    ) for it in doc.items]

    if doc.doc_type == SalesDocType.QUOTATION:
        subtotal, vat_amount, total, vat_rate = _calc_totals(db, items, doc.vat_rate, doc.vat_inclusive)
        so = SalesDocument(
            number=next_doc_number(db, SalesDocType.SALES_ORDER, date.today()),
            doc_type=SalesDocType.SALES_ORDER, customer_id=doc.customer_id,
            date=date.today(), valid_until=doc.valid_until, vat_rate=vat_rate, vat_inclusive=doc.vat_inclusive,
            subtotal=subtotal, vat_amount=vat_amount, total=total,
            note=doc.note, created_by=user_id, source_doc_id=doc.id,
        )
        db.add(so); db.flush()
        for i, it in enumerate(items):
            db.add(SalesDocumentItem(document_id=so.id, sequence=i, **_item_fields(it)))
        doc.status = SalesDocStatus.CONVERTED
        doc.converted_to_type = "sales_order"
        doc.converted_to_id = so.id
        db.commit(); db.refresh(so)
        return {"source_id": doc.id, "target_type": "sales_order", "target_id": so.id, "target_number": so.number}

    # SALES_ORDER → Invoice
    inv = create_invoice(db, InvoiceCreate(
        customer_id=doc.customer_id, date=date.today(), vat_rate=doc.vat_rate, vat_inclusive=doc.vat_inclusive, note=doc.note,
        items=[InvoiceItemCreate(
            description=it.description, quantity=it.quantity, unit=it.unit,
            unit_price=it.unit_price, discount_pct=it.discount_pct, sequence=it.sequence,
            tax_code_id=it.tax_code_id, vat_rate=it.vat_rate, product_id=it.product_id, detail=it.detail,
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
    book = require_book(doc.book)
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
        reference=doc.number, journal_type=book.journal_type,
        status=JournalStatus.POSTED, created_by=user_id,
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


# ── Credit / Debit notes ───────────────────────────────────────
def _issued_invoice_for(db: Session, invoice_id: Optional[UUID], customer_id: UUID) -> Invoice:
    if not invoice_id:
        raise HTTPException(400, "ใบลดหนี้/ใบเพิ่มหนี้ต้องอ้างอิงใบแจ้งหนี้")
    inv = db.query(Invoice).filter(Invoice.id == invoice_id, Invoice.is_deleted == False).first()
    if not inv:
        raise HTTPException(404, "ไม่พบใบแจ้งหนี้ที่อ้างอิง")
    if not inv.gl_posted or inv.status == InvoiceStatus.CANCELLED:
        raise HTTPException(400, "ใบแจ้งหนี้ที่อ้างอิงต้องออกแล้ว (Post GL) และไม่ถูกยกเลิก")
    if inv.customer_id != customer_id:
        raise HTTPException(400, "ลูกค้าไม่ตรงกับใบแจ้งหนี้ที่อ้างอิง")
    return inv


def post_note_to_gl(db: Session, doc_id: UUID, user_id: Optional[UUID] = None) -> SalesDocument:
    """Issue a note against its invoice.
    Credit note: Dr รายได้ + VAT ขาย / Cr ลูกหนี้ — lowers the invoice's balance.
    Debit note:  Dr ลูกหนี้ / Cr รายได้ + VAT ขาย — raises it."""
    doc = get_sales_document(db, doc_id)
    if doc.doc_type not in NOTE_TYPES:
        raise HTTPException(400, "เอกสารนี้ไม่ใช่ใบลดหนี้/ใบเพิ่มหนี้")
    if doc.gl_posted:
        raise HTTPException(400, "เอกสารนี้ Post ไป GL แล้ว")
    if doc.status == SalesDocStatus.CANCELLED:
        raise HTTPException(400, "เอกสารนี้ถูกยกเลิกแล้ว")
    book = require_book(doc.book)
    inv = _issued_invoice_for(db, doc.invoice_id, doc.customer_id)
    is_credit = doc.doc_type == SalesDocType.CREDIT_NOTE
    if is_credit and doc.total > inv.balance_due:
        raise HTTPException(400, f"ยอดลดหนี้เกินยอดค้างชำระของ {inv.number} ({inv.balance_due})")

    # The note's book decides the accounts — normally the invoice's own book, which the form
    # pre-selects, so the note reverses (or extends) exactly the lines the invoice posted.
    ar_acc  = book.counter_account or _find_account(db, ["1201", "1200", "12"])
    rev_acc = book.account or _find_account(db, ["4101", "4100", "41"])
    vat_acc = _find_account(db, ["2103", "21"])
    if not ar_acc or not rev_acc:
        raise HTTPException(400, "ไม่พบบัญชีลูกหนี้หรือรายได้ในผังบัญชี")

    zero = Decimal("0")
    label = "ลดหนี้" if is_credit else "เพิ่มหนี้"
    lines = [
        (ar_acc, doc.total, f"{label} {doc.number} อ้างอิง {inv.number}"),
        (rev_acc, -doc.subtotal, f"รายได้ {label} {doc.number}"),
    ]
    if vat_acc and doc.vat_amount > 0:
        lines.append((vat_acc, -doc.vat_amount, f"VAT ขาย {label} {doc.number}"))
    # A debit note keeps the invoice's signs (AR debit); a credit note flips every line.
    sign = -1 if is_credit else 1
    entries = []
    for acc, amount, desc in lines:
        amount = amount * sign
        entries.append({"account_id": acc.id, "debit": amount if amount > 0 else zero,
                        "credit": -amount if amount < 0 else zero, "description": desc})

    journal = _create_posted_journal(
        db, doc.date, f"{label} {doc.number} — {doc.customer.name}", doc.number,
        entries, user_id, book.journal_type,
    )

    if is_credit:
        inv.balance_due -= doc.total
    else:
        inv.balance_due += doc.total
    if inv.balance_due <= 0:
        inv.status = InvoiceStatus.PAID
    elif inv.paid_amount > 0:
        inv.status = InvoiceStatus.PARTIAL
    else:
        inv.status = InvoiceStatus.SENT

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
