"""
Agent 4: The Upside Modeler
v3: Now emits xai_reasoning showing how each growth catalyst was quantified
    into a specific uplift to the base case projections.
"""

import logging
from models.schemas import UpsideModelerOutput, BaseModelerOutput, ResearcherOutput
from utils.llm_client import call_llm_structured

logger = logging.getLogger(__name__)


def run_upside_modeler(
    ticker: str,
    company_name: str,
    base_model: BaseModelerOutput,
    researcher: ResearcherOutput,
) -> UpsideModelerOutput:
    logger.info(f"[UpsideModeler] Building bull case + XAI for {company_name}")

    base_projections_str = "\n".join(
        f"  {p.year}: Revenue ${p.revenue_bn}B | OpMargin {p.operating_margin_pct}% | NetIncome ${p.net_income_bn}B"
        for p in base_model.projections
    )
    tailwinds_str = "\n".join(f"  - {t}" for t in researcher.identified_tailwinds)

    prompt = f"""You are a rigorous equity analyst building the UPSIDE (bull) case for {company_name} ({ticker}).

BASE CASE PROJECTIONS:
{base_projections_str}

Identified growth tailwinds: {tailwinds_str}
Sector: {researcher.sector}

YOUR TASK — produce output in two parts:

PART 1 — xai_reasoning (chain of thought, minimum 3 steps):
Show the exact mathematical reasoning behind your upside adjustments.
Each step must trace: a specific growth catalyst → a quantified revenue or margin impact → the revised number.
Examples of good steps:
  - "Step 1: AI services monetisation catalyst. Apple Intelligence is being rolled out to 2.2B devices. If 5% of users pay $10/month premium, that's $13.2B incremental annual revenue by Year 2."
  - "Step 2: Translate to revenue growth uplift. Base case Year 2 revenue is $401.6B. Adding $13.2B = $414.8B. Effective growth rate increases from 5.0% to 8.3%. Upside CAGR uplift: +3.3pp."
  - "Step 3: Margin leverage. Software revenue is ~70% gross margin vs hardware at ~38%. Revenue mix shift improves blended margin by +1.2pp per year of AI ramp."
  - "Step 4: Year 1 upside revenue. $392.3B × (1 + 0.033) = $405.2B."
revenue_adjustment_pct MUST be 0 or positive. Be grounded — credible bulls, not fantasy.

CRITICAL: Be extremely concise and punchy in your xai_reasoning and text fields. Use bullet points and hard numbers. Avoid fluff so your response fits within the token limit.
PART 2 — upside_drivers, revenue_adjustment_pct, margin_adjustment_pct,
         upside_projections, bull_case_summary:
The actual upside model outputs."""

    result = call_llm_structured(prompt, UpsideModelerOutput, max_tokens=4096)
    logger.info(
        f"[UpsideModeler] Done. {len(result.xai_reasoning)} reasoning steps. "
        f"Revenue uplift: +{result.revenue_adjustment_pct}%"
    )
    return result
