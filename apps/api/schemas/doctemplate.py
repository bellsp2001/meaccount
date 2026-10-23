from pydantic import BaseModel, field_validator
from typing import Optional
from uuid import UUID
import re


HEX_COLOR_RE = re.compile(r"^#[0-9A-Fa-f]{6}$")

# Fonts the renderer can actually use. The Thai-capable TTFs (registered in
# services/doctemplate.py) render Thai correctly; the Base-14 fonts are kept for
# backward compatibility but don't cover Thai glyphs. Rejecting anything outside
# this list upfront is better than a silent fallback at render time.
VALID_FONTS = {
    "Tahoma", "TahomaBold", "LeelawadeeUI", "Leelawadee", "Angsana", "Cordia", "Garuda", "Loma",
    "Helvetica", "Helvetica-Bold", "Times-Roman", "Times-Bold", "Courier", "Courier-Bold",
}


VALID_LAYOUTS = {"classic", "modern", "minimal", "bold"}


class DocumentTemplateCreate(BaseModel):
    name: str
    document_kind: str = "invoice"
    layout_style: str = "classic"
    primary_color: str = "#00D4AA"
    accent_color: str = "#0D1018"
    font_family: str = "Tahoma"
    company_display_name: Optional[str] = None
    company_address: Optional[str] = None
    company_tax_id: Optional[str] = None
    footer_text: Optional[str] = None
    show_item_discount: bool = True
    show_vat_breakdown: bool = True
    show_due_date: bool = True
    show_signature_block: bool = True

    @field_validator("document_kind")
    @classmethod
    def valid_kind(cls, v):
        if v not in ("invoice", "quotation", "receipt"):
            raise ValueError("document_kind ต้องเป็น invoice, quotation หรือ receipt")
        return v

    @field_validator("layout_style")
    @classmethod
    def valid_layout(cls, v):
        if v not in VALID_LAYOUTS:
            raise ValueError(f"layout_style ต้องเป็นหนึ่งใน {sorted(VALID_LAYOUTS)}")
        return v

    @field_validator("primary_color", "accent_color")
    @classmethod
    def valid_hex(cls, v):
        if not HEX_COLOR_RE.match(v):
            raise ValueError(f"'{v}' ไม่ใช่รหัสสี hex ที่ถูกต้อง (ต้องเป็นรูปแบบ #RRGGBB)")
        return v

    @field_validator("font_family")
    @classmethod
    def valid_font(cls, v):
        if v not in VALID_FONTS:
            raise ValueError(f"font_family ต้องเป็นหนึ่งใน {sorted(VALID_FONTS)}")
        return v


class DocumentTemplateUpdate(BaseModel):
    name: Optional[str] = None
    layout_style: Optional[str] = None
    primary_color: Optional[str] = None
    accent_color: Optional[str] = None
    font_family: Optional[str] = None
    company_display_name: Optional[str] = None
    company_address: Optional[str] = None
    company_tax_id: Optional[str] = None
    footer_text: Optional[str] = None
    show_item_discount: Optional[bool] = None
    show_vat_breakdown: Optional[bool] = None
    show_due_date: Optional[bool] = None
    show_signature_block: Optional[bool] = None

    @field_validator("primary_color", "accent_color")
    @classmethod
    def valid_hex(cls, v):
        if v is not None and not HEX_COLOR_RE.match(v):
            raise ValueError(f"'{v}' ไม่ใช่รหัสสี hex ที่ถูกต้อง (ต้องเป็นรูปแบบ #RRGGBB)")
        return v

    @field_validator("font_family")
    @classmethod
    def valid_font(cls, v):
        if v is not None and v not in VALID_FONTS:
            raise ValueError(f"font_family ต้องเป็นหนึ่งใน {sorted(VALID_FONTS)}")
        return v

    @field_validator("layout_style")
    @classmethod
    def valid_layout(cls, v):
        if v is not None and v not in VALID_LAYOUTS:
            raise ValueError(f"layout_style ต้องเป็นหนึ่งใน {sorted(VALID_LAYOUTS)}")
        return v


class DocumentTemplateResponse(BaseModel):
    id: UUID
    name: str
    document_kind: str
    is_default: bool
    is_active: bool
    layout_style: str
    logo_path: Optional[str]
    primary_color: str
    accent_color: str
    font_family: str
    company_display_name: Optional[str]
    company_address: Optional[str]
    company_tax_id: Optional[str]
    footer_text: Optional[str]
    show_item_discount: bool
    show_vat_breakdown: bool
    show_due_date: bool
    show_signature_block: bool
    model_config = {"from_attributes": True}
