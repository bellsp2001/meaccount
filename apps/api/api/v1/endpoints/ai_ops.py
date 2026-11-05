from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from typing import List, Optional
from uuid import UUID

from core.database import get_db
from core.deps import get_current_user, require_admin, require_accountant_up
from models.user import User
from schemas.ai_ops import (
    PromptProfileCreate, PromptProfileResponse,
    FeedbackCreate, FeedbackResponse, FeedbackStatsResponse,
    ABTestCreate, ABTestResponse, ABTestResultsResponse,
)
from services.ai_ops import (
    create_profile, get_profiles, get_profile,
    submit_feedback, get_feedback_stats,
    create_ab_test, get_ab_tests, assign_traffic, get_ab_test_results,
)

router = APIRouter(prefix="/ai-ops", tags=["AI Ops (Prompt Profiles, Feedback, A/B Testing)"])


# ── Prompt Profiles ────────────────────────────────────────────
@router.post("/profiles", response_model=PromptProfileResponse)
def create_profile_ep(payload: PromptProfileCreate, current_user: User = Depends(require_admin), db: Session = Depends(get_db)):
    return create_profile(db, payload)


@router.get("/profiles", response_model=List[PromptProfileResponse])
def list_profiles_ep(industry: Optional[str] = None, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_profiles(db, industry)


@router.get("/profiles/{profile_id}", response_model=PromptProfileResponse)
def get_profile_ep(profile_id: UUID, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return get_profile(db, profile_id)


# ── Feedback ───────────────────────────────────────────────────
@router.post("/feedback", response_model=FeedbackResponse)
def submit_feedback_ep(payload: FeedbackCreate, current_user: User = Depends(get_current_user), db: Session = Depends(get_db)):
    return submit_feedback(db, payload, current_user.id)


@router.get("/feedback/stats", response_model=FeedbackStatsResponse)
def feedback_stats_ep(profile_id: Optional[UUID] = None,
                      current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return get_feedback_stats(db, profile_id)


# ── A/B Testing ────────────────────────────────────────────────
@router.post("/ab-tests", response_model=ABTestResponse)
def create_ab_test_ep(payload: ABTestCreate, current_user: User = Depends(require_admin), db: Session = Depends(get_db)):
    return create_ab_test(db, payload)


@router.get("/ab-tests", response_model=List[ABTestResponse])
def list_ab_tests_ep(current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return get_ab_tests(db)


@router.get("/ab-tests/{ab_test_id}/results", response_model=ABTestResultsResponse)
def ab_test_results_ep(ab_test_id: UUID, current_user: User = Depends(require_accountant_up), db: Session = Depends(get_db)):
    return get_ab_test_results(db, ab_test_id)
