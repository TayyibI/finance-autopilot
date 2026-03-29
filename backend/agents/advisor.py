"""
Agent 5: The Strategic Advisor
Synthesises all prior agent outputs into a strategic memo + breaking point analysis.
The breaking point is the single variable whose deterioration collapses the thesis —
the most important output for the Interrogation Room to attack.
"""

import logging
from models.schemas import (
    AdvisorOutput, BreakingPoint, ResearcherOutput, BaseModelerOutput,
    CriticOutput, UpsideModelerOutput
)
from utils.llm_client import call_llm_structured

logger = logging.getLogger(__name__)


def run_advisor(
    ticker: str,
    company_name: str,
    researcher: ResearcherOutput,
    base_model: BaseModelerOutput,
    critic: CriticOutput,
    upside_modeler: UpsideModelerOutput,
) -> AdvisorOutput:
    logger.info(f"[Advisor] Synthesising strategic memo + breaking point for {company_name}")

    base_end_rev     = base_model.projections[-1].revenue_bn if base_model.projections else "N/A"
    downside_end_rev = critic.downside_projections[-1].revenue_bn if critic.downside_projections else "N/A"
    upside_end_rev   = upside_modeler.upside_projections[-1].revenue_bn if upside_modeler.upside_projections else "N/A"

    prompt = f"""You are a senior M&A / capital markets advisor presenting to an investment committee about {company_name} ({ticker}).

You have received the following analysis:

RESEARCHER:
- Sector: {researcher.sector}
- Key risks: {', '.join(researcher.identified_risks)}
- Key tailwinds: {', '.join(researcher.identified_tailwinds)}
- Outlook: {researcher.summary}

BASE MODELER (3-year base case, end revenue ${base_end_rev}B):
- Assumptions: {', '.join(base_model.key_assumptions)}
- Methodology: {base_model.methodology}

DEVIL'S ADVOCATE:
- Challenged assumptions: {', '.join(critic.challenged_assumptions)}
- Revenue haircut applied: {critic.revenue_adjustment_pct}%
- Downside end revenue: ${downside_end_rev}B
- Critique: {critic.critique_summary}

BULL ANALYST:
- Upside drivers: {', '.join(upside_modeler.upside_drivers)}
- Revenue uplift: +{upside_modeler.revenue_adjustment_pct}%
- Upside end revenue: ${upside_end_rev}B
- Bull case: {upside_modeler.bull_case_summary}

Your tasks:

1. Propose 2-4 specific strategic options (equity raise, buyback, M&A, debt paydown, expansion etc.)
2. Recommend ONE option with clear rationale given the base/downside spread
3. List 2-3 key risks to your recommendation
4. List 2-3 genuine red flags any serious investor would flag
5. Write 4-6 tough questions an equity or credit investor would ask management in a due diligence session
6. Write a 150-200 word executive memo summarising the investment case
7. BREAKING POINT ANALYSIS — identify the single most sensitive variable:
   - The ONE metric whose deterioration most directly breaks the investment thesis
   - The exact threshold value at which the thesis becomes indefensible
   - What concretely happens if that threshold is breached (e.g. "debt covenants trigger", "net income negative")
   - Where the metric currently stands vs that threshold
   - How much buffer/headroom exists (in bps, percentage points, or absolute terms)
   Be precise. Use numbers. This is the most important output.

Note: Label uncertainty. This is for educational/hackathon purposes only, not investment advice."""

    result = call_llm_structured(prompt, AdvisorOutput, max_tokens=4096)
    logger.info(
        f"[Advisor] Complete. Breaking point: {result.breaking_point.variable} "
        f"@ {result.breaking_point.threshold}"
    )
    return result
