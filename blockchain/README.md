# blockchain: Credloom smart contracts

Four Solidity contracts (0.8.28, optimizer 200 runs, `viaIR`) that hold funds, run the loan lifecycle, reserve insurance and keep a permanent borrower record. Built and tested with Hardhat.

## Contents
1. [Contracts at a glance](#1-contracts-at-a-glance)
2. [Money flow](#2-money-flow)
3. [Contract reference](#3-contract-reference)
4. [Trust model and invariants](#4-trust-model-and-invariants)
5. [Defects fixed from the Review 1/2 contracts](#5-defects-fixed-from-the-review-12-contracts)
6. [Tests](#6-tests)
7. [Gas costs](#7-gas-costs)
8. [Setup, deployment and ABI export](#8-setup-deployment-and-abi-export)

## 1. Contracts at a glance

| Contract | Responsibility |
|---|---|
| `LenderLiquidityPool` | Holds each lender's ETH in an *offer* with rules (term, minimum score, APR band). The protocol oracle matches borrowers; the contract enforces the rules. |
| `LoanEscrow` | Loan lifecycle: funds the borrower, stores terms, computes interest, accepts (partial) repayments, settles defaults. |
| `InsurancePool` | Insurers stake ETH and publish a premium. Coverage is **reserved per loan**; a default pays the lender from that reservation. |
| `ReputationRegistry` | Permanent per-wallet record (loans, repayments, defaults, volumes) and a transparent 0–1000 reputation score. A default flags the wallet. |

Wiring (one-shot, owner-only, done by `scripts/deploy.js`):
`registry.setLoanEscrowContract(escrow)` · `insurance.setLoanEscrowContract(escrow)` · `escrow.setLiquidityPool(pool)` · `pool.setLoanEscrow(escrow)` · `pool.setProtocol(oracle)`. The deployer is the owner and, in the demo, the protocol oracle.

## 2. Money flow

```
Lender ──createOffer(value)──► LenderLiquidityPool  (ETH held in escrow)
                                   │ acceptOffer  (oracle only; checks score + APR band)
                                   ▼
                              LoanEscrow.createFromOffer(value = principal)
                                   │  insured?  premium ──► InsurancePool (credited to insurer, coverage reserved)
                                   ▼  principal − premium
                               Borrower
Borrower ──repayLoan(value)──► LoanEscrow ──► Lender   (each payment forwarded immediately)
deadline + grace passed ──markDefault──► InsurancePool.payout ──► Lender ;  ReputationRegistry.flagBorrower
```

Interest is simple interest fixed at origination:

```
interest = principal × aprBps × duration / (365 days × 10_000)
```

e.g. 1 ETH, 1000 bps, 365 days ⇒ exactly 0.1 ETH.

## 3. Contract reference

### LenderLiquidityPool
| Function | Who | Notes |
|---|---|---|
| `createOffer(duration, minCreditScore, minAprBps, maxAprBps)` payable | anyone | needs value > 0, duration > 0, score ≤ 1000, min ≤ max ≤ 3000 bps |
| `withdrawOffer(offerId)` | offer's lender | only while the offer is active |
| `acceptOffer(offerId, borrower, aprBps, creditScore, isInsured, insurer)` | **protocol only** | reverts `CreditScoreTooLow` / `AprOutOfRange` / `OfferInactive`; returns the new `loanId` |

Events: `OfferCreated`, `OfferWithdrawn`, `OfferAccepted(offerId, loanId, borrower, aprBps, creditScore)`.

### LoanEscrow
| Function | Who | Notes |
|---|---|---|
| `createFromOffer(...)` payable | pool only | requires `msg.value == principal`, borrower not flagged, borrower ≠ lender, duration > 0 |
| `repayLoan(loanId)` payable | anyone | partial payments allowed; overpayment reverts; completes the loan at zero balance |
| `markDefault(loanId)` | anyone | only after `deadline + gracePeriod`; settles insurance, flags the borrower |
| views | | `getLoan`, `amountDue`, `isOverdue`, `quoteInterest` |

`gracePeriod` is a constructor argument (seconds). Events: `LoanFunded`, `LoanRepayment`, `LoanRepaid`, `LoanDefaulted(loanId, borrower, outstandingPrincipal, insurancePayout)`.

### InsurancePool
| Function | Who | Notes |
|---|---|---|
| `deposit()` payable / `withdraw(amount)` | insurer | withdraw is limited to **unreserved** funds |
| `setTerms(premiumBps, accepting)` | insurer | premium ≤ 2000 bps (20%) |
| `reserveCoverage`, `releaseCoverage`, `payout` | escrow only | reservation equals the loan principal |
| views | | `getInsurer`, `freeBalance`, `quotePremium`, `getInsurerBalance` |

Events: `InsurerDeposited`, `InsurerWithdrew`, `TermsUpdated`, `CoverageReserved`, `CoverageReleased`, `InsurancePayout`.

### ReputationRegistry
| Function | Who | Notes |
|---|---|---|
| `recordLoan`, `recordRepayment`, `flagBorrower` | escrow only | `flagBorrower` is idempotent (never reverts on a repeat default) |
| `getRecord`, `isBorrowerClean`, `isBorrowerFlagged`, `reputationPoints` | anyone | |

`reputationPoints = min(1000, 500 + 40 × loansRepaid − 250 × loansDefaulted)`, floored at 0. Events: `LoanRecorded`, `RepaymentRecorded`, `BorrowerFlagged`.

## 4. Trust model and invariants

**Trust assumptions.** The protocol oracle supplies the borrower's score and APR. It is trusted to report them honestly, but it **cannot lend outside what a lender allowed**: the pool reverts any score below the lender's minimum or APR outside the lender's band. Borrowers do not sign loan terms in this version (planned: EIP-712 consent).

**Invariants enforced by the code and covered by tests:**
- An offer can be matched once, and only while active.
- Funds only move to the borrower, the lender, the insurer or back to their owner; every external call happens after state changes, and every value-moving function has a reentrancy guard.
- An insurer can never reserve more than its unreserved balance, so one deposit cannot promise more than it holds; reserved funds cannot be withdrawn.
- A failing insurance payout cannot block settling a default (`try/catch`), so the borrower is always flagged.
- A defaulted or repaid loan cannot be repaid or defaulted again; unknown loan IDs revert with `LoanNotFound`.
- Setup functions are owner-only and can run once (no front-running of the wiring).

## 5. Defects fixed from the Review 1/2 contracts

| # | Old behaviour | Fix |
|---|---|---|
| 1 | A second default for the same borrower reverted (non-idempotent flagging), leaving the loan stuck | `flagBorrower` is idempotent |
| 2 | Unknown loan IDs read as FUNDED and could be "defaulted" (flagging `address(0)`) | explicit `NONE` state and `LoanNotFound` |
| 3 | One insurer deposit could back unlimited loans; no withdrawal; no on-chain premium | per-loan reservation, `withdraw`, premium withheld from principal |
| 4 | Anyone could front-run the one-shot setters | owner-only wiring |
| 5 | Interest was a flat caller-supplied number | computed on-chain from APR and duration |
| 6 | The lender's minimum score was stored but never enforced | enforced in `acceptOffer` |
| 7 | No reentrancy protection | guards on all value-moving functions |
| 8 | The old test suite targeted functions that no longer existed | replaced with 27 tests |

## 6. Tests

`npm test` runs `test/Credloom.test.js` (Hardhat + Chai, 27 tests):

| Group | Tests |
|---|---|
| Wiring and access control | 3 |
| Lender offers (creation, withdrawal, validation, on-chain rule enforcement) | 3 |
| Loan origination (funding, on-chain interest, reputation record, self-loan, single use) | 5 |
| Repayment (full, partial, overpayment, zero and unknown loans) | 3 |
| Default handling (deadline, permanent flag, double default regression, grace period, finality) | 5 |
| Insurance (stake and terms, reserve and premium, rejection cases, over-commitment regression, release, payout, partial repayment) | 7 |
| Reputation points | 1 |

Not done: fuzzing, formal verification, an external audit.

## 7. Gas costs

Measured with `REPORT_GAS=true npx hardhat test` (Solidity 0.8.28, optimizer on, 200 runs):

| Operation | Avg gas |
|---|---|
| `createOffer` | 134,565 |
| `acceptOffer` (loan origination, includes reputation record and optional insurance reservation) | 395,741 (min 284,365, max 510,648) |
| `repayLoan` | 118,893 |
| `markDefault` | 97,568 |
| `InsurancePool.deposit` | 67,645 |
| `InsurancePool.setTerms` | 45,478 |
| `InsurancePool.withdraw` | 44,837 |
| `withdrawOffer` | 41,780 |

Deployment: `ReputationRegistry` 535,399 · `InsurancePool` 697,927 · `LoanEscrow` 1,132,444 · `LenderLiquidityPool` 589,806.

## 8. Setup, deployment and ABI export

```bash
npm install
npm run compile
npm test

npm run node          # terminal 1: local chain on :8545 (chain id 31337, auto-mines)
npm run deploy        # terminal 2: deploy and wire all four contracts
```

`scripts/deploy.js` also writes `../blockchain-service/abi/*.json` and `../blockchain-service/deployment.json` (addresses), so the service always matches the latest build. Set `GRACE_PERIOD_SECONDS` to deploy with a default grace period (default 0).

Normally you do not run these by hand: `./scripts/dev.sh reset` at the repository root starts the node and deploys.
