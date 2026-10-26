# backend: Credloom API

Express 5 server (port 3001) that owns authentication, the credit engine, persistence and orchestration. It calls the [AI risk service](../mlModel/README.md) to score borrowers and the [blockchain service](../blockchain-service/README.md) to execute every on-chain action, then records the confirmed result in its database.

## Contents
1. [Structure](#1-structure)
2. [Credit engine](#2-credit-engine)
3. [API reference](#3-api-reference)
4. [Loan state machine and keeper](#4-loan-state-machine-and-keeper)
5. [Security](#5-security)
6. [Configuration](#6-configuration)
7. [Database](#7-database)
8. [Run, seed and test](#8-run-seed-and-test)

## 1. Structure

```
backend/
├── index.js                  entry point + keeper (background settlement job)
├── src/
│   ├── app.js                middleware and route mounting
│   ├── config.js             environment, validation, secure defaults
│   ├── lib/http.js           HttpError, validators, rate limiter, security headers
│   ├── lib/auth.js           JWT signing, requireAuth, requireRole
│   ├── db/                   driver switch, SQLite adapter, schemas, Supabase migration
│   ├── services/
│   │   ├── external.js       clients for the chain service and the AI service
│   │   ├── credit.js         features, score refresh, limits, APR, quotes
│   │   ├── loans.js          DB projection of chain events, default settlement, reconciliation
│   │   └── ledger.js         persists transactions and loan events
│   └── routes/               auth · me · borrower · lender · insurer · shared
├── scripts/seed.js           builds the demo world through the real API
└── test/e2e.test.js          5 end-to-end tests against the live stack
```

## 2. Credit engine

**Features** sent to the model: wallet transactions (max of the stored count and the on-chain transaction count), wallet age, tier, number of loans, total borrowed, and **loans repaid / defaulted** (from the database and the on-chain `ReputationRegistry`, whichever is higher).

**Score.** `POST /predict` on the AI service returns a 0–1000 score. If the AI service is unreachable the API falls back to a simple documented heuristic and marks the score source as `heuristic`. A wallet that is flagged on-chain is capped at score 299.

**APR.** `aprBps = clamp(2500 − 2000 × score / 1000, 500, 2500)`, i.e. 25% at score 0 down to 5% at 1000. At matching time it is further clamped into the lender's APR band.

**Limits by verification tier** (`limitsFor`):

| Tier | Base max single loan | Max duration |
|---|---|---|
| 1 wallet | 2 ETH | 30 days |
| 2 ENS | 5 ETH | 60 days |
| 3 passport | 10 ETH | 90 days |

Max single loan = base × clamp(score / 700, 0.25, 1.5); total credit line = 2.5 × that; available credit = line − outstanding principal.

**Risk state.** `critical` if flagged on-chain or score < 300, `warning` if score < 550, else `healthy`. A critical wallet cannot borrow.

**Quote.** Simple interest `principal × apr × days / 365`; if insured, the premium is withheld from the principal.

## 3. API reference

Auth: `Bearer <JWT>` in the `Authorization` header. Errors are `{"detail": "message", "code": "CODE"}`.

### Public
| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/register` | `username, password, role` (`borrower`/`lender`/`insurer`). A custodial wallet is assigned automatically. Tier is always 1. Returns a token. |
| POST | `/auth/login` | `username, password`, returns a token and the role |
| GET | `/health` | database driver, chain service, AI service, demo mode |
| GET | `/system` | chain info (proxied) |
| GET | `/analytics/platform` | on-chain stats, users per role, average APR, insured share, default rate by score band, recent events |
| GET | `/analytics/model` | AI model card data (proxied from the AI service) |

### Any signed-in user
| Method | Path | Purpose |
|---|---|---|
| GET | `/auth/me` | current user |
| GET | `/me/tier-status` | tier, score, APR, limits, ENS and passport status |
| POST | `/me/verify/ens` | `ens_name`; validated and recorded; raises tier to 2 |
| POST | `/me/verify/passport` | `passport_number`; requires tier 2; simulated deterministic score, threshold 15 |
| GET | `/me/credit` · `/me/credit/history` · `/me/credit/explain` | profile with features and on-chain record · score history · model explanation for this wallet |
| POST | `/me/credit/refresh` | recompute the score now |
| POST | `/me/credit/simulate` | what-if score and APR for hypothetical inputs |
| GET | `/me/activity` · `/me/balance` | own transactions and events · wallet balance |
| GET | `/loans/:id` | loan detail with live chain state and on-chain timeline (only the loan's parties) |
| POST | `/loans/:id/default` | settle an overdue loan (the contract enforces the deadline) |
| GET | `/insurer/market` | insurers that are accepting policies |

### Borrower role
| Method | Path | Purpose |
|---|---|---|
| GET | `/borrower/offers` | active on-chain offers with a personalised quote, eligibility reasons and insurer options |
| POST | `/borrower/loans/accept` | `offerId, insurerWallet?`; refreshes the score, checks eligibility, executes on-chain, records the loan |
| GET | `/borrower/loans` | own loans with live amount due |
| POST | `/borrower/loans/:id/repay` | `amountEth?` (omit to pay everything due) |

### Lender role
| Method | Path | Purpose |
|---|---|---|
| POST | `/lender/offers` | `amountEth, durationDays, minCreditScore, minAprBps, maxAprBps`; escrows ETH on-chain |
| GET | `/lender/offers` | own offers (from the chain) |
| POST | `/lender/offers/:id/withdraw` | withdraw an unmatched offer |
| GET | `/lender/loans` · `/lender/summary` | loans funded · balance, escrowed, lent, interest earned, realised return, default rate |

### Insurer role
| Method | Path | Purpose |
|---|---|---|
| GET | `/insurer/summary` · `/insurer/policies` | stake, reserved, free, premiums, claims, loss ratio · policies |
| POST | `/insurer/deposit` · `/insurer/withdraw` | `amountEth` |
| POST | `/insurer/terms` | `premiumBps, accepting` |

### Demo controls (only when `DEMO_MODE=true`; any signed-in user)
| Method | Path | Purpose |
|---|---|---|
| GET | `/demo/time` | chain clock |
| POST | `/demo/advance-time` | `days`/`hours`, `settleOverdue` (default true) |
| POST | `/demo/settle-overdue` | settle every overdue loan now |

## 4. Loan state machine and keeper

The database is a **projection of the chain**: a loan row is created, updated or closed only after a confirmed transaction.

```
(offer escrowed) ──accept──► active ──full repayment──► repaid        (score refreshed, reputation +)
                                │
                                └─ deadline + grace passed ─► defaulted (insurance paid if insured;
                                                                         wallet flagged; score refreshed)
```

A **keeper** (`index.js`) runs every `AUTO_DEFAULT_INTERVAL_MS` (default 15 s): it settles every overdue loan on-chain and reconciles database rows that drifted from the chain. Set `AUTO_DEFAULT=false` to disable it (the end-to-end tests do).

Loan IDs stored in the database include a per-deployment epoch (`L<epoch>-<chainLoanId>`), so redeploying the contracts never collides with old rows. The UI shows the plain chain loan ID (`#7`).

## 5. Security

- Passwords hashed with bcrypt (10 rounds); JWT HS256, 7-day expiry; the user is re-read on every request so a suspended account loses access immediately.
- `JWT_SECRET` is required in production; in development a random per-process secret is generated (sessions reset on restart).
- Role checks on every role route; loans are visible only to their borrower, lender and insurer.
- Registration ignores any client-supplied tier. Wallets are assigned from the custodial pool, so a user cannot register someone else's address.
- Login and registration are rate limited (15 requests per minute per IP). Login returns the same error for an unknown user and a wrong password.
- Input validation on every body; request size capped at 100 kB; security headers set; CORS restricted to `CORS_ORIGINS`.
- Write calls to the chain service carry `X-Service-Key`; the browser never has it.
- Internal errors return a generic message; details are logged server-side only.

Known gaps: no email verification, password reset or refresh tokens; rate limiting is in-memory (single process); wallet ownership is not proven by signature (custodial model).

## 6. Configuration

Copy `.env.example` to `.env`.

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | 3001 | |
| `JWT_SECRET` | random (dev) | **set it**; required when `NODE_ENV=production` |
| `JWT_EXPIRES_IN` | 7d | |
| `DB_DRIVER` | `sqlite` | `sqlite` or `supabase` |
| `SQLITE_FILE` | `backend/data/credloom.db` | |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | | required when `DB_DRIVER=supabase` |
| `CHAIN_SERVICE_URL` | `http://127.0.0.1:8000` | |
| `ML_SERVICE_URL` | `http://127.0.0.1:5001` | |
| `SERVICE_API_KEY` | | must match the blockchain service |
| `CORS_ORIGINS` | `http://localhost:3000` | comma separated |
| `AUTO_DEFAULT`, `AUTO_DEFAULT_INTERVAL_MS` | `true`, 15000 | keeper |
| `DEMO_MODE` | `true` | enables the `/demo/*` routes |

## 7. Database

Two interchangeable drivers behind one supabase-js style API (`db.from(table).select()...`): zero-configuration **SQLite** (Node's built-in `node:sqlite`, default) or your **Supabase** project. Tables, columns and the Supabase migration are in [DATABASE.md](DATABASE.md).

## 8. Run, seed and test

```bash
npm install
npm start                 # needs the AI service, blockchain service and a deployed chain
npm run seed              # populate demo data through the real API (add -- --reset to wipe local SQLite first)
npm test                  # 5 end-to-end tests (in-memory SQLite, never touches your data)
```

Normally use `./scripts/dev.sh reset` at the repository root, which does all of this.

The end-to-end tests cover: registration, validation and role guards (including that a client-chosen tier is ignored); the full lending lifecycle (insurer stakes, lender offers, borrower is quoted, accepts, repays in two parts, parties see the loan and a stranger gets 404, lender and insurer summaries); the default path with time travel and insurance payout; tier verification raising score and limits; and the simulator plus platform analytics.

