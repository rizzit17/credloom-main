"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Boxes, Brain, Network, PlayCircle, KeyRound, Users } from "lucide-react";
import { Card, PageHeader, ErrorBox, Badge } from "@/components/kit";
import { useAuth, dashboardFor } from "@/contexts/AuthContext";
import { useAsync } from "@/lib/hooks";
import { api } from "@/lib/api";

const TEAM = [["Sarthak", "23BCI0139"], ["Kritika Varyani", "23BCI0157"], ["Rishit Chaudhary", "23BCT0157"]];

const SECTIONS = [
  { href: "/project/architecture", icon: Network, title: "Architecture", text: "System layers, the life of a loan, the four smart contracts, security properties and honest limitations." },
  { href: "/project/model", icon: Brain, title: "AI model card", text: "How the credit score is produced, the dataset, evaluation metrics, real-data benchmark and caveats." },
  { href: "/project/demo", icon: PlayCircle, title: "Live demo controls", text: "Fast-forward the chain clock to show deadlines, defaults and insurance payouts, plus a suggested walkthrough." },
  { href: "/explorer", icon: Boxes, title: "Blockchain explorer", text: "Every block, transaction and decoded contract event behind the app." },
];

const ACCOUNTS = [
  ["Borrowers", [["borrower_raj", "Tier 3, strong history"], ["borrower_meera", "Active insured loan"], ["borrower_dev", "New user, low score"], ["borrower_vik", "Defaulted and flagged"]]],
  ["Lenders", [["lender_alice", "Open offers + funded loan"], ["lender_bob", "Open offers + a default"]]],
  ["Insurers", [["insurer_zenith", "Active policy"], ["insurer_atlas", "Paid a claim"]]],
];

export default function ProjectHub() {
  const { login } = useAuth();
  const router = useRouter();
  const health = useAsync(() => api.get("/health"), [], { poll: 8000 });
  const [busy, setBusy] = useState(null);
  const [error, setError] = useState(null);

  const signInAs = async (username) => {
    setBusy(username); setError(null);
    try {
      const me = await login(username, "Demo@1234");
      router.push(dashboardFor(me.role));
    } catch (e) { setError(e); } finally { setBusy(null); }
  };

  const h = health.data;
  const svc = [["API", !!h], ["Blockchain service", h?.chainService], ["AI service", h?.mlService], ["Database", h?.db]];

  return (
    <div className="mx-auto max-w-5xl px-4 pb-20 pt-24 sm:px-6">
      <PageHeader title="Credloom: project documentation" subtitle="Decentralized micro-lending using blockchain, AI risk assessment and smart contracts (BCSE497J Project, VIT)" />

      <div className="grid gap-4 md:grid-cols-2">
        {SECTIONS.map((s) => (
          <Link key={s.href} href={s.href} className="group rounded-2xl border border-zinc-800 bg-zinc-900/40 p-5 transition-colors hover:border-zinc-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
            <s.icon className="h-6 w-6 text-blue-300" aria-hidden />
            <h2 className="mt-3 font-semibold text-white group-hover:underline">{s.title}</h2>
            <p className="mt-1 text-sm text-zinc-400">{s.text}</p>
          </Link>
        ))}
      </div>

      <Card className="mt-6" title="Demo accounts" subtitle="Sign in with one click. Every account uses the password Demo@1234." action={<KeyRound className="h-5 w-5 text-zinc-500" aria-hidden />}>
        <ErrorBox error={error} />
        <div className="grid gap-5 md:grid-cols-3">
          {ACCOUNTS.map(([group, users]) => (
            <div key={group}>
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-500">{group}</p>
              <ul className="space-y-2">
                {users.map(([u, d]) => (
                  <li key={u}>
                    <button onClick={() => signInAs(u)} disabled={!!busy} className="w-full rounded-xl border border-zinc-800 px-3 py-2 text-left transition-colors hover:border-zinc-600 disabled:opacity-60">
                      <span className="block text-sm font-medium text-white">{busy === u ? "Signing in…" : u}</span>
                      <span className="block text-xs text-zinc-500">{d}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="mt-4 text-xs text-zinc-500">Data is created by <code className="text-zinc-300">./scripts/dev.sh reset</code>. Run it before a presentation for a clean start.</p>
      </Card>

      <div className="mt-6 grid gap-6 md:grid-cols-2">
        <Card title="Team" action={<Users className="h-5 w-5 text-zinc-500" aria-hidden />}>
          <ul className="space-y-1.5 text-sm">
            {TEAM.map(([n, id]) => (<li key={id} className="flex justify-between"><span className="text-zinc-200">{n}</span><span className="font-mono text-xs text-zinc-500">{id}</span></li>))}
          </ul>
          <p className="mt-3 text-sm text-zinc-400">Faculty guide: <span className="text-zinc-200">Prof. Kaushik Hariharan G</span></p>
        </Card>
        <Card title="System status" subtitle="Services behind this running instance">
          <ul className="space-y-2 text-sm">
            {svc.map(([k, ok]) => (
              <li key={k} className="flex items-center justify-between"><span className="text-zinc-300">{k}</span>
                {health.loading ? <Badge>checking</Badge> : <Badge className={ok ? "border-emerald-500/40 text-emerald-300" : "border-red-500/40 text-red-300"}>{typeof ok === "string" ? ok : ok ? "online" : "offline"}</Badge>}</li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
