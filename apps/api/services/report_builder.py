"""
Report Builder Service — Custom Report Builder, Saved Reports, Scheduled Reports
"""
from decimal import Decimal
from datetime import date
from typing import List, Optional, Dict, Any
from uuid import UUID
from sqlalchemy.orm import Session
from fastapi import HTTPException

from models.report import SavedReport, ScheduledReport, ReportSourceType
from models.accounting import Journal, JournalEntry, Account
from models.ar import Invoice, Customer
from models.ap import Bill, Supplier
from models.inventory import Product
from models.payroll import Employee
from schemas.report_builder import (
    FieldMeta, SourceFieldsResponse, CustomReportRequest, CustomReportResponse,
    SavedReportCreate, ScheduledReportCreate,
)


# ── Field Metadata per source ────────────────────────────────────

SOURCE_FIELDS: Dict[ReportSourceType, List[FieldMeta]] = {
    ReportSourceType.JOURNAL: [
        FieldMeta(key="number", label="เลขที่", type="string"),
        FieldMeta(key="date", label="วันที่", type="date"),
        FieldMeta(key="description", label="คำอธิบาย", type="string"),
        FieldMeta(key="status", label="สถานะ", type="string"),
        FieldMeta(key="total_debit", label="Debit รวม", type="currency"),
        FieldMeta(key="total_credit", label="Credit รวม", type="currency"),
    ],
    ReportSourceType.INVOICE: [
        FieldMeta(key="number", label="เลขที่ Invoice", type="string"),
        FieldMeta(key="customer_name", label="ลูกค้า", type="string"),
        FieldMeta(key="date", label="วันที่", type="date"),
        FieldMeta(key="due_date", label="ครบกำหนด", type="date"),
        FieldMeta(key="total", label="ยอดรวม", type="currency"),
        FieldMeta(key="balance_due", label="ค้างชำระ", type="currency"),
        FieldMeta(key="status", label="สถานะ", type="string"),
    ],
    ReportSourceType.BILL: [
        FieldMeta(key="number", label="เลขที่ Bill", type="string"),
        FieldMeta(key="supplier_name", label="ผู้จำหน่าย", type="string"),
        FieldMeta(key="date", label="วันที่", type="date"),
        FieldMeta(key="due_date", label="ครบกำหนด", type="date"),
        FieldMeta(key="net_payable", label="ยอดจ่ายสุทธิ", type="currency"),
        FieldMeta(key="balance_due", label="ค้างจ่าย", type="currency"),
        FieldMeta(key="status", label="สถานะ", type="string"),
    ],
    ReportSourceType.PRODUCT: [
        FieldMeta(key="sku", label="SKU", type="string"),
        FieldMeta(key="name", label="ชื่อสินค้า", type="string"),
        FieldMeta(key="qty_on_hand", label="คงเหลือ", type="number"),
        FieldMeta(key="avg_cost", label="ต้นทุนเฉลี่ย", type="currency"),
        FieldMeta(key="sale_price", label="ราคาขาย", type="currency"),
    ],
    ReportSourceType.EMPLOYEE: [
        FieldMeta(key="employee_code", label="รหัสพนักงาน", type="string"),
        FieldMeta(key="full_name", label="ชื่อ", type="string"),
        FieldMeta(key="department", label="แผนก", type="string"),
        FieldMeta(key="base_salary", label="เงินเดือน", type="currency"),
        FieldMeta(key="status", label="สถานะ", type="string"),
    ],
    ReportSourceType.ACCOUNT: [
        FieldMeta(key="code", label="รหัสบัญชี", type="string"),
        FieldMeta(key="name", label="ชื่อบัญชี", type="string"),
        FieldMeta(key="account_type", label="ประเภท", type="string"),
        FieldMeta(key="balance", label="ยอดคงเหลือ", type="currency"),
    ],
}


def get_source_fields(source_type: ReportSourceType) -> SourceFieldsResponse:
    return SourceFieldsResponse(source_type=source_type, fields=SOURCE_FIELDS.get(source_type, []))


def _apply_filters(query, model, filters):
    for f in filters or []:
        col = getattr(model, f.field, None)
        if col is None:
            continue
        if f.operator == "eq":
            query = query.filter(col == f.value)
        elif f.operator == "gte":
            query = query.filter(col >= f.value)
        elif f.operator == "lte":
            query = query.filter(col <= f.value)
        elif f.operator == "contains":
            query = query.filter(col.ilike(f"%{f.value}%"))
    return query


def run_custom_report(db: Session, payload: CustomReportRequest) -> CustomReportResponse:
    """Execute a custom report query based on source_type + columns + filters"""

    if payload.source_type == ReportSourceType.INVOICE:
        q = db.query(Invoice).filter(Invoice.is_deleted == False)
        q = _apply_filters(q, Invoice, payload.filters)
        total = q.count()
        rows_data = q.limit(payload.limit).all()
        rows = []
        for inv in rows_data:
            row = {}
            for col in payload.columns:
                if col == "customer_name":
                    row[col] = inv.customer.name if inv.customer else None
                else:
                    val = getattr(inv, col, None)
                    row[col] = float(val) if isinstance(val, Decimal) else (str(val) if val is not None else None)
            rows.append(row)

    elif payload.source_type == ReportSourceType.BILL:
        q = db.query(Bill).filter(Bill.is_deleted == False)
        q = _apply_filters(q, Bill, payload.filters)
        total = q.count()
        rows_data = q.limit(payload.limit).all()
        rows = []
        for b in rows_data:
            row = {}
            for col in payload.columns:
                if col == "supplier_name":
                    row[col] = b.supplier.name if b.supplier else None
                else:
                    val = getattr(b, col, None)
                    row[col] = float(val) if isinstance(val, Decimal) else (str(val) if val is not None else None)
            rows.append(row)

    elif payload.source_type == ReportSourceType.PRODUCT:
        q = db.query(Product).filter(Product.is_deleted == False)
        q = _apply_filters(q, Product, payload.filters)
        total = q.count()
        rows_data = q.limit(payload.limit).all()
        rows = [{col: (float(getattr(p, col)) if isinstance(getattr(p, col, None), Decimal) else str(getattr(p, col, "")))
                for col in payload.columns} for p in rows_data]

    elif payload.source_type == ReportSourceType.EMPLOYEE:
        q = db.query(Employee).filter(Employee.is_deleted == False)
        q = _apply_filters(q, Employee, payload.filters)
        total = q.count()
        rows_data = q.limit(payload.limit).all()
        rows = []
        for e in rows_data:
            row = {}
            for col in payload.columns:
                val = getattr(e, col, None)
                row[col] = float(val) if isinstance(val, Decimal) else (
                    val.value if hasattr(val, "value") else (str(val) if val is not None else None)
                )
            rows.append(row)

    elif payload.source_type == ReportSourceType.ACCOUNT:
        q = db.query(Account).filter(Account.is_deleted == False)
        q = _apply_filters(q, Account, payload.filters)
        total = q.count()
        rows_data = q.limit(payload.limit).all()
        rows = []
        for a in rows_data:
            row = {}
            for col in payload.columns:
                val = getattr(a, col, None)
                row[col] = float(val) if isinstance(val, Decimal) else (
                    val.value if hasattr(val, "value") else (str(val) if val is not None else None)
                )
            rows.append(row)

    elif payload.source_type == ReportSourceType.JOURNAL:
        q = db.query(Journal).filter(Journal.is_deleted == False)
        q = _apply_filters(q, Journal, payload.filters)
        total = q.count()
        rows_data = q.limit(payload.limit).all()
        rows = []
        for j in rows_data:
            row = {}
            for col in payload.columns:
                if col == "total_debit":
                    row[col] = float(sum(e.debit for e in j.entries))
                elif col == "total_credit":
                    row[col] = float(sum(e.credit for e in j.entries))
                else:
                    val = getattr(j, col, None)
                    row[col] = val.value if hasattr(val, "value") else (str(val) if val is not None else None)
            rows.append(row)
    else:
        raise HTTPException(400, "ไม่รองรับแหล่งข้อมูลนี้")

    return CustomReportResponse(source_type=payload.source_type, columns=payload.columns, rows=rows, total_rows=total)


# ── Saved Reports ──────────────────────────────────────────────

def create_saved_report(db: Session, payload: SavedReportCreate, user_id: Optional[UUID] = None) -> SavedReport:
    filters_json = [f.model_dump() for f in payload.filters] if payload.filters else None
    r = SavedReport(
        name=payload.name, source_type=payload.source_type, columns=payload.columns,
        filters=filters_json, sort_by=payload.sort_by, is_public=payload.is_public, created_by=user_id,
    )
    db.add(r); db.commit(); db.refresh(r)
    return r


def get_saved_reports(db: Session, user_id: Optional[UUID] = None) -> List[SavedReport]:
    q = db.query(SavedReport).filter(SavedReport.is_deleted == False)
    if user_id:
        from sqlalchemy import or_
        q = q.filter(or_(SavedReport.created_by == user_id, SavedReport.is_public == True))
    return q.order_by(SavedReport.name).all()


# ── Scheduled Reports ────────────────────────────────────────────

def create_scheduled_report(db: Session, payload: ScheduledReportCreate, user_id: Optional[UUID] = None) -> ScheduledReport:
    sr = ScheduledReport(
        name=payload.name, report_type=payload.report_type, frequency=payload.frequency,
        recipients=payload.recipients, format=payload.format,
        saved_report_id=payload.saved_report_id, created_by=user_id,
    )
    db.add(sr); db.commit(); db.refresh(sr)
    return sr


def get_scheduled_reports(db: Session) -> List[ScheduledReport]:
    return db.query(ScheduledReport).filter(ScheduledReport.is_deleted == False).order_by(ScheduledReport.name).all()


def toggle_scheduled_report(db: Session, sr_id: UUID) -> ScheduledReport:
    sr = db.query(ScheduledReport).filter(ScheduledReport.id == sr_id).first()
    if not sr:
        raise HTTPException(404, "ไม่พบ Scheduled Report")
    sr.is_active = not sr.is_active
    db.commit(); db.refresh(sr)
    return sr
