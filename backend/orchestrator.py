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


async def _assistant_messages(client, session_id):
    items = await client.sessions.list_items(session_id, limit=1000)
    texts = []
    for item in items:
        if item.get("type") != "message" or item.get("role") != "assistant":
            continue
        content = item.get("content")
        if isinstance(content, str):
            texts.append(content)
        elif isinstance(content, list):
            texts.append("".join(b.get("text", "") for b in content if isinstance(b, dict)))
    return [t for t in texts if t.strip()]


async def _ask_orchestrator(server, prompt, timeout_s=3600, idle_grace_checks=3):
    """
    Drive the async orchestrator until it posts its final JSON summary.

    The orchestrator ends its turn after every sub-agent dispatch and is woken
    by the inbox when the sub-agent finishes, so one run spans many turns.
    """
    session = Session.from_dict(server.create_session(AGENT_NAME))
    async with OmnigentClient(base_url=server.base_url) as client:
        chat = SessionsChat(namespace=client.sessions, files_uploader=None, files_getter=None, session=session)
        await chat.query(prompt)

        deadline = time.monotonic() + timeout_s
        idle_checks = 0
        while time.monotonic() < deadline:
            messages = await _assistant_messages(client, session.id)
            if messages and _extract_json_block(messages[-1]):
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
                await chat.await_turn(timeout=60)

        messages = await _assistant_messages(client, session.id)
        return messages[-1] if messages else ""


def run_discovery(target_file=DEFAULT_TARGET, max_iterations=3, run_id=None):
    """
    Run the Omnigent discovery loop (literature → experiment → analysis) and
    return a dashboard payload: report, hypotheses, logs, spectrum, iterations.
    """
    run_id = _safe_id(run_id or f"run_{time.strftime('%Y%m%d_%H%M%S')}_{uuid.uuid4().hex[:6]}")
    prompt = (
        "Run the exoplanet discovery loop.\n"
        f"run_id: {run_id}\n"
        f"target_file: {target_file}\n"
        f"max_iterations: {max_iterations}"
    )

    with OmnigentServer(log_dir=RESULTS_DIR / run_id) as server:
        answer = asyncio.run(_ask_orchestrator(server, prompt))

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
