from fastapi import APIRouter, Depends, UploadFile, File, Query
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID
import base64, os, uuid as uuid_lib

from core.database import get_db
from core.deps import get_current_user, require_accountant_up
from models.user import User
from schemas.document import (
    DocumentResponse, DocumentClassifyResponse, DocumentExtractResponse,
    LinkDocumentRequest, ReviewDocumentRequest,
    MatchRecordResponse, RunThreeWayMatchRequest, ResolveMatchRequest,
)
from services.document_ai import (
    create_document, get_documents, get_document,
    classify_document, extract_document_data, review_document, link_document,
)
from services.three_way_match import run_three_way_match, get_match_records, resolve_match

router = APIRouter(prefix="/documents", tags=["Document AI & Smart OCR"])

UPLOAD_DIR = "/tmp/meaccount_documents"
os.makedirs(UPLOAD_DIR, exist_ok=True)


def _doc_to_response(doc) -> DocumentResponse:
    import json
    r = DocumentResponse.model_validate(doc)
    if doc.extracted_data:
        try:
            r.extracted_data = json.loads(doc.extracted_data)
        except Exception:
            r.extracted_data = None
    return r


@router.get("/", response_model=List[DocumentResponse])
def list_documents_ep(status: Optional[str] = None, document_type: Optional[str] = None,
                      current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    docs = get_documents(db, status, document_type)
    return [_doc_to_response(d) for d in docs]


@router.post("/upload", response_model=DocumentResponse)
async def upload_document_ep(file: UploadFile = File(...),
                             current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    content = await file.read()
    safe_name = f"{uuid_lib.uuid4()}_{file.filename}"
    path = os.path.join(UPLOAD_DIR, safe_name)
    with open(path, "wb") as f:
        f.write(content)

    doc = create_document(db, file.filename, path, file.content_type or "application/octet-stream",
                          len(content), current_user.id)
    return _doc_to_response(doc)


@router.get("/{doc_id}", response_model=DocumentResponse)
def get_document_ep(doc_id: UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return _doc_to_response(get_document(db, doc_id))


@router.post("/{doc_id}/classify", response_model=DocumentClassifyResponse)
def classify_document_ep(doc_id: UUID, current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    doc = get_document(db, doc_id)
    with open(doc.storage_path, "rb") as f:
        image_b64 = base64.b64encode(f.read()).decode()
    return classify_document(db, doc_id, image_b64, doc.mime_type or "image/jpeg")


@router.post("/{doc_id}/extract", response_model=DocumentExtractResponse)
def extract_document_ep(doc_id: UUID, current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    doc = get_document(db, doc_id)
    with open(doc.storage_path, "rb") as f:
        image_b64 = base64.b64encode(f.read()).decode()
    return extract_document_data(db, doc_id, image_b64, doc.mime_type or "image/jpeg")


@router.post("/{doc_id}/review", response_model=DocumentResponse)
def review_document_ep(doc_id: UUID, payload: ReviewDocumentRequest,
                       current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    doc = review_document(db, doc_id, payload.approved, payload.note, current_user.id)
    return _doc_to_response(doc)


@router.post("/{doc_id}/link", response_model=DocumentResponse)
def link_document_ep(doc_id: UUID, payload: LinkDocumentRequest,
                     current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    doc = link_document(db, doc_id, payload.reference_type, payload.reference_id)
    return _doc_to_response(doc)


# ── 3-Way Match ─────────────────────────────────────────────
@router.post("/match/run", response_model=MatchRecordResponse)
def run_match_ep(payload: RunThreeWayMatchRequest,
                 current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return run_three_way_match(db, payload.bill_id)


@router.get("/match/records", response_model=List[MatchRecordResponse])
def list_match_records_ep(status: Optional[str] = None,
                          current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_match_records(db, status)


@router.post("/match/{match_id}/resolve", response_model=MatchRecordResponse)
def resolve_match_ep(match_id: UUID, payload: ResolveMatchRequest,
                     current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return resolve_match(db, match_id, payload.note, current_user.id)
