"""
Agent 3: The Critic (Devil's Advocate)
v3: Now emits xai_reasoning showing exactly how each identified risk
    was translated into a specific numerical adjustment to the base case.
    This is the most important XAI layer — it proves the bear case isn't arbitrary.
"""

import logging
from models.schemas import CriticOutput, BaseModelerOutput, ResearcherOutput
from utils.llm_client import call_llm_structured

logger = logging.getLogger(__name__)


def run_critic(
    ticker: str,
    company_name: str,
    base_model: BaseModelerOutput,
    researcher: ResearcherOutput,
) -> CriticOutput:
    logger.info(f"[Critic] Devil's Advocate + XAI on {company_name}")

    base_projections_str = "\n".join(
        f"  {p.year}: Revenue ${p.revenue_bn}B | OpMargin {p.operating_margin_pct}% | NetIncome ${p.net_income_bn}B"
        for p in base_model.projections
    )
    risks_str = "\n".join(f"  - {r}" for r in researcher.identified_risks)

    prompt = f"""You are a cynical PE credit analyst stress-testing the base case for {company_name} ({ticker}).

BASE CASE PROJECTIONS:
{base_projections_str}

Base case assumptions: {', '.join(base_model.key_assumptions)}
Research-identified risks: {risks_str}
Base modeler methodology: {base_model.methodology}

YOUR TASK — produce output in two parts:

PART 1 — xai_reasoning (chain of thought, minimum 3 steps):
Show the exact mathematical reasoning behind your downside adjustments.
Each step must trace from an identified risk → a specific quantified impact → a revised number.
Examples of good steps:
  - "Step 1: Identify primary risk driver. Boeing delivery delays reduce fleet expansion by 15 aircraft vs plan. At $200M revenue/aircraft/year, this removes $3B from the 3-year revenue stack."
  - "Step 2: Translate to growth rate adjustment. Base case assumes 8% revenue CAGR. Fleet constraint caps it at ~5.5%. Applying -2.5% adjustment to all projection years."
  - "Step 3: Margin impact. Fewer new-generation aircraft means higher fuel cost per seat. Estimate +1.5pp cost headwind, reducing operating margin by -1.5pp across all years."
  - "Step 4: Year 1 downside revenue. $392.3B × (1 - 0.025) = $382.5B. Rounded to $382.0B."
revenue_adjustment_pct MUST be 0 or negative. Be specific. Use real numbers from the base case.

CRITICAL: Be extremely concise and punchy in your xai_reasoning and text fields. Use bullet points and hard numbers. Avoid fluff so your response fits within the token limit.
PART 2 — challenged_assumptions, risk_drivers, revenue_adjustment_pct, margin_adjustment_pct,
         downside_projections, critique_summary:
The actual downside model outputs."""

    result = call_llm_structured(prompt, CriticOutput, max_tokens=4096)
    logger.info(
        f"[Critic] Done. {len(result.xai_reasoning)} reasoning steps. "
        f"Revenue adj: {result.revenue_adjustment_pct}%"
    )
    return result
