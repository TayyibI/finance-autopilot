"use client";

import {
  useState, useRef, useEffect, useCallback, useMemo, useReducer
} from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Legend,
} from "recharts";
import ReactFlow, {
  Node, Edge, Background, BackgroundVariant,
  useNodesState, useEdgesState,
} from "reactflow";
import "reactflow/dist/style.css";
import {
  Play, Square, MessageSquare, TrendingUp, TrendingDown,
  AlertTriangle, ChevronRight, Send, Mic, MicOff,
  Volume2, VolumeX, ChevronDown, ChevronUp, Brain,
} from "lucide-react";

// ─── Types ────────────────────────────────────────────────────────────────────

interface YearProjection {
  year: number; revenue_bn: number;
  operating_margin_pct: number; net_income_bn: number;
}
interface ScenarioModel {
  scenario: string; projections: YearProjection[];
  key_assumptions: string[]; narrative: string;
}
interface FinancialModel {
  ticker: string; company_name: string;
  historical: YearProjection[];
  base: ScenarioModel; upside: ScenarioModel; downside: ScenarioModel;
}
interface BreakingPoint {
  variable: string; threshold: string; consequence: string;
  current_value: string; distance_from_break: string;
}
interface AdvisorOutput {
  strategic_options: string[]; recommended_option: string;
  rationale: string; key_risks: string[]; red_flags: string[];
  tough_questions: string[]; executive_memo: string;
  breaking_point: BreakingPoint;
}
interface ResearcherOutput {
  company_name: string; sector: string;
  recent_headlines: string[]; identified_risks: string[];
  identified_tailwinds: string[]; summary: string;
}
interface CriticOutput {
  xai_reasoning?: XAIStep[];
  challenged_assumptions: string[]; risk_drivers: string[];
  revenue_adjustment_pct: number; margin_adjustment_pct: number;
  downside_projections: YearProjection[]; critique_summary: string;
}
interface XAIStep { step: number; description: string; calculation: string; result: string; }
interface BaseModelerOutput {
  xai_reasoning?: XAIStep[];
  projections: YearProjection[]; methodology: string; key_assumptions: string[];
}
interface UpsideModelerOutput {
  xai_reasoning?: XAIStep[];
  upside_drivers: string[]; revenue_adjustment_pct: number;
  margin_adjustment_pct: number; upside_projections: YearProjection[];
  bull_case_summary: string;
}
interface PipelineResult {
  ticker: string;
  steps: { agent: string; status: string; message: string; timestamp: string }[];
  researcher?: ResearcherOutput;
  base_modeler?: BaseModelerOutput;
  critic?: CriticOutput;
  upside_modeler?: UpsideModelerOutput;
  advisor?: AdvisorOutput; financial_model?: FinancialModel;
  error?: string; completed: boolean;
}
interface StreamStep {
  agent: string; status: string; message: string; timestamp: string; done?: boolean;
}
interface ChatMessage { role: "user" | "assistant"; content: string; }

// ─── Pipeline config ──────────────────────────────────────────────────────────

const PIPELINE_AGENTS = [
  { id: "DataIngestion", label: "DATA\nINGESTION", icon: "⬇", color: "#3d5a80" },
  { id: "Researcher", label: "RESEARCHER", icon: "⊕", color: "#1a5c3a" },
  { id: "BaseModeler", label: "BASE\nMODELER", icon: "≡", color: "#1a2744" },
  { id: "Critic", label: "DEVIL'S\nADVOCATE", icon: "⚔", color: "#c0392b" },
  { id: "UpsideModeler", label: "BULL\nANALYST", icon: "↑", color: "#1a5c3a" },
  { id: "Advisor", label: "ADVISOR", icon: "★", color: "#1a2744" },
];



// ─── React Flow node ──────────────────────────────────────────────────────────

function AgentNode({ data }: { data: any }) {
  const { label, icon, color, status } = data;
  const isRunning = status === "running"; const isDone = status === "done";
  return (
    <div style={{
      width: 100, minHeight: 76, background: isDone ? color : isRunning ? "#fff" : "#f5f4f0",
      border: `1.5px solid ${isDone || isRunning ? color : "#d0ccc5"}`, borderRadius: 8,
      display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
      padding: "10px 6px", gap: 5, transition: "all 0.35s ease",
      boxShadow: isRunning ? `0 0 0 3px ${color}40,0 4px 20px ${color}30` : isDone ? `0 2px 8px ${color}25` : "0 1px 3px rgba(0,0,0,0.06)",
      animation: isRunning ? "nodeGlow 1.4s ease-in-out infinite" : "none",
      cursor: "default", position: "relative",
    }}>
      <div style={{
        position: "absolute", top: 6, right: 6, width: 6, height: 6, borderRadius: "50%",
        background: isDone ? "#1a5c3a" : isRunning ? color : "#d0ccc5",
        animation: isRunning ? "pulseDot 1.2s infinite" : "none"
      }} />
      <span style={{ fontSize: 16 }}>{icon}</span>
      <span style={{
        color: isDone ? "white" : isRunning ? color : "#8c8580", fontSize: 8.5,
        fontFamily: "var(--font-mono)", fontWeight: 600, letterSpacing: 0.8,
        textAlign: "center", lineHeight: 1.4, whiteSpace: "pre-line"
      }}>{label}</span>
      {isDone && <span style={{ color: "rgba(255,255,255,0.8)", fontSize: 9 }}>✓</span>}
      {isRunning && <span style={{ color, fontSize: 7, letterSpacing: 1.5, fontFamily: "var(--font-mono)", animation: "pulseDot 1s infinite" }}>LIVE</span>}
    </div>
  );
}

const nodeTypes = { agentNode: AgentNode };

function buildInitialGraph(): { nodes: Node[]; edges: Edge[] } {
  const pos: Record<string, { x: number; y: number }> = {
    DataIngestion: { x: 0, y: 80 }, Researcher: { x: 160, y: 80 }, BaseModeler: { x: 320, y: 80 },
    Critic: { x: 490, y: 10 }, UpsideModeler: { x: 490, y: 150 }, Advisor: { x: 660, y: 80 },
  };
  const nodes: Node[] = PIPELINE_AGENTS.map((a) => ({
    id: a.id, type: "agentNode", position: pos[a.id],
    data: { label: a.label, icon: a.icon, color: a.color, status: "idle" },
    draggable: false, selectable: false,
  }));
  const edges: Edge[] = [
    ["DataIngestion", "Researcher"], ["Researcher", "BaseModeler"],
    ["BaseModeler", "Critic"], ["BaseModeler", "UpsideModeler"],
    ["Critic", "Advisor"], ["UpsideModeler", "Advisor"],
  ].map(([src, tgt]) => ({ id: `${src}-${tgt}`, source: src, target: tgt, style: { stroke: "#d0ccc5", strokeWidth: 1.5 }, animated: false }));
  return { nodes, edges };
}

// ─── Equalizer ────────────────────────────────────────────────────────────────

function Equalizer({ active, color = "#1a5c3a" }: { active: boolean; color?: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 14 }}>
      {[1, 2, 3, 4].map(i => <div key={i} style={{
        width: 3, borderRadius: 1, background: color,
        height: active ? undefined : 3, minHeight: 3, maxHeight: 14,
        animation: active ? `eq${i} ${0.35 + i * 0.1}s ease-in-out infinite alternate` : "none"
      }} />)}
    </div>
  );
}

// ─── XAI Accordion ───────────────────────────────────────────────────────────

function XAIPanel({ steps, agentLabel, color }: { steps: XAIStep[]; agentLabel: string; color: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div style={{ marginTop: 12, border: `1px solid ${color}30`, borderRadius: 8, overflow: "hidden" }}>
      <button onClick={() => setOpen(!open)} style={{
        width: "100%", padding: "9px 14px", background: `${color}08`,
        border: "none", cursor: "pointer", display: "flex", alignItems: "center", gap: 8,
        fontFamily: "var(--font-sans)", fontSize: 12, color: "var(--text-secondary)",
        transition: "background 0.2s",
      }}>
        <Brain size={13} color={color} />
        <span style={{ fontWeight: 600, color }}>Show AI Reasoning</span>
        <span style={{ fontSize: 10, color: "var(--text-faint)", marginLeft: 2 }}>({steps.length} steps · {agentLabel})</span>
        <span style={{ marginLeft: "auto" }}>
          {open ? <ChevronUp size={13} color="var(--text-muted)" /> : <ChevronDown size={13} color="var(--text-muted)" />}
        </span>
      </button>
      {open && (
        <div style={{ padding: "14px 16px", background: "white", borderTop: `1px solid ${color}20` }}>
          <p style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", letterSpacing: 0.8, marginBottom: 12 }}>
            CHAIN-OF-THOUGHT · EXPLAINABLE AI
          </p>
          {steps.map((s, i) => (
            <div key={i} style={{
              marginBottom: i < steps.length - 1 ? 14 : 0,
              paddingBottom: i < steps.length - 1 ? 14 : 0,
              borderBottom: i < steps.length - 1 ? `1px solid ${color}15` : "none",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 5 }}>
                <span style={{
                  width: 20, height: 20, borderRadius: "50%", background: `${color}15`,
                  border: `1px solid ${color}40`, display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 10, color, fontWeight: 700, fontFamily: "var(--font-mono)", flexShrink: 0
                }}>{s.step}</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>{s.description}</span>
              </div>
              <div style={{
                marginLeft: 28, padding: "8px 12px", background: "#f8f7f5",
                borderRadius: 6, border: "1px solid var(--border)"
              }}>
                <p style={{
                  fontSize: 11, fontFamily: "var(--font-mono)", color: "#1e40af",
                  marginBottom: 4, lineHeight: 1.5
                }}>{s.calculation}</p>
                <p style={{
                  fontSize: 11, fontFamily: "var(--font-mono)", color: color,
                  fontWeight: 600
                }}>→ {s.result}</p>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Chart tooltip ────────────────────────────────────────────────────────────

const ChartTooltip = ({ active, payload, label, metric }: any) => {
  if (!active || !payload?.length) return null;
  const unit = metric === "revenue" ? "B" : "%";
  const prefix = metric === "revenue" ? "$" : "";
  return (
    <div style={{
      background: "white", border: "1px solid #e2ddd6", borderRadius: 6,
      padding: "10px 14px", boxShadow: "0 4px 16px rgba(0,0,0,0.1)", fontFamily: "var(--font-sans)"
    }}>
      <p style={{ color: "#8c8580", fontSize: 11, marginBottom: 6 }}>{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color, fontSize: 12, margin: "2px 0", fontWeight: 500 }}>
          {p.name}: <strong>{prefix}{p.value?.toFixed(metric === "revenue" ? 2 : 1)}{unit}</strong>
        </p>
      ))}
    </div>
  );
};

// ─── Listen button ────────────────────────────────────────────────────────────

function ListenButton({ text, muted }: { text: string; muted: boolean }) {
  const [playing, setPlaying] = useState(false);
  const speak = useCallback(() => {
    if (muted) return;
    if (playing) { window.speechSynthesis.cancel(); setPlaying(false); return; }
    const utt = new SpeechSynthesisUtterance(text);
    utt.rate = 0.9; utt.pitch = 0.88;
    const voices = window.speechSynthesis.getVoices();
    const v = voices.find(v => v.name.includes("Daniel") || v.name.includes("Samantha") || v.lang === "en-GB")
      ?? voices.find(v => v.lang.startsWith("en")) ?? null;
    if (v) utt.voice = v;
    utt.onend = () => setPlaying(false);
    utt.onerror = () => setPlaying(false);
    window.speechSynthesis.speak(utt);
    setPlaying(true);
  }, [text, muted, playing]);

  return (
    <button onClick={speak} title={muted ? "Audio muted" : playing ? "Stop" : "Listen"}
      style={{
        display: "flex", alignItems: "center", gap: 5, padding: "4px 10px",
        borderRadius: 5, border: "1px solid var(--border)", background: playing ? "#f0fdf4" : "var(--surface-2)",
        color: muted ? "var(--text-faint)" : playing ? "#1a5c3a" : "var(--text-muted)",
        fontFamily: "var(--font-sans)", fontSize: 11, cursor: muted ? "not-allowed" : "pointer",
        transition: "all 0.2s", flexShrink: 0
      }}>
      {playing ? <><Equalizer active color="#1a5c3a" /><span>Stop</span></> : <><Volume2 size={11} /><span>Listen</span></>}
    </button>
  );
}

// ─── Shared UI ────────────────────────────────────────────────────────────────

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
      <span style={{
        fontSize: 11, color: "var(--text-muted)", fontFamily: "var(--font-mono)",
        letterSpacing: 0.8, fontWeight: 500, whiteSpace: "nowrap"
      }}>{children}</span>
      <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
    </div>
  );
}

function InfoCard({ title, accent, icon, children }: {
  title: string; accent: string; icon?: React.ReactNode; children: React.ReactNode
}) {
  return (
    <div style={{
      background: "white", border: "1px solid var(--border)", borderRadius: 8,
      padding: "14px 16px", borderTop: `3px solid ${accent}`, boxShadow: "0 1px 3px rgba(0,0,0,0.04)"
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
        {icon && <span style={{ color: accent }}>{icon}</span>}
        <p style={{
          fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)",
          letterSpacing: 0.8, fontWeight: 600
        }}>{title.toUpperCase()}</p>
      </div>
      {children}
    </div>
  );
}

function BulletRow({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
      <span style={{ color, fontSize: 12, flexShrink: 0, marginTop: 1 }}>›</span>
      <span style={{ color: "var(--text-secondary)", fontSize: 12, lineHeight: 1.55 }}>{children}</span>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function Page() {
  const [ticker, setTicker] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<PipelineResult | null>(null);
  const [streamDone, setStreamDone] = useState(false);
  const [streamLog, setStreamLog] = useState<StreamStep[]>([]);
  const [activeTab, setActiveTab] = useState<"analysis" | "interrogation">("analysis");
  const eventSourceRef = useRef<EventSource | null>(null);

  // React Flow
  const { nodes: initNodes, edges: initEdges } = buildInitialGraph();
  const [nodes, setNodes, onNodesChange] = useNodesState(initNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initEdges);

  // Global mute toggle
  const [muted, setMuted] = useState(false);

  // Chart metric toggle
  const [chartMetric, setChartMetric] = useState<"revenue" | "margin">("revenue");

  // What-If sliders
  const [revenueAdj, setRevenueAdj] = useState(0);
  const [marginAdj, setMarginAdj] = useState(0);

  // Interrogation Room
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const [interrogationStarted, setInterrogationStarted] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [isListening, setIsListening] = useState(false);
  const recognitionRef = useRef<any>(null);
  const chatBottomRef = useRef<HTMLDivElement>(null);
  const logBottomRef = useRef<HTMLDivElement>(null);
  const ttsQueueRef = useRef<string | null>(null);

  useEffect(() => { /* Auto-scroll disabled by user request */ }, [chatMessages]);
  useEffect(() => { logBottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [streamLog]);

  // Graph helpers
  const updateNodeStatus = useCallback((agentId: string, status: string) => {
    const cfg = PIPELINE_AGENTS.find(a => a.id === agentId);
    setNodes(nds => nds.map(n => n.id !== agentId ? n : { ...n, data: { ...n.data, status } }));
    if (status === "running") setEdges(eds => eds.map(e => e.target === agentId ? { ...e, animated: true, style: { stroke: cfg?.color ?? "#1a2744", strokeWidth: 2 } } : e));
    if (status === "done") setEdges(eds => eds.map(e => e.target === agentId ? { ...e, animated: false, style: { stroke: "#1a5c3a55", strokeWidth: 1.5 } } : e));
  }, [setNodes, setEdges]);

  const resetGraph = useCallback(() => { const { nodes: f, edges: fe } = buildInitialGraph(); setNodes(f); setEdges(fe); }, [setNodes, setEdges]);

  // Submit
  const handleSubmit = useCallback(async (t?: string) => {
    const sym = (t ?? ticker).trim().toUpperCase();
    if (!sym) return;
    if (!t) setTicker(sym);
    setLoading(true); setError(null); setResult(null); setStreamDone(false); setStreamLog([]);
    setRevenueAdj(0); setMarginAdj(0); setChatMessages([]); setInterrogationStarted(false);
    setActiveTab("analysis"); setChartMetric("revenue");
    resetGraph(); eventSourceRef.current?.close(); window.speechSynthesis?.cancel();

    try {
      const res = await fetch("/api/analyse", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticker: sym }),
      });
      if (!res.ok) { const d = await res.json().catch(() => ({})); throw new Error(d.detail ?? `HTTP ${res.status}`); }
      const { job_id } = await res.json();
      setCurrentJobId(job_id);
      const es = new EventSource(`/api/stream/${job_id}`);
      eventSourceRef.current = es;
      es.onmessage = (ev) => {
        const data: StreamStep = JSON.parse(ev.data);
        if (data.done) {
          es.close(); setStreamDone(true);
          fetch(`/api/result/${job_id}`).then(r => r.json()).then((full: PipelineResult) => { setResult(full); setLoading(false); }).catch(() => { setError("Failed to load result."); setLoading(false); });
        } else { setStreamLog(prev => [...prev, data]); updateNodeStatus(data.agent, data.status); }
      };
      es.onerror = () => { es.close(); setStreamDone(true); setLoading(false); };
    } catch (e: any) { setError(e.message ?? "Unknown error"); setLoading(false); }
  }, [ticker, resetGraph, updateNodeStatus]);

  // Chart data
  const chartData = useMemo(() => {
    if (!result?.financial_model) return [];
    const fm = result.financial_model;
    const adjG = revenueAdj / 100;
    const data: any[] = [];

    fm.historical.forEach(p => data.push({
      year: p.year,
      Historical: chartMetric === "revenue" ? p.revenue_bn : p.operating_margin_pct,
      Base: null, Upside: null, Downside: null,
    }));

    fm.base.projections.forEach((p, i) => {
      const up = fm.upside.projections[i];
      const dn = fm.downside.projections[i];
      if (chartMetric === "revenue") {
        data.push({
          year: p.year, Historical: null,
          Base: parseFloat(Math.max(0, p.revenue_bn * (1 + adjG * (i + 1))).toFixed(3)),
          Upside: parseFloat(Math.max(0, (up?.revenue_bn ?? p.revenue_bn) * (1 + adjG * (i + 1))).toFixed(3)),
          Downside: parseFloat(Math.max(0, (dn?.revenue_bn ?? p.revenue_bn) * (1 + adjG * (i + 1))).toFixed(3)),
        });
      } else {
        data.push({
          year: p.year, Historical: null,
          Base: parseFloat((p.operating_margin_pct + marginAdj).toFixed(2)),
          Upside: parseFloat(((up?.operating_margin_pct ?? p.operating_margin_pct) + marginAdj).toFixed(2)),
          Downside: parseFloat(((dn?.operating_margin_pct ?? p.operating_margin_pct) + marginAdj).toFixed(2)),
        });
      }
    });
    return data;
  }, [result, revenueAdj, marginAdj, chartMetric]);

  const lastHistYear = result?.financial_model?.historical.at(-1)?.year;

  // TTS helper (respects mute)
  const speak = useCallback((text: string) => {
    if (muted || !text) return;
    window.speechSynthesis.cancel();
    const utt = new SpeechSynthesisUtterance(text);
    utt.rate = 0.88; utt.pitch = 0.85;
    const voices = window.speechSynthesis.getVoices();
    const v = voices.find(v => v.name.includes("Daniel") || v.name.includes("Samantha") || v.lang === "en-GB")
      ?? voices.find(v => v.lang.startsWith("en")) ?? null;
    if (v) utt.voice = v;
    window.speechSynthesis.speak(utt);
  }, [muted]);

  // STT (microphone)
  const toggleMic = useCallback(() => {
    const SpeechRecognition = (window as any).SpeechRecognition ?? (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) { alert("Speech recognition not supported in this browser."); return; }
    if (isListening) {
      recognitionRef.current?.stop(); setIsListening(false); return;
    }
    const rec = new SpeechRecognition();
    rec.lang = "en-US"; rec.interimResults = true; rec.continuous = false;
    rec.onresult = (e: any) => {
      const transcript = Array.from(e.results).map((r: any) => r[0].transcript).join("");
      setChatInput(transcript);
    };
    rec.onend = () => setIsListening(false);
    rec.onerror = () => setIsListening(false);
    rec.start();
    recognitionRef.current = rec;
    setIsListening(true);
  }, [isListening]);

  // Interrogation
  const startInterrogation = useCallback(async () => {
    if (!currentJobId || !result) return;
    setInterrogationStarted(true); setActiveTab("interrogation"); setChatLoading(true); setChatMessages([]);
    let text = "";
    try {
      const res = await fetch("/api/interrogate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: currentJobId, messages: [{ role: "user", content: "__OPEN__" }] }),
      });
      const reader = res.body!.getReader(); const decoder = new TextDecoder();
      setChatLoading(false); setChatMessages([{ role: "assistant", content: "" }]);
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        for (const line of decoder.decode(value).split("\n")) {
          if (!line.startsWith("data: ")) continue;
          try { const d = JSON.parse(line.slice(6)); if (d.done) break; if (d.token) { text += d.token; setChatMessages([{ role: "assistant", content: text }]); } } catch { }
        }
      }
      speak(text);
    } catch { setChatLoading(false); setChatMessages([{ role: "assistant", content: "Connection failed." }]); }
  }, [currentJobId, result, speak]);

  const sendChatMessage = useCallback(async () => {
    if (!chatInput.trim() || !currentJobId || chatLoading) return;
    recognitionRef.current?.stop(); setIsListening(false);
    const userMsg: ChatMessage = { role: "user", content: chatInput.trim() };
    const newHistory = [...chatMessages, userMsg];
    setChatMessages(newHistory); setChatInput(""); setChatLoading(true);
    let text = "";
    try {
      const res = await fetch("/api/interrogate", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_id: currentJobId, messages: newHistory }),
      });
      const reader = res.body!.getReader(); const decoder = new TextDecoder();
      setChatLoading(false); setChatMessages([...newHistory, { role: "assistant", content: "" }]);
      while (true) {
        const { done, value } = await reader.read(); if (done) break;
        for (const line of decoder.decode(value).split("\n")) {
          if (!line.startsWith("data: ")) continue;
          try { const d = JSON.parse(line.slice(6)); if (d.done) break; if (d.token) { text += d.token; setChatMessages([...newHistory, { role: "assistant", content: text }]); } } catch { }
        }
      }
      speak(text);
    } catch { setChatLoading(false); setChatMessages([...newHistory, { role: "assistant", content: "Error — try again." }]); }
  }, [chatInput, chatMessages, currentJobId, chatLoading, speak]);

  useEffect(() => () => { eventSourceRef.current?.close(); window.speechSynthesis?.cancel(); }, []);

  const yAxisLabel = chartMetric === "revenue" ? "Revenue ($B)" : "Op. Margin (%)";
  const yFormatter = chartMetric === "revenue" ? (v: number) => `$${v}B` : (v: number) => `${v}%`;

  // ── RENDER ────────────────────────────────────────────────────────────────

  return (
    <>
      <style>{`
        @keyframes nodeGlow{0%,100%{box-shadow:0 0 0 2px rgba(26,39,68,.3),0 4px 16px rgba(26,39,68,.15)}50%{box-shadow:0 0 0 3px rgba(26,39,68,.5),0 6px 24px rgba(26,39,68,.28)}}
        @keyframes pulseDot{0%,100%{opacity:1;transform:scale(1)}50%{opacity:.4;transform:scale(.7)}}
        @keyframes eq1{from{height:4px}to{height:14px}} @keyframes eq2{from{height:9px}to{height:4px}}
        @keyframes eq3{from{height:13px}to{height:3px}} @keyframes eq4{from{height:5px}to{height:15px}}
        @keyframes blink{0%,100%{opacity:1}50%{opacity:0}} @keyframes spin{to{transform:rotate(360deg)}}
        @keyframes fadeUp{from{opacity:0;transform:translateY(10px)}to{opacity:1;transform:translateY(0)}}
        @keyframes typing{0%,60%,100%{opacity:0}30%{opacity:1}}
        @keyframes micPulse{0%,100%{box-shadow:0 0 0 0 rgba(192,57,43,.4)}70%{box-shadow:0 0 0 8px rgba(192,57,43,0)}}
        .fade-up{animation:fadeUp .4s ease forwards} .fade-in{animation:fadeUp .3s ease forwards}
        .chat-cursor::after{content:'|';animation:blink .7s infinite;color:var(--accent-navy);margin-left:1px}
        .react-flow__background{background:transparent!important} .react-flow__renderer{background:transparent!important} .react-flow__pane{cursor:default!important}
      `}</style>

      <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", flexDirection: "column" }}>

        {/* Navbar */}
        <header style={{
          background: "var(--accent-navy)", color: "white", padding: "0 28px", height: 56,
          display: "flex", alignItems: "center", justifyContent: "space-between",
          position: "sticky", top: 0, zIndex: 300, boxShadow: "0 2px 12px rgba(0,0,0,0.18)"
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <span style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 19 }}>Finance Autopilot</span>
            <span style={{ fontSize: 9, fontFamily: "var(--font-mono)", opacity: 0.4, letterSpacing: 1 }}>ADVERSARIAL ANALYSIS ENGINE v3</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {result?.completed && (
              <button onClick={() => setActiveTab(activeTab === "interrogation" ? "analysis" : "interrogation")}
                style={{
                  display: "flex", alignItems: "center", gap: 7, padding: "5px 14px", borderRadius: 5,
                  background: activeTab === "interrogation" ? "rgba(255,255,255,0.15)" : "rgba(255,255,255,0.08)",
                  border: "1px solid rgba(255,255,255,0.2)", color: "white",
                  fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: 500, cursor: "pointer"
                }}>
                <MessageSquare size={13} />Interrogation Room
                {activeTab === "interrogation" && <span style={{ width: 6, height: 6, borderRadius: "50%", background: "#ef4444" }} />}
              </button>
            )}
            {/* Global mute */}
            <button onClick={() => { setMuted(m => !m); window.speechSynthesis?.cancel(); }}
              title={muted ? "Unmute audio" : "Mute audio"}
              style={{
                width: 34, height: 34, borderRadius: 6, border: "1px solid rgba(255,255,255,0.2)",
                background: muted ? "rgba(239,68,68,0.2)" : "rgba(255,255,255,0.08)",
                color: "white", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center"
              }}>
              {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
            </button>
            <span style={{ fontSize: 10, opacity: 0.35, fontFamily: "var(--font-mono)" }}>Not investment advice</span>
          </div>
        </header>

        {/* Layout */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 400px", flex: 1, overflow: "hidden", height: "calc(100vh - 56px)" }}>

          {/* ════ LEFT ════ */}
          <div style={{ overflowY: "auto", padding: "26px 30px", background: "var(--bg-paper)" }}>

            {/* Search Replacement - Button Grid */}
            <div style={{ marginBottom: 26 }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 16 }}>
                {[
                  { name: "Ryanair", ticker: "RYA.IR" },
                  { name: "Kingspan Group", ticker: "KSP.IR" },
                  { name: "Kerry Group", ticker: "KRZ.IR" },
                  { name: "Apple", ticker: "AAPL" },
                  { name: "Microsoft", ticker: "MSFT" },
                  { name: "NVIDIA", ticker: "NVDA" },
                ].map(company => (
                  <button
                    key={company.ticker}
                    onClick={() => handleSubmit(company.ticker)}
                    disabled={loading}
                    style={{
                      display: "flex", flexDirection: "column",
                      alignItems: "flex-start", padding: "16px 20px",
                      background: "white", border: "1.5px solid var(--border)",
                      borderRadius: 12, cursor: loading ? "not-allowed" : "pointer",
                      transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
                      boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
                    }}
                    onMouseEnter={e => {
                      if (!loading) {
                        e.currentTarget.style.borderColor = "var(--accent-navy)";
                        e.currentTarget.style.boxShadow = "0 8px 24px rgba(26, 39, 68, 0.12)";
                        e.currentTarget.style.transform = "translateY(-2px)";
                      }
                    }}
                    onMouseLeave={e => {
                      if (!loading) {
                        e.currentTarget.style.borderColor = "var(--border)";
                        e.currentTarget.style.boxShadow = "0 2px 8px rgba(0,0,0,0.04)";
                        e.currentTarget.style.transform = "translateY(0)";
                      }
                    }}
                  >
                    <span style={{ color: "var(--text-primary)", fontSize: 14, fontWeight: 700, fontFamily: "var(--font-sans)", letterSpacing: "-0.01em" }}>
                      {company.name}
                    </span>
                    <span style={{ color: "var(--text-muted)", fontSize: 11, fontFamily: "var(--font-mono)", marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
                      <div style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--accent-navy)" }} />
                      {company.ticker}
                    </span>
                  </button>
                ))}
              </div>
              <button
                onClick={() => handleSubmit("DEMO")}
                disabled={loading}
                style={{
                  width: "100%", padding: "16px",
                  background: "var(--accent-navy)",
                  border: "none", borderRadius: 12,
                  color: "white", fontSize: 14, fontWeight: 700, fontFamily: "var(--font-sans)", letterSpacing: "0.5px",
                  cursor: loading ? "not-allowed" : "pointer",
                  display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
                  boxShadow: "0 4px 14px rgba(26, 39, 68, 0.35)",
                  transition: "all 0.25s cubic-bezier(0.4, 0, 0.2, 1)",
                }}
                onMouseEnter={e => {
                  if (!loading) {
                    e.currentTarget.style.transform = "translateY(-2px)";
                    e.currentTarget.style.boxShadow = "0 6px 20px rgba(26, 39, 68, 0.45)";
                  }
                }}
                onMouseLeave={e => {
                  if (!loading) {
                    e.currentTarget.style.transform = "translateY(0)";
                    e.currentTarget.style.boxShadow = "0 4px 14px rgba(26, 39, 68, 0.35)";
                  }
                }}
              >
                ⚡ RUN DEMO PIPELINE ⚡
              </button>

              {error && <div style={{
                marginTop: 12, padding: "10px 14px", borderRadius: 8,
                background: "#fef2f2", border: "1px solid #fca5a5", color: "#991b1b", fontSize: 13
              }}>⚠ {error}</div>}
            </div>

            {/* Spinner */}
            {loading && !result && (
              <div style={{ textAlign: "center", padding: "48px 0", color: "var(--text-muted)" }}>
                <div style={{
                  width: 36, height: 36, borderRadius: "50%", border: "2px solid var(--border)",
                  borderTopColor: "var(--accent-navy)", margin: "0 auto 16px", animation: "spin 0.8s linear infinite"
                }} />
                <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
                <p style={{ fontSize: 14, fontWeight: 500 }}>Agents running — watch the pipeline →</p>
                <p style={{ fontSize: 12, marginTop: 4, color: "var(--text-faint)" }}>Typically 60–120 seconds</p>
              </div>
            )}

            {/* ANALYSIS TAB */}
            {activeTab === "analysis" && (
              <>
                {/* Sliders */}
                {result?.financial_model && (
                  <div style={{
                    background: "white", border: "1px solid var(--border)", borderRadius: 10,
                    padding: "18px 22px", marginBottom: 22, boxShadow: "0 1px 4px rgba(0,0,0,0.05)"
                  }} className="fade-up">
                    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16 }}>
                      <div>
                        <h3 style={{ fontWeight: 600, fontSize: 14 }}>What-If Sensitivity</h3>
                        <p style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>Adjust assumptions — chart updates instantly</p>
                      </div>
                      {(revenueAdj !== 0 || marginAdj !== 0) && (
                        <button onClick={() => { setRevenueAdj(0); setMarginAdj(0); }}
                          style={{
                            fontSize: 11, padding: "4px 12px", borderRadius: 5,
                            border: "1px solid var(--border)", background: "var(--surface-2)",
                            color: "var(--text-secondary)", cursor: "pointer"
                          }}>Reset</button>
                      )}
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22 }}>
                      {[
                        { label: "Revenue Growth Adj.", min: -10, max: 10, step: 0.5, val: revenueAdj, set: setRevenueAdj, unit: "%", lo: "−10%", hi: "+10%" },
                        { label: "Operating Margin Adj.", min: -5, max: 5, step: 0.25, val: marginAdj, set: setMarginAdj, unit: "pp", lo: "−5pp", hi: "+5pp" },
                      ].map(({ label, min, max, step, val, set, unit, lo, hi }) => (
                        <div key={label}>
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 8 }}>
                            <span style={{ fontSize: 12, color: "var(--text-secondary)", fontWeight: 500 }}>{label}</span>
                            <span style={{
                              fontSize: 12, fontWeight: 700, fontFamily: "var(--font-mono)",
                              color: val > 0 ? "var(--col-upside)" : val < 0 ? "var(--col-down)" : "var(--text-muted)"
                            }}>
                              {val > 0 ? "+" : ""}{val.toFixed(1)}{unit}
                            </span>
                          </div>
                          <input type="range" min={min} max={max} step={step} value={val}
                            onChange={e => set(parseFloat(e.target.value))} />
                          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 4 }}>
                            <span style={{ fontSize: 10, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>{lo}</span>
                            <span style={{ fontSize: 10, color: "var(--text-faint)", fontFamily: "var(--font-mono)" }}>{hi}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* CHART */}
                {chartData.length > 0 && result?.financial_model && (
                  <div style={{
                    background: "white", border: "1px solid var(--border)", borderRadius: 10,
                    padding: "22px 24px", marginBottom: 22, boxShadow: "0 1px 4px rgba(0,0,0,0.05)"
                  }} className="fade-up">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 18 }}>
                      <div>
                        <p style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", letterSpacing: 0.8, marginBottom: 4 }}>
                          3-SCENARIO FINANCIAL MODEL
                        </p>
                        <h2 style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 22, fontWeight: 400 }}>
                          {result.financial_model.company_name}
                          <span style={{ fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--text-muted)", marginLeft: 10, fontStyle: "normal" }}>{result.financial_model.ticker}</span>
                        </h2>
                      </div>
                      {/* Metric toggle */}
                      <div style={{ display: "flex", background: "var(--surface-2)", borderRadius: 7, padding: 3, border: "1px solid var(--border)", gap: 2 }}>
                        {(["revenue", "margin"] as const).map(m => (
                          <button key={m} onClick={() => setChartMetric(m)}
                            style={{
                              padding: "5px 14px", borderRadius: 5, border: "none", cursor: "pointer",
                              background: chartMetric === m ? "white" : "transparent",
                              color: chartMetric === m ? "var(--accent-navy)" : "var(--text-muted)",
                              fontFamily: "var(--font-sans)", fontSize: 12, fontWeight: chartMetric === m ? 600 : 400,
                              boxShadow: chartMetric === m ? "0 1px 4px rgba(0,0,0,0.1)" : "none",
                              transition: "all 0.2s"
                            }}>
                            {m === "revenue" ? "Revenue ($B)" : "Margin (%)"}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Legend */}
                    <div style={{ display: "flex", gap: 16, marginBottom: 14, flexWrap: "wrap" }}>
                      {[{ l: "Upside", c: "var(--col-upside)" }, { l: "Base", c: "var(--col-base)" }, { l: "Downside", c: "var(--col-down)" }, { l: "Historical", c: "var(--col-hist)" }].map(({ l, c }) => (
                        <span key={l} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "var(--text-secondary)" }}>
                          <span style={{ width: 20, height: 2.5, background: c, borderRadius: 2, display: "inline-block" }} />{l}
                        </span>
                      ))}
                    </div>

                    <ResponsiveContainer width="100%" height={240}>
                      <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#f0ede8" />
                        <XAxis dataKey="year" stroke="#c8c0b4" tick={{ fontSize: 11, fill: "#8c8580" }} />
                        <YAxis stroke="#c8c0b4" tick={{ fontSize: 11, fill: "#8c8580" }} tickFormatter={yFormatter} width={58} />
                        <Tooltip content={<ChartTooltip metric={chartMetric} />} />
                        {lastHistYear && <ReferenceLine x={lastHistYear} stroke="#d0ccc5" strokeDasharray="4 3" label={{ value: "Forecast →", position: "insideTopRight", fill: "#b8b0a8", fontSize: 10 }} />}
                        <Line dataKey="Historical" stroke="var(--col-hist)" strokeWidth={2} dot={{ r: 3 }} connectNulls />
                        <Line dataKey="Base" stroke="var(--col-base)" strokeWidth={2} dot={{ r: 3 }} strokeDasharray="6 3" connectNulls />
                        <Line dataKey="Upside" stroke="var(--col-upside)" strokeWidth={2} dot={{ r: 3 }} strokeDasharray="6 3" connectNulls />
                        <Line dataKey="Downside" stroke="var(--col-down)" strokeWidth={2} dot={{ r: 3 }} strokeDasharray="6 3" connectNulls />
                      </LineChart>
                    </ResponsiveContainer>

                    {/* Scenario cards */}
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginTop: 18 }}>
                      {[
                        { s: result.financial_model.upside, c: "var(--col-upside)", l: "Bull Case", bg: "#f0fdf4", b: "#86efac", xai: result.base_modeler?.xai_reasoning },
                        { s: result.financial_model.base, c: "var(--col-base)", l: "Base Case", bg: "#eff6ff", b: "#93c5fd", xai: result.base_modeler?.xai_reasoning },
                        { s: result.financial_model.downside, c: "var(--col-down)", l: "Bear Case", bg: "#fff7ed", b: "#fdba74", xai: result.critic?.xai_reasoning },
                      ].map(({ s, c, l, bg, b }) => (
                        <div key={l} style={{ background: bg, border: `1px solid ${b}`, borderRadius: 8, padding: "12px 14px" }}>
                          <p style={{ color: c, fontSize: 10, fontWeight: 700, letterSpacing: 0.8, marginBottom: 5, fontFamily: "var(--font-mono)" }}>{l.toUpperCase()}</p>
                          <p style={{ color: "var(--text-secondary)", fontSize: 11, lineHeight: 1.55 }}>{s.narrative}</p>
                          {s.key_assumptions.slice(0, 2).map((a, i) => <p key={i} style={{ color: "var(--text-muted)", fontSize: 10, marginTop: 6 }}>· {a}</p>)}
                        </div>
                      ))}
                    </div>

                    {/* XAI panels for the three modelers */}
                    {result.base_modeler?.xai_reasoning && (
                      <XAIPanel steps={result.base_modeler.xai_reasoning} agentLabel="Base Modeler" color="var(--col-base)" />
                    )}
                    {result.critic?.xai_reasoning && (
                      <XAIPanel steps={result.critic.xai_reasoning} agentLabel="Devil's Advocate" color="var(--col-down)" />
                    )}
                    {result.upside_modeler?.xai_reasoning && (
                      <XAIPanel steps={result.upside_modeler.xai_reasoning} agentLabel="Bull Analyst" color="var(--col-upside)" />
                    )}
                  </div>
                )}

                {/* Breaking Point */}
                {result?.advisor?.breaking_point && (
                  <div style={{
                    background: "#1a1714", border: "1px solid #2d2520", borderRadius: 10,
                    padding: "22px 24px", marginBottom: 22, boxShadow: "0 4px 20px rgba(192,57,43,0.15)"
                  }} className="fade-up">
                    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
                      <AlertTriangle size={16} color="#ef4444" />
                      <span style={{ color: "#ef4444", fontSize: 11, fontFamily: "var(--font-mono)", letterSpacing: 1.2, fontWeight: 700 }}>THE THESIS BREAKS AT</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16, marginBottom: 16 }}>
                      {[
                        { l: "CRITICAL VARIABLE", v: result.advisor.breaking_point.variable, c: "white", sz: 17, font: "var(--font-serif)", fs: "italic" },
                        { l: "BREAK THRESHOLD", v: result.advisor.breaking_point.threshold, c: "#ef4444", sz: 17, font: "var(--font-mono)" },
                        { l: "CURRENT READING", v: result.advisor.breaking_point.current_value, c: "#86efac", sz: 13, font: "var(--font-mono)" },
                        { l: "HEADROOM", v: result.advisor.breaking_point.distance_from_break, c: "#fbbf24", sz: 13, font: "var(--font-mono)" },
                      ].map(({ l, v, c, sz, font, fs }) => (
                        <div key={l}>
                          <p style={{ color: "#6b7280", fontSize: 10, fontFamily: "var(--font-mono)", marginBottom: 4 }}>{l}</p>
                          <p style={{ color: c, fontSize: sz, fontFamily: font, fontStyle: fs as any, fontWeight: 500 }}>{v}</p>
                        </div>
                      ))}
                    </div>
                    <div style={{ padding: "12px 14px", background: "rgba(239,68,68,0.1)", borderRadius: 6, border: "1px solid rgba(239,68,68,0.2)" }}>
                      <p style={{ color: "#fca5a5", fontSize: 12, lineHeight: 1.5 }}>
                        <strong>If breached:</strong> {result.advisor.breaking_point.consequence}
                      </p>
                    </div>
                  </div>
                )}

                {/* Research */}
                {result?.researcher && (
                  <div style={{ marginBottom: 22 }} className="fade-up">
                    <SectionHeader>Market Research · {result.researcher.sector}</SectionHeader>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <InfoCard title="Recent Headlines" accent="#3d5a80" icon={<ChevronRight size={12} />}>
                        {result.researcher.recent_headlines.map((h, i) => <BulletRow key={i} color="#3d5a80">{h}</BulletRow>)}
                      </InfoCard>
                      <InfoCard title="Identified Risks" accent="var(--accent-crimson)" icon={<TrendingDown size={12} />}>
                        {result.researcher.identified_risks.map((r, i) => <BulletRow key={i} color="var(--accent-crimson)">{r}</BulletRow>)}
                      </InfoCard>
                      <InfoCard title="Growth Tailwinds" accent="var(--accent-forest)" icon={<TrendingUp size={12} />}>
                        {result.researcher.identified_tailwinds.map((t, i) => <BulletRow key={i} color="var(--accent-forest)">{t}</BulletRow>)}
                      </InfoCard>
                      <InfoCard title="Analyst Summary" accent="var(--accent-slate)">
                        <p style={{ color: "var(--text-secondary)", fontSize: 12, lineHeight: 1.65 }}>{result.researcher.summary}</p>
                      </InfoCard>
                    </div>
                  </div>
                )}

                {/* Advisory */}
                {result?.advisor && (
                  <div className="fade-up" style={{ marginBottom: 32 }}>
                    <SectionHeader>Strategic Advisory</SectionHeader>
                    {/* Executive memo with Listen button */}
                    <div style={{
                      background: "white", border: "1px solid var(--border)", borderLeft: "4px solid var(--accent-navy)",
                      borderRadius: 10, padding: "20px 24px", marginBottom: 14, boxShadow: "0 1px 4px rgba(0,0,0,0.05)"
                    }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                        <p style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", letterSpacing: 1 }}>EXECUTIVE MEMO</p>
                        <ListenButton text={result.advisor.executive_memo} muted={muted} />
                      </div>
                      <p style={{ color: "var(--text-primary)", fontSize: 14, lineHeight: 1.75 }}>{result.advisor.executive_memo}</p>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
                      <InfoCard title="Strategic Options" accent="var(--accent-navy)">
                        {result.advisor.strategic_options.map((o, i) => <BulletRow key={i} color="var(--accent-navy)">{o}</BulletRow>)}
                      </InfoCard>
                      <InfoCard title="Recommendation" accent="var(--accent-forest)">
                        <p style={{ color: "var(--accent-forest)", fontSize: 13, fontWeight: 600, marginBottom: 6 }}>{result.advisor.recommended_option}</p>
                        <p style={{ color: "var(--text-secondary)", fontSize: 12, lineHeight: 1.6 }}>{result.advisor.rationale}</p>
                      </InfoCard>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
                      <InfoCard title="🚩 Red Flags" accent="var(--accent-crimson)">
                        {result.advisor.red_flags.map((f, i) => <BulletRow key={i} color="var(--accent-crimson)">{f}</BulletRow>)}
                      </InfoCard>
                      <InfoCard title="💬 Due Diligence Q&A" accent="var(--accent-amber)">
                        {result.advisor.tough_questions.map((q, i) => <BulletRow key={i} color="var(--accent-amber)">{q}</BulletRow>)}
                      </InfoCard>
                    </div>
                  </div>
                )}

                {/* Interrogation CTA */}
                {result?.completed && !interrogationStarted && (
                  <div style={{ textAlign: "center", padding: "8px 0 32px" }} className="fade-up">
                    <div style={{
                      background: "white", border: "1px solid var(--border)", borderRadius: 12,
                      padding: "28px 32px", boxShadow: "0 2px 12px rgba(0,0,0,0.06)", maxWidth: 480, margin: "0 auto"
                    }}>
                      <AlertTriangle size={28} color="var(--accent-crimson)" style={{ margin: "0 auto 12px", display: "block" }} />
                      <h3 style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 20, marginBottom: 8 }}>Ready to face the room?</h3>
                      <p style={{ color: "var(--text-secondary)", fontSize: 13, lineHeight: 1.65, marginBottom: 20 }}>
                        A hostile investor has read every number — including the breaking point. Defend the thesis live, speak your answers with the mic, and hear them push back in real time.
                      </p>
                      <button onClick={startInterrogation} style={{
                        padding: "12px 28px", borderRadius: 8, border: "none",
                        background: "var(--accent-crimson)", color: "white", fontFamily: "var(--font-sans)",
                        fontWeight: 600, fontSize: 14, cursor: "pointer", display: "inline-flex",
                        alignItems: "center", gap: 8, boxShadow: "0 4px 14px rgba(192,57,43,0.3)"
                      }}>
                        <MessageSquare size={16} />Enter the Interrogation Room
                      </button>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* INTERROGATION TAB */}
            {activeTab === "interrogation" && (
              <div className="fade-in" style={{ height: "calc(100vh - 180px)", display: "flex", flexDirection: "column" }}>
                <div style={{ marginBottom: 12 }}>
                  <button onClick={() => setActiveTab("analysis")}
                    style={{
                      display: "inline-flex", alignItems: "center", gap: 6, padding: "8px 14px",
                      background: "white", border: "1.5px solid var(--border)", borderRadius: 8,
                      cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--text-secondary)",
                      fontFamily: "var(--font-sans)", boxShadow: "0 1px 4px rgba(0,0,0,0.04)"
                    }}
                    onMouseEnter={e => {
                      e.currentTarget.style.color = "var(--accent-navy)";
                      e.currentTarget.style.borderColor = "var(--accent-navy)";
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.color = "var(--text-secondary)";
                      e.currentTarget.style.borderColor = "var(--border)";
                    }}>
                    ← Back to Analysis Results
                  </button>
                </div>
                {/* Header */}
                <div style={{
                  background: "var(--accent-navy)", borderRadius: "10px 10px 0 0",
                  padding: "13px 18px", display: "flex", alignItems: "center", gap: 12
                }}>
                  <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#ef4444", animation: "pulseDot 1.5s infinite" }} />
                  <div>
                    <p style={{ color: "white", fontWeight: 600, fontSize: 13 }}>The Interrogation Room</p>
                    <p style={{ color: "rgba(255,255,255,0.45)", fontSize: 10, fontFamily: "var(--font-mono)" }}>
                      {result?.financial_model?.company_name} · {muted ? "🔇 Audio off" : "🔊 AI speaks responses"}
                    </p>
                  </div>
                  <span style={{
                    marginLeft: "auto", fontSize: 9, padding: "3px 10px", borderRadius: 20,
                    background: "rgba(239,68,68,0.2)", border: "1px solid rgba(239,68,68,0.3)",
                    color: "#fca5a5", fontFamily: "var(--font-mono)", letterSpacing: 0.8
                  }}>HOSTILE INVESTOR</span>
                </div>

                {/* Chat messages */}
                <div style={{
                  flex: 1, overflowY: "auto", padding: "20px", background: "white",
                  border: "1px solid var(--border)", borderTop: "none"
                }}>
                  {chatMessages.length === 0 && chatLoading && (
                    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "16px 0" }}>
                      <div style={{ display: "flex", gap: 4 }}>
                        {[1, 2, 3].map(i => <div key={i} style={{
                          width: 7, height: 7, borderRadius: "50%",
                          background: "var(--accent-crimson)", animation: `typing ${0.6 + i * 0.2}s ease-in-out infinite`
                        }} />)}
                      </div>
                      <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Reviewing your numbers…</span>
                    </div>
                  )}
                  {chatMessages.map((msg, i) => (
                    <div key={i} style={{
                      marginBottom: 18, display: "flex", flexDirection: "column",
                      alignItems: msg.role === "user" ? "flex-end" : "flex-start"
                    }} className="fade-up">
                      <div style={{
                        display: "flex", alignItems: "center", gap: 8, marginBottom: 5,
                        paddingLeft: msg.role === "assistant" ? 2 : 0, paddingRight: msg.role === "user" ? 2 : 0
                      }}>
                        <span style={{ fontSize: 10, color: "var(--text-muted)", fontFamily: "var(--font-mono)", letterSpacing: 0.5 }}>
                          {msg.role === "assistant" ? "⚔ HOSTILE INVESTOR" : "YOU"}
                        </span>
                        {msg.role === "assistant" && msg.content && i === chatMessages.length - 1 && !chatLoading && (
                          <ListenButton text={msg.content} muted={muted} />
                        )}
                      </div>
                      <div style={{
                        maxWidth: "82%", padding: "12px 16px",
                        borderRadius: msg.role === "user" ? "12px 12px 2px 12px" : "2px 12px 12px 12px",
                        background: msg.role === "user" ? "var(--accent-navy)" : "#f9f8f6",
                        border: msg.role === "user" ? "none" : "1px solid var(--border)",
                        color: msg.role === "user" ? "white" : "var(--text-primary)",
                        fontSize: 13, lineHeight: 1.65, boxShadow: "0 1px 4px rgba(0,0,0,0.06)"
                      }}>
                        {msg.content}
                        {i === chatMessages.length - 1 && msg.role === "assistant" && chatLoading && <span className="chat-cursor" />}
                      </div>
                    </div>
                  ))}
                  <div ref={chatBottomRef} />
                </div>

                {/* Chat input with mic */}
                <div style={{
                  background: "white", borderRadius: "0 0 10px 10px",
                  border: "1px solid var(--border)", borderTop: "1px solid var(--border-dark)",
                  padding: "12px 14px", display: "flex", gap: 8, alignItems: "center"
                }}>
                  {/* Mic button */}
                  <button onClick={toggleMic}
                    title={isListening ? "Stop listening" : "Speak your response"}
                    style={{
                      width: 38, height: 38, borderRadius: 8, border: "none", flexShrink: 0,
                      background: isListening ? "var(--accent-crimson)" : "var(--surface-2)",
                      color: isListening ? "white" : "var(--text-muted)",
                      cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center",
                      animation: isListening ? "micPulse 1.5s infinite" : "none",
                      transition: "all 0.2s"
                    }}>
                    {isListening ? <MicOff size={15} /> : <Mic size={15} />}
                  </button>
                  <input value={chatInput} onChange={e => setChatInput(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendChatMessage()}
                    placeholder={isListening ? "🎙 Listening… speak now" : "Respond to the investor… (Enter to send)"}
                    disabled={chatLoading}
                    style={{
                      flex: 1, background: isListening ? "#fef2f2" : "var(--bg)",
                      border: `1px solid ${isListening ? "#fca5a5" : "var(--border)"}`,
                      borderRadius: 7, padding: "9px 14px", color: "var(--text-primary)",
                      fontFamily: "var(--font-sans)", fontSize: 13, outline: "none", transition: "all 0.2s"
                    }}
                    onFocus={e => e.currentTarget.style.borderColor = "var(--accent-navy)"}
                    onBlur={e => e.currentTarget.style.borderColor = isListening ? "#fca5a5" : "var(--border)"} />
                  <button onClick={sendChatMessage} disabled={chatLoading || !chatInput.trim()}
                    style={{
                      width: 38, height: 38, borderRadius: 8, border: "none", flexShrink: 0,
                      background: (!chatLoading && chatInput.trim()) ? "var(--accent-navy)" : "var(--surface-2)",
                      color: (!chatLoading && chatInput.trim()) ? "white" : "var(--text-muted)",
                      cursor: (!chatLoading && chatInput.trim()) ? "pointer" : "not-allowed",
                      display: "flex", alignItems: "center", justifyContent: "center", transition: "all 0.2s"
                    }}>
                    <Send size={15} />
                  </button>
                </div>
                <p style={{ fontSize: 10, color: "var(--text-faint)", textAlign: "center", padding: "7px 0", fontFamily: "var(--font-mono)" }}>
                  {isListening ? "🎙 Mic active — speak, then hit Send" : "Simulation for educational purposes only · Not investment advice"}
                </p>
              </div>
            )}

            {/* Empty state */}
            {!loading && !result && (
              <div style={{ textAlign: "center", paddingTop: 72 }}>
                <p style={{ fontFamily: "var(--font-serif)", fontStyle: "italic", fontSize: 32, color: "var(--border-dark)", marginBottom: 12, fontWeight: 400 }}>Ready to analyse.</p>
                <p style={{ color: "var(--text-muted)", fontSize: 13, lineHeight: 1.8 }}>
                  Enter any listed ticker, or click <strong style={{ color: "var(--accent-navy)" }}>⚡ DEMO</strong> for an instant run using Ryan Air data.
                </p>
              </div>
            )}
          </div>

          {/* ════ RIGHT — Pipeline ════ */}
          <div style={{
            display: "flex", flexDirection: "column", background: "var(--surface)",
            borderLeft: "1px solid var(--border)", height: "100%", overflow: "hidden"
          }}>
            <div style={{
              padding: "13px 18px", borderBottom: "1px solid var(--border)", background: "white",
              display: "flex", alignItems: "center", justifyContent: "space-between"
            }}>
              <span style={{ fontWeight: 600, fontSize: 13 }}>Agent Pipeline</span>
              <span style={{
                fontSize: 10, padding: "2px 9px", borderRadius: 20, fontFamily: "var(--font-mono)",
                background: streamDone ? "#f0fdf4" : loading ? "#eff6ff" : "var(--surface-2)",
                border: `1px solid ${streamDone ? "#86efac" : loading ? "#93c5fd" : "var(--border)"}`,
                color: streamDone ? "var(--accent-forest)" : loading ? "var(--accent-slate)" : "var(--text-muted)"
              }}>
                {streamDone ? "Complete" : loading ? "● Live" : "Idle"}
              </span>
            </div>
            {/* React Flow */}
            <div style={{ height: 220, borderBottom: "1px solid var(--border)", background: "#faf9f7", position: "relative" }}>
              <ReactFlow nodes={nodes} edges={edges} nodeTypes={nodeTypes}
                onNodesChange={onNodesChange} onEdgesChange={onEdgesChange}
                fitView fitViewOptions={{ padding: 0.25 }}
                panOnDrag={false} zoomOnScroll={false} zoomOnPinch={false}
                preventScrolling={false} nodesDraggable={false} nodesConnectable={false}
                elementsSelectable={false} proOptions={{ hideAttribution: true }}>
                <Background variant={BackgroundVariant.Dots} gap={18} size={1} color="#e2ddd6" />
              </ReactFlow>
              {!loading && !streamDone && (
                <div style={{
                  position: "absolute", inset: 0, display: "flex", alignItems: "center",
                  justifyContent: "center", pointerEvents: "none"
                }}>
                  <p style={{ color: "var(--text-faint)", fontSize: 11, fontFamily: "var(--font-mono)" }}>Awaiting pipeline</p>
                </div>
              )}
            </div>
            {/* Log */}
            <div style={{ flex: 1, overflowY: "auto", padding: "13px 16px" }}>
              {streamLog.length === 0 && <p style={{ color: "var(--text-faint)", fontSize: 12, fontFamily: "var(--font-mono)", paddingTop: 8 }}>$ waiting...</p>}
              {streamLog.map((step, i) => {
                const cfg = PIPELINE_AGENTS.find(a => a.id === step.agent);
                const color = cfg?.color ?? "#4a4540";
                const ts = new Date(step.timestamp).toLocaleTimeString("en-IE", { hour12: false });
                return (
                  <div key={i} style={{
                    marginBottom: 11, paddingBottom: 11,
                    borderBottom: "1px solid var(--border)", animation: "fadeUp 0.3s ease forwards"
                  }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 7, marginBottom: 4 }}>
                      <span style={{
                        fontSize: 9, padding: "2px 7px", borderRadius: 4,
                        background: `${color}12`, border: `1px solid ${color}30`,
                        color, fontFamily: "var(--font-mono)", fontWeight: 600, letterSpacing: 0.5
                      }}>
                        {cfg?.icon} {cfg?.label?.replace("\n", " ") ?? step.agent}
                      </span>
                      <span style={{ color: "var(--text-faint)", fontSize: 9, fontFamily: "var(--font-mono)" }}>{ts}</span>
                      {step.status === "running" && <div style={{ width: 5, height: 5, borderRadius: "50%", background: color, animation: "pulseDot 1s infinite" }} />}
                      {step.status === "done" && <span style={{ color: "var(--accent-forest)", fontSize: 10 }}>✓</span>}
                      {step.status === "error" && <span style={{ color: "var(--accent-crimson)", fontSize: 10 }}>✗</span>}
                    </div>
                    <p style={{ color: step.status === "error" ? "var(--accent-crimson)" : step.status === "done" ? "var(--text-muted)" : "var(--text-secondary)", fontSize: 12, lineHeight: 1.5, fontFamily: "var(--font-mono)" }}>{step.message}</p>
                  </div>
                );
              })}
              {streamDone && result?.completed && (
                <div style={{ padding: "11px 13px", background: "#f0fdf4", border: "1px solid #86efac", borderRadius: 8, marginTop: 4 }} className="fade-up">
                  <p style={{ color: "var(--accent-forest)", fontWeight: 600, fontSize: 12 }}>✓ Pipeline complete</p>
                  <p style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 3 }}>{streamLog.length} steps · XAI reasoning captured</p>
                </div>
              )}
              {streamDone && result?.error && (
                <div style={{ padding: "11px 13px", background: "#fef2f2", border: "1px solid #fca5a5", borderRadius: 8 }}>
                  <p style={{ color: "var(--accent-crimson)", fontWeight: 600, fontSize: 12 }}>✗ Error</p>
                  <p style={{ color: "var(--text-muted)", fontSize: 11, marginTop: 3 }}>{result.error}</p>
                </div>
              )}
              <div ref={logBottomRef} />
            </div>
            {/* Agent legend */}
            <div style={{ borderTop: "1px solid var(--border)", padding: "11px 16px", background: "white" }}>
              <p style={{ fontSize: 10, color: "var(--text-faint)", fontFamily: "var(--font-mono)", marginBottom: 7, letterSpacing: 0.5 }}>PIPELINE AGENTS</p>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
                {PIPELINE_AGENTS.map(({ id, label, icon, color }) => (
                  <div key={id} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    <span style={{ color, fontSize: 11 }}>{icon}</span>
                    <span style={{ color: "var(--text-muted)", fontSize: 10, fontFamily: "var(--font-mono)" }}>{label.replace("\n", " ")}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
