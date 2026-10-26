"use client";
import { useState } from "react";
import { Check, Lock, ShieldCheck, Fingerprint, Globe } from "lucide-react";
import { Card, Btn, PageHeader, Spinner, ErrorBox, Field, inputCls, Badge, cx } from "@/components/kit";
import { useAsync } from "@/lib/hooks";
import { api } from "@/lib/api";
import { eth, pct } from "@/lib/format";

export default function Verification() {
  const { data: t, loading, error, reload } = useAsync(() => api.get("/me/tier-status"), []);
  const [ens, setEns] = useState("");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(null);
  const [msg, setMsg] = useState(null);
  const [err, setErr] = useState(null);

  if (loading) return <Spinner />;
  if (error) return <ErrorBox error={error} onRetry={reload} />;

  const act = async (kind) => {
    setBusy(kind); setErr(null); setMsg(null);
    try {
      const r = kind === "ens" ? await api.post("/me/verify/ens", { ens_name: ens }) : await api.post("/me/verify/passport", { passport_number: pass });
      setMsg(r.verified === false ? `Passport score ${r.score} is below the ${r.threshold} threshold. Try another ID.` : `${r.message}. New credit score: ${r.credit_score}.`);
      reload();
    } catch (e) { setErr(e); } finally { setBusy(null); }
  };

  const tiers = [
    { n: 1, icon: Globe, name: "Basic wallet", done: true, perk: "Starting limits", detail: "Your wallet address and on-chain activity only. No personal data." },
    { n: 2, icon: ShieldCheck, name: "ENS verified", done: t.tier >= 2, perk: "Higher score & 2.5× loan limit", detail: "Proves a persistent public identity without revealing documents." },
    { n: 3, icon: Fingerprint, name: "Passport verified", done: t.tier >= 3, perk: "Best rates & 5× loan limit", detail: "Proof-of-humanity (Gitcoin Passport style) for Sybil resistance." },
  ];

  return (
    <>
      <PageHeader title="Tiered verification" subtitle="Progressive trust without handing over your identity. Each tier is recorded as a hash, never as documents." />
      {msg && <div className="mb-4 rounded-xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-sm text-emerald-100" role="status">{msg}</div>}
      <ErrorBox error={err} />

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        {tiers.map((x) => (
          <div key={x.n} className={cx("rounded-2xl border p-5", x.done ? "border-emerald-500/40 bg-emerald-500/5" : "border-zinc-800 bg-zinc-950/80")}>
            <div className="flex items-center justify-between"><x.icon className="h-6 w-6 text-zinc-300" aria-hidden />{x.done ? <Badge className="border-emerald-500/40 text-emerald-300"><Check className="mr-1 h-3 w-3" />Verified</Badge> : x.n === t.tier + 1 ? <Badge className="border-blue-500/40 text-blue-300">Next</Badge> : <Badge><Lock className="mr-1 h-3 w-3" />Locked</Badge>}</div>
            <h2 className="mt-3 font-semibold">Tier {x.n}: {x.name}</h2>
            <p className="mt-1 text-sm text-zinc-400">{x.detail}</p>
            <p className="mt-3 text-sm text-blue-300">{x.perk}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card title="Your current benefits">
          <dl className="space-y-2 text-sm">
            {[["Tier", `${t.tier} · ${t.tier_name}`], ["Credit score", t.credit_score], ["Your APR", pct(t.apr_bps)], ["Max single loan", eth(t.max_loan_amount, 3)], ["Max duration", `${t.max_duration_days} days`], ["Total credit line", eth(t.max_borrow_amount, 3)]].map(([k, v]) => (
              <div key={k} className="flex justify-between"><dt className="text-zinc-400">{k}</dt><dd className="font-medium tabular-nums">{v}</dd></div>
            ))}
          </dl>
        </Card>

        {t.tier === 1 && (
          <Card title="Tier 2: verify an ENS name" subtitle="Format is validated and recorded. A production build resolves the name on mainnet.">
            <Field label="ENS name" hint="e.g. alice.eth"><input className={inputCls} value={ens} onChange={(e) => setEns(e.target.value)} placeholder="yourname.eth" /></Field>
            <Btn className="mt-4" loading={busy === "ens"} disabled={!ens.trim()} onClick={() => act("ens")}>Verify ENS</Btn>
          </Card>
        )}
        {t.tier === 2 && (
          <Card title="Tier 3: proof of humanity" subtitle={`Simulated Gitcoin Passport. A deterministic score is derived from your ID and must reach ${t.tier3.threshold}.`}>
            <Field label="Passport ID"><input className={inputCls} value={pass} onChange={(e) => setPass(e.target.value)} placeholder="any ID, e.g. my-passport-01" /></Field>
            <Btn className="mt-4" loading={busy === "pass"} disabled={pass.trim().length < 4} onClick={() => act("pass")}>Verify passport</Btn>
          </Card>
        )}
        {t.tier === 3 && <Card title="Fully verified"><p className="text-sm text-zinc-300">You have the highest tier. Keep repaying on time to grow your on-chain reputation.</p></Card>}
      </div>
    </>
  );
}
