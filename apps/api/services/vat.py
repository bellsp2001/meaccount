"""
Per-line VAT for sales, purchase, invoice and bill documents.

Each line can carry its own ประเภทภาษี (a VAT tax code); the code's rate decides the line's VAT.
A line without a code or rate falls back to the document's vat_rate, so older documents and
callers that only send a header rate keep working.
"""
from decimal import Decimal
from typing import Iterable, Optional, Tuple
from uuid import UUID
from sqlalchemy.orm import Session
from fastapi import HTTPException

from models.tax import TaxCode, TaxKind

CENT = Decimal("0.01")


def settle_line_vat(db: Session, items: Iterable, default_rate: Decimal,
                    inclusive: bool = False) -> Tuple[Decimal, Decimal]:
    """Fix each line's vat_rate (from its tax code when it has one) and return
    (document VAT, document rate). The document rate is the lines' common rate, or the given
    default when the lines differ — it is only shown on the document; the VAT is per line.
    `inclusive` = line amounts already include VAT (ราคารวม VAT), so VAT is taken out of them."""
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
        vat += Decimal(it.amount) * rate / ((100 + rate) if inclusive else 100)
    header_rate = rates.pop() if len(rates) == 1 else Decimal(default_rate)
    return vat.quantize(CENT), header_rate


def document_totals(db: Session, items: list, default_rate: Decimal,
                    inclusive: bool = False) -> Tuple[Decimal, Decimal, Decimal, Decimal]:
    """(subtotal before VAT, VAT, total, document rate) of a document's lines.
    VAT-exclusive: total = lines + VAT. VAT-inclusive: total = lines, subtotal = lines − VAT."""
    lines = sum((Decimal(it.amount) for it in items), Decimal("0"))
    vat, header_rate = settle_line_vat(db, items, default_rate, inclusive)
    if inclusive:
        return lines - vat, vat, lines, header_rate
    return lines, vat, lines + vat, header_rate
