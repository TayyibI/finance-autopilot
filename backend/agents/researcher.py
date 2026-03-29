"""
Agent 1: The Researcher
Uses Anthropic's native web_search_20260209 tool (server-side, real-time, with dynamic filtering).
Falls back to knowledge-based analysis if search fails.

Note: web_search costs $10/1000 searches on the Anthropic API.
"""

import json
import logging
import os

import anthropic

from models.schemas import ResearcherOutput
from utils.llm_client import call_llm_structured

logger = logging.getLogger(__name__)

SCHEMA_HINT = """
After your research, respond with ONLY a JSON object with EXACTLY this structure (no markdown, no explanation):
{
  "company_name": "<full company name>",
  "sector": "<sector e.g. Technology, Airlines, Semiconductors>",
  "recent_headlines": ["headline 1", "headline 2", "headline 3"],
  "identified_risks": ["specific risk 1", "specific risk 2", "specific risk 3"],
  "identified_tailwinds": ["tailwind 1", "tailwind 2"],
  "summary": "<2-3 sentence analyst outlook summary>"
}
"""


def run_researcher(
    ticker: str,
    company_name: str,
    historical_summary: str,
) -> ResearcherOutput:
    logger.info(f"[Researcher] Starting research on {company_name} ({ticker})")

    try:
        result = _research_with_web_search(ticker, company_name)
        logger.info("[Researcher] Web search research complete")
        return result
    except Exception as e:
        logger.warning(f"[Researcher] Web search failed ({e}), falling back to knowledge-based")
        return _research_knowledge_based(ticker, company_name, historical_summary)


def _research_with_web_search(ticker: str, company_name: str) -> ResearcherOutput:
    """
    Uses Anthropic's native web_search_20260209 server-side tool.
    Upgraded from 20250305 to 20260209 for dynamic filtering support.
    Restricted to reputable financial news domains only.
    Location hint: Dublin, IE (where this runs from).
    """
    client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))

    response = client.messages.create(
        model="claude-haiku-4-5",
        max_tokens=4096,
        system=(
            "You are a financial research analyst. Search for recent news about the company. "
            "Be factual and specific. After searching, return ONLY a JSON object — "
            "no markdown fences, no explanation, just raw JSON."
        ),
        tools=[{
            "type": "web_search_20260209",
            "name": "web_search",
            "max_uses": 3,
            # allowed_domains and blocked_domains cannot be used together
            "allowed_domains": [
                "reuters.com", "bloomberg.com", "ft.com", "wsj.com",
                "cnbc.com", "finance.yahoo.com", "marketwatch.com",
                "businesspost.ie", "irishtimes.com", "theguardian.com",
            ],
            "user_location": {
                "type": "approximate",
                "city": "Dublin",
                "region": "Leinster",
                "country": "IE",
                "timezone": "Europe/Dublin",
            },
        }],
        messages=[{
            "role": "user",
            "content": (
                f"Search for recent news (last 3 months) about {company_name} (ticker: {ticker}). "
                f"Find: 3 recent headlines, up to 4 key business risks, up to 4 growth tailwinds, "
                f"and the sector this company operates in.\n\n"
                f"{SCHEMA_HINT}"
            ),
        }],
    )

    # Walk response blocks in reverse — the final text block contains the JSON
    # Block order: [text?, tool_use, tool_result, ..., text(final)]
    raw_text = None
    for block in reversed(response.content):
        if not hasattr(block, "text") or not block.text:
            continue
        text = block.text.strip()
        # Find the JSON object in the text
        start = text.find("{")
        end = text.rfind("}") + 1
        if start != -1 and end > start:
            raw_text = text[start:end]
            break

    if not raw_text:
        raise ValueError("No JSON block found in web search response content")

    parsed = json.loads(raw_text)
    return ResearcherOutput.model_validate(parsed)


def _research_knowledge_based(
    ticker: str,
    company_name: str,
    historical_summary: str,
) -> ResearcherOutput:
    """Fallback: pure Claude knowledge, no live search."""
    prompt = (
        f"You are a senior equity research analyst.\n\n"
        f"Company: {company_name} (Ticker: {ticker})\n"
        f"Historical Financial Context:\n{historical_summary}\n\n"
        f"Based on your knowledge:\n"
        f"1. What sector does this company operate in?\n"
        f"2. List 3-4 specific current risks (not generic platitudes)\n"
        f"3. List 2-3 genuine growth tailwinds with specific mechanisms\n"
        f"4. Write a 2-3 sentence current business outlook\n\n"
        f"Be specific to THIS company and its competitive position."
    )
    return call_llm_structured(prompt, ResearcherOutput)
