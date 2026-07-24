from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID

from core.database import get_db
from core.deps import get_current_user, require_accountant_up
from models.user import User
from schemas.accounting import AccountCreate, AccountUpdate, AccountResponse
from services.accounting import (
    get_accounts, get_account_tree, create_account,
    update_account, delete_account,
)

router = APIRouter(prefix="/accounts", tags=["Chart of Accounts"])


@router.get("/", response_model=List[AccountResponse])
def list_accounts(
    tree: bool = Query(False, description="แสดงเป็น Tree structure"),
    include_inactive: bool = False,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    if tree:
        return get_account_tree(db)
    return get_accounts(db, include_inactive=include_inactive)


@router.post("/", response_model=AccountResponse)
def create_account_endpoint(
    payload: AccountCreate,
    current_user: User = Depends(require_accountant_up),
    db: Session = Depends(get_db),
):
    return create_account(db, payload)


@router.get("/{account_id}", response_model=AccountResponse)
def get_account(
    account_id: UUID,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    from models.accounting import Account
    from fastapi import HTTPException
    acc = db.query(Account).filter(Account.id == account_id, Account.is_deleted == False).first()
    if not acc:
        raise HTTPException(404, "ไม่พบบัญชี")
    return acc


@router.patch("/{account_id}", response_model=AccountResponse)
def update_account_endpoint(
    account_id: UUID,
    payload: AccountUpdate,
    current_user: User = Depends(require_accountant_up),
    db: Session = Depends(get_db),
):
    return update_account(db, account_id, payload)


@router.delete("/{account_id}")
def delete_account_endpoint(
    account_id: UUID,
    current_user: User = Depends(require_accountant_up),
    db: Session = Depends(get_db),
):
    delete_account(db, account_id)
    return {"message": "ลบบัญชีเรียบร้อย"}
