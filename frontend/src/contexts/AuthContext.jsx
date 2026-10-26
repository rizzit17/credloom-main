"use client";

import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { api, tokenStore } from '@/lib/api';

const AuthContext = createContext(null);
export const dashboardFor = (role) => ({ borrower: '/borrower', lender: '/lender', insurer: '/insurer' }[role] || '/signin');

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null); // { username, wallet, role, user_id }
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const logout = useCallback(() => {
    tokenStore.clear();
    setUser(null);
    router.push('/');
  }, [router]);

  // Restore session from the server (role + wallet come from the API, not localStorage)
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!tokenStore.get()) { setLoading(false); return; }
      try {
        const me = await api.get('/auth/me');
        if (alive) setUser(me);
      } catch (e) {
        if (e.status === 401) tokenStore.clear();
      } finally {
        if (alive) setLoading(false);
      }
    })();
    const onUnauthorized = () => { tokenStore.clear(); setUser(null); };
    window.addEventListener('credloom:unauthorized', onUnauthorized);
    return () => { alive = false; window.removeEventListener('credloom:unauthorized', onUnauthorized); };
  }, []);

  const login = useCallback(async (username, password) => {
    const r = await api.post('/auth/login', { username, password });
    tokenStore.set(r.token);
    const me = { user_id: r.user_id, username: r.username, wallet: r.wallet, role: r.role };
    setUser(me);
    return me;
  }, []);

  const register = useCallback(async (payload) => {
    const r = await api.post('/auth/register', payload);
    tokenStore.set(r.token);
    const me = { user_id: r.user_id, username: r.username, wallet: r.wallet, role: r.role };
    setUser(me);
    return me;
  }, []);

  const value = { user, role: user?.role || null, loading, isAuthenticated: !!user, login, register, logout };
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
