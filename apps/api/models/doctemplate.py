"""
Document Template Models: DocumentTemplate — a saved customization config
(logo, colors, field visibility, layout) applied when rendering Invoice or
Quotation PDFs. The template itself doesn't render anything — it's config
data that services/doc_render.py reads when generating a PDF for a specific
Invoice/Bill/Quotation record, the same "config drives an existing render
path" pattern as PromptProfile from W39-40 drives chat behavior without
retraining a model.
"""
import enum
from sqlalchemy import Column, String, Boolean, ForeignKey, JSON, Text
from sqlalchemy.orm import relationship
from core.database import Base
from models.base import UUIDMixin, TimestampMixin, UUIDType


class DocumentKind(str, enum.Enum):
    INVOICE    = "invoice"
    QUOTATION  = "quotation"
    RECEIPT    = "receipt"


class DocumentTemplate(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "document_templates"

    name         = Column(String(200), nullable=False)
    document_kind = Column(String(20), default=DocumentKind.INVOICE.value, nullable=False)
    is_default   = Column(Boolean, default=False, nullable=False)
    is_active    = Column(Boolean, default=True, nullable=False)

    # Overall page layout — changes how the header/parties/items/totals are
    # arranged, not just the colours. One of: classic | modern | minimal | bold.
    layout_style = Column(String(20), default="classic", nullable=False)

    # Branding
    logo_path       = Column(String(500), nullable=True)   # storage path, same convention as models.document
    primary_color    = Column(String(7), default="#00D4AA", nullable=False)   # hex
    accent_color      = Column(String(7), default="#0D1018", nullable=False)
    font_family        = Column(String(50), default="Helvetica", nullable=False)   # must be a ReportLab base-14 font

    # Company header fields shown on the document (independent of Company model
    # from W35-36 — a template may be used before multi-company data is set up,
    # or a company may want a different display name/address on documents than
    # its internal legal record)
    company_display_name = Column(String(255), nullable=True)
    company_address        = Column(Text, nullable=True)
    company_tax_id            = Column(String(20), nullable=True)
    footer_text                 = Column(Text, nullable=True)   # e.g. bank details, terms

    # Field visibility toggles — which optional columns/sections appear
    show_item_discount   = Column(Boolean, default=True, nullable=False)
    show_vat_breakdown    = Column(Boolean, default=True, nullable=False)
    show_due_date          = Column(Boolean, default=True, nullable=False)
    show_signature_block     = Column(Boolean, default=True, nullable=False)

    created_by = Column(UUIDType(), ForeignKey("users.id"), nullable=True)
