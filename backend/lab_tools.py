"""
Deterministic lab tools exposed to the Omnigent agents (see omni.yaml).

Every tool returns a JSON string so the agents get exact numbers instead of
doing the arithmetic themselves. Experiment results are persisted under
results/<run_id>/ so the API can rebuild the spectrum and iteration history.
"""
import json
import re
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path

import numpy as np
from scipy import stats

from backend.simulator import simulate_transmission_spectrum, evaluate_fit

REPO_ROOT = Path(__file__).resolve().parent.parent
RESULTS_DIR = REPO_ROOT / "results"
DEFAULT_TARGET = "data/target_spectrum.csv"

R_SUN_IN_R_EARTH = 109.1
R_JUP_IN_R_EARTH = 11.21

# Wavelength bands (um) the experiment runner reports residuals for
BANDS = {
    "optical_haze_0.4-1.2": (0.0, 1.2),
    "h2o_1.4_band_1.2-1.6": (1.2, 1.6),
    "h2o_1.9_band_1.6-2.2": (1.6, 2.2),
    "continuum_2.2+": (2.2, 99.0),
}


def _load_target(target_file):
    data = np.loadtxt(REPO_ROOT / target_file, delimiter=",", skiprows=1)
    return data[:, 0], data[:, 1]


def _noise_estimate(values):
    """Model-independent white-noise estimate from point-to-point scatter."""
    return float(np.std(np.diff(values), ddof=1) / np.sqrt(2))


def _safe_id(value):
    return re.sub(r"[^A-Za-z0-9_-]", "_", str(value)) or "default"


def _run_dir(run_id):
    path = RESULTS_DIR / _safe_id(run_id)
    path.mkdir(parents=True, exist_ok=True)
    return path


def describe_observation(target_file: str = DEFAULT_TARGET) -> str:
    """Summarize the observed transmission spectrum (coverage, depth, noise, features)."""
    wavelengths, depth = _load_target(target_file)
    sigma = _noise_estimate(depth)
    band_means = {
        name: round(float(depth[(wavelengths >= lo) & (wavelengths < hi)].mean()), 7)
        for name, (lo, hi) in BANDS.items()
        if np.any((wavelengths >= lo) & (wavelengths < hi))
    }
    return json.dumps({
        "target_file": target_file,
        "n_points": int(len(wavelengths)),
        "wavelength_range_um": [round(float(wavelengths.min()), 3), round(float(wavelengths.max()), 3)],
        "median_transit_depth": round(float(np.median(depth)), 7),
        "min_transit_depth": round(float(depth.min()), 7),
        "max_transit_depth": round(float(depth.max()), 7),
        "per_point_noise_estimate": round(sigma, 7),
        "mean_depth_per_band": band_means,
        "stellar_parameters": "unknown — not contained in the dataset",
    }, indent=2)


def search_literature(query: str, max_results: int = 5) -> str:
    """Search arXiv (astro-ph) and return titles, authors, year and abstracts."""
    max_results = max(1, min(int(max_results), 10))
    params = urllib.parse.urlencode({
        "search_query": f"cat:astro-ph.EP AND all:{query}",
        "start": 0,
        "max_results": max_results,
        "sortBy": "relevance",
    })
    url = f"http://export.arxiv.org/api/query?{params}"
    try:
        with urllib.request.urlopen(url, timeout=20) as response:
            feed = ET.fromstring(response.read())
    except Exception as e:
        return json.dumps({"query": query, "error": f"arXiv request failed: {e}", "papers": []})

    ns = {"a": "http://www.w3.org/2005/Atom"}
    papers = []
    for entry in feed.findall("a:entry", ns):
        authors = [a.findtext("a:name", default="", namespaces=ns) for a in entry.findall("a:author", ns)]
        abstract = " ".join((entry.findtext("a:summary", default="", namespaces=ns)).split())
        papers.append({
            "title": " ".join(entry.findtext("a:title", default="", namespaces=ns).split()),
            "authors": authors[:3] + (["et al."] if len(authors) > 3 else []),
            "year": entry.findtext("a:published", default="", namespaces=ns)[:4],
            "url": entry.findtext("a:id", default="", namespaces=ns),
            "abstract": abstract[:700] + ("…" if len(abstract) > 700 else ""),
        })
    return json.dumps({"query": query, "papers": papers}, indent=2)


def run_experiment(
    run_id: str,
    h2o_abundance: float,
    haze_factor: float,
    baseline_depth: float = 0.015,
    target_file: str = DEFAULT_TARGET,
) -> str:
    """Simulate the spectrum predicted by a hypothesis and compare it with the observation."""
    wavelengths, observed = _load_target(target_file)
    model = simulate_transmission_spectrum(
        wavelengths, h2o_abund=float(h2o_abundance), haze_factor=float(haze_factor),
        baseline_depth=float(baseline_depth),
    )
    residuals = observed - model
    sigma = _noise_estimate(observed)
    chi2 = float(np.sum((residuals / sigma) ** 2))
    dof = len(observed) - 3

    band_residuals = {}
    for name, (lo, hi) in BANDS.items():
        mask = (wavelengths >= lo) & (wavelengths < hi)
        if np.any(mask):
            band_residuals[name] = {
                "mean_residual": round(float(residuals[mask].mean()), 8),
                "residual_in_sigma_of_mean": round(float(residuals[mask].mean() / (sigma / np.sqrt(mask.sum()))), 2),
                "n_points": int(mask.sum()),
            }

    run_dir = _run_dir(run_id)
    experiment_id = f"exp_{len(list(run_dir.glob('exp_*.json'))) + 1:02d}"
    raw = {
        "run_id": _safe_id(run_id),
        "experiment_id": experiment_id,
        "hypothesis": {
            "h2o_abundance": float(h2o_abundance),
            "haze_factor": float(haze_factor),
            "baseline_depth": float(baseline_depth),
        },
        "target_file": target_file,
        "rmse": float(evaluate_fit(model, observed)),
        "chi2": chi2,
        "dof": dof,
        "reduced_chi2": chi2 / dof,
        "noise_sigma": sigma,
        "residual_definition": "observed - model (positive = observed transit deeper than model)",
        "band_residuals": band_residuals,
        "wavelength_um": wavelengths.tolist(),
        "observed_depth": observed.tolist(),
        "model_depth": model.tolist(),
    }
    (run_dir / f"{experiment_id}.json").write_text(json.dumps(raw), encoding="utf-8")

    # The agent gets the summary; the full arrays stay on disk
    summary = {k: v for k, v in raw.items() if k not in ("wavelength_um", "observed_depth", "model_depth")}
    summary["model_depth_range"] = [round(float(model.min()), 7), round(float(model.max()), 7)]
    summary["max_abs_residual"] = round(float(np.max(np.abs(residuals))), 8)
    return json.dumps(summary, indent=2)


def derive_planet_metrics(run_id: str, experiment_id: str, stellar_radius_rsun: float = 1.0) -> str:
    """Compute S/N, detection significance and planet radius from a stored experiment."""
    path = RESULTS_DIR / _safe_id(run_id) / f"{_safe_id(experiment_id)}.json"
    if not path.exists():
        return json.dumps({"error": f"Experiment {experiment_id} not found in run {run_id}."})
    raw = json.loads(path.read_text(encoding="utf-8"))
    observed = np.array(raw["observed_depth"])
    model = np.array(raw["model_depth"])
    sigma = raw["noise_sigma"]
    n = len(observed)

    # Transit detection: mean depth against the error of the mean
    mean_depth = float(observed.mean())
    transit_snr = mean_depth / (sigma / np.sqrt(n))

    # Atmosphere detection: does the model beat a flat (featureless) spectrum?
    chi2_flat = float(np.sum(((observed - mean_depth) / sigma) ** 2))
    chi2_model = raw["chi2"]
    delta_chi2 = chi2_flat - chi2_model
    p_model = float(stats.chi2.sf(chi2_model, raw["dof"]))

    # Spectral feature amplitude: peak model signal above its own minimum
    feature_amplitude = float(model.max() - model.min())
    feature_snr = feature_amplitude / sigma

    baseline_depth = raw["hypothesis"]["baseline_depth"]
    rp_rs = float(np.sqrt(baseline_depth))
    rp_earth = rp_rs * float(stellar_radius_rsun) * R_SUN_IN_R_EARTH

    metrics = {
        "run_id": raw["run_id"],
        "experiment_id": raw["experiment_id"],
        "hypothesis": raw["hypothesis"],
        "assumed_stellar_radius_rsun": float(stellar_radius_rsun),
        "mean_transit_depth": round(mean_depth, 7),
        "transit_snr": round(float(transit_snr), 1),
        "atmosphere": {
            "chi2_flat_line": round(chi2_flat, 1),
            "chi2_model": round(chi2_model, 1),
            "delta_chi2_vs_flat": round(delta_chi2, 1),
            "detection_significance_sigma": round(float(np.sqrt(max(delta_chi2, 0.0))), 1),
            "feature_amplitude": round(feature_amplitude, 7),
            "feature_snr_per_point": round(feature_snr, 2),
        },
        "goodness_of_fit": {
            "reduced_chi2": round(raw["reduced_chi2"], 3),
            "p_value": p_model,
            "rmse": raw["rmse"],
        },
        "planet": {
            "rp_over_rstar": round(rp_rs, 4),
            "radius_earth": round(rp_earth, 2),
            "radius_jupiter": round(rp_earth / R_JUP_IN_R_EARTH, 3),
        },
    }
    # Stored next to the experiment so the dashboard can show it while the loop runs
    (path.parent / f"metrics_{raw['experiment_id']}.json").write_text(json.dumps(metrics), encoding="utf-8")
    return json.dumps(metrics, indent=2)
