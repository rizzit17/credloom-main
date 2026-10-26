/** Persists chain activity (tx log + loan event log) next to the business data. */
const db = require('../db');

async function recordTx(tx, { kind, wallet, loanId, offerId }) {
  if (!tx) return;
  await db.from('chain_transactions').upsert(
    [{
      tx_hash: tx.txHash, kind, wallet: wallet || tx.from, loan_id: loanId != null ? String(loanId) : null,
      offer_id: offerId != null ? String(offerId) : null, block_number: tx.blockNumber, gas_used: tx.gasUsed,
      fee_eth: Number(tx.feeEth), value_eth: Number(tx.valueEth), status: tx.status,
    }],
    { onConflict: 'tx_hash' }
  );
}

async function recordEvent(type, { loanId, wallet, tx, amount, details }) {
  await db.from('loan_events').insert([{
    type, loan_id: loanId != null ? String(loanId) : null, wallet,
    tx_hash: tx ? tx.txHash : null, block_number: tx ? tx.blockNumber : null,
    amount: amount != null ? Number(amount) : null, details: details || null,
    event_ts: new Date().toISOString(),
  }]);
}

const iso = (unix) => new Date(unix * 1000).toISOString();

module.exports = { recordTx, recordEvent, iso };
