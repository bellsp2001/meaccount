"""
Per-line VAT for sales, purchase, invoice and bill documents.

Each line can carry its own ประเภทภาษี (a VAT tax code); the code's rate decides the line's VAT.
A line without a code or rate falls back to the document's vat_rate, so older documents and
callers that only send a header rate keep working.
"""
from decimal import Decimal
from typing import Iterable, NamedTuple, Optional, Tuple
from uuid import UUID
from sqlalchemy.orm import Session
from fastapi import HTTPException

from models.tax import TaxCode, TaxKind

CENT = Decimal("0.01")


def settle_line_vat(db: Session, items: Iterable, default_rate: Decimal,
                    inclusive: bool = False, factor: Decimal = Decimal("1")) -> Tuple[Decimal, Decimal]:
    """Fix each line's vat_rate (from its tax code when it has one) and return
    (document VAT, document rate). The document rate is the lines' common rate, or the given
    default when the lines differ — it is only shown on the document; the VAT is per line.
    `inclusive` = line amounts already include VAT (ราคารวม VAT), so VAT is taken out of them.
    `factor` scales every line before VAT — a bill discount shared across the lines pro rata."""
    codes: dict = {}
    vat = Decimal("0")
    rates = set()
    for it in items:
        code_id: Optional[UUID] = getattr(it, "tax_code_id", None)
        if code_id:
            if code_id not in codes:
                code = db.query(TaxCode).filter(TaxCode.id == code_id, TaxCode.is_deleted == False).first()
                if not code or code.kind != TaxKind.VAT:
                    raise HTTPException(400, "ประเภทภาษีของรายการต้องเป็นภาษีมูลค่าเพิ่ม (VAT)")
                codes[code_id] = Decimal(code.rate)
            it.vat_rate = codes[code_id]
        rate = Decimal(it.vat_rate) if it.vat_rate is not None else Decimal(default_rate)
        rates.add(rate)
        vat += Decimal(it.amount) * factor * rate / ((100 + rate) if inclusive else 100)
    header_rate = rates.pop() if len(rates) == 1 else Decimal(default_rate)
    return vat.quantize(CENT), header_rate


class Totals(NamedTuple):
    subtotal: Decimal         # before VAT, after a before-VAT bill discount
    vat: Decimal
    total: Decimal
    vat_rate: Decimal         # the document's display rate
    discount: Decimal         # the bill discount in baht (ส่วนลดท้ายบิล)


def bill_discount(lines: Decimal, value: Decimal, is_pct: bool) -> Decimal:
    """The bill discount in baht: `value` baht, or `value` % of the lines; never more than the lines."""
    value = Decimal(value or 0)
    if value < 0:
        raise HTTPException(400, "ส่วนลดท้ายบิลต้องไม่ติดลบ")
    if is_pct and value > 100:
        raise HTTPException(400, "ส่วนลดท้ายบิลต้องไม่เกิน 100%")
    amount = (lines * value / 100) if is_pct else value
    return min(amount.quantize(CENT), lines)


def document_totals(db: Session, items: list, default_rate: Decimal, inclusive: bool = False,
                    discount_value: Decimal = Decimal("0"), discount_is_pct: bool = False,
                    discount_after_vat: bool = False) -> Totals:
    """Totals of a document's lines.
    Before VAT (default): the bill discount comes off the lines, shared across them pro rata (so
    each line's VAT rate still applies to its share). VAT-exclusive: total = lines − discount + VAT;
    VAT-inclusive: total = lines − discount, with the VAT taken out of it.
    After VAT: VAT is on the full lines and the discount (a % of the total with VAT) comes off
    the total — subtotal + VAT − discount = total."""
    lines = sum((Decimal(it.amount) for it in items), Decimal("0"))
    if discount_after_vat:
        vat, header_rate = settle_line_vat(db, items, default_rate, inclusive)
        subtotal, gross = (lines - vat, lines) if inclusive else (lines, lines + vat)
        discount = bill_discount(gross, discount_value, discount_is_pct)
        return Totals(subtotal, vat, gross - discount, header_rate, discount)
    discount = bill_discount(lines, discount_value, discount_is_pct)
    net = lines - discount
    factor = (net / lines) if lines else Decimal("0")
    vat, header_rate = settle_line_vat(db, items, default_rate, inclusive, factor)
    if inclusive:
        return Totals(net - vat, vat, net, header_rate, discount)
    return Totals(net, vat, net + vat, header_rate, discount)


def totals_fields(db: Session, items: list, default_rate: Decimal, inclusive: bool = False,
                  discount_value: Decimal = Decimal("0"), discount_is_pct: bool = False,
                  discount_after_vat: bool = False) -> dict:
    """The stored total columns of a sales/purchase/invoice/bill document, from its lines and
    pricing settings — spread into the model's constructor or set on an existing document."""
    t = document_totals(db, items, default_rate, inclusive, discount_value, discount_is_pct, discount_after_vat)
    return dict(subtotal=t.subtotal, vat_amount=t.vat, total=t.total, vat_rate=t.vat_rate,
                vat_inclusive=inclusive, discount_value=Decimal(discount_value or 0),
                discount_is_pct=discount_is_pct, discount_after_vat=discount_after_vat, discount_amount=t.discount)


def pricing_of(src) -> dict:
    """A document's (or create payload's) pricing settings, as totals_fields keyword arguments."""
    return dict(inclusive=src.vat_inclusive, discount_value=src.discount_value,
                discount_is_pct=src.discount_is_pct, discount_after_vat=src.discount_after_vat)


def after_vat_discount(doc) -> Decimal:
    """The discount a posting must book on its own line: an after-VAT bill discount, which is
    neither in the subtotal nor the VAT. Zero for a before-VAT discount (already in the subtotal)."""
    return Decimal(doc.discount_amount or 0) if doc.discount_after_vat else Decimal("0")
