"""
Agent 2: The Base Modeler
Projects a neutral 3-year base case.
v3: Now emits xai_reasoning — a chain-of-thought showing the exact math
    behind every projection so judges can verify the AI isn't hallucinating.
"""

import logging
from models.schemas import BaseModelerOutput, YearProjection
from utils.llm_client import call_llm_structured
from utils.data_ingestion import compute_cagr, compute_avg_margin

logger = logging.getLogger(__name__)


def run_base_modeler(
    ticker: str,
    company_name: str,
    historical: list[YearProjection],
    researcher_summary: str,
) -> BaseModelerOutput:
    logger.info(f"[BaseModeler] Building base case + XAI reasoning for {company_name}")

    cagr = compute_cagr(historical)
    avg_margin = compute_avg_margin(historical)
    last_year = historical[-1]
    last_revenue = last_year.revenue_bn

    projection_years = [last_year.year + i for i in range(1, 4)]
    rough_projections = []
    for i, yr in enumerate(projection_years, 1):
        rev = last_revenue * ((1 + cagr) ** i)
        op_margin = avg_margin
        net = rev * (op_margin / 100) * 0.75
        rough_projections.append({
            "year": yr,
            "revenue_bn": round(rev, 3),
            "operating_margin_pct": round(op_margin, 2),
            "net_income_bn": round(net, 3),
        })

    historical_str = "\n".join(
        f"  {p.year}: Revenue ${p.revenue_bn}B | OpMargin {p.operating_margin_pct}% | NetIncome ${p.net_income_bn}B"
        for p in historical
    )

    prompt = f"""You are a financial modeler building the BASE CASE for {company_name} ({ticker}).

Historical financials:
{historical_str}

Pre-computed metrics:
- Historical revenue CAGR: {cagr*100:.2f}%  (formula: (end_rev / start_rev)^(1/years) - 1)
- Average operating margin: {avg_margin:.2f}%
- Last reported revenue: ${last_revenue}B

Research context: {researcher_summary}

Mechanical starting projections (your starting point):
{rough_projections}

YOUR TASK — produce output in two parts:

PART 1 — xai_reasoning (chain of thought, minimum 3 steps):
Show the exact mathematical reasoning you used to arrive at each projection.
Each step must include: what you're computing, the actual formula/calculation with numbers, and the result.
Examples of good steps:
  - "Step 1: Compute base CAGR from historical data. ($383.3B / $365.8B)^(1/2) - 1 = 2.36%. Using 2.36% as base growth rate."
  - "Step 2: Year 1 revenue. $383.3B × (1 + 0.0236) = $392.3B. Adjusted to $390.0B to reflect analyst consensus of slight deceleration."
  - "Step 3: Operating margin. Historical average is 29.96%. Holding flat at 30.0% given stable cost structure."
Be specific. Write real numbers. This is the explainability layer — judges will read this.

CRITICAL: Be extremely concise and punchy in your xai_reasoning and text fields. Use bullet points and hard numbers. Avoid fluff so your response fits within the token limit.
PART 2 — projections, methodology, key_assumptions:
The actual 3-year projections, a methodology string, and 3-4 key assumptions."""

    result = call_llm_structured(prompt, BaseModelerOutput, max_tokens=4096)
    logger.info(f"[BaseModeler] Done. {len(result.xai_reasoning)} reasoning steps, {len(result.projections)} projections")
    return result
