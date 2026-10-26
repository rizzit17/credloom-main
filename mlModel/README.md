# mlModel: AI credit risk service

Turns a wallet's behaviour and loan history into a **0–1000 credit score**, which the API converts into a dynamic APR (5%–25%) and credit limits.

> **Read this first: what the numbers do and do not mean.**
> Credloom has not launched, so no real wallet-default data exists. The deployed model is trained on a **synthetic, documented dataset**. Its metrics show how well the pipeline recovers a *known* risk process under noise. They are **not** evidence of real-world default prediction. Separately, the choice of algorithm is checked on a **real public dataset** (section 5), which validates the method but not the deployed model.

## Contents
1. [How a score is produced](#1-how-a-score-is-produced)
2. [Folder layout](#2-folder-layout)
3. [Dataset](#3-dataset)
4. [Model and results](#4-model-and-results)
5. [Real-data check of the algorithm choice](#5-real-data-check-of-the-algorithm-choice)
6. [The legacy model](#6-the-legacy-model)
7. [Running and reproducing](#7-running-and-reproducing)
8. [API](#8-api)
9. [Limitations](#9-limitations)

---

## 1. How a score is produced

```
wallet + loan history ──► monotonic gradient boosting ──► Platt calibration ──► P(default)
                                                                                  │ clip to [0.02, 0.98]
                              credit score = round((1 − P) × 1000)  ◄─────────────┘   (so scores span 20–980)
                                     │
                    backend: APR = clamp(25% − 20% × score/1000, 5%, 25%), then clamped into the lender's band
```

**Inputs (7):** `total_transactions`, `holding_days` (wallet age), `Tier` (1 wallet / 2 ENS / 3 passport), `num_previous_loans`, `total_previous_loans_eth`, `loans_repaid`, `loans_defaulted`.

**Monotonic constraints** are enforced inside the trees, so a score can never *fall* because a wallet repaid a loan, verified, or became more active, and can never *rise* after a default:

| Feature | Allowed direction of risk |
|---|---|
| `total_transactions`, `holding_days`, `Tier`, `loans_repaid` | more ⇒ lower risk |
| `loans_defaulted`, `total_previous_loans_eth` | more ⇒ higher risk |
| `num_previous_loans` | unconstrained (it equals repaid + defaulted) |

Verified one input at a time through the live service (base wallet: 12 transactions, 40 days, Tier 1, score 642):

| Input varied | Scores observed |
|---|---|
| `total_transactions` 0→500 | 528, 593, 642, 695, 774, 836, 881, 881 |
| `Tier` 1→3 | 642, 775, 901 |
| `loans_repaid` 0→12 | 642, 693, 732, 790, 871, 873 |
| `loans_defaulted` 0→5 | 642, 192, 108, 108 |
| `holding_days` 0→1500 | 642 → 651 (small by design) |
| `total_previous_loans_eth` 0→100 | 642 → 627 (small by design) |

## 2. Folder layout

```
mlModel/
├── server.py                     FastAPI service (port 5001)
├── training/
│   ├── generate_dataset.py       synthetic data generator (documented process)
│   ├── train.py                  split, CV, ablation, final model, plots, metrics.json
│   ├── real_benchmark.py         algorithm check on a real public dataset
│   ├── data/wallet_credit_synthetic.csv     20,000 generated wallets
│   └── artifacts/
│       ├── credit_model.joblib   the deployed model (v2)
│       ├── metrics.json          every number quoted below
│       ├── real_benchmark.json
│       └── figures/              ROC, calibration, importance, score distribution
├── best_gbr_risk_model_2.pkl     original model (legacy fallback)
├── feature_names_2.pkl           original feature order
├── model.py                      original inference helper (kept for reference)
└── requirements.txt
```

## 3. Dataset

`training/generate_dataset.py` (seed 42, 20,000 wallets, **22.1% default rate**).

Each wallet has a hidden reliability `r ~ N(0,1)` that the model never sees; observed behaviour is correlated with it:

| Variable | Generation |
|---|---|
| `holding_days` | lognormal, median ≈ 200 days, capped 1–1500 |
| `total_transactions` | negative binomial, grows with √age and with `r` |
| `Tier` | 1/2/3; higher tiers more likely when `r` is high |
| `num_previous_loans` | Poisson, grows with age |
| `loans_defaulted` | Binomial(loans, sigmoid(−2.2 − 0.9 r)); `loans_repaid` = remainder |
| `total_previous_loans_eth` | sum of lognormal loan sizes |

The label is `defaulted ~ Bernoulli(sigmoid(z))` where `z` combines (all stated in the source file) a weak negative effect of activity and age, −0.45 per tier step, +1.4 if any default plus +0.5 per default, −0.25 per repaid loan (capped at 6), a small positive effect of borrowed volume, −0.8·`r`, and N(0, 0.3) noise. The intercept is solved so the overall default rate is exactly 22%.

**A stated design assumption:** a young or quiet wallet is only *mildly* riskier. Credloom targets newcomers, so demonstrated repayment behaviour and verification tier carry most of the signal. This is a design choice, not a measured fact.

Because `r` and the noise are hidden, even a perfect model cannot reach AUC 1.0.

## 4. Model and results

**Protocol.** Stratified split 60% train (12,000) / 20% validation (4,000) / 20% test (4,000), seed 42. Model selection and calibration use train and validation only; the **test set is used once, at the end.** The decision threshold is chosen on validation data.

**Final model.** `HistGradientBoostingClassifier` (250 iterations, learning rate 0.05, depth 3, min leaf 30, L2 1.0, monotonic constraints) followed by Platt (sigmoid) calibration fitted on the validation set.

### 4.1 Held-out test results (4,000 wallets)

| Metric | Value | How to read it |
|---|---|---|
| ROC AUC | **0.772** | 0.5 = coin flip, 1.0 = perfect |
| PR AUC | 0.533 | baseline = default rate 0.221 |
| KS statistic | **0.405** | standard credit-risk separation measure |
| Brier score | 0.138 | probability error, lower is better (always-predict-base-rate = 0.172) |
| Log loss | 0.436 | |

At the default 0.5 threshold: accuracy 0.819, precision 0.720, recall 0.294, F1 0.417. Accuracy looks high only because 78% of wallets do not default; always predicting "no default" scores 0.779. That is why AUC, KS and calibration are the headline metrics.

At the operating threshold **0.30** (chosen on validation to maximise F1): precision **0.515**, recall **0.485**, F1 0.499, accuracy 0.785.

### 4.2 Does the score rank risk?

Observed default rate by credit-score band on the test set:

| Score band | Wallets | Observed default rate |
|---|---|---|
| 0–399 | 311 | **74.6%** |
| 400–549 | 90 | 54.4% |
| 550–649 | 157 | 39.5% |
| 650–749 | 594 | 28.6% |
| 750–1000 | 2,848 | **13.1%** |

Default rate falls steadily as the score rises, which is what a usable score must do.

### 4.3 Why repayment history was added (ablation, validation set)

| Inputs | AUC | KS | Recall @0.5 |
|---|---|---|---|
| Wallet activity + tier only (original feature set) | 0.678 | 0.267 | 0.026 |
| **+ loans repaid / defaulted** | **0.763** | **0.386** | 0.287 |

The original model could not distinguish a wallet with five defaults from one with five clean repayments. Adding history is the largest single improvement.

### 4.4 Algorithm comparison (5-fold CV on the training split, AUC)

| Model | CV AUC |
|---|---|
| Majority-class baseline | 0.500 ± 0.000 |
| Logistic regression | 0.771 ± 0.009 |
| Random forest | 0.763 ± 0.014 |
| Gradient boosting, unconstrained | 0.769 ± 0.011 |
| **Gradient boosting, monotonic (deployed)** | **0.771 ± 0.010** |

**These are statistically tied.** The synthetic generator is close to linear, so this table does **not** justify boosting over logistic regression. What the deployed model adds is the monotonic guarantee (no illogical score movements) and a non-linear form that can absorb real data's interactions. Section 5 is the evidence for tree ensembles.

### 4.5 Feature importance (permutation importance, test set; AUC drop)

`loans_defaulted` 0.140 · `Tier` 0.065 · `total_transactions` 0.038 · `loans_repaid` 0.011 · `num_previous_loans` 0.003 · `total_previous_loans_eth` 0.0003 · `holding_days` 0.0002.

Wallet age and borrowed volume contribute almost nothing, by the design assumption in section 3. Plots are in `training/artifacts/figures/` and on the `/project/model` page.

### 4.6 Calibration: an honest note

Platt calibration is applied, but it changes probabilities by at most **0.003** and leaves Brier and log-loss identical to four decimals. The boosted model's raw probabilities were already well calibrated (decile reliability within ±0.03). The step is kept as a safeguard for retraining on other data, **not** because it improved this model.

## 5. Real-data check of the algorithm choice

`training/real_benchmark.py` repeats the protocol on the **UCI "Default of Credit Card Clients"** dataset (30,000 real Taiwanese card holders, 22.1% defaulted, 23 features, via OpenML). Its features are *not* Credloom's wallet features, so this validates the **method**, not the deployed model.

| Model | CV AUC | Test AUC | PR AUC | Brier |
|---|---|---|---|---|
| Majority-class baseline | 0.500 | 0.500 | 0.221 | 0.172 |
| Logistic regression | 0.726 ± 0.011 | 0.708 | 0.494 | 0.147 |
| Random forest | 0.785 ± 0.005 | 0.775 | 0.554 | 0.135 |
| **Gradient boosting** | 0.783 ± 0.006 | **0.779** | **0.558** | **0.135** |

On real data tree ensembles beat logistic regression by about **7 AUC points**; boosting and random forest are effectively tied. This supports using a tree-based model.

## 6. The legacy model

`best_gbr_risk_model_2.pkl` (the Review 1/2 model, a `GradientBoostingRegressor`, 200 trees, depth 3) is kept as an automatic fallback if the v2 artifact is missing. Findings from inspecting it:

- **No training data or script exists in the repository**, so its accuracy cannot be measured and none is claimed.
- Its **training MSE is 0.00003**, far too clean for real default data; the labels were almost certainly formula-generated.
- Its trees never split `total_transactions` above 24.5 or `num_previous_loans` above 5.5, so it was trained on very small wallets and **saturates**: a wallet with 240 transactions scores the same as one with 30.
- It has no repayment-history inputs.
- Its output can fall slightly below 0 (observed −0.054), so v2 clips probabilities.

## 7. Running and reproducing

```bash
cd mlModel
python3 -m venv venv
./venv/bin/pip install -r requirements.txt

# serve (port 5001); uses training/artifacts/credit_model.joblib
./venv/bin/uvicorn server:app --host 127.0.0.1 --port 5001

# reproduce everything (about a minute)
./venv/bin/python training/generate_dataset.py
./venv/bin/python training/train.py          # writes artifacts/ and copies figures to frontend/public/model
./venv/bin/python training/real_benchmark.py # needs internet (OpenML)

# train on your own data: a CSV with the 7 feature columns plus a 0/1 `defaulted` column
./venv/bin/python training/train.py --csv my_data.csv
```

Library versions are pinned in `requirements.txt` because pickled scikit-learn models are version-sensitive (trained and tested with scikit-learn 1.7.2, Python 3.13).

## 8. API

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | status, model version, whether the legacy fallback is active |
| POST | `/predict` | score, `default_probability`, band label, risk state |
| POST | `/explain` | score plus feature importances and a one-at-a-time what-if sweep per input |
| GET | `/model/info` | algorithm, features, metrics, real benchmark (drives the `/project/model` page) |

`/predict` body: `total_transactions`, `num_previous_loans`, `total_previous_loans_eth`, `holding_days`, `Tier` (1–3), and optional `loans_repaid`, `loans_defaulted`. Inputs are validated (422 on bad values). `num_previous_loans` is raised to at least repaid + defaulted.

## 9. Limitations

- **Synthetic labels.** Real-world accuracy is unknown until real repayment data exists. The pipeline retrains on any CSV with the same columns.
- **Newcomer assumption.** Thin wallets are treated as only mildly risky (a design choice).
- **Gameable.** On-chain behaviour can be inflated (e.g. many small self-transactions). Tier verification and the permanent on-chain default flag are mitigations; Sybil resistance is not solved.
- **No fairness audit** has been run.
- The score is clipped to 20–980 so the model never claims certainty.
