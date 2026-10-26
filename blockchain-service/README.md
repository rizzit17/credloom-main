# blockchain-service: REST bridge to the contracts

FastAPI service (port 8000) that signs and sends transactions to the four Credloom contracts, decodes receipts and events, and serves chain data for the in-app explorer. It talks only to the chain: it has no database. The Node API owns persistence.

Interactive docs while running: http://127.0.0.1:8000/docs

## Contents
1. [How it works](#1-how-it-works)
2. [Security model](#2-security-model)
3. [Endpoints](#3-endpoints)
4. [Response shape for writes](#4-response-shape-for-writes)
5. [Configuration](#5-configuration)
6. [Run and test](#6-run-and-test)

## 1. How it works

```
app/
├── main.py              FastAPI app, CORS
├── config.py            env + deployment.json
├── api/routes.py        all HTTP endpoints, request validation, error mapping
└── blockchain/
    ├── chain.py         web3 provider, contracts, signing, receipts, event + revert decoding
    └── explorer.py      blocks, transactions, event feed, loan timeline, protocol stats
```

- **Contracts** are loaded from `abi/*.json` and the addresses in `deployment.json`. Both are written by `npm run deploy` in `../blockchain`; environment variables only override them.
- **Signing.** Writes are signed server-side by custodial accounts derived from the public Hardhat mnemonic (account 0 is the protocol oracle). Each send builds the transaction, estimates gas, signs, broadcasts, waits for the receipt and decodes it. Nonces are serialised with a lock.
- **Reverts become readable.** Custom errors are decoded from the ABI (for example `CreditScoreTooLow`, `BorrowerFlagged`, `DeadlineNotPassed`) and returned as `{message, code}`.
- **Events.** Every write returns the decoded events from its receipt; the explorer endpoints decode logs from all four contracts.
- **Amounts** are parsed with `Decimal` (no float rounding) and returned as strings in ETH.

## 2. Security model

- **Read endpoints are public** (the chain is public anyway).
- **Write endpoints require the `X-Service-Key` header** matching `SERVICE_API_KEY` (constant-time compare). Only the Node API holds it; the browser's proxy to this service is read-only.
- **Demo custody.** Signing keys come from the public Hardhat mnemonic. `DEMO_MODE=true` is required for custodial signing and for `/accounts` and `/demo/advance-time`. **Never enable `DEMO_MODE` on a real network.**
- Inputs are validated with Pydantic (amount bounds, APR range 0–3000 bps, score 0–1000, valid checksummed addresses).
- A failing node returns HTTP 503 `NODE_DOWN`; a revert returns HTTP 400 with the decoded reason.

## 3. Endpoints

### System and explorer (public)
| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | node connectivity, loaded contracts, demo mode |
| GET | `/system/info` | network, chain id, block number, gas price, protocol signer, grace period, contract addresses |
| GET | `/system/contracts` | contract name → address |
| GET | `/stats` | totals: loans, offers, volumes, loans by state, insurance staked / reserved, default rate |
| GET | `/explorer/blocks?limit=` | latest blocks with their transactions and decoded method names |
| GET | `/explorer/blocks/{number}` | one block |
| GET | `/explorer/tx/{hash}` | receipt, decoded function call and arguments, decoded events |
| GET | `/explorer/events?fromBlock=&limit=&contract=&event=` | decoded event feed, newest first |
| GET | `/wallet/{address}/activity` | transaction count and balance (credit-scoring feature) |
| GET | `/balance/{address}` | ETH balance |
| GET | `/accounts` | custodial demo wallets and balances (demo mode only) |

### Offers, loans, reputation, insurers (public reads)
| Method | Path | Purpose |
|---|---|---|
| GET | `/offers?activeOnly=&lender=` · `/offers/{id}` | offers |
| GET | `/loans?borrower=&lender=&insurer=&state=` · `/loans/{id}` | loans with live amount due, countdown and overdue flag |
| GET | `/loans/{id}/timeline` | all events for a loan (and its offer), oldest first |
| GET | `/borrower/{address}/reputation` · `/flagged` | on-chain record, reputation points, flag |
| GET | `/insurer/{address}` · `/insurers` | stake, reserved, free, premiums earned, payouts, policies, terms |

### Writes (need `X-Service-Key`)
| Method | Path | Body |
|---|---|---|
| POST | `/lender/create-offer` | `lenderAddress, amountEth, durationDays, minCreditScore, minAprBps, maxAprBps` |
| POST | `/lender/withdraw-offer` | `lenderAddress, offerId` |
| POST | `/loan/accept` | `offerId, borrower, aprBps, creditScore, isInsured, insurer`. Signed by the protocol oracle. |
| POST | `/loan/repay` | `loanId, payer, amountEth` (omit the amount to pay everything due) |
| POST | `/loan/default` | `loanId` (the contract enforces the deadline) |
| POST | `/insurer/deposit` · `/insurer/withdraw` | `insurerAddress, amountEth` |
| POST | `/insurer/terms` | `insurerAddress, premiumBps, accepting` |
| POST | `/demo/advance-time` | `seconds` (mines a block after moving the chain clock; demo mode only) |

## 4. Response shape for writes

Every write returns `success`, the affected object, and a `tx` receipt summary that the frontend's transaction visualizer renders directly:

```json
{
  "success": true,
  "loanId": 7,
  "tx": {
    "txHash": "0x…", "status": "success", "blockNumber": 42, "blockHash": "0x…", "timestamp": 1790000000,
    "from": "0x…", "to": "0x…", "toContract": "LenderLiquidityPool",
    "gasUsed": 425160, "gasLimit": 555982, "gasPriceGwei": "1.0", "feeEth": "0.00042516", "nonce": 3,
    "events": [{ "contract": "LoanEscrow", "event": "LoanFunded", "args": { "…": "…" }, "logIndex": 4 }]
  }
}
```

Errors: `{"detail": {"message": "CreditScoreTooLow", "code": "REVERTED"}}`.

## 5. Configuration

Copy `.env.example` to `.env`.

| Variable | Default | Meaning |
|---|---|---|
| `RPC_URL` | `http://127.0.0.1:8545` | EVM node |
| `CHAIN_ID` | from `deployment.json` / 31337 | |
| `SERVICE_API_KEY` | none | shared secret for write endpoints. **Set it**; if empty, writes are unauthenticated |
| `DEMO_MODE` | `true` | custodial signing, demo accounts, time travel |
| `DEMO_MNEMONIC`, `DEMO_ACCOUNT_COUNT` | Hardhat default, 20 | |
| `BACKEND_PRIVATE_KEY` | demo account 0 | protocol oracle key |
| `*_ADDRESS` | from `deployment.json` | optional contract address overrides |
| `CORS_ORIGINS` | `http://localhost:3000,http://localhost:3001` | |

## 6. Run and test

```bash
python3 -m venv venv && ./venv/bin/pip install -r requirements.txt
./venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000

# end-to-end tests against a running node with deployed contracts (advances the chain clock)
./venv/bin/python -m pytest tests -q
```

`tests/test_lifecycle.py` (6 tests) covers: health and info, the service-key guard, input validation, a full insured loan (offer → on-chain rule rejection → match → partial and full repayment → reputation → timeline → explorer), a default with insurance payout using time travel, flagged-borrower rejection, and the explorer and stats endpoints. It uses the highest demo accounts (16–19) so it does not collide with seeded users.
