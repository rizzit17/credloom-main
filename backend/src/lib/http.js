class HttpError extends Error {
  constructor(status, message, code, extra) {
    super(message);
    this.status = status;
    this.code = code || null;
    this.extra = extra || null;
  }
}

/** Wrap an async express handler so thrown errors reach the error middleware. */
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function errorMiddleware(err, req, res, _next) {
  if (err instanceof HttpError) {
    return res.status(err.status).json({ detail: err.message, code: err.code, ...(err.extra || {}) });
  }
  if (err && err.type === 'entity.parse.failed') return res.status(400).json({ detail: 'Malformed JSON body' });
  console.error('[error]', req.method, req.path, err);
  return res.status(500).json({ detail: 'Internal server error', code: 'INTERNAL' });
}

// ---- tiny validators (keeps the dependency list short) ----
const isAddress = (v) => typeof v === 'string' && /^0x[a-fA-F0-9]{40}$/.test(v);
const norm = (w) => (typeof w === 'string' ? w.toLowerCase() : w);

function num(v, name, { min = -Infinity, max = Infinity, int = false } = {}) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new HttpError(400, `${name} must be a number`, 'VALIDATION');
  if (int && !Number.isInteger(n)) throw new HttpError(400, `${name} must be an integer`, 'VALIDATION');
  if (n < min || n > max) throw new HttpError(400, `${name} must be between ${min} and ${max}`, 'VALIDATION');
  return n;
}

function str(v, name, { min = 1, max = 200 } = {}) {
  if (typeof v !== 'string') throw new HttpError(400, `${name} is required`, 'VALIDATION');
  const s = v.trim();
  if (s.length < min || s.length > max) throw new HttpError(400, `${name} must be ${min}-${max} characters`, 'VALIDATION');
  return s;
}

/** simple in-memory fixed-window rate limiter */
function rateLimit({ windowMs, max, message }) {
  const hits = new Map();
  return (req, res, next) => {
    const key = req.ip;
    const now = Date.now();
    const rec = hits.get(key);
    if (!rec || now > rec.reset) hits.set(key, { count: 1, reset: now + windowMs });
    else if (++rec.count > max) {
      res.set('Retry-After', String(Math.ceil((rec.reset - now) / 1000)));
      return res.status(429).json({ detail: message || 'Too many requests', code: 'RATE_LIMIT' });
    }
    next();
  };
}

function securityHeaders(_req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'same-site',
  });
  next();
}

module.exports = { HttpError, wrap, errorMiddleware, isAddress, norm, num, str, rateLimit, securityHeaders };
