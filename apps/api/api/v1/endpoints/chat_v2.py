from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List
from uuid import UUID

from core.database import get_db
from core.deps import get_current_user, require_accountant_up
from models.user import User
from schemas.chat_v2 import (
    ChatV2Request, ChatV2Response, ConversationResponse, MessageResponse,
    KnowledgeChunkCreate, KnowledgeChunkResponse,
)
from services.chat_v2 import chat_v2, get_conversations, get_conversation_messages
from services.knowledge_base import create_knowledge_chunk, get_all_chunks, seed_thai_accounting_knowledge, search_knowledge

router = APIRouter(prefix="/chat-v2", tags=["AI Chat 2.0"])


@router.post("/message", response_model=ChatV2Response)
def send_message_ep(payload: ChatV2Request,
                    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return chat_v2(db, payload, current_user.id)


@router.get("/conversations")
def list_conversations_ep(current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_conversations(db, current_user.id)


@router.get("/conversations/{conversation_id}/messages", response_model=List[MessageResponse])
def get_messages_ep(conversation_id: UUID,
                    current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_conversation_messages(db, conversation_id, current_user.id)


# ── Knowledge Base Management ────────────────────────────────
@router.get("/knowledge", response_model=List[KnowledgeChunkResponse])
def list_knowledge_ep(category: str = None,
                      current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_all_chunks(db, category)


@router.post("/knowledge", response_model=KnowledgeChunkResponse)
def create_knowledge_ep(payload: KnowledgeChunkCreate,
                        current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return create_knowledge_chunk(db, payload)


@router.post("/knowledge/seed")
def seed_knowledge_ep(current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    seed_thai_accounting_knowledge(db)
    return {"message": "สร้างฐานความรู้บัญชี-ภาษีไทยเริ่มต้นเรียบร้อย"}


@router.get("/knowledge/search")
def search_knowledge_ep(q: str, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return search_knowledge(db, q)
