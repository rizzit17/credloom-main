"use client";
import { useState } from "react";
import { Landmark, Lock, Coins, ShieldAlert, Percent, FileCheck2 } from "lucide-react";
import { Card, Stat, Btn, PageHeader, Spinner, ErrorBox, Field, inputCls, ProgressBar } from "@/components/kit";
import { useAsync } from "@/lib/hooks";
import { api } from "@/lib/api";
import { eth, pct } from "@/lib/format";
import { useTx } from "@/components/TxFlow";

export default function InsurerOverview() {
  const { runTx } = useTx();
  const { data: s, loading, error, reload } = useAsync(() => api.get("/insurer/summary"), [], { poll: 8000 });
  const [amount, setAmount] = useState("5");
  const [draft, setDraft] = useState({}); // edits layered over the on-chain values
  const bps = draft.bps ?? s?.premiumBps ?? 150;
  const accepting = draft.accepting ?? s?.accepting ?? true;
  const setBps = (v) => setDraft((d) => ({ ...d, bps: v }));
  const setAccepting = (v) => setDraft((d) => ({ ...d, accepting: v }));

  const go = async (title, path, body) => { await runTx({ title, action: () => api.post(path, body) }).catch(() => {}); reload(); };

  if (loading) return <Spinner label="Reading your underwriting book" />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const util = s.coverageUtilisation * 100;
  const amt = Number(amount);

  return (
    <>
      <PageHeader title="Insurer overview" subtitle="Stake capital, set your premium, and earn when loans are repaid. If a borrower defaults, your reserved stake pays the lender automatically." />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="Total staked" value={eth(s.balanceEth, 3)} hint={`wallet ${eth(s.walletBalanceEth, 2)}`} icon={Landmark} />
        <Stat label="Reserved for policies" value={eth(s.reservedEth, 3)} hint={`${s.activePolicies} active ${s.activePolicies === 1 ? "policy" : "policies"}`} icon={Lock} tone="warn" />
        <Stat label="Free to withdraw" value={eth(s.freeEth, 3)} icon={Coins} tone="info" />
        <Stat label="Premiums earned" value={eth(s.premiumsEarnedEth, 5)} hint={`${s.totalPolicies} policies written`} icon={Percent} tone="good" />
        <Stat label="Claims paid" value={eth(s.totalPaidOutEth, 4)} hint={`${s.claims} defaulted ${s.claims === 1 ? "loan" : "loans"}`} icon={ShieldAlert} tone={s.claims ? "bad" : "default"} />
        <Stat label="Net underwriting result" value={`${s.netUnderwritingEth >= 0 ? "+" : ""}${eth(s.netUnderwritingEth, 5)}`} hint={`loss ratio ${(s.lossRatio * 100).toFixed(0)}%`} icon={FileCheck2} tone={s.netUnderwritingEth >= 0 ? "good" : "bad"} />
      </div>

      <Card className="mt-6" title="Capital utilisation" subtitle="Share of your stake locked behind active policies. You cannot withdraw reserved funds.">
        <ProgressBar value={util} tone={util > 80 ? "bg-red-400" : util > 50 ? "bg-amber-400" : "bg-emerald-400"} label="Capital utilisation" />
        <p className="mt-2 text-sm text-zinc-400">{util.toFixed(0)}% reserved · {eth(s.freeEth, 3)} available to write new policies</p>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Stake or withdraw" subtitle="Funds are held by the InsurancePool contract.">
          <Field label="Amount (ETH)"><input className={inputCls} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} /></Field>
          <div className="mt-4 flex gap-3">
            <Btn disabled={!(amt > 0)} onClick={() => go(`Stake ${amt} ETH in the insurance pool`, "/insurer/deposit", { amountEth: amt })}>Deposit</Btn>
            <Btn variant="secondary" disabled={!(amt > 0) || amt > Number(s.freeEth)} onClick={() => go(`Withdraw ${amt} ETH`, "/insurer/withdraw", { amountEth: amt })}>Withdraw</Btn>
          </div>
          {amt > Number(s.freeEth) && <p className="mt-2 text-xs text-amber-300">Only {eth(s.freeEth, 3)} is unreserved.</p>}
        </Card>

        <Card title="Underwriting terms" subtitle="What borrowers see when choosing insurance.">
          <Field label={`Premium · ${pct(bps)} of principal`}><input type="range" min="0" max="1000" step="25" value={bps} onChange={(e) => setBps(Number(e.target.value))} className="w-full accent-white" /></Field>
          <label className="mt-4 flex items-center gap-3 text-sm"><input type="checkbox" checked={accepting} onChange={(e) => setAccepting(e.target.checked)} /> Accepting new policies</label>
          <p className="mt-3 text-xs text-zinc-500">Example: on a 1 ETH loan you earn {eth(bps / 10000, 5)} upfront and lock 1 ETH of cover until repayment.</p>
          <Btn className="mt-4" onClick={() => go("Publish underwriting terms", "/insurer/terms", { premiumBps: bps, accepting })}>Save terms on-chain</Btn>
        </Card>
      </div>
    </>
  );
}
