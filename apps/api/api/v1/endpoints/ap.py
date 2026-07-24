from fastapi import APIRouter, Depends, Query, UploadFile, File
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID
from datetime import date
import base64

from core.database import get_db
from core.deps import get_current_user, require_accountant_up, require_manager_up
from models.user import User
from models.ap import BillStatus
from schemas.ap import (
    SupplierCreate, SupplierUpdate, SupplierResponse,
    ExpenseCategoryCreate, ExpenseCategoryResponse,
    BillCreate, BillResponse,
    ApprovalAction, APPaymentCreate, APPaymentResponse,
    AICategorizeRequest, AICategorizeResponse,
)
from services.ap import (
    get_suppliers, create_supplier, update_supplier,
    get_categories, seed_default_categories,
    create_bill, get_bills, submit_for_approval,
    process_approval, post_bill_to_gl, pay_bill, get_ap_summary,
)
from services.ai_ap import categorize_expense, ocr_receipt

router = APIRouter(prefix="/ap", tags=["Accounts Payable"])


# ── Categories ─────────────────────────────────────────────────
@router.get("/categories", response_model=List[ExpenseCategoryResponse])
def list_categories(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_categories(db)


@router.post("/categories/seed")
def seed_categories(current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    seed_default_categories(db)
    return {"message": "สร้างหมวดหมู่ค่าใช้จ่ายเริ่มต้นเรียบร้อย"}


# ── Supplier ───────────────────────────────────────────────────
@router.get("/suppliers", response_model=List[SupplierResponse])
def list_suppliers(search: Optional[str] = None,
                   current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_suppliers(db, search)


@router.post("/suppliers", response_model=SupplierResponse)
def create_supplier_endpoint(payload: SupplierCreate,
                             current_user: User = Depends(require_accountant_up),
                             db: Session = Depends(get_db)):
    return create_supplier(db, payload)


@router.get("/suppliers/{sid}", response_model=SupplierResponse)
def get_supplier(sid: UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from models.ap import Supplier
    from fastapi import HTTPException
    s = db.query(Supplier).filter(Supplier.id == sid, Supplier.is_deleted == False).first()
    if not s: raise HTTPException(404, "ไม่พบผู้จำหน่าย")
    return s


@router.patch("/suppliers/{sid}", response_model=SupplierResponse)
def update_supplier_endpoint(sid: UUID, payload: SupplierUpdate,
                             current_user: User = Depends(require_accountant_up),
                             db: Session = Depends(get_db)):
    return update_supplier(db, sid, payload)


# ── Bill ───────────────────────────────────────────────────────
@router.get("/bills", response_model=List[BillResponse])
def list_bills(status: Optional[BillStatus] = None,
               supplier_id: Optional[UUID] = None,
               skip: int = 0, limit: int = 50,
               current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_bills(db, status, supplier_id, skip, limit)


@router.post("/bills", response_model=BillResponse)
def create_bill_endpoint(payload: BillCreate,
                         current_user: User = Depends(require_accountant_up),
                         db: Session = Depends(get_db)):
    return create_bill(db, payload, user_id=current_user.id)


@router.get("/bills/{bid}", response_model=BillResponse)
def get_bill(bid: UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from models.ap import Bill
    from fastapi import HTTPException
    b = db.query(Bill).filter(Bill.id == bid).first()
    if not b: raise HTTPException(404, "ไม่พบ Bill")
    return b


@router.post("/bills/{bid}/submit", response_model=BillResponse)
def submit_bill(bid: UUID, current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return submit_for_approval(db, bid, current_user.id)


@router.post("/bills/{bid}/approve", response_model=BillResponse)
def approve_bill(bid: UUID, payload: ApprovalAction,
                 current_user: User = Depends(require_manager_up), db: Session = Depends(get_db)):
    return process_approval(db, bid, payload, current_user.id)


@router.post("/bills/{bid}/post-gl", response_model=BillResponse)
def post_bill(bid: UUID, current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return post_bill_to_gl(db, bid, current_user.id)


@router.post("/bills/{bid}/cancel")
def cancel_bill(bid: UUID, current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    from models.ap import Bill, BillStatus
    from fastapi import HTTPException
    b = db.query(Bill).filter(Bill.id == bid).first()
    if not b: raise HTTPException(404, "ไม่พบ Bill")
    if b.status == BillStatus.PAID: raise HTTPException(400, "ไม่สามารถยกเลิก Bill ที่จ่ายแล้ว")
    b.status = BillStatus.CANCELLED
    db.commit()
    return {"message": "ยกเลิก Bill เรียบร้อย"}


# ── Payment ────────────────────────────────────────────────────
@router.post("/payments", response_model=APPaymentResponse)
def create_payment(payload: APPaymentCreate,
                   current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return pay_bill(db, payload, current_user.id)


@router.get("/payments")
def list_payments(bill_id: Optional[UUID] = None,
                  current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    from models.ap import APPayment
    q = db.query(APPayment)
    if bill_id: q = q.filter(APPayment.bill_id == bill_id)
    return q.order_by(APPayment.date.desc()).limit(100).all()


# ── Summary ────────────────────────────────────────────────────
@router.get("/summary")
def ap_summary(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_ap_summary(db)


# ── AI ─────────────────────────────────────────────────────────
@router.post("/ai/categorize", response_model=AICategorizeResponse)
def ai_categorize(payload: AICategorizeRequest,
                  current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return categorize_expense(db, payload.description, payload.amount)


@router.post("/ai/ocr-receipt")
async def ai_ocr_receipt(file: UploadFile = File(...),
                         current_user: User = Depends(require_accountant_up)):
    content = await file.read()
    b64 = base64.b64encode(content).decode()
    return ocr_receipt(b64, file.content_type or "image/jpeg")
