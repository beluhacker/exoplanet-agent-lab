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
  CircleAlert,
  FlaskConical,
  Orbit,
  Play,
  Radio,
  RefreshCw,
  Satellite,
  Sparkles,
  Table2,
  TerminalSquare,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type SpectrumPoint = {
  wavelength: number;
  target: number;
  fit?: number;
  uncertainty?: number;
};

type Observation = {
  target_file: string;
  n_points: number;
  wavelength_range_um: [number, number];
  median_depth_ppm: number;
  min_depth_ppm: number;
  max_depth_ppm: number;
  noise_ppm: number;
  stellar_parameters: string;
  points: SpectrumPoint[];
};

type IterationRow = {
  iteration: number;
  experiment_id: string;
  h2o_abundance: number;
<<<<<<< Updated upstream
  haze_factor: number;
=======
  co2_abundance?: number;
  ch4_abundance?: number;
  haze_factor: number;
  haze_slope?: number;
>>>>>>> Stashed changes
  baseline_depth: number;
  rmse: number;
  reduced_chi2: number;
};

type PlanetMetrics = {
  experiment_id: string;
  assumed_stellar_radius_rsun: number;
  transit_snr: number;
  atmosphere: { detection_significance_sigma: number; delta_chi2_vs_flat: number };
  goodness_of_fit: { reduced_chi2: number; p_value: number };
  planet: { rp_over_rstar: number; radius_earth: number; radius_jupiter: number };
<<<<<<< Updated upstream
=======
  molecules?: Record<string, { abundance: number; detection_significance_sigma: number }>;
>>>>>>> Stashed changes
};

type Progress = {
  iterations: IterationRow[];
  best_experiment_id: string | null;
  spectrum: SpectrumPoint[];
  metrics: Record<string, PlanetMetrics>;
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

type Hypothesis = {
  label: string;
  detail: string;
  score: number;
  tone: "primary" | "coral" | "lime";
};

type Verdict = {
  title: string | null;
  text: string;
};

type RunStatus = "ready" | "running" | "complete" | "error";

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

function fmt(value: number | null | undefined, digits = 0) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatElapsed(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const minutes = Math.floor(total / 60).toString().padStart(2, "0");
  const seconds = (total % 60).toString().padStart(2, "0");
  return `${minutes}:${seconds}`;
}

function parseHypotheses(value: unknown): Hypothesis[] {
  if (!Array.isArray(value)) return [];
  const tones: Hypothesis["tone"][] = ["primary", "coral", "lime"];
  return value.flatMap((item, index): Hypothesis[] => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    const raw = Number(row["score"]);
    if (typeof row["label"] !== "string" || !Number.isFinite(raw)) return [];
    // The orchestrator reports a 0–100 confidence
    const score = Math.min(1, Math.max(0, raw > 1 ? raw / 100 : raw));
    return [{ label: row["label"], detail: typeof row["detail"] === "string" ? row["detail"] : "", score, tone: tones[index % tones.length] ?? "primary" }];
  });
}

function Dashboard() {
  const [isRunning, setIsRunning] = useState(false);
  const [status, setStatus] = useState<RunStatus>("ready");
  const [observation, setObservation] = useState<Observation | null>(null);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [agents, setAgents] = useState<Record<string, AgentState>>({});
  const [report, setReport] = useState("");
  const [hypotheses, setHypotheses] = useState<Hypothesis[]>([]);
  const [verdict, setVerdict] = useState<Verdict | null>(null);
  const [iteration, setIteration] = useState(0);
  const [runId, setRunId] = useState<string | null>(null);
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [finishedAt, setFinishedAt] = useState<number | null>(null);
  const [clock, setClock] = useState(() => Date.now());
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${API_BASE}/observation`)
      .then(async (response) => {
        if (!response.ok) throw new Error(`Observation endpoint returned ${response.status}`);
        return (await response.json()) as Observation;
      })
      .then((data) => {
        if (!cancelled) setObservation(data);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const message = error instanceof Error ? error.message : "Backend unavailable";
        setLogs((current) => [...current, { time: nowTime(), agent: "SYSTEM", message: `Could not load the observation · ${message}. Is the backend running on ${API_BASE}?`, tone: "warning" }]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!isRunning) return;
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [isRunning]);

  useEffect(() => {
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [logs]);

  const fitted = Boolean(progress?.spectrum.length);
  const chartData: SpectrumPoint[] = fitted ? (progress?.spectrum ?? []) : (observation?.points ?? []);

  const residual = useMemo(() => {
    if (!progress?.spectrum.length) return null;
    const total = progress.spectrum.reduce((sum, point) => sum + Math.abs(point.target - (point.fit ?? point.target)), 0);
    return total / progress.spectrum.length;
  }, [progress]);

  const bestRow = progress?.iterations.find((row) => row.experiment_id === progress.best_experiment_id) ?? null;
  const rankedExperiments = useMemo(() => [...(progress?.iterations ?? [])].sort((a, b) => a.reduced_chi2 - b.reduced_chi2), [progress]);
  const metrics = useMemo(() => {
    if (!progress) return null;
    const best = progress.best_experiment_id ? progress.metrics[progress.best_experiment_id] : undefined;
    if (best) return best;
    const all = Object.values(progress.metrics);
    return all[all.length - 1] ?? null;
  }, [progress]);

  const workingCount = labAgents.filter(({ key }) => isRunning && agents[key]?.busy).length;
  const elapsed = startedAt ? formatElapsed((finishedAt ?? clock) - startedAt) : null;

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
      if (event.agent === "ANALYSIS" && event.kind === "message") {
        const found = (event.detail ?? event.message).match(/VERDICT:\s*(.+)/);
        if (found?.[1]) setVerdict({ title: event.title, text: found[1].trim() });
      }
    }
  }

  async function runDiscovery() {
    if (isRunning) return;
    setIsRunning(true);
    setStatus("running");
    setAgents({});
    setIteration(0);
    setProgress(null);
    setReport("");
    setHypotheses([]);
    setVerdict(null);
    setRunId(null);
    setStartedAt(Date.now());
    setFinishedAt(null);
    setLogs((current) => [...current, { time: nowTime(), agent: "SYSTEM", message: "New discovery loop initiated · POST /runs", tone: "signal" }]);

    try {
      const started = await fetch(`${API_BASE}/runs`, { method: "POST" });
      if (!started.ok) throw new Error(`Discovery service returned ${started.status}`);
      const { run_id: newRunId } = (await started.json()) as { run_id: string };
      setRunId(newRunId);

      let after = 0;
      let payload: Record<string, unknown> | null = null;
      for (;;) {
        const response = await fetch(`${API_BASE}/runs/${newRunId}?after=${after}`);
        if (!response.ok) throw new Error(`Discovery service returned ${response.status}`);
        const run = (await response.json()) as {
          status: string;
          events: AgentEvent[];
          progress: Progress;
          result: Record<string, unknown> | null;
          error: string | null;
        };
        applyEvents(run.events);
        after += run.events.length;
        setProgress(run.progress);
        if (run.status === "error") throw new Error(run.error ?? "Discovery loop failed");
        if (run.status === "complete") {
          payload = run.result;
          break;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1500));
      }
      if (!payload) throw new Error("Discovery loop returned no result");

      setProgress(payload as unknown as Progress);
      if (typeof payload["report"] === "string") setReport(payload["report"]);
      setHypotheses(parseHypotheses(payload["hypotheses"]));
      if (typeof payload["verdict"] === "string" && payload["verdict"]) setVerdict({ title: "final", text: payload["verdict"] });
      setStatus("complete");
      setLogs((current) => [...current, { time: nowTime(), agent: "SYSTEM", message: "Discovery loop complete · report synchronized", tone: "success" }]);
    } catch (error) {
      setStatus("error");
      const message = error instanceof Error ? error.message : "Discovery service unavailable";
      setLogs((current) => [...current, { time: nowTime(), agent: "SYSTEM", message, tone: "warning" }]);
    } finally {
      setAgents((current) => Object.fromEntries(Object.entries(current).map(([key, value]) => [key, { ...value, busy: false }])));
      setFinishedAt(Date.now());
      setIsRunning(false);
    }
  }

  const coverage = observation ? `${fmt(observation.wavelength_range_um[0], 1)}–${fmt(observation.wavelength_range_um[1], 1)}` : "—";

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
              <p className="truncate font-mono text-[10px] text-muted-foreground">OBS / {observation?.target_file ?? "loading…"}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 font-mono text-[10px] uppercase">
            <div className="hidden items-center gap-2 text-muted-foreground md:flex">
              <span className={cn("size-1.5 rounded-full", workingCount ? "animate-pulse bg-success" : "bg-muted-foreground")} />
              {workingCount}/{labAgents.length} agents working
            </div>
            <div className="border-l border-border pl-3 text-right">
              <div className="text-foreground">{runId ?? "No run yet"}</div>
              <div className="text-muted-foreground">{elapsed ? `Run time ${elapsed}` : "—"}</div>
            </div>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-[1600px] px-4 py-5 sm:px-6 lg:px-8">
        <section className="mb-5 grid gap-4 border-b border-border pb-5 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <div className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase text-primary">
              <Radio className="size-3" /> Observation
            </div>
            <h1 className="font-display text-3xl font-semibold tracking-normal sm:text-4xl">Transmission spectrum</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              {observation
                ? `${observation.target_file} · ${observation.n_points} points · ${coverage} μm · stellar parameters ${observation.stellar_parameters.split(" ")[0]}`
                : "Loading the observation from the backend…"}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3 lg:justify-end">
            <div className="hidden border-r border-border pr-4 text-right sm:block">
              <p className="font-mono text-[10px] uppercase text-muted-foreground">Best fit so far</p>
              <p className="mt-1 font-mono text-sm text-foreground">
                {bestRow ? `χ²ᵣ ${fmt(bestRow.reduced_chi2, 2)} · ${bestRow.experiment_id}` : "No experiment yet"}
              </p>
            </div>
            <Button
              onClick={runDiscovery}
              disabled={isRunning || !observation}
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
              <PanelHeader
                icon={<Activity />}
                title="Transmission Spectrum"
                eyebrow={fitted && progress?.best_experiment_id ? `Observed vs. best model · ${progress.best_experiment_id}` : "Observed · no model yet"}
              >
                <div className="flex items-center gap-4 font-mono text-[10px] text-muted-foreground">
                  <LegendDot className="bg-primary" label="Observed" />
                  {fitted && <LegendDot className="bg-coral" label="Best model" />}
                </div>
              </PanelHeader>
              <div className="grid grid-cols-2 border-b border-border sm:grid-cols-4">
                <Metric label="Median depth" value={fmt(observation?.median_depth_ppm)} unit="ppm" />
                <Metric label="Noise σ" value={fmt(observation?.noise_ppm)} unit="ppm" />
                <Metric label="Mean |residual|" value={fmt(residual, 1)} unit={residual === null ? undefined : "ppm"} />
                <Metric label="Coverage" value={coverage} unit="μm" />
              </div>
              <div className="h-[390px] px-1 pb-3 pt-5 sm:px-4">
                {chartData.length ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={chartData} margin={{ top: 8, right: 16, left: 0, bottom: 8 }}>
                      <defs>
                        <linearGradient id="targetArea" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.18} />
                          <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="var(--chart-grid)" strokeDasharray="2 5" vertical={false} />
                      <XAxis dataKey="wavelength" type="number" domain={["dataMin", "dataMax"]} tickCount={7} stroke="var(--muted-foreground)" tickLine={false} axisLine={{ stroke: "var(--border)" }} tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }} label={{ value: "WAVELENGTH (μm)", position: "insideBottom", offset: -4, fill: "var(--muted-foreground)", fontSize: 9 }} />
                      <YAxis domain={[(min: number) => Math.floor((min - 100) / 100) * 100, (max: number) => Math.ceil((max + 100) / 100) * 100]} tickCount={6} stroke="var(--muted-foreground)" tickLine={false} axisLine={false} width={56} tick={{ fontSize: 10, fontFamily: "var(--font-mono)" }} tickFormatter={(value: number) => fmt(value)} label={{ value: "TRANSIT DEPTH (ppm)", angle: -90, position: "insideLeft", fill: "var(--muted-foreground)", fontSize: 9 }} />
                      <Tooltip content={<SpectrumTooltip />} cursor={{ stroke: "var(--border-strong)", strokeDasharray: "3 3" }} />
                      <ReferenceLine x={1.4} stroke="var(--border-strong)" strokeDasharray="2 4" label={{ value: "H₂O", fill: "var(--muted-foreground)", fontSize: 9, position: "top" }} />
<<<<<<< Updated upstream
                      <ReferenceLine x={1.9} stroke="var(--border-strong)" strokeDasharray="2 4" label={{ value: "H₂O", fill: "var(--muted-foreground)", fontSize: 9, position: "top" }} />
=======
                      {[{ x: 1.9, label: "H₂O" }, { x: 2.7, label: "H₂O" }, { x: 3.3, label: "CH₄" }, { x: 4.3, label: "CO₂" }].map(({ x, label }) => (
                        <ReferenceLine key={x} x={x} stroke="var(--border-strong)" strokeDasharray="2 4" label={{ value: label, fill: "var(--muted-foreground)", fontSize: 9, position: "top" }} />
                      ))}
>>>>>>> Stashed changes
                      <Area type="monotone" dataKey="target" fill="url(#targetArea)" stroke="none" />
                      {fitted && <Line type="monotone" dataKey="fit" name="model" stroke="var(--coral)" strokeWidth={2} dot={false} activeDot={{ r: 4, fill: "var(--coral)", stroke: "var(--background)" }} animationDuration={900} />}
                      <Line type="monotone" dataKey="target" name="observed" stroke="var(--primary)" strokeWidth={1.5} dot={{ r: 1.5, fill: "var(--primary)", strokeWidth: 0 }} activeDot={{ r: 5, fill: "var(--primary)", stroke: "var(--background)" }} animationDuration={700} />
                    </ComposedChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyState>Waiting for the observation from the backend.</EmptyState>
                )}
              </div>
            </Panel>

            <Panel>
              <PanelHeader icon={<Sparkles />} title="Agent Activity" eyebrow="What each agent is working on">
                <span className="font-mono text-[10px] uppercase text-muted-foreground">{isRunning ? "Live" : "Standby"}</span>
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
              <PanelHeader icon={<Table2 />} title="Experiments" eyebrow="Produced by the experiment runner">
                <span className="font-mono text-[10px] uppercase text-muted-foreground">{progress?.iterations.length ?? 0} run</span>
              </PanelHeader>
              {progress?.iterations.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full font-mono text-[11px]">
                    <thead className="text-[9px] uppercase text-muted-foreground">
                      <tr className="border-b border-border">
<<<<<<< Updated upstream
                        {["#", "Experiment", "H₂O", "Haze", "Baseline (ppm)", "χ²ᵣ", "RMSE (ppm)"].map((heading) => (
=======
                        {["#", "Experiment", "H₂O", "CO₂", "CH₄", "Haze", "Slope", "Baseline (ppm)", "χ²ᵣ", "RMSE (ppm)"].map((heading) => (
>>>>>>> Stashed changes
                          <th key={heading} className="px-4 py-2 text-left font-normal">{heading}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {progress.iterations.map((row) => (
                        <tr key={row.experiment_id} className={cn("border-b border-border/40 last:border-0", row.experiment_id === progress.best_experiment_id && "bg-primary/5")}>
                          <td className="px-4 py-2 text-muted-foreground">{row.iteration}</td>
                          <td className="px-4 py-2">
                            {row.experiment_id}
                            {row.experiment_id === progress.best_experiment_id && <span className="ml-2 text-[9px] uppercase text-primary">best</span>}
                          </td>
                          <td className="px-4 py-2">{fmt(row.h2o_abundance, 2)}</td>
<<<<<<< Updated upstream
                          <td className="px-4 py-2">{fmt(row.haze_factor, 2)}</td>
=======
                          <td className="px-4 py-2">{fmt(row.co2_abundance ?? 0, 2)}</td>
                          <td className="px-4 py-2">{fmt(row.ch4_abundance ?? 0, 2)}</td>
                          <td className="px-4 py-2">{fmt(row.haze_factor, 2)}</td>
                          <td className="px-4 py-2">{fmt(row.haze_slope ?? 1, 1)}</td>
>>>>>>> Stashed changes
                          <td className="px-4 py-2">{fmt(row.baseline_depth * 1e6)}</td>
                          <td className="px-4 py-2">{fmt(row.reduced_chi2, 2)}</td>
                          <td className="px-4 py-2">{fmt(row.rmse * 1e6, 1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState className="h-24">Experiments appear here as soon as the experiment runner produces them.</EmptyState>
              )}
            </Panel>

            <Panel>
              <PanelHeader icon={<TerminalSquare />} title="Agent Log Stream" eyebrow={`Iteration ${iteration.toString().padStart(2, "0")}`}>
                <div className="flex items-center gap-2 font-mono text-[10px] uppercase text-muted-foreground">
                  <span className={cn("size-1.5 rounded-full", isRunning ? "animate-pulse bg-success" : "bg-muted-foreground")} />
                  {isRunning ? "Streaming" : "Standby"}
                </div>
              </PanelHeader>
              <div className="h-96 overflow-y-auto bg-terminal px-4 py-3 font-mono text-[11px] leading-6 sm:px-5" aria-live="polite">
                {logs.length === 0 && <p className="text-muted-foreground">No agent activity yet. Start a discovery loop to stream every agent step.</p>}
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
              <PanelHeader icon={<Atom />} title="Analysis" eyebrow="Analysis agent & orchestrator">
                <StatusPill status={status} />
              </PanelHeader>
              <div className="space-y-5 p-4 sm:p-5">
                <div className="flex items-start gap-3 border-l-2 border-primary bg-primary/5 px-3 py-3">
                  <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
                  <div>
                    <p className="font-mono text-[10px] uppercase text-primary">Verdict{verdict?.title ? ` · ${verdict.title}` : ""}</p>
                    <p className="mt-1 text-sm leading-5 text-foreground">{verdict?.text ?? "No verdict yet. The analysis agent reports one after each experiment."}</p>
                  </div>
                </div>

                <div>
                  <div className="mb-3 flex items-center justify-between">
                    <h3 className="font-mono text-[10px] uppercase text-muted-foreground">{hypotheses.length ? "Hypothesis ranking" : "Experiments ranked by fit"}</h3>
                    <span className="font-mono text-[10px] text-muted-foreground">{hypotheses.length ? "Confidence" : "χ²ᵣ"}</span>
                  </div>
                  {hypotheses.length ? (
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
                  ) : rankedExperiments.length ? (
                    <div className="space-y-3">
                      {rankedExperiments.map((row) => (
                        <div key={row.experiment_id} className="flex items-end justify-between gap-3">
                          <div>
                            <p className="text-sm font-medium">{row.experiment_id}</p>
                            <p className="mt-0.5 font-mono text-[10px] text-muted-foreground">
<<<<<<< Updated upstream
                              H₂O {fmt(row.h2o_abundance, 2)} · haze {fmt(row.haze_factor, 2)} · baseline {fmt(row.baseline_depth * 1e6)} ppm
=======
                              H₂O {fmt(row.h2o_abundance, 2)} · CO₂ {fmt(row.co2_abundance ?? 0, 2)} · CH₄ {fmt(row.ch4_abundance ?? 0, 2)} · haze {fmt(row.haze_factor, 1)} (λ^-{fmt(row.haze_slope ?? 1, 1)})
>>>>>>> Stashed changes
                            </p>
                          </div>
                          <span className="font-mono text-sm font-semibold">{fmt(row.reduced_chi2, 2)}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-sm text-muted-foreground">No hypothesis tested yet.</p>
                  )}
                </div>

                <div className="border-t border-border pt-4">
                  <div className="mb-4 flex items-center justify-between">
                    <h3 className="font-mono text-[10px] uppercase text-muted-foreground">Final report</h3>
                    {report && <span className="font-mono text-[10px] text-success">MD · {runId}</span>}
                  </div>
                  {report ? <ReportMarkdown source={report} /> : <p className="text-sm text-muted-foreground">The orchestrator writes the report when the loop finishes.</p>}
                </div>
              </div>
            </Panel>

            <Panel>
              <PanelHeader icon={<Satellite />} title="Planet Metrics" eyebrow={metrics ? `Derived by the analysis agent · ${metrics.experiment_id}` : "Derived by the analysis agent"} />
              <dl className="grid grid-cols-2 gap-px bg-border">
                <ContextCell label="Transit S/N" value={fmt(metrics?.transit_snr, 1)} />
                <ContextCell label="Atmosphere signal" value={metrics ? `${fmt(metrics.atmosphere.detection_significance_sigma, 1)} σ` : "—"} />
                <ContextCell label="Rp / R*" value={fmt(metrics?.planet.rp_over_rstar, 4)} />
                <ContextCell label="Planet radius" value={metrics ? `${fmt(metrics.planet.radius_earth, 1)} R⊕ · ${fmt(metrics.planet.radius_jupiter, 2)} R♃` : "—"} />
                <ContextCell label="Assumed R*" value={metrics ? `${fmt(metrics.assumed_stellar_radius_rsun, 2)} R☉` : "—"} />
                <ContextCell label="Fit p-value" value={metrics ? metrics.goodness_of_fit.p_value.toExponential(1) : "—"} />
<<<<<<< Updated upstream
=======
                <div className="col-span-2 bg-card px-4 py-3">
                  <dt className="font-mono text-[9px] uppercase text-muted-foreground">Molecule detection (fit without molecule)</dt>
                  <dd className="mt-1 text-xs text-foreground">
                    {metrics?.molecules
                      ? Object.entries(metrics.molecules).map(([name, molecule]) => `${name} ${fmt(molecule.detection_significance_sigma, 1)} σ`).join(" · ")
                      : "—"}
                  </dd>
                </div>
>>>>>>> Stashed changes
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

function EmptyState({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("grid h-full place-items-center px-4 text-center text-sm text-muted-foreground", className)}>{children}</div>;
}

function Metric({ label, value, unit }: { label: string; value: string; unit?: string | undefined }) {
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

function SpectrumTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name?: string; value?: number; dataKey?: string }>; label?: number }) {
  if (!active || !payload?.length) return null;
  // The observed series is drawn twice (area + line); show each series once
  const rows = payload.filter((row, index) => row.name && payload.findIndex((other) => other.name === row.name) === index && row.name !== "target");
  return (
    <div className="min-w-40 border border-border-strong bg-popover p-3 shadow-panel">
      <p className="mb-2 font-mono text-[10px] text-muted-foreground">λ {Number(label).toFixed(2)} μm</p>
      {rows.map((row) => (
        <div key={row.name} className="flex items-center justify-between gap-4 text-xs">
          <span className="capitalize text-muted-foreground">{row.name}</span>
          <span className="font-mono text-popover-foreground">{fmt(row.value)} ppm</span>
        </div>
      ))}
    </div>
  );
}

function StatusPill({ status }: { status: RunStatus }) {
  const config = {
    ready: { label: "Ready", icon: FlaskConical, className: "border-border text-muted-foreground" },
    running: { label: "Analyzing", icon: RefreshCw, className: "border-primary/40 bg-primary/10 text-primary" },
    complete: { label: "Complete", icon: CheckCircle2, className: "border-success/40 bg-success/10 text-success" },
    error: { label: "Failed", icon: CircleAlert, className: "border-warning/40 bg-warning/10 text-warning" },
  }[status];
  const Icon = config.icon;
  return <span className={cn("flex items-center gap-1.5 border px-2 py-1 font-mono text-[9px] uppercase", config.className)}><Icon className={cn("size-3", status === "running" && "animate-spin")} />{config.label}</span>;
}

function ReportMarkdown({ source }: { source: string }) {
  return (
    <div className="space-y-3 text-sm leading-6 text-muted-foreground">
      {source.split("\n").filter((line) => line.trim()).map((line, index) => {
        const heading = line.match(/^#{1,6}\s+(.*)/);
        if (heading) return <h4 key={index} className="pt-1 font-display text-sm font-semibold text-foreground">{heading[1]}</h4>;
        const bullet = line.match(/^\s*[-*]\s+(.*)/);
        const text = bullet?.[1] ?? line;
        const parts = text.split(/(\*\*[^*]+\*\*)/g);
        const content = parts.map((part, partIndex) => part.startsWith("**") ? <strong key={partIndex} className="font-semibold text-foreground">{part.slice(2, -2)}</strong> : part);
        return bullet ? <p key={index} className="pl-3 before:-ml-3 before:mr-1.5 before:content-['·']">{content}</p> : <p key={index}>{content}</p>;
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
