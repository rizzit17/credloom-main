"use client";
import { useState } from "react";
import Link from "next/link";
import { Boxes, Cpu, Fuel, KeyRound, Layers } from "lucide-react";
import { Card, Stat, PageHeader, Spinner, ErrorBox, Address, TxLink, Badge, Table, cx } from "@/components/kit";
import { useAsync } from "@/lib/hooks";
import { chainApi } from "@/lib/api";
import { ago, shortHash, duration } from "@/lib/format";
import { EVENT_INFO, describeEvent, toneClass } from "@/lib/events";

const CONTRACT_ROLES = {
  ReputationRegistry: "Permanent borrower credit history & default flags",
  InsurancePool: "Insurer stakes, reserved coverage, premiums and payouts",
  LoanEscrow: "Loan lifecycle: funding, repayment, default settlement",
  LenderLiquidityPool: "Escrowed lender offers with on-chain rule enforcement",
};

export default function Explorer() {
  const info = useAsync(() => chainApi.get("/system/info"), [], { poll: 3000 });
  const blocks = useAsync(() => chainApi.get("/explorer/blocks?limit=12"), [], { poll: 3000 });
  const [contract, setContract] = useState("");
  const events = useAsync(() => chainApi.get(`/explorer/events?limit=40${contract ? `&contract=${contract}` : ""}`), [contract], { poll: 3000 });

  if (info.loading) return <div className="pt-24"><Spinner label="Connecting to the node" /></div>;
  if (info.error) return <div className="mx-auto max-w-3xl px-4 pt-28"><ErrorBox error={info.error} onRetry={info.reload} /></div>;
  const n = info.data;

  return (
    <div className="mx-auto max-w-7xl px-4 pb-20 pt-24 sm:px-6">
      <PageHeader title="Credloom Explorer" subtitle="A live view of the local EVM chain that settles every loan. Everything here is read directly from the blockchain." />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Latest block" value={`#${n.blockNumber}`} hint={`${n.network}`} icon={Boxes} tone="good" />
        <Stat label="Chain ID" value={n.chainId} hint="EVM compatible (Hardhat)" icon={Layers} />
        <Stat label="Gas price" value={`${Number(n.gasPriceGwei).toFixed(2)} gwei`} icon={Fuel} />
        <Stat label="Default grace period" value={n.gracePeriodSeconds ? duration(n.gracePeriodSeconds) : "none"} hint="after loan deadline" icon={Cpu} />
      </div>

      <Card className="mt-6" title="Deployed smart contracts" subtitle={`Protocol signer (credit oracle): ${n.protocolSigner}`} pad={false}>
        <div className="p-2">
          <Table rows={Object.entries(n.contracts).map(([name, address]) => ({ id: name, name, address }))} columns={[
            { key: "name", label: "Contract", render: (c) => <span className="font-medium text-white">{c.name}</span> },
            { key: "addr", label: "Address", render: (c) => <Address value={c.address} chars={10} /> },
            { key: "role", label: "Responsibility", render: (c) => <span className="text-zinc-400">{CONTRACT_ROLES[c.name]}</span> },
          ]} />
        </div>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Latest blocks" subtitle="Auto-mined: one block per transaction on the local chain" pad={false}>
          <ul className="divide-y divide-zinc-900">
            {(blocks.data?.blocks || []).map((b) => (
              <li key={b.number} className="p-4">
                <div className="flex items-center justify-between">
                  <Link href={`/explorer/block/${b.number}`} className="font-medium text-blue-300 hover:underline">Block #{b.number}</Link>
                  <span className="text-xs text-zinc-500">{ago(b.timestamp)} · {b.txCount} tx · gas {b.gasUsed.toLocaleString()}</span>
                </div>
                <div className="mt-1 font-mono text-[11px] text-zinc-600">{shortHash(b.hash)}</div>
                {b.transactions.map((t) => (
                  <div key={t.txHash} className="mt-2 flex items-center justify-between gap-3 text-xs">
                    <TxLink hash={t.txHash} />
                    <span className="truncate text-zinc-400">{t.toContract ? `${t.toContract}.${t.method || "call"}` : t.method || "transfer"}</span>
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </Card>

        <Card title="Smart-contract event feed" subtitle="Decoded logs, newest first"
          action={<select aria-label="Filter by contract" value={contract} onChange={(e) => setContract(e.target.value)} className="rounded-lg border border-zinc-700 bg-black px-2 py-1 text-xs"><option value="">All contracts</option>{Object.keys(n.contracts).map((c) => <option key={c} value={c}>{c}</option>)}</select>} pad={false}>
          <ul className="max-h-[720px] space-y-2 overflow-y-auto p-4">
            {(events.data?.events || []).map((e) => {
              const i = EVENT_INFO[e.event];
              return (
                <li key={`${e.txHash}-${e.logIndex}`} className={cx("rounded-xl border p-3", toneClass[i?.tone || "zinc"])}>
                  <div className="flex items-center justify-between text-sm font-medium"><span>{i?.title || e.event}</span><span className="text-[11px] font-normal opacity-70">block {e.blockNumber} · {ago(e.timestamp)}</span></div>
                  <p className="mt-1 text-xs text-zinc-300">{describeEvent(e)}</p>
                  <div className="mt-1.5 flex items-center gap-3 text-[11px] text-zinc-500"><Badge className="border-zinc-700 text-zinc-400">{e.contract}</Badge><TxLink hash={e.txHash} /></div>
                </li>
              );
            })}
          </ul>
        </Card>
      </div>

      <p className="mt-6 flex items-center gap-2 text-xs text-zinc-500"><KeyRound className="h-3.5 w-3.5" /> Wallets on this network are managed by Credloom, which signs transactions on your behalf after you authorise them in the app.</p>
    </div>
  );
}
