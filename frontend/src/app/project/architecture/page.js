import { Card, PageHeader } from "@/components/kit";
import { ArrowDown } from "lucide-react";

export const metadata = { title: "How it works · Credloom" };

const LAYERS = [
  ["Next.js 16 + React 19", "Role dashboards, transaction visualizer, explorer", "border-zinc-600"],
  ["Credloom API (Node/Express)", "Auth (JWT + bcrypt), credit engine, APR pricing, orchestration, SQLite or Supabase", "border-blue-500/50"],
  ["AI risk service (FastAPI + scikit-learn)", "Gradient Boosting Regressor → score 0–1000, explanations", "border-amber-500/50"],
  ["Blockchain service (FastAPI + web3.py)", "Signs transactions, decodes receipts & events, serves the explorer", "border-purple-500/50"],
  ["Smart contracts on an EVM chain (Hardhat)", "ReputationRegistry · InsurancePool · LoanEscrow · LenderLiquidityPool", "border-emerald-500/50"],
];

const CONTRACTS = [
  ["LenderLiquidityPool", "Holds each lender’s ETH in an offer. The protocol attests the borrower’s score and APR; the contract itself rejects scores below the lender’s minimum and APRs outside the lender’s band."],
  ["LoanEscrow", "Releases the principal, stores terms, computes simple interest on-chain, forwards every repayment to the lender immediately, and settles defaults once the deadline (plus grace) passes."],
  ["InsurancePool", "Insurers stake ETH and publish a premium. Each insured loan reserves coverage equal to its principal, so one deposit can never back more than it holds. Default pays the lender from the reserved stake."],
  ["ReputationRegistry", "Permanent credit record per wallet: loans taken, repaid, defaulted, volumes and a transparent reputation score. A default flags the wallet and the escrow refuses to lend to it again."],
];

const STEPS = [
  ["1", "Score", "The AI model reads wallet age, activity, loan history and verification tier and returns a 0–1000 score. APR is priced from the score (25% → 5%)."],
  ["2", "Offer", "A lender escrows ETH with rules: term, minimum score, APR band."],
  ["3", "Match", "A qualified borrower picks the offer. The protocol attests score and APR; the contract verifies the lender’s rules and creates the loan."],
  ["4", "Fund", "Principal is released to the borrower in the same transaction. If insured, the premium is withheld and coverage is reserved."],
  ["5", "Repay", "Partial or full repayments are forwarded to the lender instantly. Completing the loan improves on-chain reputation."],
  ["6", "Default", "Past the deadline anyone can settle: insurance pays the lender, the borrower is permanently flagged."],
];

export default function Architecture() {
  return (
    <div className="mx-auto max-w-5xl px-4 pb-20 pt-24 sm:px-6">
      <PageHeader title="How Credloom works" subtitle="Reputation replaces collateral. Smart contracts replace the intermediary." />

      <Card title="System layers" subtitle="Each layer can be developed, tested and scaled on its own">
        <div className="flex flex-col items-stretch gap-2">
          {LAYERS.map(([t, d, c], i) => (
            <div key={t}>
              <div className={`rounded-xl border bg-zinc-900/60 p-4 ${c}`}><p className="font-semibold">{t}</p><p className="text-sm text-zinc-400">{d}</p></div>
              {i < LAYERS.length - 1 && <ArrowDown className="mx-auto my-1 h-4 w-4 text-zinc-600" aria-hidden />}
            </div>
          ))}
        </div>
      </Card>

      <Card className="mt-6" title="Life of a loan">
        <ol className="grid gap-4 sm:grid-cols-2">
          {STEPS.map(([n, t, d]) => (
            <li key={n} className="flex gap-4 rounded-xl bg-zinc-900/60 p-4"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white text-sm font-bold text-black">{n}</span><div><p className="font-semibold">{t}</p><p className="text-sm text-zinc-400">{d}</p></div></li>
          ))}
        </ol>
      </Card>

      <Card className="mt-6" title="Smart contracts">
        <dl className="space-y-4">
          {CONTRACTS.map(([t, d]) => (<div key={t}><dt className="font-mono text-sm text-blue-300">{t}</dt><dd className="mt-1 text-sm text-zinc-300">{d}</dd></div>))}
        </dl>
      </Card>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <Card title="What makes it safe">
          <ul className="list-disc space-y-2 pl-5 text-sm text-zinc-300">
            <li>Checks-effects-interactions plus a reentrancy guard on every value-moving function</li>
            <li>One-shot, owner-only wiring; no function can be front-run to take control</li>
            <li>Lender rules enforced on-chain, not trusted to the backend</li>
            <li>Insurance coverage reserved per loan (no over-commitment)</li>
            <li>Defaults cannot be blocked by a failing insurance payout</li>
            <li>27 contract tests, including regressions for earlier bugs</li>
          </ul>
        </Card>
        <Card title="Honest limitations">
          <ul className="list-disc space-y-2 pl-5 text-sm text-zinc-300">
            <li>Demo mode uses custodial wallets derived from public Hardhat keys. A production build would have users sign in their own wallet.</li>
            <li>ENS and Passport checks are simulated; the model is trained on synthetic data.</li>
            <li>The credit oracle is a trusted signer; the contract limits what it can do but not that it is honest.</li>
            <li>ETH is the only asset; no price feeds or fiat on-ramp yet.</li>
          </ul>
        </Card>
      </div>
    </div>
  );
}
