"""
AI Chat 2.0 Service — RAG + Text-to-SQL + Conversation Memory
"""
import json
from typing import List, Optional
from uuid import UUID
from datetime import date
from sqlalchemy.orm import Session
from anthropic import Anthropic
from fastapi import HTTPException

from core.config import settings
from models.knowledge import ChatConversation, ChatMessage
from services.dashboard import get_kpi
from services.knowledge_base import search_knowledge
from services.text_to_sql import select_query_template, execute_query_template, QUERY_TEMPLATES
from schemas.chat_v2 import ChatV2Request, ChatV2Response, SourceRef, ConversationResponse

_client: Optional[Anthropic] = None

def get_client() -> Optional[Anthropic]:
    global _client
    if not settings.ANTHROPIC_API_KEY:
        return None
    if not _client:
        _client = Anthropic(api_key=settings.ANTHROPIC_API_KEY)
    return _client


SYSTEM_PROMPT_V2 = """คุณเป็น "มีบัญชี AI" ผู้ช่วยบัญชีอัจฉริยะของ MeAccount เวอร์ชัน 2.0
คุณมีความสามารถพิเศษ:
1. เข้าถึงฐานความรู้กฎหมายบัญชี-ภาษีไทย (RAG) — ใช้ข้อมูลที่ retrieved มาอ้างอิงคำตอบ
2. เข้าถึงข้อมูลจริงในระบบผ่าน Query Templates ที่ปลอดภัย
3. จดจำบริบทการสนทนาข้ามข้อความได้ (conversation memory)

กฎการตอบ:
- ตอบภาษาไทย กระชับ ชัดเจน ใช้ตัวหนาสำหรับคำสำคัญ
- ถ้ามีข้อมูลจาก Knowledge Base ให้อ้างอิงแหล่งที่มา (เช่น "ตามประมวลรัษฎากร มาตรา...")
- ถ้ามีข้อมูลจากระบบ (query result) ให้สรุปเป็นภาษาที่เข้าใจง่าย พร้อมตัวเลขที่ถูกต้อง
- ไม่มั่นใจให้บอกว่าไม่แน่ใจ ไม่เดา"""


def get_or_create_conversation(db: Session, conversation_id: Optional[UUID], user_id: UUID) -> ChatConversation:
    if conversation_id:
        conv = db.query(ChatConversation).filter(
            ChatConversation.id == conversation_id, ChatConversation.user_id == user_id,
        ).first()
        if not conv:
            raise HTTPException(404, "ไม่พบบทสนทนา")
        return conv
    conv = ChatConversation(user_id=user_id)
    db.add(conv); db.commit(); db.refresh(conv)
    return conv


def chat_v2(db: Session, payload: ChatV2Request, user_id: UUID) -> ChatV2Response:
    conv = get_or_create_conversation(db, payload.conversation_id, user_id)

    # Save user message
    user_msg = ChatMessage(conversation_id=conv.id, role="user", content=payload.message)
    db.add(user_msg); db.commit(); db.refresh(user_msg)

    # Auto-title conversation from first message
    if not conv.title:
        conv.title = payload.message[:50]
        db.commit()

    # ── Step 1: RAG — retrieve relevant knowledge ──
    kb_results = search_knowledge(db, payload.message, top_k=3)
    kb_context = ""
    sources: List[SourceRef] = []
    if kb_results:
        kb_context = "\n\nความรู้ที่เกี่ยวข้อง:\n" + "\n".join(
            f"- {r.chunk.title}: {r.chunk.content}" for r in kb_results if r.relevance > 0.15
        )
        sources = [SourceRef(title=r.chunk.title, source=r.chunk.source) for r in kb_results if r.relevance > 0.15]

    # ── Step 2: Text-to-SQL — check if question needs live data ──
    template, params, reasoning = select_query_template(payload.message)
    sql_context = ""
    chart_data = None
    sql_query_display = None
    if template and template in QUERY_TEMPLATES:
        query_result = execute_query_template(db, template, params)
        sql_context = f"\n\nข้อมูลจากระบบ ({QUERY_TEMPLATES[template]}):\n{json.dumps(query_result['data'], ensure_ascii=False, default=str)}"
        chart_data = query_result
        sql_query_display = f"[Template: {template}] params={params}"

    # ── Step 3: General KPI context (always included, lightweight) ──
    try:
        kpi = get_kpi(db)
        kpi_context = (
            f"\n\nสรุประบบวันนี้: รายได้เดือนนี้ ฿{kpi['revenue']['amount']:,.2f}, "
            f"เงินสด ฿{kpi['cash_balance']['amount']:,.2f}"
        )
    except Exception:
        kpi_context = ""

    # ── Step 4: Build conversation history for multi-turn memory ──
    history_messages = db.query(ChatMessage).filter(
        ChatMessage.conversation_id == conv.id,
    ).order_by(ChatMessage.created_at).all()
    history = [{"role": m.role, "content": m.content} for m in history_messages[-10:]]

    # ── Step 5: Generate response ──
    client = get_client()
    full_context = SYSTEM_PROMPT_V2 + kb_context + sql_context + kpi_context

    if not client:
        answer = "⚠️ ยังไม่ได้ตั้งค่า ANTHROPIC_API_KEY — กรุณาเพิ่ม API Key ใน .env"
        if kb_results:
            top = kb_results[0].chunk
            answer = f"{top.content}\n\n(อ้างอิง: {top.source})"
    else:
        try:
            resp = client.messages.create(
                model=settings.AI_MODEL, max_tokens=1500,
                system=full_context, messages=history,
            )
            answer = resp.content[0].text
        except Exception as e:
            answer = f"⚠️ เกิดข้อผิดพลาด: {str(e)}"

    # Save assistant message
    assistant_msg = ChatMessage(
        conversation_id=conv.id, role="assistant", content=answer,
        sources=[s.model_dump() for s in sources] if sources else None,
        sql_query=sql_query_display, chart_data=chart_data,
    )
    db.add(assistant_msg); db.commit(); db.refresh(assistant_msg)

    return ChatV2Response(
        conversation_id=conv.id, message_id=assistant_msg.id,
        role="assistant", content=answer, sources=sources,
        sql_query=sql_query_display, chart_data=chart_data,
    )


def get_conversations(db: Session, user_id: UUID) -> List[dict]:
    convs = db.query(ChatConversation).filter(
        ChatConversation.user_id == user_id, ChatConversation.is_deleted == False,
    ).order_by(ChatConversation.created_at.desc()).all()
    return [
        {"id": c.id, "title": c.title, "created_at": c.created_at, "message_count": len(c.messages)}
        for c in convs
    ]


def get_conversation_messages(db: Session, conversation_id: UUID, user_id: UUID) -> List[ChatMessage]:
    conv = db.query(ChatConversation).filter(
        ChatConversation.id == conversation_id, ChatConversation.user_id == user_id,
    ).first()
    if not conv:
        raise HTTPException(404, "ไม่พบบทสนทนา")
    return conv.messages
