from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import List, Literal, Optional
from uuid import UUID

from core.database import get_db
from core.deps import get_current_user, require_accountant_up
from models.user import User
from schemas.contact import ContactCreate, ContactUpdate, ContactResponse, DuplicateCheck
from services.contacts import (
    list_contacts, get_contact, contact_response, create_contact, update_contact, find_contact,
)

router = APIRouter(prefix="/contacts", tags=["Contacts"])


@router.get("/", response_model=List[ContactResponse])
def list_ep(role: Optional[Literal["customer", "supplier"]] = None,
            search: Optional[str] = None, include_inactive: bool = False,
            current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return list_contacts(db, role, search, include_inactive)


@router.get("/check-duplicate", response_model=DuplicateCheck)
def check_duplicate_ep(tax_id: str = Query(...), branch_code: Optional[str] = None,
                       exclude_id: Optional[UUID] = None,
                       current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    dup = find_contact(db, tax_id, branch_code, exclude_id=exclude_id) if tax_id.strip() else None
    return {"duplicate": dup is not None, "contact": contact_response(db, dup) if dup else None}


@router.get("/{contact_id}", response_model=ContactResponse)
def get_ep(contact_id: UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return contact_response(db, get_contact(db, contact_id))


@router.post("/", response_model=ContactResponse)
def create_ep(payload: ContactCreate,
              current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return contact_response(db, create_contact(db, payload))


@router.patch("/{contact_id}", response_model=ContactResponse)
def update_ep(contact_id: UUID, payload: ContactUpdate,
              current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return contact_response(db, update_contact(db, contact_id, payload))
