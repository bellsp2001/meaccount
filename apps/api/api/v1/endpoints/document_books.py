from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID

from core.database import get_db
from core.deps import get_current_user, require_accountant_up
from models.user import User
from models.accounting import BookSide
from schemas.accounting import DocumentBookCreate, DocumentBookUpdate, DocumentBookResponse
from services.document_books import (
    get_document_books, create_document_book, update_document_book, delete_document_book,
)

router = APIRouter(prefix="/document-books", tags=["Document Books"])


@router.get("/", response_model=List[DocumentBookResponse])
def list_document_books(side: Optional[BookSide] = None,
                        current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_document_books(db, side)


@router.post("/", response_model=DocumentBookResponse)
def create_document_book_ep(payload: DocumentBookCreate,
                            current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return create_document_book(db, payload)


@router.patch("/{book_id}", response_model=DocumentBookResponse)
def update_document_book_ep(book_id: UUID, payload: DocumentBookUpdate,
                            current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return update_document_book(db, book_id, payload)


@router.delete("/{book_id}")
def delete_document_book_ep(book_id: UUID,
                            current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    delete_document_book(db, book_id)
    return {"message": "ลบสมุดบันทึกเรียบร้อย"}
