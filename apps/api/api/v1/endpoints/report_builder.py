from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from typing import List
from uuid import UUID
from datetime import date
import io

from core.database import get_db
from core.deps import get_current_user, require_accountant_up
from models.user import User
from models.report import ReportSourceType
from schemas.report_builder import (
    SourceFieldsResponse, CustomReportRequest, CustomReportResponse,
    SavedReportCreate, SavedReportResponse,
    NLReportRequest, NLReportResponse,
    ScheduledReportCreate, ScheduledReportResponse,
)
from services.report_builder import (
    get_source_fields, run_custom_report,
    create_saved_report, get_saved_reports,
    create_scheduled_report, get_scheduled_reports, toggle_scheduled_report,
)
from services.nl_report import generate_nl_report
from services.export import export_to_excel, export_to_pdf, export_pl_to_excel
from services.reports import get_profit_loss

router = APIRouter(prefix="/report-builder", tags=["Report Builder & Export"])


@router.get("/fields/{source_type}", response_model=SourceFieldsResponse)
def get_fields_ep(source_type: ReportSourceType, current_user: User = Depends(get_current_user)):
    return get_source_fields(source_type)


@router.post("/run", response_model=CustomReportResponse)
def run_report_ep(payload: CustomReportRequest,
                  current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return run_custom_report(db, payload)


@router.post("/run/export-excel")
def run_report_excel_ep(payload: CustomReportRequest,
                        current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    result = run_custom_report(db, payload)
    fields = get_source_fields(payload.source_type)
    label_map = {f.key: f.label for f in fields.fields}
    labels = [label_map.get(c, c) for c in payload.columns]

    content = export_to_excel(f"รายงาน {payload.source_type.value}", payload.columns, labels, result.rows)
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": f"attachment; filename=report_{payload.source_type.value}.xlsx"},
    )


@router.post("/run/export-pdf")
def run_report_pdf_ep(payload: CustomReportRequest,
                      current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    result = run_custom_report(db, payload)
    fields = get_source_fields(payload.source_type)
    label_map = {f.key: f.label for f in fields.fields}
    labels = [label_map.get(c, c) for c in payload.columns]

    content = export_to_pdf(f"รายงาน {payload.source_type.value}", f"ทั้งหมด {result.total_rows} รายการ",
                            payload.columns, labels, result.rows)
    return StreamingResponse(
        io.BytesIO(content), media_type="application/pdf",
        headers={"Content-Disposition": f"attachment; filename=report_{payload.source_type.value}.pdf"},
    )


@router.get("/export/profit-loss-excel")
def export_pl_excel_ep(period_from: date = Query(...), period_to: date = Query(...),
                       current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    pl = get_profit_loss(db, period_from, period_to)
    pl_dict = pl.model_dump(mode="json")
    content = export_pl_to_excel(pl_dict)
    return StreamingResponse(
        io.BytesIO(content),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": "attachment; filename=profit_loss.xlsx"},
    )


# ── Saved Reports ──────────────────────────────────────────────
@router.get("/saved", response_model=List[SavedReportResponse])
def list_saved_ep(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_saved_reports(db, current_user.id)

@router.post("/saved", response_model=SavedReportResponse)
def create_saved_ep(payload: SavedReportCreate,
                    current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return create_saved_report(db, payload, current_user.id)


# ── Natural Language Report ────────────────────────────────────
@router.post("/nl-query", response_model=NLReportResponse)
def nl_query_ep(payload: NLReportRequest,
               current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return generate_nl_report(db, payload.question)


# ── Scheduled Reports ────────────────────────────────────────────
@router.get("/scheduled", response_model=List[ScheduledReportResponse])
def list_scheduled_ep(current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return get_scheduled_reports(db)

@router.post("/scheduled", response_model=ScheduledReportResponse)
def create_scheduled_ep(payload: ScheduledReportCreate,
                        current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return create_scheduled_report(db, payload, current_user.id)

@router.post("/scheduled/{sr_id}/toggle", response_model=ScheduledReportResponse)
def toggle_scheduled_ep(sr_id: UUID, current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return toggle_scheduled_report(db, sr_id)
