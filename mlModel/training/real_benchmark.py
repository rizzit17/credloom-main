"""Real-data sanity check for the modelling approach.

Credloom's own wallet data does not exist yet, so we cannot measure real-world
accuracy. What we CAN do is check, on a REAL public default dataset, whether
gradient boosting is a reasonable algorithm choice versus simpler models, using
exactly the same protocol as train.py.

Dataset: "Default of Credit Card Clients" (Yeh & Lien 2009, UCI / OpenML id 42477)
         30,000 Taiwanese card holders, 22.1% defaulted next month.
These features (bill amounts, repayment status...) are NOT Credloom's wallet
features. This benchmark validates the method, not the deployed model.

    ./venv/bin/python training/real_benchmark.py
"""
import json
import warnings
from pathlib import Path

import numpy as np
from sklearn.datasets import fetch_openml
from sklearn.dummy import DummyClassifier
from sklearn.ensemble import GradientBoostingClassifier, RandomForestClassifier
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import average_precision_score, brier_score_loss, roc_auc_score
from sklearn.model_selection import StratifiedKFold, cross_val_score, train_test_split
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

warnings.filterwarnings("ignore")
SEED = 42
OUT = Path(__file__).parent / "artifacts" / "real_benchmark.json"


def main():
    d = fetch_openml("default-of-credit-card-clients", as_frame=True)
    X = d.data.apply(np.asarray, dtype=float) if False else d.data.astype(float)
    y = (d.target.astype(int)).values
    Xtr, Xte, ytr, yte = train_test_split(X, y, test_size=0.2, stratify=y, random_state=SEED)
    models = {
        "Majority-class baseline": DummyClassifier(strategy="prior"),
        "Logistic regression": make_pipeline(StandardScaler(), LogisticRegression(max_iter=2000)),
        "Random forest": RandomForestClassifier(n_estimators=300, min_samples_leaf=20, n_jobs=-1, random_state=SEED),
        "Gradient boosting": GradientBoostingClassifier(n_estimators=250, learning_rate=0.05, max_depth=3, subsample=0.8, min_samples_leaf=30, random_state=SEED),
    }
    cv = StratifiedKFold(5, shuffle=True, random_state=SEED)
    res = {"dataset": {"name": "UCI Default of Credit Card Clients", "rows": int(len(X)), "default_rate": float(y.mean()), "features": int(X.shape[1])}, "models": {}}
    for name, m in models.items():
        s = cross_val_score(m, Xtr, ytr, cv=cv, scoring="roc_auc")
        m.fit(Xtr, ytr)
        p = m.predict_proba(Xte)[:, 1]
        res["models"][name] = {"cv_auc": float(s.mean()), "cv_auc_std": float(s.std()), "test_auc": float(roc_auc_score(yte, p)),
                               "test_pr_auc": float(average_precision_score(yte, p)), "test_brier": float(brier_score_loss(yte, p))}
        r = res["models"][name]
        print(f"{name:26s} CV AUC {r['cv_auc']:.4f} ± {r['cv_auc_std']:.4f} | test AUC {r['test_auc']:.4f} | PR-AUC {r['test_pr_auc']:.4f} | Brier {r['test_brier']:.4f}")
    OUT.parent.mkdir(exist_ok=True, parents=True)
    OUT.write_text(json.dumps(res, indent=2))


if __name__ == "__main__":
    main()
