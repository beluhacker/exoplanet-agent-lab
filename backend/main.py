from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import os
import threading

from backend.orchestrator import load_observation, new_run_id, run_discovery, run_progress

app = FastAPI(
    title="Exoplanet Agent Lab API",
    description="Autonomous multi-agent discovery lab for exoplanet transmission spectroscopy, orchestrated with Omnigent.",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Background runs started via POST /runs, kept in memory for the dashboard to poll
_runs = {}
_runs_lock = threading.Lock()


def _require_target(target_file):
    if not os.path.exists(target_file):
        raise HTTPException(
            status_code=404,
            detail="Target observation dataset not found. Please run simulator.py first."
        )


@app.get("/")
def read_root():
    return {
        "status": "online",
        "message": "Welcome to the Exoplanet Agent Lab API. Use POST /runs to start the Omnigent discovery loop and GET /runs/{run_id} to follow it."
    }

@app.get("/observation")
def get_observation(target_file: str = "data/target_spectrum.csv"):
    """The observed transmission spectrum (ppm) and its summary statistics."""
    _require_target(target_file)
    return load_observation(target_file)

@app.post("/run-discovery")
def trigger_discovery(max_iterations: int = 3, target_file: str = "data/target_spectrum.csv"):
    """
    Runs the Omnigent orchestrator (literature & insight → experiment runner → analysis).
    Blocks until the loop ends and returns the report, ranked hypotheses, agent logs,
    iteration history and best-fit spectrum.
    """
    _require_target(target_file)
    try:
        return run_discovery(target_file=target_file, max_iterations=max_iterations)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/runs")
def start_run(max_iterations: int = 3, target_file: str = "data/target_spectrum.csv"):
    """
    Starts the discovery loop in the background and returns its run_id right away.
    Poll GET /runs/{run_id} for the live agent activity and the final result.
    """
    _require_target(target_file)
    run_id = new_run_id()
    run = {"status": "running", "events": [], "result": None, "error": None}

    def emit(event):
        with _runs_lock:
            run["events"].append({"seq": len(run["events"]), **event})

    def worker():
        try:
            result = run_discovery(target_file=target_file, max_iterations=max_iterations, run_id=run_id, on_event=emit)
            with _runs_lock:
                run["result"], run["status"] = result, "complete"
        except Exception as e:
            with _runs_lock:
                run["error"], run["status"] = str(e), "error"

    with _runs_lock:
        _runs[run_id] = run
    threading.Thread(target=worker, name=f"discovery-{run_id}", daemon=True).start()
    return {"run_id": run_id, "status": "running"}

@app.get("/runs/{run_id}")
def get_run(run_id: str, after: int = 0):
    """
    Returns the run's status, the agent events with seq >= after, the
    experiments and analysis metrics produced so far, and the final payload
    (same shape as /run-discovery) once the loop has finished.
    """
    with _runs_lock:
        run = _runs.get(run_id)
        if run is None:
            raise HTTPException(status_code=404, detail=f"Unknown run {run_id}")
        snapshot = {
            "run_id": run_id,
            "status": run["status"],
            "events": run["events"][after:],
            "result": run["result"],
            "error": run["error"],
        }
    return {**snapshot, "progress": run_progress(run_id)}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, reload=True)
