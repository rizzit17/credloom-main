/**
 * End-to-end API test. Requires the other services:
 *   hardhat node + deploy, blockchain-service (:8000), mlModel (:5001)
 * Uses an in-memory SQLite DB, so it never touches your real data.
 *   npm test
 */
process.env.SQLITE_FILE = ':memory:';
process.env.DB_DRIVER = 'sqlite';
process.env.AUTO_DEFAULT = 'false';

const test = require('node:test');
const assert = require('node:assert/strict');
const app = require('../index');
const { chain } = require('../src/services/external');

let base;
let server;
const tag = Date.now().toString(36);
let seq = 0;

async function api(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty */ }
  return { status: res.status, data };
}

async function signup(role) {
  const r = await api('POST', '/auth/register', { body: { username: `${role}_${tag}_${++seq}`, password: 'password123', role } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  return r.data;
}

test.before(async () => {
  assert.ok(await chain.alive(), 'blockchain service/node must be running');
  await new Promise((resolve) => { server = app.listen(0, resolve); });
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

test('auth: validation, role, no tier escalation, custodial wallet', async () => {
  assert.equal((await api('POST', '/auth/register', { body: { username: 'a', password: 'short' } })).status, 400);
  const lender = await signup('lender');
  assert.match(lender.wallet, /^0x[a-fA-F0-9]{40}$/);
  assert.equal(lender.role, 'lender');
  assert.equal((await api('POST', '/auth/register', { body: { username: `lender_${tag}_1`, password: 'password123' } })).status, 409);
  assert.equal((await api('POST', '/auth/login', { body: { username: `lender_${tag}_1`, password: 'wrongpass1' } })).status, 401);
  assert.equal((await api('GET', '/borrower/offers')).status, 401);
  assert.equal((await api('GET', '/borrower/offers', { token: lender.token })).status, 403, 'lender cannot use borrower routes');
  // client-supplied tier must be ignored
  const b = await api('POST', '/auth/register', { body: { username: `tier_${tag}`, password: 'password123', tier: 3 } });
  const status = await api('GET', '/me/tier-status', { token: b.data.token });
  assert.equal(status.data.tier, 1);
});

test('full lending lifecycle: offer -> insured loan -> repay -> reputation', async () => {
  const lender = await signup('lender');
  const insurer = await signup('insurer');
  const borrower = await signup('borrower');

  // insurer stakes and sets terms
  assert.equal((await api('POST', '/insurer/deposit', { token: insurer.token, body: { amountEth: 5 } })).status, 200);
  assert.equal((await api('POST', '/insurer/terms', { token: insurer.token, body: { premiumBps: 150, accepting: true } })).status, 200);

  // lender escrows an offer
  const off = await api('POST', '/lender/offers', { token: lender.token, body: { amountEth: 1, durationDays: 30, minCreditScore: 300, minAprBps: 500, maxAprBps: 2500 } });
  assert.equal(off.status, 201, JSON.stringify(off.data));
  const offerId = off.data.offerId;
  assert.ok(off.data.tx.txHash.startsWith('0x') && off.data.tx.blockNumber > 0);

  // borrower sees a personalised quote
  const offers = await api('GET', '/borrower/offers', { token: borrower.token });
  const mine = offers.data.offers.find((o) => o.offerId === offerId);
  assert.ok(mine, 'offer visible to borrower');
  assert.equal(mine.eligible, true, JSON.stringify(mine.reasons));
  assert.ok(mine.yourAprBps >= 500 && mine.yourAprBps <= 2500);
  assert.ok(mine.insurers.some((i) => i.address === insurer.wallet), 'insurer quoted');

  const score = offers.data.borrower.credit_score;
  const accepted = await api('POST', '/borrower/loans/accept', { token: borrower.token, body: { offerId, insurerWallet: insurer.wallet } });
  assert.equal(accepted.status, 201, JSON.stringify(accepted.data));
  const loanId = Number(accepted.data.chainLoan.loanId);
  assert.equal(accepted.data.chainLoan.state, 'FUNDED');
  assert.equal(accepted.data.chainLoan.creditScore, score, 'score attested on-chain equals AI score');
  assert.ok(accepted.data.tx.events.some((e) => e.event === 'LoanFunded'));

  // offer is gone, loan visible to all three parties
  assert.equal((await api('POST', '/borrower/loans/accept', { token: borrower.token, body: { offerId } })).status, 409);
  for (const p of [lender, insurer, borrower]) assert.equal((await api('GET', `/loans/${loanId}`, { token: p.token })).status, 200);
  const stranger = await signup('borrower');
  assert.equal((await api('GET', `/loans/${loanId}`, { token: stranger.token })).status, 404, 'non-parties cannot read a loan');

  // repay in two parts
  const part = await api('POST', `/borrower/loans/${loanId}/repay`, { token: borrower.token, body: { amountEth: 0.5 } });
  assert.equal(part.status, 200, JSON.stringify(part.data));
  assert.equal(part.data.completed, false);
  const full = await api('POST', `/borrower/loans/${loanId}/repay`, { token: borrower.token });
  assert.equal(full.status, 200, JSON.stringify(full.data));
  assert.equal(full.data.completed, true);

  const detail = await api('GET', `/loans/${loanId}`, { token: lender.token });
  assert.equal(detail.data.loan.status, 'repaid');
  assert.deepEqual(detail.data.timeline.map((e) => e.event).slice(-1), ['LoanRepaid']);

  const sum = await api('GET', '/lender/summary', { token: lender.token });
  assert.equal(sum.data.loansRepaid, 1);
  assert.ok(sum.data.interestEarnedEth > 0);
  const ins = await api('GET', '/insurer/summary', { token: insurer.token });
  assert.equal(ins.data.reservedEth, '0');
  assert.ok(Number(ins.data.premiumsEarnedEth) > 0);

  const hist = await api('GET', '/me/credit/history', { token: borrower.token });
  assert.ok(hist.data.history.length >= 1);
});

test('default path: time travel, insurance payout, permanent flag', async () => {
  const lender = await signup('lender');
  const insurer = await signup('insurer');
  const borrower = await signup('borrower');
  await api('POST', '/insurer/deposit', { token: insurer.token, body: { amountEth: 2 } });
  await api('POST', '/insurer/terms', { token: insurer.token, body: { premiumBps: 100, accepting: true } });
  const { data: off } = await api('POST', '/lender/offers', { token: lender.token, body: { amountEth: 1, durationDays: 7, minCreditScore: 0 } });
  const acc = await api('POST', '/borrower/loans/accept', { token: borrower.token, body: { offerId: off.offerId, insurerWallet: insurer.wallet } });
  assert.equal(acc.status, 201, JSON.stringify(acc.data));
  const loanId = Number(acc.data.chainLoan.loanId);

  assert.equal((await api('POST', `/loans/${loanId}/default`, { token: lender.token })).status, 400, 'too early');
  const adv = await api('POST', '/demo/advance-time', { token: lender.token, body: { days: 8, settleOverdue: false } });
  assert.equal(adv.status, 200, JSON.stringify(adv.data));

  const def = await api('POST', `/loans/${loanId}/default`, { token: lender.token });
  assert.equal(def.status, 200, JSON.stringify(def.data));
  const detail = await api('GET', `/loans/${loanId}`, { token: lender.token });
  assert.equal(detail.data.loan.status, 'defaulted');
  assert.equal(detail.data.loan.insurance_payout, 1);

  const credit = await api('GET', '/me/credit', { token: borrower.token });
  assert.equal(credit.data.reputation.flagged, true);
  assert.equal(credit.data.risk_state, 'critical');
  const again = await api('GET', '/borrower/offers', { token: borrower.token });
  assert.equal(again.data.borrower.flagged, true);
});

test('tier verification raises score and limits', async () => {
  const u = await signup('borrower');
  const before = (await api('GET', '/me/tier-status', { token: u.token })).data;
  assert.equal((await api('POST', '/me/verify/passport', { token: u.token, body: { passport_number: 'abcdef123' } })).status, 409, 'tier 2 first');
  assert.equal((await api('POST', '/me/verify/ens', { token: u.token, body: { ens_name: 'not an ens' } })).status, 400);
  const ens = await api('POST', '/me/verify/ens', { token: u.token, body: { ens_name: `user${tag}.eth` } });
  assert.equal(ens.status, 200, JSON.stringify(ens.data));
  const after = (await api('GET', '/me/tier-status', { token: u.token })).data;
  assert.equal(after.tier, 2);
  assert.ok(after.credit_score > before.credit_score);
  assert.ok(after.max_loan_amount > before.max_loan_amount);
});

test('credit simulator and platform analytics', async () => {
  const u = await signup('borrower');
  const sim = await api('POST', '/me/credit/simulate', { token: u.token, body: { total_transactions: 100, num_previous_loans: 2, total_previous_loans_eth: 1.5, holding_days: 30, Tier: 1 } });
  assert.equal(sim.status, 200);
  assert.ok(sim.data.explanation.creditScore > 0 && sim.data.aprBps >= 500);
  const a = await api('GET', '/analytics/platform');
  assert.equal(a.status, 200);
  assert.ok(a.data.chain.totalLoans >= 2);
  const h = await api('GET', '/health');
  assert.equal(h.data.chainService, true);
});
