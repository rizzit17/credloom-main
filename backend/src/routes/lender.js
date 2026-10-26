const express = require('express');
const db = require('../db');
const { HttpError, wrap, num } = require('../lib/http');
const { requireAuth, requireRole } = require('../lib/auth');
const { chain } = require('../services/external');
const ledger = require('../services/ledger');
const loansSvc = require('../services/loans');

const router = express.Router();
router.use(requireAuth, requireRole('lender'));

router.post('/offers', wrap(async (req, res) => {
  const amountEth = num(req.body.amountEth, 'amountEth', { min: 0.001, max: 1000 });
  const durationDays = num(req.body.durationDays, 'durationDays', { min: 1, max: 365, int: true });
  const minCreditScore = num(req.body.minCreditScore ?? 600, 'minCreditScore', { min: 0, max: 1000, int: true });
  const minAprBps = num(req.body.minAprBps ?? 500, 'minAprBps', { min: 0, max: 3000, int: true });
  const maxAprBps = num(req.body.maxAprBps ?? 2500, 'maxAprBps', { min: 0, max: 3000, int: true });
  if (minAprBps > maxAprBps) throw new HttpError(400, 'Minimum APR cannot exceed maximum APR', 'VALIDATION');

  const result = await chain.post('/lender/create-offer', {
    lenderAddress: req.user.wallet, amountEth, durationDays, minCreditScore, minAprBps, maxAprBps,
  });

  await db.from('lender_profiles').upsert([{ wallet: req.user.wallet, active: true, min_score: minCreditScore, base_apr_bps: minAprBps }], { onConflict: 'wallet' });
  const { data: row } = await db.from('lender_loan_options').insert([{
    chain_offer_id: result.offerId, lender_id: req.user.id, lender_wallet: req.user.wallet, duration_days: durationDays,
    min_amount: amountEth, amount_available: amountEth, min_score: minCreditScore, min_apr_bps: minAprBps, max_apr_bps: maxAprBps,
    active: true, tx_create_hash: result.tx.txHash,
  }]).select().single();
  await ledger.recordTx(result.tx, { kind: 'offer_created', wallet: req.user.wallet, offerId: result.offerId });
  await ledger.recordEvent('offer_created', { loanId: null, wallet: req.user.wallet, tx: result.tx, amount: amountEth, details: { offerId: result.offerId, durationDays, minCreditScore } });
  res.status(201).json({ success: true, offer: row, offerId: result.offerId, tx: result.tx });
}));

router.get('/offers', wrap(async (req, res) => {
  const { offers } = await chain.get(`/offers?lender=${req.user.wallet}`);
  res.json({ offers });
}));

router.post('/offers/:id/withdraw', wrap(async (req, res) => {
  const offerId = num(req.params.id, 'offer id', { min: 1, int: true });
  const offer = await chain.get(`/offers/${offerId}`);
  if (offer.lender.toLowerCase() !== req.user.wallet.toLowerCase()) throw new HttpError(403, 'Not your offer', 'NOT_OWNER');
  const result = await chain.post('/lender/withdraw-offer', { lenderAddress: req.user.wallet, offerId });
  await db.from('lender_loan_options').update({ active: false, amount_available: 0 }).eq('chain_offer_id', offerId);
  await ledger.recordTx(result.tx, { kind: 'offer_withdrawn', wallet: req.user.wallet, offerId });
  await ledger.recordEvent('offer_withdrawn', { wallet: req.user.wallet, tx: result.tx, amount: offer.amountEth, details: { offerId } });
  res.json({ success: true, tx: result.tx });
}));

router.get('/loans', wrap(async (req, res) => {
  const { data } = await db.from('loans').select('*').eq('lender_wallet', req.user.wallet).order('id', { ascending: false });
  const loans = data || [];
  for (const l of loans) if (l.status === 'active') { try { l.chain = await chain.get(`/loans/${l.blockchain_loan_id}`); } catch { l.chain = null; } }
  res.json({ loans, total: loans.length });
}));

router.get('/summary', wrap(async (req, res) => {
  const w = req.user.wallet;
  const { offers } = await chain.get(`/offers?lender=${w}`);
  const { data: loans } = await db.from('loans').select('*').eq('lender_wallet', w);
  const L = loans || [];
  const active = L.filter((l) => l.status === 'active');
  const repaid = L.filter((l) => l.status === 'repaid');
  const defaulted = L.filter((l) => l.status === 'defaulted');
  const interestEarned = repaid.reduce((s, l) => s + (l.interest_amount || 0), 0);
  const recovered = defaulted.reduce((s, l) => s + (l.insurance_payout || 0) + Math.min(l.repaid_amount || 0, l.principal || 0), 0);
  const lostPrincipal = defaulted.reduce((s, l) => s + (l.principal || 0), 0) - recovered;
  const lent = L.reduce((s, l) => s + (l.principal || 0), 0);
  const openOffers = offers.filter((o) => o.active);
  const balance = await chain.get(`/balance/${w}`);
  res.json({
    wallet: w, walletBalanceEth: balance.balanceEth,
    openOffers: openOffers.length, escrowedInOffersEth: openOffers.reduce((s, o) => s + Number(o.amountEth), 0),
    activeLoans: active.length, activePrincipalEth: active.reduce((s, l) => s + (l.principal || 0), 0),
    totalLentEth: lent, loansRepaid: repaid.length, loansDefaulted: defaulted.length,
    interestEarnedEth: interestEarned, insuranceRecoveredEth: defaulted.reduce((s, l) => s + (l.insurance_payout || 0), 0),
    netLossEth: Math.max(lostPrincipal, 0),
    realisedReturnPct: lent ? ((interestEarned - Math.max(lostPrincipal, 0)) / lent) * 100 : 0,
    defaultRate: repaid.length + defaulted.length ? defaulted.length / (repaid.length + defaulted.length) : 0,
  });
}));

module.exports = router;
