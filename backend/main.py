from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
import json
import os

from backend.loop import run_discovery_loop

app = FastAPI(
    title="Exoplanet Agent Lab API",
    description="Autonomous multi-agent discovery lab for exoplanet transmission spectroscopy and degeneracy analysis.",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.get("/")
def read_root():
    return {
        "status": "online",
        "message": "Welcome to the Exoplanet Agent Lab API. Use /run-discovery to start the autonomous loop."
    }

@app.post("/run-discovery")
def trigger_discovery(max_iterations: int = 3):
    """
    Triggers the autonomous multi-agent discovery loop.
    Returns the iteration history, best fits, and the final degeneracy report.
    """
    target_file = "data/target_spectrum.csv"
    if not os.path.exists(target_file):
        raise HTTPException(
            status_code=404,
            detail="Target observation dataset not found. Please run simulator.py first."
        )
    
    try:
        best_fits, analysis_report = run_discovery_loop(target_file=target_file, max_iterations=max_iterations)
        return {
            "status": "success",
            "iterations": best_fits,
            "analysis_report": analysis_report
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("backend.main:app", host="127.0.0.1", port=8000, reload=True)