"use client";
import { use } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Card, Spinner, ErrorBox, Table, TxLink, Address } from "@/components/kit";
import { useAsync } from "@/lib/hooks";
import { chainApi } from "@/lib/api";
import { when } from "@/lib/format";

export default function BlockPage({ params }) {
  const { number } = use(params);
  const n = Number(number);
  const { data: b, loading, error } = useAsync(() => chainApi.get(`/explorer/blocks/${n}`), [n]);
  return (
    <div className="mx-auto max-w-5xl px-4 pb-20 pt-24 sm:px-6">
      <Link href="/explorer" className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-white"><ArrowLeft className="h-4 w-4" />Explorer</Link>
      <h1 className="mb-6 text-2xl font-bold">Block #{number}</h1>
      {loading && <Spinner />}
      <ErrorBox error={error} />
      {b && (
        <>
          <Card>
            <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
              {[["Timestamp", when(b.timestamp)], ["Transactions", b.transactions.length], ["Gas used", `${b.gasUsed.toLocaleString()} / ${b.gasLimit.toLocaleString()}`],
                ["Hash", <span key="h" className="break-all font-mono text-xs">{b.hash}</span>], ["Parent hash", <span key="p" className="break-all font-mono text-xs">{b.parentHash}</span>]].map(([k, v]) => (
                <div key={k}><dt className="text-xs text-zinc-500">{k}</dt><dd className="mt-0.5 text-zinc-200">{v}</dd></div>))}
            </dl>
            <div className="mt-4 flex gap-4 text-sm">
              {n > 0 && <Link className="text-blue-300 hover:underline" href={`/explorer/block/${n - 1}`}>← Block #{n - 1}</Link>}
              <Link className="text-blue-300 hover:underline" href={`/explorer/block/${n + 1}`}>Block #{n + 1} →</Link>
            </div>
          </Card>
          <Card className="mt-6" title="Transactions" pad={false}>
            <div className="p-2"><Table rows={b.transactions} columns={[
              { key: "h", label: "Hash", render: (t) => <TxLink hash={t.txHash} /> },
              { key: "m", label: "Call", render: (t) => (t.toContract ? `${t.toContract}.${t.method || "call"}` : t.method || "—") },
              { key: "f", label: "From", render: (t) => <Address value={t.from} /> },
              { key: "v", label: "Value", right: true, render: (t) => `${t.valueEth} ETH` },
            ]} /></div>
          </Card>
        </>
      )}
    </div>
  );
}
