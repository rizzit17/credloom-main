-- Credloom local schema (SQLite). Mirrors the Supabase tables; see
-- supabase_migration.sql for the additive changes needed on Postgres.

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  primary_wallet TEXT NOT NULL UNIQUE,
  username TEXT UNIQUE,
  password_hash TEXT,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'borrower',
  status TEXT DEFAULT 'active',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT NOT NULL UNIQUE,
  user_id INTEGER,
  tier INTEGER DEFAULT 1,
  tier_selected_at TEXT,
  display_handle TEXT,
  country_code TEXT,
  meta TEXT,
  total_transactions INTEGER DEFAULT 0,
  num_previous_loans INTEGER DEFAULT 0,
  total_previous_loans_eth REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS credit_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT NOT NULL UNIQUE,
  tier INTEGER DEFAULT 1,
  credit_score INTEGER,
  risk_points INTEGER DEFAULT 0,
  risk_state TEXT DEFAULT 'healthy',
  max_borrow_amount REAL DEFAULT 0,
  max_loan_amount REAL DEFAULT 0,
  max_duration_days INTEGER DEFAULT 30,
  grace_days INTEGER DEFAULT 7,
  available_credit REAL DEFAULT 0,
  utilization_rate REAL DEFAULT 0,
  score_source TEXT,
  score_updated_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS verifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT NOT NULL,
  verification_type TEXT,
  status TEXT,
  provider TEXT,
  provider_id TEXT,
  proof_hash TEXT,
  score REAL,
  verified_at TEXT,
  expires_at TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lender_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT NOT NULL UNIQUE,
  active INTEGER DEFAULT 1,
  min_tier INTEGER DEFAULT 1,
  min_score INTEGER,
  max_duration_days INTEGER DEFAULT 30,
  max_amount_per_loan REAL DEFAULT 100000,
  base_apr_bps INTEGER DEFAULT 500,
  insurance_required INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS lender_loan_options (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chain_offer_id INTEGER UNIQUE,
  lender_id INTEGER,
  lender_wallet TEXT NOT NULL,
  duration_days INTEGER NOT NULL,
  min_amount REAL NOT NULL DEFAULT 0,
  amount_available REAL NOT NULL DEFAULT 0,
  min_score INTEGER DEFAULT 0,
  min_apr_bps INTEGER DEFAULT 500,
  max_apr_bps INTEGER DEFAULT 2500,
  active INTEGER DEFAULT 1,
  tx_create_hash TEXT,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS insurer_profiles (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT NOT NULL UNIQUE,
  active INTEGER DEFAULT 1,
  min_tier INTEGER DEFAULT 1,
  min_score INTEGER,
  premium_bps INTEGER DEFAULT 100,
  max_coverage_amount REAL DEFAULT 1000000,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS loans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  loan_id TEXT NOT NULL UNIQUE,
  blockchain_loan_id TEXT,
  borrower_wallet TEXT NOT NULL,
  borrower_id INTEGER,
  lender_wallet TEXT,
  lender_id INTEGER,
  insurer_wallet TEXT,
  selected_option_id INTEGER,
  principal REAL,
  interest_amount REAL,
  insurance_premium REAL,
  repaid_amount REAL DEFAULT 0,
  collateral REAL DEFAULT 0,
  duration_days INTEGER,
  apr_bps INTEGER,
  premium_bps INTEGER,
  credit_score_at_origination INTEGER,
  status TEXT DEFAULT 'active',
  chain_id INTEGER,
  start_ts TEXT,
  due_ts TEXT,
  grace_end_ts TEXT,
  tx_create_hash TEXT,
  tx_repay_hash TEXT,
  tx_default_hash TEXT,
  insurance_payout REAL DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS loan_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT,
  loan_id TEXT,
  wallet TEXT,
  tx_hash TEXT,
  block_number INTEGER,
  amount REAL,
  details TEXT,
  event_ts TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS defaults_registry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT,
  loan_id TEXT,
  chain_id INTEGER,
  principal REAL,
  default_ts TEXT,
  tx_hash TEXT,
  resolved INTEGER DEFAULT 0,
  resolution_ts TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS chain_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tx_hash TEXT NOT NULL UNIQUE,
  kind TEXT,
  wallet TEXT,
  loan_id TEXT,
  offer_id TEXT,
  block_number INTEGER,
  gas_used INTEGER,
  fee_eth REAL,
  value_eth REAL,
  status TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS credit_score_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  wallet TEXT NOT NULL,
  score INTEGER NOT NULL,
  source TEXT,
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_loans_borrower ON loans(borrower_wallet);
CREATE INDEX IF NOT EXISTS idx_loans_lender ON loans(lender_wallet);
CREATE INDEX IF NOT EXISTS idx_loans_insurer ON loans(insurer_wallet);
CREATE INDEX IF NOT EXISTS idx_events_loan ON loan_events(loan_id);
CREATE INDEX IF NOT EXISTS idx_history_wallet ON credit_score_history(wallet);
