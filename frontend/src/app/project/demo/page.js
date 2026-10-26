"use client";
import { useState } from "react";
import Link from "next/link";
import { Clock, Gavel, FastForward, ListChecks } from "lucide-react";
import { Card, Btn, PageHeader, Spinner, ErrorBox, Table, Address, Badge, Stat } from "@/components/kit";
import { useAsync } from "@/lib/hooks";
import { api, chainApi } from "@/lib/api";
import { useAuth } from "@/contexts/AuthContext";
import { when, duration, eth } from "@/lib/format";

const SCRIPT = [
  ["Insurer stakes capital", "Sign in as insurer_zenith, show the overview and the underwriting terms."],
  ["Lender escrows an offer", "As lender_alice create an offer. Watch the transaction visualizer and the events it emits."],
  ["Borrower is scored by AI", "As borrower_dev open “AI credit score” and drag the simulator sliders. Then verify ENS and watch the score jump."],
  ["Borrow without collateral", "Accept the offer in the marketplace, choose insurance, and inspect the transaction in the explorer."],
  ["Repay or default", "Repay partially, then fully. Or come back here, fast-forward past the deadline and watch the insured default settle."],
  ["Show permanence", "Open the Explorer, then the borrower’s on-chain record. A flagged wallet is blocked by the contract itself."],
];

export default function Demo() {
  const { user } = useAuth();
  const time = useAsync(() => chainApi.get("/demo/time"), [], { poll: 4000 });
  const loans = useAsync(() => chainApi.get("/loans?state=FUNDED"), [], { poll: 4000 });
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  const advance = async (days) => {
    setBusy(`d${days}`); setErr(null); setMsg(null);
    try {
      const r = await api.post("/demo/advance-time", { days, settleOverdue: true });
      setMsg(`Chain clock advanced ${days} day${days > 1 ? "s" : ""} (block #${r.blockNumber}).${r.settledLoans.length ? ` Defaults settled for loan ${r.settledLoans.map((x) => `#${x}`).join(", ")}.` : " No loans became overdue."}`);
      time.reload(); loans.reload();
    } catch (e) { setErr(e); } finally { setBusy(null); }
  };
  const settle = async () => {
    setBusy("settle"); setErr(null);
    try { const r = await api.post("/demo/settle-overdue"); setMsg(r.settledLoans.length ? `Settled loans ${r.settledLoans.map((x) => `#${x}`).join(", ")}` : "Nothing overdue."); loans.reload(); } catch (e) { setErr(e); } finally { setBusy(null); }
  };

  const active = loans.data?.loans || [];
  return (
    <div className="mx-auto max-w-6xl px-4 pb-20 pt-24 sm:px-6">
      <PageHeader title="Demo control room" subtitle="Tools for presenting Credloom: control the chain clock to show deadlines, defaults and insurance payouts on demand." />

      {!user && <div className="mb-6 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">Time controls need a signed-in account. <Link href="/signin" className="underline">Sign in</Link> with a demo user.</div>}
      {msg && <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100" role="status">{msg}</div>}
      <ErrorBox error={err} />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Chain clock" subtitle="Hardhat lets us jump forward in time" className="lg:col-span-1">
          {time.loading ? <Spinner /> : (
            <>
              <Stat label="Latest block time" value={when(time.data.blockTimestamp)} hint={`block #${time.data.blockNumber}`} icon={Clock} />
              <div className="mt-4 grid grid-cols-3 gap-2">
                {[1, 7, 30].map((d) => (<Btn key={d} variant="secondary" size="sm" disabled={!user} loading={busy === `d${d}`} onClick={() => advance(d)}><FastForward className="h-3.5 w-3.5" />{d}d</Btn>))}
              </div>
              <Btn className="mt-3 w-full" variant="danger" size="sm" disabled={!user} loading={busy === "settle"} onClick={settle}><Gavel className="h-4 w-4" /> Settle overdue loans now</Btn>
              <p className="mt-3 text-xs text-zinc-500">A background keeper also settles overdue loans automatically every few seconds, like a production bot would.</p>
            </>
          )}
        </Card>

        <Card title="Active loans on-chain" className="lg:col-span-2" pad={false}>
          <div className="p-2">
            <Table rows={active} empty={<p className="p-6 text-center text-sm text-zinc-500">No active loans.</p>} columns={[
              { key: "id", label: "Loan", render: (l) => <b>#{l.loanId}</b> },
              { key: "b", label: "Borrower", render: (l) => <Address value={l.borrower} /> },
              { key: "p", label: "Principal", right: true, render: (l) => eth(l.principalEth, 3) },
              { key: "i", label: "Insured", render: (l) => (l.isInsured ? "Yes" : "No") },
              { key: "t", label: "Deadline", render: (l) => (l.overdue ? <Badge className="border-red-500/40 text-red-300">overdue</Badge> : duration(l.secondsRemaining) + " left") },
            ]} />
          </div>
        </Card>
      </div>

      <Card className="mt-6" title="Suggested presentation flow" subtitle="About 8 minutes" action={<ListChecks className="h-5 w-5 text-zinc-500" />}>
        <ol className="space-y-3">
          {SCRIPT.map(([t, d], i) => (
            <li key={t} className="flex gap-4"><span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-zinc-800 text-sm font-semibold">{i + 1}</span><div><p className="font-medium">{t}</p><p className="text-sm text-zinc-400">{d}</p></div></li>
          ))}
        </ol>
        <p className="mt-5 text-xs text-zinc-500">Demo password for all seeded users: <code className="text-zinc-300">Demo@1234</code> · reset everything with <code className="text-zinc-300">./scripts/dev.sh reset</code></p>
      </Card>
    </div>
  );
}
