"""
Document Template Service — CRUD for saved template configs, and the actual
PDF renderer that applies a template's branding/field-visibility settings
to a real Invoice record.

This is intentionally a separate renderer from services/export.py's
export_to_pdf() — that function renders a generic table-of-rows report
(good for "here's a list of invoices"), while this one renders a single,
branded business document with a header/items-table/totals/footer layout,
which is a structurally different document and gets confused if forced
through the same function.
"""
import os
from decimal import Decimal
from typing import List, Optional
from uuid import UUID
from sqlalchemy.orm import Session
from fastapi import HTTPException

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_RIGHT, TA_CENTER
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
import io

from models.doctemplate import DocumentTemplate
from models.ar import Invoice, Payment
from models.sales import SalesDocument, SalesDocType
from schemas.doctemplate import DocumentTemplateCreate, DocumentTemplateUpdate

TEMPLATE_ASSET_DIR = "/tmp/meaccount_template_assets"
os.makedirs(TEMPLATE_ASSET_DIR, exist_ok=True)


# ── Thai-capable fonts ─────────────────────────────────────────
# ReportLab's base-14 fonts (Helvetica etc.) have no Thai glyphs, so Thai text
# renders as blank boxes. Register every Thai-capable TTF we can find so each
# template can pick a genuinely different typeface; THAI_FONT is the default
# used whenever a template specifies a font we didn't manage to register.
THAI_FONTS: set[str] = set()   # friendly names successfully registered
_FONT_CANDIDATES = [
    ("Tahoma",        r"C:\Windows\Fonts\tahoma.ttf",   None),
    ("TahomaBold",    r"C:\Windows\Fonts\tahomabd.ttf", None),
    ("LeelawadeeUI",  r"C:\Windows\Fonts\leelawui.ttf", None),
    ("Leelawadee",    r"C:\Windows\Fonts\leelawad.ttf", None),
    ("Angsana",       r"C:\Windows\Fonts\angsana.ttc",  0),
    ("Cordia",        r"C:\Windows\Fonts\cordia.ttc",   0),
    # Linux fallbacks (e.g. deployment hosts)
    ("Garuda",        "/usr/share/fonts/truetype/tlwg/Garuda.ttf", None),
    ("Loma",          "/usr/share/fonts/truetype/tlwg/Loma.ttf",   None),
]
for _name, _path, _idx in _FONT_CANDIDATES:
    if os.path.exists(_path):
        try:
            pdfmetrics.registerFont(TTFont(_name, _path) if _idx is None
                                    else TTFont(_name, _path, subfontIndex=_idx))
            THAI_FONTS.add(_name)
        except Exception:
            pass

THAI_FONT = "Tahoma" if "Tahoma" in THAI_FONTS else (next(iter(THAI_FONTS)) if THAI_FONTS else "Helvetica")

MAX_LOGO_SIZE_BYTES = 2 * 1024 * 1024   # 2MB — generous for a logo, prevents someone uploading a huge file that bloats every rendered PDF


# ── CRUD ───────────────────────────────────────────────────────

def create_template(db: Session, payload: DocumentTemplateCreate, user_id: Optional[UUID] = None) -> DocumentTemplate:
    is_first_for_kind = db.query(DocumentTemplate).filter(
        DocumentTemplate.document_kind == payload.document_kind, DocumentTemplate.is_deleted == False,
    ).count() == 0

    tpl = DocumentTemplate(**payload.model_dump(), is_default=is_first_for_kind, created_by=user_id)
    db.add(tpl); db.commit(); db.refresh(tpl)
    return tpl


def get_templates(db: Session, document_kind: Optional[str] = None) -> List[DocumentTemplate]:
    q = db.query(DocumentTemplate).filter(DocumentTemplate.is_active == True, DocumentTemplate.is_deleted == False)
    if document_kind:
        q = q.filter(DocumentTemplate.document_kind == document_kind)
    return q.order_by(DocumentTemplate.name).all()


def get_template(db: Session, template_id: UUID) -> DocumentTemplate:
    tpl = db.query(DocumentTemplate).filter(DocumentTemplate.id == template_id, DocumentTemplate.is_deleted == False).first()
    if not tpl:
        raise HTTPException(404, "ไม่พบเทมเพลตเอกสาร")
    return tpl


def get_default_template(db: Session, document_kind: str) -> Optional[DocumentTemplate]:
    return db.query(DocumentTemplate).filter(
        DocumentTemplate.document_kind == document_kind, DocumentTemplate.is_default == True,
        DocumentTemplate.is_active == True, DocumentTemplate.is_deleted == False,
    ).first()


def update_template(db: Session, template_id: UUID, payload: DocumentTemplateUpdate) -> DocumentTemplate:
    tpl = get_template(db, template_id)
    for k, v in payload.model_dump(exclude_none=True).items():
        setattr(tpl, k, v)
    db.commit(); db.refresh(tpl)
    return tpl


def set_default_template(db: Session, template_id: UUID) -> DocumentTemplate:
    tpl = get_template(db, template_id)
    # Only one default per document_kind — unset any existing default of the
    # same kind before setting this one, so the "which template renders by
    # default for invoices" question always has exactly one answer.
    db.query(DocumentTemplate).filter(
        DocumentTemplate.document_kind == tpl.document_kind, DocumentTemplate.id != tpl.id,
    ).update({DocumentTemplate.is_default: False})
    tpl.is_default = True
    db.commit(); db.refresh(tpl)
    return tpl


def upload_logo(db: Session, template_id: UUID, filename: str, content: bytes) -> DocumentTemplate:
    if len(content) > MAX_LOGO_SIZE_BYTES:
        raise HTTPException(400, f"ไฟล์โลโก้ใหญ่เกินไป (สูงสุด {MAX_LOGO_SIZE_BYTES // (1024*1024)}MB)")

    ext = os.path.splitext(filename)[1].lower()
    if ext not in (".png", ".jpg", ".jpeg"):
        raise HTTPException(400, "รองรับเฉพาะไฟล์ .png, .jpg, .jpeg")

    tpl = get_template(db, template_id)
    safe_name = f"{template_id}{ext}"
    path = os.path.join(TEMPLATE_ASSET_DIR, safe_name)
    with open(path, "wb") as f:
        f.write(content)

    tpl.logo_path = path
    db.commit(); db.refresh(tpl)
    return tpl


# ── PDF Rendering ──────────────────────────────────────────────

def _resolve_cfg(tpl: Optional[DocumentTemplate]) -> dict:
    """Flatten a template (or hardcoded fallback) into a plain config dict.
    Thai text is always rendered with THAI_FONT so it never comes out blank."""
    tpl_font = tpl.font_family if tpl else None
    return {
        "layout": (tpl.layout_style if tpl and getattr(tpl, "layout_style", None) else "classic"),
        "primary": tpl.primary_color if tpl else "#00D4AA",
        "accent": tpl.accent_color if tpl else "#0D1018",
        # Honour the template's font when it's a registered Thai-capable face,
        # otherwise fall back to the default so Thai never renders blank.
        "font": tpl_font if tpl_font in THAI_FONTS else THAI_FONT,
        "company_name": (tpl.company_display_name if tpl else None) or "บริษัทของคุณ",
        "company_address": (tpl.company_address if tpl else None) or "",
        "company_tax_id": (tpl.company_tax_id if tpl else None) or "",
        "footer": (tpl.footer_text if tpl else None) or "",
        "show_discount": tpl.show_item_discount if tpl else True,
        "show_vat": tpl.show_vat_breakdown if tpl else True,
        "show_due": tpl.show_due_date if tpl else True,
        "show_signature": tpl.show_signature_block if tpl else True,
        "logo_path": tpl.logo_path if tpl else None,
    }


def _pick_template(db: Session, kind: str, template_id: Optional[UUID]) -> Optional[DocumentTemplate]:
    if template_id:
        return get_template(db, template_id)
    # Prefer a template for this document kind; otherwise fall back to the
    # invoice template so a company only has to set up branding (logo/company
    # info) once and it applies to every document type.
    return get_default_template(db, kind) or get_default_template(db, "invoice")


PAGE_W = 18 * cm   # A4 width minus 1.5cm margins each side


def _tint(hexc: str, keep: float = 0.10) -> colors.Color:
    """A very light tint of a colour (mixed toward white) for zebra rows / boxes."""
    c = colors.HexColor(hexc)
    return colors.Color(c.red + (1 - c.red) * (1 - keep),
                        c.green + (1 - c.green) * (1 - keep),
                        c.blue + (1 - c.blue) * (1 - keep))


def _styles(cfg: dict) -> dict:
    font = cfg["font"]; primary = cfg["primary"]
    base = getSampleStyleSheet()
    mk = lambda name, **kw: ParagraphStyle(name, parent=base["Normal"], fontName=font, **kw)
    return {
        "title":        mk("t", fontSize=22, leading=26, textColor=colors.HexColor(primary)),
        "title_white":  mk("tw", fontSize=22, leading=26, textColor=colors.white),
        "title_small":  mk("ts", fontSize=12, leading=14, textColor=colors.grey, alignment=TA_RIGHT),
        "company":      mk("co", fontSize=12, leading=15),
        "company_white":mk("cw", fontSize=13, leading=16, textColor=colors.white),
        "normal":       mk("n", fontSize=9, leading=13),
        "small":        mk("s", fontSize=8, leading=11, textColor=colors.grey),
        "small_white":  mk("sw", fontSize=8, leading=11, textColor=colors.whitesmoke),
        "right":        mk("r", fontSize=9, leading=14, alignment=TA_RIGHT),
        "num_white":    mk("nw", fontSize=11, leading=14, textColor=colors.white, alignment=TA_RIGHT),
    }


def _logo(cfg: dict):
    if cfg["logo_path"] and os.path.exists(cfg["logo_path"]):
        try:
            return Image(cfg["logo_path"], width=3.2*cm, height=1.6*cm, kind="proportional")
        except Exception:
            return None
    return None


def _items_table(cfg: dict, items: list, variant: str) -> Table:
    font = cfg["font"]; primary = cfg["primary"]
    headers = ["รายการ", "จำนวน", "หน่วย", "ราคาต่อหน่วย"]
    if cfg["show_discount"]:
        headers.append("ส่วนลด%")
    headers.append("จำนวนเงิน")
    rows = [headers]
    for it in items:
        r = [it["description"], f"{it['quantity']:g}", it.get("unit") or "-", f"{it['unit_price']:,.2f}"]
        if cfg["show_discount"]:
            r.append(f"{it['discount_pct']:g}%")
        r.append(f"{it['amount']:,.2f}")
        rows.append(r)
    cw = [6.5*cm, 1.8*cm, 1.7*cm, 2.6*cm] + ([1.6*cm] if cfg["show_discount"] else []) + [2.6*cm]
    # pad last col to fill width
    used = sum(cw); cw[0] += (PAGE_W - used)
    t = Table(rows, colWidths=cw, repeatRows=1)
    common = [("FONTNAME", (0, 0), (-1, -1), font), ("FONTSIZE", (0, 0), (-1, -1), 8),
              ("ALIGN", (1, 0), (-1, -1), "RIGHT"), ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
              ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]
    if variant == "solid":
        st = common + [("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(primary)),
                       ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                       ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#DDDDDD")),
                       ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F5F5F5")])]
    elif variant == "shaded":
        st = common + [("BACKGROUND", (0, 0), (-1, 0), colors.HexColor(primary)),
                       ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                       ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, _tint(primary, 0.14)]),
                       ("LINEBELOW", (0, 0), (-1, -1), 0.3, colors.HexColor("#E8E8E8"))]
    else:  # "lines"
        st = common + [("TEXTCOLOR", (0, 0), (-1, 0), colors.HexColor(primary)),
                       ("LINEBELOW", (0, 0), (-1, 0), 1.2, colors.HexColor(primary)),
                       ("LINEBELOW", (0, 1), (-1, -1), 0.4, colors.HexColor("#E5E5E5"))]
    t.setStyle(TableStyle(st))
    return t


def _totals_block(cfg: dict, totals_rows: list, variant: str) -> Table:
    font = cfg["font"]; primary = cfg["primary"]; accent = cfg["accent"]
    inner = Table(totals_rows, colWidths=[4.8*cm, 3.4*cm])
    base = [("FONTNAME", (0, 0), (-1, -1), font), ("FONTSIZE", (0, 0), (-1, -2), 9),
            ("FONTSIZE", (0, -1), (-1, -1), 12), ("ALIGN", (1, 0), (1, -1), "RIGHT"),
            ("TOPPADDING", (0, 0), (-1, -1), 5), ("BOTTOMPADDING", (0, 0), (-1, -1), 5)]
    if variant == "box":
        st = base + [("BACKGROUND", (0, 0), (-1, -2), _tint(primary, 0.10)),
                     ("BACKGROUND", (0, -1), (-1, -1), colors.HexColor(primary)),
                     ("TEXTCOLOR", (0, -1), (-1, -1), colors.white),
                     ("LEFTPADDING", (0, 0), (-1, -1), 10), ("RIGHTPADDING", (0, 0), (-1, -1), 10)]
    else:  # "line"
        st = base + [("LINEABOVE", (0, -1), (-1, -1), 1, colors.HexColor(accent)),
                     ("TEXTCOLOR", (0, -1), (-1, -1), colors.HexColor(primary))]
    inner.setStyle(TableStyle(st))
    wrap = Table([["", inner]], colWidths=[PAGE_W - 8.2*cm, 8.2*cm])
    wrap.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                              ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    return wrap


def _signature(cfg: dict, labels) -> Table:
    font = cfg["font"]
    data = [["", ""], ["_________________________", "_________________________"], [labels[0], labels[1]]]
    t = Table(data, colWidths=[PAGE_W/2, PAGE_W/2])
    t.setStyle(TableStyle([("FONTNAME", (0, 0), (-1, -1), font), ("FONTSIZE", (0, 0), (-1, -1), 9),
                           ("ALIGN", (0, 0), (-1, -1), "CENTER"), ("TOPPADDING", (0, 1), (-1, 1), 22)]))
    return t


def _party_meta(cfg: dict, st: dict, number: str, customer: dict, meta_pairs: list) -> Table:
    """Two columns: customer block (left) + document meta (right)."""
    cl = f'<b>ลูกค้า</b><br/>{customer["name"]}'
    if customer.get("address"):
        cl += f'<br/>{customer["address"]}'
    if customer.get("tax_id") and customer["tax_id"] != "—":
        cl += f'<br/>เลขผู้เสียภาษี: {customer["tax_id"]}'
    mt = f'<b>เลขที่เอกสาร</b>  {number}'
    for l, v in meta_pairs:
        mt += f'<br/>{l}  {v}'
    t = Table([[Paragraph(cl, st["normal"]), Paragraph(mt, st["right"])]], colWidths=[PAGE_W/2, PAGE_W/2])
    t.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "TOP"),
                           ("LEFTPADDING", (0, 0), (-1, -1), 0), ("RIGHTPADDING", (0, 0), (-1, -1), 0)]))
    return t


def _band(cells, bg: str, pad: int = 12) -> Table:
    t = Table([cells], colWidths=[PAGE_W/2, PAGE_W/2])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), colors.HexColor(bg)),
                           ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                           ("TOPPADDING", (0, 0), (-1, -1), pad), ("BOTTOMPADDING", (0, 0), (-1, -1), pad),
                           ("LEFTPADDING", (0, 0), (-1, -1), 14), ("RIGHTPADDING", (0, 0), (-1, -1), 14)]))
    return t


# ── Layouts ────────────────────────────────────────────────────

def _layout_classic(cfg, st, *, title, number, customer, meta_pairs, items, totals_rows, signature_labels, show_items):
    el = []
    logo = _logo(cfg)
    if logo: el += [logo, Spacer(1, 8)]
    el.append(Paragraph(title, st["title"]))
    el.append(Paragraph(cfg["company_name"], st["company"]))
    if cfg["company_address"]: el.append(Paragraph(cfg["company_address"], st["small"]))
    if cfg["company_tax_id"]: el.append(Paragraph(f"เลขผู้เสียภาษี: {cfg['company_tax_id']}", st["small"]))
    el.append(Spacer(1, 16))
    left = [("เลขที่เอกสาร", number)] + meta_pairs
    right = [("ลูกค้า", customer["name"]), ("เลขผู้เสียภาษี", customer["tax_id"])]
    n = max(len(left), len(right)); rows = []
    for i in range(n):
        l = left[i] if i < len(left) else ("", "")
        r = right[i] if i < len(right) else ("", "")
        rows.append([l[0], l[1], r[0], r[1]])
    mt = Table(rows, colWidths=[3.3*cm, 5.7*cm, 3.3*cm, 5.7*cm])
    mt.setStyle(TableStyle([("FONTNAME", (0, 0), (-1, -1), cfg["font"]), ("FONTSIZE", (0, 0), (-1, -1), 9),
                            ("TEXTCOLOR", (0, 0), (0, -1), colors.grey), ("TEXTCOLOR", (2, 0), (2, -1), colors.grey),
                            ("TOPPADDING", (0, 0), (-1, -1), 2), ("BOTTOMPADDING", (0, 0), (-1, -1), 2)]))
    el += [mt, Spacer(1, 16)]
    if show_items: el += [_items_table(cfg, items, "solid"), Spacer(1, 12)]
    el += [_totals_block(cfg, totals_rows, "line"), Spacer(1, 24)]
    if cfg["show_signature"]: el += [_signature(cfg, signature_labels), Spacer(1, 12)]
    if cfg["footer"]: el.append(Paragraph(cfg["footer"], st["small"]))
    return el


def _layout_modern(cfg, st, *, title, number, customer, meta_pairs, items, totals_rows, signature_labels, show_items):
    el = []
    el.append(_band([Paragraph(cfg["company_name"], st["company_white"]), Paragraph(title, st["title_white"])],
                    cfg["primary"], pad=14))
    sub = cfg["company_address"] or ""
    if cfg["company_tax_id"]: sub += (("  ·  " if sub else "") + f"เลขผู้เสียภาษี: {cfg['company_tax_id']}")
    if sub: el += [Spacer(1, 4), Paragraph(sub, st["small"])]
    el += [Spacer(1, 14), _party_meta(cfg, st, number, customer, meta_pairs), Spacer(1, 16)]
    if show_items: el += [_items_table(cfg, items, "lines"), Spacer(1, 14)]
    el += [_totals_block(cfg, totals_rows, "box"), Spacer(1, 24)]
    if cfg["show_signature"]: el += [_signature(cfg, signature_labels), Spacer(1, 12)]
    if cfg["footer"]: el.append(Paragraph(cfg["footer"], st["small"]))
    return el


def _layout_minimal(cfg, st, *, title, number, customer, meta_pairs, items, totals_rows, signature_labels, show_items):
    el = []
    head = Table([[Paragraph(cfg["company_name"], st["company"]), Paragraph(title.split(" / ")[0], st["title_small"])]],
                 colWidths=[PAGE_W/2, PAGE_W/2])
    head.setStyle(TableStyle([("VALIGN", (0, 0), (-1, -1), "BOTTOM"), ("LEFTPADDING", (0, 0), (-1, -1), 0),
                              ("RIGHTPADDING", (0, 0), (-1, -1), 0), ("LINEBELOW", (0, 0), (-1, -1), 1, colors.HexColor(cfg["accent"]))]))
    el += [head, Spacer(1, 4)]
    sub = []
    if cfg["company_address"]: sub.append(cfg["company_address"])
    if cfg["company_tax_id"]: sub.append(f"เลขผู้เสียภาษี: {cfg['company_tax_id']}")
    if sub: el.append(Paragraph("  ·  ".join(sub), st["small"]))
    el.append(Spacer(1, 14))
    meta_line = f'เลขที่เอกสาร {number}' + "".join(f'   ·   {l} {v}' for l, v in meta_pairs)
    el.append(Paragraph(meta_line, st["small"]))
    tax = f'  (เลขภาษี {customer["tax_id"]})' if customer["tax_id"] != "—" else ""
    el += [Paragraph(f'<b>ลูกค้า:</b> {customer["name"]}{tax}', st["normal"]), Spacer(1, 14)]
    if show_items: el += [_items_table(cfg, items, "lines"), Spacer(1, 12)]
    el += [_totals_block(cfg, totals_rows, "line"), Spacer(1, 24)]
    if cfg["show_signature"]: el += [_signature(cfg, signature_labels), Spacer(1, 12)]
    if cfg["footer"]: el.append(Paragraph(cfg["footer"], st["small"]))
    return el


def _layout_bold(cfg, st, *, title, number, customer, meta_pairs, items, totals_rows, signature_labels, show_items):
    el = []
    logo = _logo(cfg)
    if logo: el += [logo, Spacer(1, 6)]
    el.append(_band([Paragraph(title, st["title_white"]), Paragraph(f"เลขที่ {number}", st["num_white"])],
                    cfg["primary"], pad=18))
    el.append(_band([Paragraph(cfg["company_name"], st["company_white"]), Paragraph("", st["normal"])],
                    cfg["accent"], pad=8))
    sub = cfg["company_address"] or ""
    if cfg["company_tax_id"]: sub += (("  ·  " if sub else "") + f"เลขผู้เสียภาษี: {cfg['company_tax_id']}")
    if sub: el += [Spacer(1, 4), Paragraph(sub, st["small"])]
    el += [Spacer(1, 14), _party_meta(cfg, st, number, customer, meta_pairs), Spacer(1, 16)]
    if show_items: el += [_items_table(cfg, items, "shaded"), Spacer(1, 14)]
    el += [_totals_block(cfg, totals_rows, "box"), Spacer(1, 24)]
    if cfg["show_signature"]: el += [_signature(cfg, signature_labels), Spacer(1, 12)]
    if cfg["footer"]: el.append(Paragraph(cfg["footer"], st["small"]))
    return el


_LAYOUTS = {"classic": _layout_classic, "modern": _layout_modern,
            "minimal": _layout_minimal, "bold": _layout_bold}


def _build_business_doc(cfg: dict, *, title: str, number: str, customer: dict, meta_pairs: list,
                        items: list, totals_rows: list,
                        signature_labels=("ผู้รับสินค้า/บริการ", "ผู้ออกเอกสาร"),
                        show_items: bool = True) -> bytes:
    """Render a branded single document, arranged per cfg['layout']
    (classic | modern | minimal | bold)."""
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, topMargin=1.3*cm, bottomMargin=1.3*cm,
                            leftMargin=1.5*cm, rightMargin=1.5*cm)
    layout = _LAYOUTS.get(cfg["layout"], _layout_classic)
    elements = layout(cfg, _styles(cfg), title=title, number=number, customer=customer,
                      meta_pairs=meta_pairs, items=items, totals_rows=totals_rows,
                      signature_labels=signature_labels, show_items=show_items)
    doc.build(elements)
    buf.seek(0)
    return buf.read()


def _items_as_dicts(items) -> list:
    return [{
        "description": it.description, "quantity": it.quantity, "unit": it.unit,
        "unit_price": it.unit_price, "discount_pct": it.discount_pct, "amount": it.amount,
    } for it in items]


def _cust_tax(cust) -> str:
    return cust.tax_id if cust and cust.tax_id else "—"


def _cust_dict(cust) -> dict:
    return {
        "name": cust.name if cust else "—",
        "tax_id": _cust_tax(cust),
        "address": getattr(cust, "address", None) if cust else None,
    }


def render_invoice_pdf(db: Session, invoice_id: UUID, template_id: Optional[UUID] = None,
                       as_tax_invoice: bool = False) -> bytes:
    """Render an Invoice (or, with as_tax_invoice=True, the same record titled as
    a Tax Invoice) as a branded PDF using the chosen/default/ fallback template."""
    invoice = db.query(Invoice).filter(Invoice.id == invoice_id, Invoice.is_deleted == False).first()
    if not invoice:
        raise HTTPException(404, "ไม่พบใบแจ้งหนี้")
    cfg = _resolve_cfg(_pick_template(db, "invoice", template_id))
    cust = invoice.customer

    meta_pairs = [("วันที่", str(invoice.date))]
    if cfg["show_due"]:
        meta_pairs.append(("ครบกำหนดชำระ", str(invoice.due_date)))

    totals_rows = [["ยอดรวมก่อนภาษี", f"฿{invoice.subtotal:,.2f}"]]
    if cfg["show_vat"]:
        totals_rows.append([f"ภาษีมูลค่าเพิ่ม ({invoice.vat_rate:g}%)", f"฿{invoice.vat_amount:,.2f}"])
    totals_rows.append(["ยอดรวมทั้งสิ้น", f"฿{invoice.total:,.2f}"])

    title = "ใบกำกับภาษี / TAX INVOICE" if as_tax_invoice else "ใบแจ้งหนี้ / INVOICE"
    return _build_business_doc(cfg, title=title, number=invoice.number, customer=_cust_dict(cust),
                               meta_pairs=meta_pairs, items=_items_as_dicts(invoice.items), totals_rows=totals_rows)


_SALES_DOC_META = {
    SalesDocType.QUOTATION:   ("ใบเสนอราคา / QUOTATION", "ยืนราคาถึง"),
    SalesDocType.SALES_ORDER: ("คำสั่งขาย / SALES ORDER", "กำหนดส่งของ"),
    SalesDocType.DEPOSIT:     ("ใบมัดจำ / DEPOSIT", "กำหนดชำระ"),
}


def render_sales_document_pdf(db: Session, doc_id: UUID, template_id: Optional[UUID] = None) -> bytes:
    """Render a Quotation / Sales Order / Deposit document as a branded PDF."""
    sdoc = db.query(SalesDocument).filter(SalesDocument.id == doc_id, SalesDocument.is_deleted == False).first()
    if not sdoc:
        raise HTTPException(404, "ไม่พบเอกสาร")
    # Quotations may have their own template kind; others fall back to the invoice template.
    kind = "quotation" if sdoc.doc_type == SalesDocType.QUOTATION else "invoice"
    cfg = _resolve_cfg(_pick_template(db, kind, template_id))
    cust = sdoc.customer
    title, valid_label = _SALES_DOC_META.get(sdoc.doc_type, ("เอกสารขาย", "มีผลถึง"))

    meta_pairs = [("วันที่", str(sdoc.date))]
    if sdoc.valid_until:
        meta_pairs.append((valid_label, str(sdoc.valid_until)))

    totals_rows = [["ยอดรวมก่อนภาษี", f"฿{sdoc.subtotal:,.2f}"]]
    if cfg["show_vat"]:
        totals_rows.append([f"ภาษีมูลค่าเพิ่ม ({sdoc.vat_rate:g}%)", f"฿{sdoc.vat_amount:,.2f}"])
    totals_rows.append(["ยอดรวมทั้งสิ้น", f"฿{sdoc.total:,.2f}"])
    if sdoc.doc_type == SalesDocType.DEPOSIT and sdoc.deposit_amount:
        totals_rows.insert(len(totals_rows) - 1, ["เงินมัดจำที่รับ", f"฿{sdoc.deposit_amount:,.2f}"])

    return _build_business_doc(cfg, title=title, number=sdoc.number, customer=_cust_dict(cust),
                               meta_pairs=meta_pairs, items=_items_as_dicts(sdoc.items), totals_rows=totals_rows)


_METHOD_LABEL = {
    "cash": "เงินสด", "bank_transfer": "โอนธนาคาร", "check": "เช็ค",
    "credit_card": "บัตรเครดิต", "promptpay": "PromptPay",
}


def render_receipt_pdf(db: Session, payment_id: UUID, template_id: Optional[UUID] = None) -> bytes:
    """Render a Receipt (ใบเสร็จรับเงิน) PDF from a Payment record."""
    payment = db.query(Payment).filter(Payment.id == payment_id).first()
    if not payment:
        raise HTTPException(404, "ไม่พบรายการรับชำระ")
    cfg = _resolve_cfg(_pick_template(db, "receipt", template_id))
    inv = payment.invoice
    cust = inv.customer if inv else None
    receipt_no = f"RCPT-{payment.date.year}{payment.date.month:02d}-{str(payment.id)[:8].upper()}"
    method = payment.method.value if hasattr(payment.method, "value") else str(payment.method)

    meta_pairs = [("วันที่", str(payment.date)),
                  ("อ้างอิงใบแจ้งหนี้", inv.number if inv else "—"),
                  ("ช่องทางชำระ", _METHOD_LABEL.get(method, method))]
    if payment.reference:
        meta_pairs.append(("เลขที่อ้างอิง", payment.reference))

    items = [{
        "description": f"รับชำระตามใบแจ้งหนี้ {inv.number}" if inv else "รับชำระเงิน",
        "quantity": 1, "unit": "-", "unit_price": payment.amount, "discount_pct": 0, "amount": payment.amount,
    }]
    totals_rows = [["จำนวนเงินที่รับชำระ", f"฿{payment.amount:,.2f}"]]
    return _build_business_doc(cfg, title="ใบเสร็จรับเงิน / RECEIPT", number=receipt_no,
                               customer=_cust_dict(cust), meta_pairs=meta_pairs,
                               items=items, totals_rows=totals_rows,
                               signature_labels=("ผู้รับเงิน", "ผู้วางบิล/ผู้จ่ายเงิน"))
