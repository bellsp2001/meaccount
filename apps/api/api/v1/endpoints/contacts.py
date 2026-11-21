from fastapi import APIRouter, Depends, Query
from sqlalchemy.orm import Session
from typing import List, Literal, Optional
from uuid import UUID

from core.database import get_db
from core.deps import get_current_user, require_accountant_up
from models.user import User
from schemas.contact import (
    ContactCreate, ContactUpdate, ContactResponse, DuplicateCheck,
    ContactGroupCreate, ContactGroupUpdate, ContactGroupResponse,
)
from services.contacts import (
    list_contacts, get_contact, contact_response, create_contact, update_contact, find_contact,
    list_groups, get_group, group_response, create_group, update_group, delete_group,
)

router = APIRouter(prefix="/contacts", tags=["Contacts"])
groups_router = APIRouter(prefix="/contact-groups", tags=["Contacts"])


@router.get("/", response_model=List[ContactResponse])
def list_ep(role: Optional[Literal["customer", "supplier"]] = None,
            search: Optional[str] = None, include_inactive: bool = False, group_id: Optional[UUID] = None,
            current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return list_contacts(db, role, search, include_inactive, group_id)


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


# ── Customer type groups ───────────────────────────────────────
@groups_router.get("/", response_model=List[ContactGroupResponse])
def list_groups_ep(include_inactive: bool = True,
                   current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return list_groups(db, include_inactive)


@groups_router.post("/", response_model=ContactGroupResponse)
def create_group_ep(payload: ContactGroupCreate,
                    current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return group_response(db, create_group(db, payload))


@groups_router.patch("/{group_id}", response_model=ContactGroupResponse)
def update_group_ep(group_id: UUID, payload: ContactGroupUpdate,
                    current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return group_response(db, update_group(db, group_id, payload))


@groups_router.delete("/{group_id}")
def delete_group_ep(group_id: UUID,
                    current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    delete_group(db, group_id)
    return {"ok": True}
