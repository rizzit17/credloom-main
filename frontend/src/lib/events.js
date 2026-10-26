import { shortAddr } from './format';

const toEth = (wei) => {
  try { return Number(BigInt(wei)) / 1e18; } catch { return Number(wei) / 1e18; }
};
const E = (wei) => `${toEth(wei).toLocaleString(undefined, { maximumFractionDigits: 6 })} ETH`;
const A = (a) => shortAddr(a);

/** Plain-English narration of each smart-contract event, for the transaction visualizer and timelines. */
export const EVENT_INFO = {
  OfferCreated: { tone: 'blue', title: 'Offer escrowed', text: (a) => `${A(a.lender)} locked ${E(a.amount)} in offer #${a.offerId} (min score ${a.minCreditScore}, APR band ${a.minAprBps / 100}–${a.maxAprBps / 100}%).` },
  OfferWithdrawn: { tone: 'zinc', title: 'Offer withdrawn', text: (a) => `${A(a.lender)} withdrew ${E(a.amount)} from offer #${a.offerId}.` },
  OfferAccepted: { tone: 'purple', title: 'Offer matched', text: (a) => `The credit oracle attested score ${a.creditScore} and an APR of ${a.aprBps / 100}%. The contract verified the lender’s rules and created loan #${a.loanId}.` },
  LoanFunded: { tone: 'emerald', title: 'Loan funded', text: (a) => `Escrow released ${E(a.principal)} to ${A(a.borrower)}. Interest fixed at ${E(a.interest)}${a.insured ? ' (insured)' : ''}.` },
  LoanRepayment: { tone: 'emerald', title: 'Repayment received', text: (a) => `${A(a.payer)} paid ${E(a.amount)}; ${E(a.remaining)} still owed. Funds were forwarded to the lender instantly.` },
  LoanRepaid: { tone: 'emerald', title: 'Loan fully repaid', text: (a) => `${A(a.borrower)} settled the loan (${E(a.totalPaid)} total). Reputation improves.` },
  LoanDefaulted: { tone: 'red', title: 'Loan defaulted', text: (a) => `Deadline passed with ${E(a.outstandingPrincipal)} unpaid. ${toEth(a.insurancePayout) > 0 ? `Insurance paid the lender ${E(a.insurancePayout)}.` : 'No insurance payout.'}` },
  CoverageReserved: { tone: 'amber', title: 'Insurance reserved', text: (a) => `${A(a.insurer)} reserved ${E(a.amount)} of coverage and earned a ${E(a.premium)} premium.` },
  CoverageReleased: { tone: 'amber', title: 'Coverage released', text: (a) => `${E(a.amount)} of ${A(a.insurer)}’s stake is free again.` },
  InsurancePayout: { tone: 'red', title: 'Insurance payout', text: (a) => `${A(a.insurer)}’s stake paid ${E(a.amount)} to lender ${A(a.lender)}.` },
  InsurerDeposited: { tone: 'amber', title: 'Insurer staked', text: (a) => `${A(a.insurer)} deposited ${E(a.amount)} (balance ${E(a.newBalance)}).` },
  InsurerWithdrew: { tone: 'amber', title: 'Insurer withdrew', text: (a) => `${A(a.insurer)} withdrew ${E(a.amount)} of unreserved capital.` },
  TermsUpdated: { tone: 'amber', title: 'Underwriting terms set', text: (a) => `${A(a.insurer)} now charges ${a.premiumBps / 100}% and is ${a.accepting ? 'accepting' : 'not accepting'} new policies.` },
  LoanRecorded: { tone: 'zinc', title: 'Reputation: loan recorded', text: (a) => `ReputationRegistry logged a new ${E(a.amount)} loan for ${A(a.borrower)}.` },
  RepaymentRecorded: { tone: 'zinc', title: 'Reputation: repayment recorded', text: (a) => `ReputationRegistry logged ${E(a.amount)} repaid${a.loanCompleted ? ' — loan completed (+reputation)' : ''}.` },
  BorrowerFlagged: { tone: 'red', title: 'Borrower flagged', text: (a) => `${A(a.borrower)} is permanently flagged on-chain (${a.totalDefaults} default${a.totalDefaults > 1 ? 's' : ''}).` },
};

export const describeEvent = (e) => {
  const info = EVENT_INFO[e.event];
  return info ? info.text(e.args) : `${e.contract}.${e.event}`;
};

export const toneClass = {
  blue: 'border-blue-500/30 bg-blue-500/5 text-blue-300',
  emerald: 'border-emerald-500/30 bg-emerald-500/5 text-emerald-300',
  red: 'border-red-500/30 bg-red-500/5 text-red-300',
  amber: 'border-amber-500/30 bg-amber-500/5 text-amber-300',
  purple: 'border-purple-500/30 bg-purple-500/5 text-purple-300',
  zinc: 'border-zinc-700 bg-zinc-900/50 text-zinc-300',
};

// Show wei-sized values as ETH, leave other args alone
export function prettyArg(key, v) {
  if (typeof v === 'string' && /^\d{15,}$/.test(v)) return E(v);
  if (/^0x[0-9a-fA-F]{40}$/.test(String(v))) return shortAddr(v);
  if (/bps$/i.test(key)) return `${v} bps (${Number(v) / 100}%)`;
  return String(v);
}
