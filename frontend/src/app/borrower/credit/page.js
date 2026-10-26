"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { Card, PageHeader, Spinner, ErrorBox, BarList, LineChart, ScoreGauge, Field, inputCls, Badge } from "@/components/kit";
import { useAsync } from "@/lib/hooks";
import { api } from "@/lib/api";
import { pct, scoreBand } from "@/lib/format";

const aprFor = (s) => Math.round(Math.min(2500, Math.max(500, 2500 - (2000 * s) / 1000)));

const SLIDERS = [
  { key: "total_transactions", label: "Wallet transactions", min: 0, max: 500, step: 5 },
  { key: "total_previous_loans_eth", label: "Total previously borrowed (ETH)", min: 0, max: 100, step: 0.5 },
  { key: "holding_days", label: "Wallet age (days)", min: 0, max: 1500, step: 10 },
  { key: "Tier", label: "Verification tier", min: 1, max: 3, step: 1 },
  { key: "loans_repaid", label: "Loans repaid in full", min: 0, max: 12, step: 1 },
  { key: "loans_defaulted", label: "Loans defaulted", min: 0, max: 5, step: 1 },
];

export default function CreditPage() {
  const ex = useAsync(() => api.get("/me/credit/explain"), []);
  const [override, setVals] = useState(null);
  const [result, setResult] = useState(null);
  const [simErr, setSimErr] = useState(null);

  const vals = override ?? ex.data?.features ?? null;
  useEffect(() => {
    if (!vals) return;
    const t = setTimeout(async () => {
      // previous loans is not a free input: it is exactly the loans repaid + defaulted
      const body = { ...vals, num_previous_loans: (vals.loans_repaid || 0) + (vals.loans_defaulted || 0) };
      try { setResult(await api.post("/me/credit/simulate", body)); setSimErr(null); } catch (e) { setSimErr(e); }
    }, 250);
    return () => clearTimeout(t);
  }, [vals]);

  if (ex.loading) return <Spinner label="Running the model" />;
  if (ex.error) return <ErrorBox error={ex.error} onRetry={ex.reload} />;
  const { features, explanation: e } = ex.data;
  const band = scoreBand(e.creditScore);
  const aprCurve = Array.from({ length: 21 }, (_, i) => ({ x: i * 50, y: aprFor(i * 50) / 100 }));

  return (
    <>
      <PageHeader title="How your credit score works" subtitle="Credloom replaces collateral with an explainable machine-learning score. Nothing here is hidden." />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card title="Your score" className="lg:col-span-1">
          <ScoreGauge score={e.creditScore} />
          <p className="mt-4 text-center text-sm text-zinc-400">Model estimates a <b className="text-white">{(e.riskRaw * 100).toFixed(1)}%</b> chance of default.<br />Score = (1 − P(default)) × 1000</p>
          <div className="mt-4 flex justify-center"><Badge className="border-zinc-700 text-zinc-300">{band.label}</Badge></div>
        </Card>

        <Card title="Inputs the model sees" subtitle="Derived from your wallet and Credloom history" className="lg:col-span-2">
          <dl className="grid grid-cols-2 gap-4 sm:grid-cols-3">
            {e.sensitivity.map((s) => (
              <div key={s.feature} className="rounded-xl bg-zinc-900 p-3">
                <dt className="text-xs text-zinc-400">{s.label}</dt>
                <dd className="mt-1 text-lg font-semibold tabular-nums">{Number(s.value).toLocaleString(undefined, { maximumFractionDigits: 3 })}</dd>
                <dd className="mt-1 text-[11px] text-zinc-500">{s.potentialLoss > 0 ? `worst case costs ${s.potentialLoss} pts` : "already at its best"}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-4 text-xs text-zinc-500">Repaid and defaulted loans are read from the ReputationRegistry contract and fed to the model as inputs. <Link href="/project/model" className="text-blue-300 underline">See how the model was built and tested</Link>.</p>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Feature importance" subtitle="How much each input drives the Gradient Boosting model overall">
          <BarList items={e.importances.map((i) => ({ label: i.label, value: i.importance * 100 }))} format={(v) => `${v.toFixed(1)}%`} />
        </Card>
        <Card title="Score → interest rate" subtitle="Dynamic APR: 25% at score 0 down to 5% at score 1000">
          <LineChart points={aprCurve} xLabel="score" yFormat={(v) => `${v.toFixed(0)}%`} color="#a78bfa" marker={e.creditScore} />
          <p className="mt-2 text-sm text-zinc-400">At {e.creditScore} your APR is <b className="text-white">{pct(aprFor(e.creditScore))}</b>.</p>
        </Card>
      </div>

      <Card className="mt-6" title="What moves your score" subtitle="Each chart changes ONE input while holding the others at your values. The dashed line is where you are.">
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {e.sweeps.map((s) => (
            <div key={s.feature}>
              <div className="mb-1 flex justify-between text-sm"><span className="text-zinc-200">{s.label}</span><span className="text-xs text-zinc-500">swing {s.swing} pts</span></div>
              <LineChart points={s.points.map((p) => ({ x: p.x, y: p.score }))} marker={Number(s.current)} yFormat={(v) => Math.round(v)} height={120} />
            </div>
          ))}
        </div>
      </Card>

      <Card className="mt-6" title="Score simulator" subtitle="Try hypothetical wallets and watch the AI score and APR respond live (calls the real model).">
        <div className="grid gap-8 lg:grid-cols-2">
          <div className="space-y-4">
            {vals && SLIDERS.map((s) => (
              <Field key={s.key} label={`${s.label}: ${vals[s.key]}`}>
                <input type="range" min={s.min} max={s.max} step={s.step} value={vals[s.key]} className="w-full accent-white"
                  onChange={(ev) => setVals({ ...vals, [s.key]: Number(ev.target.value) })} />
              </Field>
            ))}
            <button className="text-sm text-blue-300 hover:underline" onClick={() => setVals(null)}>Reset to my values</button>
            <ErrorBox error={simErr} />
          </div>
          <div>
            {result && (
              <>
                <ScoreGauge score={result.explanation.creditScore} />
                <div className="mt-4 grid grid-cols-3 gap-3 text-center text-sm">
                  <div className="rounded-xl bg-zinc-900 p-3"><div className="text-xs text-zinc-400">APR</div><div className="font-semibold">{pct(result.aprBps)}</div></div>
                  <div className="rounded-xl bg-zinc-900 p-3"><div className="text-xs text-zinc-400">Max loan</div><div className="font-semibold">{result.limits.max_loan_amount} ETH</div></div>
                  <div className="rounded-xl bg-zinc-900 p-3"><div className="text-xs text-zinc-400">vs. you</div><div className={`font-semibold ${result.explanation.creditScore >= e.creditScore ? "text-emerald-300" : "text-red-300"}`}>{result.explanation.creditScore - e.creditScore >= 0 ? "+" : ""}{result.explanation.creditScore - e.creditScore}</div></div>
                </div>
              </>
            )}
          </div>
        </div>
      </Card>
    </>
  );
}
