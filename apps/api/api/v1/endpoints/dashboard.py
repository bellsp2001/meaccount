from fastapi import APIRouter, Depends, Query
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional

from core.database import get_db
from core.deps import get_current_user
from models.user import User
from services.dashboard import (
    get_kpi, get_revenue_expense_chart,
    get_cash_flow_chart, get_expense_breakdown, get_alerts,
)
from services.ai_chat import chat, stream_chat, QUICK_REPLIES

router = APIRouter(prefix="/dashboard", tags=["Dashboard & AI Chat"])


@router.get("/kpi")
def dashboard_kpi(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_kpi(db)


@router.get("/charts/revenue-expense")
def revenue_expense_chart(
    months: int = Query(6, ge=2, le=12),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return get_revenue_expense_chart(db, months)


@router.get("/charts/cash-flow")
def cash_flow_chart(
    days: int = Query(30, ge=7, le=90),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    return get_cash_flow_chart(db, days)


@router.get("/charts/expense-breakdown")
def expense_breakdown(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_expense_breakdown(db)


@router.get("/alerts")
def dashboard_alerts(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_alerts(db)


# ── AI Chat ─────────────────────────────────────────────────────
class ChatMessage(BaseModel):
    role:    str
    content: str

class ChatRequest(BaseModel):
    message:  str
    history:  List[ChatMessage] = []
    stream:   bool = False


@router.post("/ai-chat")
def ai_chat(
    payload: ChatRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """AI Chat — Non-streaming"""
    history = [{"role": m.role, "content": m.content} for m in payload.history]
    return chat(db, history, payload.message)


@router.post("/ai-chat/stream")
def ai_chat_stream(
    payload: ChatRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """AI Chat — SSE Streaming"""
    history = [{"role": m.role, "content": m.content} for m in payload.history]
    return StreamingResponse(
        stream_chat(db, history, payload.message),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@router.get("/ai-chat/suggestions")
def chat_suggestions():
    return {"suggestions": QUICK_REPLIES}
