from pydantic import BaseModel
from typing import Optional, List, Dict, Any
from uuid import UUID
from datetime import datetime


# ── Knowledge Base ─────────────────────────────────────────────
class KnowledgeChunkCreate(BaseModel):
    category: str
    title:    str
    content:  str
    source:   Optional[str] = None
    keywords: Optional[str] = None


class KnowledgeChunkResponse(BaseModel):
    id:       UUID
    category: str
    title:    str
    content:  str
    source:   Optional[str]
    keywords: Optional[str]
    model_config = {"from_attributes": True}


class KnowledgeSearchResult(BaseModel):
    chunk:     KnowledgeChunkResponse
    relevance: float


# ── Conversations ──────────────────────────────────────────────
class ConversationCreate(BaseModel):
    title: Optional[str] = None


class ConversationResponse(BaseModel):
    id:         UUID
    title:      Optional[str]
    created_at: datetime
    message_count: Optional[int] = 0
    model_config = {"from_attributes": True}


# ── Chat Messages ──────────────────────────────────────────────
class ChatV2Request(BaseModel):
    conversation_id: Optional[UUID] = None   # None → create new conversation
    message:          str


class SourceRef(BaseModel):
    title:  str
    source: Optional[str] = None


class ChatV2Response(BaseModel):
    conversation_id: UUID
    message_id:       UUID
    role:              str
    content:           str
    sources:            List[SourceRef] = []
    sql_query:           Optional[str] = None
    chart_data:           Optional[Dict[str, Any]] = None


class MessageResponse(BaseModel):
    id:          UUID
    role:        str
    content:     str
    sources:     Optional[List[dict]] = None
    sql_query:   Optional[str] = None
    chart_data:  Optional[dict] = None
    created_at:  datetime
    model_config = {"from_attributes": True}
