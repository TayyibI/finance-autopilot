# Finance Autopilot — Red-Teamed Strategic Advisor

> **Hackathon Entry · Assiduous Corporate Finance Challenge**  
> ⚠️ Educational only. Outputs are not investment advice. Uncertainty is labelled throughout.

---

## What It Does

Finance Autopilot is a **multi-agent AI pipeline** that takes a public company ticker and produces a fully red-teamed investment analysis in under 3 minutes. Unlike standard "generate a pitch deck" tools, the system deliberately pits a **Devil's Advocate agent** against a Base Modeler to stress-test every assumption — then synthesises everything into a Strategic Advisor memo with hard questions any serious investor would ask.

**Live demo:** enter ticker `DEMO` for an instant run using hardcoded Apple data (no API calls to yfinance).

---

## Quickstart

### Option A — Docker (recommended)

```bash
git clone <your-repo-url>
cd finance-autopilot

# Create your .env file
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env

# Build and run both services
docker-compose up --build
```

Open **http://localhost:3000** — backend API available at **http://localhost:8000**.

### Option B — Local development

```bash
# Backend
cd backend
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...
pytest tests/ -v          # run tests first
uvicorn main:app --reload --port 8000

# Frontend (separate terminal)
cd frontend
npm install
npm run dev               # http://localhost:3000
```

---

## Architecture

```
User Input (Ticker)
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│                     FastAPI Backend                          │
│                                                             │
│  ┌──────────────┐    ┌─────────────────────────────────┐   │
│  │ DataIngestion│    │         Agent Pipeline           │   │
│  │  (yfinance)  │───▶│                                 │   │
│  │  DEMO mode   │    │  1. Researcher  (web_search API)│   │
│  └──────────────┘    │  2. BaseModeler (trend + LLM)  │   │
│                       │  3. Critic      (Devil's Adv.) │   │
│  Pydantic validation  │  4. UpsideModeler (bull case)  │   │
│  at every step        │  5. Advisor     (synthesis)    │   │
│                       └──────────────┬──────────────────┘   │
│                                      │                      │
│                       AgentStep logs emitted per step       │
└──────────────────────────────────────┼──────────────────────┘
                                       │
                    ┌──────────────────┼──────────────────┐
                    │   SSE Stream      │  JSON Result     │
                    ▼                  ▼                   │
          Live Audit Trail      Financial Model +          │
          (Right column)        Advisory Output            │
                                (Left column)              │
                    └──────────────────────────────────────┘
                                  Next.js Frontend
```

### Pipeline: Ingest → Transform → Validate → Output

**Ingest:** `yfinance` pulls 3 years of annual income statement data (Revenue, Operating Income, Net Income). A 5-second timeout guard and DEMO fallback ensure reliability.

**Transform:** Five specialised agents run sequentially, each reading the previous agent's output:
- **Researcher** uses Anthropic's native `web_search_20250305` tool to pull live news from financial news domains, identifying risks and tailwinds.
- **Base Modeler** computes historical CAGR and average margin, projects a neutral 3-year case, then uses Claude to validate and adjust assumptions based on business context.
- **Critic (Devil's Advocate)** reads the base case and all identified risks. It challenges specific assumptions, quantifies the impact, and produces a downside scenario. The validator enforces that `revenue_adjustment_pct ≤ 0` — it can't accidentally produce an optimistic downside.
- **Upside Modeler** is the counterpart: it identifies specific growth catalysts and quantifies them. The validator enforces `revenue_adjustment_pct ≥ 0`.
- **Strategic Advisor** synthesises all prior outputs into a strategic memo with 2–4 specific strategic options, a recommendation with rationale, red flags, and tough investor Q&A.

**Validate:** Every agent output is a Pydantic model. The LLM is prompted to return strict JSON matching the schema. If parsing or validation fails, the `llm_client` retries once with the error context injected. This means hallucinated values (e.g. a positive revenue adjustment from the Critic) are rejected at the schema layer, not silently passed downstream.

**Output:** The pipeline result is stored in-memory and served via two endpoints: a full JSON result endpoint and an SSE stream that replays agent steps with a small delay for the live audit trail effect.

---

## Production Mindset

**Typed models everywhere.** Every data structure — historical financials, agent outputs, pipeline state — is a Pydantic v2 model. Numbers are validated and rounded at ingestion. Strings aren't passed between agents; structured objects are.

**Testable by design.** Because the Critic and Upside Modeler have opposing validator constraints (`≤ 0` vs `≥ 0`), a simple pytest can assert that the downside scenario always produces lower revenue than the base case. See `tests/test_pipeline.py`.

**Demo stability.** Entering `DEMO` bypasses all external API calls and returns hardcoded Apple data instantly. Critical for live demos where yfinance rate-limiting or network issues could break the run at the worst moment.

**Graceful degradation.** The Researcher tries Anthropic's web search first and falls back to knowledge-based LLM analysis if the tool call fails. The pipeline continues through all 5 agents regardless.

**Non-root Docker containers.** Both services run as non-root users. The backend Dockerfile creates a dedicated `appuser`; the frontend uses Next.js's recommended `nextjs` user pattern.

---

## API Reference

| Endpoint | Method | Description |
|---|---|---|
| `/api/health` | GET | Health check |
| `/api/analyse` | POST | Run pipeline `{"ticker": "AAPL"}` → `{"job_id": "..."}` |
| `/api/result/{job_id}` | GET | Full `PipelineResult` JSON |
| `/api/stream/{job_id}` | GET | SSE stream of `AgentStep` events |
| `/api/tickers` | GET | Suggested tickers for the UI |

---

## Limitations

- **Financial model depth.** The model projects 3 lines (Revenue, Operating Margin, Net Income) over 3 years. A full 3-statement model (Income Statement, Balance Sheet, Cash Flow) was deliberately excluded — the complexity would have consumed the entire weekend and the added precision would be false accuracy.
- **No persistent storage.** Pipeline results live in-memory. Restarting the backend loses all job history.
- **yfinance reliability.** yfinance is an unofficial Yahoo Finance scraper and can be rate-limited or return incomplete data for some tickers. The 5-second timeout and DEMO fallback mitigate this for demos.
- **LLM hallucination.** Despite Pydantic validation and retry logic, LLM outputs can still be factually wrong. All outputs are labelled as estimates. This is an educational tool, not a financial advisory service.
- **Web search availability.** Anthropic's `web_search_20250305` tool must be enabled in the API account's console settings. The fallback to knowledge-based research activates automatically if unavailable.

---

## Third-Party Data & APIs

| Source | Usage | Terms |
|---|---|---|
| Anthropic Claude API (`claude-opus-4-5`) | All 5 agents — base modeler, critic, upside, researcher, advisor | [Anthropic ToS](https://www.anthropic.com/legal/aup) |
| Anthropic `web_search_20250305` | Researcher agent live news fetch | Anthropic server-side tool |
| yfinance | Historical income statement data (Revenue, OpIncome, NetIncome) | Unofficial Yahoo Finance API — public data |
| Recharts | Revenue scenario chart | MIT License |
| FastAPI + Pydantic | Backend framework + validation | MIT License |
| Next.js | Frontend framework | MIT License |

---

## AI Tools Used in Development

This project was built with Claude (claude.ai) as a coding assistant. Key prompts included:

- Architecture design: "Design a multi-agent pipeline where agents have opposing objectives to make the reasoning observable"
- Schema design: "Write Pydantic validators that enforce the Critic always returns a non-positive revenue adjustment and the Upside Modeler always returns non-negative"
- Bug fix: "The SSE stream response parsing isn't finding the final JSON block after tool_use blocks — fix the block iteration logic"
- Frontend: "Build a dark terminal-aesthetic two-column dashboard with a live SSE audit trail that auto-scrolls and shows agent badges with colour coding"

---

## Running Tests

```bash
cd backend
pip install -r requirements.txt
pytest tests/ -v
```

Expected output: all tests pass. The test suite covers schema validation (margin bounds, critic must be ≤ 0, upside must be ≥ 0), financial calculations (CAGR, average margin), and pipeline state integrity.
