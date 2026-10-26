"use client";
import { useRouter } from "next/navigation";
import { PageHeader, Card, Spinner, ErrorBox, Table, Badge, Address, Empty } from "@/components/kit";
import { useAsync } from "@/lib/hooks";
import { api } from "@/lib/api";
import { eth, pct, duration, stateStyle } from "@/lib/format";

export default function Policies() {
  const router = useRouter();
  const { data, loading, error, reload } = useAsync(() => api.get("/insurer/policies"), [], { poll: 8000 });
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  const rows = data.policies;
  const claims = rows.filter((p) => p.status === "defaulted");
  return (
    <>
      <PageHeader title="Policies & claims" subtitle="Each insured loan reserves coverage equal to its principal until it is repaid or defaults." />
      <Card title={`Policies (${rows.length})`} pad={false}>
        <div className="p-2">
          <Table rows={rows} onRow={(p) => router.push(`/insurer/loan/${p.blockchain_loan_id}`)}
            empty={<Empty title="No policies yet" hint="Publish your terms on the overview page. Borrowers choose insurers when taking a loan." />}
            columns={[
              { key: "id", label: "Loan", render: (p) => <b>#{p.blockchain_loan_id}</b> },
              { key: "b", label: "Borrower", render: (p) => <Address value={p.borrower_wallet} /> },
              { key: "c", label: "Coverage", right: true, render: (p) => eth(p.principal, 3) },
              { key: "pr", label: "Premium", right: true, render: (p) => eth(p.insurance_premium, 5) },
              { key: "sc", label: "Score", right: true, render: (p) => p.credit_score_at_origination },
              { key: "d", label: "Due", render: (p) => (p.status === "active" ? (p.chain?.overdue ? <span className="text-red-300">Overdue</span> : `${duration(p.chain?.secondsRemaining ?? 0)} left`) : "—") },
              { key: "s", label: "Status", render: (p) => <Badge className={stateStyle[p.status]}>{p.status}</Badge> },
              { key: "pay", label: "Paid out", right: true, render: (p) => (p.insurance_payout ? <span className="text-red-300">{eth(p.insurance_payout, 3)}</span> : "—") },
            ]} />
        </div>
      </Card>
      {claims.length > 0 && <p className="mt-4 text-sm text-zinc-400">{claims.length} claim{claims.length > 1 ? "s" : ""} paid. The payout transaction is visible in each loan’s timeline.</p>}
    </>
  );
}
