"""
Document Books (สมุดบันทึก) — setup for each kind of income/expense document: which journal it
posts to and which chart-of-accounts lines it uses.
"""
from typing import List, Optional
from uuid import UUID
from sqlalchemy.orm import Session, joinedload
from fastapi import HTTPException

from models.accounting import Account, AccountTypeEnum, BookSide, DocumentBook
from models.tax import TaxCode
from schemas.accounting import DocumentBookCreate, DocumentBookUpdate

# The account a book posts its amount to must match the book's side. Expense books may also hit an
# asset (e.g. buying stock or equipment goes to สินค้าคงเหลือ / สินทรัพย์ rather than an expense).
MAIN_ACCOUNT_TYPES = {
    BookSide.INCOME:  {AccountTypeEnum.INCOME},
    BookSide.EXPENSE: {AccountTypeEnum.EXPENSE, AccountTypeEnum.ASSET},
}
# The other side is always a balance-sheet account: ลูกหนี้, เจ้าหนี้, เงินสด/ธนาคาร.
COUNTER_ACCOUNT_TYPES = {AccountTypeEnum.ASSET, AccountTypeEnum.LIABILITY}


def _active_account(db: Session, account_id: UUID, label: str) -> Account:
    acc = db.query(Account).filter(Account.id == account_id, Account.is_deleted == False).first()
    if not acc:
        raise HTTPException(404, f"ไม่พบ{label}ในผังบัญชี")
    if not acc.is_active:
        raise HTTPException(400, f"{label} {acc.code} ถูกปิดใช้งานอยู่")
    return acc


def _check_main_account(db: Session, side: BookSide, account_id: UUID) -> None:
    acc = _active_account(db, account_id, "บัญชีรายได้" if side == BookSide.INCOME else "บัญชีค่าใช้จ่าย")
    if acc.account_type not in MAIN_ACCOUNT_TYPES[side]:
        want = "รายได้" if side == BookSide.INCOME else "ค่าใช้จ่ายหรือสินทรัพย์"
        raise HTTPException(400, f"บัญชี {acc.code} {acc.name} ไม่ใช่บัญชีประเภท{want}")


def _check_counter_account(db: Session, account_id: UUID) -> None:
    acc = _active_account(db, account_id, "บัญชีคู่")
    if acc.account_type not in COUNTER_ACCOUNT_TYPES:
        raise HTTPException(400, f"บัญชีคู่ {acc.code} {acc.name} ต้องเป็นบัญชีสินทรัพย์หรือหนี้สิน")


def _check_tax_code(db: Session, tax_code_id: UUID) -> None:
    tc = db.query(TaxCode).filter(TaxCode.id == tax_code_id, TaxCode.is_deleted == False).first()
    if not tc:
        raise HTTPException(404, "ไม่พบประเภทภาษี")
    if not tc.is_active:
        raise HTTPException(400, f"ประเภทภาษี {tc.code} ถูกปิดใช้งานอยู่")


def _check_code_free(db: Session, code: str, exclude_id: Optional[UUID] = None) -> None:
    q = db.query(DocumentBook).filter(DocumentBook.code == code)
    if exclude_id:
        q = q.filter(DocumentBook.id != exclude_id)
    if q.first():
        raise HTTPException(400, f"รหัสสมุด {code} มีอยู่แล้ว")


def _get_or_404(db: Session, book_id: UUID) -> DocumentBook:
    book = db.query(DocumentBook).filter(DocumentBook.id == book_id).first()
    if not book:
        raise HTTPException(404, "ไม่พบสมุดบันทึก")
    return book


def resolve_book(db: Session, book_id: Optional[UUID], side: BookSide) -> Optional[DocumentBook]:
    """The book a new invoice/bill will post through — must exist, be active and be on that side."""
    if not book_id:
        return None
    book = db.query(DocumentBook).filter(DocumentBook.id == book_id).first()
    if not book:
        raise HTTPException(404, "ไม่พบสมุดบันทึก")
    if book.side != side:
        want = "รายได้" if side == BookSide.INCOME else "ค่าใช้จ่าย"
        raise HTTPException(400, f"สมุด {book.code} ไม่ใช่สมุดบันทึก{want}")
    if not book.is_active:
        raise HTTPException(400, f"สมุด {book.code} ถูกปิดใช้งานอยู่")
    return book


def require_book(book: Optional[DocumentBook]) -> DocumentBook:
    """Confirming a document that posts to GL needs its สมุดบันทึก — the book decides the
    accounts and the journal. Quotations and orders don't post, so they don't need one."""
    if book is None:
        raise HTTPException(400, "เลือกสมุดบันทึกก่อนยืนยันเอกสาร")
    if not book.is_active:
        raise HTTPException(400, f"สมุด {book.code} ถูกปิดใช้งานอยู่ — เลือกสมุดอื่นก่อนยืนยันเอกสาร")
    return book


def get_document_books(db: Session, side: Optional[BookSide] = None) -> List[DocumentBook]:
    q = db.query(DocumentBook).options(
        joinedload(DocumentBook.account), joinedload(DocumentBook.counter_account), joinedload(DocumentBook.tax_code),
    )
    if side:
        q = q.filter(DocumentBook.side == side)
    return q.order_by(DocumentBook.side, DocumentBook.code).all()


def create_document_book(db: Session, payload: DocumentBookCreate) -> DocumentBook:
    _check_code_free(db, payload.code)
    _check_main_account(db, payload.side, payload.account_id)
    if payload.counter_account_id:
        _check_counter_account(db, payload.counter_account_id)
    if payload.tax_code_id:
        _check_tax_code(db, payload.tax_code_id)
    book = DocumentBook(**payload.model_dump())
    db.add(book); db.commit(); db.refresh(book)
    return book


def update_document_book(db: Session, book_id: UUID, payload: DocumentBookUpdate) -> DocumentBook:
    book = _get_or_404(db, book_id)
    data = payload.model_dump(exclude_none=True, exclude={"clear_counter_account", "clear_tax_code"})

    if "code" in data:
        if not data["code"]:
            raise HTTPException(400, "ระบุรหัสสมุด")
        _check_code_free(db, data["code"], exclude_id=book.id)
    if "name" in data:
        data["name"] = data["name"].strip()
        if len(data["name"]) < 2:
            raise HTTPException(400, "ชื่อสมุดต้องมีอย่างน้อย 2 ตัวอักษร")
    if "account_id" in data:
        _check_main_account(db, book.side, data["account_id"])
    if "counter_account_id" in data:
        _check_counter_account(db, data["counter_account_id"])
    if "tax_code_id" in data:
        _check_tax_code(db, data["tax_code_id"])

    for k, v in data.items():
        setattr(book, k, v)
    if payload.clear_counter_account:
        book.counter_account_id = None
    if payload.clear_tax_code:
        book.tax_code_id = None
    db.commit(); db.refresh(book)
    return book


def delete_document_book(db: Session, book_id: UUID) -> None:
    # Hard delete while unused; once invoices/bills point at the book it can only be deactivated,
    # so those documents keep posting through the accounts they were created with.
    from models.ar import Invoice
    from models.ap import Bill
    book = _get_or_404(db, book_id)
    used = (db.query(Invoice).filter(Invoice.book_id == book.id).count()
            + db.query(Bill).filter(Bill.book_id == book.id).count())
    if used:
        raise HTTPException(400, f"สมุด {book.code} ถูกใช้กับเอกสาร {used} ฉบับแล้ว ลบไม่ได้ — ให้ปิดใช้งานแทน")
    db.delete(book)
    db.commit()
