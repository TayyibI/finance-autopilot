"""
Pipeline Orchestrator
Runs the 5-agent pipeline sequentially with observable step logging.
Each step emits an AgentStep so the frontend can show the live audit trail.
"""

import logging
from datetime import datetime
from models.schemas import (
    AgentStep, PipelineResult, FinancialModel, ScenarioModel
)
from utils.data_ingestion import fetch_historical_financials
from agents.researcher import run_researcher
from agents.base_modeler import run_base_modeler
from agents.critic import run_critic
from agents.upside_modeler import run_upside_modeler
from agents.advisor import run_advisor

logger = logging.getLogger(__name__)


def run_pipeline(ticker: str) -> PipelineResult:
    """
    Full pipeline: ingest → research → model → critique → upside → advise
    Returns PipelineResult with all agent outputs and observable steps.
    """
    ticker = ticker.upper().strip()
    result = PipelineResult(ticker=ticker)

    def log_step(agent: str, status: str, message: str):
        step = AgentStep(agent=agent, status=status, message=message)
        result.steps.append(step)
        logger.info(f"[Pipeline][{agent}] {status}: {message}")

    # ── Step 0: Data Ingestion ───────────────────────────────────────────────
    log_step("DataIngestion", "running", f"Fetching historical financials for {ticker} from yfinance...")
    try:
        company_name, historical = fetch_historical_financials(ticker)
        log_step("DataIngestion", "done",
                 f"Loaded {len(historical)} years of data for {company_name} "
                 f"({historical[0].year}–{historical[-1].year})")
    except Exception as e:
        log_step("DataIngestion", "error", str(e))
        result.error = str(e)
        return result

    # ── Step 1: Researcher ───────────────────────────────────────────────────
    log_step("Researcher", "running", "Searching for recent news, risks, and tailwinds...")
    try:
        historical_summary = "\n".join(
            f"{p.year}: Revenue ${p.revenue_bn}B | OpMargin {p.operating_margin_pct}%"
            for p in historical
        )
        researcher = run_researcher(ticker, company_name, historical_summary)
        result.researcher = researcher
        log_step("Researcher", "done",
                 f"Found {len(researcher.identified_risks)} risks, "
                 f"{len(researcher.identified_tailwinds)} tailwinds. "
                 f"Sector: {researcher.sector}")
    except Exception as e:
        log_step("Researcher", "error", str(e))
        result.error = str(e)
        return result

    # ── Step 2: Base Modeler ─────────────────────────────────────────────────
    log_step("BaseModeler", "running", "Building 3-year base case projection...")
    try:
        base_model = run_base_modeler(ticker, company_name, historical, researcher.summary)
        result.base_modeler = base_model
        end = base_model.projections[-1]
        log_step("BaseModeler", "done",
                 f"Base case: {end.year} Revenue ${end.revenue_bn}B, "
                 f"OpMargin {end.operating_margin_pct}%")
    except Exception as e:
        log_step("BaseModeler", "error", str(e))
        result.error = str(e)
        return result

    # ── Step 3: Critic ───────────────────────────────────────────────────────
    log_step("Critic", "running",
             "Devil's Advocate challenging base case assumptions...")
    try:
        critic = run_critic(ticker, company_name, base_model, researcher)
        result.critic = critic
        log_step("Critic", "done",
                 f"Revenue haircut: {critic.revenue_adjustment_pct}%. "
                 f"Challenged: {', '.join(critic.challenged_assumptions[:2])}")
    except Exception as e:
        log_step("Critic", "error", str(e))
        result.error = str(e)
        return result

    # ── Step 4: Upside Modeler ───────────────────────────────────────────────
    log_step("UpsideModeler", "running", "Building bull case scenario...")
    try:
        upside = run_upside_modeler(ticker, company_name, base_model, researcher)
        result.upside_modeler = upside
        log_step("UpsideModeler", "done",
                 f"Bull case revenue uplift: +{upside.revenue_adjustment_pct}%. "
                 f"Driver: {upside.upside_drivers[0] if upside.upside_drivers else 'N/A'}")
    except Exception as e:
        log_step("UpsideModeler", "error", str(e))
        result.error = str(e)
        return result

    # ── Step 5: Advisor ──────────────────────────────────────────────────────
    log_step("Advisor", "running",
             "Synthesising strategic memo and investment recommendation...")
    try:
        advisor = run_advisor(ticker, company_name, researcher, base_model, critic, upside)
        result.advisor = advisor
        log_step("Advisor", "done",
                 f"Recommendation: {advisor.recommended_option[:80]}...")
    except Exception as e:
        log_step("Advisor", "error", str(e))
        result.error = str(e)
        return result

    # ── Assemble FinancialModel ──────────────────────────────────────────────
    result.financial_model = FinancialModel(
        ticker=ticker,
        company_name=company_name,
        historical=historical,
        base=ScenarioModel(
            scenario="base",
            projections=base_model.projections,
            key_assumptions=base_model.key_assumptions,
            narrative=base_model.methodology,
        ),
        upside=ScenarioModel(
            scenario="upside",
            projections=upside.upside_projections,
            key_assumptions=upside.upside_drivers,
            narrative=upside.bull_case_summary,
        ),
        downside=ScenarioModel(
            scenario="downside",
            projections=critic.downside_projections,
            key_assumptions=critic.challenged_assumptions,
            narrative=critic.critique_summary,
        ),
    )

    result.completed = True
    log_step("Pipeline", "done",
             f"Analysis complete for {company_name}. All 5 agents finished successfully.")
    return result
