"""
Tax Service — VAT ภ.พ.30 calculation, WHT Certificate generation, XML export
"""
from decimal import Decimal
from datetime import date, timedelta
from typing import List, Optional
from uuid import UUID
from sqlalchemy.orm import Session
from fastapi import HTTPException
import xml.etree.ElementTree as ET
import xml.dom.minidom as minidom

from models.tax import VATReturn, VATReturnStatus, WithholdingCertificate, WHTType, WHTCertStatus
from models.ar import Invoice, InvoiceStatus
from models.ap import Bill, BillStatus
from schemas.tax import VATReturnGenerateRequest, WHTCertificateCreate, WHTBulkGenerateRequest


# ── VAT Return (ภ.พ.30) ─────────────────────────────────────────

def generate_vat_return(db: Session, payload: VATReturnGenerateRequest, user_id: Optional[UUID] = None) -> VATReturn:
    """คำนวณ ภ.พ.30 จาก Invoice (ขาย) และ Bill (ซื้อ) ในงวดที่กำหนด"""
    existing = db.query(VATReturn).filter(
        VATReturn.period_month == payload.period_month,
        VATReturn.period_year == payload.period_year,
    ).first()
    if existing:
        raise HTTPException(400, f"มีรายการ ภ.พ.30 งวด {payload.period_month}/{payload.period_year} แล้ว")

    period_start = date(payload.period_year, payload.period_month, 1)
    if payload.period_month == 12:
        period_end = date(payload.period_year, 12, 31)
    else:
        period_end = date(payload.period_year, payload.period_month + 1, 1) - timedelta(days=1)

    # Output VAT — from posted invoices in period
    invoices = db.query(Invoice).filter(
        Invoice.date >= period_start, Invoice.date <= period_end,
        Invoice.gl_posted == True, Invoice.is_deleted == False,
    ).all()
    sales_amount = sum(inv.subtotal for inv in invoices)
    output_vat   = sum(inv.vat_amount for inv in invoices)

    # Input VAT — from posted bills in period
    bills = db.query(Bill).filter(
        Bill.date >= period_start, Bill.date <= period_end,
        Bill.gl_posted == True, Bill.is_deleted == False,
    ).all()
    purchase_amount = sum(b.subtotal for b in bills)
    input_vat       = sum(b.vat_amount for b in bills)

    net_vat = output_vat - input_vat

    # Due date: 15th of following month
    if payload.period_month == 12:
        due_date = date(payload.period_year + 1, 1, 15)
    else:
        due_date = date(payload.period_year, payload.period_month + 1, 15)

    vr = VATReturn(
        period_month=payload.period_month, period_year=payload.period_year,
        status=VATReturnStatus.DRAFT,
        sales_amount=sales_amount, output_vat=output_vat,
        purchase_amount=purchase_amount, input_vat=input_vat,
        net_vat=net_vat, due_date=due_date, created_by=user_id,
    )
    db.add(vr); db.commit(); db.refresh(vr)
    return vr


def get_vat_returns(db: Session, year: Optional[int] = None) -> List[VATReturn]:
    q = db.query(VATReturn).filter(VATReturn.is_deleted == False)
    if year:
        q = q.filter(VATReturn.period_year == year)
    return q.order_by(VATReturn.period_year.desc(), VATReturn.period_month.desc()).all()


def submit_vat_return(db: Session, vr_id: UUID) -> VATReturn:
    vr = db.query(VATReturn).filter(VATReturn.id == vr_id).first()
    if not vr:
        raise HTTPException(404, "ไม่พบรายการ ภ.พ.30")
    if vr.status != VATReturnStatus.DRAFT:
        raise HTTPException(400, "เฉพาะสถานะ Draft เท่านั้นที่ส่งได้")
    vr.status = VATReturnStatus.SUBMITTED
    vr.submitted_date = date.today()
    db.commit(); db.refresh(vr)
    return vr


def generate_vat_xml(db: Session, vr_id: UUID) -> str:
    """สร้าง XML รูปแบบสำหรับ e-Filing กรมสรรพากร (แบบย่อ)"""
    vr = db.query(VATReturn).filter(VATReturn.id == vr_id).first()
    if not vr:
        raise HTTPException(404, "ไม่พบรายการ ภ.พ.30")

    root = ET.Element("VATReturn", attrib={"formType": "PP30", "version": "1.0"})
    ET.SubElement(root, "Period").text = f"{vr.period_month:02d}/{vr.period_year}"
    sales = ET.SubElement(root, "Sales")
    ET.SubElement(sales, "Amount").text = str(vr.sales_amount)
    ET.SubElement(sales, "OutputVAT").text = str(vr.output_vat)
    purchases = ET.SubElement(root, "Purchases")
    ET.SubElement(purchases, "Amount").text = str(vr.purchase_amount)
    ET.SubElement(purchases, "InputVAT").text = str(vr.input_vat)
    ET.SubElement(root, "NetVAT").text = str(vr.net_vat)
    ET.SubElement(root, "DueDate").text = str(vr.due_date)

    xml_str = minidom.parseString(ET.tostring(root)).toprettyxml(indent="  ")
    vr.xml_generated = True
    db.commit()
    return xml_str


# ── Withholding Certificate ────────────────────────────────────

def next_wht_number(db: Session, p_date: date) -> str:
    prefix = f"WHT-{p_date.year}{p_date.month:02d}-"
    last = db.query(WithholdingCertificate).filter(
        WithholdingCertificate.number.like(f"{prefix}%")
    ).order_by(WithholdingCertificate.number.desc()).first()
    seq = int(last.number.split("-")[-1]) + 1 if last else 1
    return f"{prefix}{seq:04d}"


def create_wht_certificate(db: Session, payload: WHTCertificateCreate, user_id: Optional[UUID] = None) -> WithholdingCertificate:
    wht_amount = (payload.gross_amount * payload.wht_rate / 100).quantize(Decimal("0.01"))
    cert = WithholdingCertificate(
        number=next_wht_number(db, payload.payment_date),
        wht_type=payload.wht_type, payer_name=payload.payer_name, payer_tax_id=payload.payer_tax_id,
        payee_name=payload.payee_name, payee_tax_id=payload.payee_tax_id, payee_address=payload.payee_address,
        income_type=payload.income_type, payment_date=payload.payment_date,
        gross_amount=payload.gross_amount, wht_rate=payload.wht_rate, wht_amount=wht_amount,
        reference_type=payload.reference_type, reference_id=payload.reference_id,
        created_by=user_id,
    )
    db.add(cert); db.commit(); db.refresh(cert)
    return cert


def bulk_generate_wht_from_bills(db: Session, payload: WHTBulkGenerateRequest, user_id: Optional[UUID] = None) -> List[WithholdingCertificate]:
    """สร้างหนังสือรับรองหัก ณ ที่จ่ายอัตโนมัติจาก Bills ที่มี WHT ในงวด"""
    period_start = date(payload.period_year, payload.period_month, 1)
    if payload.period_month == 12:
        period_end = date(payload.period_year, 12, 31)
    else:
        period_end = date(payload.period_year, payload.period_month + 1, 1) - timedelta(days=1)

    bills = db.query(Bill).filter(
        Bill.date >= period_start, Bill.date <= period_end,
        Bill.wht_amount > 0, Bill.gl_posted == True, Bill.is_deleted == False,
    ).all()

    certs = []
    for bill in bills:
        # Skip if certificate already exists for this bill
        existing = db.query(WithholdingCertificate).filter(
            WithholdingCertificate.reference_type == "bill",
            WithholdingCertificate.reference_id == bill.id,
        ).first()
        if existing:
            continue

        cert = WithholdingCertificate(
            number=next_wht_number(db, bill.date),
            wht_type=WHTType.PND53,   # นิติบุคคล default
            payer_name=payload.payer_name, payer_tax_id=payload.payer_tax_id,
            payee_name=bill.supplier.name if bill.supplier else "ไม่ระบุ",
            payee_tax_id=bill.supplier.tax_id if bill.supplier else None,
            income_type=bill.description,
            payment_date=bill.date,
            gross_amount=bill.subtotal, wht_rate=bill.wht_rate, wht_amount=bill.wht_amount,
            reference_type="bill", reference_id=bill.id, created_by=user_id,
        )
        db.add(cert)
        certs.append(cert)

    db.commit()
    for c in certs:
        db.refresh(c)
    return certs


def get_wht_certificates(db: Session, period_month: Optional[int] = None,
                         period_year: Optional[int] = None) -> List[WithholdingCertificate]:
    q = db.query(WithholdingCertificate).filter(WithholdingCertificate.is_deleted == False)
    if period_month and period_year:
        from calendar import monthrange
        start = date(period_year, period_month, 1)
        end = date(period_year, period_month, monthrange(period_year, period_month)[1])
        q = q.filter(WithholdingCertificate.payment_date >= start, WithholdingCertificate.payment_date <= end)
    return q.order_by(WithholdingCertificate.payment_date.desc()).all()


def issue_certificate(db: Session, cert_id: UUID) -> WithholdingCertificate:
    cert = db.query(WithholdingCertificate).filter(WithholdingCertificate.id == cert_id).first()
    if not cert:
        raise HTTPException(404, "ไม่พบหนังสือรับรอง")
    cert.status = WHTCertStatus.ISSUED
    db.commit(); db.refresh(cert)
    return cert
