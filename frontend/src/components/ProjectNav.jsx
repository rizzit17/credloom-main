"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ArrowLeft, BookOpenText } from "lucide-react";
import { useAuth, dashboardFor } from "@/contexts/AuthContext";
import { cx } from "./kit";

const TABS = [
  { href: "/project", label: "Overview" },
  { href: "/project/architecture", label: "Architecture" },
  { href: "/project/model", label: "AI model" },
  { href: "/project/demo", label: "Live demo controls" },
];

/** Header for the project / documentation area, visually distinct from the product navbar. */
export default function ProjectNav() {
  const path = usePathname();
  const { user } = useAuth();
  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur">
      <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
        <Link href={user ? dashboardFor(user.role) : "/"} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-zinc-700 px-3 py-1.5 text-sm text-zinc-200 hover:bg-zinc-900">
          <ArrowLeft className="h-4 w-4" aria-hidden /> <span className="hidden sm:inline">Back to app</span><span className="sm:hidden">App</span>
        </Link>
        <span className="hidden shrink-0 items-center gap-2 text-sm font-semibold text-white md:flex"><BookOpenText className="h-4 w-4 text-blue-300" aria-hidden />Project documentation</span>
        <nav className="-mx-1 flex min-w-0 flex-1 items-center gap-1 overflow-x-auto" aria-label="Project sections">
          {TABS.map((t) => {
            const on = t.href === "/project" ? path === "/project" : path.startsWith(t.href);
            return (
              <Link key={t.href} href={t.href} aria-current={on ? "page" : undefined}
                className={cx("whitespace-nowrap rounded-lg px-3 py-1.5 text-sm transition-colors", on ? "bg-zinc-800 text-white" : "text-zinc-400 hover:text-white")}>
                {t.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
