const express = require('express');
const bcrypt = require('bcryptjs');
const db = require('../db');
const config = require('../config');
const { HttpError, wrap, isAddress, norm, str, rateLimit } = require('../lib/http');
const { ROLES, signToken, requireAuth } = require('../lib/auth');
const { chain } = require('../services/external');
const credit = require('../services/credit');

const router = express.Router();
const loginLimiter = rateLimit({ windowMs: 60_000, max: 15, message: 'Too many attempts, try again in a minute' });

/** Pick a free custodial demo wallet (accounts 0-4 are reserved for the protocol/seed data). */
async function assignWallet() {
  const accounts = await chain.get('/accounts');
  const { data: used } = await db.from('users').select('primary_wallet');
  const taken = new Set((used || []).map((u) => norm(u.primary_wallet)));
  const free = accounts.filter((a) => a.index >= config.protocolReservedAccounts && !taken.has(norm(a.address)));
  if (!free.length) throw new HttpError(409, 'No free demo wallets left', 'NO_WALLETS');
  return free[0].address;
}

router.post('/register', loginLimiter, wrap(async (req, res) => {
  const username = str(req.body.username, 'username', { min: 3, max: 32 });
  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) throw new HttpError(400, 'Username may only contain letters, numbers, . _ -', 'VALIDATION');
  const password = str(req.body.password, 'password', { min: 8, max: 128 });
  const role = ROLES.includes(req.body.role) ? req.body.role : 'borrower';

  let wallet = req.body.wallet && String(req.body.wallet).trim();
  if (wallet) {
    if (!isAddress(wallet)) throw new HttpError(400, 'Invalid Ethereum wallet address format', 'VALIDATION');
    const accounts = await chain.get('/accounts').catch(() => null);
    if (accounts && !accounts.some((a) => norm(a.address) === norm(wallet))) {
      throw new HttpError(400, 'In demo mode wallets are custodial. Leave the wallet blank to get one assigned.', 'NOT_CUSTODIAL');
    }
    wallet = accounts ? accounts.find((a) => norm(a.address) === norm(wallet)).address : wallet;
  } else {
    wallet = await assignWallet();
  }

  const { data: byName } = await db.from('users').select('id').eq('username', username).maybeSingle();
  if (byName) throw new HttpError(409, 'Username already exists', 'USERNAME_TAKEN');
  const { data: byWallet } = await db.from('users').select('id').eq('primary_wallet', wallet).maybeSingle();
  if (byWallet) throw new HttpError(409, 'Wallet address already registered', 'WALLET_TAKEN');

  const password_hash = await bcrypt.hash(password, 10);
  const { data: user, error } = await db
    .from('users')
    .insert([{ username, password_hash, primary_wallet: wallet, role, status: 'active' }])
    .select()
    .single();
  if (error) throw new HttpError(500, 'Failed to create user', 'DB_ERROR');

  // tier is ALWAYS 1 at signup; upgrades require verification
  await credit.ensureProfiles({ id: user.id, wallet });
  await db.from('profiles').update({ user_id: user.id }).eq('wallet', wallet);
  if (role === 'lender') await db.from('lender_profiles').upsert([{ wallet, active: true }], { onConflict: 'wallet' });
  if (role === 'insurer') await db.from('insurer_profiles').upsert([{ wallet, active: true }], { onConflict: 'wallet' });
  if (role === 'borrower') await credit.refreshScore({ id: user.id, wallet }, 'initial assessment').catch(() => {});

  res.status(201).json({
    user_id: user.id, username, wallet, role, tier: 1,
    token: signToken(user), access_token: signToken(user),
    message: 'User registered successfully',
  });
}));

router.post('/login', loginLimiter, wrap(async (req, res) => {
  const username = str(req.body.username, 'username');
  const password = str(req.body.password, 'password', { min: 1, max: 128 });
  const { data: user } = await db
    .from('users').select('id, username, password_hash, primary_wallet, status, role').eq('username', username).maybeSingle();
  // same response for unknown user / wrong password (no account enumeration)
  const ok = user && (await bcrypt.compare(password, user.password_hash || ''));
  if (!ok) throw new HttpError(401, 'Invalid username or password', 'BAD_CREDENTIALS');
  if (user.status !== 'active') throw new HttpError(403, 'Account is not active. Please contact support.', 'ACCOUNT_INACTIVE');

  const token = signToken(user);
  res.json({
    token, access_token: token, user_id: user.id, username: user.username,
    wallet: user.primary_wallet, role: user.role || 'borrower', message: 'Login successful',
  });
}));

router.get('/me', requireAuth, wrap(async (req, res) => {
  res.json({ user_id: req.user.id, username: req.user.username, wallet: req.user.wallet, role: req.user.role });
}));

module.exports = router;
