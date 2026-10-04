import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Activity,
  Atom,
  CheckCircle2,
  ChevronDown,
  CircleAlert,
  FlaskConical,
  Orbit,
  Play,
  Radio,
  RefreshCw,
  Satellite,
  Sparkles,
  TerminalSquare,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SpectrumPoint = {
  wavelength: number;
  target: number;
  fit: number;
  uncertainty?: number;
};

type LogLine = {
  time: string;
  agent: string;
  message: string;
  tone?: "default" | "signal" | "success" | "warning" | "thinking";
  title?: string | null;
  detail?: string | null;
};

type AgentEvent = {
  seq: number;
  time: string;
  agent: string;
  kind: "status" | "task" | "thinking" | "message" | "tool_call" | "tool_result" | "error";
  title: string | null;
  message: string;
  detail: string | null;
};

type AgentState = {
  busy: boolean;
  title: string | null;
  activity: string;
  time: string;
};

const API_BASE = "http://127.0.0.1:8000";

const labAgents = [
  { key: "ORCHESTRATOR", role: "Coordinates the loop" },
  { key: "LITERATURE", role: "Literature & hypothesis" },
  { key: "EXPERIMENT", role: "Forward-model experiment" },
  { key: "ANALYSIS", role: "Learns from results" },
];

const kindTone: Record<AgentEvent["kind"], NonNullable<LogLine["tone"]>> = {
  status: "signal",
  task: "signal",
  thinking: "thinking",
  message: "default",
  tool_call: "default",
  tool_result: "success",
  error: "warning",
};

const kindPrefix: Partial<Record<AgentEvent["kind"], string>> = {
  task: "Task · ",
  thinking: "Thinking · ",
  tool_call: "→ ",
};

type Hypothesis = {
  label: string;
  detail: string;
  score: number;
  tone: "primary" | "coral" | "lime";
};

const initialSpectrum: SpectrumPoint[] = [
  { wavelength: 0.62, target: 14621, fit: 14618, uncertainty: 13 },
  { wavelength: 0.74, target: 14646, fit: 14634, uncertainty: 12 },
  { wavelength: 0.86, target: 14691, fit: 14680, uncertainty: 13 },
  { wavelength: 0.98, target: 14728, fit: 14722, uncertainty: 11 },
  { wavelength: 1.1, target: 14705, fit: 14715, uncertainty: 12 },
  { wavelength: 1.22, target: 14744, fit: 14739, uncertainty: 11 },
  { wavelength: 1.34, target: 14818, fit: 14807, uncertainty: 12 },
  { wavelength: 1.42, target: 14912, fit: 14891, uncertainty: 14 },
  { wavelength: 1.52, target: 14828, fit: 14839, uncertainty: 12 },
  { wavelength: 1.66, target: 14764, fit: 14770, uncertainty: 11 },
  { wavelength: 1.82, target: 14731, fit: 14734, uncertainty: 13 },
  { wavelength: 2.02, target: 14769, fit: 14758, uncertainty: 14 },
  { wavelength: 2.24, target: 14822, fit: 14812, uncertainty: 13 },
  { wavelength: 2.48, target: 14874, fit: 14865, uncertainty: 15 },
  { wavelength: 2.72, target: 14831, fit: 14841, uncertainty: 14 },
  { wavelength: 3.02, target: 14782, fit: 14793, uncertainty: 15 },
  { wavelength: 3.34, target: 14844, fit: 14834, uncertainty: 14 },
  { wavelength: 3.62, target: 14936, fit: 14918, uncertainty: 16 },
  { wavelength: 3.92, target: 14852, fit: 14866, uncertainty: 15 },
  { wavelength: 4.28, target: 14794, fit: 14802, uncertainty: 17 },
  { wavelength: 4.64, target: 14848, fit: 14839, uncertainty: 18 },
  { wavelength: 4.92, target: 14818, fit: 14823, uncertainty: 18 },
];

const initialLogs: LogLine[] = [
  { time: "22:14:02", agent: "ORCHESTRATOR", message: "Target WASP-39 b context restored · run 0842", tone: "signal" },
  { time: "22:14:03", agent: "RETRIEVAL", message: "Loaded NIRSpec PRISM spectrum · 22 wavelength bins" },
  { time: "22:14:03", agent: "ATMOSPHERE", message: "Equilibrium chemistry prior initialized: C/O ∈ [0.1, 1.2]" },
  { time: "22:14:04", agent: "SIMULATOR", message: "Radiative-transfer grid warm · 2,048 models indexed", tone: "success" },
  { time: "22:14:05", agent: "ANALYSIS", message: "Degeneracy monitor ready. Awaiting discovery loop." },
];

const initialHypotheses: Hypothesis[] = [
  { label: "High metallicity", detail: "30× solar · clear limb", score: 0.82, tone: "primary" },
  { label: "Cloudy atmosphere", detail: "10× solar · 3 mbar deck", score: 0.61, tone: "coral" },
  { label: "High C/O ratio", detail: "C/O = 0.91 · reduced H₂O", score: 0.27, tone: "lime" },
];

const fallbackReport = `### Converged interpretation
The spectrum favors a **metal-enriched atmosphere** with a resolved CO₂ feature and moderate H₂O absorption. The evidence does not support a carbon-rich composition.

### Dominant degeneracy
Cloud-top pressure remains coupled to metallicity. A high-altitude gray cloud deck can flatten the 1.4 μm H₂O feature while preserving the 4.3 μm CO₂ band.

### Recommended observation
Prioritize **2.7–3.1 μm coverage**. This region maximizes information gain between the leading clear and cloudy solutions.`;

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Asterion Lab — Autonomous Exoplanet Discovery" },
      { name: "description", content: "An autonomous research console for transmission spectrum retrieval and exoplanet atmosphere analysis." },
      { property: "og:title", content: "Asterion Lab — Autonomous Exoplanet Discovery" },
      { property: "og:description", content: "Run agentic discovery loops, compare atmospheric fits, and inspect degeneracy analysis." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Dashboard,
});

function nowTime() {
  return new Date().toLocaleTimeString("en-GB", { hour12: false });
}

function safeSpectrum(value: unknown): SpectrumPoint[] | null {
  if (!Array.isArray(value)) return null;
  const parsed: SpectrumPoint[] = value
    .flatMap((entry): SpectrumPoint[] => {
      if (!entry || typeof entry !== "object") return [];
      const item = entry as Record<string, unknown>;
      const wavelength = Number(item["wavelength"] ?? item["x"]);
      const target = Number(item["target"] ?? item["transit_depth"] ?? item["observed"]);
      const fit = Number(item["fit"] ?? item["simulated"] ?? item["model"]);
      if (![wavelength, target, fit].every(Number.isFinite)) return [];
      const uncertainty = Number(item["uncertainty"]);
      return [{ wavelength, target, fit, ...(Number.isFinite(uncertainty) ? { uncertainty } : {}) }];
    });
  return parsed.length > 2 ? parsed : null;
}

function Dashboard() {
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<"ready" | "running" | "complete" | "error">("ready");
  const [logs, setLogs] = useState<LogLine[]>(initialLogs);
  const [spectrum, setSpectrum] = useState(initialSpectrum);
  const [report, setReport] = useState(fallbackReport);
  const [hypotheses, setHypotheses] = useState(initialHypotheses);
  const [iteration, setIteration] = useState(12);
  const [agents, setAgents] = useState<Record<string, AgentState>>({});
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [logs]);

  const residual = useMemo(() => {
    const total = spectrum.reduce((sum, point) => sum + Math.abs(point.target - point.fit), 0);
    return (total / spectrum.length).toFixed(1);
  }, [spectrum]);

  function applyEvents(events: AgentEvent[]) {
    if (!events.length) return;
    setLogs((current) => [
      ...current,
      ...events.map((event) => ({
        time: event.time,
        agent: event.agent,
        message: `${kindPrefix[event.kind] ?? ""}${event.message}`,
        tone: kindTone[event.kind],
        title: event.title,
        detail: event.detail,
      })),
    ]);
    setAgents((current) => {
      const next = { ...current };
      for (const event of events) {
        const previous = next[event.agent];
        const busy = event.kind === "status" ? !event.message.endsWith("finished") : (previous?.busy ?? true);
        next[event.agent] = { busy, title: event.title ?? previous?.title ?? null, activity: event.message, time: event.time };
      }
      return next;
    });
    for (const event of events) {
      const match = event.title?.match(/-(\d+)$/);
      if (match) setIteration(Number(match[1]));
    }
  }

  async function runDiscovery() {
    if (isRunning) return;
    setIsRunning(true);
    setStatus("running");
    setAgents({});
    setIteration(0);
    setLogs((current) => [
      ...current,
      { time: nowTime(), agent: "SYSTEM", message: "New discovery loop initiated · POST /runs", tone: "signal" },
    ]);

    try {
      const started = await fetch(`${API_BASE}/runs`, { method: "POST" });
      if (!started.ok) throw new Error(`Discovery service returned ${started.status}`);
      const { run_id: runId } = (await started.json()) as { run_id: string };

      let after = 0;
      let payload: Record<string, unknown> | null = null;
      for (;;) {
        const response = await fetch(`${API_BASE}/runs/${runId}?after=${after}`);
        if (!response.ok) throw new Error(`Discovery service returned ${response.status}`);
        const run = (await response.json()) as { status: string; events: AgentEvent[]; result: Record<string, unknown> | null; error: string | null };
        applyEvents(run.events);
        after += run.events.length;
        if (run.status === "error") throw new Error(run.error ?? "Discovery loop failed");
        if (run.status === "complete") {
          payload = run.result;
          break;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
      }
      if (!payload) throw new Error("Discovery loop returned no result");

      setAgents((current) => Object.fromEntries(Object.entries(current).map(([key, value]) => [key, { ...value, busy: false }])));
      const nextSpectrum = safeSpectrum(payload["spectrum"] ?? payload["transmission_spectrum"] ?? payload["data"]);
      if (nextSpectrum) setSpectrum(nextSpectrum);
      if (typeof payload["report"] === "string") setReport(payload["report"]);
      if (Array.isArray(payload["hypotheses"])) {
        const parsed: Hypothesis[] = payload["hypotheses"].flatMap((item, index): Hypothesis[] => {
          if (!item || typeof item !== "object") return [];
          const row = item as Record<string, unknown>;
          const score = Number(row["score"]);
          if (typeof row["label"] !== "string" || !Number.isFinite(score)) return [];
          const tones: Hypothesis["tone"][] = ["primary", "coral", "lime"];
          return [{ label: row["label"], detail: typeof row["detail"] === "string" ? row["detail"] : "Retrieved solution", score, tone: tones[index % tones.length] ?? "primary" }];
        });
        if (parsed.length) setHypotheses(parsed);
      }
      setStatus("complete");
      setLogs((current) => [...current, { time: nowTime(), agent: "SYSTEM", message: "Discovery loop complete · report synchronized", tone: "success" }]);
    } catch (error) {
      setStatus("error");
      const message = error instanceof Error ? error.message : "Discovery service unavailable";
      setLogs((current) => [...current, { time: nowTime(), agent: "SYSTEM", message: `${message}. Retaining the latest local analysis.`, tone: "warning" }]);
    } finally {
      setIsRunning(false);
    }
  }

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border bg-surface/95 px-4 py-3 sm:px-6 lg:px-8">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-9 shrink-0 place-items-center border border-primary/30 bg-primary/10 text-primary">
              <Orbit className="size-5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="font-display text-base font-semibold uppercase tracking-normal">Asterion</span>
                <span className="hidden font-mono text-[10px] uppercase text-muted-foreground sm:inline">Autonomous Exoplanet Lab</span>
              </div>
              <p className="truncate font-mono text-[10px] text-muted-foreground">OBS / WASP-39 b / NIRSpec PRISM</p>
            </div>
          </div>
          <div className="flex items-center gap-3 font-mono text-[10px] uppercase">
            <div className="hidden items-center gap-2 text-muted-foreground md:flex">
              <span className="size-1.5 animate-pulse rounded-full bg-success" />
              6 agents online
            </div>
            <div className="border-l border-border pl-3 text-right">
              <div className="text-foreground">Cycle 0842</div>
              <div className="text-muted-foreground">Mission time 18:42:06</div>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8">
        <section className="mb-5 grid gap-4 border-b border-border pb-5 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase text-primary">
              <Radio className="size-3" /> Active observation
            </div>
            <h1 className="font-display text-3xl font-semibold tracking-normal sm:text-4xl">WASP-39 b</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              Transmission spectroscopy retrieval · Hot Saturn · 215 pc · Sagittarius
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 lg:justify-end">
            <div className="hidden border-r border-border pr-4 text-right sm:block">
              <p className="font-mono text-[10px] uppercase text-muted-foreground">Last convergence</p>
              <p className="mt-1 font-mono text-sm text-foreground">Δln Z 0.08 / 5.2k evals</p>
            </div>
            <Button
              onClick={runDiscovery}
              disabled={isRunning}
              size="lg"
              className="h-12 min-w-52 bg-primary px-5 font-mono text-xs font-semibold uppercase text-primary-foreground shadow-signal hover:bg-primary/90"
            >
              {isRunning ? <RefreshCw className="animate-spin" /> : <Play className="fill-current" />}
              {isRunning ? "Discovery running" : "Run Discovery Loop"}
            </Button>
          </div>
        </section>

        <section className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(360px,0.8fr)]">
          <div className="space-y-4">
            <Panel className="overflow-hidden">
              <PanelHeader icon={<Activity />} title="Transmission Spectrum" eyebrow="Target vs. forward model">
                <div className="flex items-center gap-4 font-mono text-[10px] text-muted-foreground">
                  <LegendDot className="bg-primary" label="Target" />
                  <LegendDot className="bg-coral" label="Simulated fit" />
                </div>
              </PanelHeader>
              <div className="grid grid-cols-2 border-b border-border sm:grid-cols-4">
                <Metric label="Mean depth" value="14,792" unit="ppm" />
                <Metric label="Mean residual" value={residual} unit="ppm" />
                <Metric label="Resolving power" value="R ≈ 100" />
                <Metric label="Coverage" value="0.6–5.0" unit="μm" />
              </div>
              <div className="h-[390px] px-1 pb-3 pt-5 sm:px-4">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={spectrum} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                    <defs>
                      <linearGradient id="targetArea" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.18} />
                        <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="2 5" vertical={false} />
                    <XAxis dataKey="wavelength" type="number" domain={[0.5, 5]} tickCount={7} stroke="var(--muted-foreground)" tickLine={false} axisLine={{ stroke: "var(--border)" }} tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }} label={{ value: "WAVELENGTH (μm)", position: "insideBottom", offset: -4, fill: "var(--muted-foreground)", fontSize: 9 }} />
                    <YAxis domain={[14550, 15000]} tickCount={6} stroke="var(--muted-foreground)" tickLine={false} axisLine={false} width={56} tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }} label={{ value: "TRANSIT DEPTH (ppm)", angle: -90, position: "insideLeft", fill: "var(--muted-foreground)", fontSize: 9 }} />
                    <Tooltip content={<SpectrumTooltip />} cursor={{ stroke: "var(--border-strong)", strokeDasharray: "3 3" }} />
                    <ReferenceLine x={1.4} stroke="var(--border-strong)" strokeDasharray="2 4" label={{ value: "H₂O", fill: "var(--muted-foreground)", fontSize: 9, position: "top" }} />
                    <ReferenceLine x={4.28} stroke="var(--border-strong)" strokeDasharray="2 4" label={{ value: "CO₂", fill: "var(--muted-foreground)", fontSize: 9, position: "top" }} />
                    <Area type="monotone" dataKey="target" fill="url(#targetArea)" stroke="none" />
                    <Line type="monotone" dataKey="fit" stroke="var(--coral)" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "var(--coral)", stroke: "var(--background)" }} animationDuration={900} />
                    <Line type="monotone" dataKey="target" stroke="var(--primary)" strokeWidth={1.5} dot={{ r: 2.5, fill: "var(--primary)", strokeWidth: 0 }} activeDot={{ r: 5, fill: "var(--primary)", stroke: "var(--background)" }} animationDuration={700} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </Panel>

            <Panel>
              <PanelHeader icon={<Sparkles />} title="Agent Activity" eyebrow="What each agent is working on">
                <span className="font-mono text-[10px] uppercase text-muted-foreground">Live</span>
              </PanelHeader>
              <div className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-4">
                {labAgents.map(({ key, role }) => {
                  const state = agents[key];
                  const working = isRunning && Boolean(state?.busy);
                  return (
                    <div key={key} className="min-w-0 bg-card px-4 py-3">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-mono text-[10px] font-semibold uppercase text-coral">{key}</span>
                        <span className={cn("flex items-center gap-1.5 font-mono text-[9px] uppercase", working ? "text-success" : "text-muted-foreground")}>
                          <span className={cn("size-1.5 rounded-full", working ? "animate-pulse bg-success" : "bg-muted-foreground")} />
                          {working ? "Working" : state ? "Idle" : "Waiting"}
                        </span>
                      </div>
                      <p className="mt-0.5 font-mono text-[9px] uppercase text-muted-foreground">{state?.title ?? role}</p>
                      <p className="mt-2 line-clamp-3 break-words text-xs leading-5 text-foreground" title={state?.activity}>
                        {state?.activity ?? "No activity yet"}
                      </p>
                      {state && <p className="mt-1 font-mono text-[9px] text-muted-foreground">{state.time}</p>}
                    </div>
                  );
                })}
              </div>
            </Panel>

            <Panel>
              <PanelHeader icon={<TerminalSquare />} title="Agent Log Stream" eyebrow={`Iteration ${iteration.toString().padStart(2, "0")}`}>
                <div className="flex items-center gap-2 font-mono text-[10px] uppercase text-muted-foreground">
                  <span className={cn("size-1.5 rounded-full", isRunning ? "animate-pulse bg-success" : "bg-muted-foreground")} />
                  {isRunning ? "Streaming" : "Standby"}
                </div>
              </PanelHeader>
              <div className="h-96 overflow-y-auto bg-terminal px-4 py-3 font-mono text-[11px] leading-6 sm:px-5" aria-live="polite">
                {logs.map((line, index) => (
                  <div key={`${line.time}-${index}`} className="grid grid-cols-[64px_88px_1fr] gap-2 border-b border-border/40 py-0.5 last:border-0">
                    <span className="text-muted-foreground">{line.time}</span>
                    <span className={cn("truncate", logTone(line.tone))}>{line.agent}</span>
                    <LogMessage line={line} />
                  </div>
                ))}
                <div ref={logEndRef} />
              </div>
            </Panel>
          </div>

          <aside className="space-y-4">
            <Panel>
              <PanelHeader icon={<Atom />} title="Degeneracy Analysis" eyebrow="Analysis Agent">
                <StatusPill status={status} />
              </PanelHeader>
              <div className="space-y-5 p-4 sm:p-5">
                <div className="flex items-start gap-3 border-l-2 border-primary bg-primary/5 px-3 py-3">
                  <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
                  <div>
                    <p className="font-mono text-[10px] uppercase text-primary">Information gain</p>
                    <p className="mt-1 text-sm leading-5 text-foreground">Next observation can reduce posterior entropy by 31%.</p>
                  </div>
                </div>

                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-mono text-[10px] uppercase text-muted-foreground">Hypothesis ranking</h3>
                    <span className="font-mono text-[10px] text-muted-foreground">P(H|D)</span>
                  </div>
                  <div className="space-y-4">
                    {hypotheses.map((hypothesis) => (
                      <div key={hypothesis.label}>
                        <div className="mb-1.5 flex items-end justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium">{hypothesis.label}</p>
                            <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">{hypothesis.detail}</p>
                          </div>
                          <span className="font-mono text-sm font-semibold">{Math.round(hypothesis.score * 100)}%</span>
                        </div>
                        <progress className={cn("hypothesis-progress h-1.5 w-full", scoreTone(hypothesis.tone))} value={hypothesis.score} max={1} aria-label={`${hypothesis.label} score`} />
                      </div>
                    ))}
                  </div>
                </div>

                <div className="border-t border-border pt-4">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="font-mono text-[10px] uppercase text-muted-foreground">Final report</h3>
                    <span className="font-mono text-[10px] text-success">MD · SYNCED</span>
                  </div>
                  <ReportMarkdown source={report} />
                </div>
              </div>
            </Panel>

            <Panel>
              <PanelHeader icon={<Satellite />} title="Observation Context" eyebrow="Ephemeris locked">
                <ChevronDown className="size-4 text-muted-foreground" />
              </PanelHeader>
              <dl className="grid grid-cols-2 gap-px bg-border">
                <ContextCell label="Instrument" value="JWST / NIRSpec" />
                <ContextCell label="Planet class" value="Hot Saturn" />
                <ContextCell label="Equilibrium T" value="1,120 K" />
                <ContextCell label="Surface gravity" value="4.07 m/s²" />
              </dl>
            </Panel>
          </aside>
        </section>
      </div>
    </main>
  );
}

function Panel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn("border border-border bg-card shadow-panel", className)}>{children}</section>;
}

function PanelHeader({ icon, title, eyebrow, children }: { icon: React.ReactNode; title: string; eyebrow: string; children?: React.ReactNode }) {
  return (
    <div className="flex min-h-14 items-center justify-between gap-4 border-b border-border px-4 py-3 sm:px-5">
      <div className="flex min-w-0 items-center gap-3">
        <span className="text-primary [&>svg]:size-4">{icon}</span>
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{title}</h2>
          <p className="mt-0.5 font-mono text-[9px] uppercase text-muted-foreground">{eyebrow}</p>
        </div>
      </div>
      {children}
    </div>
  );
}

function Metric({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <div className="border-r border-border px-3 py-3 last:border-r-0 sm:px-4">
      <dt className="font-mono text-[9px] uppercase text-muted-foreground">{label}</dt>
      <dd className="mt-1 font-mono text-sm font-medium text-foreground">{value} {unit && <span className="text-[10px] text-muted-foreground">{unit}</span>}</dd>
    </div>
  );
}

function LegendDot({ className, label }: { className: string; label: string }) {
  return <span className="flex items-center gap-1.5"><span className={cn("size-1.5 rounded-full", className)} />{label}</span>;
}

function SpectrumTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name?: string; value?: number; color?: string }>; label?: number }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="min-w-40 border border-border-strong bg-popover p-3 shadow-panel">
      <p className="mb-2 font-mono text-[10px] text-muted-foreground">λ {Number(label).toFixed(2)} μm</p>
      {payload.filter((row) => row.name !== "target" || payload.indexOf(row) !== 0).map((row, index) => (
        <div key={`${row.name}-${index}`} className="flex items-center justify-between gap-4 text-xs">
          <span className="capitalize text-muted-foreground">{row.name}</span>
          <span className="font-mono text-popover-foreground">{Number(row.value).toLocaleString()} ppm</span>
        </div>
      ))}
    </div>
  );
}

function StatusPill({ status }: { status: "ready" | "running" | "complete" | "error" }) {
  const config = {
    ready: { label: "Ready", icon: FlaskConical, className: "border-border text-muted-foreground" },
    running: { label: "Analyzing", icon: RefreshCw, className: "border-primary/40 bg-primary/10 text-primary" },
    complete: { label: "Converged", icon: CheckCircle2, className: "border-success/40 bg-success/10 text-success" },
    error: { label: "Local result", icon: CircleAlert, className: "border-warning/40 bg-warning/10 text-warning" },
  }[status];
  const Icon = config.icon;
  return <span className={cn("flex items-center gap-1.5 border px-2 py-1 font-mono text-[9px] uppercase", config.className)}><Icon className={cn("size-3", status === "running" && "animate-spin")} />{config.label}</span>;
}

function ReportMarkdown({ source }: { source: string }) {
  return (
    <div className="space-y-3 text-sm leading-6 text-muted-foreground">
      {source.split("\n").filter(Boolean).map((line, index) => {
        if (line.startsWith("### ")) return <h4 key={index} className="pt-1 font-display text-sm font-semibold text-foreground">{line.slice(4)}</h4>;
        const parts = line.split(/(\*\*[^*]+\*\*)/g);
        return <p key={index}>{parts.map((part, partIndex) => part.startsWith("**") ? <strong key={partIndex} className="font-semibold text-foreground">{part.slice(2, -2)}</strong> : part)}</p>;
      })}
    </div>
  );
}

function ContextCell({ label, value }: { label: string; value: string }) {
  return <div className="bg-card px-4 py-3"><dt className="font-mono text-[9px] uppercase text-muted-foreground">{label}</dt><dd className="mt-1 text-xs text-foreground">{value}</dd></div>;
}

function LogMessage({ line }: { line: LogLine }) {
  const text = (
    <>
      {line.title && <span className="mr-1.5 text-muted-foreground">[{line.title}]</span>}
      <span className={cn(line.tone === "thinking" ? "italic text-muted-foreground" : "text-terminal-foreground")}>{line.message}</span>
    </>
  );
  if (!line.detail) return <span className="min-w-0 break-words">{text}</span>;
  return (
    <details className="group min-w-0 break-words">
      <summary className="cursor-pointer list-none marker:hidden">
        {text}
        <span className="ml-1.5 text-muted-foreground group-open:hidden">[+]</span>
      </summary>
      <pre className="mt-1 mb-1 max-h-72 overflow-auto whitespace-pre-wrap border-l border-border-strong pl-3 text-[10px] leading-5 text-muted-foreground">{line.detail}</pre>
    </details>
  );
}

function logTone(tone?: LogLine["tone"]) {
  if (tone === "signal") return "text-primary";
  if (tone === "success") return "text-success";
  if (tone === "warning") return "text-warning";
  if (tone === "thinking") return "text-muted-foreground";
  return "text-coral";
}

function scoreTone(tone: Hypothesis["tone"]) {
  if (tone === "coral") return "progress-coral";
  if (tone === "lime") return "progress-lime";
  return "progress-primary";
}