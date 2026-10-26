"""Synthetic wallet-credit dataset for Credloom.

IMPORTANT: this data is SYNTHETIC. No real borrower defaults exist for an
on-chain micro-lending product that has not launched, so we simulate wallets
from an explicit, documented generating process. Metrics computed on this data
measure how well a model recovers that process under noise, not real-world
default prediction. Real-data evidence for the modelling approach is in
real_benchmark.py.

Generating process
------------------
Each wallet has a hidden reliability r ~ N(0,1) that the model never sees.
Observed behaviour is correlated with r:
  holding_days        lognormal, median ~200 days
  total_transactions  grows with sqrt(age) and with r
  Tier                1 / 2 / 3, higher tiers more likely when r is high
  num_previous_loans  Poisson, grows with age
  loans_defaulted     Binomial(num_previous_loans, sigmoid(-2.2 - 0.9 r))
  loans_repaid        num_previous_loans - loans_defaulted
  total_previous_loans_eth  sum of lognormal loan sizes
Default label (the target) is Bernoulli(sigmoid(z)) with
  z = c - 0.12*(ln(1+txs)-3.5) - 0.15*(ln(1+age)-5) - 0.45*(Tier-1)
        + 1.4*[defaulted>0] + 0.5*defaulted - 0.25*min(repaid,6)
        + 0.20*(ln(1+eth)-1.5) - 0.8*r + N(0, 0.3)
The intercept c is solved so the overall default rate is TARGET_RATE.
Design assumption (stated openly): a young or quiet wallet is only weakly riskier
than an established one (small wallet/age coefficients). Credloom targets newcomers,
so *demonstrated repayment behaviour* (repaid / defaulted loans) and verification
tier, not wallet age, carry most of the signal.
Because r and the noise are hidden, even a perfect model cannot reach AUC 1.
"""
import argparse
from pathlib import Path

import numpy as np
import pandas as pd

TARGET_RATE = 0.22
FEATURES = [
    "total_transactions", "holding_days", "Tier", "num_previous_loans",
    "total_previous_loans_eth", "loans_repaid", "loans_defaulted",
]


def sigmoid(x):
    return 1 / (1 + np.exp(-x))


def generate(n: int = 20000, seed: int = 42) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    r = rng.normal(size=n)
    age = np.clip(rng.lognormal(np.log(200), 1.0, n), 1, 1500)
    txs = np.clip(rng.negative_binomial(3, 3 / (3 + 4 * np.sqrt(age) * np.exp(0.3 * r))), 0, 800)
    tier = 1 + (rng.random(n) < sigmoid(-0.4 + 0.7 * r)).astype(int)
    tier = np.where((tier == 2) & (rng.random(n) < sigmoid(-0.6 + 0.8 * r)), 3, tier)
    n_loans = rng.poisson(0.4 + age / 450)
    p_def = sigmoid(-2.2 - 0.9 * r)
    defaulted = rng.binomial(n_loans, p_def)
    repaid = n_loans - defaulted
    eth = np.array([rng.lognormal(np.log(0.8), 0.7, k).sum() if k else 0.0 for k in n_loans])

    z0 = (
        -0.12 * (np.log1p(txs) - 3.5) - 0.15 * (np.log1p(age) - 5.0) - 0.45 * (tier - 1)
        + 1.4 * (defaulted > 0) + 0.5 * defaulted - 0.25 * np.minimum(repaid, 6)
        + 0.20 * (np.log1p(eth) - 1.5) - 0.8 * r + rng.normal(0, 0.3, n)
    )
    lo, hi = -10.0, 10.0  # bisection for the intercept that hits TARGET_RATE
    for _ in range(60):
        c = (lo + hi) / 2
        if sigmoid(z0 + c).mean() > TARGET_RATE:
            hi = c
        else:
            lo = c
    p = sigmoid(z0 + c)
    df = pd.DataFrame({
        "total_transactions": txs.astype(int), "holding_days": age.round(1), "Tier": tier,
        "num_previous_loans": n_loans.astype(int), "total_previous_loans_eth": eth.round(4),
        "loans_repaid": repaid.astype(int), "loans_defaulted": defaulted.astype(int),
        "defaulted": rng.binomial(1, p),
    })
    return df


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=20000)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--out", default=str(Path(__file__).parent / "data" / "wallet_credit_synthetic.csv"))
    a = ap.parse_args()
    d = generate(a.n, a.seed)
    Path(a.out).parent.mkdir(parents=True, exist_ok=True)
    d.to_csv(a.out, index=False)
    print(f"wrote {len(d)} rows -> {a.out}")
    print(f"default rate: {d.defaulted.mean():.3f}")
    print(d.describe().T[["mean", "50%", "max"]].round(2).to_string())
