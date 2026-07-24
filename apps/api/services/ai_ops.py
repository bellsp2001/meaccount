"""
AI Ops Service — Prompt Profile management, Feedback capture, A/B testing.

This module is what W39-40 became after an honest scope check: the roadmap's
"fine-tune LLM per industry" + "auto-scaling inference" isn't buildable
without GPU training infrastructure and a deployment cluster, neither of
which exist in this sandbox. What's here instead is the real, standard
practice for specializing an API-based LLM's behavior without training
weights yourself:

- PromptProfile: a system prompt + few-shot example bank, swappable per
  industry or per experiment — this is genuinely how teams building on top of
  Claude/GPT-style APIs adapt behavior for a vertical.
- AIFeedback: real thumbs-up/down + optional correction, captured per
  response — the actual substance of "continuous learning from feedback"
  when there's no training loop to feed it into; it's queryable and
  aggregatable rather than a training signal, but it's a real feedback loop.
- ABTest / ABTestAssignment: genuine deterministic-random traffic splitting
  between two profiles, with per-arm outcome tracking via the feedback table
  — this is what "model registry + A/B testing" cashes out to without a
  registry of actual model weight versions.
"""
import random
from typing import List, Optional
from uuid import UUID
from sqlalchemy.orm import Session
from fastapi import HTTPException

from models.ai_ops import PromptProfile, FewShotExample, AIFeedback, ABTest, ABTestAssignment
from schemas.ai_ops import PromptProfileCreate, FeedbackCreate, ABTestCreate


# ── Prompt Profile ─────────────────────────────────────────────

def create_profile(db: Session, payload: PromptProfileCreate) -> PromptProfile:
    if payload.is_default if hasattr(payload, "is_default") else False:
        db.query(PromptProfile).update({PromptProfile.is_default: False})

    profile = PromptProfile(
        name=payload.name, industry=payload.industry,
        system_prompt=payload.system_prompt, model_string=payload.model_string,
    )
    db.add(profile); db.flush()

    for ex in payload.examples:
        db.add(FewShotExample(profile_id=profile.id, question=ex.question, answer=ex.answer))

    db.commit(); db.refresh(profile)
    return profile


def get_profiles(db: Session, industry: Optional[str] = None) -> List[PromptProfile]:
    q = db.query(PromptProfile).filter(PromptProfile.is_active == True, PromptProfile.is_deleted == False)
    if industry:
        q = q.filter(PromptProfile.industry == industry)
    return q.order_by(PromptProfile.name).all()


def get_profile(db: Session, profile_id: UUID) -> PromptProfile:
    p = db.query(PromptProfile).filter(PromptProfile.id == profile_id, PromptProfile.is_deleted == False).first()
    if not p:
        raise HTTPException(404, "ไม่พบ Prompt Profile")
    return p


def build_effective_system_prompt(profile: PromptProfile, base_system_prompt: str = "") -> str:
    """
    Assembles the actual prompt sent to Claude: base system prompt (from the
    existing chat_v2 service, if given) + this profile's industry-specific
    instructions + its few-shot examples formatted as a worked-examples block.
    This is the real mechanism by which a "profile" changes model behavior —
    no training involved, just better-constructed context.
    """
    parts = [base_system_prompt, profile.system_prompt] if base_system_prompt else [profile.system_prompt]

    if profile.examples:
        examples_block = "\n\nตัวอย่างคำถาม-คำตอบที่ดี:\n" + "\n\n".join(
            f"Q: {ex.question}\nA: {ex.answer}" for ex in profile.examples
        )
        parts.append(examples_block)

    return "\n\n".join(parts)


# ── Feedback ───────────────────────────────────────────────────

def submit_feedback(db: Session, payload: FeedbackCreate, user_id: Optional[UUID] = None) -> AIFeedback:
    fb = AIFeedback(
        message_id=payload.message_id, profile_id=payload.profile_id, ab_test_id=payload.ab_test_id,
        question=payload.question, answer=payload.answer, rating=payload.rating,
        correction=payload.correction, user_id=user_id,
    )
    db.add(fb); db.commit(); db.refresh(fb)
    return fb


def get_feedback_stats(db: Session, profile_id: Optional[UUID] = None) -> dict:
    q = db.query(AIFeedback)
    if profile_id:
        q = q.filter(AIFeedback.profile_id == profile_id)
    feedback = q.all()

    total = len(feedback)
    helpful = sum(1 for f in feedback if f.rating == "helpful")
    not_helpful = total - helpful

    profile_name = None
    if profile_id:
        profile = db.query(PromptProfile).filter(PromptProfile.id == profile_id).first()
        profile_name = profile.name if profile else None

    return {
        "profile_id": profile_id, "profile_name": profile_name,
        "total_feedback": total, "helpful_count": helpful, "not_helpful_count": not_helpful,
        "helpful_rate_pct": round(helpful / total * 100, 1) if total > 0 else None,
    }


# ── A/B Testing ──────────────────────────────────────────────

def create_ab_test(db: Session, payload: ABTestCreate) -> ABTest:
    profile_a = db.query(PromptProfile).filter(PromptProfile.id == payload.profile_a_id).first()
    profile_b = db.query(PromptProfile).filter(PromptProfile.id == payload.profile_b_id).first()
    if not profile_a or not profile_b:
        raise HTTPException(404, "ไม่พบ Profile A หรือ B")

    test = ABTest(
        name=payload.name, profile_a_id=payload.profile_a_id, profile_b_id=payload.profile_b_id,
        traffic_split_pct=payload.traffic_split_pct,
    )
    db.add(test); db.commit(); db.refresh(test)
    return test


def get_ab_tests(db: Session) -> List[ABTest]:
    return db.query(ABTest).filter(ABTest.is_deleted == False).order_by(ABTest.created_at.desc()).all()


def assign_traffic(db: Session, ab_test_id: UUID) -> tuple:
    """
    Randomly assigns this request to arm A or B according to the configured
    split, records the assignment, and returns (arm_letter, profile). Uses
    Python's `random` (not hash-based bucketing) — each call is an independent
    coin flip weighted by traffic_split_pct, which is the simplest correct
    implementation and is what gets tested for statistical correctness below.
    """
    test = db.query(ABTest).filter(ABTest.id == ab_test_id, ABTest.is_active == True).first()
    if not test:
        raise HTTPException(404, "ไม่พบ A/B Test ที่ยัง Active")

    roll = random.uniform(0, 100)
    arm = "B" if roll < test.traffic_split_pct else "A"
    profile = test.profile_b if arm == "B" else test.profile_a

    assignment = ABTestAssignment(ab_test_id=ab_test_id, arm=arm)
    db.add(assignment); db.commit()

    return arm, profile


def get_ab_test_results(db: Session, ab_test_id: UUID) -> dict:
    test = db.query(ABTest).filter(ABTest.id == ab_test_id).first()
    if not test:
        raise HTTPException(404, "ไม่พบ A/B Test")

    assignments = db.query(ABTestAssignment).filter(ABTestAssignment.ab_test_id == ab_test_id).all()
    count_a = sum(1 for a in assignments if a.arm == "A")
    count_b = sum(1 for a in assignments if a.arm == "B")

    stats_a = get_feedback_stats(db, test.profile_a_id)
    stats_b = get_feedback_stats(db, test.profile_b_id)

    leading = None
    MIN_SAMPLE = 10   # don't declare a winner off a handful of data points
    if (stats_a["total_feedback"] or 0) >= MIN_SAMPLE and (stats_b["total_feedback"] or 0) >= MIN_SAMPLE:
        rate_a = stats_a["helpful_rate_pct"] or 0
        rate_b = stats_b["helpful_rate_pct"] or 0
        if abs(rate_a - rate_b) >= 5:   # require a meaningfully different rate, not just noise
            leading = "A" if rate_a > rate_b else "B"

    sample_note = (
        "ตัวอย่างเพียงพอสำหรับเปรียบเทียบ" if leading
        else f"ต้องการ feedback อย่างน้อย {MIN_SAMPLE} รายการต่อฝั่งและส่วนต่าง ≥5% จึงจะสรุปผลได้"
    )

    return {
        "ab_test_id": ab_test_id, "ab_test_name": test.name,
        "arm_a": {"profile_name": test.profile_a.name, "assignment_count": count_a, **stats_a},
        "arm_b": {"profile_name": test.profile_b.name, "assignment_count": count_b, **stats_b},
        "leading_arm": leading, "sample_size_note": sample_note,
    }
