"""Credloom AI Risk Service.

Serves the default-risk model and turns it into a 0-1000 credit score:
    score = clip(round((1 - P(default)) * 1000), 0, 1000)

Model selection
  training/artifacts/credit_model.joblib  monotonic gradient-boosting classifier with Platt calibration (v2, default)
  best_gbr_risk_model_2.pkl               original regressor (legacy fallback; no repayment history)
Train v2 with:  ./venv/bin/python training/train.py

Run:  ./venv/bin/uvicorn server:app --port 5001
"""
from __future__ import annotations

import json
import warnings
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

warnings.filterwarnings("ignore")
HERE = Path(__file__).resolve().parent
ART = HERE / "training" / "artifacts"

V2 = joblib.load(ART / "credit_model.joblib") if (ART / "credit_model.joblib").exists() else None
METRICS = json.loads((ART / "metrics.json").read_text()) if (ART / "metrics.json").exists() else None
REAL = json.loads((ART / "real_benchmark.json").read_text()) if (ART / "real_benchmark.json").exists() else None
LEGACY = joblib.load(HERE / "best_gbr_risk_model_2.pkl")
LEGACY_FEATURES = list(joblib.load(HERE / "feature_names_2.pkl"))

if V2:
    MODEL_VERSION, FEATURES = V2["version"], list(V2["features"])
else:
    MODEL_VERSION, FEATURES = "gbr-risk-2", LEGACY_FEATURES

FEATURE_LABELS = {
    "total_transactions": "Wallet transaction count",
    "num_previous_loans": "Previous loans taken",
    "total_previous_loans_eth": "Total previously borrowed (ETH)",
    "holding_days": "Wallet age (days)",
    "borrow_per_day": "Borrowing intensity (ETH/day)",
    "Tier": "Verification tier",
    "loans_repaid": "Loans repaid in full",
    "loans_defaulted": "Loans defaulted",
}
SWEEP = {
    "total_transactions": (0, 500), "holding_days": (1, 1500), "Tier": (1, 3), "num_previous_loans": (0, 12),
    "total_previous_loans_eth": (0, 30), "loans_repaid": (0, 12), "loans_defaulted": (0, 5),
}
PMIN, PMAX = 0.02, 0.98  # probability clip: scores span 20..980
INT_FEATURES = {"total_transactions", "num_previous_loans", "Tier", "loans_repaid", "loans_defaulted"}
if not V2:
    SWEEP = {k: v for k, v in SWEEP.items() if k in LEGACY_FEATURES}

app = FastAPI(title="Credloom AI Risk Service", version="2.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
if (ART / "figures").exists():
    app.mount("/figures", StaticFiles(directory=ART / "figures"), name="figures")


class Applicant(BaseModel):
    total_transactions: int = Field(ge=0, le=1_000_000)
    num_previous_loans: int = Field(ge=0, le=10_000)
    total_previous_loans_eth: float = Field(ge=0, le=1_000_000)
    holding_days: float = Field(ge=0, le=36_500)
    Tier: int = Field(ge=1, le=3)
    loans_repaid: int = Field(default=0, ge=0, le=10_000)
    loans_defaulted: int = Field(default=0, ge=0, le=10_000)


def _frame(rows: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(rows)
    for c in ("loans_repaid", "loans_defaulted"):
        if c not in df:
            df[c] = 0
    # history can never exceed the number of loans taken
    df["num_previous_loans"] = np.maximum(df["num_previous_loans"], df["loans_repaid"] + df["loans_defaulted"])
    if not V2:
        df["borrow_per_day"] = df["total_previous_loans_eth"] / df["holding_days"].replace(0, 1e-6)
    return df[FEATURES]


def _default_prob(rows: list[dict]) -> np.ndarray:
    X = _frame(rows)
    if V2:
        # never claim certainty: keep probabilities away from 0 and 1
        return np.clip(V2["model"].predict_proba(X)[:, 1], PMIN, PMAX)
    return np.clip(LEGACY.predict(X), 0, 1)


def _score(p: float) -> int:
    return int(np.clip(round((1 - float(p)) * 1000), 0, 1000))


def _band(score: int) -> dict:
    if score >= 750:
        return {"label": "Excellent", "riskState": "healthy"}
    if score >= 650:
        return {"label": "Good", "riskState": "healthy"}
    if score >= 550:
        return {"label": "Fair", "riskState": "warning"}
    return {"label": "Poor", "riskState": "critical" if score < 400 else "warning"}


def predict_one(a: Applicant) -> tuple[int, float]:
    p = float(_default_prob([a.model_dump()])[0])
    return _score(p), p


def _importances() -> list[dict]:
    if V2 and METRICS:
        raw = {f: max(v["mean"], 0) for f, v in METRICS["permutation_importance_auc_drop"].items()}
        total = sum(raw.values()) or 1
        vals = {f: raw.get(f, 0) / total for f in FEATURES}
    else:
        vals = dict(zip(FEATURES, LEGACY.feature_importances_.tolist()))
    return sorted(({"feature": f, "label": FEATURE_LABELS[f], "importance": round(float(v), 4)} for f, v in vals.items()),
                  key=lambda x: x["importance"], reverse=True)


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_VERSION, "legacyFallback": V2 is None, "features": FEATURES}


@app.post("/predict")
def predict(a: Applicant):
    score, p = predict_one(a)
    return {
        "ai_risk_score": score, "credit_score": score, "risk_raw": round(p, 6), "default_probability": round(p, 4),
        **_band(score), "model": MODEL_VERSION,
    }


@app.post("/explain")
def explain(a: Applicant):
    """Score + what drives it: global importances and a local what-if sweep per input."""
    base = a.model_dump()
    base_score, base_p = predict_one(a)

    def score_rows(rows):
        return [_score(p) for p in _default_prob(rows)]

    sweeps, sens = [], []
    for feat, (lo, hi) in SWEEP.items():
        pts = np.linspace(lo, hi, 9)
        if feat in INT_FEATURES:
            pts = np.unique(np.round(pts).astype(int))
        cast = (lambda x: int(x)) if feat in INT_FEATURES else (lambda x: float(x))
        scores = score_rows([{**base, feat: cast(p)} for p in pts])
        sweeps.append({"feature": feat, "label": FEATURE_LABELS[feat], "current": base[feat],
                       "points": [{"x": float(x), "score": s} for x, s in zip(pts, scores)], "swing": max(scores) - min(scores)})
        ends = score_rows([{**base, feat: cast(lo)}, {**base, feat: cast(hi)}])
        sens.append({"feature": feat, "label": FEATURE_LABELS[feat], "value": base[feat], "potentialLoss": max(base_score - min(ends), 0)})
    sens.sort(key=lambda c: c["potentialLoss"], reverse=True)

    return {"creditScore": base_score, "riskRaw": round(base_p, 6), **_band(base_score), "importances": _importances(),
            "sweeps": sweeps, "sensitivity": sens, "model": MODEL_VERSION}


@app.get("/model/info")
def model_info():
    return {
        "model": MODEL_VERSION,
        "algorithm": "Monotonic gradient boosting + Platt calibration" if V2 else "GradientBoostingRegressor (legacy)",
        "features": [{"name": f, "label": FEATURE_LABELS[f]} for f in FEATURES],
        "scoreFormula": "score = clip(round((1 - P(default)) * 1000), 0, 1000)",
        "scoreRange": [0, 1000],
        "importances": _importances(),
        "trainedOn": V2["trained_on"] if V2 else "unknown (training data not available)",
        "synthetic": V2["synthetic"] if V2 else None,
        "metrics": METRICS,
        "realBenchmark": REAL,
        "legacyFallback": V2 is None,
    }
