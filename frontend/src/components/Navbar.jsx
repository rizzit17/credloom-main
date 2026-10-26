"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X, Shield, Boxes } from "lucide-react";
import { useAuth, dashboardFor } from "@/contexts/AuthContext";
import { useAsync } from "@/lib/hooks";
import { chainApi } from "@/lib/api";
import { cx } from "@/components/kit";

function ChainPill() {
  const { data, error, loading } = useAsync(() => chainApi.get("/system/info"), [], { poll: 4000 });
  const ok = !!data;
  const connecting = loading && !data;
  return (
    <Link href="/explorer" className="hidden items-center gap-2 rounded-full border border-zinc-800 px-3 py-1.5 text-xs text-zinc-300 hover:border-zinc-600 lg:flex" title={ok ? `${data.network} · chain ${data.chainId}` : "Blockchain node unreachable"}>
      <span className={cx("h-2 w-2 rounded-full", ok ? "animate-pulse bg-emerald-400" : connecting ? "bg-zinc-500" : "bg-red-500")} aria-hidden />
      <Boxes className="h-3.5 w-3.5" aria-hidden />
      {ok ? <span className="tabular-nums">Block #{data.blockNumber}</span> : <span>{connecting ? "Connecting…" : "Chain offline"}</span>}
    </Link>
  );
}

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const { user, role, logout } = useAuth();
  const path = usePathname();

  const links = [
    { href: "/", label: "Home" },
    { href: user ? dashboardFor(role) : "/signin", label: "Dashboard" },
    { href: "/explorer", label: "Explorer" },
    { href: "/analytics", label: "Analytics" },
  ];
  const active = (href) => (href === "/" ? path === "/" : path.startsWith(href) && href !== "/signin");

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-zinc-800 bg-black/90 backdrop-blur">
      <nav className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3 sm:px-6" aria-label="Main">
        <Link href="/" className="flex items-center gap-2 hover:opacity-80">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-white"><Shield className="h-5 w-5 text-black" aria-hidden /></span>
          <span className="text-xl font-bold tracking-tight text-white">Credloom</span>
        </Link>

        <div className="hidden items-center gap-6 md:flex">
          {links.map((l) => (
            <Link key={l.label} href={l.href} aria-current={active(l.href) ? "page" : undefined}
              className={cx("text-sm font-medium transition-colors hover:text-white", active(l.href) ? "text-white" : "text-zinc-400")}>
              {l.label}
            </Link>
          ))}
        </div>

        <div className="hidden items-center gap-3 md:flex">
          <ChainPill />
          {user ? (
            <>
              <span className="rounded-lg border border-zinc-800 px-3 py-1.5 text-sm text-white">
                {user.username} <span className="text-zinc-500">· {role}</span>
              </span>
              <button onClick={logout} className="px-2 py-1.5 text-sm text-zinc-400 hover:text-white">Sign out</button>
            </>
          ) : (
            <>
              <Link href="/signin" className="px-3 py-1.5 text-sm font-medium text-zinc-300 hover:text-white">Sign in</Link>
              <Link href="/signup" className="rounded-lg bg-white px-4 py-2 text-sm font-semibold text-black hover:bg-zinc-200">Get started</Link>
            </>
          )}
        </div>

        <button className="rounded-lg p-2 text-zinc-300 md:hidden" onClick={() => setOpen(!open)} aria-label="Toggle menu" aria-expanded={open}>
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </nav>

      {open && (
        <div className="border-t border-zinc-800 bg-black px-4 pb-4 md:hidden">
          {links.map((l) => (
            <Link key={l.label} href={l.href} onClick={() => setOpen(false)} className="block py-2.5 text-zinc-300">{l.label}</Link>
          ))}
          {user ? (
            <button onClick={() => { setOpen(false); logout(); }} className="py-2.5 text-zinc-400">Sign out ({user.username})</button>
          ) : (
            <Link href="/signup" onClick={() => setOpen(false)} className="mt-2 block rounded-lg bg-white py-2.5 text-center font-semibold text-black">Get started</Link>
          )}
        </div>
      )}
    </header>
  );
}
