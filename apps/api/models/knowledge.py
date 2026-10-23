"""
Knowledge Base Models — Thai Accounting/Tax Law Knowledge Base for RAG,
Conversation memory for multi-turn AI Chat
"""
import enum
from sqlalchemy import Column, String, Text, DateTime, ForeignKey, Integer, JSON
from datetime import datetime
from sqlalchemy.orm import relationship
from core.database import Base
from models.base import UUIDMixin, TimestampMixin, UUIDType


class KnowledgeCategory(str, enum.Enum):
    TAX_LAW      = "tax_law"        # ประมวลรัษฎากร
    ACCOUNTING   = "accounting"     # มาตรฐานบัญชีไทย (TFRS)
    VAT          = "vat"            # ภาษีมูลค่าเพิ่ม
    WHT          = "wht"            # ภาษีหัก ณ ที่จ่าย
    LABOR_LAW    = "labor_law"      # กฎหมายแรงงาน/ประกันสังคม
    GENERAL      = "general"        # ทั่วไป


# ── KnowledgeChunk (แหล่งความรู้สำหรับ RAG) ──────────────────────
class KnowledgeChunk(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "knowledge_chunks"

    category    = Column(String(30), nullable=False, index=True)
    title       = Column(String(255), nullable=False)
    content     = Column(Text, nullable=False)          # เนื้อหาความรู้ (ไทย)
    source      = Column(String(255), nullable=True)    # เช่น "ประมวลรัษฎากร มาตรา 40"
    keywords    = Column(String(500), nullable=True)    # comma-separated สำหรับ keyword search
    is_active   = Column(Integer, default=1)


# ── ChatConversation (multi-turn memory) ─────────────────────────
class ChatConversation(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "chat_conversations"

    user_id   = Column(UUIDType(), ForeignKey("users.id"), nullable=False)
    title     = Column(String(255), nullable=True)   # auto-generated from first message

    messages = relationship("ChatMessage", back_populates="conversation",
                            cascade="all, delete-orphan", lazy="joined",
                            order_by="ChatMessage.created_at")


class ChatMessage(Base, UUIDMixin):
    __tablename__ = "chat_messages"

    conversation_id = Column(UUIDType(), ForeignKey("chat_conversations.id"), nullable=False)
    role             = Column(String(20), nullable=False)   # "user" | "assistant"
    content          = Column(Text, nullable=False)
    sources          = Column(JSON, nullable=True)          # list of {title, source} used in RAG
    sql_query        = Column(Text, nullable=True)           # generated SQL if text-to-sql used
    chart_data       = Column(JSON, nullable=True)           # structured data for chart rendering
    created_at       = Column(DateTime, default=datetime.utcnow, nullable=False)

    conversation = relationship("ChatConversation", back_populates="messages")
