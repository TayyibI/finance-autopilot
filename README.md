# Finance Autopilot — Adversarial Investment Analysis Engine

> **Assiduous Hackathon Entry** · Solo · Tayyib Ismail · MSc Computer Science, University College Dublin  
> ⚠️ Educational only. Outputs are not investment advice. All uncertainty is labelled.

---

## What It Does

Most corporate finance AI tools are optimistic by design — they help companies build their pitch.  
**Finance Autopilot does the opposite.** It simulates the room the pitch walks into.

A 6-agent adversarial pipeline analyses any listed public company, produces a red-teamed 3-scenario financial model, computes the exact variable whose deterioration breaks the investment thesis, and then opens a live Interrogation Room — a stateful chat with a hostile PE investor persona that has read every number and is trying to find the hole.

**Key differentiator vs generic "AI pitch deck" tools:** the Devil's Advocate agent and the Bull Analyst have *opposing Pydantic constraints* — the Critic is schema-validated to never produce a positive revenue adjustment, the Upside Modeler can never produce a negative one. The adversarial tension is enforced at the data layer, not just in the prompt.

---

## Quickstart

### Docker (recommended — runs in one command)

```bash
git clone https://github.com/TayyibI/finance-autopilot
cd finance-autopilot

# Set your API key
echo "ANTHROPIC_API_KEY=sk-ant-..." > .env

# Build and run
docker-compose up --build
```

Open **http://localhost:3000**. Backend API at **http://localhost:8000/docs**.

> **For instant demo without yfinance:** enter ticker `DEMO` — returns hardcoded Apple financials, runs all 6 agents, no external API calls needed.

### Local Development

```bash
# Backend
cd backend
pip install -r requirements.txt
export ANTHROPIC_API_KEY=sk-ant-...
pytest tests/ -v                   # validate before running
uvicorn main:app --reload --port 8000

# Frontend (new terminal)
cd frontend
npm install                        # includes reactflow, recharts, lucide-react
npm run dev                        # http://localhost:3000
```

---

## Architecture

```
                           User enters ticker
                                  │
                                  ▼
                    ┌─────────────────────────┐
                    │   FastAPI Backend        │
                    │                         │
                    │  ① Data Ingestion       │
                    │    yfinance (3yr hist.)  │
                    │    5s timeout + DEMO     │
                    │    fallback              │
                    └────────────┬────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │   Agent Pipeline        │
                    │                         │
                    │  ② Researcher           │
                    │    Anthropic web_search │
                    │    → risks + tailwinds  │
                    │                         │
                    │  ③ Base Modeler         │
                    │    CAGR extrapolation   │
                    │    + LLM adjustment     │
                    │    + XAI chain-of-thought│
                    │         ↙       ↘       │
                    │  ④ Critic    ⑤ Upside  │
                    │  (bear case) (bull case) │
                    │  rev_adj ≤ 0  rev_adj ≥ 0│
                    │  XAI steps   XAI steps  │
                    │         ↘       ↙       │
                    │  ⑥ Advisor + Breaking  │
                    │    Point analysis       │
                    └────────────┬────────────┘
                                 │
                 ┌───────────────┼────────────────┐
                 ▼               ▼                ▼
          SSE stream       JSON result      /api/interrogate
          (audit trail)   (full pipeline)   (streaming chat)
                 │               │                │
                 └───────────────┴────────────────┘
                                 │
                    ┌────────────▼────────────┐
                    │   Next.js Frontend      │
                    │                         │
                    │  React Flow node graph  │
                    │  Recharts 3-scenario    │
                    │  Revenue/Margin toggle  │
                    │  XAI accordion panels   │
                    │  Breaking Point card    │
                    │  Interrogation Room     │
                    │  Web Speech API (TTS+STT)│
                    │  Global mute toggle     │
                    └─────────────────────────┘
```

### Pipeline: Ingest → Transform → Validate → Output

**Ingest** (`utils/data_ingestion.py`): `yfinance` pulls 3 years of annual income statement data. A daemon thread enforces a 5-second timeout on `stock.info` (which can hang on bad tickers). Ticker `DEMO` bypasses yfinance entirely and returns hardcoded Apple 2021–2023 data — zero external calls, guaranteed demo stability.

**Transform** (6 agents, `agents/`): Each agent is a pure function that takes typed Pydantic inputs and returns typed Pydantic outputs. They run sequentially with full dependency injection:

- **Researcher** — Uses Anthropic's `web_search_20260209` server-side tool (upgraded from 20250305), restricted to reputable financial news domains (Reuters, Bloomberg, FT, CNBC). Falls back to knowledge-based analysis if the tool is unavailable.
- **Base Modeler** — Computes historical CAGR and average margin mechanically, then uses Claude to validate and adjust the extrapolation based on business context. Emits `xai_reasoning`: a minimum 3-step chain-of-thought with real calculations (e.g. `($383.3B / $365.8B)^(1/2) - 1 = 2.36%`).
- **Critic (Devil's Advocate)** — Reads the base case and all risks. Challenges specific assumptions, quantifies impact, produces downside projections. `revenue_adjustment_pct` is Pydantic-validated to be `≤ 0`. Emits full XAI reasoning tracing each risk to a specific numerical adjustment.
- **Upside Modeler** — Mirror of the Critic with `revenue_adjustment_pct ≥ 0`. Identifies specific growth catalysts and traces them to quantified upside numbers via XAI steps.
- **Advisor** — Synthesises all prior outputs. Produces strategic options, a recommendation, red flags, tough investor Q&A, an executive memo, and critically: a **Breaking Point** analysis — the single variable whose deterioration collapses the thesis, expressed as a current value, break threshold, headroom in basis points, and consequence.

**Validate**: Every agent output is a strict Pydantic v2 model. `llm_client.py` prompts Claude to return raw JSON matching the schema, strips accidental markdown fences, parses, and validates. On failure it injects the validation error into a retry prompt. This means schema violations (wrong sign, missing fields, out-of-range margins) are caught and corrected before propagating downstream.

**Output**: Results are stored in-memory by job ID. The SSE endpoint replays `AgentStep` logs with 300ms delays to produce the live audit trail. The `/api/interrogate` endpoint streams token-by-token responses from a hostile PE persona that has every financial number injected into its system context.

---

## Feature Inventory

| Feature | Where | Notes |
|---|---|---|
| 6-agent adversarial pipeline | `backend/agents/` | Sequential, typed, observable |
| Live SSE audit trail | `GET /api/stream/{job_id}` | 300ms replay with agent badges |
| React Flow node graph | `page.tsx` | Branching topology, live status pulses |
| 3-scenario Recharts chart | `page.tsx` | Revenue + Margin toggle |
| What-If sensitivity sliders | `page.tsx` | Frontend-only recalculation, no API call |
| XAI chain-of-thought accordion | `XAIPanel` component | Per-agent, expandable, shows real math |
| Breaking Point card | `page.tsx` | Dark-on-light contrast card, threshold + headroom |
| Interrogation Room | `POST /api/interrogate` | Stateful streaming chat, full context injected |
| Auto-TTS (AI speaks) | `speak()` + `ListenButton` | Web Speech API, prefers Daniel/Samantha voice |
| STT microphone input | `toggleMic()` | `webkitSpeechRecognition`, interim transcription |
| Global mute toggle | Navbar | Silences all TTS instantly |
| Listen buttons | Executive Memo + chat | Per-block playback |
| DEMO mode | `data_ingestion.py` | Instant run, zero external APIs |
| Pydantic schema validation | All agents | Field-level validators, retry on failure |
| Pytest suite | `tests/test_pipeline.py` | Schema, CAGR, validator constraints |
| Docker Compose | `docker-compose.yml` | Multi-stage builds, non-root users, healthcheck |
| Graceful degradation | Researcher + ingestion | Web search fallback, yfinance timeout guard |

---

## API Reference

| Endpoint | Method | Body / Params | Response |
|---|---|---|---|
| `GET /api/health` | — | — | `{"status": "ok"}` |
| `POST /api/analyse` | `{"ticker": "AAPL"}` | — | `{"job_id": "..."}` |
| `GET /api/result/{job_id}` | — | — | Full `PipelineResult` JSON |
| `GET /api/stream/{job_id}` | — | — | SSE: `AgentStep` events |
| `POST /api/interrogate` | `{"job_id": "...", "messages": [...]}` | — | SSE: token stream |
| `GET /api/tickers` | — | — | Suggested tickers |

Interactive docs at **http://localhost:8000/docs** (FastAPI Swagger UI).

---

## Running Tests

```bash
cd backend
pytest tests/ -v
```

The test suite covers:
- Schema validation: margin bounds, Critic must produce `revenue_adjustment_pct ≤ 0`, Upside must produce `≥ 0`
- Financial calculations: CAGR formula, average margin, single-year fallback
- Pipeline state: `PipelineResult` starts incomplete, `AgentStep` records correctly
- Integration assertion: downside revenue always lower than base revenue after critic applies haircut

---

## Limitations

**Financial model scope.** Three lines projected over 3 years: Revenue, Operating Margin, Net Income. A full 3-statement model (IS, BS, CF) was deliberately out of scope — the added precision would be false accuracy given yfinance data quality.

**In-memory job store.** Restarting the backend loses all results. A production version would use Redis or Postgres with a proper job queue.

**yfinance reliability.** An unofficial Yahoo Finance scraper. Can be rate-limited, return incomplete data, or fail on non-US tickers. The 5-second timeout and DEMO mode mitigate demo risk entirely.

**LLM non-determinism.** Despite Pydantic validation and retry logic, outputs are probabilistic. The XAI reasoning steps show the model's logic but cannot guarantee numerical accuracy. All outputs are labelled as estimates.

**Speech API browser support.** `SpeechRecognition` (STT) requires Chrome or Edge. `speechSynthesis` (TTS) works in all modern browsers but voice quality varies. A graceful alert fires if STT is unavailable.

**Web search availability.** Anthropic's `web_search_20260209` tool requires it to be enabled in the API account console. The fallback to knowledge-based research activates automatically.

---

## Third-Party Libraries & APIs

| Dependency | Version | Usage | Licence |
|---|---|---|---|
| Anthropic Claude API | `claude-opus-4-5` | All 6 agents + interrogation | [Anthropic AUP](https://www.anthropic.com/legal/aup) |
| Anthropic `web_search_20260209` | — | Researcher: live financial news | Anthropic server-side tool |
| yfinance | `0.2.40` | Historical income statement ingestion | Apache 2.0 (unofficial Yahoo data) |
| FastAPI | `0.111.0` | Backend REST + SSE framework | MIT |
| Pydantic v2 | `2.7.1` | Typed models + schema validation | MIT |
| Uvicorn | `0.29.0` | ASGI server | BSD |
| Next.js | `14.2.3` | Frontend framework | MIT |
| React Flow (reactflow) | `^11.11.3` | Live agent node graph | MIT |
| Recharts | `^2.12.7` | 3-scenario financial chart | MIT |
| Lucide React | `^0.383.0` | UI icons | ISC |
| Web Speech API | Native | TTS (AI speaks) + STT (mic input) | Browser-native, no licence |
| Pandas | `2.2.2` | Financial data processing | BSD |
| NumPy | `1.26.4` | Numerical utilities | BSD |
| pytest | `8.2.0` | Test suite | MIT |

---

## AI Tools Used in Development
To optimise for speed during the 48-hour window, I used Claude 3.5 Sonnet (via web UI / Cursor) as a coding assistant.

Where AI was used:

- *Generating the initial boilerplate for the FastAPI to Next.js SSE (Server-Sent Events) streaming connection.*

- *Typing out the exhaustive Pydantic models in schemas.py based on my architecture design.*

- *Troubleshooting React hydration errors and Recharts responsive container sizing.*

Where manual engineering was required:

- *Designing the sequential DAG (Directed Acyclic Graph) architecture so the agents pass state reliably instead of infinitely looping.*

- *Engineering the "Chain-of-Thought" (xai_reasoning) logic that forces the LLM to prove its math before outputting JSON.*

- *Writing the fallback mechanisms and caching for the yfinance data ingestion to ensure demo stability.*

### Key Prompts Used During Development
These are examples of the highly directive prompts used to scaffold the codebase, demonstrating an architecture-first approach to prompting.

Prompt 1: Scaffolding the SSE Backend (Focus on stability)

- *"I am building a multi-agent pipeline in FastAPI. I need an endpoint that runs a long-running Python function (5 sequential LLM calls). Instead of waiting 30 seconds for a single HTTP response, I need to stream the status of each agent to a Next.js frontend using Server-Sent Events (SSE). Write the FastAPI endpoint and the corresponding React useEffect hook to consume this stream. Do not use WebSockets. Handle the case where an agent throws a Pydantic validation error gracefully in the stream."*

Prompt 2: Building the UI Data Visualization (Focus on UI/UX)

- *"Write a React component using Recharts. It needs to display a line chart with 4 lines: Historical Revenue , Base Case, Upside Case , and Downside Case . The X-axis is years (2021 to 2026). The Y-axis should format numbers as billions (e.g., '$350B'). I will pass it a prop called FinancialModel which contains arrays for each scenario. Keep the styling extremely clean, like a Bloomberg Terminal or modern fintech app."*

Prompt 3: Enforcing Explainable AI (The XAI Hack)

- *"I have a Claude Haiku agent that outputs a Pydantic JSON model. However, I need to force it to 'think' mathematically before it generates the JSON to avoid hallucinations. Rewrite my system prompt so that Claude must first output a markdown block called xai_reasoning showing its exact math steps (CAGR calculation, margins), and then output the raw JSON block. Provide the Python regex needed to extract just the JSON block from this mixed text/JSON response."
Built over one weekend using **Claude (claude.ai)** as the primary coding assistant.*

All architecture decisions, system design, schema design, and implementation strategy were original. Claude was used to accelerate implementation, debug specific issues, and iterate on UI polish.

---

## Project Structure

```
finance-autopilot/
├── backend/
│   ├── agents/
│   │   ├── researcher.py      # Web search + fallback
│   │   ├── base_modeler.py    # CAGR extrapolation + XAI
│   │   ├── critic.py          # Devil's Advocate + XAI
│   │   ├── upside_modeler.py  # Bull case + XAI
│   │   └── advisor.py         # Synthesis + Breaking Point
│   ├── models/
│   │   └── schemas.py         # All Pydantic models
│   ├── utils/
│   │   ├── data_ingestion.py  # yfinance + DEMO fallback
│   │   └── llm_client.py      # Anthropic wrapper + retry
│   ├── tests/
│   │   └── test_pipeline.py   # pytest suite
│   ├── pipeline.py            # Orchestrator
│   ├── main.py                # FastAPI app + SSE + interrogate
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   └── src/app/
│       ├── page.tsx           # Full application UI
│       ├── layout.tsx
│       └── globals.css        # CSS variables, fonts, animations
│   ├── package.json
│   └── Dockerfile
├── docker-compose.yml
├── .env.example
└── README.md
```
