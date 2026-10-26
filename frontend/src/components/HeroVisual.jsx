import { Check } from "lucide-react";

const STEPS = [
  ["AI score attested", "948 · APR 6.04%"],
  ["Offer #12 matched", "LenderLiquidityPool"],
  ["Loan funded", "0.9 ETH → borrower"],
  ["Coverage reserved", "InsurancePool"],
  ["Reputation recorded", "ReputationRegistry"],
];

/** Self-contained illustration of one on-chain loan (no external images). */
export default function HeroVisual() {
  return (
    <div className="relative mx-auto w-full max-w-md rounded-2xl border border-zinc-700 bg-zinc-950/90 p-5 shadow-2xl backdrop-blur" aria-hidden="true">
      <div className="flex items-center justify-between text-xs text-zinc-400">
        <span className="uppercase tracking-wider">On-chain transaction</span>
        <span className="flex items-center gap-1.5 text-emerald-300"><span className="h-2 w-2 rounded-full bg-emerald-400" />Confirmed · block #42</span>
      </div>
      <p className="mt-3 text-lg font-semibold text-white">Borrow 0.9 ETH · no collateral</p>
      <ol className="mt-4 space-y-3">
        {STEPS.map(([t, d]) => (
          <li key={t} className="flex items-center gap-3">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-emerald-500/15 text-emerald-300"><Check className="h-3.5 w-3.5" /></span>
            <span className="flex-1 text-sm text-zinc-200">{t}</span>
            <span className="font-mono text-[11px] text-zinc-500">{d}</span>
          </li>
        ))}
      </ol>
      <div className="mt-5 grid grid-cols-3 gap-2 border-t border-zinc-800 pt-4 text-center text-xs">
        <div><div className="text-zinc-500">Gas</div><div className="font-mono text-zinc-200">425,160</div></div>
        <div><div className="text-zinc-500">Fee</div><div className="font-mono text-zinc-200">0.000425</div></div>
        <div><div className="text-zinc-500">Events</div><div className="font-mono text-zinc-200">4</div></div>
      </div>
    </div>
  );
}
