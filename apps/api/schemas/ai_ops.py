from pydantic import BaseModel, field_validator
from typing import Optional, List
from uuid import UUID
from datetime import datetime


# ── Prompt Profile ─────────────────────────────────────────────
class FewShotExampleCreate(BaseModel):
    question: str
    answer:   str


class PromptProfileCreate(BaseModel):
    name:          str
    industry:      str = "general"
    system_prompt: str
    model_string:  str = "claude-sonnet-4-20250514"
    examples:      List[FewShotExampleCreate] = []

    @field_validator("industry")
    @classmethod
    def valid_industry(cls, v):
        valid = {"general", "retail", "service", "manufacturing"}
        if v not in valid:
            raise ValueError(f"industry ต้องเป็นหนึ่งใน {valid}")
        return v


class FewShotExampleResponse(BaseModel):
    id:       UUID
    question: str
    answer:   str
    model_config = {"from_attributes": True}


class PromptProfileResponse(BaseModel):
    id:            UUID
    name:          str
    industry:      str
    system_prompt: str
    model_string:  str
    is_active:     bool
    is_default:    bool
    examples:      List[FewShotExampleResponse] = []
    model_config = {"from_attributes": True}


# ── Feedback ───────────────────────────────────────────────────
class FeedbackCreate(BaseModel):
    message_id: Optional[UUID] = None
    profile_id: Optional[UUID] = None
    ab_test_id: Optional[UUID] = None
    question:   str
    answer:     str
    rating:     str    # "helpful" | "not_helpful"
    correction: Optional[str] = None

    @field_validator("rating")
    @classmethod
    def valid_rating(cls, v):
        if v not in ("helpful", "not_helpful"):
            raise ValueError("rating ต้องเป็น helpful หรือ not_helpful")
        return v


class FeedbackResponse(BaseModel):
    id:         UUID
    question:   str
    answer:     str
    rating:     str
    correction: Optional[str]
    created_at: datetime
    model_config = {"from_attributes": True}


class FeedbackStatsResponse(BaseModel):
    profile_id:      Optional[UUID]
    profile_name:    Optional[str]
    total_feedback:  int
    helpful_count:   int
    not_helpful_count: int
    helpful_rate_pct:   Optional[float]


# ── A/B Test ───────────────────────────────────────────────────
class ABTestCreate(BaseModel):
    name:              str
    profile_a_id:      UUID
    profile_b_id:      UUID
    traffic_split_pct: int = 50

    @field_validator("traffic_split_pct")
    @classmethod
    def valid_split(cls, v):
        if not 0 <= v <= 100:
            raise ValueError("traffic_split_pct ต้องอยู่ระหว่าง 0-100")
        return v

    @field_validator("profile_b_id")
    @classmethod
    def different_profiles(cls, v, info):
        if "profile_a_id" in info.data and v == info.data["profile_a_id"]:
            raise ValueError("profile_a และ profile_b ต้องไม่ใช่ profile เดียวกัน")
        return v


class ABTestResponse(BaseModel):
    id:                UUID
    name:              str
    profile_a_id:      UUID
    profile_b_id:      UUID
    traffic_split_pct: int
    is_active:         bool
    model_config = {"from_attributes": True}


class ABTestResultsResponse(BaseModel):
    ab_test_id:       UUID
    ab_test_name:     str
    arm_a: dict   # {profile_name, assignment_count, helpful_rate_pct}
    arm_b: dict
    leading_arm:      Optional[str]   # "A" | "B" | None if inconclusive
    sample_size_note:  str
