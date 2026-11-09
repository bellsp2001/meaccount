"""
Purchase module — expense-side documents around the bill (Request for Quotation,
Purchase Order, Deposit paid, Credit Note, Debit Note).

Mirrors models.sales: one table with a `doc_type` discriminator. The flow is
RFQ → Purchase Order → Bill (models.ap). A deposit posts an advance-paid asset;
credit/debit notes adjust a posted bill (`bill_id`) and post the adjustment to GL.
The Bill and its payments stay in models.ap.
"""
import enum
from sqlalchemy.sql import false as sa_false
from sqlalchemy import (Column, String, Numeric, Boolean, Enum, ForeignKey,
                        Text, Date, Integer)
from sqlalchemy.orm import relationship
from core.database import Base
from models.base import UUIDMixin, TimestampMixin, UUIDType
from models.sales import SalesDocStatus


class PurchaseDocType(str, enum.Enum):
    RFQ            = "rfq"             # ใบขอเสนอราคา
    PURCHASE_ORDER = "purchase_order"  # ใบสั่งซื้อ
    DEPOSIT        = "deposit"         # ใบจ่ายมัดจำ
    CREDIT_NOTE    = "credit_note"     # ใบลดหนี้ (รับจากผู้จำหน่าย)
    DEBIT_NOTE     = "debit_note"      # ใบเพิ่มหนี้ (รับจากผู้จำหน่าย)


class PurchaseDocument(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "purchase_documents"

    number         = Column(String(30),    nullable=False, unique=True, index=True)
    doc_type       = Column(Enum(PurchaseDocType), nullable=False, index=True)
    supplier_id    = Column(UUIDType(),    ForeignKey("suppliers.id"), nullable=False)
    date           = Column(Date,          nullable=False, index=True)
    valid_until    = Column(Date,          nullable=True)   # quote due / delivery date / deposit due
    status         = Column(Enum(SalesDocStatus, name="purchasedocstatus"),
                            default=SalesDocStatus.DRAFT, nullable=False)
    subtotal       = Column(Numeric(18,2), default=0)
    vat_rate       = Column(Numeric(5,2),  default=7)
    vat_inclusive = Column(Boolean, nullable=False, default=False, server_default=sa_false())   # ราคารวม VAT
    vat_amount     = Column(Numeric(18,2), default=0)
    total          = Column(Numeric(18,2), default=0)
    deposit_amount = Column(Numeric(18,2), default=0)
    ref_number     = Column(String(100),   nullable=True)   # the supplier's own document number
    note           = Column(Text,          nullable=True)
    gl_posted      = Column(Boolean,       default=False)
    gl_journal_id  = Column(UUIDType(),    ForeignKey("journals.id"), nullable=True)
    converted_to_type = Column(String(30), nullable=True)  # 'purchase_order' | 'bill'
    converted_to_id   = Column(UUIDType(), nullable=True)
    source_doc_id     = Column(UUIDType(), ForeignKey("purchase_documents.id"), nullable=True)
    # Credit/debit notes: the posted bill being adjusted, and why
    bill_id        = Column(UUIDType(),    ForeignKey("bills.id"), nullable=True, index=True)
    reason         = Column(String(500),   nullable=True)
    # สมุดบันทึก (expense side) — required to confirm a deposit or note, which post to GL
    book_id        = Column(UUIDType(),    ForeignKey("document_books.id"), nullable=True)
    created_by     = Column(UUIDType(),    ForeignKey("users.id"), nullable=True)

    supplier   = relationship("Supplier")
    bill       = relationship("Bill", foreign_keys=[bill_id])
    book       = relationship("DocumentBook", foreign_keys=[book_id])
    items      = relationship("PurchaseDocumentItem", back_populates="document",
                              cascade="all, delete-orphan", lazy="joined",
                              order_by="PurchaseDocumentItem.sequence")
    creator    = relationship("User", foreign_keys=[created_by])
    gl_journal = relationship("Journal", foreign_keys=[gl_journal_id])


class PurchaseDocumentItem(Base, UUIDMixin):
    __tablename__ = "purchase_document_items"

    document_id  = Column(UUIDType(),    ForeignKey("purchase_documents.id"), nullable=False)
    sequence     = Column(Integer,       default=0)
    description  = Column(String(500),   nullable=False)
    quantity     = Column(Numeric(12,4), default=1,  nullable=False)
    unit         = Column(String(50),    nullable=True)
    unit_price   = Column(Numeric(18,4), nullable=False)
    discount_pct = Column(Numeric(5,2),  default=0)
    amount       = Column(Numeric(18,2), nullable=False)
    # Per-line VAT: the ประเภทภาษี picked for the line and its rate (null = the document's rate)
    tax_code_id  = Column(UUIDType(),    ForeignKey("tax_codes.id"), nullable=True)
    product_id   = Column(UUIDType(),    ForeignKey("products.id"), nullable=True)   # picked from สินค้า/บริการ
    detail       = Column(Text,          nullable=True)   # the line's คำอธิบาย
    vat_rate     = Column(Numeric(5,2),  nullable=True)

    document = relationship("PurchaseDocument", back_populates="items")
