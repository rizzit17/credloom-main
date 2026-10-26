import { NextResponse } from 'next/server';

// Server-side proxy to the Credloom API (keeps the browser same-origin: no CORS, no exposed hosts).
const BACKEND = (process.env.BACKEND_API_URL || 'http://127.0.0.1:3001').replace(/\/$/, '');

async function forward(request, context) {
  const { path = [] } = await context.params;
  const url = new URL(request.url);
  const target = `${BACKEND}/${path.join('/')}${url.search}`;
  const headers = { 'Content-Type': 'application/json' };
  const auth = request.headers.get('authorization');
  if (auth) headers.Authorization = auth;

  let body;
  if (!['GET', 'HEAD'].includes(request.method)) {
    const text = await request.text();
    if (text) body = text;
  }
  try {
    const res = await fetch(target, { method: request.method, headers, body, cache: 'no-store' });
    const text = await res.text();
    let data;
    try { data = text ? JSON.parse(text) : {}; } catch { data = { detail: text.slice(0, 300) }; }
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ detail: 'Credloom API is unreachable. Is the backend running?', code: 'UPSTREAM_DOWN' }, { status: 503 });
  }
}

export { forward as GET, forward as POST, forward as PUT, forward as DELETE };
