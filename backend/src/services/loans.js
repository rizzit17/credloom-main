/**
 * Loan state machine on the database side. Every transition is driven by a
 * confirmed chain transaction, so the DB is a projection of the chain.
 */
const db = require('../db');
const { chain } = require('./external');
const credit = require('./credit');
const ledger = require('./ledger');
const { norm } = require('../lib/http');

let epochCache = null;
async function epoch() {
  if (epochCache) return epochCache;
  const info = await chain.get('/system/info');
  epochCache = info.deployedAt ? Math.floor(new Date(info.deployedAt).getTime() / 1000).toString(36) : 'x';
  return epochCache;
}
const dbLoanKey = async (chainLoanId) => `L${await epoch()}-${chainLoanId}`;

async function userByWallet(wallet) {
  const { data } = await db.from('users').select('id, username, primary_wallet, role').eq('primary_wallet', wallet).maybeSingle();
  return data;
}

async function createFromChain({ chainLoan, tx, offer, aprBps }) {
  const borrower = await userByWallet(chainLoan.borrower);
  const lender = await userByWallet(chainLoan.lender);
  const principal = Number(chainLoan.principalEth);
  const row = {
    loan_id: await dbLoanKey(chainLoan.loanId),
    blockchain_loan_id: String(chainLoan.loanId),
    borrower_wallet: chainLoan.borrower,
    borrower_id: borrower ? borrower.id : null,
    lender_wallet: chainLoan.lender,
    lender_id: lender ? lender.id : null,
    insurer_wallet: chainLoan.insurer,
    selected_option_id: offer ? offer.id : null,
    principal,
    interest_amount: Number(chainLoan.interestEth),
    insurance_premium: Number(chainLoan.premiumEth),
    repaid_amount: 0,
    duration_days: Math.round(chainLoan.durationSeconds / 86400),
    apr_bps: aprBps ?? chainLoan.aprBps,
    premium_bps: principal ? Math.round((Number(chainLoan.premiumEth) / principal) * 10000) : 0,
    credit_score_at_origination: chainLoan.creditScore,
    status: 'active',
    chain_id: 31337,
    start_ts: ledger.iso(chainLoan.startTime),
    due_ts: ledger.iso(chainLoan.deadline),
    tx_create_hash: tx.txHash,
  };
  const { data, error } = await db.from('loans').insert([row]).select().single();
  if (error) throw new Error('Failed to persist loan: ' + error.message);

  if (offer) await db.from('lender_loan_options').update({ active: false, amount_available: 0 }).eq('id', offer.id);
  const { data: prof } = await db.from('profiles').select('*').eq('wallet', chainLoan.borrower).maybeSingle();
  if (prof) {
    await db.from('profiles').update({
      total_transactions: (prof.total_transactions || 0) + 1,
      num_previous_loans: (prof.num_previous_loans || 0) + 1,
      total_previous_loans_eth: (prof.total_previous_loans_eth || 0) + principal,
    }).eq('wallet', chainLoan.borrower);
  }
  await ledger.recordTx(tx, { kind: 'loan_funded', wallet: chainLoan.borrower, loanId: chainLoan.loanId, offerId: offer && offer.chain_offer_id });
  await ledger.recordEvent('loan_funded', { loanId: data.loan_id, wallet: chainLoan.borrower, tx, amount: principal, details: { aprBps: row.apr_bps, insured: !!chainLoan.insurer } });
  return data;
}

async function applyRepayment(dbLoan, result, paidEth) {
  const l = result.loan;
  const completed = result.completed;
  const patch = { repaid_amount: Number(l.repaidEth) };
  if (completed) { patch.status = 'repaid'; patch.tx_repay_hash = result.tx.txHash; }
  await db.from('loans').update(patch).eq('id', dbLoan.id);
  await ledger.recordTx(result.tx, { kind: completed ? 'loan_repaid' : 'loan_repayment', wallet: result.tx.from, loanId: l.loanId });
  await ledger.recordEvent(completed ? 'loan_repaid' : 'loan_repayment', { loanId: dbLoan.loan_id, wallet: dbLoan.borrower_wallet, tx: result.tx, amount: paidEth });
  if (completed) {
    const u = await userByWallet(dbLoan.borrower_wallet);
    if (u) await credit.refreshScore({ id: u.id, wallet: u.primary_wallet }, `loan #${l.loanId} repaid`);
  }
}

async function applyDefault(dbLoan, result) {
  const payoutEv = (result.tx.events || []).find((e) => e.event === 'LoanDefaulted');
  const payout = payoutEv ? Number(payoutEv.args.insurancePayout) / 1e18 : 0;
  await db.from('loans').update({ status: 'defaulted', tx_default_hash: result.tx.txHash, insurance_payout: payout, repaid_amount: Number(result.loan.repaidEth) }).eq('id', dbLoan.id);
  await db.from('defaults_registry').insert([{
    wallet: dbLoan.borrower_wallet, loan_id: dbLoan.loan_id, chain_id: dbLoan.chain_id,
    principal: dbLoan.principal, default_ts: new Date().toISOString(), tx_hash: result.tx.txHash, resolved: false,
  }]);
  await ledger.recordTx(result.tx, { kind: 'loan_defaulted', wallet: dbLoan.borrower_wallet, loanId: result.loan.loanId });
  await ledger.recordEvent('loan_defaulted', { loanId: dbLoan.loan_id, wallet: dbLoan.borrower_wallet, tx: result.tx, amount: dbLoan.principal, details: { insurancePayoutEth: payout } });
  if (payout > 0) await ledger.recordEvent('insurance_payout', { loanId: dbLoan.loan_id, wallet: dbLoan.insurer_wallet, tx: result.tx, amount: payout });
  const u = await userByWallet(dbLoan.borrower_wallet);
  if (u) await credit.refreshScore({ id: u.id, wallet: u.primary_wallet }, `loan #${result.loan.loanId} defaulted`);
}

async function findByChainId(chainLoanId) {
  const { data } = await db.from('loans').select('*').eq('loan_id', await dbLoanKey(chainLoanId)).maybeSingle();
  return data;
}

/**
 * Settle every overdue loan on-chain, then align DB rows that drifted
 * (e.g. repaid directly on-chain). Returns what it did.
 */
async function settleOverdue() {
  const done = [];
  const { loans } = await chain.get('/loans?state=FUNDED');
  for (const cl of loans.filter((l) => l.overdue)) {
    try {
      const result = await chain.post('/loan/default', { loanId: cl.loanId });
      const row = await findByChainId(cl.loanId);
      if (row) await applyDefault(row, result);
      done.push(cl.loanId);
    } catch (e) {
      console.warn(`[settle] loan ${cl.loanId} failed:`, e.message);
    }
  }
  return done;
}

async function reconcile() {
  const { data: active } = await db.from('loans').select('*').eq('status', 'active');
  for (const row of active || []) {
    try {
      const cl = await chain.get(`/loans/${row.blockchain_loan_id}`);
      if (cl.state === 'REPAID' && row.status === 'active') await db.from('loans').update({ status: 'repaid', repaid_amount: Number(cl.repaidEth) }).eq('id', row.id);
      else if (Number(cl.repaidEth) !== (row.repaid_amount || 0)) await db.from('loans').update({ repaid_amount: Number(cl.repaidEth) }).eq('id', row.id);
    } catch { /* node down or loan from an old chain epoch */ }
  }
}

const sameWallet = (a, b) => norm(a) === norm(b);

module.exports = { dbLoanKey, userByWallet, createFromChain, applyRepayment, applyDefault, findByChainId, settleOverdue, reconcile, sameWallet };
