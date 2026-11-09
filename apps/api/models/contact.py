"""
Contacts — one record per business partner, with customer and supplier as roles.

A company can be both a customer and a supplier. The shared identity (name, tax ID,
branch, address, contact person) lives here once; `customers` and `suppliers` stay as
role tables holding only role settings (credit terms, payment terms, bank, WHT) and
link back through `contact_id`. Every document keeps pointing at the role row, so
invoices, bills and the rest are unaffected.

The role tables still carry copies of the shared fields, because documents, PDFs and
reports read them there. services.contacts keeps those copies in step with the contact.
"""
from sqlalchemy import Column, String, Text, Boolean, ForeignKey
from sqlalchemy.orm import relationship
from core.database import Base
from models.base import UUIDMixin, TimestampMixin, UUIDType

# Fields that belong to the contact and are mirrored onto its role rows.
SHARED_FIELDS = ("name", "name_en", "tax_id", "branch_code", "address", "phone", "email", "contact_name")


class ContactGroup(Base, UUIDMixin, TimestampMixin):
    """A customer type group (wholesale, retail, VIP…) used to sort and filter contacts."""
    __tablename__ = "contact_groups"

    code        = Column(String(20),  nullable=False, unique=True, index=True)
    name        = Column(String(255), nullable=False)
    description = Column(Text,        nullable=True)
    is_active   = Column(Boolean,     default=True)

    contacts = relationship("Contact", back_populates="group")


class Contact(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "contacts"

    code         = Column(String(20),  nullable=False, unique=True, index=True)
    name         = Column(String(255), nullable=False, index=True)
    name_en      = Column(String(255), nullable=True)
    tax_id       = Column(String(20),  nullable=True, index=True)
    branch_code  = Column(String(10),  nullable=True)
    address      = Column(Text,        nullable=True)
    phone        = Column(String(30),  nullable=True)
    email        = Column(String(255), nullable=True)
    contact_name = Column(String(255), nullable=True)
    is_active    = Column(Boolean,     default=True)
    group_id     = Column(UUIDType(),  ForeignKey("contact_groups.id"), nullable=True, index=True)

    group    = relationship("ContactGroup", back_populates="contacts")
    customer = relationship("Customer", back_populates="contact", uselist=False)
    supplier = relationship("Supplier", back_populates="contact", uselist=False)
