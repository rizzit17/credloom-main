"use client";
import { Card, PageHeader, Spinner, ErrorBox, Table, TxLink, Badge } from "./kit";
import { useAsync } from "@/lib/hooks";
import { api } from "@/lib/api";
import { when } from "@/lib/format";

export default function ActivityFeed() {
  const { data, loading, error, reload } = useAsync(() => api.get("/me/activity"), [], { poll: 8000 });
  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;
  return (
    <>
      <PageHeader title="Activity" subtitle="Every action you take is a transaction on the blockchain. Click a hash to inspect it." />
      <Card title="Transactions" subtitle="Gas used and fees are real values from the local EVM" pad={false}>
        <div className="p-2">
          <Table rows={data.transactions} columns={[
            { key: "k", label: "Action", render: (t) => <Badge>{t.kind.replace(/_/g, " ")}</Badge> },
            { key: "h", label: "Hash", render: (t) => <TxLink hash={t.tx_hash} /> },
            { key: "b", label: "Block", right: true, render: (t) => t.block_number },
            { key: "g", label: "Gas", right: true, render: (t) => Number(t.gas_used).toLocaleString() },
            { key: "f", label: "Fee (ETH)", right: true, render: (t) => Number(t.fee_eth).toFixed(6) },
            { key: "w", label: "When", render: (t) => when(t.created_at) },
          ]} />
        </div>
      </Card>
      <Card className="mt-6" title="Event log" pad={false}>
        <div className="p-2">
          <Table rows={data.events} columns={[
            { key: "t", label: "Event", render: (e) => e.type.replace(/_/g, " ") },
            { key: "a", label: "Amount", right: true, render: (e) => (e.amount != null ? `${Number(e.amount).toFixed(4)} ETH` : "—") },
            { key: "h", label: "Tx", render: (e) => <TxLink hash={e.tx_hash} /> },
            { key: "w", label: "When", render: (e) => when(e.event_ts) },
          ]} />
        </div>
      </Card>
    </>
  );
}
