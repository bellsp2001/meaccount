"""
Purchase Service — RFQ / Purchase Order / Deposit / Credit & Debit note documents,
conversion flow, GL posting, and expense-side views and reports.

Conversion flow:  RFQ ──convert──▶ Purchase Order ──convert──▶ Bill (models.ap)
Deposit is standalone; posting it books an advance-paid asset.
Credit/debit notes adjust a posted bill and post the adjustment to GL.
"""
from decimal import Decimal
from datetime import date
from typing import List, Optional
from collections import defaultdict
from uuid import UUID
from sqlalchemy.orm import Session
from fastapi import HTTPException

from models.purchase import PurchaseDocument, PurchaseDocumentItem, PurchaseDocType
from models.sales import SalesDocStatus
from models.ap import Supplier, Bill, BillStatus, APPayment
from models.accounting import BookSide
from services.ap import _find_acc, _create_posted_journal, bill_posting_accounts, create_bill
from services.document_books import resolve_book, require_book
from services.sales import _calc_totals, _item_fields
from schemas.purchase import PurchaseDocCreate
from schemas.sales import SalesItemCreate
from schemas.ap import BillCreate, BillItemCreate


_PREFIX = {
    PurchaseDocType.RFQ:            "RFQ",
    PurchaseDocType.PURCHASE_ORDER: "PUR",   # "PO-" is taken by inventory purchase orders
    PurchaseDocType.DEPOSIT:        "PDEP",
    PurchaseDocType.CREDIT_NOTE:    "PCN",
    PurchaseDocType.DEBIT_NOTE:     "PDN",
}
NOTE_TYPES = (PurchaseDocType.CREDIT_NOTE, PurchaseDocType.DEBIT_NOTE)
# Bills that can no longer carry an adjustment
_CLOSED_BILL = (BillStatus.CANCELLED, BillStatus.REJECTED)


# ── Numbering ──────────────────────────────────────────────────
def next_doc_number(db: Session, doc_type: PurchaseDocType, d: date) -> str:
    prefix = f"{_PREFIX[doc_type]}-{d.year}{d.month:02d}-"
    last = (db.query(PurchaseDocument)
              .filter(PurchaseDocument.number.like(f"{prefix}%"))
              .order_by(PurchaseDocument.number.desc()).first())
    seq = int(last.number.split("-")[-1]) + 1 if last else 1
    return f"{prefix}{seq:04d}"


# ── Create / read ──────────────────────────────────────────────
def _add_items(db: Session, doc_id: UUID, items: List[SalesItemCreate]):
    for i, it in enumerate(items):
        db.add(PurchaseDocumentItem(document_id=doc_id, sequence=i, **_item_fields(it)))


def create_purchase_document(db: Session, payload: PurchaseDocCreate, user_id: Optional[UUID] = None) -> PurchaseDocument:
    supplier = db.query(Supplier).filter(Supplier.id == payload.supplier_id, Supplier.is_deleted == False).first()
    if not supplier:
        raise HTTPException(404, "ไม่พบผู้จำหน่าย")
    is_note = payload.doc_type in NOTE_TYPES
    if is_note:
        _posted_bill_for(db, payload.bill_id, payload.supplier_id)

    subtotal, vat_amount, total, vat_rate = _calc_totals(db, payload.items, payload.vat_rate, payload.vat_inclusive)
    doc = PurchaseDocument(
        number=next_doc_number(db, payload.doc_type, payload.date),
        doc_type=payload.doc_type, supplier_id=payload.supplier_id,
        date=payload.date, valid_until=payload.valid_until, vat_inclusive=payload.vat_inclusive,
        vat_rate=vat_rate, subtotal=subtotal, vat_amount=vat_amount, total=total,
        deposit_amount=payload.deposit_amount if payload.doc_type == PurchaseDocType.DEPOSIT else Decimal("0"),
        ref_number=payload.ref_number, note=payload.note, created_by=user_id,
        bill_id=payload.bill_id if is_note else None,
        reason=payload.reason if is_note else None,
        book_id=resolve_book(db, payload.book_id, BookSide.EXPENSE) and payload.book_id,
    )
    db.add(doc); db.flush()
    _add_items(db, doc.id, payload.items)
    db.commit(); db.refresh(doc)
    return doc


EDITABLE = (SalesDocStatus.DRAFT, SalesDocStatus.SENT)


def update_purchase_document(db: Session, doc_id: UUID, payload: PurchaseDocCreate) -> PurchaseDocument:
    """Rewrite a document's header and items. Only while it is a draft or sent and not
    yet posted to GL; the number and type stay."""
    doc = get_purchase_document(db, doc_id)
    if doc.gl_posted or doc.status not in EDITABLE:
        raise HTTPException(400, "แก้ไขได้เฉพาะเอกสารที่ยังไม่ Post GL และยังไม่ถูกแปลง/ยกเลิก")
    if payload.doc_type != doc.doc_type:
        raise HTTPException(400, "เปลี่ยนประเภทเอกสารไม่ได้")
    if not db.query(Supplier).filter(Supplier.id == payload.supplier_id, Supplier.is_deleted == False).first():
        raise HTTPException(404, "ไม่พบผู้จำหน่าย")
    is_note = doc.doc_type in NOTE_TYPES
    if is_note:
        _posted_bill_for(db, payload.bill_id, payload.supplier_id)

    doc.subtotal, doc.vat_amount, doc.total, doc.vat_rate = _calc_totals(db, payload.items, payload.vat_rate, payload.vat_inclusive)
    doc.vat_inclusive = payload.vat_inclusive
    doc.supplier_id, doc.date, doc.valid_until = payload.supplier_id, payload.date, payload.valid_until
    doc.ref_number, doc.note = payload.ref_number, payload.note
    doc.book_id = resolve_book(db, payload.book_id, BookSide.EXPENSE) and payload.book_id
    if doc.doc_type == PurchaseDocType.DEPOSIT:
        doc.deposit_amount = payload.deposit_amount
    if is_note:
        doc.bill_id, doc.reason = payload.bill_id, payload.reason
    doc.items = [PurchaseDocumentItem(sequence=i, **_item_fields(it)) for i, it in enumerate(payload.items)]
    db.commit(); db.refresh(doc)
    return doc


def list_purchase_documents(db: Session, doc_type: PurchaseDocType,
                            status: Optional[SalesDocStatus] = None,
                            supplier_id: Optional[UUID] = None,
                            skip=0, limit=100) -> List[PurchaseDocument]:
    q = db.query(PurchaseDocument).filter(
        PurchaseDocument.doc_type == doc_type,
        PurchaseDocument.is_deleted == False,
    )
    if status:      q = q.filter(PurchaseDocument.status == status)
    if supplier_id: q = q.filter(PurchaseDocument.supplier_id == supplier_id)
    return q.order_by(PurchaseDocument.date.desc(), PurchaseDocument.number.desc()).offset(skip).limit(limit).all()


def get_purchase_document(db: Session, doc_id: UUID) -> PurchaseDocument:
    doc = db.query(PurchaseDocument).filter(PurchaseDocument.id == doc_id, PurchaseDocument.is_deleted == False).first()
    if not doc:
        raise HTTPException(404, "ไม่พบเอกสาร")
    return doc


def set_status(db: Session, doc_id: UUID, status: SalesDocStatus) -> PurchaseDocument:
    doc = get_purchase_document(db, doc_id)
    if doc.status in (SalesDocStatus.CONVERTED, SalesDocStatus.CANCELLED):
        raise HTTPException(400, "เอกสารนี้ถูกแปลง/ยกเลิกแล้ว ไม่สามารถเปลี่ยนสถานะ")
    if doc.gl_posted and status == SalesDocStatus.CANCELLED:
        raise HTTPException(400, "เอกสารนี้ Post ไป GL แล้ว ไม่สามารถยกเลิกได้")
    # Deposits and notes are confirmed by posting them (post-deposit / post-note), never by a bare status.
    if status == SalesDocStatus.ACCEPTED and not doc.gl_posted and doc.doc_type in (PurchaseDocType.DEPOSIT, *NOTE_TYPES):
        raise HTTPException(400, "ยืนยันเอกสารนี้ด้วยการลงบัญชี (Post GL)")
    doc.status = status
    db.commit(); db.refresh(doc)
    return doc


# ── Conversion ─────────────────────────────────────────────────
def convert_document(db: Session, doc_id: UUID, user_id: Optional[UUID] = None):
    """RFQ → Purchase Order (new PurchaseDocument); Purchase Order → Bill (models.ap)."""
    doc = get_purchase_document(db, doc_id)
    if doc.status in (SalesDocStatus.CONVERTED, SalesDocStatus.CANCELLED):
        raise HTTPException(400, "เอกสารนี้ถูกแปลงหรือยกเลิกไปแล้ว")
    if doc.doc_type not in (PurchaseDocType.RFQ, PurchaseDocType.PURCHASE_ORDER):
        raise HTTPException(400, "เอกสารประเภทนี้ไม่สามารถแปลงเป็นเอกสารถัดไปได้")

    items = [SalesItemCreate(
        description=it.description, quantity=it.quantity, unit=it.unit,
        unit_price=it.unit_price, discount_pct=it.discount_pct, sequence=it.sequence,
        tax_code_id=it.tax_code_id, vat_rate=it.vat_rate, product_id=it.product_id, detail=it.detail,
    ) for it in doc.items]

    if doc.doc_type == PurchaseDocType.RFQ:
        subtotal, vat_amount, total, vat_rate = _calc_totals(db, items, doc.vat_rate, doc.vat_inclusive)
        po = PurchaseDocument(
            number=next_doc_number(db, PurchaseDocType.PURCHASE_ORDER, date.today()),
            doc_type=PurchaseDocType.PURCHASE_ORDER, supplier_id=doc.supplier_id,
            date=date.today(), valid_until=doc.valid_until, vat_rate=vat_rate, vat_inclusive=doc.vat_inclusive,
            subtotal=subtotal, vat_amount=vat_amount, total=total,
            note=doc.note, created_by=user_id, source_doc_id=doc.id,
        )
        db.add(po); db.flush()
        _add_items(db, po.id, items)
        doc.status = SalesDocStatus.CONVERTED
        doc.converted_to_type = "purchase_order"
        doc.converted_to_id = po.id
        db.commit(); db.refresh(po)
        return {"source_id": doc.id, "target_type": "purchase_order", "target_id": po.id, "target_number": po.number}

    # PURCHASE_ORDER → Bill. Bill lines carry no discount, so the discount goes into the unit price.
    bill = create_bill(db, BillCreate(
        supplier_id=doc.supplier_id, date=date.today(), vat_rate=doc.vat_rate, vat_inclusive=doc.vat_inclusive,
        description=f"ตามใบสั่งซื้อ {doc.number}", ref_number=doc.ref_number, note=doc.note,
        items=[BillItemCreate(
            description=it.description, quantity=it.quantity, unit=it.unit, sequence=it.sequence,
            unit_price=(it.unit_price * (1 - it.discount_pct / 100)).quantize(Decimal("0.0001")),
            tax_code_id=it.tax_code_id, vat_rate=it.vat_rate, product_id=it.product_id, detail=it.detail,
        ) for it in items],
    ), user_id=user_id)
    doc.status = SalesDocStatus.CONVERTED
    doc.converted_to_type = "bill"
    doc.converted_to_id = bill.id
    db.commit()
    return {"source_id": doc.id, "target_type": "bill", "target_id": bill.id, "target_number": bill.number}


# ── Deposit GL posting ─────────────────────────────────────────
def post_deposit_to_gl(db: Session, doc_id: UUID, user_id: Optional[UUID] = None) -> PurchaseDocument:
    """Deposit paid → Dr เงินมัดจำจ่ายล่วงหน้า (asset)  Cr เงินสด/ธนาคาร."""
    doc = get_purchase_document(db, doc_id)
    if doc.doc_type != PurchaseDocType.DEPOSIT:
        raise HTTPException(400, "เอกสารนี้ไม่ใช่ใบจ่ายมัดจำ")
    if doc.gl_posted:
        raise HTTPException(400, "ใบจ่ายมัดจำนี้ Post ไป GL แล้ว")
    if doc.status == SalesDocStatus.CANCELLED:
        raise HTTPException(400, "เอกสารนี้ถูกยกเลิกแล้ว")
    book = require_book(doc.book)
    amount = doc.deposit_amount if doc.deposit_amount > 0 else doc.total
    if amount <= 0:
        raise HTTPException(400, "ยอดมัดจำต้องมากกว่า 0")

    dep_acc  = _find_acc(db, ["1403", "1402"])
    bank_acc = _find_acc(db, ["1102", "1101", "11"])
    if not bank_acc or not dep_acc:
        raise HTTPException(400, "ไม่พบบัญชีเงินสด/ธนาคาร หรือบัญชีเงินมัดจำจ่ายล่วงหน้าในผังบัญชี")

    zero = Decimal("0")
    journal = _create_posted_journal(db, doc.date, f"จ่ายเงินมัดจำ {doc.number} — {doc.supplier.name}", doc.number, [
        {"account_id": dep_acc.id,  "debit": amount, "credit": zero, "description": f"เงินมัดจำจ่ายล่วงหน้า {doc.number}"},
        {"account_id": bank_acc.id, "debit": zero, "credit": amount, "description": f"จ่ายเงินมัดจำ {doc.number}"},
    ], user_id, book.journal_type)

    doc.gl_posted = True
    doc.gl_journal_id = journal.id
    doc.status = SalesDocStatus.ACCEPTED
    db.commit(); db.refresh(doc)
    return doc


# ── Credit / Debit notes ───────────────────────────────────────
def _posted_bill_for(db: Session, bill_id: Optional[UUID], supplier_id: UUID) -> Bill:
    if not bill_id:
        raise HTTPException(400, "ใบลดหนี้/ใบเพิ่มหนี้ต้องอ้างอิงใบแจ้งหนี้ (บิล)")
    bill = db.query(Bill).filter(Bill.id == bill_id, Bill.is_deleted == False).first()
    if not bill:
        raise HTTPException(404, "ไม่พบบิลที่อ้างอิง")
    if not bill.gl_posted or bill.status in _CLOSED_BILL:
        raise HTTPException(400, "บิลที่อ้างอิงต้อง Post GL แล้ว และไม่ถูกยกเลิก/ปฏิเสธ")
    if bill.supplier_id != supplier_id:
        raise HTTPException(400, "ผู้จำหน่ายไม่ตรงกับบิลที่อ้างอิง")
    return bill


def post_note_to_gl(db: Session, doc_id: UUID, user_id: Optional[UUID] = None) -> PurchaseDocument:
    """Record a supplier's note against its bill.
    Credit note: Dr เจ้าหนี้ / Cr ค่าใช้จ่าย + VAT ซื้อ — lowers what we owe.
    Debit note:  Dr ค่าใช้จ่าย + VAT ซื้อ / Cr เจ้าหนี้ — raises it."""
    doc = get_purchase_document(db, doc_id)
    if doc.doc_type not in NOTE_TYPES:
        raise HTTPException(400, "เอกสารนี้ไม่ใช่ใบลดหนี้/ใบเพิ่มหนี้")
    if doc.gl_posted:
        raise HTTPException(400, "เอกสารนี้ Post ไป GL แล้ว")
    if doc.status == SalesDocStatus.CANCELLED:
        raise HTTPException(400, "เอกสารนี้ถูกยกเลิกแล้ว")
    book = require_book(doc.book)
    bill = _posted_bill_for(db, doc.bill_id, doc.supplier_id)
    is_credit = doc.doc_type == PurchaseDocType.CREDIT_NOTE
    if is_credit and doc.total > bill.balance_due:
        raise HTTPException(400, f"ยอดลดหนี้เกินยอดค้างจ่ายของ {bill.number} ({bill.balance_due})")

    # The note's book decides the accounts (normally the bill's own book, pre-selected in the form).
    ap_acc, exp_acc, vat_acc, journal_type = bill_posting_accounts(db, bill, book)
    zero = Decimal("0")
    label = "ลดหนี้" if is_credit else "เพิ่มหนี้"
    # Debit-note signs (expense debit, AP credit); a credit note flips every line.
    lines = [(exp_acc, doc.subtotal, f"ค่าใช้จ่าย {label} {doc.number}")]
    if vat_acc and doc.vat_amount > 0:
        lines.append((vat_acc, doc.vat_amount, f"VAT ซื้อ {label} {doc.number}"))
    lines.append((ap_acc, -doc.total, f"{label} {doc.number} อ้างอิง {bill.number}"))
    sign = -1 if is_credit else 1
    entries = []
    for acc, amount, desc in lines:
        amount = amount * sign
        entries.append({"account_id": acc.id, "debit": amount if amount > 0 else zero,
                        "credit": -amount if amount < 0 else zero, "description": desc})

    journal = _create_posted_journal(
        db, doc.date, f"{label} {doc.number} — {doc.supplier.name}", doc.number,
        entries, user_id, journal_type,
    )

    if is_credit:
        bill.balance_due -= doc.total
    else:
        bill.balance_due += doc.total
    # Only bills already in the payment stage move between paid/partial; drafts and
    # approved bills keep their workflow status.
    if bill.status in (BillStatus.PAID, BillStatus.PARTIAL) or bill.paid_amount > 0:
        bill.status = BillStatus.PAID if bill.balance_due <= 0 else BillStatus.PARTIAL

    doc.gl_posted = True
    doc.gl_journal_id = journal.id
    doc.status = SalesDocStatus.ACCEPTED
    db.commit(); db.refresh(doc)
    return doc


# ── Purchase tax invoices (view over posted bills with VAT) ────
def list_purchase_tax_invoices(db: Session, skip=0, limit=100) -> List[Bill]:
    """Input-VAT documents: posted bills that carry VAT. `ref_number` holds the
    supplier's tax-invoice number."""
    return (db.query(Bill)
              .filter(Bill.gl_posted == True, Bill.is_deleted == False,
                      Bill.vat_amount > 0, Bill.status.notin_(_CLOSED_BILL))
              .order_by(Bill.date.desc()).offset(skip).limit(limit).all())


# ── Payment vouchers (view over AP payments) ───────────────────
def list_payment_vouchers(db: Session, skip=0, limit=100) -> List[dict]:
    payments = (db.query(APPayment)
                  .order_by(APPayment.date.desc(), APPayment.created_at.desc())
                  .offset(skip).limit(limit).all())
    out = []
    for p in payments:
        bill = p.bill
        out.append({
            "id": p.id,
            "voucher_number": f"PV-{p.date.year}{p.date.month:02d}-{str(p.id)[:8].upper()}",
            "bill_id": p.bill_id,
            "bill_number": bill.number if bill else None,
            "supplier_name": bill.supplier.name if bill and bill.supplier else None,
            "date": p.date,
            "amount": p.amount,
            "method": p.method.value if hasattr(p.method, "value") else str(p.method),
            "reference": p.reference,
            "gl_posted": p.gl_posted,
        })
    return out


# ── Expense report ─────────────────────────────────────────────
def expense_report(db: Session, period_from: Optional[date] = None, period_to: Optional[date] = None) -> dict:
    to_d   = period_to or date.today()
    from_d = period_from or to_d.replace(day=1)

    bills = db.query(Bill).filter(
        Bill.is_deleted == False,
        Bill.status.notin_(_CLOSED_BILL),
        Bill.date >= from_d, Bill.date <= to_d,
    ).all()

    zero = Decimal("0")
    by_month = defaultdict(lambda: {"total": zero, "count": 0})
    by_cat   = defaultdict(lambda: {"total": zero, "count": 0})
    by_sup   = defaultdict(lambda: {"total": zero, "count": 0})
    for b in bills:
        for bucket, key in ((by_month, f"{b.date.year}-{b.date.month:02d}"),
                            (by_cat, b.category.name if b.category else "ไม่ระบุหมวด"),
                            (by_sup, b.supplier.name if b.supplier else "ไม่ระบุผู้จำหน่าย")):
            bucket[key]["total"] += b.subtotal
            bucket[key]["count"] += 1

    def ranked(m: dict, label: str, top: int = 10):
        return sorted(({label: k, **v} for k, v in m.items()), key=lambda x: x["total"], reverse=True)[:top]

    return {
        "period_from": str(from_d), "period_to": str(to_d),
        "total_expense": sum((b.subtotal for b in bills), zero),
        "total_vat":     sum((b.vat_amount for b in bills), zero),
        "total_wht":     sum((b.wht_amount for b in bills), zero),
        "bill_count":    len(bills),
        "paid_amount":   sum((b.paid_amount for b in bills), zero),
        "outstanding":   sum((b.balance_due for b in bills if b.gl_posted), zero),
        "by_month":      [{"month": k, **v} for k, v in sorted(by_month.items())],
        "by_category":   ranked(by_cat, "category"),
        "by_supplier":   ranked(by_sup, "supplier"),
    }


# ── AP aging ───────────────────────────────────────────────────
def get_ap_aging(db: Session, as_of: Optional[date] = None) -> dict:
    """Same buckets and shape as the AR aging report, over unpaid posted bills."""
    today = as_of or date.today()
    bills = db.query(Bill).filter(
        Bill.balance_due > 0, Bill.gl_posted == True, Bill.is_deleted == False,
        Bill.status.notin_(_CLOSED_BILL + (BillStatus.PAID,)),
    ).all()

    buckets = {"current": [], "1_30": [], "31_60": [], "61_90": [], "over_90": []}
    for b in bills:
        late = (today - b.due_date).days
        key = ("current" if late <= 0 else "1_30" if late <= 30 else "31_60" if late <= 60
               else "61_90" if late <= 90 else "over_90")
        buckets[key].append(b)

    def summarize(bs):
        return {
            "count": len(bs),
            "total": sum((b.balance_due for b in bs), Decimal("0")),
            "items": [{"number": b.number, "customer": b.supplier.name if b.supplier else "—",
                       "due_date": str(b.due_date), "balance_due": b.balance_due} for b in bs],
        }

    return {"as_of": str(today), **{k: summarize(v) for k, v in buckets.items()},
            "grand_total": sum((b.balance_due for b in bills), Decimal("0"))}
