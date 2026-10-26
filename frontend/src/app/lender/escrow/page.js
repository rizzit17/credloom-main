"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Lock, ShieldCheck, Percent, Clock } from "lucide-react";
import { Card, Btn, PageHeader, Field, inputCls } from "@/components/kit";
import { api } from "@/lib/api";
import { eth, pct } from "@/lib/format";
import { useTx } from "@/components/TxFlow";

export default function NewOffer() {
  const router = useRouter();
  const { runTx } = useTx();
  const [f, setF] = useState({ amountEth: "1", durationDays: "30", minCreditScore: "600", minAprBps: "500", maxAprBps: "2500" });
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });

  const n = (k) => Number(f[k]);
  const errors = {
    amountEth: !(n("amountEth") > 0) ? "Enter an amount above 0" : n("amountEth") > 1000 ? "Max 1000 ETH" : null,
    durationDays: !Number.isInteger(n("durationDays")) || n("durationDays") < 1 || n("durationDays") > 365 ? "1–365 whole days" : null,
    minCreditScore: !(n("minCreditScore") >= 0 && n("minCreditScore") <= 1000) ? "0–1000" : null,
    maxAprBps: n("minAprBps") > n("maxAprBps") ? "Max APR must be ≥ min APR" : n("maxAprBps") > 3000 ? "Contract cap is 30%" : null,
  };
  const valid = !Object.values(errors).some(Boolean);
  const lowInterest = (n("amountEth") * n("minAprBps") * n("durationDays")) / (365 * 10000);
  const highInterest = (n("amountEth") * n("maxAprBps") * n("durationDays")) / (365 * 10000);

  const submit = async (e) => {
    e.preventDefault();
    if (!valid) return;
    try {
      await runTx({
        title: `Escrow ${f.amountEth} ETH in a new offer`,
        action: () => api.post("/lender/offers", { amountEth: n("amountEth"), durationDays: n("durationDays"), minCreditScore: n("minCreditScore"), minAprBps: n("minAprBps"), maxAprBps: n("maxAprBps") }),
      });
      router.push("/lender");
    } catch { /* shown in modal */ }
  };

  return (
    <>
      <PageHeader title="Create a lending offer" subtitle="Lock ETH in the LenderLiquidityPool contract and set your own risk rules. The contract enforces them: no borrower can bypass your minimum score or APR band." />
      <div className="grid gap-6 lg:grid-cols-3">
        <form onSubmit={submit} className="space-y-5 lg:col-span-2">
          <Card title="Offer terms">
            <div className="grid gap-5 sm:grid-cols-2">
              <Field label="Amount to lend (ETH)" error={errors.amountEth} hint="Entire amount is escrowed and lent to a single borrower"><input className={inputCls} inputMode="decimal" value={f.amountEth} onChange={set("amountEth")} /></Field>
              <Field label="Loan term (days)" error={errors.durationDays}><input className={inputCls} inputMode="numeric" value={f.durationDays} onChange={set("durationDays")} /></Field>
              <Field label="Minimum borrower credit score" error={errors.minCreditScore} hint="AI score out of 1000, attested on-chain at match time"><input className={inputCls} inputMode="numeric" value={f.minCreditScore} onChange={set("minCreditScore")} /></Field>
              <div />
              <Field label={`Minimum APR · ${pct(n("minAprBps") || 0)}`}><input type="range" min="0" max="3000" step="50" value={f.minAprBps} onChange={set("minAprBps")} className="w-full accent-white" /></Field>
              <Field label={`Maximum APR · ${pct(n("maxAprBps") || 0)}`} error={errors.maxAprBps}><input type="range" min="0" max="3000" step="50" value={f.maxAprBps} onChange={set("maxAprBps")} className="w-full accent-white" /></Field>
            </div>
            <p className="mt-4 text-xs text-zinc-500">Borrowers are priced by their AI score (riskier = higher APR) and clamped into your band.</p>
          </Card>
          <Btn type="submit" disabled={!valid}><Lock className="h-4 w-4" /> Escrow funds & publish offer</Btn>
        </form>

        <div className="space-y-6">
          <Card title="Projected outcome">
            <dl className="space-y-2 text-sm">
              <div className="flex justify-between"><dt className="text-zinc-400">Locked in escrow</dt><dd className="tabular-nums">{eth(n("amountEth") || 0, 4)}</dd></div>
              <div className="flex justify-between"><dt className="text-zinc-400">Interest if repaid</dt><dd className="tabular-nums text-emerald-300">{eth(lowInterest || 0, 5)} – {eth(highInterest || 0, 5)}</dd></div>
              <div className="flex justify-between"><dt className="text-zinc-400">You can withdraw</dt><dd>any time until matched</dd></div>
            </dl>
          </Card>
          <Card title="What will happen">
            <ul className="space-y-3 text-sm text-zinc-300">
              <li className="flex gap-3"><Lock className="mt-0.5 h-4 w-4 shrink-0 text-blue-300" />Your ETH is held by the smart contract, not by Credloom.</li>
              <li className="flex gap-3"><ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" />Borrowers below your score are rejected by the contract itself.</li>
              <li className="flex gap-3"><Percent className="mt-0.5 h-4 w-4 shrink-0 text-purple-300" />Interest is computed on-chain and fixed at origination.</li>
              <li className="flex gap-3"><Clock className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />After the deadline anyone can settle a default; insured loans pay you from the insurer’s stake.</li>
            </ul>
          </Card>
        </div>
      </div>
    </>
  );
}
