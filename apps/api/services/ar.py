"""
AR Service — Customer, Invoice, Payment, Auto-GL posting
"""
from decimal import Decimal
from datetime import date, timedelta
from typing import List, Optional
from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy import func, and_, or_
from fastapi import HTTPException

from models.ar import Customer, Invoice, InvoiceItem, Payment, InvoiceStatus, PaymentMethod
from models.accounting import Account, BookSide, Journal, JournalEntry, JournalStatus, JournalType, NormalBalance
from services.accounting import next_journal_number
from services.document_books import resolve_book, require_book
from services.vat import document_totals
from services.contacts import link_role, sync_from_role
from schemas.ar import CustomerCreate, CustomerUpdate, InvoiceCreate, PaymentCreate


# ── Customer ───────────────────────────────────────────────────

def get_customers(db: Session, search: Optional[str] = None, skip=0, limit=50) -> List[Customer]:
    # Inactive = the contact's customer role was removed; keep it out of document pickers.
    q = db.query(Customer).filter(Customer.is_deleted == False, Customer.is_active == True)
    if search:
        q = q.filter(or_(
            Customer.name.ilike(f"%{search}%"),
            Customer.code.ilike(f"%{search}%"),
            Customer.tax_id.ilike(f"%{search}%"),
        ))
    return q.order_by(Customer.name).offset(skip).limit(limit).all()


def create_customer(db: Session, payload: CustomerCreate) -> Customer:
    if db.query(Customer).filter(Customer.code == payload.code, Customer.is_deleted == False).first():
        raise HTTPException(400, f"รหัสลูกค้า {payload.code} มีอยู่แล้ว")
    c = Customer(**payload.model_dump())
    db.add(c); db.flush()
    link_role(db, c)
    db.commit(); db.refresh(c)
    return c


def update_customer(db: Session, cid: UUID, payload: CustomerUpdate) -> Customer:
    c = db.query(Customer).filter(Customer.id == cid, Customer.is_deleted == False).first()
    if not c:
        raise HTTPException(404, "ไม่พบลูกค้า")
    for k, v in payload.model_dump(exclude_none=True).items():
        setattr(c, k, v)
    sync_from_role(db, c)
    db.commit(); db.refresh(c)
    return c


# ── Invoice Number ─────────────────────────────────────────────

def next_invoice_number(db: Session, inv_date: date) -> str:
    prefix = f"INV-{inv_date.year}{inv_date.month:02d}-"
    last = db.query(Invoice).filter(Invoice.number.like(f"{prefix}%")).order_by(Invoice.number.desc()).first()
    seq = int(last.number.split("-")[-1]) + 1 if last else 1
    return f"{prefix}{seq:04d}"


# ── Invoice ────────────────────────────────────────────────────

def _invoice_item_fields(it) -> dict:
    return dict(description=it.description, quantity=it.quantity, unit=it.unit, unit_price=it.unit_price,
                discount_pct=it.discount_pct, amount=it.amount, tax_code_id=it.tax_code_id, vat_rate=it.vat_rate, product_id=it.product_id, detail=it.detail)


def create_invoice(db: Session, payload: InvoiceCreate, user_id: Optional[UUID] = None) -> Invoice:
    customer = db.query(Customer).filter(Customer.id == payload.customer_id).first()
    if not customer:
        raise HTTPException(404, "ไม่พบลูกค้า")

    due = payload.due_date or (payload.date + timedelta(days=customer.credit_days))
    resolve_book(db, payload.book_id, BookSide.INCOME)
    number = next_invoice_number(db, payload.date)

    # Calc totals — VAT per line (each line's ประเภทภาษี), inclusive or exclusive; see services.vat
    subtotal, vat_amount, total, vat_rate = document_totals(db, payload.items, payload.vat_rate, payload.vat_inclusive)

    inv = Invoice(
        number=number, customer_id=payload.customer_id,
        date=payload.date, due_date=due, vat_inclusive=payload.vat_inclusive,
        vat_rate=vat_rate, subtotal=subtotal,
        vat_amount=vat_amount, total=total,
        paid_amount=Decimal("0"), balance_due=total,
        note=payload.note, created_by=user_id, book_id=payload.book_id,
    )
    db.add(inv); db.flush()

    for i, it in enumerate(payload.items):
        db.add(InvoiceItem(invoice_id=inv.id, sequence=i, **_invoice_item_fields(it)))

    db.commit(); db.refresh(inv)
    return inv


def update_invoice(db: Session, invoice_id: UUID, payload: InvoiceCreate) -> Invoice:
    """Rewrite an invoice's header and items while it is not posted to GL and has no
    payment. The number stays."""
    inv = db.query(Invoice).filter(Invoice.id == invoice_id, Invoice.is_deleted == False).first()
    if not inv:
        raise HTTPException(404, "ไม่พบใบแจ้งหนี้")
    if inv.gl_posted or inv.paid_amount or inv.status == InvoiceStatus.CANCELLED:
        raise HTTPException(400, "แก้ไขได้เฉพาะใบแจ้งหนี้ที่ยังไม่ Post GL และยังไม่รับชำระ")
    customer = db.query(Customer).filter(Customer.id == payload.customer_id).first()
    if not customer:
        raise HTTPException(404, "ไม่พบลูกค้า")
    resolve_book(db, payload.book_id, BookSide.INCOME)

    subtotal, vat_amount, total, vat_rate = document_totals(db, payload.items, payload.vat_rate, payload.vat_inclusive)
    inv.customer_id, inv.date, inv.book_id, inv.note = payload.customer_id, payload.date, payload.book_id, payload.note
    inv.due_date = payload.due_date or (payload.date + timedelta(days=customer.credit_days))
    inv.vat_rate, inv.vat_inclusive, inv.subtotal, inv.vat_amount = vat_rate, payload.vat_inclusive, subtotal, vat_amount
    inv.total = inv.balance_due = total
    inv.items = [InvoiceItem(sequence=i, **_invoice_item_fields(it)) for i, it in enumerate(payload.items)]
    db.commit(); db.refresh(inv)
    return inv


def post_invoice_to_gl(db: Session, invoice_id: UUID, user_id: Optional[UUID] = None) -> Invoice:
    """Post Invoice → Dr ลูกหนี้ / Cr รายได้ + VAT Output"""
    inv = db.query(Invoice).filter(Invoice.id == invoice_id).first()
    if not inv:
        raise HTTPException(404, "ไม่พบ Invoice")
    if inv.gl_posted:
        raise HTTPException(400, "Invoice นี้ Post ไป GL แล้ว")

    # Confirming (posting) needs a สมุดบันทึก: its income account, its counter account
    # (ลูกหนี้ or เงินสด) and its journal. Anything it leaves blank falls back to the defaults.
    book = require_book(inv.book)
    ar_acc   = book.counter_account or _find_account(db, ["1201","1200","12"])
    rev_acc  = book.account or _find_account(db, ["4101","4100","41"])
    vat_acc  = _find_account(db, ["2103","21"])
    journal_type = book.journal_type

    if not ar_acc or not rev_acc:
        raise HTTPException(400, "ไม่พบบัญชีลูกหนี้หรือรายได้ในผังบัญชี — กรุณาเพิ่มบัญชีก่อน")

    entries_data = [
        {"account_id": ar_acc.id,  "debit": inv.total, "credit": Decimal("0"), "description": f"ลูกหนี้ {inv.customer.name} {inv.number}"},
        {"account_id": rev_acc.id, "debit": Decimal("0"), "credit": inv.subtotal, "description": f"รายได้ {inv.number}"},
    ]
    if vat_acc and inv.vat_amount > 0:
        entries_data.append({"account_id": vat_acc.id, "debit": Decimal("0"), "credit": inv.vat_amount, "description": f"VAT Output {inv.number}"})

    journal = Journal(
        number=next_journal_number(db, inv.date),
        date=inv.date,
        description=f"Invoice {inv.number} — {inv.customer.name}",
        reference=inv.number,
        journal_type=journal_type,
        status=JournalStatus.POSTED,
        created_by=user_id,
    )
    db.add(journal); db.flush()

    for ed in entries_data:
        entry = JournalEntry(journal_id=journal.id, **ed)
        db.add(entry)
        acc = db.query(Account).filter(Account.id == ed["account_id"]).first()
        if acc:
            if acc.normal_balance == NormalBalance.DEBIT:
                acc.balance += ed["debit"] - ed["credit"]
            else:
                acc.balance += ed["credit"] - ed["debit"]

    journal.status = JournalStatus.POSTED
    inv.gl_posted = True
    inv.status = InvoiceStatus.SENT
    db.commit(); db.refresh(inv)
    return inv


def receive_payment(db: Session, payload: PaymentCreate, user_id: Optional[UUID] = None) -> Payment:
    """รับชำระเงิน → อัปเดตยอด Invoice + Post GL"""
    inv = db.query(Invoice).filter(Invoice.id == payload.invoice_id).first()
    if not inv:
        raise HTTPException(404, "ไม่พบ Invoice")
    if inv.status == InvoiceStatus.CANCELLED:
        raise HTTPException(400, "Invoice นี้ถูกยกเลิกแล้ว")
    if payload.amount > inv.balance_due:
        raise HTTPException(400, f"จำนวนเงินเกินยอดค้างชำระ ({inv.balance_due})")

    payment = Payment(
        invoice_id=inv.id, date=payload.date,
        amount=payload.amount, method=payload.method,
        reference=payload.reference, note=payload.note,
        received_by=user_id,
    )
    db.add(payment); db.flush()

    # Update invoice balance
    inv.paid_amount += payload.amount
    inv.balance_due -= payload.amount
    inv.status = InvoiceStatus.PAID if inv.balance_due <= 0 else InvoiceStatus.PARTIAL

    # Auto-post GL: Dr ธนาคาร/เงินสด / Cr ลูกหนี้
    bank_acc = _find_account(db, ["1102","1101","11"])
    ar_acc   = _find_account(db, ["1201","1200","12"])

    if bank_acc and ar_acc:
        journal = Journal(
            number=next_journal_number(db, payload.date),
            date=payload.date,
            description=f"รับชำระ {inv.number} — {inv.customer.name}",
            reference=payment.reference or inv.number,
            journal_type=JournalType.RECEIPT,
            status=JournalStatus.POSTED,
            created_by=user_id,
        )
        db.add(journal); db.flush()

        for ed in [
            {"account_id": bank_acc.id, "debit": payload.amount, "credit": Decimal("0"), "description": f"รับเงิน {inv.number}"},
            {"account_id": ar_acc.id,   "debit": Decimal("0"), "credit": payload.amount, "description": f"ลบหนี้ {inv.number}"},
        ]:
            db.add(JournalEntry(journal_id=journal.id, **ed))
            acc = db.query(Account).filter(Account.id == ed["account_id"]).first()
            if acc:
                if acc.normal_balance == NormalBalance.DEBIT:
                    acc.balance += ed["debit"] - ed["credit"]
                else:
                    acc.balance += ed["credit"] - ed["debit"]

        payment.gl_posted = True
        payment.gl_journal_id = journal.id

    db.commit(); db.refresh(payment)
    return payment


def get_aging_report(db: Session, as_of: Optional[date] = None) -> dict:
    """Aging Report — จัดกลุ่มตามอายุหนี้"""
    today = as_of or date.today()
    invoices = db.query(Invoice).filter(
        Invoice.balance_due > 0,
        Invoice.status.in_([InvoiceStatus.SENT, InvoiceStatus.PARTIAL, InvoiceStatus.OVERDUE]),
        Invoice.is_deleted == False,
    ).all()

    buckets = {"current": [], "1_30": [], "31_60": [], "61_90": [], "over_90": []}
    for inv in invoices:
        days_overdue = (today - inv.due_date).days
        if days_overdue <= 0:
            buckets["current"].append(inv)
        elif days_overdue <= 30:
            buckets["1_30"].append(inv)
        elif days_overdue <= 60:
            buckets["31_60"].append(inv)
        elif days_overdue <= 90:
            buckets["61_90"].append(inv)
        else:
            buckets["over_90"].append(inv)

    def summarize(invs):
        return {
            "count":  len(invs),
            "total":  sum(i.balance_due for i in invs),
            "items":  [{"number": i.number, "customer": i.customer.name, "due_date": str(i.due_date), "balance_due": i.balance_due} for i in invs],
        }

    return {
        "as_of":    str(today),
        "current":  summarize(buckets["current"]),
        "1_30":     summarize(buckets["1_30"]),
        "31_60":    summarize(buckets["31_60"]),
        "61_90":    summarize(buckets["61_90"]),
        "over_90":  summarize(buckets["over_90"]),
        "grand_total": sum(i.balance_due for i in invoices),
    }


def _find_account(db: Session, code_prefixes: List[str]) -> Optional[Account]:
    for prefix in code_prefixes:
        acc = db.query(Account).filter(
            Account.code.like(f"{prefix}%"),
            Account.is_active == True,
            Account.is_deleted == False,
        ).first()
        if acc:
            return acc
    return None
