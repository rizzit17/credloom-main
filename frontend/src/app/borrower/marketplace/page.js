"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, Clock, Lock, CheckCircle2, XCircle, Umbrella } from "lucide-react";
import { Card, Btn, Badge, PageHeader, Spinner, ErrorBox, Empty, Address, cx, inputCls } from "@/components/kit";
import { useAsync } from "@/lib/hooks";
import { api } from "@/lib/api";
import { eth, pct } from "@/lib/format";
import { useTx } from "@/components/TxFlow";

const SORTS = {
  apr: ["Lowest APR", (a, b) => a.yourAprBps - b.yourAprBps],
  amount: ["Largest amount", (a, b) => b.amountEth - a.amountEth],
  short: ["Shortest term", (a, b) => a.durationDays - b.durationDays],
};

export default function Marketplace() {
  const router = useRouter();
  const { runTx } = useTx();
  const { data, loading, error, reload } = useAsync(() => api.get("/borrower/offers"), [], { poll: 10000 });
  const [eligibleOnly, setEligibleOnly] = useState(false);
  const [maxAmount, setMaxAmount] = useState("");
  const [maxDays, setMaxDays] = useState("");
  const [sort, setSort] = useState("apr");
  const [open, setOpen] = useState(null); // offer being reviewed
  const [insurer, setInsurer] = useState(null);

  const offers = useMemo(() => {
    let o = data?.offers || [];
    if (eligibleOnly) o = o.filter((x) => x.eligible);
    if (maxAmount) o = o.filter((x) => x.amountEth <= Number(maxAmount));
    if (maxDays) o = o.filter((x) => x.durationDays <= Number(maxDays));
    return [...o].sort(SORTS[sort][1]);
  }, [data, eligibleOnly, maxAmount, maxDays, sort]);

  const accept = async () => {
    const o = open;
    const ins = insurer;
    setOpen(null);
    try {
      const r = await runTx({
        title: `Borrow ${eth(o.amountEth, 3)} from offer #${o.offerId}`,
        ai: true,
        action: () => api.post("/borrower/loans/accept", { offerId: o.offerId, insurerWallet: ins?.address }),
      });
      setTimeout(() => router.push(`/borrower/loan/${r.chainLoan.loanId}`), 600);
    } catch { reload(); }
  };

  if (loading) return <Spinner label="Fetching on-chain offers" />;
  const b = data?.borrower;

  return (
    <>
      <PageHeader title="Loan marketplace" subtitle="Every offer is ETH already escrowed in a smart contract. Your APR is priced from your AI credit score." />
      <ErrorBox error={error} onRetry={reload} />

      {b && (
        <div className="mb-6 flex flex-wrap items-center gap-x-8 gap-y-2 rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4 text-sm">
          <span>Score <b className="text-white">{b.credit_score}</b></span>
          <span>Your APR <b className="text-white">{pct(b.apr_bps)}</b></span>
          <span>Available credit <b className="text-white">{eth(b.available_credit, 3)}</b></span>
          <span>Max loan <b className="text-white">{eth(b.max_loan_amount, 3)}</b></span>
          <span>Tier <b className="text-white">{b.tier}</b></span>
          {b.flagged && <Badge className="border-red-500/40 text-red-300">Flagged on-chain</Badge>}
        </div>
      )}

      <div className="mb-5 flex flex-wrap items-end gap-3">
        <label className="text-xs text-zinc-400">Max amount (ETH)<input className={cx(inputCls, "mt-1 w-32")} inputMode="decimal" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} placeholder="any" /></label>
        <label className="text-xs text-zinc-400">Max term (days)<input className={cx(inputCls, "mt-1 w-28")} inputMode="numeric" value={maxDays} onChange={(e) => setMaxDays(e.target.value)} placeholder="any" /></label>
        <label className="text-xs text-zinc-400">Sort<select className={cx(inputCls, "mt-1 w-44")} value={sort} onChange={(e) => setSort(e.target.value)}>{Object.entries(SORTS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="flex items-center gap-2 pb-2.5 text-sm text-zinc-300"><input type="checkbox" checked={eligibleOnly} onChange={(e) => setEligibleOnly(e.target.checked)} /> Only offers I qualify for</label>
      </div>

      {offers.length === 0 ? (
        <Card><Empty title="No offers match" hint="Lenders create offers from their dashboard. Loosen the filters or check back soon." /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {offers.map((o) => (
            <div key={o.offerId} className={cx("flex flex-col rounded-2xl border bg-zinc-950/80 p-5", o.eligible ? "border-zinc-800" : "border-zinc-800/60 opacity-80")}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-2xl font-semibold tabular-nums">{eth(o.amountEth, 3)}</div>
                  <div className="mt-1 flex items-center gap-2 text-xs text-zinc-400">Offer #{o.offerId} · <Address value={o.lender} /></div>
                </div>
                <Badge className={o.eligible ? "border-emerald-500/40 text-emerald-300" : "border-zinc-700 text-zinc-400"}>{o.eligible ? "You qualify" : "Not eligible"}</Badge>
              </div>
              <dl className="mt-4 grid grid-cols-3 gap-3 text-sm">
                <div><dt className="flex items-center gap-1 text-xs text-zinc-500"><Clock className="h-3 w-3" />Term</dt><dd className="font-medium">{o.durationDays} days</dd></div>
                <div><dt className="flex items-center gap-1 text-xs text-zinc-500"><ShieldCheck className="h-3 w-3" />Min score</dt><dd className="font-medium">{o.minCreditScore}</dd></div>
                <div><dt className="text-xs text-zinc-500">Your APR</dt><dd className="font-semibold text-blue-300">{pct(o.yourAprBps)}</dd></div>
              </dl>
              <div className="mt-3 rounded-xl bg-zinc-900 p-3 text-sm">
                <div className="flex justify-between"><span className="text-zinc-400">Interest</span><span className="tabular-nums">{eth(o.quote.interest, 5)}</span></div>
                <div className="flex justify-between"><span className="text-zinc-400">Total to repay</span><span className="font-semibold tabular-nums">{eth(o.quote.totalRepayment, 5)}</span></div>
                <div className="mt-1 text-[11px] text-zinc-500">Lender APR band {pct(o.aprBand.minBps)}–{pct(o.aprBand.maxBps)}, enforced by the contract</div>
              </div>
              {!o.eligible && (
                <ul className="mt-3 space-y-1 text-xs text-red-300">{o.reasons.map((r) => <li key={r} className="flex gap-1.5"><XCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />{r}</li>)}</ul>
              )}
              <div className="mt-auto pt-4">
                <Btn className="w-full" disabled={!o.eligible} onClick={() => { setOpen(o); setInsurer(null); }}>
                  {o.eligible ? "Review & borrow" : <><Lock className="h-4 w-4" /> Locked</>}
                </Btn>
              </div>
            </div>
          ))}
        </div>
      )}

      {open && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label="Review loan">
          <div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-950 p-6">
            <h2 className="text-xl font-semibold">Review your loan</h2>
            <p className="mt-1 text-sm text-zinc-400">No collateral is locked. Your on-chain reputation is the guarantee.</p>

            <div className="mt-5 space-y-2 rounded-xl bg-zinc-900 p-4 text-sm">
              {(() => {
                const q = insurer ? insurer.quote : open.quote;
                return [
                  ["Principal", eth(open.amountEth, 4)], ["Term", `${open.durationDays} days`], ["APR (from your AI score)", pct(open.yourAprBps)],
                  ["Interest", eth(q.interest, 6)], insurer && ["Insurance premium (deducted upfront)", eth(q.premium, 6)],
                  ["You receive now", eth(insurer ? q.netToBorrower : open.amountEth, 6)], ["You repay by the deadline", eth(q.totalRepayment, 6)],
                ].filter(Boolean).map(([k, v], i, arr) => (
                  <div key={k} className={cx("flex justify-between", i === arr.length - 1 && "border-t border-zinc-800 pt-2 font-semibold")}><span className="text-zinc-400">{k}</span><span className="tabular-nums">{v}</span></div>
                ));
              })()}
            </div>

            <div className="mt-5">
              <p className="mb-2 flex items-center gap-2 text-sm font-medium"><Umbrella className="h-4 w-4 text-amber-300" /> Insurance <span className="font-normal text-zinc-500">(optional · protects the lender, lowers lender risk)</span></p>
              <div className="space-y-2">
                <label className={cx("flex cursor-pointer items-center gap-3 rounded-xl border p-3 text-sm", !insurer ? "border-white" : "border-zinc-800")}>
                  <input type="radio" name="ins" checked={!insurer} onChange={() => setInsurer(null)} /> No insurance
                </label>
                {open.insurers.map((i) => (
                  <label key={i.address} className={cx("flex cursor-pointer items-center justify-between gap-3 rounded-xl border p-3 text-sm", insurer?.address === i.address ? "border-white" : "border-zinc-800")}>
                    <span className="flex items-center gap-3"><input type="radio" name="ins" checked={insurer?.address === i.address} onChange={() => setInsurer(i)} /><Address value={i.address} /></span>
                    <span className="text-zinc-400">{pct(i.premiumBps)} premium</span>
                  </label>
                ))}
                {open.insurers.length === 0 && <p className="text-xs text-zinc-500">No insurer currently has enough free capital for this amount.</p>}
              </div>
            </div>

            <div className="mt-6 flex justify-end gap-3">
              <Btn variant="secondary" onClick={() => setOpen(null)}>Cancel</Btn>
              <Btn onClick={accept}><CheckCircle2 className="h-4 w-4" /> Confirm & sign transaction</Btn>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
