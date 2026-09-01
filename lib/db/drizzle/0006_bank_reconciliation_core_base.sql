-- ─────────────────────────────────────────────────────────────────────────────
-- BANK RECONCILIATION CORE BASE
-- The reconciliation route historically installed these tables during runtime.
-- Later static migrations alter them, so fresh TEST bootstrap must provide the
-- same base relations first.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS bank_mutations (
  id                       SERIAL PRIMARY KEY,
  bank_account_id          INTEGER,
  transaction_date         DATE NOT NULL,
  description              TEXT NOT NULL DEFAULT '',
  credit_amount            NUMERIC(16,2) NOT NULL DEFAULT 0,
  debit_amount             NUMERIC(16,2) NOT NULL DEFAULT 0,
  amount                   NUMERIC(16,2) NOT NULL DEFAULT 0,
  direction                TEXT NOT NULL DEFAULT 'IN',
  mutation_key             TEXT NOT NULL,
  normalized_description   TEXT NOT NULL DEFAULT '',
  provider_name            TEXT,
  provider_order_id        TEXT,
  raw_payload              JSONB,
  status                   TEXT NOT NULL DEFAULT 'unmatched',
  review_reason            TEXT,
  review_code              TEXT,
  matched_payment_id       INTEGER,
  matched_order_id         INTEGER,
  uploaded_proof_url       TEXT,
  journal_entry_id         INTEGER,
  company_id               INTEGER,
  import_batch_id          INTEGER,
  import_row_id            INTEGER,
  source                   TEXT,
  source_account           TEXT,
  reconciliation_status    TEXT,
  linked_transaction_type  TEXT,
  linked_transaction_id    INTEGER,
  created_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS bank_reconciliation_matches (
  id              SERIAL PRIMARY KEY,
  mutation_id     INTEGER NOT NULL
                  REFERENCES bank_mutations(id) ON DELETE CASCADE,
  candidate_type  TEXT NOT NULL,
  candidate_id    INTEGER NOT NULL,
  match_score     INTEGER NOT NULL DEFAULT 0,
  match_reason    TEXT NOT NULL DEFAULT '',
  amount_match    BOOLEAN NOT NULL DEFAULT FALSE,
  date_match      BOOLEAN NOT NULL DEFAULT FALSE,
  name_match      BOOLEAN NOT NULL DEFAULT FALSE,
  order_id_match  BOOLEAN NOT NULL DEFAULT FALSE,
  proof_match     BOOLEAN NOT NULL DEFAULT FALSE,
  status          TEXT NOT NULL DEFAULT 'candidate',
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS bank_reconciliation_audit (
  id           SERIAL PRIMARY KEY,
  mutation_id  INTEGER,
  action       TEXT NOT NULL,
  actor        TEXT,
  meta         JSONB,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS bm_mutation_key_idx
  ON bank_mutations(mutation_key);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS bm_status_idx
  ON bank_mutations(status);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS bm_date_idx
  ON bank_mutations(transaction_date);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS brm_mutation_idx
  ON bank_reconciliation_matches(mutation_id);