"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Gauge, TrendingUp, Wallet, Award, RefreshCw, ArrowRight, AlertOctagon } from "lucide-react";
import { Card, Stat, Btn, Badge, PageHeader, Spinner, ErrorBox, Empty, LineChart, ProgressBar, Table, TxLink } from "@/components/kit";
import { ScoreGauge } from "@/components/kit";
import { useAsync } from "@/lib/hooks";
import { api } from "@/lib/api";
import { eth, pct, when, duration, stateStyle } from "@/lib/format";
import { useState } from "react";

export default function BorrowerOverview() {
  const router = useRouter();
  const credit = useAsync(() => api.get("/me/credit"), []);
  const loans = useAsync(() => api.get("/borrower/loans"), [], { poll: 8000 });
  const hist = useAsync(() => api.get("/me/credit/history"), []);
  const [refreshing, setRefreshing] = useState(false);

  const refresh = async () => {
    setRefreshing(true);
    try { await api.post("/me/credit/refresh"); await Promise.all([credit.reload(), hist.reload()]); } finally { setRefreshing(false); }
  };

  if (credit.loading) return <Spinner label="Loading your profile" />;
  if (credit.error) return <ErrorBox error={credit.error} onRetry={credit.reload} />;
  const c = credit.data;
  const rep = c.reputation;
  const all = loans.data?.loans || [];
  const active = all.filter((l) => l.status === "active");
  const outstanding = active.reduce((s, l) => s + Number(l.chain?.amountDueEth ?? l.principal), 0);
  const points = (hist.data?.history || []).map((h, i) => ({ x: i, y: h.score }));

  return (
    <>
      <PageHeader title="Borrower overview" subtitle="Your reputation is your collateral. Everything below is derived from your wallet and on-chain history."
        action={<Btn href="/borrower/marketplace">Browse loan offers <ArrowRight className="h-4 w-4" /></Btn>} />

      {rep?.flagged && (
        <div className="mb-6 flex items-start gap-3 rounded-2xl border border-red-500/40 bg-red-500/10 p-4 text-red-100" role="alert">
          <AlertOctagon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden />
          <div><p className="font-semibold">Your wallet is permanently flagged on-chain</p>
            <p className="text-sm text-red-200/80">A default was recorded in the ReputationRegistry smart contract. This cannot be reversed, and new loans are blocked by the contract itself.</p></div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="AI credit score" subtitle={`Model: gradient boosting · source: ${c.score_source || "n/a"}`} className="lg:col-span-1"
          action={<Btn variant="ghost" size="sm" onClick={refresh} loading={refreshing} aria-label="Recompute score"><RefreshCw className="h-4 w-4" /></Btn>}>
          <ScoreGauge score={c.credit_score ?? 0} />
          <div className="mt-5 grid grid-cols-2 gap-3 text-center text-sm">
            <div className="rounded-xl bg-zinc-900 p-3"><div className="text-xs text-zinc-400">Your APR</div><div className="text-lg font-semibold">{pct(c.aprBps)}</div></div>
            <div className="rounded-xl bg-zinc-900 p-3"><div className="text-xs text-zinc-400">Tier</div><div className="text-lg font-semibold">{c.tier} · <span className="text-sm font-normal text-zinc-300">{c.tierName}</span></div></div>
          </div>
          <Link href="/borrower/credit" className="mt-4 inline-flex items-center gap-1 text-sm text-blue-300 hover:underline">Why this score? <ArrowRight className="h-3.5 w-3.5" /></Link>
        </Card>

        <div className="grid content-start gap-4 sm:grid-cols-2 lg:col-span-2">
          <Stat label="Available credit" value={eth(c.available_credit, 3)} hint={`of ${eth(c.max_borrow_amount, 2)} limit`} icon={Wallet} tone="info" />
          <Stat label="Max single loan" value={eth(c.max_loan_amount, 3)} hint={`up to ${c.max_duration_days} days`} icon={Gauge} />
          <Stat label="Outstanding" value={eth(outstanding, 4)} hint={`${active.length} active loan${active.length === 1 ? "" : "s"}`} icon={TrendingUp} tone={outstanding > 0 ? "warn" : "default"} />
          <Stat label="On-chain reputation" value={rep ? `${rep.reputationPoints}/1000` : "—"} hint={rep ? `${rep.loansRepaid} repaid · ${rep.loansDefaulted} defaulted` : "chain offline"} icon={Award} tone={rep?.flagged ? "bad" : "good"} />
          <div className="sm:col-span-2 rounded-2xl border border-zinc-800 bg-zinc-950/80 p-5">
            <div className="mb-2 flex justify-between text-sm"><span className="text-zinc-300">Credit utilisation</span><span className="tabular-nums text-zinc-400">{Math.round((c.utilization_rate || 0) * 100)}%</span></div>
            <ProgressBar value={(c.utilization_rate || 0) * 100} tone={c.utilization_rate > 0.7 ? "bg-red-400" : "bg-blue-400"} label="Credit utilisation" />
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="Your loans" className="lg:col-span-2" action={<Badge>{all.length} total</Badge>} pad={false}>
          <div className="p-2">
            <Table
              empty={<Empty title="No loans yet" hint="Pick an offer in the marketplace. The smart contract releases funds instantly." action={<Btn href="/borrower/marketplace" size="sm">Open marketplace</Btn>} />}
              rows={all}
              onRow={(l) => router.push(`/borrower/loan/${l.blockchain_loan_id}`)}
              columns={[
                { key: "id", label: "Loan", render: (l) => <span className="font-medium text-white">#{l.blockchain_loan_id}</span> },
                { key: "p", label: "Principal", right: true, render: (l) => eth(l.principal, 3) },
                { key: "apr", label: "APR", right: true, render: (l) => pct(l.apr_bps) },
                { key: "due", label: "Due", render: (l) => l.status === "active" ? (l.chain?.overdue ? <span className="text-red-300">Overdue</span> : <span>{duration(l.chain?.secondsRemaining ?? 0)} left</span>) : when(l.due_ts) },
                { key: "ins", label: "Insured", render: (l) => (l.insurer_wallet ? "Yes" : "No") },
                { key: "s", label: "Status", render: (l) => <Badge className={stateStyle[l.status]}>{l.status}</Badge> },
              ]}
            />
          </div>
        </Card>

        <Card title="Score history" subtitle="Recomputed after every loan event">
          <LineChart points={points} xLabel="update" yFormat={(v) => Math.round(v)} />
          {hist.data?.history?.length ? (
            <ul className="mt-3 space-y-1.5 text-xs text-zinc-400">
              {hist.data.history.slice(-4).reverse().map((h, i) => (<li key={i} className="flex justify-between"><span>{h.reason}</span><span className="tabular-nums text-zinc-200">{h.score}</span></li>))}
            </ul>
          ) : null}
        </Card>
      </div>

      {rep && (
        <Card className="mt-6" title="On-chain credit record" subtitle="Read live from the ReputationRegistry smart contract. Permanent and publicly verifiable.">
          <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-5">
            {[["Loans taken", rep.loansTaken], ["Repaid", rep.loansRepaid], ["Defaulted", rep.loansDefaulted], ["Total borrowed", eth(rep.totalBorrowedEth, 3)], ["Total repaid", eth(rep.totalRepaidEth, 3)]].map(([k, v]) => (
              <div key={k}><dt className="text-xs text-zinc-500">{k}</dt><dd className="mt-1 text-lg font-semibold tabular-nums">{v}</dd></div>
            ))}
          </dl>
        </Card>
      )}
    </>
  );
}
