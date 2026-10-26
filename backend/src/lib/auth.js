const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../db');
const { HttpError, wrap } = require('./http');

const ROLES = ['borrower', 'lender', 'insurer'];

function signToken(user) {
  return jwt.sign(
    { user_id: user.id, username: user.username, wallet: user.primary_wallet, role: user.role || 'borrower' },
    config.jwtSecret,
    { algorithm: 'HS256', expiresIn: config.jwtExpiresIn }
  );
}

/** Verifies the bearer token and re-reads the user so suspended accounts lose access immediately. */
const requireAuth = wrap(async (req, _res, next) => {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) throw new HttpError(401, 'Authorization token required', 'NO_TOKEN');
  let decoded;
  try {
    decoded = jwt.verify(h.slice(7), config.jwtSecret, { algorithms: ['HS256'] });
  } catch {
    throw new HttpError(401, 'Invalid or expired token', 'BAD_TOKEN');
  }
  const { data: user } = await db
    .from('users')
    .select('id, username, primary_wallet, status, role')
    .eq('id', decoded.user_id)
    .maybeSingle();
  if (!user || user.status !== 'active') throw new HttpError(401, 'Account unavailable', 'ACCOUNT_INACTIVE');
  req.user = { id: user.id, username: user.username, wallet: user.primary_wallet, role: user.role || 'borrower' };
  next();
});

const requireRole = (...roles) => (req, _res, next) => {
  if (!roles.includes(req.user.role)) {
    return next(new HttpError(403, `This action requires the ${roles.join(' or ')} role`, 'WRONG_ROLE'));
  }
  next();
};

module.exports = { ROLES, signToken, requireAuth, requireRole };
