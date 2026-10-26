"use client";
/** Role dashboards: auth + role guard, side navigation, consistent page frame. */
import { useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, Store, Brain, ShieldCheck, Wallet, PlusCircle, Landmark, Umbrella, ScrollText } from "lucide-react";
import { useAuth, dashboardFor } from "@/contexts/AuthContext";
import { Spinner, cx } from "./kit";
import { Address } from "./kit";
import { useAsync } from "@/lib/hooks";
import { api } from "@/lib/api";
import { eth } from "@/lib/format";

const NAV = {
  borrower: [
    { href: "/borrower", label: "Overview", icon: LayoutDashboard },
    { href: "/borrower/marketplace", label: "Marketplace", icon: Store },
    { href: "/borrower/credit", label: "AI credit score", icon: Brain },
    { href: "/borrower/verification", label: "Verification", icon: ShieldCheck },
    { href: "/borrower/activity", label: "Activity", icon: ScrollText },
  ],
  lender: [
    { href: "/lender", label: "Overview", icon: LayoutDashboard },
    { href: "/lender/escrow", label: "New offer", icon: PlusCircle },
    { href: "/lender/activity", label: "Activity", icon: ScrollText },
  ],
  insurer: [
    { href: "/insurer", label: "Overview", icon: Umbrella },
    { href: "/insurer/policies", label: "Policies & claims", icon: Landmark },
    { href: "/insurer/activity", label: "Activity", icon: ScrollText },
  ],
};

export default function AppShell({ role, children }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const path = usePathname();
  const bal = useAsync(() => (user ? api.get("/me/balance") : Promise.resolve(null)), [user?.wallet], { poll: 6000 });

  useEffect(() => {
    if (loading) return;
    if (!user) router.replace(`/signin?next=${encodeURIComponent(path)}`);
    else if (user.role !== role) router.replace(dashboardFor(user.role));
  }, [loading, user, role, router, path]);

  if (loading || !user || user.role !== role) return <div className="pt-24"><Spinner label="Loading your workspace" /></div>;

  return (
    <div className="mx-auto flex max-w-7xl gap-8 px-4 pb-16 pt-24 sm:px-6">
      <aside className="hidden w-56 shrink-0 lg:block" aria-label="Section navigation">
        <div className="sticky top-24 space-y-6">
          <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-4">
            <p className="text-xs uppercase tracking-wider text-zinc-500">{role}</p>
            <p className="mt-1 font-semibold text-white">{user.username}</p>
            <div className="mt-2"><Address value={user.wallet} /></div>
            <div className="mt-3 flex items-center gap-2 border-t border-zinc-800 pt-3 text-sm text-zinc-300">
              <Wallet className="h-4 w-4 text-zinc-500" aria-hidden />
              <span className="tabular-nums">{bal.data ? eth(bal.data.balanceEth, 3) : "…"}</span>
            </div>
          </div>
          <nav className="space-y-1">
            {NAV[role].map((n) => {
              const on = n.href === `/${role}` ? path === n.href : path.startsWith(n.href);
              return (
                <Link key={n.href} href={n.href} aria-current={on ? "page" : undefined}
                  className={cx("flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors", on ? "bg-zinc-900 text-white" : "text-zinc-400 hover:bg-zinc-900/60 hover:text-white")}>
                  <n.icon className="h-4 w-4" aria-hidden /> {n.label}
                </Link>
              );
            })}
          </nav>
        </div>
      </aside>

      <div className="min-w-0 flex-1">
        {/* mobile section nav */}
        <nav className="-mx-1 mb-6 flex gap-2 overflow-x-auto pb-1 lg:hidden" aria-label="Section navigation">
          {NAV[role].map((n) => (
            <Link key={n.href} href={n.href} className={cx("whitespace-nowrap rounded-full border px-3 py-1.5 text-sm", path === n.href ? "border-white text-white" : "border-zinc-800 text-zinc-400")}>{n.label}</Link>
          ))}
        </nav>
        {children}
      </div>
    </div>
  );
}
