-- Credloom: additive migration for the existing Supabase project.
-- Safe to run more than once. Run it in the Supabase SQL editor, then set
-- DB_DRIVER=supabase in backend/.env.
-- (Verified against the live schema: these columns/tables did not exist.)

alter table users            add column if not exists role text not null default 'borrower';

alter table profiles         add column if not exists total_transactions integer default 0;
alter table profiles         add column if not exists num_previous_loans integer default 0;
alter table profiles         add column if not exists total_previous_loans_eth double precision default 0;

alter table credit_profiles  add column if not exists score_source text;
alter table credit_profiles  add column if not exists score_updated_at timestamp;

alter table lender_loan_options add column if not exists chain_offer_id integer unique;
alter table lender_loan_options add column if not exists min_score integer default 0;
alter table lender_loan_options add column if not exists min_apr_bps integer default 500;
alter table lender_loan_options add column if not exists max_apr_bps integer default 2500;
alter table lender_loan_options add column if not exists tx_create_hash varchar;

alter table loans add column if not exists blockchain_loan_id varchar;
alter table loans add column if not exists repaid_amount double precision default 0;
alter table loans add column if not exists credit_score_at_origination integer;
alter table loans add column if not exists insurance_payout double precision default 0;

alter table loan_events add column if not exists tx_hash varchar;
alter table loan_events add column if not exists block_number integer;
alter table loan_events add column if not exists amount double precision;
alter table loan_events add column if not exists details jsonb;

create table if not exists chain_transactions (
  id serial primary key,
  tx_hash varchar not null unique,
  kind varchar,
  wallet varchar,
  loan_id varchar,
  offer_id varchar,
  block_number integer,
  gas_used integer,
  fee_eth double precision,
  value_eth double precision,
  status varchar,
  created_at timestamp default now()
);

create table if not exists credit_score_history (
  id serial primary key,
  wallet varchar not null,
  score integer not null,
  source varchar,
  reason varchar,
  created_at timestamp default now()
);

create index if not exists idx_loans_borrower on loans(borrower_wallet);
create index if not exists idx_loans_lender on loans(lender_wallet);
create index if not exists idx_loans_insurer on loans(insurer_wallet);
create index if not exists idx_events_loan on loan_events(loan_id);
create index if not exists idx_history_wallet on credit_score_history(wallet);
