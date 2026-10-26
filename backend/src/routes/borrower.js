const express = require('express');
const db = require('../db');
const { HttpError, wrap, num } = require('../lib/http');
const { requireAuth, requireRole } = require('../lib/auth');
const { chain } = require('../services/external');
const credit = require('../services/credit');
const loansSvc = require('../services/loans');

const router = express.Router();
router.use(requireAuth, requireRole('borrower'));

const ZERO = '0x0000000000000000000000000000000000000000';

function eligibility(cp, offer, flagged) {
  const reasons = [];
  const amount = Number(offer.amountEth);
  if (flagged) reasons.push('Your wallet is flagged on-chain after a default');
  if (cp.risk_state === 'critical') reasons.push('Account is in a critical risk state');
  if ((cp.credit_score ?? 0) < offer.minCreditScore) reasons.push(`Credit score ${cp.credit_score} is below the lender minimum of ${offer.minCreditScore}`);
  if (amount > cp.max_loan_amount) reasons.push(`Loan ${amount} ETH exceeds your max single loan of ${cp.max_loan_amount} ETH`);
  if (amount > cp.available_credit) reasons.push(`Only ${cp.available_credit} ETH of credit is available`);
  if (offer.durationDays > cp.max_duration_days) reasons.push(`Duration ${offer.durationDays}d exceeds your tier limit of ${cp.max_duration_days}d`);
  return reasons;
}

async function reputationOf(wallet) {
  try { return await chain.get(`/borrower/${wallet}/reputation`); } catch { return null; }
}

/** Offers the borrower could take, each with a personalised quote and eligibility. */
router.get('/offers', wrap(async (req, res) => {
  const cp = await credit.getCredit(req.user);
  const rep = await reputationOf(req.user.wallet);
  const flagged = !!(rep && rep.flagged);
  const maxAmount = req.query.maxAmount ? num(req.query.maxAmount, 'maxAmount', { min: 0 }) : Infinity;
  const { offers } = await chain.get('/offers?activeOnly=true');
  const { insurers } = await chain.get('/insurers').catch(() => ({ insurers: [] }));
  const { data: rows } = await db.from('lender_loan_options').select('id, chain_offer_id, lender_wallet').eq('active', true);
  const byChainId = new Map((rows || []).map((r) => [r.chain_offer_id, r]));

  const out = [];
  for (const o of offers) {
    if (o.lender.toLowerCase() === req.user.wallet.toLowerCase()) continue;
    if (Number(o.amountEth) > maxAmount) continue;
    const baseApr = credit.aprBpsFromScore(cp.credit_score ?? 600);
    const aprBps = credit.clamp(baseApr, o.minAprBps, o.maxAprBps);
    const principal = Number(o.amountEth);
    const reasons = eligibility(cp, o, flagged);
    const cover = insurers
      .filter((i) => i.accepting && Number(i.freeEth) >= principal && i.address.toLowerCase() !== req.user.wallet.toLowerCase() && i.address.toLowerCase() !== o.lender.toLowerCase())
      .map((i) => ({ address: i.address, premiumBps: i.premiumBps, freeEth: i.freeEth, quote: credit.quote({ principal, aprBps, durationDays: o.durationDays, premiumBps: i.premiumBps }) }));
    out.push({
      offerId: o.offerId, dbOptionId: byChainId.get(o.offerId)?.id || null, lender: o.lender,
      amountEth: principal, durationDays: o.durationDays, minCreditScore: o.minCreditScore,
      aprBand: { minBps: o.minAprBps, maxBps: o.maxAprBps }, yourAprBps: aprBps,
      quote: credit.quote({ principal, aprBps, durationDays: o.durationDays }),
      eligible: reasons.length === 0, reasons, insurers: cover,
    });
  }
  res.json({
    borrower: { wallet: req.user.wallet, credit_score: cp.credit_score, tier: cp.tier, risk_state: cp.risk_state, available_credit: cp.available_credit, max_loan_amount: cp.max_loan_amount, max_duration_days: cp.max_duration_days, apr_bps: cp.aprBps, flagged },
    offers: out,
  });
}));

/** Take an offer: score refresh -> eligibility -> on-chain acceptance -> DB projection. */
router.post('/loans/accept', wrap(async (req, res) => {
  const offerId = num(req.body.offerId, 'offerId', { min: 1, int: true });
  const insurerWallet = req.body.insurerWallet || null;

  const fresh = await credit.refreshScore(req.user, 'pre-loan assessment');
  const offer = await chain.get(`/offers/${offerId}`);
  if (!offer.active) throw new HttpError(409, 'This offer is no longer available', 'OFFER_INACTIVE');
  if (offer.lender.toLowerCase() === req.user.wallet.toLowerCase()) throw new HttpError(400, 'You cannot borrow from your own offer', 'SELF_LOAN');

  const cp = await credit.getCredit(req.user);
  const rep = await reputationOf(req.user.wallet);
  const reasons = eligibility(cp, offer, !!(rep && rep.flagged));
  if (reasons.length) throw new HttpError(403, reasons[0], 'NOT_ELIGIBLE', { reasons });

  const aprBps = credit.clamp(credit.aprBpsFromScore(cp.credit_score), offer.minAprBps, offer.maxAprBps);
  const result = await chain.post('/loan/accept', {
    offerId, borrower: req.user.wallet, aprBps, creditScore: cp.credit_score,
    isInsured: !!insurerWallet, insurer: insurerWallet || ZERO,
  });

  const { data: offerRow } = await db.from('lender_loan_options').select('*').eq('chain_offer_id', offerId).maybeSingle();
  const row = await loansSvc.createFromChain({ chainLoan: result.loan, tx: result.tx, offer: offerRow, aprBps });
  await credit.refreshScore(req.user, `loan #${result.loanId} originated`);
  res.status(201).json({ success: true, loan: row, chainLoan: result.loan, tx: result.tx, scoreUsed: fresh.credit_score, aprBps });
}));

router.get('/loans', wrap(async (req, res) => {
  const { data } = await db.from('loans').select('*').eq('borrower_wallet', req.user.wallet).order('id', { ascending: false });
  const loans = data || [];
  // enrich active loans with live chain state (amount due, countdown, overdue)
  for (const l of loans) {
    if (l.status === 'active') {
      try { l.chain = await chain.get(`/loans/${l.blockchain_loan_id}`); } catch { l.chain = null; }
    }
  }
  res.json({ loans, total: loans.length });
}));

router.post('/loans/:id/repay', wrap(async (req, res) => {
  const chainId = num(req.params.id, 'loan id', { min: 1, int: true });
  const row = await loansSvc.findByChainId(chainId);
  if (!row || row.borrower_wallet.toLowerCase() !== req.user.wallet.toLowerCase()) throw new HttpError(404, 'Loan not found', 'NOT_FOUND');
  if (row.status !== 'active') throw new HttpError(409, `Loan is already ${row.status}`, 'INVALID_STATE');
  const amountEth = req.body.amountEth != null ? num(req.body.amountEth, 'amountEth', { min: 0.000001 }) : undefined;
  const result = await chain.post('/loan/repay', { loanId: chainId, payer: req.user.wallet, amountEth });
  const paid = amountEth ?? Number(result.tx.valueEth);
  await loansSvc.applyRepayment(row, result, paid);
  res.json({ success: true, completed: result.completed, loan: result.loan, tx: result.tx });
}));

module.exports = router;
