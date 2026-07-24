"""
AI Ops Models: PromptProfile, FewShotExample, AIFeedback, ModelRegistryEntry, ABTestAssignment

Design note: this replaces the roadmap's "fine-tuned LLM per industry" with
what's actually buildable without training infrastructure — a system-prompt +
few-shot-example profile per industry, a real feedback capture loop, and a
registry that supports genuine A/B testing between two profiles/models. See
services/ai_ops.py module docstring for the full reasoning.
"""
import enum
from sqlalchemy import Column, String, Text, Boolean, ForeignKey, DateTime, Integer, JSON
from datetime import datetime
from sqlalchemy.orm import relationship
from core.database import Base
from models.base import UUIDMixin, TimestampMixin, UUIDType


class IndustryType(str, enum.Enum):
    GENERAL  = "general"
    RETAIL   = "retail"
    SERVICE  = "service"
    MANUFACTURING = "manufacturing"


class FeedbackRating(str, enum.Enum):
    HELPFUL     = "helpful"
    NOT_HELPFUL = "not_helpful"


# ── PromptProfile ──────────────────────────────────────────────
class PromptProfile(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "prompt_profiles"

    name          = Column(String(200), nullable=False)
    industry      = Column(String(30),  default=IndustryType.GENERAL.value, nullable=False)
    system_prompt = Column(Text,        nullable=False)
    model_string  = Column(String(100), default="claude-sonnet-4-20250514", nullable=False)
    is_active     = Column(Boolean,     default=True)
    is_default    = Column(Boolean,     default=False)

    examples = relationship("FewShotExample", back_populates="profile",
                            cascade="all, delete-orphan", lazy="joined")


class FewShotExample(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "few_shot_examples"

    profile_id = Column(UUIDType(), ForeignKey("prompt_profiles.id"), nullable=False)
    question   = Column(Text, nullable=False)
    answer     = Column(Text, nullable=False)

    profile = relationship("PromptProfile", back_populates="examples")


# ── AIFeedback (the actual substance of "continuous learning") ─
class AIFeedback(Base, UUIDMixin):
    __tablename__ = "ai_feedback"

    message_id   = Column(UUIDType(), nullable=True)   # references ChatMessage.id from chat_v2, loosely (no FK — chat messages can be deleted independently)
    profile_id   = Column(UUIDType(), ForeignKey("prompt_profiles.id"), nullable=True)
    ab_test_id   = Column(UUIDType(), ForeignKey("ab_tests.id"), nullable=True)

    question     = Column(Text, nullable=False)
    answer       = Column(Text, nullable=False)
    rating       = Column(String(20), nullable=False)   # FeedbackRating
    correction   = Column(Text, nullable=True)   # user-supplied "the right answer would have been..."
    user_id      = Column(UUIDType(), ForeignKey("users.id"), nullable=True)
    created_at   = Column(DateTime, default=datetime.utcnow, nullable=False)

    profile = relationship("PromptProfile")


# ── A/B Test (the "model registry" substance) ───────────────────
class ABTest(Base, UUIDMixin, TimestampMixin):
    __tablename__ = "ab_tests"

    name           = Column(String(200), nullable=False)
    profile_a_id   = Column(UUIDType(), ForeignKey("prompt_profiles.id"), nullable=False)
    profile_b_id   = Column(UUIDType(), ForeignKey("prompt_profiles.id"), nullable=False)
    traffic_split_pct = Column(Integer, default=50, nullable=False)   # % of traffic to profile_b
    is_active      = Column(Boolean, default=True)

    profile_a = relationship("PromptProfile", foreign_keys=[profile_a_id])
    profile_b = relationship("PromptProfile", foreign_keys=[profile_b_id])
    assignments = relationship("ABTestAssignment", back_populates="ab_test", lazy="dynamic")


class ABTestAssignment(Base, UUIDMixin):
    """One row per request routed through an active A/B test — records which
    arm (A or B) handled it, so feedback can later be grouped by arm."""
    __tablename__ = "ab_test_assignments"

    ab_test_id = Column(UUIDType(), ForeignKey("ab_tests.id"), nullable=False)
    arm        = Column(String(1), nullable=False)   # "A" or "B"
    created_at = Column(DateTime, default=datetime.utcnow, nullable=False)

    ab_test = relationship("ABTest", back_populates="assignments")
