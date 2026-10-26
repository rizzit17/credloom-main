"""Train and evaluate the Credloom risk model.

    ./venv/bin/python training/train.py                 # synthetic data (default)
    ./venv/bin/python training/train.py --csv my.csv    # your own data with the same columns

Outputs (training/artifacts/):
    credit_model.joblib      calibrated model + feature list + metadata
    metrics.json             every number quoted in the report
    figures/*.png            ROC, calibration, importance, score distribution

The target is `defaulted` (0/1). The deployed score is
    score = round((1 - P(default)) * 1000)
so a calibrated probability matters more than raw classification accuracy.
"""
import argparse
import json
import time
import warnings
from pathlib import Path

import joblib
import matplotlib
import numpy as np
import pandas as pd

matplotlib.use("Agg")
import matplotlib.pyplot as plt
from sklearn.calibration import CalibratedClassifierCV, calibration_curve
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import GradientBoostingClassifier, HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.frozen import FrozenEstimator
from sklearn.inspection import permutation_importance
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import (average_precision_score, brier_score_loss, f1_score, log_loss, precision_score,
                             recall_score, roc_auc_score, roc_curve)
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

warnings.filterwarnings("ignore")
HERE = Path(__file__).resolve().parent
ART = HERE / "artifacts"
SEED = 42

# Features known at lending time. Repayment history is what the original model lacked.
BASE = ["total_transactions", "holding_days", "Tier", "num_previous_loans", "total_previous_loans_eth"]
HISTORY = BASE + ["loans_repaid", "loans_defaulted"]


def ks_stat(y, p):
    order = np.argsort(p)
    y = np.asarray(y)[order]
    cum_bad = np.cumsum(y) / max(y.sum(), 1)
    cum_good = np.cumsum(1 - y) / max((1 - y).sum(), 1)
    return float(np.max(np.abs(cum_bad - cum_good)))


def evaluate(model, X, y, threshold=0.5):
    p = model.predict_proba(X)[:, 1]
    pred = (p >= threshold).astype(int)
    return {
        "roc_auc": roc_auc_score(y, p), "pr_auc": average_precision_score(y, p), "ks": ks_stat(y, p),
        "brier": brier_score_loss(y, p), "log_loss": log_loss(y, p),
        "accuracy": float((pred == y).mean()), "precision": precision_score(y, pred, zero_division=0),
        "recall": recall_score(y, pred), "f1": f1_score(y, pred),
    }, p


# Direction each feature is ALLOWED to push risk. Enforced inside the trees, so the score can
# never get worse because a wallet repaid a loan, verified, or became more active.
#   -1: more of it => lower risk   +1: more of it => higher risk   0: unconstrained
MONOTONIC = {"total_transactions": -1, "holding_days": -1, "Tier": -1, "loans_repaid": -1, "loans_defaulted": 1,
             "total_previous_loans_eth": 1}


def mono_gbm(feats):
    return HistGradientBoostingClassifier(max_iter=250, learning_rate=0.05, max_depth=3, min_samples_leaf=30,
                                          l2_regularization=1.0, monotonic_cst=[MONOTONIC.get(f, 0) for f in feats],
                                          random_state=SEED)


def candidates(feats=None):
    feats = feats or HISTORY
    return {
        "Majority-class baseline": DummyClassifier(strategy="prior"),
        "Logistic regression": make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000)),
        "Random forest": RandomForestClassifier(n_estimators=300, min_samples_leaf=20, n_jobs=-1, random_state=SEED),
        "Gradient boosting (unconstrained)": GradientBoostingClassifier(n_estimators=250, learning_rate=0.05, max_depth=3,
                                                                       subsample=0.8, min_samples_leaf=30, random_state=SEED),
        "Gradient boosting (monotonic)": mono_gbm(feats),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", default=str(HERE / "data" / "wallet_credit_synthetic.csv"))
    a = ap.parse_args()
    t0 = time.time()
    df = pd.read_csv(a.csv)
    ART.mkdir(exist_ok=True, parents=True)
    (ART / "figures").mkdir(exist_ok=True)
    y = df["defaulted"].values

    # train 60% / validation 20% / test 20%; test is touched exactly once, at the end
    idx = np.arange(len(df))
    tr, rest = train_test_split(idx, test_size=0.4, stratify=y, random_state=SEED)
    va, te = train_test_split(rest, test_size=0.5, stratify=y[rest], random_state=SEED)
    report = {"dataset": {"rows": len(df), "default_rate": float(y.mean()), "train": len(tr), "validation": len(va), "test": len(te), "source": Path(a.csv).name, "synthetic": "synthetic" in a.csv}}

    # ---- 1) model comparison with 5-fold CV on the training split (feature set: HISTORY)
    cv = StratifiedKFold(5, shuffle=True, random_state=SEED)
    comp = {}
    for name, m in candidates().items():
        s = cross_val_score(m, df.loc[tr, HISTORY], y[tr], cv=cv, scoring="roc_auc")
        comp[name] = {"cv_auc_mean": float(s.mean()), "cv_auc_std": float(s.std())}
        print(f"  CV AUC  {name:26s} {s.mean():.4f} ± {s.std():.4f}")
    report["model_comparison_cv"] = comp

    # ---- 2) ablation: does repayment history matter? (validation set)
    abl = {}
    for label, feats in [("wallet activity + tier only (original feature set)", BASE), ("+ repayment history (proposed)", HISTORY)]:
        m = candidates(feats)["Gradient boosting (monotonic)"].fit(df.loc[tr, feats], y[tr])
        abl[label] = {k: float(v) for k, v in evaluate(m, df.loc[va, feats], y[va])[0].items()}
    report["feature_ablation_validation"] = abl
    print("  ablation AUC:", {k[:28]: round(v["roc_auc"], 4) for k, v in abl.items()})

    # ---- 3) final model: monotonic gradient boosting + sigmoid calibration on the validation set
    base = candidates()["Gradient boosting (monotonic)"].fit(df.loc[tr, HISTORY], y[tr])
    # Sigmoid (Platt) calibration is smooth; isotonic produced coarse plateaus that made scores jumpy
    final = CalibratedClassifierCV(FrozenEstimator(base), method="sigmoid").fit(df.loc[va, HISTORY], y[va])
    uncal, _ = evaluate(base, df.loc[te, HISTORY], y[te])
    cal, p_te = evaluate(final, df.loc[te, HISTORY], y[te])
    report["final_test"] = {"uncalibrated": {k: float(v) for k, v in uncal.items()}, "calibrated": {k: float(v) for k, v in cal.items()}}

    # best F1 threshold chosen on validation (never on test)
    pv = final.predict_proba(df.loc[va, HISTORY])[:, 1]
    ths = np.linspace(0.05, 0.8, 76)
    best = float(ths[int(np.argmax([f1_score(y[va], (pv >= t).astype(int)) for t in ths]))])
    ct, _ = evaluate(final, df.loc[te, HISTORY], y[te], threshold=best)
    report["operating_point"] = {"threshold_chosen_on_validation": best, "test_metrics": {k: float(v) for k, v in ct.items()}}

    # ---- 4) does the 0-1000 score actually rank risk? default rate by score band (test)
    score = np.round((1 - p_te) * 1000).astype(int)
    bands = pd.cut(score, [-1, 399, 549, 649, 749, 1000], labels=["0-399", "400-549", "550-649", "650-749", "750-1000"])
    tab = pd.DataFrame({"band": bands, "y": y[te]}).groupby("band", observed=True)["y"].agg(["count", "mean"])
    report["score_bands_test"] = {str(k): {"wallets": int(v["count"]), "observed_default_rate": float(v["mean"])} for k, v in tab.iterrows()}
    print("  score bands (test):\n" + tab.round(3).to_string())

    # ---- 5) permutation importance on test
    pi = permutation_importance(final, df.loc[te, HISTORY], y[te], scoring="roc_auc", n_repeats=10, random_state=SEED)
    imp = sorted(zip(HISTORY, pi.importances_mean, pi.importances_std), key=lambda t: -t[1])
    report["permutation_importance_auc_drop"] = {f: {"mean": float(m), "std": float(s)} for f, m, s in imp}

    # ---- figures
    fig, ax = plt.subplots(1, 3, figsize=(15, 4.4))
    for name, m in candidates().items():
        if name.startswith("Majority"):
            continue
        mm = m.fit(df.loc[tr, HISTORY], y[tr])
        pr = mm.predict_proba(df.loc[te, HISTORY])[:, 1]
        fpr, tpr, _ = roc_curve(y[te], pr)
        ax[0].plot(fpr, tpr, label=f"{name} (AUC {roc_auc_score(y[te], pr):.3f})")
    ax[0].plot([0, 1], [0, 1], "k--", lw=0.8); ax[0].set(title="ROC curves (test set)", xlabel="False positive rate", ylabel="True positive rate"); ax[0].legend(fontsize=8)
    for lbl, mdl in [("uncalibrated", base), ("calibrated", final)]:
        fr, mp = calibration_curve(y[te], mdl.predict_proba(df.loc[te, HISTORY])[:, 1], n_bins=10, strategy="quantile")
        ax[1].plot(mp, fr, "o-", label=lbl)
    ax[1].plot([0, 1], [0, 1], "k--", lw=0.8); ax[1].set(title="Calibration (test set)", xlabel="Predicted default probability", ylabel="Observed default rate"); ax[1].legend()
    ax[2].barh([f for f, _, _ in imp][::-1], [m for _, m, _ in imp][::-1], color="#4f8ef7"); ax[2].set(title="Permutation importance (AUC drop)")
    plt.tight_layout(); plt.savefig(ART / "figures" / "evaluation.png", dpi=140); plt.close()

    plt.figure(figsize=(6.5, 4)); plt.hist(score, bins=40, color="#7c5cff"); plt.title("Distribution of credit scores (test set)"); plt.xlabel("Credit score (0-1000)")
    plt.tight_layout(); plt.savefig(ART / "figures" / "score_distribution.png", dpi=140); plt.close()

    joblib.dump({"model": final, "features": HISTORY, "version": "hgb-monotonic-2", "threshold": best,
                 "trained_on": Path(a.csv).name, "synthetic": report["dataset"]["synthetic"]}, ART / "credit_model.joblib")
    # publish figures for the web UI (served by Next.js from /model/*.png)
    pub = HERE.parent.parent / "frontend" / "public" / "model"
    if pub.parent.exists():
        pub.mkdir(exist_ok=True)
        for f in (ART / "figures").glob("*.png"):
            (pub / f.name).write_bytes(f.read_bytes())
    report["runtime_seconds"] = round(time.time() - t0, 1)
    (ART / "metrics.json").write_text(json.dumps(report, indent=2))
    t = report["final_test"]["calibrated"]
    print(f"\nFINAL TEST  AUC {t['roc_auc']:.4f}  PR-AUC {t['pr_auc']:.4f}  KS {t['ks']:.3f}  Brier {t['brier']:.4f}")
    print(f"operating point {best:.2f}: precision {ct['precision']:.3f} recall {ct['recall']:.3f} F1 {ct['f1']:.3f} accuracy {ct['accuracy']:.3f}")


if __name__ == "__main__":
    main()
