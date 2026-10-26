/** Loan detail, timeline, default trigger, platform analytics and demo controls. */
const express = require('express');
const db = require('../db');
const config = require('../config');
const { HttpError, wrap, num } = require('../lib/http');
const { requireAuth } = require('../lib/auth');
const { chain } = require('../services/external');
const loansSvc = require('../services/loans');

const router = express.Router();

// ---------- public ----------
router.get('/health', wrap(async (_req, res) => {
  const [chainOk, ml] = await Promise.all([
    chain.alive(),
    fetch(config.mlServiceUrl + '/health', { signal: AbortSignal.timeout(2500) }).then((r) => r.ok).catch(() => false),
  ]);
  res.json({ status: 'ok', db: db.driver, chainService: chainOk, mlService: ml, demoMode: config.demoMode });
}));

router.get('/analytics/model', wrap(async (_req, res) => res.json(await require('../services/external').ml.get('/model/info'))));

router.get('/system', wrap(async (_req, res) => res.json(await chain.get('/system/info'))));

router.get('/analytics/platform', wrap(async (_req, res) => {
  const stats = await chain.get('/stats');
  const { data: loans } = await db.from('loans').select('status, apr_bps, principal, credit_score_at_origination, insurer_wallet');
  const L = loans || [];
  const buckets = [[0, 400], [400, 550], [550, 650], [650, 750], [750, 1001]].map(([lo, hi]) => ({
    range: `${lo}-${Math.min(hi - 1, 1000)}`,
    loans: L.filter((l) => (l.credit_score_at_origination ?? -1) >= lo && (l.credit_score_at_origination ?? -1) < hi).length,
    defaults: L.filter((l) => l.status === 'defaulted' && (l.credit_score_at_origination ?? -1) >= lo && (l.credit_score_at_origination ?? -1) < hi).length,
  }));
  const { data: users } = await db.from('users').select('role');
  const roles = { borrower: 0, lender: 0, insurer: 0 };
  (users || []).forEach((u) => { roles[u.role || 'borrower'] = (roles[u.role || 'borrower'] || 0) + 1; });
  const avgApr = L.length ? L.reduce((s, l) => s + (l.apr_bps || 0), 0) / L.length / 100 : 0;
  const { data: recent } = await db.from('loan_events').select('*').order('id', { ascending: false }).limit(12);
  res.json({
    chain: stats, users: roles, avgAprPercent: avgApr, insuredShare: L.length ? L.filter((l) => l.insurer_wallet).length / L.length : 0,
    scoreBuckets: buckets, recentEvents: recent || [],
  });
}));

// ---------- authenticated ----------
router.use(requireAuth);

router.get('/loans/:id', wrap(async (req, res) => {
  const id = num(req.params.id, 'loan id', { min: 1, int: true });
  const row = await loansSvc.findByChainId(id);
  const w = req.user.wallet.toLowerCase();
  if (!row || ![row.borrower_wallet, row.lender_wallet, row.insurer_wallet].some((x) => x && x.toLowerCase() === w)) {
    throw new HttpError(404, 'Loan not found', 'NOT_FOUND');
  }
  const [live, timeline] = await Promise.all([
    chain.get(`/loans/${id}`).catch(() => null),
    chain.get(`/loans/${id}/timeline`).catch(() => ({ events: [] })),
  ]);
  const { data: txs } = await db.from('chain_transactions').select('*').eq('loan_id', String(id)).order('id', { ascending: true });
  const { data: events } = await db.from('loan_events').select('*').eq('loan_id', row.loan_id).order('id', { ascending: true });
  res.json({ loan: row, chain: live, timeline: timeline.events, transactions: txs || [], events: events || [], yourRole: row.borrower_wallet.toLowerCase() === w ? 'borrower' : row.lender_wallet.toLowerCase() === w ? 'lender' : 'insurer' });
}));

/** Anyone may settle an overdue loan; the contract enforces the deadline. */
router.post('/loans/:id/default', wrap(async (req, res) => {
  const id = num(req.params.id, 'loan id', { min: 1, int: true });
  const result = await chain.post('/loan/default', { loanId: id });
  const row = await loansSvc.findByChainId(id);
  if (row) await loansSvc.applyDefault(row, result);
  res.json({ success: true, loan: result.loan, tx: result.tx });
}));

// ---------- demo controls ----------
const demoOnly = (_req, _res, next) => (config.demoMode ? next() : next(new HttpError(403, 'Demo controls are disabled', 'DEMO_DISABLED')));

router.get('/demo/time', demoOnly, wrap(async (_req, res) => res.json(await chain.get('/demo/time'))));

router.post('/demo/advance-time', demoOnly, wrap(async (req, res) => {
  const days = num(req.body.days ?? 0, 'days', { min: 0, max: 365 });
  const hours = num(req.body.hours ?? 0, 'hours', { min: 0, max: 24 * 365 });
  const seconds = Math.round(days * 86400 + hours * 3600);
  if (seconds < 1) throw new HttpError(400, 'Provide days or hours to advance', 'VALIDATION');
  const t = await chain.post('/demo/advance-time', { seconds });
  const settled = req.body.settleOverdue === false ? [] : await loansSvc.settleOverdue();
  res.json({ ...t, settledLoans: settled });
}));

router.post('/demo/settle-overdue', demoOnly, wrap(async (_req, res) => res.json({ settledLoans: await loansSvc.settleOverdue() })));

module.exports = router;
