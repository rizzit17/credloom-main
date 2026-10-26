/**
 * Credloom API server (auth, credit engine, orchestration of the AI risk
 * service and the blockchain service, persistence).
 * The previous single-file server is archived in /legacy/backend/index.js.
 */
const config = require('./src/config');
const db = require('./src/db');
const app = require('./src/app');
const loans = require('./src/services/loans');

if (require.main === module) {
  app.listen(config.port, () => {
    console.log(`Credloom API on :${config.port} | db=${db.driver} | chain=${config.chainServiceUrl} | ml=${config.mlServiceUrl}`);
  });

  if (config.autoDefault) {
    // Keeper: settles overdue loans on-chain and keeps the DB aligned with the chain.
    let busy = false;
    setInterval(async () => {
      if (busy) return;
      busy = true;
      try {
        const settled = await loans.settleOverdue();
        if (settled.length) console.log('[keeper] defaulted loans', settled.join(', '));
        await loans.reconcile();
      } catch { /* chain not reachable right now */ } finally { busy = false; }
    }, config.autoDefaultIntervalMs).unref();
  }
}

module.exports = app;
