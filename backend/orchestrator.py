"""
Headless runner for the Omnigent orchestrator defined in omni.yaml.

Starts a local Omnigent server with the orchestrator pre-registered, sends one
discovery request and turns the agents' output plus the stored experiments
(results/<run_id>/) into the payload the dashboard expects.
"""
import asyncio
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import tempfile
import time
import uuid
from pathlib import Path

import httpx
from dotenv import load_dotenv
from omnigent_client import OmnigentClient, SessionsChat
from omnigent_client._sessions import Session

from backend.lab_tools import RESULTS_DIR, DEFAULT_TARGET, _safe_id

REPO_ROOT = Path(__file__).resolve().parent.parent
AGENT_CONFIG = REPO_ROOT / "omni.yaml"
AGENT_NAME = "exoplanet_orchestrator"


def _windows_unix_tools_dir():
    """
    Omnigent hands Claude Code the API key as the apiKeyHelper `printf %s <key>`.
    On Windows that runs under cmd.exe, which has no printf, so the helper fails
    and every request gets a 401. Git for Windows ships printf.exe in usr/bin.
    """
    if os.name != "nt" or shutil.which("printf"):
        return None
    candidates = []
    git = shutil.which("git")
    if git:
        candidates.append(Path(git).resolve().parent.parent / "usr" / "bin")
    candidates.append(Path(os.environ.get("ProgramFiles", r"C:\Program Files"), "Git", "usr", "bin"))
    return next((str(c) for c in candidates if (c / "printf.exe").exists()), None)


def _free_port():
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class OmnigentServer:
    """
    Local Omnigent server with omni.yaml registered, plus a host that launches
    the runner which actually executes the agents. Logs go to files, not pipes.
    """

    def __init__(self, log_dir, startup_timeout=90.0):
        self.port = _free_port()
        self.base_url = f"http://127.0.0.1:{self.port}"
        self.log_dir = Path(log_dir)
        self.startup_timeout = startup_timeout
        self.host_id = None
        self._procs = []
        self._logs = []
        self._tmpdir = None

    def __enter__(self):
        load_dotenv(REPO_ROOT / ".env")
        # ignore_cleanup_errors: on Windows the SQLite file can stay locked briefly after shutdown
        self._tmpdir = tempfile.TemporaryDirectory(prefix="exoplanet-omnigent-", ignore_cleanup_errors=True)
        try:
            self._spawn("server", [
                "server",
                "--host", "127.0.0.1",
                "--port", str(self.port),
                "--database-uri", f"sqlite:///{Path(self._tmpdir.name, 'chat.db').as_posix()}",
                "--artifact-location", str(Path(self._tmpdir.name, "artifacts")),
                "--agent", str(AGENT_CONFIG),
            ])
            self._wait_for(self._server_healthy, "server")
            self._spawn("host", ["host", "--server", self.base_url, "--no-open", "--non-interactive"])
            self.host_id = self._wait_for(self._online_host_id, "host")
        except BaseException:
            self.__exit__()
            raise
        return self

    def _spawn(self, name, args):
        # The runner resolves the `backend.*` tool callables, so the repo must be importable
        env = {**os.environ, "PYTHONPATH": os.pathsep.join(filter(None, [str(REPO_ROOT), os.environ.get("PYTHONPATH")]))}
        unix_tools = _windows_unix_tools_dir()
        if unix_tools:
            env["PATH"] = os.pathsep.join([env.get("PATH", ""), unix_tools])
        self.log_dir.mkdir(parents=True, exist_ok=True)
        log = open(self.log_dir / f"omnigent_{name}.log", "wb")
        self._logs.append(log)
        self._procs.append(subprocess.Popen(
            [sys.executable, "-m", "omnigent", *args],
            cwd=REPO_ROOT, env=env, stdout=log, stderr=subprocess.STDOUT,
        ))

    def _server_healthy(self):
        return httpx.get(f"{self.base_url}/health", timeout=2.0).status_code == 200

    def _online_host_id(self):
        hosts = httpx.get(f"{self.base_url}/v1/hosts", timeout=5.0).json().get("hosts", [])
        return next((h["host_id"] for h in hosts if h.get("status") == "online"), None)

    def _wait_for(self, probe, name):
        deadline = time.monotonic() + self.startup_timeout
        while time.monotonic() < deadline:
            for proc in self._procs:
                if proc.poll() is not None:
                    raise RuntimeError(f"Omnigent process exited with code {proc.returncode}. See logs in {self.log_dir}")
            try:
                result = probe()
                if result:
                    return result
            except (httpx.TransportError, ValueError):
                pass
            time.sleep(0.5)
        raise RuntimeError(f"Omnigent {name} did not start within {self.startup_timeout}s. See logs in {self.log_dir}")

    def create_session(self, agent_name):
        """Create a session for a registered agent and launch its runner on our host."""
        agents = httpx.get(f"{self.base_url}/v1/agents", params={"limit": 1000}, timeout=10.0).json().get("data", [])
        agent_id = next(a["id"] for a in agents if a.get("name") == agent_name)
        response = httpx.post(
            f"{self.base_url}/v1/sessions",
            json={"agent_id": agent_id, "host_id": self.host_id, "workspace": str(REPO_ROOT), "title": "exoplanet discovery"},
            timeout=60.0,
        )
        response.raise_for_status()
        return response.json()

    def __exit__(self, *exc):
        # Stop the host before the server so it doesn't spin reconnecting
        for proc in reversed(self._procs):
            if proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=10)
                except subprocess.TimeoutExpired:
                    proc.kill()
        for log in self._logs:
            log.close()
        if self._tmpdir is not None:
            self._tmpdir.cleanup()


def _extract_json_block(text):
    """Return the last ```json block of the orchestrator's answer as a dict, if any."""
    blocks = re.findall(r"```json\s*(\{.*?\})\s*```", text, flags=re.DOTALL)
    for block in reversed(blocks):
        try:
            return json.loads(block)
        except json.JSONDecodeError:
            continue
    return {}


def _load_experiments(run_id):
    run_dir = RESULTS_DIR / _safe_id(run_id)
    return [json.loads(p.read_text(encoding="utf-8")) for p in sorted(run_dir.glob("exp_*.json"))]


def _blocks_text(blocks):
    if isinstance(blocks, str):
        return blocks
    if isinstance(blocks, list):
        return "".join(b.get("text", "") for b in blocks if isinstance(b, dict))
    return ""


async def _assistant_messages(client, session_id):
    items = await client.sessions.list_items(session_id, limit=1000)
    texts = [
        _blocks_text(item.get("content"))
        for item in items
        if item.get("type") == "message" and item.get("role") == "assistant"
    ]
    return [t for t in texts if t.strip()]


AGENT_LABELS = {
    AGENT_NAME: "ORCHESTRATOR",
    "literature_insight": "LITERATURE",
    "experiment_runner": "EXPERIMENT",
    "analysis_agent": "ANALYSIS",
}


def _shorten(text, limit=240):
    text = " ".join(str(text).split())
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _format_arguments(arguments):
    try:
        args = json.loads(arguments) if isinstance(arguments, str) else arguments
    except json.JSONDecodeError:
        return _shorten(arguments, 120)
    if not isinstance(args, dict):
        return _shorten(args, 120)
    return ", ".join(f"{k}={_shorten(v, 60)}" for k, v in args.items())


class ActivityFeed:
    """
    Turns new items of the orchestrator session and its sub-agent sessions
    (tasks, thinking, tool calls, tool results, messages) into dashboard events.
    """

    def __init__(self, client, root_id, on_event):
        self.client = client
        self.on_event = on_event
        self._sessions = {root_id: {"agent": "ORCHESTRATOR", "title": None, "busy": True, "root": True}}
        self._cursors = {}
        self._tool_names = {}

    def emit(self, agent, kind, message, title=None, detail=None):
        if self.on_event is None:
            return
        self.on_event({
            "time": time.strftime("%H:%M:%S"),
            "agent": agent,
            "kind": kind,
            "title": title,
            "message": message,
            "detail": detail if detail and detail != message else None,
        })

    async def poll(self):
        if self.on_event is None:
            return
        root_id = next(iter(self._sessions))
        for child in await self.client.sessions.child_sessions_tree(root_id):
            name = child.get("agent_name") or child.get("tool") or "agent"
            known = self._sessions.get(child["id"])
            if known is None:
                known = self._sessions[child["id"]] = {
                    "agent": AGENT_LABELS.get(name, name.upper()), "title": child.get("title"), "busy": False, "root": False,
                }
                self.emit(known["agent"], "status", f"{name} started", known["title"])
            busy = bool(child.get("busy"))
            if known["busy"] and not busy:
                self.emit(known["agent"], "status", f"{name} finished", known["title"])
            known["busy"] = busy

        for session_id, info in self._sessions.items():
            items = await self.client.sessions.list_items(session_id, limit=1000, after=self._cursors.get(session_id))
            for item in items:
                self._cursors[session_id] = item["id"]
                self._emit_item(item, info)

    def _emit_item(self, item, info):
        agent, title = info["agent"], info["title"]
        kind = item.get("type")
        if kind == "message":
            text = _blocks_text(item.get("content")).strip()
            if not text:
                return
            if item.get("role") == "assistant":
                self.emit(agent, "message", _shorten(text), title, text)
            elif not info["root"]:
                # The orchestrator's instructions to a sub-agent
                self.emit(agent, "task", _shorten(text), title, text)
        elif kind == "reasoning":
            text = (_blocks_text(item.get("summary")) or _blocks_text(item.get("content"))).strip()
            if text:
                self.emit(agent, "thinking", _shorten(text), title, text)
        elif kind == "function_call":
            name = item.get("name", "tool")
            self._tool_names[item.get("call_id")] = name
            arguments = item.get("arguments")
            self.emit(agent, "tool_call", f"{name}({_format_arguments(arguments)})", title,
                      arguments if isinstance(arguments, str) else json.dumps(arguments, indent=2))
        elif kind == "function_call_output":
            name = self._tool_names.get(item.get("call_id"), "tool")
            output = item.get("output")
            output = output if isinstance(output, str) else _blocks_text(output) or json.dumps(output)
            self.emit(agent, "tool_result", f"{name} → {_shorten(output, 160)}", title, output[:8000])
        elif kind == "error":
            self.emit(agent, "error", _shorten(item.get("message", "error")), title)


async def _ask_orchestrator(server, prompt, timeout_s=3600, idle_grace_checks=3, on_event=None):
    """
    Drive the async orchestrator until it posts its final JSON summary.

    The orchestrator ends its turn after every sub-agent dispatch and is woken
    by the inbox when the sub-agent finishes, so one run spans many turns.
    Meanwhile every agent's activity is forwarded to ``on_event``.
    """
    session = Session.from_dict(server.create_session(AGENT_NAME))
    # The first message blocks until the host has spawned a runner (the server waits
    # up to 10s + 30s for that), so the client's 30s default timeout is too short
    async with OmnigentClient(base_url=server.base_url, timeout=120.0) as client:
        feed = ActivityFeed(client, session.id, on_event)
        chat = SessionsChat(namespace=client.sessions, files_uploader=None, files_getter=None, session=session)
        feed.emit("SYSTEM", "status", "Discovery request sent to the orchestrator")
        await chat.query(prompt)

        deadline = time.monotonic() + timeout_s
        idle_checks = 0
        while time.monotonic() < deadline:
            await feed.poll()
            messages = await _assistant_messages(client, session.id)
            if messages and _extract_json_block(messages[-1]):
                await feed.poll()
                return messages[-1]
            await chat.refresh()
            if chat.status == "failed":
                raise RuntimeError(f"Orchestrator session {session.id} failed")
            if chat.status == "idle" and not await chat.tree_busy():
                # Nothing running anymore — give a late inbox wake a moment, then give up
                idle_checks += 1
                if idle_checks >= idle_grace_checks:
                    break
                await asyncio.sleep(5)
            else:
                idle_checks = 0
                # Short wait so the activity feed stays close to live
                await chat.await_turn(timeout=3)

        await feed.poll()
        messages = await _assistant_messages(client, session.id)
        return messages[-1] if messages else ""


def new_run_id():
    return f"run_{time.strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}"


def run_discovery(target_file=DEFAULT_TARGET, max_iterations=3, run_id=None, on_event=None):
    """
    Run the Omnigent discovery loop (literature → experiment → analysis) and
    return a dashboard payload: report, hypotheses, logs, spectrum, iterations.
    ``on_event`` receives every agent step while the loop runs (see ActivityFeed).
    """
    run_id = _safe_id(run_id or new_run_id())
    prompt = (
        "Run the exoplanet discovery loop.\n"
        f"run_id: {run_id}\n"
        f"target_file: {target_file}\n"
        f"max_iterations: {max_iterations}"
    )

    if on_event is not None:
        on_event({"time": time.strftime("%H:%M:%S"), "agent": "SYSTEM", "kind": "status", "title": None,
                  "message": f"Starting Omnigent server and agent host · {run_id}", "detail": None})
    with OmnigentServer(log_dir=RESULTS_DIR / run_id) as server:
        answer = asyncio.run(_ask_orchestrator(server, prompt, on_event=on_event))

    (RESULTS_DIR / run_id).mkdir(parents=True, exist_ok=True)
    (RESULTS_DIR / run_id / "orchestrator_answer.md").write_text(answer, encoding="utf-8")

    summary = _extract_json_block(answer)
    experiments = _load_experiments(run_id)
    iterations = [
        {
            "iteration": i,
            "experiment_id": exp["experiment_id"],
            **exp["hypothesis"],
            "rmse": exp["rmse"],
            "reduced_chi2": exp["reduced_chi2"],
        }
        for i, exp in enumerate(experiments, start=1)
    ]

    best = next((e for e in experiments if e["experiment_id"] == summary.get("best_experiment_id")), None)
    if best is None and experiments:
        best = min(experiments, key=lambda e: e["reduced_chi2"])
    spectrum = []
    if best is not None:
        spectrum = [
            {"wavelength": w, "target": o, "fit": m, "uncertainty": best["noise_sigma"]}
            for w, o, m in zip(best["wavelength_um"], best["observed_depth"], best["model_depth"])
        ]

    return {
        "status": "success",
        "run_id": run_id,
        "verdict": summary.get("verdict"),
        "report": summary.get("report") or answer,
        "hypotheses": summary.get("hypotheses", []),
        "logs": summary.get("logs", []),
        "iterations": iterations,
        "spectrum": spectrum,
    }


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    payload = run_discovery()
    print(payload["report"])
    print(json.dumps(payload["iterations"], indent=2))
