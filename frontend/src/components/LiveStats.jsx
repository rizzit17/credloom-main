"use client";
import { useAsync } from "@/lib/hooks";
import { api } from "@/lib/api";
import { eth } from "@/lib/format";

/** Real numbers pulled from the chain on the landing page. Hidden if the API is offline. */
export default function LiveStats() {
  const { data } = useAsync(() => api.get("/analytics/platform"), [], { poll: 15000 });
  if (!data) return null;
  const c = data.chain;
  const items = [
    ["Loans originated", c.totalLoans],
    ["Volume", eth(c.totalOriginatedEth, 2)],
    ["Avg. APR", `${data.avgAprPercent.toFixed(1)}%`],
    ["Insurance staked", eth(c.insuranceStakedEth, 2)],
    ["Current block", `#${c.blockNumber}`],
  ];
  return (
    <section className="border-y border-zinc-800 bg-black py-8" aria-label="Live protocol statistics">
      <dl className="mx-auto grid max-w-6xl grid-cols-2 gap-6 px-6 text-center sm:grid-cols-5">
        {items.map(([k, v]) => (
          <div key={k}><dd className="text-2xl font-semibold tabular-nums text-white">{v}</dd><dt className="mt-1 text-xs uppercase tracking-wider text-zinc-500">{k}</dt></div>
        ))}
      </dl>
    </section>
  );
}
