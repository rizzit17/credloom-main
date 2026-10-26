import { NextResponse } from 'next/server';

// READ-ONLY proxy to the blockchain service (explorer data is public on-chain data).
// Writes never go through here: they are signed server-side by the Credloom API.
const CHAIN = (process.env.BLOCKCHAIN_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '');
const ALLOWED = /^(system|stats|offers|loans|explorer|insurers?|borrower|balance|health|wallet|demo\/time)(\/|$)/;

export async function GET(request, context) {
  const { path = [] } = await context.params;
  const joined = path.join('/');
  if (!ALLOWED.test(joined)) return NextResponse.json({ detail: 'Not found' }, { status: 404 });
  const url = new URL(request.url);
  try {
    const res = await fetch(`${CHAIN}/${joined}${url.search}`, { cache: 'no-store' });
    const data = await res.json().catch(() => ({}));
    return NextResponse.json(data, { status: res.status });
  } catch {
    return NextResponse.json({ detail: 'Blockchain service is unreachable', code: 'NODE_DOWN' }, { status: 503 });
  }
}
