from pydantic import BaseModel
from typing import Optional, List
from uuid import UUID
from decimal import Decimal


class CustomerRoleIn(BaseModel):
    """Customer-role settings. `code` is generated (C0001…) when left out."""
    code:         Optional[str] = None
    credit_days:  int = 30
    credit_limit: Decimal = Decimal("0")


class SupplierRoleIn(BaseModel):
    """Supplier-role settings. `code` is generated (S0001…) when left out."""
    code:          Optional[str] = None
    payment_terms: int = 30
    bank_name:     Optional[str] = None
    bank_account:  Optional[str] = None
    bank_branch:   Optional[str] = None
    wht_type:      Optional[str] = None


class ContactGroupCreate(BaseModel):
    """`code` is generated (G0001…) when left out."""
    code:        Optional[str] = None
    name:        str
    description: Optional[str] = None


class ContactGroupUpdate(BaseModel):
    code:        Optional[str] = None
    name:        Optional[str] = None
    description: Optional[str] = None
    is_active:   Optional[bool] = None


class ContactGroupRef(BaseModel):
    id:   UUID
    code: str
    name: str
    model_config = {"from_attributes": True}


class ContactGroupResponse(ContactGroupRef):
    description:   Optional[str]
    is_active:     bool
    contact_count: int = 0                     # active contacts in the group


class ContactCreate(BaseModel):
    group_id:     Optional[UUID] = None
    name:         str
    name_en:      Optional[str] = None
    tax_id:       Optional[str] = None
    branch_code:  Optional[str] = "00000"
    address:      Optional[str] = None
    phone:        Optional[str] = None
    email:        Optional[str] = None
    contact_name: Optional[str] = None
    customer:     Optional[CustomerRoleIn] = None
    supplier:     Optional[SupplierRoleIn] = None


class ContactUpdate(BaseModel):
    """Shared fields to change, plus each role: settings to add/update it, or
    `remove_*` to switch it off. A removed role is deactivated, not deleted, so
    its documents keep their customer/supplier. Send `group_id: null` to clear the group."""
    group_id:        Optional[UUID] = None
    name:            Optional[str] = None
    name_en:         Optional[str] = None
    tax_id:          Optional[str] = None
    branch_code:     Optional[str] = None
    address:         Optional[str] = None
    phone:           Optional[str] = None
    email:           Optional[str] = None
    contact_name:    Optional[str] = None
    is_active:       Optional[bool] = None
    customer:        Optional[CustomerRoleIn] = None
    supplier:        Optional[SupplierRoleIn] = None
    remove_customer: bool = False
    remove_supplier: bool = False


class CustomerRoleOut(BaseModel):
    id:           UUID
    code:         str
    credit_days:  int
    credit_limit: Decimal
    is_active:    bool
    model_config = {"from_attributes": True}


class SupplierRoleOut(BaseModel):
    id:            UUID
    code:          str
    payment_terms: int
    bank_name:     Optional[str]
    bank_account:  Optional[str]
    bank_branch:   Optional[str]
    wht_type:      Optional[str]
    is_active:     bool
    model_config = {"from_attributes": True}


class ContactResponse(BaseModel):
    id:           UUID
    code:         str
    name:         str
    name_en:      Optional[str]
    tax_id:       Optional[str]
    branch_code:  Optional[str]
    address:      Optional[str]
    phone:        Optional[str]
    email:        Optional[str]
    contact_name: Optional[str]
    is_active:    bool
    group_id:     Optional[UUID] = None
    group:        Optional[ContactGroupRef] = None
    roles:        List[str] = []              # active roles: 'customer', 'supplier'
    customer:     Optional[CustomerRoleOut] = None
    supplier:     Optional[SupplierRoleOut] = None
    receivable:   Decimal = Decimal("0")      # open balance on posted invoices
    payable:      Decimal = Decimal("0")      # open balance on posted bills


class DuplicateCheck(BaseModel):
    duplicate: bool
    contact:   Optional[ContactResponse] = None
