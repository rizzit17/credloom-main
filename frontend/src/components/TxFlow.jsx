"use client";
/**
 * Transaction visualizer. Wrap any blockchain-writing API call in `runTx` and
 * the user watches it travel through the stack, then sees the real receipt:
 * block, hash, gas, fee and every decoded smart-contract event.
 */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { Check, Loader2, X, Brain, KeyRound, Radio, Boxes, Database, ShieldCheck, ExternalLink } from 'lucide-react';
import { Btn, TxLink, Address, cx } from './kit';
import { EVENT_INFO, describeEvent, toneClass, prettyArg } from '@/lib/events';
import { explainError } from '@/lib/api';
import { when } from '@/lib/format';

const TxCtx = createContext(null);
export const useTx = () => useContext(TxCtx);

const STAGES = [
  { id: 'auth', icon: ShieldCheck, label: 'Request authorised', detail: 'JWT verified, role and ownership checked' },
  { id: 'ai', icon: Brain, label: 'AI credit assessment', detail: 'Gradient Boosting model scores the wallet', optional: true },
  { id: 'sign', icon: KeyRound, label: 'Transaction signed', detail: 'Built, gas-estimated and signed with the custodial key' },
  { id: 'send', icon: Radio, label: 'Broadcast to the network', detail: 'Sent to the Hardhat EVM node (chain 31337)' },
  { id: 'mine', icon: Boxes, label: 'Mined into a block', detail: 'Smart contracts execute and emit events' },
  { id: 'index', icon: Database, label: 'Indexed off-chain', detail: 'Database updated from the confirmed receipt' },
];

export function TxProvider({ children }) {
  const [job, setJob] = useState(null); // { title, status, stage, result, error, useAI }
  const timer = useRef(null);

  const stop = () => { if (timer.current) clearInterval(timer.current); };
  useEffect(() => stop, []);

  const runTx = useCallback(async ({ title, action, ai = false }) => {
    stop();
    const stages = STAGES.filter((s) => !s.optional || ai);
    setJob({ title, status: 'running', stage: 0, stages });
    // Visual pacing while the single HTTP call is in flight (never passes the last "mine" stage)
    let i = 0;
    timer.current = setInterval(() => {
      i = Math.min(i + 1, stages.length - 2);
      setJob((j) => (j && j.status === 'running' ? { ...j, stage: i } : j));
    }, 650);
    try {
      const result = await action();
      stop();
      // brief completion animation so the final stages are visible
      setJob((j) => ({ ...j, stage: stages.length - 1 }));
      await new Promise((r) => setTimeout(r, 450));
      setJob((j) => ({ ...j, status: 'success', stage: stages.length, result }));
      return result;
    } catch (error) {
      stop();
      setJob((j) => ({ ...j, status: 'error', error }));
      throw error;
    }
  }, []);

  const close = () => { stop(); setJob(null); };

  return (
    <TxCtx.Provider value={{ runTx }}>
      {children}
      {job && <TxModal job={job} onClose={close} />}
    </TxCtx.Provider>
  );
}

function TxModal({ job, onClose }) {
  const { status, stage, stages, result, error, title } = job;
  const tx = result?.tx;
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && status !== 'running' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [status, onClose]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm" role="dialog" aria-modal="true" aria-label={title}>
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-zinc-700 bg-zinc-950 shadow-2xl">
        <div className="flex items-center justify-between border-b border-zinc-800 px-6 py-4">
          <div>
            <p className="text-xs uppercase tracking-wider text-zinc-500">On-chain transaction</p>
            <h2 className="text-lg font-semibold text-white">{title}</h2>
          </div>
          {status !== 'running' && (
            <button onClick={onClose} aria-label="Close" className="rounded-lg p-2 text-zinc-400 hover:bg-zinc-900 hover:text-white"><X className="h-5 w-5" /></button>
          )}
        </div>

        <div className="grid gap-6 p-6 md:grid-cols-[260px_1fr]">
          {/* pipeline */}
          <ol className="space-y-1">
            {stages.map((s, idx) => {
              const done = status === 'success' || idx < stage;
              const active = status === 'running' && idx === stage;
              const failed = status === 'error' && idx === Math.min(stage, stages.length - 1);
              const Icon = s.icon;
              return (
                <li key={s.id} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <div className={cx('flex h-8 w-8 items-center justify-center rounded-full border', done && 'border-emerald-500 bg-emerald-500/15 text-emerald-300', active && 'border-blue-400 bg-blue-500/15 text-blue-300', failed && 'border-red-500 bg-red-500/15 text-red-300', !done && !active && !failed && 'border-zinc-700 text-zinc-600')}>
                      {done ? <Check className="h-4 w-4" /> : failed ? <X className="h-4 w-4" /> : active ? <Loader2 className="h-4 w-4 animate-spin" /> : <Icon className="h-4 w-4" />}
                    </div>
                    {idx < stages.length - 1 && <div className={cx('my-1 h-6 w-px', done ? 'bg-emerald-500/50' : 'bg-zinc-800')} />}
                  </div>
                  <div className="pb-4">
                    <p className={cx('text-sm font-medium', done || active ? 'text-white' : 'text-zinc-500')}>{s.label}</p>
                    <p className="text-xs text-zinc-500">{s.detail}</p>
                  </div>
                </li>
              );
            })}
          </ol>

          {/* right-hand panel */}
          <div className="min-w-0 space-y-4">
            {status === 'running' && (
              <div className="rounded-xl border border-zinc-800 p-5 text-sm text-zinc-400" role="status">
                <p className="font-medium text-zinc-200">Working…</p>
                <p className="mt-1">Your request is travelling Frontend → API → Blockchain service → Smart contracts. This usually takes a second or two on the local chain.</p>
              </div>
            )}

            {status === 'error' && (
              <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-5 text-sm" role="alert">
                <p className="font-semibold text-red-200">Transaction failed</p>
                <p className="mt-1 text-red-100">{explainError(error)}</p>
                {error?.message && error.message !== explainError(error) && <p className="mt-2 font-mono text-xs text-red-300">revert: {error.message}</p>}
                <p className="mt-3 text-xs text-zinc-400">Nothing was changed on-chain: the call reverted before being mined, so no funds moved.</p>
                <Btn variant="secondary" className="mt-4" onClick={onClose}>Close</Btn>
              </div>
            )}

            {status === 'success' && (
              <>
                {tx ? (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4">
                    <div className="mb-3 flex items-center gap-2 text-emerald-300"><Check className="h-4 w-4" /> <span className="font-semibold">Confirmed in block #{tx.blockNumber}</span></div>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                      <Row k="Tx hash"><TxLink hash={tx.txHash} /></Row>
                      <Row k="Status"><span className="text-emerald-300">{tx.status}</span></Row>
                      <Row k="From"><Address value={tx.from} /></Row>
                      <Row k="To"><span className="text-zinc-200">{tx.toContract || '—'}</span></Row>
                      <Row k="Gas used">{tx.gasUsed.toLocaleString()} / {tx.gasLimit.toLocaleString()}</Row>
                      <Row k="Fee">{Number(tx.feeEth).toFixed(6)} ETH @ {Number(tx.gasPriceGwei).toFixed(2)} gwei</Row>
                      <Row k="Value">{tx.valueEth} ETH</Row>
                      <Row k="Mined">{when(tx.timestamp)}</Row>
                    </dl>
                  </div>
                ) : (
                  <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-4 text-emerald-200">Completed.</div>
                )}

                {tx?.events?.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-zinc-400">Smart-contract events emitted ({tx.events.length})</p>
                    <ul className="space-y-2">
                      {tx.events.map((e) => {
                        const info = EVENT_INFO[e.event];
                        return (
                          <li key={e.logIndex} className={cx('rounded-lg border p-3', toneClass[info?.tone || 'zinc'])}>
                            <div className="flex items-center justify-between text-sm font-medium">
                              <span>{info?.title || e.event}</span>
                              <span className="font-mono text-[11px] opacity-70">{e.contract}.{e.event}</span>
                            </div>
                            <p className="mt-1 text-xs text-zinc-300">{describeEvent(e)}</p>
                            <details className="mt-2 text-[11px] text-zinc-400">
                              <summary className="cursor-pointer">Raw event data</summary>
                              <div className="mt-1 grid grid-cols-[auto_1fr] gap-x-3 font-mono">
                                {Object.entries(e.args).map(([k, v]) => (<span key={k} className="contents"><span className="text-zinc-500">{k}</span><span className="break-all">{prettyArg(k, v)}</span></span>))}
                              </div>
                            </details>
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                )}

                <div className="flex flex-wrap justify-end gap-3 pt-2">
                  {tx && <Link href={`/explorer/tx/${tx.txHash}`} onClick={onClose} className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-700 px-4 py-2.5 text-sm text-white hover:bg-zinc-900">Inspect in explorer <ExternalLink className="h-3.5 w-3.5" /></Link>}
                  <Btn onClick={onClose}>Done</Btn>
                </div>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ k, children }) {
  return (<div className="min-w-0"><dt className="text-zinc-500">{k}</dt><dd className="truncate text-zinc-200">{children}</dd></div>);
}
