const express = require('express');
const db = require('../db');
const { wrap, num } = require('../lib/http');
const { requireAuth, requireRole } = require('../lib/auth');
const { chain } = require('../services/external');
const ledger = require('../services/ledger');

const router = express.Router();
router.use(requireAuth);

/** Public-to-authenticated: lets borrowers/lenders see who underwrites and at what price. */
router.get('/market', wrap(async (_req, res) => {
  const { insurers } = await chain.get('/insurers');
  res.json({ insurers });
}));

router.use(requireRole('insurer'));

router.get('/summary', wrap(async (req, res) => {
  const w = req.user.wallet;
  const info = await chain.get(`/insurer/${w}`);
  const { data: policies } = await db.from('loans').select('*').eq('insurer_wallet', w).order('id', { ascending: false });
  const P = policies || [];
  const bal = await chain.get(`/balance/${w}`);
  const defaulted = P.filter((p) => p.status === 'defaulted');
  const premiums = Number(info.premiumsEarnedEth);
  const paid = Number(info.totalPaidOutEth);
  res.json({
    ...info, walletBalanceEth: bal.balanceEth,
    policies: P.length, activePolicyCount: P.filter((p) => p.status === 'active').length,
    claims: defaulted.length, lossRatio: premiums ? paid / premiums : 0,
    netUnderwritingEth: premiums - paid,
    coverageUtilisation: Number(info.balanceEth) ? Number(info.reservedEth) / Number(info.balanceEth) : 0,
  });
}));

router.get('/policies', wrap(async (req, res) => {
  const { data } = await db.from('loans').select('*').eq('insurer_wallet', req.user.wallet).order('id', { ascending: false });
  const policies = data || [];
  for (const p of policies) if (p.status === 'active') { try { p.chain = await chain.get(`/loans/${p.blockchain_loan_id}`); } catch { p.chain = null; } }
  res.json({ policies });
}));

async function afterWrite(req, kind, result, amount) {
  await ledger.recordTx(result.tx, { kind, wallet: req.user.wallet });
  await ledger.recordEvent(kind, { wallet: req.user.wallet, tx: result.tx, amount });
}

router.post('/deposit', wrap(async (req, res) => {
  const amountEth = num(req.body.amountEth, 'amountEth', { min: 0.001, max: 1000 });
  const result = await chain.post('/insurer/deposit', { insurerAddress: req.user.wallet, amountEth });
  await afterWrite(req, 'insurer_deposit', result, amountEth);
  res.json(result);
}));

router.post('/withdraw', wrap(async (req, res) => {
  const amountEth = num(req.body.amountEth, 'amountEth', { min: 0.001, max: 1000 });
  const result = await chain.post('/insurer/withdraw', { insurerAddress: req.user.wallet, amountEth });
  await afterWrite(req, 'insurer_withdraw', result, amountEth);
  res.json(result);
}));

router.post('/terms', wrap(async (req, res) => {
  const premiumBps = num(req.body.premiumBps, 'premiumBps', { min: 0, max: 2000, int: true });
  const accepting = req.body.accepting !== false;
  const result = await chain.post('/insurer/terms', { insurerAddress: req.user.wallet, premiumBps, accepting });
  await db.from('insurer_profiles').upsert([{ wallet: req.user.wallet, active: accepting, premium_bps: premiumBps }], { onConflict: 'wallet' });
  await afterWrite(req, 'insurer_terms', result, null);
  res.json(result);
}));

module.exports = router;
