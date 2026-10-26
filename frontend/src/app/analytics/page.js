"use client";
import { Coins, Users, Percent, ShieldCheck, Activity, Layers } from "lucide-react";
import { Card, Stat, PageHeader, Spinner, ErrorBox, BarList } from "@/components/kit";
import { useAsync } from "@/lib/hooks";
import { api } from "@/lib/api";
import { eth, ago } from "@/lib/format";

export default function Analytics() {
  const { data: d, loading, error, reload } = useAsync(() => api.get("/analytics/platform"), [], { poll: 10000 });
  if (loading) return <div className="pt-24"><Spinner label="Aggregating protocol data" /></div>;
  if (error) return <div className="mx-auto max-w-3xl px-4 pt-28"><ErrorBox error={error} onRetry={reload} /></div>;
  const c = d.chain;
  const settled = c.loansByState.REPAID + c.loansByState.DEFAULTED;

  return (
    <div className="mx-auto max-w-7xl px-4 pb-20 pt-24 sm:px-6">
      <PageHeader title="Protocol analytics" subtitle="Live statistics combining on-chain state with the off-chain index. Useful for evaluating risk pricing and portfolio health." />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="Total originated" value={eth(c.totalOriginatedEth, 3)} hint={`${c.totalLoans} loans · ${c.totalOffers} offers created`} icon={Coins} tone="info" />
        <Stat label="Average APR" value={`${d.avgAprPercent.toFixed(2)}%`} hint="dynamic, priced by AI score" icon={Percent} />
        <Stat label="Default rate" value={`${(c.defaultRate * 100).toFixed(1)}%`} hint={`${c.loansByState.DEFAULTED} of ${settled} settled loans`} icon={Activity} tone={c.defaultRate > 0.2 ? "bad" : "good"} />
        <Stat label="Open liquidity" value={eth(c.openOfferLiquidityEth, 3)} hint={`${c.openOffers} open offers`} icon={Layers} />
        <Stat label="Insurance staked" value={eth(c.insuranceStakedEth, 3)} hint={`${eth(c.insuranceReservedEth, 3)} reserved`} icon={ShieldCheck} tone="warn" />
        <Stat label="Insured share" value={`${(d.insuredShare * 100).toFixed(0)}%`} hint="of all loans" icon={Users} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card title="Loan outcomes">
          <BarList items={[
            { label: "Active", value: c.loansByState.FUNDED, color: "bg-blue-400" },
            { label: "Repaid", value: c.loansByState.REPAID, color: "bg-emerald-400" },
            { label: "Defaulted", value: c.loansByState.DEFAULTED, color: "bg-red-400" },
          ]} />
        </Card>
        <Card title="Participants">
          <BarList items={[
            { label: "Borrowers", value: d.users.borrower, color: "bg-purple-400" },
            { label: "Lenders", value: d.users.lender, color: "bg-blue-400" },
            { label: "Insurers", value: d.users.insurer, color: "bg-amber-400" },
          ]} />
        </Card>
        <Card title="Volume (ETH)">
          <BarList format={(v) => v.toFixed(3)} items={[
            { label: "Originated", value: Number(c.totalOriginatedEth), color: "bg-blue-400" },
            { label: "Principal repaid", value: Number(c.totalRepaidPrincipalEth), color: "bg-emerald-400" },
            { label: "Defaulted", value: Number(c.totalDefaultedEth), color: "bg-red-400" },
          ]} />
        </Card>
      </div>

      <Card className="mt-6" title="Does the AI score predict defaults?" subtitle="Loans grouped by the credit score attested at origination">
        <div className="grid gap-4 sm:grid-cols-5">
          {d.scoreBuckets.map((b) => (
            <div key={b.range} className="rounded-xl bg-zinc-900 p-4 text-center">
              <div className="text-xs text-zinc-400">Score {b.range}</div>
              <div className="mt-2 text-2xl font-semibold tabular-nums">{b.loans}</div>
              <div className="text-xs text-zinc-500">loans</div>
              <div className={`mt-2 text-sm font-medium ${b.defaults ? "text-red-300" : "text-emerald-300"}`}>{b.loans ? `${((b.defaults / b.loans) * 100).toFixed(0)}% defaulted` : "—"}</div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="mt-6" title="Recent protocol activity">
        <ul className="divide-y divide-zinc-900 text-sm">
          {d.recentEvents.map((e) => (
            <li key={e.id} className="flex items-center justify-between py-2.5">
              <span className="capitalize text-zinc-200">{e.type.replace(/_/g, " ")}</span>
              <span className="text-xs text-zinc-500">{e.amount != null ? `${Number(e.amount).toFixed(3)} ETH · ` : ""}{ago(e.event_ts)}</span>
            </li>
          ))}
        </ul>
      </Card>
    </div>
  );
}
