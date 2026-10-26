"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, AlertTriangle, Gavel, Banknote } from "lucide-react";
import { Card, Stat, Btn, Badge, Spinner, ErrorBox, Address, TxLink, ProgressBar, Table, Field, inputCls, cx } from "./kit";
import { useAsync } from "@/lib/hooks";
import { api } from "@/lib/api";
import { eth, pct, when, toDate, duration, stateStyle } from "@/lib/format";
import { EVENT_INFO, describeEvent, toneClass } from "@/lib/events";
import { useTx } from "./TxFlow";

export default function LoanDetail({ loanId, backHref }) {
  const { runTx } = useTx();
  const { data, loading, error, reload, updatedAt } = useAsync(() => api.get(`/loans/${loanId}`), [loanId], { poll: 6000 });
  const [amount, setAmount] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t); }, []);

  if (loading) return <Spinner label="Reading loan from the blockchain" />;
  if (error) return <><Link href={backHref} className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-white"><ArrowLeft className="h-4 w-4" />Back</Link><ErrorBox error={error} onRetry={reload} /></>;

  const { loan, chain: live, timeline, transactions, yourRole } = data;
  const state = live?.state || loan.status.toUpperCase();
  const due = Number(live?.amountDueEth ?? 0);
  const total = Number(loan.principal) + Number(loan.interest_amount);
  const repaid = Number(live?.repaidEth ?? loan.repaid_amount ?? 0);
  const deadline = live?.deadline ? live.deadline * 1000 : (toDate(loan.due_ts)?.getTime() ?? 0);
  // The chain clock can differ from this computer's clock (demo time travel), so count down
  // from the chain-reported remaining time instead of comparing with Date.now().
  const msLeft = live ? Math.max(live.secondsRemaining * 1000 - (now - updatedAt), 0) : Math.max(deadline - now, 0);
  const overdue = !!live?.overdue;
  const isActive = state === "FUNDED";

  const repay = async (full) => {
    const value = full ? undefined : Number(amount);
    if (!full && !(value > 0)) return;
    await runTx({
      title: full ? `Repay loan #${loanId} in full` : `Repay ${value} ETH on loan #${loanId}`,
      action: () => api.post(`/borrower/loans/${loanId}/repay`, value ? { amountEth: value } : {}),
    }).catch(() => {});
    setAmount(""); reload();
  };
  const settle = async () => {
    await runTx({ title: `Settle default on loan #${loanId}`, action: () => api.post(`/loans/${loanId}/default`) }).catch(() => {});
    reload();
  };

  return (
    <>
      <Link href={backHref} className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-white"><ArrowLeft className="h-4 w-4" />Back to dashboard</Link>
      <div className="mb-8 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-3 text-3xl font-bold">Loan #{loan.blockchain_loan_id} <Badge className={stateStyle[state]}>{state.toLowerCase()}</Badge>
            {loan.insurer_wallet && <Badge className="border-amber-500/40 text-amber-300">insured</Badge>}</h1>
          <p className="mt-1 text-sm text-zinc-400">You are the <b className="text-zinc-200">{yourRole}</b> · opened {when(loan.start_ts)}</p>
        </div>
      </div>

      {overdue && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-red-500/40 bg-red-500/10 p-4" role="alert">
          <div className="flex items-center gap-3 text-red-100"><AlertTriangle className="h-5 w-5" /><div><p className="font-semibold">Deadline passed</p><p className="text-sm text-red-200/80">Anyone can now trigger the default: the contract pays out insurance (if any) and permanently flags the borrower.</p></div></div>
          <Btn variant="danger" onClick={settle}><Gavel className="h-4 w-4" /> Settle default</Btn>
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Principal" value={eth(loan.principal, 4)} hint={`${loan.duration_days} day term`} />
        <Stat label="Interest" value={eth(loan.interest_amount, 6)} hint={`${pct(loan.apr_bps)} APR · simple interest`} />
        <Stat label={isActive ? "Still owed" : "Total settled"} value={eth(isActive ? due : repaid, 5)} tone={isActive ? (overdue ? "bad" : "warn") : "good"} hint={`total due ${eth(total, 5)}`} />
        <Stat label={isActive ? "Time left" : "Credit score at origination"} value={isActive ? (overdue ? "Overdue" : duration(msLeft / 1000)) : loan.credit_score_at_origination ?? "—"} tone={overdue ? "bad" : "default"} hint={isActive ? `due ${when(deadline / 1000)}` : "attested on-chain"} />
      </div>

      <div className="mt-4"><div className="mb-1 flex justify-between text-xs text-zinc-400"><span>Repayment progress</span><span className="tabular-nums">{eth(repaid, 5)} of {eth(total, 5)}</span></div>
        <ProgressBar value={(repaid / (total || 1)) * 100} tone={state === "DEFAULTED" ? "bg-red-400" : "bg-emerald-400"} label="Repayment progress" /></div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="min-w-0 space-y-6 lg:col-span-2">
          <Card title="On-chain timeline" subtitle="Every step below is a smart-contract event, read straight from the blockchain.">
            {timeline.length === 0 ? <p className="text-sm text-zinc-500">No events yet.</p> : (
              <ol className="relative space-y-4 border-l border-zinc-800 pl-6">
                {timeline.map((e) => {
                  const info = EVENT_INFO[e.event];
                  return (
                    <li key={`${e.txHash}-${e.logIndex}`} className="relative">
                      <span className="absolute -left-[31px] top-1.5 h-3 w-3 rounded-full border-2 border-black bg-zinc-400" aria-hidden />
                      <div className={cx("rounded-xl border p-3", toneClass[info?.tone || "zinc"])}>
                        <div className="flex flex-wrap items-center justify-between gap-2 text-sm font-medium"><span>{info?.title || e.event}</span><span className="text-xs font-normal opacity-70">{when(e.timestamp)} · block {e.blockNumber}</span></div>
                        <p className="mt-1 text-xs text-zinc-300">{describeEvent(e)}</p>
                        <div className="mt-1.5 flex items-center gap-3 text-[11px] text-zinc-500"><span>{e.contract}</span><TxLink hash={e.txHash} /></div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </Card>

          <Card title="Transactions" pad={false}>
            <div className="p-2"><Table rows={transactions} empty={<p className="p-4 text-sm text-zinc-500">No indexed transactions.</p>} columns={[
              { key: "kind", label: "Type", render: (t) => t.kind.replace(/_/g, " ") },
              { key: "hash", label: "Hash", render: (t) => <TxLink hash={t.tx_hash} /> },
              { key: "block", label: "Block", right: true, render: (t) => t.block_number },
              { key: "gas", label: "Gas", right: true, render: (t) => Number(t.gas_used).toLocaleString() },
              { key: "fee", label: "Fee (ETH)", right: true, render: (t) => Number(t.fee_eth).toFixed(6) },
            ]} /></div>
          </Card>
        </div>

        <div className="min-w-0 space-y-6">
          {yourRole === "borrower" && isActive && (
            <Card title="Repay" subtitle="Payments go straight to the lender through the escrow contract.">
              <div className="space-y-3">
                <Btn className="w-full" onClick={() => repay(true)}><Banknote className="h-4 w-4" /> Pay in full · {eth(due, 5)}</Btn>
                <div className="relative text-center text-xs text-zinc-500 before:absolute before:left-0 before:top-1/2 before:h-px before:w-[42%] before:bg-zinc-800 after:absolute after:right-0 after:top-1/2 after:h-px after:w-[42%] after:bg-zinc-800">or partial</div>
                <Field label="Amount (ETH)"><input className={inputCls} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder={`up to ${due.toFixed(5)}`} /></Field>
                <Btn variant="secondary" className="w-full" disabled={!(Number(amount) > 0 && Number(amount) <= due)} onClick={() => repay(false)}>Pay partial amount</Btn>
              </div>
            </Card>
          )}
          <Card title="Parties">
            <dl className="space-y-3 text-sm">
              <div className="flex justify-between"><dt className="text-zinc-400">Borrower</dt><dd><Address value={loan.borrower_wallet} /></dd></div>
              <div className="flex justify-between"><dt className="text-zinc-400">Lender</dt><dd><Address value={loan.lender_wallet} /></dd></div>
              <div className="flex justify-between"><dt className="text-zinc-400">Insurer</dt><dd>{loan.insurer_wallet ? <Address value={loan.insurer_wallet} /> : <span className="text-zinc-500">none</span>}</dd></div>
            </dl>
          </Card>
          <Card title="Contract terms">
            <dl className="space-y-2 text-sm">
              {[["Credit score attested", loan.credit_score_at_origination], ["Premium paid", loan.insurance_premium ? eth(loan.insurance_premium, 6) : "—"], ["Insurance payout", loan.insurance_payout ? eth(loan.insurance_payout, 4) : "—"], ["Funding tx", <TxLink key="a" hash={loan.tx_create_hash} />], ["Default tx", <TxLink key="b" hash={loan.tx_default_hash} />]].map(([k, v]) => (
                <div key={k} className="flex justify-between"><dt className="text-zinc-400">{k}</dt><dd className="text-right">{v}</dd></div>
              ))}
            </dl>
          </Card>
        </div>
      </div>
    </>
  );
}
