# frontend: Credloom web app

Next.js 16 (App Router, plain JavaScript) + React 19 + Tailwind CSS 4. Role-based dashboards for borrowers, lenders and insurers, a built-in blockchain explorer, protocol analytics, and a separate `/project` area for documentation and demo tools.

## Contents
1. [Run](#1-run)
2. [Routes](#2-routes)
3. [Architecture](#3-architecture)
4. [The transaction visualizer](#4-the-transaction-visualizer)
5. [Design system](#5-design-system)
6. [Authentication and roles](#6-authentication-and-roles)
7. [Configuration](#7-configuration)
8. [Quality checks](#8-quality-checks)

## 1. Run

```bash
npm install
cp .env.example .env.local
npm run build && npm start     # production build on :3000
npm run dev                    # development server
npm run lint
```

The app needs the Credloom API (`:3001`) and, for the explorer, the blockchain service (`:8000`). Use `./scripts/dev.sh reset` at the repository root to start everything with demo data.

## 2. Routes

### Product
| Route | Page |
|---|---|
| `/` | landing page with live protocol statistics |
| `/signin`, `/signup` | authentication (signed-in users are redirected to their dashboard) |
| `/borrower` | overview: AI score gauge, limits, on-chain reputation, loans, score history |
| `/borrower/marketplace` | on-chain offers with personalised quotes, eligibility reasons and insurance selection |
| `/borrower/loan/[loanId]` | loan detail: terms, countdown, repay (partial or full), on-chain timeline, transactions |
| `/borrower/credit` | AI score explanation: inputs, feature importance, score → APR curve, what-if sweeps, simulator |
| `/borrower/verification` | Tier 2 (ENS) and Tier 3 (passport) verification |
| `/lender`, `/lender/escrow`, `/lender/loan/[loanId]` | portfolio and returns, create offer, funded-loan detail |
| `/insurer`, `/insurer/policies`, `/insurer/loan/[loanId]` | stake and withdraw, publish premium, utilisation, policies and claims |
| `/borrower/activity`, `/lender/activity`, `/insurer/activity` | own transactions (with gas and fees) and event log |
| `/explorer`, `/explorer/tx/[hash]`, `/explorer/block/[number]` | blocks, decoded transactions, contract event feed |
| `/analytics` | protocol analytics, including default rate by score band |
| `/contact` | contact form (EmailJS) |

### Project documentation (separate area, own header)
| Route | Page |
|---|---|
| `/project` | overview, one-click demo logins, team, live service status |
| `/project/architecture` | system layers, life of a loan, contracts, limitations |
| `/project/model` | AI model card: pipeline, metrics, ablation, real-data benchmark, plots |
| `/project/demo` | live demo controls: chain clock, settle overdue loans, presentation script |

`/architecture`, `/model`, `/demo`, `/dashboard` and `/signup-{role}` are redirects kept for old links.

## 3. Architecture

```
src/
├── app/                  routes (see above) and two server-side proxies:
│   ├── api/proxy/[...path]   → Credloom API (all methods; forwards the Authorization header)
│   └── api/chain/[...path]   → blockchain service, GET only, allow-listed paths (explorer data)
├── components/
│   ├── kit.jsx           design system
│   ├── TxFlow.jsx        transaction visualizer (provider + modal)
│   ├── AppShell.jsx      role guard + sidebar for dashboards
│   ├── Chrome.jsx        product navbar/footer, hidden inside /project
│   ├── ProjectNav.jsx    header of the /project area
│   ├── LoanDetail.jsx    shared loan page for all three roles
│   └── Navbar, Footer, Hero, Feature, Faqs, LiveStats, ActivityFeed, auth/AuthForms
├── contexts/AuthContext.jsx   session, login, register, logout
└── lib/
    ├── api.js            fetch client, error type, readable messages for contract reverts
    ├── events.js         plain-English narration of every contract event
    ├── format.js         ETH, APR, date and countdown helpers
    └── hooks.js          useAsync (loading / error / polling)
```

- The **browser never talks to the API or the chain directly**: both go through same-origin Next routes, so there is no CORS and no exposed host. Write operations only exist on the Credloom API, which holds the service key for the blockchain service.
- Data loads through `useAsync`, with polling on live pages (loans, offers, explorer, chain status).
- Countdowns use the **chain's** clock (remaining seconds from the contract), not the computer's, so they stay correct after demo time travel.

## 4. The transaction visualizer

Wrap any blockchain-writing call in `runTx` (from `useTx()`):

```js
await runTx({ title: "Borrow 0.9 ETH", ai: true, action: () => api.post("/borrower/loans/accept", {...}) });
```

While the request runs, a modal walks through the real pipeline: request authorised → AI credit assessment (optional) → transaction signed → broadcast → mined → indexed. On success it shows the confirmed block, transaction hash, status, from / to contract, gas used and limit, fee and gas price, then **every decoded smart-contract event with a plain-English explanation** and its raw arguments, plus a link to the explorer page. On failure it shows the decoded revert reason (for example `CreditScoreTooLow`) with an explanation and states that nothing changed on-chain.

Note: the pipeline stages advance on a timer while one HTTP call is in flight; the receipt, events and revert reasons shown at the end are real.

## 5. Design system

`components/kit.jsx` provides Card, Stat, Badge, Btn, Field, Table, ProgressBar, BarList, `ScoreGauge` (SVG), `LineChart` (SVG, with a marker line), Address (copyable), TxLink, Spinner, ErrorBox, Empty and PageHeader. Charts are hand-written SVG; there is no charting dependency. Icons are `lucide-react`. The app is dark-themed with a restrained palette; status colours follow meaning (green repaid, blue active, red defaulted, amber insurance).

## 6. Authentication and roles

- The JWT is stored in `localStorage` and attached by `lib/api.js`. The **role and wallet are read from the server** (`/auth/me`), never from the browser.
- `AppShell` guards `/borrower`, `/lender` and `/insurer`: signed-out users go to `/signin?next=…`, and a user on another role's route is sent to their own dashboard.
- Any `401` clears the session. Signed-in users visiting `/signin` or `/signup` are redirected; the home page shows "Open dashboard" instead of "Get Started".
- Storing a JWT in `localStorage` is exposed to XSS; an httpOnly cookie would be stronger and is a known improvement.

## 7. Configuration

`.env.local` (server-side only; copy from `.env.example`):

| Variable | Default | Meaning |
|---|---|---|
| `BACKEND_API_URL` | `http://127.0.0.1:3001` | Credloom API |
| `BLOCKCHAIN_API_URL` | `http://127.0.0.1:8000` | blockchain service (read-only explorer proxy) |

## 8. Quality checks

- `npm run lint`: 0 errors (1 warning in an unused legacy component, `wavy-background.jsx`).
- `npm run build`: succeeds for every route.
- Interaction testing was done with a scripted headless Chrome (not committed): all pages for all three roles load without console errors or failed API calls; the borrow, repay (partial and full), offer create / withdraw, insurer deposit / withdraw / terms, verification, sign-up and demo-clock flows were driven through the real UI; every page was checked for horizontal overflow at a 390 px phone width.
- Not done: committed automated UI tests, an accessibility audit with assistive technology, Safari and Firefox testing. Labels, focus rings, `aria` attributes and keyboard-reachable controls are in place but have not been formally audited.
- Legacy components kept but only used on `/contact`: `ui/webcam-pixel-grid.jsx`; `wavy-background.jsx` and `ui/dropdown-menu.jsx` are currently unused.
