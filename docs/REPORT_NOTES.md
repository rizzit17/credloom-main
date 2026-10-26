# Credloom: material for the final report (Review 3)

Companion to the READMEs. Everything here was measured or verified on the running system unless marked otherwise. Screenshots are in [`screenshots/`](screenshots/). Numbers come from `mlModel/training/artifacts/metrics.json`, the Hardhat gas reporter, and the test suites.

## 1. Objectives vs. implementation

| Objective (Review 1/2) | Implementation | Evidence |
|---|---|---|
| **O1** AI-based credit assessment | Monotonic gradient-boosting classifier on 7 wallet and loan-history features, served by `mlModel/server.py`; score = (1 − P(default)) × 1000; explanations and a what-if simulator | [mlModel/README.md](../mlModel/README.md); `/project/model`; screenshot 08, 18 |
| **O2** Reputation-based lending | `ReputationRegistry` stores loans, repayments, defaults, volumes and a transparent score; the escrow refuses flagged wallets; repayment history is also a model input | blockchain tests (flag permanence, blocked re-borrow); screenshot 06 |
| **O3** Dynamic risk-based pricing | APR = 25% − 20% × score/1000 (5%–25%), clamped into the lender's band; interest computed on-chain | backend e2e test; screenshot 07 |
| **O4** Decentralized loan management | Offer escrow → match → fund → partial / full repayment → default settlement, all in contracts; a keeper settles overdue loans | 27 contract tests; screenshots 10, 15, 16 |
| **O5** Lender risk protection | Per-loan reserved coverage, premium withheld from principal, automatic payout on default | test "default pays the lender from the insurer's stake"; seeded defaulted loan; screenshot 13 |
| **O6** Privacy-preserving verification | Tiers 1–3 (wallet / ENS / passport) recorded as identifiers and scores, never documents. **ENS and passport checks are simulated.** | screenshot 09; backend test |

## 2. What was added beyond Reviews 1 and 2

- **Transaction visualizer:** every blockchain action shows the pipeline and then the real receipt (block, hash, gas, fee) and each decoded contract event in plain English (screenshots 14–16).
- **Blockchain explorer:** blocks, transactions with decoded function arguments, contract event feed, deployed contracts (screenshot 02).
- **On-chain loan timeline** built from contract events (screenshot 10).
- **Explainable AI page:** inputs, feature importance, score → APR curve, what-if sweeps, live simulator (screenshot 08), and a full model card (screenshot 18).
- **Analytics:** volumes, default rate by score band, participants (screenshot 03).
- **Contract features:** partial repayments, insurer withdrawals and premiums, on-chain enforcement of lender rules, reputation score.
- **Demo tooling:** chain time travel, a keeper that settles overdue loans, and a seed script that builds a realistic world through the real API.
- **Engineering:** server-side roles, rate limiting, a service key between API and chain bridge, SQLite or Supabase behind one adapter, `scripts/dev.sh` one-command launcher.

## 3. Test results

| Suite | Count | Command |
|---|---|---|
| Smart contracts (Hardhat / Chai) | 27 passing | `cd blockchain && npm test` |
| Blockchain service (pytest, live chain) | 6 passing | `cd blockchain-service && ./venv/bin/python -m pytest tests` |
| API end-to-end (node:test, live chain) | 5 passing | `cd backend && npm test` |
| Frontend lint | 0 errors | `cd frontend && npm run lint` |

`./scripts/dev.sh test` runs the first three on a clean chain. The frontend was exercised with a scripted headless Chrome (not committed) across all roles, plus an overflow check at a 390 px viewport.

**Not covered:** committed UI tests, load or performance tests, fuzzing, a formal contract audit, Safari / Firefox, assistive-technology testing, the Supabase driver end to end.

## 4. Measured values

**Gas** (Hardhat gas reporter, optimizer 200 runs):

| Operation | Average gas |
|---|---|
| Create offer | 134,565 |
| Accept offer (originate loan) | 395,741 (284,365 – 510,648) |
| Repay | 118,893 |
| Settle default | 97,568 |
| Insurer deposit / set terms / withdraw | 67,645 / 45,478 / 44,837 |
| Withdraw offer | 41,780 |

Deployment: ReputationRegistry 535,399 · InsurancePool 697,927 · LoanEscrow 1,132,444 · LenderLiquidityPool 589,806 (total ≈ 2.96 M gas).

**Worked examples** (verified by tests):
- 1 ETH at 10% APR for 365 days ⇒ 0.1 ETH interest, exactly.
- 2% premium on 1 ETH ⇒ borrower receives 0.98 ETH, insurer earns 0.02 ETH, 1 ETH of coverage is reserved until repayment or default.
- A flagged wallet is rejected by the contract with `BorrowerFlagged`; a second default on another loan of the same borrower still settles.

## 5. AI model results (synthetic data; read the caveat)

Full tables and method in [mlModel/README.md](../mlModel/README.md). Summary:

| | Value |
|---|---|
| Data | 20,000 synthetic wallets, 22.1% default rate, 60 / 20 / 20 split, test used once |
| Held-out test | ROC AUC **0.772**, KS **0.405**, Brier **0.138**, PR AUC 0.533 |
| Operating point (threshold 0.30, chosen on validation) | precision 0.515, recall 0.485, F1 0.499 |
| Default rate by score band | 74.6% (0–399) → 54.4% → 39.5% → 28.6% → 13.1% (750–1000) |
| Ablation (validation AUC) | wallet activity + tier only 0.678 → with repayment history **0.763** |
| Algorithm comparison (synthetic CV AUC) | logistic 0.771, random forest 0.763, boosting 0.769, monotonic boosting 0.771: **tied** |
| Real-data check (UCI credit-card default, 30,000 customers, test AUC) | gradient boosting **0.779**, random forest 0.775, logistic regression 0.708 |

**How to word this in the report.** The synthetic metrics demonstrate that the training and evaluation pipeline works and that the score ranks risk in the expected direction; they do not measure real-world default prediction, because no real wallet-default data exists. The real-data benchmark uses different features and supports the *choice of a tree-ensemble algorithm*, not the deployed model's accuracy. Do not quote 0.77 AUC as "the accuracy of Credloom".

Findings about the **original** model (`best_gbr_risk_model_2.pkl`): no training data or script exists, its training MSE is 0.00003 (labels almost certainly formula-generated), it saturates beyond about 25 transactions, and it cannot see repayment history. No accuracy is claimed for it.

Platt calibration is applied but changes probabilities by at most 0.003; the raw model was already well calibrated.

## 6. Limitations to state honestly

1. Custodial demo wallets derived from the public Hardhat mnemonic. A production build needs wallet-signed transactions (EIP-712 borrower consent).
2. The credit oracle is trusted. The contracts bound it (lender score and APR rules are enforced on-chain) but cannot prove it is honest.
3. ENS and Gitcoin Passport verification are simulated.
4. The model is trained on synthetic data; wallet behaviour can be gamed; no fairness audit; Sybil resistance is not solved.
5. ETH only; no price oracle, fiat on-ramp, mainnet or public-testnet deployment; no formal audit.
6. A whole offer is lent to one borrower (no partial fills or pooled liquidity).
7. JWT is kept in `localStorage`; an httpOnly cookie would be stronger.

## 7. Future work

Wallet-based sign-in (SIWE) and borrower signatures; real ENS resolution and Passport API; zero-knowledge score attestations; partial-fill and pooled liquidity; ERC-20 stablecoins; late fees and rollover; event indexer and keeper network; retraining on real repayment data with a fairness audit; deployment to a public testnet.

## 8. Diagrams

The Review 1/2 use-case, class and data-flow diagrams remain valid except for these changes: insurance now reserves coverage per loan; interest is computed on-chain; the pool enforces the lender's score and APR band; borrowers can repay partially. The current component diagram is in the root [README](../README.md#architecture) (Mermaid).

## 9. Screenshot index

| # | Screen | # | Screen |
|---|---|---|---|
| 01 | Landing page | 10 | Loan detail with on-chain timeline |
| 02 | Blockchain explorer | 11 | Lender overview |
| 03 | Protocol analytics | 12 | Create offer |
| 04 | Architecture (project area) | 13 | Insurer overview |
| 05 | Live demo controls (project area) | 14 | Review a loan before signing |
| 06 | Borrower overview | 15 | Transaction visualizer: in progress |
| 07 | Loan marketplace | 16 | Transaction visualizer: confirmed receipt |
| 08 | AI credit score explainer | 17 | Mobile view of a loan |
| 09 | Tier verification | 18 | AI model card |
| 19 | Project documentation hub (demo logins) | | |
