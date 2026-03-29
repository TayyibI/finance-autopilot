"""
FastAPI application — Finance Autopilot backend.

Routes:
  POST /api/analyse          — Run full pipeline, returns job_id
  GET  /api/result/{job_id}  — Full PipelineResult JSON
  GET  /api/stream/{job_id}  — SSE replay of agent steps
  POST /api/interrogate      — Streaming Interrogation Room chat
  GET  /api/health           — Health check
  GET  /api/tickers          — Suggested tickers
"""

import asyncio
import json
import logging
import os
import uuid
from contextlib import asynccontextmanager
from typing import AsyncGenerator

import anthropic
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from models.schemas import InterrogateRequest, PipelineResult
from pipeline import run_pipeline

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s | %(levelname)s | %(name)s | %(message)s",
)
logger = logging.getLogger(__name__)

_jobs: dict[str, PipelineResult] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Finance Autopilot API starting")
    if not os.getenv("ANTHROPIC_API_KEY"):
        logger.error("ANTHROPIC_API_KEY not set")
    yield
    logger.info("Finance Autopilot API stopping")


app = FastAPI(
    title="Finance Autopilot API",
    description="Adversarial multi-agent corporate finance pipeline",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://frontend:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class AnalyseRequest(BaseModel):
    ticker: str


class AnalyseResponse(BaseModel):
    job_id: str
    ticker: str
    message: str


@app.get("/api/health")
def health():
    return {"status": "ok", "service": "finance-autopilot", "version": "2.0.0"}


@app.post("/api/analyse", response_model=AnalyseResponse)
async def analyse(req: AnalyseRequest):
    ticker = req.ticker.upper().strip()
    if not ticker or len(ticker) > 10:
        raise HTTPException(status_code=400, detail="Invalid ticker symbol")

    job_id = str(uuid.uuid4())
    logger.info(f"Starting job {job_id} for {ticker}")

    loop = asyncio.get_event_loop()
    result = await loop.run_in_executor(None, run_pipeline, ticker)
    _jobs[job_id] = result

    return AnalyseResponse(
        job_id=job_id,
        ticker=ticker,
        message="Analysis complete" if result.completed else f"Failed: {result.error}",
    )


@app.get("/api/result/{job_id}")
def get_result(job_id: str) -> PipelineResult:
    if job_id not in _jobs:
        raise HTTPException(status_code=404, detail="Job not found")
    return _jobs[job_id]


@app.get("/api/stream/{job_id}")
async def stream_steps(job_id: str):
    if job_id not in _jobs:
        raise HTTPException(status_code=404, detail="Job not found")

    result = _jobs[job_id]

    async def event_generator() -> AsyncGenerator[str, None]:
        for step in result.steps:
            data = json.dumps({
                "agent": step.agent,
                "status": step.status,
                "message": step.message,
                "timestamp": step.timestamp.isoformat(),
            })
            yield f"data: {data}\n\n"
            await asyncio.sleep(0.3)
        yield 'data: {"done": true}\n\n'

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.post("/api/interrogate")
async def interrogate(req: InterrogateRequest):
    """
    Streaming Interrogation Room endpoint.
    Loads the full PipelineResult for context, then streams a response
    from a hostile PE associate persona that has read every number.
    """
    if req.job_id not in _jobs:
        raise HTTPException(status_code=404, detail="Job not found — run /api/analyse first")

    result = _jobs[req.job_id]
    if not result.completed or not result.financial_model or not result.advisor:
        raise HTTPException(status_code=400, detail="Pipeline not complete")

    fm     = result.financial_model
    adv    = result.advisor
    critic = result.critic
    res    = result.researcher

    # Build a dense financial context summary to inject as system prompt
    hist_summary = " | ".join(
        f"{p.year}: Rev ${p.revenue_bn}B, Margin {p.operating_margin_pct}%"
        for p in fm.historical
    )
    base_end  = fm.base.projections[-1]
    down_end  = fm.downside.projections[-1]
    up_end    = fm.upside.projections[-1]
    bp        = adv.breaking_point

    system_prompt = f"""You are a hostile, data-driven Private Equity Associate conducting a live due diligence interrogation of {fm.company_name} ({fm.ticker}).

You have just read the full analysis. Here is every number:

HISTORICAL FINANCIALS: {hist_summary}

SCENARIO FORECASTS (Year 3):
- Base case: Revenue ${base_end.revenue_bn}B | Margin {base_end.operating_margin_pct}% | Net Income ${base_end.net_income_bn}B
- Upside: Revenue ${up_end.revenue_bn}B
- Downside: Revenue ${down_end.revenue_bn}B

IDENTIFIED RISKS: {', '.join(res.identified_risks if res else [])}
RED FLAGS: {', '.join(adv.red_flags)}
CRITIC'S CHALLENGED ASSUMPTIONS: {', '.join(critic.challenged_assumptions if critic else [])}
CRITIC'S REVENUE HAIRCUT: {critic.revenue_adjustment_pct if critic else 'N/A'}%
BREAKING POINT: {bp.variable} — thesis breaks below {bp.threshold}. Currently: {bp.current_value}. Buffer: {bp.distance_from_break}. Consequence: {bp.consequence}

YOUR PERSONA:
- You are protecting your firm's capital. Your job is to find the hole in the thesis.
- You are NOT helpful. You are professional but adversarial.
- Reference specific numbers from the analysis above. Never be generic.
- When the user gives a weak answer, press harder with a follow-up.
- Keep responses to 3-4 sentences maximum. Sharp. Direct.
- You may occasionally reference what competitors or sector comps would show.
- Tone: a senior professional who has seen companies like this fail before.

IMPORTANT: This is a simulation for educational purposes. Never claim this is real investment advice."""

    # Build message history
    messages = [{"role": m.role, "content": m.content} for m in req.messages]

    # If this is the opening (only 1 user message = the trigger), generate opening attack
    if len(messages) == 1 and messages[0]["role"] == "user" and messages[0]["content"] == "__OPEN__":
        messages = [{
            "role": "user",
            "content": (
                f"I'd like to walk you through our investment thesis for {fm.company_name}."
            )
        }]

    async def stream_response() -> AsyncGenerator[str, None]:
        client = anthropic.Anthropic(api_key=os.getenv("ANTHROPIC_API_KEY"))
        try:
            with client.messages.stream(
                model="claude-haiku-4-5",
                max_tokens=400,
                system=system_prompt,
                messages=messages,
            ) as stream:
                for text in stream.text_stream:
                    yield f"data: {json.dumps({'token': text})}\n\n"
            yield 'data: {"done": true}\n\n'
        except Exception as e:
            logger.error(f"Interrogation stream error: {e}")
            yield f'data: {json.dumps({"error": str(e)})}\n\n'

    return StreamingResponse(
        stream_response(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@app.get("/api/tickers")
def suggested_tickers():
    return {
        "suggestions": [
            {"ticker": "AAPL",   "name": "Apple Inc."},
            {"ticker": "MSFT",   "name": "Microsoft"},
            {"ticker": "RYA.IR", "name": "Ryanair"},
            {"ticker": "NVDA",   "name": "NVIDIA"},
            {"ticker": "META",   "name": "Meta Platforms"},
            {"ticker": "TSLA",   "name": "Tesla"},
            {"ticker": "DEMO",   "name": "Demo (Apple data)"},
        ]
    }
