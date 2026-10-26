"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Shield, Eye, EyeOff } from "lucide-react";
import { useAuth, dashboardFor } from "@/contexts/AuthContext";
import { Btn, ErrorBox, Field, inputCls, cx } from "@/components/kit";

const ROLES = [
  { id: "borrower", title: "Borrower", text: "Get an AI credit score and borrow without collateral" },
  { id: "lender", title: "Lender", text: "Escrow capital in offers and earn interest" },
  { id: "insurer", title: "Insurer", text: "Underwrite defaults and earn premiums" },
];



function useRedirectIfSignedIn() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const next = useSearchParams().get("next");
  useEffect(() => {
    if (!loading && user) router.replace(next && next.startsWith("/") ? next : dashboardFor(user.role));
  }, [loading, user, router, next]);
  return loading || !!user; // true while we are about to redirect
}

function Frame({ title, subtitle, children }) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4 pb-12 pt-28">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-white"><Shield className="h-6 w-6 text-black" aria-hidden /></span>
          <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
          <p className="mt-2 text-zinc-400">{subtitle}</p>
        </div>
        <div className="rounded-2xl border border-zinc-800 bg-zinc-950/80 p-6">{children}</div>
      </div>
    </div>
  );
}

function Password({ value, onChange, id, autoComplete }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input id={id} type={show ? "text" : "password"} value={value} onChange={onChange} className={cx(inputCls, "pr-10")} autoComplete={autoComplete} required />
      <button type="button" onClick={() => setShow(!show)} aria-label={show ? "Hide password" : "Show password"} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-zinc-500 hover:text-white">
        {show ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

export function SignInForm() {
  const { login } = useAuth();
  const router = useRouter();
  const redirecting = useRedirectIfSignedIn();
  const next = useSearchParams().get("next");
  const [f, setF] = useState({ username: "", password: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const me = await login(f.username.trim(), f.password);
      router.push(next && next.startsWith("/") ? next : dashboardFor(me.role));
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  if (redirecting) return <div className="pt-32 text-center text-zinc-400" role="status">Loading…</div>;
  return (
    <Frame title="Welcome back" subtitle="Sign in to your Credloom account">
      <form onSubmit={submit} className="space-y-4">
        <ErrorBox error={error} />
        <Field label="Username"><input className={inputCls} value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoComplete="username" required /></Field>
        <Field label="Password"><Password id="pw" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="current-password" /></Field>
        <Btn type="submit" loading={busy} className="w-full">Sign in</Btn>
      </form>
      <p className="mt-4 text-center text-sm text-zinc-400">New here? <Link href="/signup" className="text-white underline">Create an account</Link></p>

    </Frame>
  );
}

export function SignUpForm() {
  const { register } = useAuth();
  const router = useRouter();
  const redirecting = useRedirectIfSignedIn();
  const initial = useSearchParams().get("role");
  const [role, setRole] = useState(ROLES.some((r) => r.id === initial) ? initial : "borrower");
  const [f, setF] = useState({ username: "", password: "", confirm: "" });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const mismatch = f.confirm && f.confirm !== f.password;

  const submit = async (e) => {
    e.preventDefault();
    if (f.password !== f.confirm) return setError(new Error("Passwords do not match"));
    setBusy(true); setError(null);
    try {
      const me = await register({ username: f.username.trim(), password: f.password, role });
      router.push(dashboardFor(me.role));
    } catch (err) { setError(err); } finally { setBusy(false); }
  };

  if (redirecting) return <div className="pt-32 text-center text-zinc-400" role="status">Loading…</div>;
  return (
    <Frame title="Create your account" subtitle="A secure wallet is created for you automatically">
      <form onSubmit={submit} className="space-y-4">
        <ErrorBox error={error} />
        <fieldset>
          <legend className="mb-2 text-sm font-medium text-zinc-200">I want to…</legend>
          <div className="grid gap-2">
            {ROLES.map((r) => (
              <label key={r.id} className={cx("flex cursor-pointer items-start gap-3 rounded-xl border p-3", role === r.id ? "border-white bg-zinc-900" : "border-zinc-800 hover:border-zinc-600")}>
                <input type="radio" name="role" value={r.id} checked={role === r.id} onChange={() => setRole(r.id)} className="mt-1" />
                <span><span className="block text-sm font-medium text-white">{r.title}</span><span className="block text-xs text-zinc-400">{r.text}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
        <Field label="Username" hint="3–32 letters, numbers, . _ -"><input className={inputCls} value={f.username} onChange={(e) => setF({ ...f, username: e.target.value })} autoComplete="username" required minLength={3} maxLength={32} /></Field>
        <Field label="Password" hint="At least 8 characters"><Password value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} autoComplete="new-password" /></Field>
        <Field label="Confirm password" error={mismatch ? "Passwords do not match" : null}><Password value={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.value })} autoComplete="new-password" /></Field>
        <Btn type="submit" loading={busy} className="w-full">Create account</Btn>
      </form>
      <p className="mt-4 text-center text-sm text-zinc-400">Already registered? <Link href="/signin" className="text-white underline">Sign in</Link></p>
    </Frame>
  );
}
