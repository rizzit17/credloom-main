/** HTTP clients for the blockchain service (FastAPI) and the AI risk service. */
const config = require('../config');
const { HttpError } = require('../lib/http');

async function request(base, method, path, body, headers = {}, timeoutMs = 45000, label = 'service') {
  let res;
  try {
    res = await fetch(base + path, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    throw new HttpError(503, `${label} is unreachable`, 'UPSTREAM_DOWN');
  }
  let data = null;
  try { data = await res.json(); } catch { /* non-json */ }
  if (!res.ok) {
    const d = data && data.detail;
    const message = (d && (d.message || (typeof d === 'string' ? d : null))) || `${label} error (${res.status})`;
    const code = (d && d.code) || 'UPSTREAM_ERROR';
    // 4xx from the chain = user-facing revert; keep it 400, anything else bubbles as 502
    throw new HttpError(res.status >= 400 && res.status < 500 ? res.status : 502, message, code);
  }
  return data;
}

const chain = {
  get: (path) => request(config.chainServiceUrl, 'GET', path, undefined, {}, 20000, 'Blockchain service'),
  post: (path, body) =>
    request(config.chainServiceUrl, 'POST', path, body, config.chainServiceKey ? { 'X-Service-Key': config.chainServiceKey } : {}, 60000, 'Blockchain service'),
  async alive() {
    try { const h = await this.get('/health'); return !!h.nodeConnected; } catch { return false; }
  },
};

const ml = {
  post: (path, body) => request(config.mlServiceUrl, 'POST', path, body, {}, 8000, 'AI risk service'),
  get: (path) => request(config.mlServiceUrl, 'GET', path, undefined, {}, 8000, 'AI risk service'),
};

module.exports = { chain, ml };
