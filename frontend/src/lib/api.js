/** Single API client. Browser -> Next proxy -> Credloom API / read-only chain proxy. */
export class ApiError extends Error {
  constructor(message, status, code, data) {
    super(message);
    this.status = status;
    this.code = code;
    this.data = data;
  }
}

const TOKEN_KEY = 'credloom_token';
export const tokenStore = {
  get: () => (typeof window === 'undefined' ? null : localStorage.getItem(TOKEN_KEY)),
  set: (t) => localStorage.setItem(TOKEN_KEY, t),
  clear: () => localStorage.removeItem(TOKEN_KEY),
};

async function request(base, method, path, body) {
  const headers = { 'Content-Type': 'application/json' };
  const token = tokenStore.get();
  if (token && base === '/api/proxy') headers.Authorization = `Bearer ${token}`;
  let res;
  try {
    res = await fetch(`${base}${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined, cache: 'no-store' });
  } catch {
    throw new ApiError('Network error. Check that the services are running.', 0, 'NETWORK');
  }
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    if (res.status === 401 && typeof window !== 'undefined') window.dispatchEvent(new Event('credloom:unauthorized'));
    const detail = data && (typeof data.detail === 'string' ? data.detail : data.detail?.message);
    throw new ApiError(detail || `Request failed (${res.status})`, res.status, data?.code || data?.detail?.code, data);
  }
  return data;
}

export const api = {
  get: (p) => request('/api/proxy', 'GET', p),
  post: (p, b = {}) => request('/api/proxy', 'POST', p, b),
};
export const chainApi = { get: (p) => request('/api/chain', 'GET', p) };

// Human-friendly explanations for smart-contract reverts and API codes
export const ERROR_HELP = {
  CreditScoreTooLow: 'The smart contract rejected this loan: your attested credit score is below the lender’s minimum.',
  AprOutOfRange: 'The APR is outside the band this lender allows.',
  BorrowerFlagged: 'Your wallet is permanently flagged in the on-chain ReputationRegistry after a default.',
  OfferInactive: 'This offer was already taken or withdrawn.',
  InsufficientFreeBalance: 'The insurer does not have enough unreserved capital to back this loan.',
  NotAccepting: 'This insurer is not currently writing new policies.',
  DeadlineNotPassed: 'The loan deadline (plus grace period) has not passed yet, so it cannot be defaulted.',
  Overpayment: 'That is more than the outstanding balance.',
  InvalidState: 'The loan is no longer in a state that allows this action.',
};
export const explainError = (e) => ERROR_HELP[e?.message] || e?.message || 'Something went wrong';
