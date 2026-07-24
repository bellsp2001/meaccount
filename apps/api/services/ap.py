"""
AP Service — Supplier, Bill, Approval Workflow, Payment, Auto-GL posting
"""
from decimal import Decimal
from datetime import date, timedelta
from typing import List, Optional
from uuid import UUID
from sqlalchemy.orm import Session
from sqlalchemy import or_
from fastapi import HTTPException

from models.ap import (Supplier, Bill, BillItem, APPayment,
                       ApprovalRecord, BillStatus, ExpenseCategory)
from models.accounting import Account, Journal, JournalEntry, JournalStatus, NormalBalance
from services.accounting import next_journal_number
from schemas.ap import (SupplierCreate, SupplierUpdate,
                        BillCreate, APPaymentCreate, ApprovalAction)


# ── ExpenseCategory ────────────────────────────────────────────

def get_categories(db: Session) -> List[ExpenseCategory]:
    return db.query(ExpenseCategory).filter(
        ExpenseCategory.is_active == True,
        ExpenseCategory.is_deleted == False,
    ).order_by(ExpenseCategory.code).all()


def seed_default_categories(db: Session):
    """สร้างหมวดหมู่ค่าใช้จ่ายเริ่มต้น"""
    defaults = [
        ("EXP001", "ค่าวัสดุสำนักงาน",        "5401"),
        ("EXP002", "ค่าสาธารณูปโภค",           "5302"),
        ("EXP003", "ค่าเช่า",                  "5301"),
        ("EXP004", "ค่าซ่อมแซมและบำรุงรักษา", "5402"),
        ("EXP005", "ค่าโทรศัพท์/อินเทอร์เน็ต","5304"),
        ("EXP006", "ค่าโฆษณาและการตลาด",       "5405"),
        ("EXP007", "ค่าประกันภัย",             "5404"),
        ("EXP008", "ค่าเดินทาง",               "5401"),
        ("EXP009", "ค่าใช้จ่ายอื่นๆ",          "5401"),
    ]
    for code, name, acc_code in defaults:
        if not db.query(ExpenseCategory).filter(ExpenseCategory.code == code).first():
            acc = db.query(Account).filter(Account.code == acc_code).first()
            cat = ExpenseCategory(code=code, name=name,
                                  account_id=acc.id if acc else None)
            db.add(cat)
    db.commit()


# ── Supplier ───────────────────────────────────────────────────

def get_suppliers(db: Session, search: Optional[str] = None) -> List[Supplier]:
    q = db.query(Supplier).filter(Supplier.is_deleted == False)
    if search:
        q = q.filter(or_(
            Supplier.name.ilike(f"%{search}%"),
            Supplier.code.ilike(f"%{search}%"),
            Supplier.tax_id.ilike(f"%{search}%"),
        ))
    return q.order_by(Supplier.name).all()


def create_supplier(db: Session, payload: SupplierCreate) -> Supplier:
    if db.query(Supplier).filter(Supplier.code == payload.code,
                                  Supplier.is_deleted == False).first():
        raise HTTPException(400, f"รหัสผู้จำหน่าย {payload.code} มีอยู่แล้ว")
    s = Supplier(**payload.model_dump())
    db.add(s); db.commit(); db.refresh(s)
    return s


def update_supplier(db: Session, sid: UUID, payload: SupplierUpdate) -> Supplier:
    s = db.query(Supplier).filter(Supplier.id == sid, Supplier.is_deleted == False).first()
    if not s:
        raise HTTPException(404, "ไม่พบผู้จำหน่าย")
    for k, v in payload.model_dump(exclude_none=True).items():
        setattr(s, k, v)
    db.commit(); db.refresh(s)
    return s


# ── Bill Number ────────────────────────────────────────────────

def next_bill_number(db: Session, bill_date: date) -> str:
    prefix = f"BILL-{bill_date.year}{bill_date.month:02d}-"
    last = db.query(Bill).filter(Bill.number.like(f"{prefix}%")).order_by(Bill.number.desc()).first()
    seq = int(last.number.split("-")[-1]) + 1 if last else 1
    return f"{prefix}{seq:04d}"


# ── Bill CRUD ──────────────────────────────────────────────────

def create_bill(db: Session, payload: BillCreate, user_id: Optional[UUID] = None) -> Bill:
    if payload.supplier_id:
        sup = db.query(Supplier).filter(Supplier.id == payload.supplier_id).first()
        if not sup:
            raise HTTPException(404, "ไม่พบผู้จำหน่าย")
        due = payload.due_date or (payload.date + timedelta(days=sup.payment_terms))
        wht_type = sup.wht_type
    else:
        due = payload.due_date or (payload.date + timedelta(days=30))
        wht_type = None

    subtotal   = sum(it.amount for it in payload.items)
    vat_amount = (subtotal * payload.vat_rate / 100).quantize(Decimal("0.01"))
    total      = subtotal + vat_amount
    wht_amount = (subtotal * payload.wht_rate / 100).quantize(Decimal("0.01"))
    net_payable= total - wht_amount

    bill = Bill(
        number=next_bill_number(db, payload.date),
        supplier_id=payload.supplier_id, category_id=payload.category_id,
        date=payload.date, due_date=due,
        ref_number=payload.ref_number, description=payload.description,
        vat_rate=payload.vat_rate, vat_amount=vat_amount,
        wht_rate=payload.wht_rate, wht_amount=wht_amount,
        subtotal=subtotal, total=total,
        net_payable=net_payable, paid_amount=Decimal("0"), balance_due=net_payable,
        note=payload.note, created_by=user_id,
    )
    db.add(bill); db.flush()

    for i, it in enumerate(payload.items):
        db.add(BillItem(
            bill_id=bill.id, sequence=i,
            description=it.description, quantity=it.quantity,
            unit=it.unit, unit_price=it.unit_price, amount=it.amount,
        ))

    db.commit(); db.refresh(bill)
    return bill


def get_bills(db: Session,
              status: Optional[BillStatus] = None,
              supplier_id: Optional[UUID] = None,
              skip: int = 0, limit: int = 50) -> List[Bill]:
    q = db.query(Bill).filter(Bill.is_deleted == False)
    if status:       q = q.filter(Bill.status == status)
    if supplier_id:  q = q.filter(Bill.supplier_id == supplier_id)
    return q.order_by(Bill.date.desc()).offset(skip).limit(limit).all()


# ── Approval Workflow ──────────────────────────────────────────

def submit_for_approval(db: Session, bill_id: UUID, user_id: Optional[UUID] = None) -> Bill:
    bill = _get_bill_or_404(db, bill_id)
    if bill.status != BillStatus.DRAFT:
        raise HTTPException(400, "เฉพาะ Bill ที่เป็น Draft เท่านั้นที่ส่งขออนุมัติได้")
    bill.status = BillStatus.PENDING
    db.commit(); db.refresh(bill)
    return bill


def process_approval(db: Session, bill_id: UUID,
                     payload: ApprovalAction, user_id: Optional[UUID] = None) -> Bill:
    bill = _get_bill_or_404(db, bill_id)
    if bill.status != BillStatus.PENDING:
        raise HTTPException(400, "Bill นี้ไม่ได้อยู่ในสถานะรอการอนุมัติ")

    record = ApprovalRecord(
        bill_id=bill_id, user_id=user_id,
        action=payload.action, comment=payload.comment,
    )
    db.add(record)

    if payload.action == "approved":
        bill.status     = BillStatus.APPROVED
        bill.approved_by= user_id
    else:
        bill.status = BillStatus.REJECTED

    db.commit(); db.refresh(bill)
    return bill


# ── GL Posting ────────────────────────────────────────────────

def post_bill_to_gl(db: Session, bill_id: UUID, user_id: Optional[UUID] = None) -> Bill:
    """Post Bill → Dr ค่าใช้จ่าย + VAT Input / Cr เจ้าหนี้ / Cr WHT"""
    bill = _get_bill_or_404(db, bill_id)
    if bill.gl_posted:
        raise HTTPException(400, "Bill นี้ Post ไป GL แล้ว")
    if bill.status not in (BillStatus.APPROVED, BillStatus.DRAFT):
        raise HTTPException(400, "Bill ต้องอยู่ในสถานะ Approved หรือ Draft ก่อน Post GL")

    # Find accounts
    ap_acc    = _find_acc(db, ["2101","21"])
    vat_acc   = _find_acc(db, ["1401","14"])      # VAT Input
    wht_acc   = _find_acc(db, ["2104","21"])      # WHT Payable

    # Use category's account or fallback to generic expense
    exp_acc = None
    if bill.category and bill.category.gl_account:
        exp_acc = bill.category.gl_account
    if not exp_acc:
        exp_acc = _find_acc(db, ["5401","5301","5302","51","50"])

    if not ap_acc or not exp_acc:
        raise HTTPException(400, "ไม่พบบัญชีเจ้าหนี้หรือค่าใช้จ่ายในผังบัญชี")

    entries = [
        {"account_id": exp_acc.id, "debit": bill.subtotal, "credit": Decimal("0"),
         "description": f"ค่าใช้จ่าย {bill.number}"},
    ]
    if vat_acc and bill.vat_amount > 0:
        entries.append({"account_id": vat_acc.id, "debit": bill.vat_amount,
                        "credit": Decimal("0"), "description": f"VAT Input {bill.number}"})
    entries.append({"account_id": ap_acc.id, "debit": Decimal("0"),
                    "credit": bill.total, "description": f"เจ้าหนี้ {bill.supplier.name if bill.supplier else ''} {bill.number}"})
    if wht_acc and bill.wht_amount > 0:
        entries.append({"account_id": ap_acc.id, "debit": bill.wht_amount,
                        "credit": Decimal("0"), "description": f"WHT หัก ณ ที่จ่าย {bill.number}"})
        entries.append({"account_id": wht_acc.id, "debit": Decimal("0"),
                        "credit": bill.wht_amount, "description": f"WHT Payable {bill.number}"})

    _create_posted_journal(db, bill.date,
                           f"Bill {bill.number} — {bill.description}",
                           bill.number, entries, user_id)
    bill.gl_posted = True
    db.commit(); db.refresh(bill)
    return bill


# ── Payment ────────────────────────────────────────────────────

def pay_bill(db: Session, payload: APPaymentCreate, user_id: Optional[UUID] = None) -> APPayment:
    bill = _get_bill_or_404(db, payload.bill_id)
    if bill.status not in (BillStatus.APPROVED, BillStatus.PARTIAL):
        raise HTTPException(400, "Bill ต้องอยู่ในสถานะ Approved หรือ Partial ก่อนจ่ายเงิน")
    if payload.amount > bill.balance_due:
        raise HTTPException(400, f"จำนวนเงินเกินยอดค้างชำระ ({bill.balance_due})")

    payment = APPayment(
        bill_id=bill.id, date=payload.date, amount=payload.amount,
        method=payload.method, reference=payload.reference,
        note=payload.note, paid_by=user_id,
    )
    db.add(payment); db.flush()

    bill.paid_amount += payload.amount
    bill.balance_due -= payload.amount
    bill.status = BillStatus.PAID if bill.balance_due <= 0 else BillStatus.PARTIAL

    # Auto GL: Dr เจ้าหนี้ / Cr ธนาคาร
    ap_acc   = _find_acc(db, ["2101","21"])
    bank_acc = _find_acc(db, ["1102","1101","11"])

    if ap_acc and bank_acc:
        entries = [
            {"account_id": ap_acc.id,   "debit": payload.amount, "credit": Decimal("0"),
             "description": f"จ่ายชำระ {bill.number}"},
            {"account_id": bank_acc.id, "debit": Decimal("0"), "credit": payload.amount,
             "description": f"จ่ายเงิน {bill.number}"},
        ]
        j = _create_posted_journal(db, payload.date,
                                   f"จ่ายชำระ {bill.number} — {bill.description}",
                                   payload.reference or bill.number, entries, user_id)
        payment.gl_posted     = True
        payment.gl_journal_id = j.id

    db.commit(); db.refresh(payment)
    return payment


def get_ap_summary(db: Session) -> dict:
    """AP Summary — ยอดค้างจ่ายแยกตามสถานะ"""
    from sqlalchemy import func
    bills = db.query(Bill).filter(
        Bill.balance_due > 0,
        Bill.status.in_([BillStatus.APPROVED, BillStatus.PARTIAL]),
        Bill.is_deleted == False,
    ).all()

    today = date.today()
    overdue = [b for b in bills if b.due_date < today]
    due_soon = [b for b in bills if today <= b.due_date <= today + timedelta(days=7)]

    return {
        "total_payable":    float(sum(b.balance_due for b in bills)),
        "overdue_count":    len(overdue),
        "overdue_amount":   float(sum(b.balance_due for b in overdue)),
        "due_soon_count":   len(due_soon),
        "due_soon_amount":  float(sum(b.balance_due for b in due_soon)),
        "pending_approval": db.query(Bill).filter(Bill.status == BillStatus.PENDING).count(),
    }


# ── Helpers ────────────────────────────────────────────────────

def _get_bill_or_404(db: Session, bill_id: UUID) -> Bill:
    bill = db.query(Bill).filter(Bill.id == bill_id).first()
    if not bill:
        raise HTTPException(404, "ไม่พบ Bill")
    return bill


def _find_acc(db: Session, prefixes: List[str]) -> Optional[Account]:
    for p in prefixes:
        a = db.query(Account).filter(
            Account.code.like(f"{p}%"),
            Account.is_active == True,
            Account.is_deleted == False,
        ).first()
        if a:
            return a
    return None


def _create_posted_journal(db: Session, j_date, description, reference, entries_data, user_id) -> Journal:
    j = Journal(
        number=next_journal_number(db, j_date),
        date=j_date, description=description, reference=reference,
        status=JournalStatus.POSTED, created_by=user_id,
    )
    db.add(j); db.flush()
    for ed in entries_data:
        db.add(JournalEntry(journal_id=j.id, **ed))
        acc = db.query(Account).filter(Account.id == ed["account_id"]).first()
        if acc:
            if acc.normal_balance == NormalBalance.DEBIT:
                acc.balance += ed["debit"] - ed["credit"]
            else:
                acc.balance += ed["credit"] - ed["debit"]
    return j
