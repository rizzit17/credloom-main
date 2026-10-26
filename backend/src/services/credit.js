/**
 * Credit engine: feature extraction -> AI score -> tier limits -> dynamic APR.
 */
const db = require('../db');
const { chain, ml } = require('./external');
const { HttpError } = require('../lib/http');

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Max single loan (ETH) before score scaling, by verification tier
const TIER_BASE_LOAN = { 1: 2, 2: 5, 3: 10 };
const TIER_NAMES = { 1: 'Basic Wallet', 2: 'ENS Verified', 3: 'Passport Verified' };

/** Dynamic APR (basis points): 25% at score 0 down to 5% at score 1000. */
function aprBpsFromScore(score) {
  return Math.round(clamp(2500 - (2000 * score) / 1000, 500, 2500));
}

function riskStateFor(score, flagged) {
  if (flagged || score < 300) return 'critical';
  if (score < 550) return 'warning';
  return 'healthy';
}

function limitsFor(tier, score) {
  const base = TIER_BASE_LOAN[tier] || TIER_BASE_LOAN[1];
  const factor = clamp(score / 700, 0.25, 1.5);
  const maxLoan = Math.round(base * factor * 100) / 100;
  return {
    max_loan_amount: maxLoan,
    max_borrow_amount: Math.round(maxLoan * 2.5 * 100) / 100,
    max_duration_days: tier === 1 ? 30 : tier === 2 ? 60 : 90,
  };
}

/** Local fallback if the ML service is down. Clearly labelled in the response. */
function heuristicScore(f) {
  const s =
    380 +
    Math.min(f.total_transactions, 300) * 0.5 +
    Math.min(f.holding_days, 720) * 0.25 +
    f.Tier * 70 -
    Math.min(f.total_previous_loans_eth * 4, 120) +
    f.loans_repaid * 25 -
    f.loans_defaulted * 150;
  return Math.round(clamp(s, 0, 1000));
}

async function ensureProfiles(user) {
  const wallet = user.wallet;
  const { data: prof } = await db.from('profiles').select('*').eq('wallet', wallet).maybeSingle();
  if (!prof) await db.from('profiles').insert([{ wallet, user_id: user.id, tier: 1 }]);
  let { data: cp } = await db.from('credit_profiles').select('*').eq('wallet', wallet).maybeSingle();
  if (!cp) {
    const lim = limitsFor(1, 600);
    const { data } = await db
      .from('credit_profiles')
      .insert([{ wallet, tier: 1, credit_score: 600, risk_state: 'healthy', grace_days: 7, ...lim, available_credit: lim.max_borrow_amount, utilization_rate: 0, score_source: 'default' }])
      .select()
      .single();
    cp = data;
  }
  return cp;
}

async function outstandingExposure(wallet) {
  const { data } = await db.from('loans').select('principal, repaid_amount').eq('borrower_wallet', wallet).eq('status', 'active');
  return (data || []).reduce((s, l) => s + Math.max((l.principal || 0) - (l.repaid_amount || 0), 0), 0);
}

async function buildFeatures(user) {
  const wallet = user.wallet;
  const { data: prof } = await db.from('profiles').select('*').eq('wallet', wallet).maybeSingle();
  const { data: u } = await db.from('users').select('created_at').eq('id', user.id).maybeSingle();
  const meta = (prof && prof.meta) || {};

  let onchainTx = 0;
  try { onchainTx = (await chain.get(`/wallet/${wallet}/activity`)).transactionCount || 0; } catch { /* chain optional */ }

  const ageFromAccount = u && u.created_at ? Math.max((Date.now() - new Date(u.created_at + (String(u.created_at).endsWith('Z') ? '' : 'Z')).getTime()) / 86400000, 0) : 0;
  const { data: loans } = await db.from('loans').select('principal').eq('borrower_wallet', wallet);
  const numLoans = Math.max((prof && prof.num_previous_loans) || 0, (loans || []).length);
  const totalEth = Math.max((prof && prof.total_previous_loans_eth) || 0, (loans || []).reduce((s, l) => s + (l.principal || 0), 0));

  // Repayment history: the chain (ReputationRegistry) is authoritative, DB is the fallback
  const { data: settled } = await db.from('loans').select('status').eq('borrower_wallet', wallet);
  let repaid = (settled || []).filter((l) => l.status === 'repaid').length;
  let defaulted = (settled || []).filter((l) => l.status === 'defaulted').length;
  try {
    const rep = await chain.get(`/borrower/${wallet}/reputation`);
    repaid = Math.max(repaid, rep.loansRepaid);
    defaulted = Math.max(defaulted, rep.loansDefaulted);
  } catch { /* chain optional */ }

  return {
    loans_repaid: repaid,
    loans_defaulted: defaulted,
    total_transactions: Math.max((prof && prof.total_transactions) || 0, onchainTx),
    num_previous_loans: numLoans,
    total_previous_loans_eth: Math.round(totalEth * 1000) / 1000,
    holding_days: Math.round(Math.max(meta.wallet_age_days || 0, ageFromAccount) * 10) / 10,
    Tier: (prof && prof.tier) || 1,
  };
}

async function refreshScore(user, reason = 'manual refresh') {
  const cp = await ensureProfiles(user);
  const features = await buildFeatures(user);
  let score, source = 'ml', explain = null, defaultProb = null;
  try {
    const r = await ml.post('/predict', features);
    score = r.credit_score;
    defaultProb = r.default_probability;
  } catch {
    score = heuristicScore(features);
    source = 'heuristic';
  }

  // On-chain history is authoritative for reputation: defaults hurt immediately.
  let rep = null;
  try { rep = await chain.get(`/borrower/${user.wallet}/reputation`); } catch { /* optional */ }
  const flagged = !!(rep && rep.flagged);
  // Repayment history is now a model input (loans_repaid / loans_defaulted), so no
  // after-the-fact bonus/penalty is applied. The on-chain flag only affects risk_state.
  score = Math.round(clamp(score, 0, 1000));
  if (flagged) score = Math.min(score, 299); // permanently flagged wallets are never eligible

  const tier = features.Tier;
  const lim = limitsFor(tier, score);
  const exposure = await outstandingExposure(user.wallet);
  const available = Math.max(lim.max_borrow_amount - exposure, 0);
  const patch = {
    tier,
    credit_score: score,
    risk_state: riskStateFor(score, flagged),
    ...lim,
    available_credit: Math.round(available * 1000) / 1000,
    utilization_rate: lim.max_borrow_amount ? Math.min(exposure / lim.max_borrow_amount, 1) : 0,
    score_source: source,
    score_updated_at: new Date().toISOString(),
  };
  await db.from('credit_profiles').update(patch).eq('wallet', user.wallet);
  if (cp.credit_score !== score) {
    await db.from('credit_score_history').insert([{ wallet: user.wallet, score, source, reason }]);
  }
  return { ...cp, ...patch, features, defaultProbability: defaultProb, reputation: rep, aprBps: aprBpsFromScore(score) };
}

async function getCredit(user) {
  const cp = await ensureProfiles(user);
  return { ...cp, aprBps: aprBpsFromScore(cp.credit_score ?? 600), tierName: TIER_NAMES[cp.tier] || TIER_NAMES[1] };
}

function quote({ principal, aprBps, durationDays, premiumBps = 0 }) {
  const interest = (principal * aprBps * durationDays) / (365 * 10000);
  const premium = (principal * premiumBps) / 10000;
  return {
    principal,
    aprBps,
    aprPercent: aprBps / 100,
    durationDays,
    interest: Math.round(interest * 1e8) / 1e8,
    totalRepayment: Math.round((principal + interest) * 1e8) / 1e8,
    premiumBps,
    premium: Math.round(premium * 1e8) / 1e8,
    netToBorrower: Math.round((principal - premium) * 1e8) / 1e8,
  };
}

module.exports = {
  TIER_NAMES, aprBpsFromScore, limitsFor, riskStateFor, ensureProfiles, buildFeatures,
  refreshScore, getCredit, quote, outstandingExposure, clamp,
};
