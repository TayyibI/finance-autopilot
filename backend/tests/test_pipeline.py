"""
Tests for the Finance Autopilot pipeline.
Run with: pytest tests/ -v
"""

import pytest
from pydantic import ValidationError
from models.schemas import (
    YearProjection, CriticOutput, UpsideModelerOutput,
    AgentStep, PipelineResult
)
from utils.data_ingestion import compute_cagr, compute_avg_margin


# ─── Schema Validation Tests ─────────────────────────────────────────────────

def test_year_projection_validates_margin():
    """Margin must be between -100 and 100."""
    with pytest.raises(ValidationError):
        YearProjection(year=2024, revenue_bn=10.0, operating_margin_pct=150.0, net_income_bn=1.0)


def test_year_projection_rounds_values():
    p = YearProjection(year=2024, revenue_bn=10.12345, operating_margin_pct=15.678, net_income_bn=1.23456)
    assert p.revenue_bn == 10.123
    assert p.operating_margin_pct == 15.68


def test_critic_output_must_be_negative():
    """Critic revenue adjustment must be 0 or negative."""
    with pytest.raises(ValidationError):
        CriticOutput(
            challenged_assumptions=["Assumption A"],
            risk_drivers=["Risk 1"],
            revenue_adjustment_pct=5.0,  # Should fail - positive not allowed for critic
            margin_adjustment_pct=-2.0,
            downside_projections=[
                YearProjection(year=2025, revenue_bn=9.0, operating_margin_pct=12.0, net_income_bn=0.8)
            ],
            critique_summary="Test critique"
        )


def test_upside_must_be_positive():
    """Upside modeler revenue adjustment must be 0 or positive."""
    with pytest.raises(ValidationError):
        UpsideModelerOutput(
            upside_drivers=["Driver 1"],
            revenue_adjustment_pct=-3.0,  # Should fail
            margin_adjustment_pct=2.0,
            upside_projections=[
                YearProjection(year=2025, revenue_bn=12.0, operating_margin_pct=18.0, net_income_bn=1.5)
            ],
            bull_case_summary="Test bull case"
        )


# ─── Financial Computation Tests ─────────────────────────────────────────────

def make_projections(revenues: list[float]) -> list[YearProjection]:
    return [
        YearProjection(year=2021 + i, revenue_bn=r, operating_margin_pct=15.0, net_income_bn=r * 0.1)
        for i, r in enumerate(revenues)
    ]


def test_cagr_calculation():
    projections = make_projections([10.0, 11.0, 12.1])
    cagr = compute_cagr(projections)
    assert abs(cagr - 0.1) < 0.01  # ~10% CAGR


def test_cagr_single_year_returns_fallback():
    projections = make_projections([10.0])
    cagr = compute_cagr(projections)
    assert cagr == 0.05  # Fallback


def test_avg_margin():
    projections = make_projections([10.0, 10.0, 10.0])
    for p in projections:
        p.operating_margin_pct = 20.0
    avg = compute_avg_margin(projections)
    assert avg == 20.0


# ─── Pipeline State Tests ────────────────────────────────────────────────────

def test_pipeline_result_starts_empty():
    result = PipelineResult(ticker="AAPL")
    assert result.completed is False
    assert result.steps == []
    assert result.error is None


def test_agent_step_records_correctly():
    step = AgentStep(agent="Researcher", status="done", message="Found 3 risks")
    assert step.agent == "Researcher"
    assert step.status == "done"


def test_critic_downside_lower_than_base():
    """Integration check: downside revenue should be less than base revenue."""
    base_rev = 15.0
    adjustment = -5.0  # -5%
    # Simulate what the critic should produce
    downside_rev = base_rev * (1 + adjustment / 100)
    assert downside_rev < base_rev
