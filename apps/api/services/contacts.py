"""
Contacts Service — the shared partner record behind customers and suppliers.

Rules:
  * One contact per tax ID + branch. A customer and a supplier with the same tax ID and
    branch are the same partner; without a tax ID they match on the exact name.
  * The contact owns the shared fields; its role rows hold copies (see models.contact),
    rewritten from the contact whenever either side changes.
  * Removing a role deactivates the role row instead of deleting it, so documents that
    point at it stay intact. Adding the role back reactivates the same row.
  * A contact may belong to one customer type group. A group still holding contacts
    can't be deleted, only deactivated.
"""
import re
from decimal import Decimal
from typing import List, Optional, Union
from uuid import UUID
from sqlalchemy import func
from sqlalchemy.orm import Session
from fastapi import HTTPException

from models.contact import Contact, ContactGroup, SHARED_FIELDS
from models.ar import Customer, Invoice, InvoiceStatus
from models.ap import Supplier, Bill, BillStatus
from schemas.contact import (
    ContactCreate, ContactUpdate, CustomerRoleIn, SupplierRoleIn, ContactGroupCreate, ContactGroupUpdate,
)

Role = Union[Customer, Supplier]
DEFAULT_BRANCH = "00000"


# ── Codes ──────────────────────────────────────────────────────
def _next_code(db: Session, model, prefix: str) -> str:
    """Next `<prefix>NNNN` after the highest numeric code already used with that prefix."""
    pattern = re.compile(rf"^{prefix}(\d+)$")
    nums = [int(m.group(1)) for (code,) in db.query(model.code).filter(model.code.like(f"{prefix}%"))
            if (m := pattern.match(code))]
    return f"{prefix}{(max(nums) + 1 if nums else 1):04d}"


# ── Matching ───────────────────────────────────────────────────
def _branch(b: Optional[str]) -> str:
    return (b or "").strip() or DEFAULT_BRANCH


def find_contact(db: Session, tax_id: Optional[str], branch_code: Optional[str],
                 name: Optional[str] = None, exclude_id: Optional[UUID] = None) -> Optional[Contact]:
    """The existing contact for this tax ID + branch; by exact name only when there is no tax ID."""
    q = db.query(Contact).filter(Contact.is_deleted == False)
    if exclude_id:
        q = q.filter(Contact.id != exclude_id)
    tax_id = (tax_id or "").strip()
    if tax_id:
        branch = _branch(branch_code)
        return next((c for c in q.filter(Contact.tax_id == tax_id) if _branch(c.branch_code) == branch), None)
    if name:
        return q.filter(Contact.name == name.strip(), (Contact.tax_id == None) | (Contact.tax_id == "")).first()
    return None


# ── Sync ───────────────────────────────────────────────────────
def _copy_shared(src, dst):
    for f in SHARED_FIELDS:
        setattr(dst, f, getattr(src, f))


def _push_to_roles(contact: Contact):
    for role in (contact.customer, contact.supplier):
        if role is not None:
            _copy_shared(contact, role)


def link_role(db: Session, role: Role) -> Contact:
    """Attach a customer/supplier row to its contact — the matching one if it doesn't
    have this role yet, otherwise a new contact built from the row. The row then
    takes the contact's shared fields. Caller commits."""
    if role.contact_id:
        return role.contact
    attr = "customer" if isinstance(role, Customer) else "supplier"
    contact = find_contact(db, role.tax_id, role.branch_code, role.name)
    if contact is not None and getattr(contact, attr) is not None:
        contact = None                      # that partner already has this role: keep them apart
    if contact is None:
        contact = Contact(code=_next_code(db, Contact, "CT"), is_active=True)
        _copy_shared(role, contact)
        contact.branch_code = _branch(role.branch_code)
        db.add(contact); db.flush()
    role.contact_id = contact.id
    db.flush(); db.refresh(contact)
    _copy_shared(contact, role)
    return contact


def sync_from_role(db: Session, role: Role):
    """After a customer/supplier is edited directly: carry its shared fields to the
    contact and from there to the other role. Caller commits."""
    contact = link_role(db, role) if not role.contact_id else role.contact
    _copy_shared(role, contact)
    _push_to_roles(contact)


def backfill_contacts(db: Session) -> int:
    """Link every customer/supplier that has no contact yet (old data, seed scripts).
    Customers go first, so a supplier with the same tax ID or name joins that contact.
    Returns how many rows were linked; commits."""
    linked = 0
    for model in (Customer, Supplier):
        for role in db.query(model).filter(model.contact_id == None).order_by(model.created_at).all():
            link_role(db, role)
            linked += 1
    if linked:
        db.commit()
    return linked


# ── Read ───────────────────────────────────────────────────────
def _open_balances(db: Session, contacts: List[Contact]):
    cust_ids = {c.customer.id: c.id for c in contacts if c.customer}
    sup_ids  = {c.supplier.id: c.id for c in contacts if c.supplier}
    ar, ap = {}, {}
    if cust_ids:
        rows = (db.query(Invoice.customer_id, func.coalesce(func.sum(Invoice.balance_due), 0))
                  .filter(Invoice.customer_id.in_(cust_ids), Invoice.gl_posted == True,
                          Invoice.is_deleted == False, Invoice.status != InvoiceStatus.CANCELLED)
                  .group_by(Invoice.customer_id).all())
        ar = {cust_ids[k]: Decimal(str(v)) for k, v in rows}
    if sup_ids:
        rows = (db.query(Bill.supplier_id, func.coalesce(func.sum(Bill.balance_due), 0))
                  .filter(Bill.supplier_id.in_(sup_ids), Bill.gl_posted == True, Bill.is_deleted == False,
                          Bill.status.notin_((BillStatus.CANCELLED, BillStatus.REJECTED)))
                  .group_by(Bill.supplier_id).all())
        ap = {sup_ids[k]: Decimal(str(v)) for k, v in rows}
    return ar, ap


def to_response(c: Contact, receivable=Decimal("0"), payable=Decimal("0")) -> dict:
    cust = c.customer if c.customer and c.customer.is_active and not c.customer.is_deleted else None
    sup  = c.supplier if c.supplier and c.supplier.is_active and not c.supplier.is_deleted else None
    group = c.group if c.group and not c.group.is_deleted else None
    return {
        **{f: getattr(c, f) for f in ("id", "code", "is_active") + SHARED_FIELDS},
        "group_id": group.id if group else None, "group": group,
        "roles": [r for r, obj in (("customer", cust), ("supplier", sup)) if obj],
        "customer": cust, "supplier": sup,
        "receivable": receivable, "payable": payable,
    }


def list_contacts(db: Session, role: Optional[str] = None, search: Optional[str] = None,
                  include_inactive: bool = False, group_id: Optional[UUID] = None) -> List[dict]:
    backfill_contacts(db)   # picks up rows created outside this service (seed scripts, imports)
    q = db.query(Contact).filter(Contact.is_deleted == False)
    if not include_inactive:
        q = q.filter(Contact.is_active == True)
    if group_id:
        q = q.filter(Contact.group_id == group_id)
    if search:
        s = f"%{search.strip()}%"
        q = q.filter(Contact.name.ilike(s) | Contact.code.ilike(s) | Contact.tax_id.ilike(s) | Contact.name_en.ilike(s))
    rows = [to_response(c) for c in q.order_by(Contact.name).all()]
    if role in ("customer", "supplier"):
        rows = [r for r in rows if role in r["roles"]]
    contacts = {c.id: c for c in db.query(Contact).filter(Contact.id.in_([r["id"] for r in rows]))} if rows else {}
    ar, ap = _open_balances(db, list(contacts.values()))
    for r in rows:
        r["receivable"] = ar.get(r["id"], Decimal("0"))
        r["payable"] = ap.get(r["id"], Decimal("0"))
    return rows


def get_contact(db: Session, contact_id: UUID) -> Contact:
    c = db.query(Contact).filter(Contact.id == contact_id, Contact.is_deleted == False).first()
    if not c:
        raise HTTPException(404, "ไม่พบผู้ติดต่อ")
    return c


def contact_response(db: Session, c: Contact) -> dict:
    ar, ap = _open_balances(db, [c])
    return to_response(c, ar.get(c.id, Decimal("0")), ap.get(c.id, Decimal("0")))


# ── Write ──────────────────────────────────────────────────────
def _check_duplicate(db: Session, tax_id, branch_code, exclude_id=None):
    if (tax_id or "").strip():
        dup = find_contact(db, tax_id, branch_code, exclude_id=exclude_id)
        if dup:
            raise HTTPException(400, f"มีผู้ติดต่อเลขผู้เสียภาษีและสาขานี้แล้ว: {dup.code} {dup.name}")


def _set_customer(db: Session, c: Contact, data: CustomerRoleIn):
    role = c.customer
    if role is None:
        code = (data.code or "").strip().upper() or _next_code(db, Customer, "C")
        if db.query(Customer).filter(Customer.code == code, Customer.is_deleted == False).first():
            raise HTTPException(400, f"รหัสลูกค้า {code} มีอยู่แล้ว")
        role = Customer(code=code, contact=c)   # relationship, so c.customer is set at once
        db.add(role)
    role.credit_days, role.credit_limit, role.is_active = data.credit_days, data.credit_limit, True
    _copy_shared(c, role)


def _set_supplier(db: Session, c: Contact, data: SupplierRoleIn):
    role = c.supplier
    if role is None:
        code = (data.code or "").strip().upper() or _next_code(db, Supplier, "S")
        if db.query(Supplier).filter(Supplier.code == code, Supplier.is_deleted == False).first():
            raise HTTPException(400, f"รหัสผู้จำหน่าย {code} มีอยู่แล้ว")
        role = Supplier(code=code, contact=c)
        db.add(role)
    for f in ("payment_terms", "bank_name", "bank_account", "bank_branch", "wht_type"):
        setattr(role, f, getattr(data, f))
    role.is_active = True
    _copy_shared(c, role)


def _check_group(db: Session, group_id: Optional[UUID]):
    if group_id and not db.query(ContactGroup).filter(ContactGroup.id == group_id, ContactGroup.is_deleted == False).first():
        raise HTTPException(400, "ไม่พบกลุ่มประเภทลูกค้าที่เลือก")


def create_contact(db: Session, payload: ContactCreate) -> Contact:
    if not payload.customer and not payload.supplier:
        raise HTTPException(400, "เลือกอย่างน้อย 1 บทบาท: ลูกค้า หรือ ผู้จำหน่าย")
    _check_duplicate(db, payload.tax_id, payload.branch_code)
    _check_group(db, payload.group_id)
    c = Contact(code=_next_code(db, Contact, "CT"), is_active=True, group_id=payload.group_id,
                **payload.model_dump(include=set(SHARED_FIELDS)))
    c.branch_code = _branch(c.branch_code)
    db.add(c); db.flush()
    if payload.customer:
        _set_customer(db, c, payload.customer)
    if payload.supplier:
        _set_supplier(db, c, payload.supplier)
    db.commit(); db.refresh(c)
    return c


def update_contact(db: Session, contact_id: UUID, payload: ContactUpdate) -> Contact:
    c = get_contact(db, contact_id)
    shared = payload.model_dump(include=set(SHARED_FIELDS), exclude_none=True)
    if "tax_id" in shared or "branch_code" in shared:
        _check_duplicate(db, shared.get("tax_id", c.tax_id), shared.get("branch_code", c.branch_code), exclude_id=c.id)
    for k, v in shared.items():
        setattr(c, k, v)
    if "branch_code" in shared:
        c.branch_code = _branch(c.branch_code)
    if payload.is_active is not None:
        c.is_active = payload.is_active
    if "group_id" in payload.model_fields_set:      # an explicit null clears the group
        _check_group(db, payload.group_id)
        c.group_id = payload.group_id

    if payload.customer:
        _set_customer(db, c, payload.customer)
    elif payload.remove_customer and c.customer:
        c.customer.is_active = False
    if payload.supplier:
        _set_supplier(db, c, payload.supplier)
    elif payload.remove_supplier and c.supplier:
        c.supplier.is_active = False

    has_role = any(r is not None and r.is_active for r in (c.customer, c.supplier))
    if not has_role and c.is_active:
        raise HTTPException(400, "ผู้ติดต่อที่ใช้งานอยู่ต้องมีอย่างน้อย 1 บทบาท")
    db.flush()
    _push_to_roles(c)
    db.commit(); db.refresh(c)
    return c


# ── Customer type groups ───────────────────────────────────────
def _group_counts(db: Session) -> dict:
    rows = (db.query(Contact.group_id, func.count(Contact.id))
              .filter(Contact.group_id != None, Contact.is_deleted == False, Contact.is_active == True)
              .group_by(Contact.group_id).all())
    return dict(rows)


def group_response(db: Session, g: ContactGroup, counts: Optional[dict] = None) -> dict:
    counts = _group_counts(db) if counts is None else counts
    return {**{f: getattr(g, f) for f in ("id", "code", "name", "description", "is_active")},
            "contact_count": counts.get(g.id, 0)}


def list_groups(db: Session, include_inactive: bool = True) -> List[dict]:
    q = db.query(ContactGroup).filter(ContactGroup.is_deleted == False)
    if not include_inactive:
        q = q.filter(ContactGroup.is_active == True)
    counts = _group_counts(db)
    return [group_response(db, g, counts) for g in q.order_by(ContactGroup.code).all()]


def get_group(db: Session, group_id: UUID) -> ContactGroup:
    g = db.query(ContactGroup).filter(ContactGroup.id == group_id, ContactGroup.is_deleted == False).first()
    if not g:
        raise HTTPException(404, "ไม่พบกลุ่มประเภทลูกค้า")
    return g


def _check_group_code(db: Session, code: str, exclude_id: Optional[UUID] = None):
    q = db.query(ContactGroup).filter(ContactGroup.code == code, ContactGroup.is_deleted == False)
    if exclude_id:
        q = q.filter(ContactGroup.id != exclude_id)
    if q.first():
        raise HTTPException(400, f"รหัสกลุ่ม {code} มีอยู่แล้ว")


def create_group(db: Session, payload: ContactGroupCreate) -> ContactGroup:
    if not payload.name.strip():
        raise HTTPException(400, "ระบุชื่อกลุ่ม")
    code = (payload.code or "").strip().upper() or _next_code(db, ContactGroup, "G")
    _check_group_code(db, code)
    g = ContactGroup(code=code, name=payload.name.strip(), description=payload.description, is_active=True)
    db.add(g); db.commit(); db.refresh(g)
    return g


def update_group(db: Session, group_id: UUID, payload: ContactGroupUpdate) -> ContactGroup:
    g = get_group(db, group_id)
    data = payload.model_dump(exclude_none=True)
    if "code" in data:
        data["code"] = data["code"].strip().upper()
        _check_group_code(db, data["code"], exclude_id=g.id)
    if "name" in data and not data["name"].strip():
        raise HTTPException(400, "ระบุชื่อกลุ่ม")
    for k, v in data.items():
        setattr(g, k, v.strip() if k == "name" else v)
    db.commit(); db.refresh(g)
    return g


def delete_group(db: Session, group_id: UUID):
    g = get_group(db, group_id)
    used = db.query(Contact).filter(Contact.group_id == g.id, Contact.is_deleted == False).count()
    if used:
        raise HTTPException(400, f"ยังมีผู้ติดต่อในกลุ่มนี้ {used} ราย — ย้ายออกก่อน หรือปิดใช้งานกลุ่มแทน")
    g.is_deleted = True
    db.commit()
