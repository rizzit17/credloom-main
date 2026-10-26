/**
 * Populates a presentation-ready demo world through the real API (so every
 * loan is a real on-chain transaction).
 *
 *   node scripts/seed.js            # add demo data
 *   node scripts/seed.js --reset    # wipe the local SQLite tables first
 *
 * Needs: hardhat node + deployed contracts, blockchain-service, mlModel, backend.
 * Use a FRESH chain (npm run chain:reset in the repo root) for clean numbers.
 * All demo accounts use the password:  Demo@1234
 */
const db = require('../src/db');

const API = process.env.API_URL || 'http://127.0.0.1:3001';
const PASSWORD = 'Demo@1234';

async function api(method, path, { token, body } = {}) {
  const res = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status} ${data.detail || ''}`);
  return data;
}

async function user(username, role, profile = {}) {
  let auth;
  try {
    auth = await api('POST', '/auth/register', { body: { username, password: PASSWORD, role } });
  } catch (e) {
    if (!/409/.test(e.message)) throw e;
    auth = await api('POST', '/auth/login', { body: { username, password: PASSWORD } });
  }
  if (Object.keys(profile).length) {
    const { data: prof } = await db.from('profiles').select('*').eq('wallet', auth.wallet).maybeSingle();
    await db.from('profiles').update({
      total_transactions: profile.txs ?? 0,
      meta: { ...(prof?.meta || {}), wallet_age_days: profile.ageDays ?? 0 },
    }).eq('wallet', auth.wallet);
  }
  console.log(`  ${role.padEnd(8)} ${username.padEnd(16)} ${auth.wallet}`);
  return auth;
}

async function takeLoan({ lender, borrower, insurer, amount, days, repay = true }) {
  const off = await api('POST', '/lender/offers', { token: lender.token, body: { amountEth: amount, durationDays: days, minCreditScore: 300, minAprBps: 500, maxAprBps: 2500 } });
  const acc = await api('POST', '/borrower/loans/accept', { token: borrower.token, body: { offerId: off.offerId, insurerWallet: insurer ? insurer.wallet : undefined } });
  const id = acc.chainLoan.loanId;
  if (repay) {
    await api('POST', `/borrower/loans/${id}/repay`, { token: borrower.token, body: { amountEth: Number((Number(acc.chainLoan.principalEth) / 2).toFixed(6)) } });
    await api('POST', `/borrower/loans/${id}/repay`, { token: borrower.token });
  }
  return acc;
}

async function main() {
  await api('GET', '/health');
  if (process.argv.includes('--reset')) {
    if (db.driver !== 'sqlite') throw new Error('--reset only supported for sqlite');
    for (const t of ['credit_score_history', 'chain_transactions', 'defaults_registry', 'loan_events', 'loans', 'loan_intents', 'lender_loan_options', 'insurer_profiles', 'lender_profiles', 'verifications', 'credit_profiles', 'profiles', 'users']) {
      await db.from(t).delete().gte('id', 0);
    }
    console.log('Local database cleared.');
  }

  console.log('Creating accounts');
  const alice = await user('lender_alice', 'lender');
  const bob = await user('lender_bob', 'lender');
  const zenith = await user('insurer_zenith', 'insurer');
  const atlas = await user('insurer_atlas', 'insurer');
  const raj = await user('borrower_raj', 'borrower', { txs: 240, ageDays: 900 });
  const meera = await user('borrower_meera', 'borrower', { txs: 90, ageDays: 400 });
  const dev = await user('borrower_dev', 'borrower', { txs: 12, ageDays: 40 });
  const vik = await user('borrower_vik', 'borrower', { txs: 30, ageDays: 120 });

  console.log('Insurers stake capital');
  await api('POST', '/insurer/deposit', { token: zenith.token, body: { amountEth: 25 } });
  await api('POST', '/insurer/terms', { token: zenith.token, body: { premiumBps: 150, accepting: true } });
  await api('POST', '/insurer/deposit', { token: atlas.token, body: { amountEth: 15 } });
  await api('POST', '/insurer/terms', { token: atlas.token, body: { premiumBps: 250, accepting: true } });

  console.log('Tier verification');
  await api('POST', '/me/verify/ens', { token: raj.token, body: { ens_name: 'raj.eth' } });
  for (const pid of ['raj-passport-001', 'raj-passport-002', 'raj-passport-003', 'raj-passport-004', 'raj-passport-005', 'raj-passport-006']) {
    const r = await api('POST', '/me/verify/passport', { token: raj.token, body: { passport_number: pid } });
    if (r.verified) break;
  }
  await api('POST', '/me/verify/ens', { token: meera.token, body: { ens_name: 'meera.eth' } });

  console.log('Building repayment history (real on-chain loans)');
  await takeLoan({ lender: alice, borrower: raj, amount: 0.5, days: 30 });
  await takeLoan({ lender: bob, borrower: raj, amount: 0.8, days: 30, insurer: zenith });
  await takeLoan({ lender: alice, borrower: raj, amount: 1, days: 45 });
  await takeLoan({ lender: bob, borrower: meera, amount: 0.6, days: 30, insurer: atlas });

  console.log('Creating a defaulted loan (time-travel) so the default path is visible');
  const bad = await takeLoan({ lender: bob, borrower: vik, amount: 0.7, days: 7, insurer: atlas, repay: false });
  await api('POST', '/demo/advance-time', { token: bob.token, body: { days: 8 } });
  console.log(`  loan #${bad.chainLoan.loanId} defaulted, insurer paid the lender`);

  console.log('Opening marketplace offers');
  const offers = [
    [alice, 0.5, 14, 400], [alice, 1.0, 30, 550], [alice, 1.5, 30, 650],
    [bob, 0.8, 30, 500], [bob, 2.0, 60, 700], [bob, 3.0, 90, 750],
  ];
  for (const [lender, amt, days, minScore] of offers) {
    await api('POST', '/lender/offers', { token: lender.token, body: { amountEth: amt, durationDays: days, minCreditScore: minScore, minAprBps: 500, maxAprBps: 2500 } });
  }

  console.log('Creating a live active loan for the demo (Meera)');
  const live = await api('POST', '/lender/offers', { token: alice.token, body: { amountEth: 0.9, durationDays: 30, minCreditScore: 300, minAprBps: 500, maxAprBps: 2500 } });
  const act = await api('POST', '/borrower/loans/accept', { token: meera.token, body: { offerId: live.offerId, insurerWallet: zenith.wallet } });
  console.log(`  active insured loan #${act.chainLoan.loanId}`);

  console.log('\nDone. Log in with any of these (password: ' + PASSWORD + ')');
  console.log('  borrower_raj (tier 3, strong history)   borrower_meera (tier 2, active loan)');
  console.log('  borrower_dev (new user)                 borrower_vik (defaulted, flagged)');
  console.log('  lender_alice / lender_bob               insurer_zenith / insurer_atlas');
}

main().catch((e) => { console.error('Seed failed:', e.message); process.exit(1); });
