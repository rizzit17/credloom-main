"use client";
import { useCallback, useEffect, useRef, useState } from 'react';

/** Loads data with loading/error state; `reload()` re-runs; optional polling. */
export function useAsync(fn, deps = [], { poll } = {}) {
  const [state, setState] = useState({ data: null, error: null, loading: true, updatedAt: 0 });
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const alive = useRef(true);

  const run = useCallback(async (silent = false) => {
    if (!silent) setState((s) => ({ ...s, loading: true }));
    try {
      const data = await fnRef.current();
      if (alive.current) setState({ data, error: null, loading: false, updatedAt: Date.now() });
    } catch (error) {
      if (alive.current) setState((s) => ({ ...s, error, loading: false }));
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    run();
    let t;
    if (poll) t = setInterval(() => run(true), poll);
    return () => { alive.current = false; if (t) clearInterval(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { ...state, reload: () => run(true), reloadWithSpinner: () => run(false) };
}
