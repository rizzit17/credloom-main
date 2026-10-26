"use client";
import { useRouter } from "next/navigation";
import { Wallet, Lock, Activity, TrendingUp, ShieldAlert, Coins } from "lucide-react";
import { Card, Stat, Btn, Badge, PageHeader, Spinner, ErrorBox, Empty, Table, Address, TxLink } from "@/components/kit";
import { useAsync } from "@/lib/hooks";
import { api } from "@/lib/api";
import { eth, pct, duration, stateStyle } from "@/lib/format";
import { useTx } from "@/components/TxFlow";

export default function LenderOverview() {
  const router = useRouter();
  const { runTx } = useTx();
  const sum = useAsync(() => api.get("/lender/summary"), [], { poll: 8000 });
  const offers = useAsync(() => api.get("/lender/offers"), [], { poll: 8000 });
  const loans = useAsync(() => api.get("/lender/loans"), [], { poll: 8000 });

  const withdraw = async (o) => {
    await runTx({ title: `Withdraw offer #${o.offerId}`, action: () => api.post(`/lender/offers/${o.offerId}/withdraw`) }).catch(() => {});
    sum.reload(); offers.reload();
  };

  if (sum.loading) return <Spinner label="Loading your lending book" />;
  if (sum.error) return <ErrorBox error={sum.error} onRetry={sum.reload} />;
  const s = sum.data;
  const open = (offers.data?.offers || []).filter((o) => o.active);

  return (
    <>
      <PageHeader title="Lender overview" subtitle="Your capital sits in smart-contract escrow until a verified borrower takes it. Repayments flow straight back to your wallet."
        action={<Btn href="/lender/escrow">Create offer</Btn>} />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Stat label="Wallet balance" value={eth(s.walletBalanceEth, 3)} icon={Wallet} />
        <Stat label="Escrowed in open offers" value={eth(s.escrowedInOffersEth, 3)} hint={`${s.openOffers} open offer${s.openOffers === 1 ? "" : "s"}`} icon={Lock} tone="info" />
        <Stat label="Lent out now" value={eth(s.activePrincipalEth, 3)} hint={`${s.activeLoans} active loan${s.activeLoans === 1 ? "" : "s"}`} icon={Activity} tone="warn" />
        <Stat label="Interest earned" value={eth(s.interestEarnedEth, 5)} hint={`${s.loansRepaid} repaid loans`} icon={Coins} tone="good" />
        <Stat label="Realised return" value={`${s.realisedReturnPct.toFixed(2)}%`} hint="interest − net losses over total lent" icon={TrendingUp} tone={s.realisedReturnPct >= 0 ? "good" : "bad"} />
        <Stat label="Default rate" value={`${(s.defaultRate * 100).toFixed(0)}%`} hint={s.loansDefaulted ? `${eth(s.insuranceRecoveredEth, 3)} recovered by insurance` : "no defaults"} icon={ShieldAlert} tone={s.loansDefaulted ? "bad" : "default"} />
      </div>

      <Card className="mt-6" title="Your offers" subtitle="Live from the LenderLiquidityPool contract" pad={false}>
        <div className="p-2">
          <Table rows={offers.data?.offers || []}
            empty={<Empty title="No offers yet" hint="Create an offer to put your capital to work." action={<Btn href="/lender/escrow" size="sm">Create offer</Btn>} />}
            columns={[
              { key: "id", label: "Offer", render: (o) => <b>#{o.offerId}</b> },
              { key: "a", label: "Amount", right: true, render: (o) => eth(o.amountEth, 3) },
              { key: "d", label: "Term", render: (o) => `${o.durationDays}d` },
              { key: "m", label: "Min score", right: true, render: (o) => o.minCreditScore },
              { key: "b", label: "APR band", render: (o) => `${pct(o.minAprBps)}–${pct(o.maxAprBps)}` },
              { key: "s", label: "State", render: (o) => <Badge className={o.active ? "border-blue-500/40 text-blue-300" : "border-zinc-700 text-zinc-400"}>{o.active ? "open" : "closed"}</Badge> },
              { key: "x", label: "", right: true, render: (o) => o.active && <Btn size="sm" variant="secondary" onClick={() => withdraw(o)}>Withdraw</Btn> },
            ]} />
        </div>
      </Card>

      <Card className="mt-6" title="Loans funded by you" pad={false}>
        <div className="p-2">
          <Table rows={loans.data?.loans || []} onRow={(l) => router.push(`/lender/loan/${l.blockchain_loan_id}`)}
            empty={<Empty title="No loans yet" hint="When a borrower takes one of your offers it appears here with a live countdown." />}
            columns={[
              { key: "id", label: "Loan", render: (l) => <b>#{l.blockchain_loan_id}</b> },
              { key: "b", label: "Borrower", render: (l) => <Address value={l.borrower_wallet} /> },
              { key: "p", label: "Principal", right: true, render: (l) => eth(l.principal, 3) },
              { key: "i", label: "Interest", right: true, render: (l) => eth(l.interest_amount, 5) },
              { key: "sc", label: "Score", right: true, render: (l) => l.credit_score_at_origination },
              { key: "ins", label: "Insured", render: (l) => (l.insurer_wallet ? "Yes" : "No") },
              { key: "t", label: "Due", render: (l) => l.status === "active" ? (l.chain?.overdue ? <span className="text-red-300">Overdue</span> : `${duration(l.chain?.secondsRemaining ?? 0)} left`) : "—" },
              { key: "st", label: "Status", render: (l) => <Badge className={stateStyle[l.status]}>{l.status}</Badge> },
            ]} />
        </div>
      </Card>
    </>
  );
}
