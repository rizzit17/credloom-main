"use client";
import { use } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, XCircle } from "lucide-react";
import { Card, Spinner, ErrorBox, Address, Badge, cx } from "@/components/kit";
import { useAsync } from "@/lib/hooks";
import { chainApi } from "@/lib/api";
import { when } from "@/lib/format";
import { EVENT_INFO, describeEvent, toneClass, prettyArg } from "@/lib/events";

export default function TxPage({ params }) {
  const { hash } = use(params);
  const { data: t, loading, error } = useAsync(() => chainApi.get(`/explorer/tx/${hash}`), [hash]);
  return (
    <div className="mx-auto max-w-5xl px-4 pb-20 pt-24 sm:px-6">
      <Link href="/explorer" className="mb-4 inline-flex items-center gap-1 text-sm text-zinc-400 hover:text-white"><ArrowLeft className="h-4 w-4" />Explorer</Link>
      <h1 className="mb-6 text-2xl font-bold">Transaction details</h1>
      {loading && <Spinner />}
      <ErrorBox error={error} />
      {t && (
        <div className="space-y-6">
          <Card>
            <div className="mb-4 flex items-center gap-2">
              {t.status === "success" ? <CheckCircle2 className="h-5 w-5 text-emerald-400" /> : <XCircle className="h-5 w-5 text-red-400" />}
              <span className="font-semibold">{t.status === "success" ? "Success" : "Reverted"}</span>
              <Badge>{t.confirmations} confirmation{t.confirmations === 1 ? "" : "s"}</Badge>
            </div>
            <dl className="grid gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
              {[
                ["Hash", <span key="h" className="break-all font-mono text-xs">{t.txHash}</span>],
                ["Block", <Link key="b" className="text-blue-300 hover:underline" href={`/explorer/block/${t.blockNumber}`}>#{t.blockNumber}</Link>],
                ["Block hash", <span key="bh" className="break-all font-mono text-xs">{t.blockHash}</span>],
                ["Timestamp", when(t.timestamp)],
                ["From", <Address key="f" value={t.from} chars={10} />],
                ["To", <span key="t">{t.toContract ? <b>{t.toContract}</b> : null} <Address value={t.to} chars={10} /></span>],
                ["Value", `${t.valueEth} ETH`],
                ["Nonce", t.nonce],
                ["Gas used / limit", `${t.gasUsed.toLocaleString()} / ${t.gasLimit.toLocaleString()} (${((t.gasUsed / t.gasLimit) * 100).toFixed(0)}%)`],
                ["Gas price", `${Number(t.gasPriceGwei).toFixed(3)} gwei`],
                ["Transaction fee", `${Number(t.feeEth).toFixed(8)} ETH`],
                ["Input size", `${t.inputBytes} bytes`],
              ].map(([k, v]) => (<div key={k}><dt className="text-xs text-zinc-500">{k}</dt><dd className="mt-0.5 text-zinc-200">{v}</dd></div>))}
            </dl>
          </Card>

          {t.method && (
            <Card title="Function call" subtitle={`${t.toContract}.${t.method}()`}>
              <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-xs">
                {Object.entries(t.methodArgs || {}).map(([k, v]) => (<span key={k} className="contents"><span className="text-zinc-500">{k}</span><span className="break-all text-zinc-200">{prettyArg(k, v)}</span></span>))}
                {!Object.keys(t.methodArgs || {}).length && <span className="text-zinc-500">no arguments</span>}
              </div>
            </Card>
          )}

          <Card title={`Events emitted (${t.events.length})`} subtitle="Logs written by the contracts during execution">
            <ul className="space-y-3">
              {t.events.map((e) => {
                const i = EVENT_INFO[e.event];
                return (
                  <li key={e.logIndex} className={cx("rounded-xl border p-4", toneClass[i?.tone || "zinc"])}>
                    <div className="flex items-center justify-between text-sm font-medium"><span>{i?.title || e.event}</span><span className="font-mono text-xs opacity-70">#{e.logIndex} · {e.contract}.{e.event}</span></div>
                    <p className="mt-1 text-sm text-zinc-300">{describeEvent(e)}</p>
                    <div className="mt-3 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 font-mono text-xs">
                      {Object.entries(e.args).map(([k, v]) => (<span key={k} className="contents"><span className="text-zinc-500">{k}</span><span className="break-all text-zinc-300">{String(v)}</span></span>))}
                    </div>
                  </li>
                );
              })}
              {!t.events.length && <p className="text-sm text-zinc-500">This transaction emitted no Credloom events.</p>}
            </ul>
          </Card>
        </div>
      )}
    </div>
  );
}
