const express = require('express');
const crypto = require('crypto');
const db = require('../db');
const { HttpError, wrap, str } = require('../lib/http');
const { requireAuth } = require('../lib/auth');
const { chain, ml } = require('../services/external');
const credit = require('../services/credit');

const router = express.Router();
router.use(requireAuth);

const PASSPORT_THRESHOLD = 15.0;

/** Deterministic, clearly-simulated Gitcoin Passport score (0-40) from the stamp id. */
function simulatedPassportScore(passportId) {
  const h = crypto.createHash('sha256').update(passportId.toLowerCase()).digest();
  return Math.round(((h[0] * 256 + h[1]) / 65535) * 40 * 100) / 100;
}

async function tierPayload(user) {
  const cp = await credit.getCredit(user);
  const latest = async (type) => (await db.from('verifications').select('status, provider_id, score, verified_at')
    .eq('wallet', user.wallet).eq('verification_type', type).order('created_at', { ascending: false }).limit(1).maybeSingle()).data;
  const ens = await latest('ENS');
  const passport = await latest('PASSPORT');
  return {
    wallet: user.wallet, role: user.role, tier: cp.tier, tier_name: credit.TIER_NAMES[cp.tier],
    credit_score: cp.credit_score, risk_state: cp.risk_state, apr_bps: cp.aprBps,
    available_credit: cp.available_credit, max_loan_amount: cp.max_loan_amount, max_borrow_amount: cp.max_borrow_amount,
    max_duration_days: cp.max_duration_days, utilization_rate: cp.utilization_rate, score_source: cp.score_source,
    score_updated_at: cp.score_updated_at,
    tier2: { ens_verified: ens ? ens.status === 'approved' : false, ens_name: ens ? ens.provider_id : null, verified_at: ens ? ens.verified_at : null },
    tier3: { passport_verified: passport ? passport.status === 'approved' : false, score: passport ? passport.score : null, threshold: PASSPORT_THRESHOLD, verified_at: passport ? passport.verified_at : null },
  };
}

router.get('/tier-status', wrap(async (req, res) => res.json(await tierPayload(req.user))));

router.post('/verify/ens', wrap(async (req, res) => {
  const name = str(req.body.ens_name, 'ens_name', { min: 5, max: 80 }).toLowerCase();
  if (!/^[a-z0-9-]{3,}(\.[a-z0-9-]+)*\.eth$/.test(name)) throw new HttpError(400, 'Enter a valid ENS name such as alice.eth', 'VALIDATION');
  const cp = await credit.getCredit(req.user);
  if (cp.tier >= 2) throw new HttpError(409, 'ENS verification already completed', 'ALREADY_VERIFIED');
  const { data: dup } = await db.from('verifications').select('id').eq('verification_type', 'ENS').eq('provider_id', name).eq('status', 'approved').maybeSingle();
  if (dup) throw new HttpError(409, 'This ENS name is already linked to another account', 'ENS_TAKEN');

  // Demo-mode: the name format is validated and recorded. A production build would
  // resolve the name on mainnet and compare the address record to this wallet.
  await db.from('verifications').insert([{ wallet: req.user.wallet, verification_type: 'ENS', status: 'approved', provider: 'ENS (simulated)', provider_id: name, score: 1.0, verified_at: new Date().toISOString() }]);
  await db.from('profiles').update({ tier: 2 }).eq('wallet', req.user.wallet);
  const refreshed = await credit.refreshScore(req.user, 'ENS verification (tier 2)');
  res.json({ verified: true, ens_name: name, tier: 2, credit_score: refreshed.credit_score, message: 'Tier 2 verification successful' });
}));

router.post('/verify/passport', wrap(async (req, res) => {
  const id = str(req.body.passport_number, 'passport_number', { min: 4, max: 80 });
  const cp = await credit.getCredit(req.user);
  if (cp.tier < 2) throw new HttpError(409, 'Complete Tier 2 (ENS) verification first', 'TIER2_REQUIRED');
  if (cp.tier >= 3) throw new HttpError(409, 'Passport verification already completed', 'ALREADY_VERIFIED');
  const score = simulatedPassportScore(id);
  const verified = score >= PASSPORT_THRESHOLD;
  await db.from('verifications').insert([{ wallet: req.user.wallet, verification_type: 'PASSPORT', status: verified ? 'approved' : 'rejected', provider: 'Gitcoin Passport (simulated)', provider_id: id, score, verified_at: verified ? new Date().toISOString() : null }]);
  let creditScore = cp.credit_score;
  if (verified) {
    await db.from('profiles').update({ tier: 3 }).eq('wallet', req.user.wallet);
    creditScore = (await credit.refreshScore(req.user, 'Passport verification (tier 3)')).credit_score;
  }
  res.json({ verified, provider: 'Gitcoin Passport (simulated)', score, threshold: PASSPORT_THRESHOLD, tier: verified ? 3 : 2, credit_score: creditScore,
    message: verified ? 'Tier 3 verification successful' : 'Score below threshold. Try a different passport ID.' });
}));

router.get('/credit', wrap(async (req, res) => {
  const cp = await credit.getCredit(req.user);
  const features = await credit.buildFeatures(req.user);
  let rep = null;
  try { rep = await chain.get(`/borrower/${req.user.wallet}/reputation`); } catch { /* chain optional */ }
  res.json({ ...cp, features, reputation: rep, exposure: await credit.outstandingExposure(req.user.wallet) });
}));

router.post('/credit/refresh', wrap(async (req, res) => {
  const r = await credit.refreshScore(req.user, 'manual refresh');
  res.json(r);
}));

router.get('/credit/history', wrap(async (req, res) => {
  const { data } = await db.from('credit_score_history').select('score, source, reason, created_at').eq('wallet', req.user.wallet).order('created_at', { ascending: true });
  res.json({ history: data || [] });
}));

router.get('/credit/explain', wrap(async (req, res) => {
  const features = await credit.buildFeatures(req.user);
  res.json({ features, explanation: await ml.post('/explain', features) });
}));

/** Public what-if simulator for the demo: any feature set -> score, APR, explanation. */
router.post('/credit/simulate', wrap(async (req, res) => {
  const b = req.body || {};
  const f = {
    total_transactions: Math.max(0, parseInt(b.total_transactions ?? 0, 10) || 0),
    num_previous_loans: Math.max(0, parseInt(b.num_previous_loans ?? 0, 10) || 0),
    total_previous_loans_eth: Math.max(0, Number(b.total_previous_loans_eth) || 0),
    holding_days: Math.max(0, Number(b.holding_days) || 0),
    Tier: [1, 2, 3].includes(Number(b.Tier)) ? Number(b.Tier) : 1,
    loans_repaid: Math.max(0, parseInt(b.loans_repaid ?? 0, 10) || 0),
    loans_defaulted: Math.max(0, parseInt(b.loans_defaulted ?? 0, 10) || 0),
  };
  const ex = await ml.post('/explain', f);
  const apr = credit.aprBpsFromScore(ex.creditScore);
  res.json({ features: f, aprBps: apr, limits: credit.limitsFor(f.Tier, ex.creditScore), explanation: ex });
}));

router.get('/activity', wrap(async (req, res) => {
  const { data: events } = await db.from('loan_events').select('*').eq('wallet', req.user.wallet).order('id', { ascending: false }).limit(50);
  const { data: txs } = await db.from('chain_transactions').select('*').eq('wallet', req.user.wallet).order('id', { ascending: false }).limit(50);
  res.json({ events: events || [], transactions: txs || [] });
}));

router.get('/balance', wrap(async (req, res) => res.json(await chain.get(`/balance/${req.user.wallet}`))));

module.exports = router;
