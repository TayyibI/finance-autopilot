"""
Core typed models for the Finance Autopilot pipeline.
Pydantic enforces strict validation so LLM outputs are always structured data,
never raw strings passed downstream.

v3: Added xai_reasoning fields to BaseModeler, Critic, UpsideModeler outputs
    so the chain-of-thought is captured, validated, and surfaced to the UI.
"""

from pydantic import BaseModel, Field, field_validator
from typing import Literal
from datetime import datetime


# ─── Financial Model ─────────────────────────────────────────────────────────

class YearProjection(BaseModel):
    year: int
    revenue_bn: float = Field(..., description="Revenue in billions USD")
    operating_margin_pct: float = Field(..., description="Operating margin as percentage e.g. 15.2")
    net_income_bn: float = Field(..., description="Net income in billions USD")

    @field_validator("operating_margin_pct")
    @classmethod
    def margin_must_be_reasonable(cls, v: float) -> float:
        if not -100 <= v <= 100:
            raise ValueError("Operating margin must be between -100% and 100%")
        return round(v, 2)

    @field_validator("revenue_bn", "net_income_bn")
    @classmethod
    def round_financials(cls, v: float) -> float:
        return round(v, 3)


class ScenarioModel(BaseModel):
    scenario: Literal["base", "upside", "downside"]
    projections: list[YearProjection]
    key_assumptions: list[str] = Field(..., min_length=1, max_length=10)
    narrative: str


class FinancialModel(BaseModel):
    ticker: str
    company_name: str
    generated_at: datetime = Field(default_factory=datetime.utcnow)
    historical: list[YearProjection]
    base: ScenarioModel
    upside: ScenarioModel
    downside: ScenarioModel


# ─── Agent Outputs ────────────────────────────────────────────────────────────

class ResearcherOutput(BaseModel):
    company_name: str
    sector: str
    recent_headlines: list[str] = Field(..., max_length=5)
    identified_risks: list[str] = Field(..., max_length=4)
    identified_tailwinds: list[str] = Field(..., max_length=4)
    summary: str


class XAIStep(BaseModel):
    """A single numbered step in an agent's chain-of-thought reasoning."""
    step: int
    description: str = Field(..., description="What this step is doing e.g. 'Compute 3-year revenue CAGR'")
    calculation: str = Field(..., description="The actual math or logic e.g. '($383.3B / $365.8B)^(1/2) - 1 = 2.36%'")
    result: str = Field(..., description="What this step produces e.g. 'Base CAGR = 2.36%'")


class BaseModelerOutput(BaseModel):
    xai_reasoning: list[XAIStep] = Field(
        ...,
        description="Step-by-step mathematical chain of thought showing how each projection was derived",
        min_length=3,
    )
    projections: list[YearProjection]
    methodology: str
    key_assumptions: list[str]


class CriticOutput(BaseModel):
    xai_reasoning: list[XAIStep] = Field(
        ...,
        description="Step-by-step reasoning showing how each risk translates into a specific numerical adjustment",
        min_length=3,
    )
    challenged_assumptions: list[str]
    risk_drivers: list[str]
    revenue_adjustment_pct: float = Field(..., description="Negative number e.g. -4.5 means 4.5% lower growth")
    margin_adjustment_pct: float
    downside_projections: list[YearProjection]
    critique_summary: str

    @field_validator("revenue_adjustment_pct")
    @classmethod
    def must_be_negative_or_zero(cls, v: float) -> float:
        if v > 0:
            raise ValueError("Critic revenue adjustment must be zero or negative")
        return round(v, 2)


class UpsideModelerOutput(BaseModel):
    xai_reasoning: list[XAIStep] = Field(
        ...,
        description="Step-by-step reasoning showing how each growth catalyst translates into specific upside numbers",
        min_length=3,
    )
    upside_drivers: list[str]
    revenue_adjustment_pct: float = Field(..., description="Positive number e.g. 5.0 means 5% higher growth")
    margin_adjustment_pct: float
    upside_projections: list[YearProjection]
    bull_case_summary: str

    @field_validator("revenue_adjustment_pct")
    @classmethod
    def must_be_positive_or_zero(cls, v: float) -> float:
        if v < 0:
            raise ValueError("Upside adjustment must be zero or positive")
        return round(v, 2)


class BreakingPoint(BaseModel):
    variable: str
    threshold: str
    consequence: str
    current_value: str
    distance_from_break: str


class AdvisorOutput(BaseModel):
    strategic_options: list[str] = Field(..., min_length=2, max_length=4)
    recommended_option: str
    rationale: str
    key_risks: list[str]
    red_flags: list[str]
    tough_questions: list[str] = Field(..., min_length=3, max_length=6)
    executive_memo: str
    breaking_point: BreakingPoint


# ─── Interrogation Chat ───────────────────────────────────────────────────────

class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str


class InterrogateRequest(BaseModel):
    job_id: str
    messages: list[ChatMessage]


# ─── Pipeline State ───────────────────────────────────────────────────────────

class AgentStep(BaseModel):
    agent: str
    status: Literal["running", "done", "error"]
    message: str
    timestamp: datetime = Field(default_factory=datetime.utcnow)


class PipelineResult(BaseModel):
    ticker: str
    steps: list[AgentStep] = []
    researcher: ResearcherOutput | None = None
    base_modeler: BaseModelerOutput | None = None
    critic: CriticOutput | None = None
    upside_modeler: UpsideModelerOutput | None = None
    advisor: AdvisorOutput | None = None
    financial_model: FinancialModel | None = None
    error: str | None = None
    completed: bool = False
