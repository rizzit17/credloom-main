"use client";
import Link from "next/link";
import { useAuth, dashboardFor } from "@/contexts/AuthContext";
import { Brain, Landmark, ShieldCheck, Award, Percent, Fingerprint, ArrowRight } from "lucide-react";

const PILLARS = [
  { icon: Brain, title: "AI credit score", text: "A monotonic Gradient Boosting model turns wallet behaviour and loan history into a 0–1000 score, with feature importances and a what-if simulator so nothing is a black box.", href: "/explorer" },
  { icon: Percent, title: "Risk-based pricing", text: "APR runs from 25% down to 5% as your score rises. Interest is simple interest computed by the contract and fixed at origination.", href: "/analytics" },
  { icon: Landmark, title: "Smart-contract escrow", text: "Lenders lock ETH in an offer with their own rules. The contract rejects any borrower below the minimum score or outside the APR band.", href: "/explorer" },
  { icon: ShieldCheck, title: "Decentralized insurance", text: "Insurers stake capital and earn premiums. Coverage is reserved per loan, so a default pays the lender automatically and no stake is over-promised.", href: "/signup?role=insurer" },
  { icon: Award, title: "On-chain reputation", text: "Every repayment and default is written to the ReputationRegistry. Reputation replaces collateral, and a default flags the wallet permanently.", href: "/signup?role=borrower" },
  { icon: Fingerprint, title: "Tiered verification", text: "Wallet, ENS and proof-of-humanity tiers raise limits and scores without ever putting documents on-chain.", href: "/signup?role=borrower" },
];

export default function Feature() {
  const { user } = useAuth();
  const target = (href) => (user && href.startsWith("/signup") ? dashboardFor(user.role) : href);
  return (
    <section className="bg-black py-24" aria-labelledby="features-title">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-3xl text-center">
          <h2 id="features-title" className="text-4xl font-bold tracking-tight text-white sm:text-5xl">Lending built on reputation, not collateral</h2>
          <p className="mt-5 text-lg text-zinc-400">Traditional DeFi demands 130–200% collateral. Credloom lets a wallet’s behaviour do that job, and shows you exactly how every step works on-chain.</p>
        </div>
        <ul className="mt-16 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {PILLARS.map((p) => (
            <li key={p.title}>
              <Link href={target(p.href)} className="group flex h-full flex-col rounded-2xl border border-zinc-800 bg-zinc-950/80 p-6 transition-colors hover:border-zinc-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-400">
                <span className="flex h-11 w-11 items-center justify-center rounded-xl bg-zinc-900 text-blue-300"><p.icon className="h-5 w-5" aria-hidden /></span>
                <h3 className="mt-4 text-lg font-semibold text-white">{p.title}</h3>
                <p className="mt-2 flex-1 text-sm leading-relaxed text-zinc-400">{p.text}</p>
                <span className="mt-4 inline-flex items-center gap-1 text-sm text-blue-300 group-hover:underline">{user && p.href.startsWith("/signup") ? "Open dashboard" : "Learn more"} <ArrowRight className="h-3.5 w-3.5" aria-hidden /></span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
