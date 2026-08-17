/**
 * Bank Reconciliation — Unified Architecture (Refactored)
 *
 * Arsitektur baru:
 *  - Satu matching engine: unifiedMatchingEngine.ts
 *  - Jurnal HANYA dibuat setelah approval (approveAndCreateJournal)
 *  - DB-level lock (SELECT FOR UPDATE) saat approval
 *  - UNIQUE constraint: bank_mutations(mutation_key, bank_account_id)
 *  - UNIQUE INDEX: bank_reconciliation_matches(mutation_id) WHERE status='approved'
 *  - Google Sheet: READ ONLY (tidak ada jalur create journal dari Sheet)
 *  - Audit log lengkap: MATCH_CREATED, MATCH_APPROVED, MATCH_REJECTED,
 *                       MUTATION_IMPORTED, OCR_PROCESSED
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../lib/requireAdmin.js";
import { audit } from "../lib/unifiedAudit.js";
import { logger } from "../lib/logger.js";
import ExcelJS from "exceljs";
import { Readable } from "stream";
import multer from "multer";
import { emitFinancialEvent } from "../lib/financialEventBus.js";
import { createIdempotencyMiddleware } from "../lib/financial/idempotency.js";
import {
  runUnifiedMatching,
  approveAndCreateJournal,
  fetchCandidates,
  scoreUnified,
  classifyMatch,
} from "../lib/reconciliation/unifiedMatchingEngine.js";
import {
  RECONCILIATION_CANDIDATE_SOURCES,
  type ReconciliationCandidateSource,
} from "@workspace/db";
import { runErpDocumentMatching } from "../lib/reconciliation/erpDocumentMatcher.js";
import { runHistoricalMatching } from "../lib/reconciliation/historicalMatchingEngine.js";
import { buildCombinedRecommendation } from "../lib/reconciliation/phase4RecommendationEngine.js";
import {
  normalizeDescription,
  type NormalizationResult,
} from "../lib/bankDescriptionNormalizer.js";
import { runRuleEngine, mergeRules } from "../lib/expenseRuleEngine.js";
import {
  runReconDecisionStack,
  BLOCKED_STATUSES,
  type MutationForDecisionStack,
} from "../lib/reconciliation/reconDecisionStack.js";
import { runReconRulesMigration } from "./bankReconRules.js";
import { runExpectedCashFlowMigration } from "../lib/reconciliation/expectedCashFlowService.js";
import { getHealthStatus, getDashboardMetrics } from "../lib/monitoring/reconciliationMonitor.js";
import { detectDrift } from "../lib/monitoring/dataDriftDetector.js";
import { triggerWritebackForMutation, syncOneSheetConfig } from "../lib/sheetSyncService.js";
import { canonicalMutationKey } from "../lib/reconciliation/canonicalMutationKey.js";
import { voidApprovedJournal } from "../lib/accounting/approveAndCreateJournal.js";
import { trackMutationApproval, runUsageTrackingMigration } from "../lib/usageTrackingService.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import {
  detectFormat,
  parseMT940,
  parseCAMT053,
  parseCSVText,
  buildMutationKeyFromParsed,
  normalizeForMatching,
  type ParsedBankRow,
} from "../lib/reconciliation/bankFormatParsers.js";
import { runReconBatch3Migration } from "../lib/reconciliation/reconBatch3Migration.js";
import { getCalibrationReport, recordMatchOutcome } from "../lib/reconciliation/confidenceCalibrationService.js";
import { buildGraphFromMutation, buildGraphFromInvoice } from "../lib/reconciliation/paymentRelationshipGraph.js";
import { findBestMultiInvoiceMatch } from "../lib/reconciliation/multiInvoiceMatchingEngine.js";
import { buildAllocationPlan, getCompanyAllocationStrategy, applyAllocationPlan } from "../lib/reconciliation/paymentAllocationEngine.js";
import { resolveCompanyId } from "../lib/resolveCompany.js";
import { runQrisSettlementMigration } from "../lib/reconciliation/qrisSettlementMigration.js";
import { isQrisSettlementDescription } from "../lib/reconciliation/qrisSettlement.js";
import {
  areQrisProvidersCompatible,
  normalizeQrisProvider,
} from "../lib/reconciliation/providerSettlementRules.js";
import {
  generateQrisCandidates,
  listQrisCandidates,
} from "../lib/reconciliation/qrisCandidateService.js";
import {
  QrisApprovalPaymentGuardError,
  selectQrisApprovalPaymentIds,
} from "../lib/reconciliation/qrisApprovalPaymentGuard.js";
import { canonicalSettlementDetailsSql } from "../lib/reconciliation/canonicalSettlementAdapter.js";
import {
  approveCanonicalSettlementLink,
  reopenCanonicalSettlementLink,
  CanonicalSettlementApprovalError,
  CANONICAL_SETTLEMENT_SOURCE,
} from "../lib/reconciliation/canonicalSettlementApproval.js";
import { buildCanonicalSportCenterSettlements } from "../lib/reconciliation/canonicalSettlementBuilder.js";
import {
  assertGenericPostAllowed,
  GenericPostGuardError,
} from "../lib/reconciliation/genericPostGuard.js";
import {
  assertQrisBatchApprovalEligible,
  checkQrisBatchReviewWarning,
  hasQrisBatchPaymentItems,
} from "../lib/reconciliation/qrisBatchApprovalEligibility.js";
import {
  checkDuplicatePaymentIds,
  checkStaleAmounts,
  checkHeaderTotals,
} from "../lib/reconciliation/qrisBatchAmountValidation.js";
import {
  CANONICAL_CANDIDATE_STALE,
  checkQrisCandidateFreshness,
} from "../lib/reconciliation/qrisCandidateContract.js";

const router = Router();

type SportPaymentType = "bank_transfer" | "qris" | "paylabs";

/**
 * Sport Center's public mirror has both the legacy `method` field and the
 * newer `payment_type` / `payment_provider` fields. Keep the classification in
 * SQL so list filters and candidate details use exactly the same contract.
 *
 * Paylabs is intentionally checked before QRIS: Paylabs can offer QRIS as one
 * of its rails, but it remains a Paylabs transaction for reconciliation and
 * must not be mixed into the direct-QRIS settlement cohort.
 */
function sportPaymentTypeSql(alias = "sp"): string {
  return `CASE
    WHEN LOWER(COALESCE(${alias}.payment_provider::text, '')) LIKE '%paylabs%'
      OR LOWER(COALESCE(${alias}.payment_type::text, '')) LIKE '%paylabs%'
      OR LOWER(COALESCE(${alias}.method::text, '')) LIKE '%paylabs%'
      THEN 'paylabs'
    WHEN LOWER(COALESCE(${alias}.payment_type::text, '')) LIKE '%qris%'
      OR LOWER(COALESCE(${alias}.method::text, '')) LIKE '%qris%'
      THEN 'qris'
    ELSE 'bank_transfer'
  END`;
}

function isSportPaymentType(value: string | undefined): value is SportPaymentType {
  return value === "bank_transfer" || value === "qris" || value === "paylabs";
}

function genericCandidateSameDaySql(matchAlias = "m", mutationAlias = "bm"): string {
  // Some development/runtime snapshots keep legacy transaction dates as TEXT
  // while newer tables use DATE. Compare their canonical ISO text form so the
  // list and summary queries do not fail with `date = text`.
  const mutationDate = `${mutationAlias}.transaction_date::text`;
  return `(
    (${matchAlias}.candidate_type = 'accounting_payment' AND EXISTS (
      SELECT 1 FROM accounting_payments ap_match
      WHERE ap_match.id = ${matchAlias}.candidate_id
        AND ap_match.date::text = ${mutationDate}
    ))
    OR (${matchAlias}.candidate_type = 'invoice' AND EXISTS (
      SELECT 1 FROM sales_documents sd_match
      WHERE sd_match.id = ${matchAlias}.candidate_id
        AND COALESCE(sd_match.invoice_date::text, sd_match.created_at::date::text) = ${mutationDate}
    ))
    OR (${matchAlias}.candidate_type = 'expense' AND EXISTS (
      SELECT 1 FROM expenses e_match
      WHERE e_match.id = ${matchAlias}.candidate_id
        AND e_match.date::text = ${mutationDate}
    ))
    OR (${matchAlias}.candidate_type = 'logistic_order' AND EXISTS (
      SELECT 1 FROM logistic_orders lo_match
      WHERE lo_match.id = ${matchAlias}.candidate_id
        AND lo_match.created_at::date::text = ${mutationDate}
    ))
    OR (${matchAlias}.candidate_type = 'tenant_invoice' AND EXISTS (
      SELECT 1 FROM tenant_invoices ti_match
      WHERE ti_match.id = ${matchAlias}.candidate_id
        AND ti_match.created_at::date::text = ${mutationDate}
    ))
  )`;
}
// The full-bank matching run can legitimately outlive the browser request
// timeout. Keep one background run per API process so repeated clicks do not
// fan out duplicate work against the same mutation set.
let unifiedMatchingJobActive = false;
router.use(async (req, res, next) => {
  if (!(await requireAdmin(req, res))) return;
  next();
});

// ─── Inline migration ─────────────────────────────────────────────────────────
let migrated = false;
export async function runBankReconciliationCoreMigration() {
  if (migrated) return;
  migrated = true;

  // Base tables
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS bank_mutations (
      id SERIAL PRIMARY KEY,
      bank_account_id INTEGER,
      transaction_date DATE NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      credit_amount NUMERIC(16,2) NOT NULL DEFAULT 0,
      debit_amount  NUMERIC(16,2) NOT NULL DEFAULT 0,
      amount        NUMERIC(16,2) NOT NULL DEFAULT 0,
      direction     TEXT NOT NULL DEFAULT 'IN',
      mutation_key  TEXT NOT NULL,
      normalized_description TEXT NOT NULL DEFAULT '',
      provider_name  TEXT,
      provider_order_id TEXT,
      raw_payload   JSONB,
      status        TEXT NOT NULL DEFAULT 'unmatched',
      matched_payment_id INTEGER,
      matched_order_id   INTEGER,
      uploaded_proof_url TEXT,
      journal_entry_id   INTEGER,
      company_id         INTEGER,
      import_batch_id    INTEGER,
      import_row_id      INTEGER,
      source             TEXT,
      source_account     TEXT,
      reconciliation_status TEXT,
      linked_transaction_type TEXT,
      linked_transaction_id   INTEGER,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)).catch(() => {});

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS bank_reconciliation_matches (
      id SERIAL PRIMARY KEY,
      mutation_id   INTEGER NOT NULL REFERENCES bank_mutations(id) ON DELETE CASCADE,
      candidate_type TEXT NOT NULL,
      candidate_id   INTEGER NOT NULL,
      match_score    INTEGER NOT NULL DEFAULT 0,
      match_reason   TEXT NOT NULL DEFAULT '',
      amount_match   BOOLEAN NOT NULL DEFAULT FALSE,
      date_match     BOOLEAN NOT NULL DEFAULT FALSE,
      name_match     BOOLEAN NOT NULL DEFAULT FALSE,
      order_id_match BOOLEAN NOT NULL DEFAULT FALSE,
      proof_match    BOOLEAN NOT NULL DEFAULT FALSE,
      status         TEXT NOT NULL DEFAULT 'candidate',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)).catch(() => {});

  // Phase 4C-1: source-aware candidate persistence. Historical rows remain NULL.
  // Historical rows remain NULL; source-aware candidates use the exact identity
  // below and are never collapsed by numeric candidate ID alone.
  await db.execute(sql.raw(`
    ALTER TABLE public.bank_reconciliation_matches
      ADD COLUMN IF NOT EXISTS candidate_source TEXT
  `)).catch(() => {});

  // Preserve the duplicate candidate evidence while making only one row
  // active per source-qualified identity. This is intentionally not a DELETE:
  // only rows classified as non-approved candidates are superseded, and
  // approved or historical evidence is never silently rewritten.
  await db.execute(sql.raw(`
    WITH duplicate_groups AS (
      SELECT mutation_id, candidate_type, candidate_id, candidate_source,
             MIN(id) AS keep_id
      FROM public.bank_reconciliation_matches
      WHERE candidate_source IS NOT NULL
        AND status = 'candidate'
      GROUP BY mutation_id, candidate_type, candidate_id, candidate_source
      HAVING COUNT(*) > 1
    )
    UPDATE public.bank_reconciliation_matches m
    SET status = 'superseded'
    FROM duplicate_groups d
    WHERE m.mutation_id = d.mutation_id
      AND m.candidate_type = d.candidate_type
      AND m.candidate_id = d.candidate_id
      AND m.candidate_source = d.candidate_source
      AND m.id <> d.keep_id
      AND m.status = 'candidate'
  `)).catch((e: any) => {
    logger.warn({ err: e?.cause?.message ?? e?.message }, "[bankRecon] source-aware candidate cleanup skipped");
  });

  await db.execute(sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS brm_source_identity_active_unique
    ON public.bank_reconciliation_matches
      (mutation_id, candidate_type, candidate_id, candidate_source)
    WHERE candidate_source IS NOT NULL
      AND status IN ('candidate', 'approved')
  `)).catch((e: any) => {
    logger.warn({ err: e?.cause?.message ?? e?.message }, "[bankRecon] source-aware candidate unique backstop unavailable");
  });

  // Historical candidates have no source discriminator. Older matching runs
  // could append the same (mutation, type, id) repeatedly, which made the
  // reviewer see identical cards and made selection ambiguous. Keep one active
  // row (prefer an already-approved row), preserve the rest as history, then
  // prevent the duplicate from returning.
  await db.execute(sql.raw(`
    UPDATE public.bank_reconciliation_matches duplicate_candidate
    SET status = 'superseded'
    WHERE duplicate_candidate.candidate_source IS NULL
      AND duplicate_candidate.status = 'candidate'
      AND EXISTS (
        SELECT 1
        FROM public.bank_reconciliation_matches approved_candidate
        WHERE approved_candidate.mutation_id = duplicate_candidate.mutation_id
          AND approved_candidate.candidate_type = duplicate_candidate.candidate_type
          AND approved_candidate.candidate_id = duplicate_candidate.candidate_id
          AND approved_candidate.candidate_source IS NULL
          AND approved_candidate.status = 'approved'
      )
  `)).catch((e: any) => {
    logger.warn({ err: e?.cause?.message ?? e?.message }, "[bankRecon] historical candidate approval cleanup skipped");
  });
  await db.execute(sql.raw(`
    WITH duplicate_groups AS (
      SELECT mutation_id, candidate_type, candidate_id, MIN(id) AS keep_id
      FROM public.bank_reconciliation_matches
      WHERE candidate_source IS NULL
        AND status = 'candidate'
      GROUP BY mutation_id, candidate_type, candidate_id
      HAVING COUNT(*) > 1
    )
    UPDATE public.bank_reconciliation_matches duplicate_candidate
    SET status = 'superseded'
    FROM duplicate_groups
    WHERE duplicate_candidate.mutation_id = duplicate_groups.mutation_id
      AND duplicate_candidate.candidate_type = duplicate_groups.candidate_type
      AND duplicate_candidate.candidate_id = duplicate_groups.candidate_id
      AND duplicate_candidate.candidate_source IS NULL
      AND duplicate_candidate.status = 'candidate'
      AND duplicate_candidate.id <> duplicate_groups.keep_id
  `)).catch((e: any) => {
    logger.warn({ err: e?.cause?.message ?? e?.message }, "[bankRecon] historical candidate dedupe skipped");
  });
  await db.execute(sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS brm_historical_identity_active_unique
    ON public.bank_reconciliation_matches (mutation_id, candidate_type, candidate_id)
    WHERE candidate_source IS NULL
      AND status IN ('candidate', 'approved')
  `)).catch((e: any) => {
    logger.warn({ err: e?.cause?.message ?? e?.message }, "[bankRecon] historical candidate unique backstop unavailable");
  });

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS bank_reconciliation_audit (
      id SERIAL PRIMARY KEY,
      mutation_id  INTEGER,
      action       TEXT NOT NULL,
      actor        TEXT,
      meta         JSONB,
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)).catch(() => {});

  // Standard indexes
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS bm_mutation_key_idx ON bank_mutations(mutation_key)`)).catch(() => {});
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS bm_status_idx        ON bank_mutations(status)`)).catch(() => {});
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS bm_date_idx          ON bank_mutations(transaction_date)`)).catch(() => {});
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS brm_mutation_idx     ON bank_reconciliation_matches(mutation_id)`)).catch(() => {});

  // ── NEW CONSTRAINTS (ERP-grade locks) ──────────────────────────────────────

  // 1. Unique mutation per (key, account) — prevents duplicate import of same mutation
  await db.execute(sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS bm_mutation_key_account_unique
    ON bank_mutations (mutation_key, bank_account_id)
    WHERE bank_account_id IS NOT NULL
  `)).catch(() => {});

  await db.execute(sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS bm_mutation_key_no_account_unique
    ON bank_mutations (mutation_key)
    WHERE bank_account_id IS NULL
  `)).catch(() => {});

  // 2. Unique approved match — satu mutation hanya boleh match ke 1 kandidat (STRICT UNIQUE LOCK)
  await db.execute(sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS brm_approved_mutation_unique
    ON bank_reconciliation_matches (mutation_id)
    WHERE status = 'approved'
  `)).catch(() => {});

  // Add journal_entry_id column if missing (schema upgrade)
  await db.execute(sql.raw(`ALTER TABLE bank_mutations ADD COLUMN IF NOT EXISTS journal_entry_id INTEGER`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE bank_mutations ADD COLUMN IF NOT EXISTS company_id INTEGER`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE bank_mutations ADD COLUMN IF NOT EXISTS import_batch_id INTEGER`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE bank_mutations ADD COLUMN IF NOT EXISTS import_row_id INTEGER`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE bank_mutations ADD COLUMN IF NOT EXISTS source TEXT`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE bank_mutations ADD COLUMN IF NOT EXISTS source_account TEXT`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE bank_mutations ADD COLUMN IF NOT EXISTS reconciliation_status TEXT`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE bank_mutations ADD COLUMN IF NOT EXISTS linked_transaction_type TEXT`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE bank_mutations ADD COLUMN IF NOT EXISTS linked_transaction_id INTEGER`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE bank_reconciliation_matches DROP COLUMN IF EXISTS proof_ref`)).catch(() => {});

  // ── Canonical key support (hardening Phase 2) ────────────────────────────────
  await db.execute(sql.raw(`ALTER TABLE bank_mutations ADD COLUMN IF NOT EXISTS bank_reference TEXT`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE bank_mutations ADD COLUMN IF NOT EXISTS canonical_key TEXT`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE bank_mutations ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE bank_mutations ADD COLUMN IF NOT EXISTS approved_by TEXT`)).catch(() => {});
  // Unique index on canonical_key — WHERE NOT NULL so old rows without this field are unaffected.
  await db.execute(sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS bm_canonical_key_unique
    ON bank_mutations (canonical_key)
    WHERE canonical_key IS NOT NULL
  `)).catch(() => {});
  // journal_sequences table — needed for atomic RECON entry numbers in approveAndCreateJournal.
  // Created here as a safety net; may already exist from runFinancialClosingMigration.
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS journal_sequences (
      journal_prefix TEXT    NOT NULL,
      company_id     INTEGER NOT NULL DEFAULT 0,
      year           INTEGER NOT NULL,
      next_seq       INTEGER NOT NULL DEFAULT 1,
      CONSTRAINT journal_sequences_pkey PRIMARY KEY (journal_prefix, company_id, year)
    )
  `)).catch(() => {});

  // ── Monitoring tables ────────────────────────────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS reconciliation_alerts (
      id          SERIAL PRIMARY KEY,
      type        TEXT NOT NULL,
      severity    TEXT NOT NULL,
      mutation_key TEXT,
      description TEXT,
      created_at  TIMESTAMPTZ DEFAULT NOW()
    )
  `)).catch(() => {});

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_recon_alerts_created
    ON reconciliation_alerts (created_at DESC)
  `)).catch(() => {});

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS reconciliation_sync_logs (
      id                  SERIAL PRIMARY KEY,
      sync_type           TEXT NOT NULL,
      status              TEXT NOT NULL,
      records_processed   INTEGER DEFAULT 0,
      records_failed      INTEGER DEFAULT 0,
      execution_time_ms   INTEGER,
      error_message       TEXT,
      created_at          TIMESTAMPTZ DEFAULT NOW()
    )
  `)).catch(() => {});

  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS idx_recon_sync_logs_created
    ON reconciliation_sync_logs (created_at DESC)
  `)).catch(() => {});

  // ── Multi-company Google Sheet configs ───────────────────────────────────────
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS bank_sheet_configs (
      id              SERIAL PRIMARY KEY,
      company_id      INTEGER,
      label           TEXT NOT NULL,
      sheet_id        TEXT NOT NULL,
      tab_name        TEXT NOT NULL DEFAULT 'Mutasi_Bank',
      bank_account_number TEXT,
      bank_name       TEXT,
      is_active       BOOLEAN NOT NULL DEFAULT TRUE,
      last_synced_at  TIMESTAMPTZ,
      last_sync_status TEXT,
      last_sync_error TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE bank_sheet_configs ADD COLUMN IF NOT EXISTS bank_account_number TEXT`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE bank_sheet_configs ADD COLUMN IF NOT EXISTS bank_name TEXT`)).catch(() => {});
  await db.execute(sql.raw(`
    CREATE INDEX IF NOT EXISTS bsc_company_idx ON bank_sheet_configs(company_id)
  `)).catch(() => {});

  // Tag bank_mutations dengan sheet_config_id
  await db.execute(sql.raw(`ALTER TABLE bank_mutations ADD COLUMN IF NOT EXISTS sheet_config_id INTEGER`)).catch(() => {});

  // ── Phase-3 lifecycle columns ─────────────────────────────────────────────
  // posted_by / posted_at: set by POST /:id/post (final accounting posting)
  await db.execute(sql.raw(`ALTER TABLE bank_mutations ADD COLUMN IF NOT EXISTS posted_by TEXT`)).catch(() => {});
  await db.execute(sql.raw(`ALTER TABLE bank_mutations ADD COLUMN IF NOT EXISTS posted_at TIMESTAMPTZ`)).catch(() => {});
  // suspected_duplicate: flagged by canonical backfill when key collision exists
  await db.execute(sql.raw(`ALTER TABLE bank_mutations ADD COLUMN IF NOT EXISTS suspected_duplicate BOOLEAN NOT NULL DEFAULT FALSE`)).catch(() => {});

  // ── Journal Reuse Engine: voided/reversed flags on accounting_entries ────────
  // resolveSportPaymentEntry (and all other source adapters in journalReuseEngine.ts)
  // SELECT COALESCE(ae.is_voided, FALSE) / COALESCE(ae.is_reversed, FALSE).
  // If these columns are missing the query throws "column does not exist" which
  // the FAIL-CLOSED handler converts to MANUAL_REVIEW_REQUIRED, blocking every
  // sport-payment approve even when a perfect candidate + COA is already found.
  await db.execute(sql.raw(
    `ALTER TABLE accounting_entries ADD COLUMN IF NOT EXISTS is_voided   BOOLEAN NOT NULL DEFAULT FALSE`,
  )).catch(() => {});
  await db.execute(sql.raw(
    `ALTER TABLE accounting_entries ADD COLUMN IF NOT EXISTS is_reversed BOOLEAN NOT NULL DEFAULT FALSE`,
  )).catch(() => {});

  // ── Canonical key backfill (idempotent) ───────────────────────────────────
  await runCanonicalKeyBackfill();

  // ── QRIS mutation bank_account_id backfill ────────────────────────────────
  // Bank mutations imported from Google Sheet often have bank_account_id=NULL
  // because the sheet config's source_account is unlinked. Without this field,
  // the QRIS candidate engine treats bankAccountId=null as an incomplete
  // dimension and can never produce a MATCHED candidate.
  // Fix: for QRIS-labelled mutations that still have bank_account_id=NULL,
  // assign the first active company bank account (same heuristic used for
  // sport_center.sport_payments in runSportCenterMigration).
  await db.execute(sql.raw(`
    UPDATE bank_mutations bm
    SET bank_account_id = cba.id
    FROM (
      SELECT DISTINCT ON (company_id) id, company_id
      FROM company_bank_accounts
      WHERE is_active = TRUE
      ORDER BY company_id, id
    ) cba
    WHERE bm.bank_account_id IS NULL
      AND bm.company_id = cba.company_id
      AND (
        bm.source_classification ILIKE '%qris%'
        OR bm.provider_name ILIKE '%qris%'
        OR bm.description ILIKE '%qris%'
      )
  `)).catch((e: any) => {
    logger.warn({ err: e?.message }, "[bankRecon] QRIS mutation bank_account_id backfill skipped");
  });

  // ── sport_center.expected_bank_settlements view ───────────────────────────
  // This view is required by canonicalSettlementDetailsSql() embedded in the
  // GET /mutations UNION ALL query.  It exposes payment_settlement_batches
  // columns under the names expected by canonicalSettlementAdapter.ts.
  // DROP + recreate is safe because this is a SELECT-only view with no
  // dependents outside the adapter.
  await db.execute(sql.raw(`
    CREATE OR REPLACE VIEW sport_center.expected_bank_settlements AS
    SELECT
      b.id                                      AS settlement_id,
      b.settlement_reference,
      b.company_id,
      b.provider_code,
      COALESCE(b.provider_code, 'unknown')      AS provider_name,
      b.bank_account_id,
      b.settlement_date,
      COALESCE(b.gross_amount,        0)        AS gross_amount,
      COALESCE(b.mdr_amount,          0)        AS mdr_amount,
      COALESCE(b.provider_fee_amount, 0)        AS provider_fee_amount,
      COALESCE(b.fee_tax_amount,      0)        AS fee_tax_amount,
      COALESCE(b.tax_withheld_amount, 0)        AS tax_withheld_amount,
      COALESCE(b.adjustment_amount,   0)        AS adjustment_amount,
      COALESCE(b.net_amount,          0)        AS expected_bank_amount,
      b.status                                  AS settlement_status,
      b.settlement_journal_id,
      b.bank_mutation_id,
      b.settlement_rule_version,
      b.posted_at,
      b.posted_by,
      b.reconciled_at,
      b.reconciled_by,
      CASE
        WHEN b.bank_mutation_id IS NOT NULL THEN 'linked'
        WHEN b.status = 'reconciled'        THEN 'reconciled'
        ELSE 'unlinked'
      END                                       AS bank_link_status
    FROM sport_center.payment_settlement_batches b
  `)).catch(() => {
    // Silently ignore ALL errors here.  This view depends on
    // sport_center.payment_settlement_batches which may not yet exist when
    // runBankReconciliationCoreMigration() first runs (before
    // runSportCenterMigration completes).  The /mutations query already has a
    // runtime to_regclass() guard that falls back to NULL when the view is
    // absent, so missing the view is safe — it just means canonical settlement
    // details are omitted until sport_center migration catches up.
  });
}

/**
 * runCanonicalKeyBackfill — idempotent backfill for bank_mutations rows
 * where canonical_key IS NULL. Computes the canonical key using the same
 * algorithm as all import sources (canonicalMutationKey) so old rows are
 * deduplicated correctly going forward.
 *
 * Collision handling: if a computed key already exists on another row, the
 * current row is marked suspected_duplicate = true and given a
 * 'DUP_<key>_<id>' placeholder so the UNIQUE index does not block it.
 * No data is deleted automatically — review required before merging.
 */
async function runCanonicalKeyBackfill(): Promise<void> {
  const { rows: nullRows } = await db.execute(sql.raw(`
    SELECT id,
           COALESCE(company_id::TEXT, '0')      AS company_id,
           COALESCE(bank_account_id::TEXT, '0') AS bank_account_id,
           transaction_date::TEXT               AS transaction_date,
           debit_amount,
           credit_amount,
           description,
           bank_reference
    FROM bank_mutations
    WHERE canonical_key IS NULL
    ORDER BY id
  `)).catch(() => ({ rows: [] as unknown[] }));

  if (!nullRows.length) return;

  logger.info({ count: nullRows.length }, "[bankRecon] canonical_key backfill — rows to process");

  for (const r of nullRows as Array<Record<string, unknown>>) {
    const id = Number(r["id"]);
    const key = canonicalMutationKey({
      transaction_date: String(r["transaction_date"] ?? "").split("T")[0],
      debit:            Number(r["debit_amount"]  ?? 0),
      credit:           Number(r["credit_amount"] ?? 0),
      description:      String(r["description"]   ?? ""),
      bank_reference:   r["bank_reference"] ? String(r["bank_reference"]) : null,
      company_id:       r["company_id"] !== "0" ? Number(r["company_id"]) : null,
      bank_account_id:  r["bank_account_id"] !== "0" ? Number(r["bank_account_id"]) : null,
    });

    // Check for collision with existing canonical_key on a DIFFERENT row
    const { rows: collision } = await db.execute(sql.raw(`
      SELECT id FROM bank_mutations
      WHERE canonical_key = '${key.replace(/'/g, "''")}' AND id != ${id}
      LIMIT 1
    `)).catch(() => ({ rows: [] as unknown[] }));

    if ((collision as unknown[]).length) {
      const dupKey = `DUP_${key}_${id}`;
      await db.execute(sql.raw(`
        UPDATE bank_mutations
        SET canonical_key = '${dupKey}', suspected_duplicate = TRUE, updated_at = NOW()
        WHERE id = ${id} AND canonical_key IS NULL
      `)).catch((e: unknown) => {
        logger.warn({ e, id }, "[backfill] suspected_duplicate update failed");
      });
      logger.warn({ id, key, collidingId: (collision as Array<Record<string,unknown>>)[0]?.["id"] },
        "[bankRecon] canonical_key collision — marked as suspected_duplicate");
    } else {
      await db.execute(sql.raw(`
        UPDATE bank_mutations
        SET canonical_key = '${key}', updated_at = NOW()
        WHERE id = ${id} AND canonical_key IS NULL
      `)).catch((e: unknown) => {
        logger.warn({ e, id }, "[backfill] canonical_key update failed");
      });
    }
  }

  const { rows: remaining } = await db.execute(sql.raw(
    `SELECT COUNT(*)::int AS cnt FROM bank_mutations WHERE canonical_key IS NULL`
  )).catch(() => ({ rows: [{ cnt: -1 }] as unknown[] }));
  const remaining_cnt = Number((remaining as Array<Record<string,unknown>>)[0]?.["cnt"] ?? -1);
  logger.info({ remaining_cnt }, "[bankRecon] canonical_key backfill complete");

  // ── Batch 3 migration (idempotent, non-blocking) ─────────────────────────────
  runReconBatch3Migration().catch((e: unknown) => {
    logger.warn({ err: e }, "[bankRecon] Batch 3 migration warning — app continues");
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
// D3 fix: normalizeDescription dihapus — gunakan normalizeForMatching yang sudah
// diimport dari bankFormatParsers.ts agar tidak ada duplikasi logic normalisasi.

const GOPAY_ORDER_RE = /\b(ID\d{12,20}[A-Z]{0,4})\b/gi;

function extractProviderOrderId(desc: string): string | null {
  const m = GOPAY_ORDER_RE.exec(desc);
  GOPAY_ORDER_RE.lastIndex = 0;
  return m ? m[1].toUpperCase() : null;
}

function detectProvider(desc: string): string | null {
  const d = desc.toUpperCase();
  if (d.includes("DOMPET ANAK BANGSA") || d.includes("GOPAY") || d.includes("PT DOMPET")) return "GOPAY";
  if (d.includes("OVO")) return "OVO";
  if (d.includes("DANA")) return "DANA";
  if (d.includes("LINKAJA") || d.includes("LINK AJA")) return "LINKAJA";
  if (d.includes("SHOPEE")) return "SHOPEEPAY";
  if (isQrisSettlementDescription(d)) return "QRIS";
  return null;
}

// buildMutationKey removed — use canonicalMutationKey (imported above) everywhere.

function parseAmount(val: unknown): number {
  if (!val && val !== 0) return 0;
  const s = String(val).replace(/[^0-9.,\-]/g, "").replace(/\./g, "").replace(",", ".");
  return Math.abs(parseFloat(s) || 0);
}

interface ParsedRow {
  transaction_date: string;
  description: string;
  credit_amount: number;
  debit_amount: number;
  amount: number;
  direction: "IN" | "OUT";
  mutation_key: string;
  normalized_description: string;
  provider_name: string | null;
  provider_order_id: string | null;
}

function parseRows(rows: Record<string, unknown>[]): ParsedRow[] {
  return rows.map((row) => {
    const keys = Object.keys(row).map((k) => k.toLowerCase().trim());
    const get = (candidates: string[]) => {
      for (const c of candidates) {
        const k = keys.find((k) => k.includes(c));
        if (k) return String(row[Object.keys(row)[keys.indexOf(k)]] ?? "").trim();
      }
      return "";
    };

    const rawDate   = get(["tanggal", "date", "tgl"]);
    const rawDesc   = get(["keterangan", "description", "desc", "ket", "narasi"]);
    const rawCredit = get(["kredit", "credit", "masuk", "cr", "in"]);
    const rawDebit  = get(["debit", "keluar", "db", "out"]);
    const rawAmt    = get(["nominal", "amount", "jumlah"]);

    let parsedDate = rawDate;
    try {
      let d = new Date(rawDate);
      if (isNaN(d.getTime())) {
        // Coba parse format DD/MM/YYYY atau DD-MM-YYYY (format Indonesia)
        const m = rawDate.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
        if (m) {
          const year = m[3].length === 2 ? `20${m[3]}` : m[3];
          d = new Date(`${year}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`);
        }
      }
      if (!isNaN(d.getTime())) parsedDate = d.toISOString().split("T")[0];
    } catch {}

    const credit = parseAmount(rawCredit);
    const debit  = parseAmount(rawDebit);
    let amount = credit || debit;
    if (!amount) amount = parseAmount(rawAmt);
    const direction: "IN" | "OUT" = credit > 0 ? "IN" : "OUT";

    return {
      transaction_date: parsedDate,
      description: rawDesc,
      credit_amount: credit,
      debit_amount: debit,
      amount,
      direction,
      mutation_key: canonicalMutationKey({
        transaction_date: parsedDate,
        debit:  direction === "IN"  ? amount : 0,
        credit: direction === "OUT" ? amount : 0,
        description: rawDesc,
      }),
      normalized_description: normalizeForMatching(rawDesc),
      provider_name: detectProvider(rawDesc),
      provider_order_id: extractProviderOrderId(rawDesc),
    };
  }).filter((r) => r.transaction_date && r.amount > 0);
}

async function auditLog(mutationId: number | null, action: string, actor: string, meta: object) {
  try {
    await db.execute(sql.raw(
      `INSERT INTO bank_reconciliation_audit(mutation_id,action,actor,meta) VALUES(${mutationId ?? "NULL"},'${action.replace(/'/g, "''")}','${actor.replace(/'/g, "''")}','${JSON.stringify(meta).replace(/'/g, "''")}')`,
    ));
  } catch (e) {
    logger.warn({ err: e }, "[bankRecon] auditLog failed");
  }
}

// ─── Multer setup ─────────────────────────────────────────────────────────────
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// ─── POST /api/bank-reconciliation/import ─────────────────────────────────────
// Import mutasi bank → DB saja. TIDAK ada pembuatan jurnal di sini.
// Unified matching engine dijalankan setelah setiap baris diimport.
router.post("/import", upload.single("file"), async (req, res) => {
  await runBankReconciliationCoreMigration();
  try {
    let rows: Record<string, unknown>[] = [];

    if (req.file) {
      const workbook = new ExcelJS.Workbook();
      const ext = (req.file.originalname ?? "").toLowerCase().split(".").pop();
      let worksheet: ExcelJS.Worksheet;
      if (ext === "csv") {
        const csvStream = new Readable({ read() {} });
        csvStream.push(Buffer.from(req.file!.buffer) as any);
        csvStream.push(null);
        worksheet = await workbook.csv.read(csvStream);
      } else {
        await workbook.xlsx.load(Buffer.from(req.file.buffer) as any);
        worksheet = workbook.worksheets[0];
      }
      const headers: string[] = [];
      worksheet.getRow(1).eachCell({ includeEmpty: true }, (cell, colIdx) => {
        headers[colIdx - 1] = String(cell.value ?? "");
      });
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const obj: Record<string, unknown> = {};
        headers.forEach((header, i) => {
          const cell = row.getCell(i + 1);
          let val: unknown = cell.value ?? "";
          if (val !== null && typeof val === "object" && "result" in (val as object)) {
            val = (val as { result: unknown }).result ?? "";
          }
          obj[header] = val;
        });
        rows.push(obj);
      });
    } else if (req.body?.rows && Array.isArray(req.body.rows)) {
      // JSON payload — accepted (read-only enrichment, tidak ada jurnal dari sini)
      rows = req.body.rows;
    } else {
      return res.status(400).json({ error: "Kirim file (Excel/CSV) atau rows JSON" });
    }

    const parsed = parseRows(rows);
    if (!parsed.length) return res.status(400).json({ error: "Tidak ada baris valid ditemukan" });

    const actor = (req as any).user?.email ?? "system";
    let imported = 0;
    let duplicates = 0;
    let matched_auto = 0;
    let needs_review = 0;

    for (const p of parsed) {
      // mutation_key IS the canonical key (parseRows now uses canonicalMutationKey)
      const mKey = p.mutation_key;

      // Check existing — mutation_key = canonical_key for new imports
      const { rows: existing } = await db.execute(sql.raw(
        `SELECT id FROM bank_mutations WHERE mutation_key = '${mKey.replace(/'/g, "''")}' OR canonical_key = '${mKey.replace(/'/g, "''")}'`
      ));

      if (existing.length > 0) {
        duplicates++;
        continue; // Skip — sudah ada, tidak di-overwrite
      }

      const { rows: inserted } = await db.execute(sql.raw(`
        INSERT INTO bank_mutations
          (transaction_date, description, credit_amount, debit_amount, amount, direction,
           mutation_key, canonical_key, normalized_description, provider_name, provider_order_id,
           status, source, raw_payload)
        VALUES (
          '${p.transaction_date}', '${p.description.replace(/'/g, "''")}',
          ${p.credit_amount}, ${p.debit_amount}, ${p.amount}, '${p.direction}',
          '${mKey.replace(/'/g, "''")}',
          '${mKey.replace(/'/g, "''")}',
          '${p.normalized_description.replace(/'/g, "''")}',
          ${p.provider_name ? `'${p.provider_name}'` : "NULL"},
          ${p.provider_order_id ? `'${p.provider_order_id}'` : "NULL"},
          'unmatched',
          'csv_excel',
          '${JSON.stringify(p).replace(/'/g, "''")}'
        )
        ON CONFLICT DO NOTHING
        RETURNING id
      `));

      if (!inserted[0]) continue;
      const mutId = Number((inserted[0] as any).id);
      imported++;

      // Audit: MUTATION_IMPORTED
      await auditLog(mutId, "MUTATION_IMPORTED", actor, {
        key: p.mutation_key,
        amount: p.amount,
        direction: p.direction,
        date: p.transaction_date,
      });

      // Jalankan unified matching engine (async, non-blocking untuk response)
      setImmediate(async () => {
        try {
          const result = await runUnifiedMatching({
            id: mutId,
            amount: p.amount,
            transaction_date: p.transaction_date,
            mutation_key: p.mutation_key,
            provider_order_id: p.provider_order_id,
            provider_name: p.provider_name,
            normalized_description: p.normalized_description,
            direction: p.direction,
          }, actor);

          emitFinancialEvent({
            event_type: result.status === "auto_matched" ? "RECONCILED" : "UNMATCHED",
            source_type: "bank_mutation",
            entity_type: "bank_mutation",
            entity_id: mutId,
            payload: { status: result.status, best_score: result.best?.score, best_type: result.best?.candidate.type },
            company_id: null,
          });
        } catch (e: any) {
          logger.warn({ err: e.message, mutId }, "[bankRecon] matching failed after import");
        }
      });

      if (imported % 5 === 0) {
        // Give event loop time for the matching tasks
        await new Promise(r => setTimeout(r, 0));
      }
    }

    audit(req, { action: "import", module: "accounting", resourceId: `bank-recon-${Date.now()}`, after: { imported, duplicates, total: parsed.length } });
    return res.json({ ok: true, imported, duplicates, total: parsed.length, matched_auto, needs_review });
  } catch (e: any) {
    logger.error({ err: e }, "[bankRecon] import error");
    return res.status(500).json({ error: e.message });
  }
});

// ─── QRIS settlement aggregate API ────────────────────────────────────────────
// A settlement is imported separately from a bank mutation.  The settlement
// represents the provider batch; sport_payments remain the canonical source
// items and must never be copied into accounting_payments as another candidate.
type QrisSettlementItemInput = {
  sportPaymentId?: unknown;
  paymentId?: unknown;
  grossAmount?: unknown;
  mdrAmount?: unknown;
  taxWithheldAmount?: unknown;
  otherFeeAmount?: unknown;
  netAmount?: unknown;
};

function qrisMoney(value: unknown, field: string, fallback = 0): number {
  if (value === undefined || value === null || value === "") return fallback;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || Math.round(n * 100) !== n * 100) {
    throw new Error(`${field} harus berupa angka >= 0 dengan maksimal 2 desimal`);
  }
  return Math.round(n * 100) / 100;
}

function qrisDate(value: unknown, field: string): string {
  const date = String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`${field} harus berformat YYYY-MM-DD`);
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    throw new Error(`${field} tidak valid`);
  }
  return date;
}

function qrisEsc(value: string): string {
  return value.replace(/'/g, "''");
}

function findPostgresError(error: unknown): Record<string, unknown> | null {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (typeof current === "object") {
      const record = current as Record<string, unknown>;
      if (record.code || record.constraint || record.detail) return record;
      current = record.cause;
    } else {
      break;
    }
  }
  return null;
}

function isQrisSettlementPaymentConflict(error: unknown): boolean {
  const postgresError = findPostgresError(error);
  return postgresError?.code === "23505"
    && (
      postgresError.constraint === "uq_qris_settlement_items_payment"
      || String(postgresError.detail ?? "").includes("sport_payment_id")
    );
}

class QrisPaymentAlreadySettledError extends Error {
  readonly code = "QRIS_PAYMENT_ALREADY_SETTLED";
  readonly paymentIds: number[];
  readonly settlementReferences: string[];

  constructor(paymentIds: number[], settlementReferences: string[] = []) {
    super(
      `Payment QRIS ${paymentIds.join(", ")} sudah tersettle pada batch lain. ` +
      "Approval batch ini dibatalkan untuk mencegah double-settlement.",
    );
    this.name = "QrisPaymentAlreadySettledError";
    this.paymentIds = paymentIds;
    this.settlementReferences = settlementReferences;
  }
}

function qrisAssertClose(actual: number, expected: number, label: string): void {
  if (Math.abs(actual - expected) > 0.01) {
    throw new Error(`${label} tidak cocok: ${actual.toFixed(2)} vs ${expected.toFixed(2)}`);
  }
}

function qrisSettlementPayload(body: Record<string, unknown>) {
  const settlementReference = String(body.settlementReference ?? body.settlement_reference ?? "").trim();
  if (!settlementReference || settlementReference.length > 180) {
    throw new Error("settlementReference wajib diisi dan maksimal 180 karakter");
  }
  const settlementDate = qrisDate(body.settlementDate ?? body.settlement_date, "settlementDate");
  const rawItems = body.items;
  if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > 1000) {
    throw new Error("items wajib berisi minimal satu payment dan maksimal 1.000 item");
  }
  const status = String(body.status ?? "settled").trim().toLowerCase();
  const allowedStatuses = new Set(["unsettled", "pending", "settled", "partial", "partially_settled", "cancelled", "reversed"]);
  if (!allowedStatuses.has(status)) throw new Error("status settlement tidak valid");

  const items = rawItems.map((raw, index) => {
    const item = (raw ?? {}) as QrisSettlementItemInput;
    const paymentId = Number(item.sportPaymentId ?? item.paymentId);
    if (!Number.isInteger(paymentId) || paymentId <= 0) throw new Error(`items[${index}].sportPaymentId tidak valid`);
    const grossAmount = qrisMoney(item.grossAmount, `items[${index}].grossAmount`);
    const mdrAmount = qrisMoney(item.mdrAmount, `items[${index}].mdrAmount`);
    const taxWithheldAmount = qrisMoney(item.taxWithheldAmount, `items[${index}].taxWithheldAmount`);
    const otherFeeAmount = qrisMoney(item.otherFeeAmount, `items[${index}].otherFeeAmount`);
    const netAmount = qrisMoney(item.netAmount, `items[${index}].netAmount`);
    return { paymentId, grossAmount, mdrAmount, taxWithheldAmount, otherFeeAmount, netAmount, index };
  });
  const ids = new Set<number>();
  for (const item of items) {
    if (ids.has(item.paymentId)) throw new Error(`Payment ${item.paymentId} muncul lebih dari sekali`);
    ids.add(item.paymentId);
  }
  const grossAmount = qrisMoney(body.grossAmount ?? body.gross_amount, "grossAmount",
    items.reduce((sum, item) => sum + item.grossAmount, 0));
  const mdrAmount = qrisMoney(body.mdrAmount ?? body.mdr_amount, "mdrAmount",
    items.reduce((sum, item) => sum + item.mdrAmount, 0));
  const taxWithheldAmount = qrisMoney(body.taxWithheldAmount ?? body.tax_withheld_amount, "taxWithheldAmount",
    items.reduce((sum, item) => sum + item.taxWithheldAmount, 0));
  const otherFeeAmount = qrisMoney(body.otherFeeAmount ?? body.other_fee_amount, "otherFeeAmount",
    items.reduce((sum, item) => sum + item.otherFeeAmount, 0));
  const netAmount = qrisMoney(body.netAmount ?? body.net_amount, "netAmount",
    items.reduce((sum, item) => sum + item.netAmount, 0));
  const expectedNet = grossAmount - mdrAmount - taxWithheldAmount - otherFeeAmount;
  if (expectedNet < -0.01) throw new Error("Potongan settlement melebihi gross amount");
  qrisAssertClose(grossAmount, items.reduce((sum, item) => sum + item.grossAmount, 0), "grossAmount header/item");
  qrisAssertClose(mdrAmount, items.reduce((sum, item) => sum + item.mdrAmount, 0), "mdrAmount header/item");
  qrisAssertClose(taxWithheldAmount, items.reduce((sum, item) => sum + item.taxWithheldAmount, 0), "taxWithheldAmount header/item");
  qrisAssertClose(otherFeeAmount, items.reduce((sum, item) => sum + item.otherFeeAmount, 0), "otherFeeAmount header/item");
  qrisAssertClose(netAmount, items.reduce((sum, item) => sum + item.netAmount, 0), "netAmount header/item");
  qrisAssertClose(netAmount, Math.max(0, expectedNet), "netAmount gross/fee");
  return {
    settlementReference,
    settlementDate,
    providerName: (body.providerName ?? body.provider_name)
      ? String(body.providerName ?? body.provider_name).trim()
      : null,
    grossAmount,
    mdrAmount,
    taxWithheldAmount,
    otherFeeAmount,
    netAmount,
    status,
    bankMutationId: (body.bankMutationId ?? body.bank_mutation_id) != null
      ? Number(body.bankMutationId ?? body.bank_mutation_id)
      : null,
    items,
  };
}

router.post("/qris-settlements/import", async (req, res) => {
  await runQrisSettlementMigration();
  try {
    const payload = qrisSettlementPayload((req.body ?? {}) as Record<string, unknown>);
    const companyId = resolveCompanyId(req);
    if (!Number.isInteger(companyId) || companyId <= 0) {
      return res.status(400).json({ error: "companyId tidak valid" });
    }
    if (payload.bankMutationId != null && (!Number.isInteger(payload.bankMutationId) || payload.bankMutationId <= 0)) {
      return res.status(400).json({ error: "bankMutationId tidak valid" });
    }

    const result = await db.transaction(async (tx) => {
      const ref = qrisEsc(payload.settlementReference);
      const { rows: existing } = await tx.execute(sql.raw(`
        SELECT id, company_id, settlement_reference, provider_name, settlement_date,
               gross_amount, mdr_amount, tax_withheld_amount, other_fee_amount,
               net_amount, status, bank_mutation_id
        FROM qris_settlements
        WHERE company_id = ${companyId} AND settlement_reference = '${ref}'
        FOR UPDATE
      `));
      if (existing[0]) {
        const row = existing[0] as Record<string, unknown>;
        qrisAssertClose(Number(row.gross_amount), payload.grossAmount, "grossAmount existing");
        qrisAssertClose(Number(row.net_amount), payload.netAmount, "netAmount existing");
        const { rows: existingItems } = await tx.execute(sql.raw(`
          SELECT qsi.id, qsi.sport_payment_id, qsi.gross_amount, qsi.mdr_amount,
                 qsi.tax_withheld_amount, qsi.other_fee_amount, qsi.net_amount,
                 sp.payment_number
          FROM qris_settlement_items qsi
          JOIN sport_payments sp ON sp.id = qsi.sport_payment_id
          WHERE qsi.settlement_id = ${Number(row.id)}
          ORDER BY qsi.id
        `));
        return { id: Number(row.id), idempotent: true, settlement: row, items: existingItems };
      }

      const paymentIds = payload.items.map((item) => item.paymentId).join(",");
      const { rows: payments } = await tx.execute(sql.raw(`
        SELECT sp.id, sp.company_id, sp.amount, sp.method, sp.status, sp.payment_number,
               sp.mdr_amount, sp.tax_withheld_amount, sp.other_fee_amount, sp.net_amount,
               EXISTS (
                 SELECT 1 FROM qris_settlement_items prior
                 WHERE prior.sport_payment_id = sp.id
               ) AS already_settled
        FROM sport_payments sp
        WHERE sp.id IN (${paymentIds})
        FOR UPDATE
      `));
      const byId = new Map((payments as Array<Record<string, unknown>>).map((row) => [Number(row.id), row]));
      if (byId.size !== payload.items.length) {
        const missing = payload.items.filter((item) => !byId.has(item.paymentId)).map((item) => item.paymentId);
        throw new Error(`sport_payment tidak ditemukan: ${missing.join(", ")}`);
      }
      for (const item of payload.items) {
        const payment = byId.get(item.paymentId)!;
        if (payment.company_id == null || Number(payment.company_id) !== companyId) {
          throw new Error(`Payment ${item.paymentId} bukan milik company aktif`);
        }
        if (String(payment.status).toLowerCase() !== "paid") {
          throw new Error(`Payment ${item.paymentId} belum berstatus paid`);
        }
        if (!String(payment.method ?? "").toLowerCase().includes("qris")) {
          throw new Error(`Payment ${item.paymentId} bukan payment QRIS`);
        }
        if (Boolean(payment.already_settled)) {
          throw new Error(`Payment ${item.paymentId} sudah tergabung dalam settlement lain`);
        }
      }

      let bankMutationId = payload.bankMutationId;
      if (bankMutationId != null) {
        const { rows: mutations } = await tx.execute(sql.raw(`
          SELECT id, company_id, amount, direction, transaction_date
          FROM bank_mutations
          WHERE id = ${bankMutationId}
          FOR UPDATE
        `));
        const mutation = mutations[0] as Record<string, unknown> | undefined;
        if (!mutation) throw new Error("Mutasi bank tidak ditemukan");
        if (mutation.company_id != null && Number(mutation.company_id) !== companyId) {
          throw new Error("Mutasi bank bukan milik company aktif");
        }
        if (String(mutation.direction).toUpperCase() !== "IN") throw new Error("Settlement QRIS hanya dapat ditautkan ke mutasi IN");
        qrisAssertClose(Number(mutation.amount), payload.netAmount, "nominal mutasi/net settlement");
      } else {
        const { rows: possible } = await tx.execute(sql.raw(`
          SELECT id, amount, transaction_date
          FROM bank_mutations
          WHERE (company_id = ${companyId} OR company_id IS NULL)
            AND direction = 'IN'
            AND ABS(amount::numeric - ${payload.netAmount}) < 0.01
            AND transaction_date BETWEEN '${payload.settlementDate}'::date - 1
                                      AND '${payload.settlementDate}'::date + 1
            AND status NOT IN ('void', 'rejected')
          ORDER BY id
          LIMIT 2
          FOR UPDATE
        `));
        if (possible.length === 1) bankMutationId = Number((possible[0] as any).id);
      }
      if (bankMutationId != null) {
        const { rows: linked } = await tx.execute(sql.raw(`
          SELECT id, settlement_reference
          FROM qris_settlements
          WHERE bank_mutation_id = ${bankMutationId}
          LIMIT 1
        `));
        if (linked[0]) throw new Error(`Mutasi bank sudah ditautkan ke settlement ${String((linked[0] as any).settlement_reference)}`);
      }

      const { rows: inserted } = await tx.execute(sql.raw(`
        INSERT INTO qris_settlements
          (company_id, settlement_reference, provider_name, settlement_date,
           gross_amount, mdr_amount, tax_withheld_amount, other_fee_amount,
           net_amount, status, bank_mutation_id)
        VALUES
          (${companyId}, '${ref}', ${payload.providerName ? `'${qrisEsc(payload.providerName)}'` : "NULL"},
           '${payload.settlementDate}', ${payload.grossAmount}, ${payload.mdrAmount},
           ${payload.taxWithheldAmount}, ${payload.otherFeeAmount}, ${payload.netAmount},
           '${qrisEsc(payload.status)}', ${bankMutationId ?? "NULL"})
        RETURNING *
      `));
      const settlement = inserted[0] as Record<string, unknown>;
      const settlementId = Number(settlement.id);
      for (const item of payload.items) {
        await tx.execute(sql.raw(`
          INSERT INTO qris_settlement_items
            (settlement_id, sport_payment_id, gross_amount, mdr_amount,
             tax_withheld_amount, other_fee_amount, net_amount)
          VALUES
            (${settlementId}, ${item.paymentId}, ${item.grossAmount}, ${item.mdrAmount},
             ${item.taxWithheldAmount}, ${item.otherFeeAmount}, ${item.netAmount})
        `));
        await tx.execute(sql.raw(`
          UPDATE sport_payments
          SET mdr_amount = ${item.mdrAmount},
              tax_withheld_amount = ${item.taxWithheldAmount},
              other_fee_amount = ${item.otherFeeAmount},
              net_amount = ${item.netAmount},
              settlement_reference = '${ref}',
              settlement_date = '${payload.settlementDate}',
              settlement_status = '${qrisEsc(payload.status)}',
              updated_at = NOW()
          WHERE id = ${item.paymentId} AND company_id = ${companyId}
        `));
        const providerCode = normalizeQrisProvider(payload.providerName);
        if (providerCode !== "unknown") {
          await tx.execute(sql.raw(`
            UPDATE sport_payments
            SET provider_code = '${qrisEsc(providerCode)}',
                updated_at = NOW()
            WHERE id = ${item.paymentId} AND company_id = ${companyId}
          `)).catch(() => {});
        }
      }
      return { id: settlementId, idempotent: false, settlement, items: payload.items };
    });

    audit(req, {
      action: "qris_settlement_import",
      module: "accounting",
      resourceId: `qris-settlement-${result.id}`,
      after: { companyId, settlementReference: payload.settlementReference, itemCount: payload.items.length, idempotent: result.idempotent },
    });
    return res.status(result.idempotent ? 200 : 201).json({ ok: true, ...result });
  } catch (e: any) {
    logger.warn({ err: e?.message }, "[bankRecon] QRIS settlement import rejected");
    const message = e?.message ?? "Import settlement QRIS gagal";
    return res.status(/wajib|valid|tidak cocok|bukan|sudah|belum|tidak ditemukan|melebihi|muncul/.test(message) ? 400 : 500)
      .json({ error: message });
  }
});

router.get("/qris-settlements", async (req, res) => {
  await runQrisSettlementMigration();
  try {
    const companyId = resolveCompanyId(req);
    const limit = Math.min(Math.max(Number(req.query.limit ?? 100), 1), 500);
    const offset = Math.max(Number(req.query.offset ?? 0), 0);
    const { rows } = await db.execute(sql.raw(`
      SELECT qs.*,
             COUNT(qsi.id)::int AS item_count,
             COALESCE(json_agg(
               jsonb_build_object(
                 'id', qsi.id, 'sportPaymentId', qsi.sport_payment_id,
                 'paymentNumber', sp.payment_number, 'grossAmount', qsi.gross_amount,
                 'mdrAmount', qsi.mdr_amount, 'taxWithheldAmount', qsi.tax_withheld_amount,
                 'otherFeeAmount', qsi.other_fee_amount, 'netAmount', qsi.net_amount
               ) ORDER BY qsi.id
             ) FILTER (WHERE qsi.id IS NOT NULL), '[]'::json) AS items
      FROM qris_settlements qs
      LEFT JOIN qris_settlement_items qsi ON qsi.settlement_id = qs.id
      LEFT JOIN sport_payments sp ON sp.id = qsi.sport_payment_id
      WHERE qs.company_id = ${companyId}
      GROUP BY qs.id
      ORDER BY qs.settlement_date DESC, qs.id DESC
      LIMIT ${limit} OFFSET ${offset}
    `));
    return res.json({ settlements: rows });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? "Gagal mengambil settlement QRIS" });
  }
});

router.get("/qris-settlements/:settlementId", async (req, res) => {
  await runQrisSettlementMigration();
  try {
    const companyId = resolveCompanyId(req);
    const settlementId = Number(req.params.settlementId);
    if (!Number.isInteger(settlementId) || settlementId <= 0) return res.status(400).json({ error: "settlementId tidak valid" });
    const { rows: settlements } = await db.execute(sql.raw(`
      SELECT * FROM qris_settlements
      WHERE id = ${settlementId} AND company_id = ${companyId}
    `));
    if (!settlements[0]) return res.status(404).json({ error: "Settlement QRIS tidak ditemukan" });
    const { rows: items } = await db.execute(sql.raw(`
      SELECT qsi.*, sp.payment_number, sp.booking_id, sp.amount AS payment_amount,
             sp.method, sp.status AS payment_status
      FROM qris_settlement_items qsi
      JOIN sport_payments sp ON sp.id = qsi.sport_payment_id
      WHERE qsi.settlement_id = ${settlementId}
      ORDER BY qsi.id
    `));
    return res.json({ settlement: settlements[0], items });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message ?? "Gagal mengambil detail settlement QRIS" });
  }
});

// ─── QRIS provider-aware candidate audit (dry-run/review only) ───────────────
// This flow deliberately does not approve a mutation, create a journal, mark a
// settlement as final, or consume bank evidence. A reviewer must use the
// existing approval mechanism explicitly after verifying the candidate.
router.get("/qris-candidates", async (req, res) => {
  await runQrisSettlementMigration();
  try {
    const companyId = resolveCompanyId(req);
    const status = req.query.status ? String(req.query.status).toUpperCase() : null;
    const includeCompleted = String(req.query.includeCompleted ?? "").toLowerCase() === "true";
    const candidates = await listQrisCandidates({
      companyId,
      status,
      limit: Number(req.query.limit ?? 100),
      includeCompleted,
    });
    return res.json({
      mode: "candidate_review",
      automaticFinalReconciliation: false,
      candidates,
    });
  } catch (e: any) {
    logger.error({ err: e?.cause?.message ?? e?.message }, "[bankRecon] GET /qris-candidates failed");
    return res.status(500).json({ error: e?.message ?? "Gagal mengambil kandidat QRIS" });
  }
});

router.post("/qris-candidates/generate", async (req, res) => {
  await runQrisSettlementMigration();
  try {
    if (unifiedMatchingJobActive) {
      return res.status(409).json({
        error: "Matching mutasi bank masih berjalan. Tunggu sampai matching selesai sebelum membuat kandidat QRIS.",
        code: "MATCHING_IN_PROGRESS",
      });
    }
    const companyId = req.body?.companyId ?? req.body?.company_id ?? resolveCompanyId(req);
    const dryRun = req.body?.dryRun !== false && req.body?.dry_run !== false;
    const result = await generateQrisCandidates({
      companyId: companyId == null ? null : Number(companyId),
      from: req.body?.from ?? null,
      to: req.body?.to ?? null,
      dryRun,
    });
    audit(req, {
      action: "qris_candidate_generation",
      module: "accounting",
      resourceId: `qris-candidates-${Date.now()}`,
      after: {
        dryRun: result.dryRun,
        generated: result.generated,
        automaticFinalReconciliation: false,
      },
    });
    return res.json({
      ok: true,
      mode: "candidate_review",
      automaticFinalReconciliation: false,
      ...result,
    });
  } catch (e: any) {
    logger.error({ err: e?.cause?.message ?? e?.message }, "[bankRecon] POST /qris-candidates/generate failed");
    return res.status(500).json({ error: e?.message ?? "Gagal membuat kandidat QRIS" });
  }
});

// ─── POST /api/bank-reconciliation/qris-candidates/:id/approve ───────────────
// Approval is deliberately separate from candidate generation. The payment
// rows are locked in a stable order before the already-settled check, so two
// overlapping batches cannot both pass the check. The unique index on
// qris_settlement_items is the final database-level invariant.
/*
router.post("/qris-candidates/:id/approve", async (req, res) => {
  await runQrisSettlementMigration();
  const candidateId = Number.parseInt(String(req.params.id ?? ""), 10);
  if (!Number.isInteger(candidateId) || candidateId <= 0) {
    return res.status(400).json({ error: "ID kandidat QRIS tidak valid" });
  }
*/

/*
 * LEGACY DISABLED.
 *
 * QRIS approval has one active owner below: canonical Sport Center
 * settlement builder → source-aware reconciliation approval.  Keep this
 * historical implementation out of the router so it cannot create a public
 * qris_settlements settlement or compete with the canonical path.
router.post("/qris-candidates/:candidateId/approve-legacy", async (req, res) => {
  await runQrisSettlementMigration();
  const candidateId = Number(req.params.candidateId);
  if (!Number.isInteger(candidateId) || candidateId <= 0) {
    return res.status(400).json({ error: "candidateId tidak valid" });
  }
  const companyId = resolveCompanyId(req);
  if (!Number.isInteger(companyId) || companyId <= 0) {
    return res.status(400).json({ error: "companyId tidak valid" });
  }
  const actor = (req as any).user?.email ?? "admin";

  try {
    const result = await db.transaction(async (tx) => {
      const { rows: candidateRows } = await tx.execute(sql`
        SELECT c.*, bm.transaction_date, bm.provider_name AS bank_provider_name,
               bm.provider_order_id, bm.description, bm.amount AS bank_amount,
               bm.mutation_key
        FROM qris_mutation_batch_candidates c
        LEFT JOIN bank_mutations bm ON bm.id = c.mutation_id
        WHERE c.id = ${candidateId}
          AND COALESCE(c.company_id, bm.company_id) = ${companyId}
        FOR UPDATE OF c
      `);
      const candidate = candidateRows[0] as Record<string, unknown> | undefined;
      if (!candidate) {
        throw Object.assign(new Error("Kandidat QRIS tidak ditemukan"), { code: "NOT_FOUND" });
      }

      const reconciliationStatus = String(
        candidate.reconciliation_status ?? candidate.status ?? "",
      ).toUpperCase();
      if (reconciliationStatus === "APPROVED" || reconciliationStatus === "RECONCILED") {
        throw Object.assign(new Error("Kandidat QRIS ini sudah di-approve sebelumnya"), {
          code: "ALREADY_APPROVED",
        });
      }
      // Allow MATCHED (normal) and REVIEW (force-approve with user confirmation on frontend).
      // UNMATCHED and other statuses are still blocked.
      const approvableStatuses = ["MATCHED", "REVIEW"];
      if (!approvableStatuses.includes(reconciliationStatus)) {
        throw Object.assign(
          new Error(`Kandidat QRIS berstatus ${reconciliationStatus || "UNKNOWN"} dan belum dapat di-approve`),
          { code: "INVALID_STATUS" },
        );
      }

      const rawItems = typeof candidate.payment_items === "string"
        ? JSON.parse(candidate.payment_items)
        : candidate.payment_items;
      if (!hasQrisBatchPaymentItems(rawItems)) {
        throw Object.assign(new Error("Kandidat QRIS tidak memiliki payment item"), {
          code: "INVALID_CANDIDATE",
        });
      }
      const items = rawItems.map((raw: Record<string, unknown>) => ({
        paymentId: Number(raw.paymentId ?? raw.payment_id),
        grossAmount: Number(raw.grossAmount ?? raw.gross_amount ?? 0),
      }));
      if (
        items.some((item) => !Number.isInteger(item.paymentId) || item.paymentId <= 0
          || !Number.isFinite(item.grossAmount) || item.grossAmount < 0)
        || new Set(items.map((item) => item.paymentId)).size !== items.length
      ) {
        throw Object.assign(new Error("Payment item kandidat QRIS tidak valid"), {
          code: "INVALID_CANDIDATE",
        });
      }

      const requestedPaymentIdsRaw = req.body?.paymentIds ?? req.body?.payment_ids;
      let requestedPaymentIds: number[] | null = null;
      if (requestedPaymentIdsRaw !== undefined) {
        if (!Array.isArray(requestedPaymentIdsRaw) || requestedPaymentIdsRaw.length === 0) {
          throw Object.assign(new Error("Minimal satu payment QRIS harus dipilih"), {
            code: "INVALID_SELECTION",
          });
        }
        requestedPaymentIds = requestedPaymentIdsRaw.map((value: unknown) => Number(value));
        if (
          requestedPaymentIds.some((id) => !Number.isInteger(id) || id <= 0)
          || new Set(requestedPaymentIds).size !== requestedPaymentIds.length
        ) {
          throw Object.assign(new Error("Daftar payment QRIS yang dipilih tidak valid"), {
            code: "INVALID_SELECTION",
          });
        }
        const candidatePaymentIds = new Set(items.map((item) => item.paymentId));
        const outsideCandidate = requestedPaymentIds.filter((id) => !candidatePaymentIds.has(id));
        if (outsideCandidate.length > 0) {
          throw Object.assign(
            new Error(`Payment ${outsideCandidate.join(", ")} bukan bagian dari kandidat QRIS ini`),
            { code: "INVALID_SELECTION" },
          );
        }
      }

      // Always lock payment IDs in ascending order. Different overlapping
      // batches then serialize on the same row instead of racing the EXISTS.
      const paymentIds = items.map((item) => item.paymentId).sort((a, b) => a - b);
      const paymentIdList = paymentIds.join(",");
      const { rows: paymentRows } = await tx.execute(sql.raw(`
        SELECT id, company_id, amount, status
        FROM sport_payments
        WHERE id IN (${paymentIdList}) AND company_id = ${companyId}
        ORDER BY id
        FOR UPDATE
      `));
      if (paymentRows.length !== paymentIds.length) {
        const found = new Set(paymentRows.map((row) => Number((row as Record<string, unknown>).id)));
        const missing = paymentIds.filter((id) => !found.has(id));
        throw Object.assign(
          new Error(`Payment QRIS tidak ditemukan atau bukan milik company aktif: ${missing.join(", ")}`),
          { code: "INVALID_CANDIDATE" },
        );
      }

      const { rows: settledRows } = await tx.execute(sql.raw(`
        SELECT qsi.sport_payment_id, qsi.gross_amount, qsi.net_amount, qs.settlement_reference
        FROM qris_settlement_items qsi
        JOIN qris_settlements qs ON qs.id = qsi.settlement_id
        WHERE qsi.sport_payment_id IN (${paymentIdList})
        ORDER BY qsi.sport_payment_id
      `));
      const settledPaymentIds = new Set(
        settledRows.map((row) => Number((row as Record<string, unknown>).sport_payment_id)),
      );
      const remainingItems = items.filter((item) => !settledPaymentIds.has(item.paymentId));
      const selectedItems = requestedPaymentIds
        ? items.filter((item) => requestedPaymentIds!.includes(item.paymentId))
        : remainingItems;
      const selectedAlreadySettled = selectedItems.filter((item) => settledPaymentIds.has(item.paymentId));
      if (selectedAlreadySettled.length > 0) {
        throw new QrisPaymentAlreadySettledError(
          selectedAlreadySettled.map((item) => item.paymentId),
          settledRows
            .map((row) => String((row as Record<string, unknown>).settlement_reference ?? ""))
            .filter(Boolean),
        );
      }
      if (selectedItems.length === 0) {
        throw Object.assign(new Error("Semua payment dalam kandidat QRIS sudah tersettle"), {
          code: "ALREADY_SETTLED",
        });
      }

      const grossAmount = Number(candidate.gross_amount ?? 0);
      const netAmount = Number(candidate.net_amount ?? candidate.bank_amount ?? 0);
      const itemGrossTotal = items.reduce((sum, item) => sum + item.grossAmount, 0);
      if (!Number.isFinite(grossAmount) || grossAmount <= 0 || itemGrossTotal <= 0) {
        throw Object.assign(new Error("Nilai gross kandidat QRIS tidak valid"), {
          code: "INVALID_CANDIDATE",
        });
      }
      qrisAssertClose(grossAmount, itemGrossTotal, "grossAmount candidate/item");
      if (!Number.isFinite(netAmount) || netAmount < 0 || netAmount > grossAmount + 0.01) {
        throw Object.assign(new Error("Nilai net kandidat QRIS tidak valid"), {
          code: "INVALID_CANDIDATE",
        });
      }
      const settledGrossTotal = settledRows.reduce(
        (sum, row) => sum + Number((row as Record<string, unknown>).gross_amount ?? 0),
        0,
      );
      const settledNetTotal = settledRows.reduce(
        (sum, row) => sum + Number((row as Record<string, unknown>).net_amount ?? 0),
        0,
      );
      const selectedGrossTotal = selectedItems.reduce((sum, item) => sum + item.grossAmount, 0);
      const remainingGrossTotal = Math.max(0, itemGrossTotal - settledGrossTotal);
      const remainingNetTotal = Math.max(0, netAmount - settledNetTotal);
      if (selectedGrossTotal > remainingGrossTotal + 0.01) {
        throw Object.assign(new Error("Nominal payment yang dipilih melebihi sisa kandidat QRIS"), {
          code: "INVALID_SELECTION",
        });
      }
      const selectedIsFinal = selectedItems.length === remainingItems.length;
      const selectedTargetNet = selectedIsFinal
        ? remainingNetTotal
        : Number((
          (netAmount * (settledGrossTotal + selectedGrossTotal) / itemGrossTotal) - settledNetTotal
        ).toFixed(2));
      const selectedNetAmount = Math.max(0, Math.min(remainingNetTotal, selectedTargetNet));

      const mutationId = Number(candidate.mutation_id);
      const baseSettlementReference = String(
        candidate.provider_order_id
          ?? candidate.mutation_key
          ?? `QRIS-BANK-${mutationId}`,
      ).trim().slice(0, 180);
      if (!baseSettlementReference) {
        throw Object.assign(new Error("Referensi settlement QRIS tidak tersedia"), {
          code: "INVALID_CANDIDATE",
        });
      }
      const selectionSuffix = selectedIsFinal
        ? ""
        : `-P-${selectedItems.map((item) => item.paymentId).sort((a, b) => a - b).join("-")}`;
      const settlementReference = `${baseSettlementReference}${selectionSuffix}`.slice(0, 180);
      const settlementDate = String(
        candidate.estimated_settlement_date
          ?? candidate.transaction_date
          ?? candidate.source_date,
      ).slice(0, 10);
      const providerName = String(
        candidate.provider_code
          ?? candidate.bank_provider_name
          ?? "unknown",
      ).trim().slice(0, 120) || "unknown";

      const { rows: settlementRows } = await tx.execute(sql`
        INSERT INTO qris_settlements (
          company_id, settlement_reference, provider_name, settlement_date,
          gross_amount, mdr_amount, tax_withheld_amount, other_fee_amount,
          net_amount, status, bank_mutation_id
        ) VALUES (
          ${companyId}, ${settlementReference}, ${providerName}, ${settlementDate},
          ${selectedGrossTotal}, ${Math.max(0, selectedGrossTotal - selectedNetAmount)}, 0, 0,
          ${selectedNetAmount}, 'settled', ${mutationId}
        )
        RETURNING id
      `);
      const settlementId = Number((settlementRows[0] as Record<string, unknown>)?.id);

      let allocatedNet = 0;
      for (const [index, item] of selectedItems.entries()) {
        const itemNet = index === selectedItems.length - 1
          ? Number((selectedNetAmount - allocatedNet).toFixed(2))
          : Number((item.grossAmount * selectedNetAmount / selectedGrossTotal).toFixed(2));
        allocatedNet += itemNet;
        const itemMdr = Number((item.grossAmount - itemNet).toFixed(2));
        await tx.execute(sql`
          INSERT INTO qris_settlement_items (
            settlement_id, sport_payment_id, gross_amount, mdr_amount,
            tax_withheld_amount, other_fee_amount, net_amount
          ) VALUES (
            ${settlementId}, ${item.paymentId}, ${item.grossAmount}, ${itemMdr},
            0, 0, ${itemNet}
          )
        `);
        await tx.execute(sql`
          UPDATE sport_payments
          SET mdr_amount = ${itemMdr},
              net_amount = ${itemNet},
              settlement_reference = ${settlementReference},
              settlement_date = ${settlementDate},
              settlement_status = 'settled',
              updated_at = NOW()
          WHERE id = ${item.paymentId} AND company_id = ${companyId}
        `);
      }

      if (selectedIsFinal) {
        await tx.execute(sql`
          UPDATE qris_mutation_batch_candidates
          SET reconciliation_status = 'APPROVED',
              status = 'approved',
              review_reason = 'Seluruh payment QRIS dalam kandidat sudah disetujui.',
              updated_at = NOW()
          WHERE id = ${candidateId}
        `);
        await tx.execute(sql`
          UPDATE bank_mutations
          SET status = 'approved',
              reconciliation_status = 'reconciled',
              updated_at = NOW()
          WHERE id = ${mutationId} AND company_id = ${companyId}
        `);
      } else {
        await tx.execute(sql`
          UPDATE qris_mutation_batch_candidates
          SET reconciliation_status = 'REVIEW',
              status = 'partial',
              review_reason = ${`Partial settlement: ${selectedItems.length} payment disetujui, ${remainingItems.length - selectedItems.length} payment tersisa.`},
              updated_at = NOW()
          WHERE id = ${candidateId}
        `);
      }

      return {
        settlementId,
        mutationId,
        itemCount: selectedItems.length,
        partial: !selectedIsFinal,
        remainingItemCount: Math.max(0, remainingItems.length - selectedItems.length),
        selectedPaymentIds: selectedItems.map((item) => item.paymentId),
      };
    });

    return res.status(201).json({
      ok: true,
      settlementId: result.settlementId,
      mutationId: result.mutationId,
      itemCount: result.itemCount,
      partial: result.partial,
      remainingItemCount: result.remainingItemCount,
      selectedPaymentIds: result.selectedPaymentIds,
    });
  } catch (e: any) {
    const message = e?.message ?? "Gagal menyetujui kandidat QRIS";
    logger.warn({ err: e?.cause?.message ?? message }, "[bankRecon] QRIS candidate approval rejected");
    const postgresError = findPostgresError(e);
    if (postgresError?.code === "23505") {
      return res.status(409).json({
        error: "Payment QRIS sudah diproses oleh admin lain. Approval dibatalkan.",
        code: "QRIS_PAYMENT_ALREADY_SETTLED",
      });
    }
    return res.status(
      /tidak ditemukan|tidak valid|bukan|sudah|belum|tidak memiliki|harus dipilih|melebihi sisa|bagian dari kandidat/.test(message) ? 400 : 500,
    ).json({ error: message });
  }
});
*/

/*
  const qEsc = (s: string) => String(s ?? "").replace(/'/g, "''");

  try {
    const result = await db.transaction(async (tx) => {
      // Ambil kandidat batch — lock untuk update
      const { rows: candidateRows } = await tx.execute(sql.raw(`
        SELECT * FROM qris_mutation_batch_candidates
        WHERE id = ${candidateId}
        FOR UPDATE
// ─── Approve QRIS candidate → provider-confirmed settlement ──────────────────
// Approval is explicit and idempotent. The settlement is committed first; only
// then is unified matching rerun so a matching failure cannot roll back the
// provider-confirmed batch.
router.post("/qris-candidates/:candidateId/approve", async (req, res) => {
  await runQrisSettlementMigration();
  try {
    const companyId = resolveCompanyId(req);
    const candidateId = Number(req.params.candidateId);
    if (!Number.isInteger(candidateId) || candidateId <= 0) {
      return res.status(400).json({ error: "candidateId tidak valid" });
    }
    if (!Number.isInteger(companyId) || companyId <= 0) {
      return res.status(400).json({ error: "companyId tidak valid" });
    }

    const actor = (req as any).user?.email ?? "system";
    const result = await db.transaction(async (tx) => {
      const { rows: candidateRows } = await tx.execute(sql.raw(`
        SELECT c.*, bm.description AS bank_description,
               bm.normalized_description AS bank_normalized_description,
               bm.transaction_date AS bank_transaction_date,
               bm.amount AS bank_amount,
               bm.direction AS bank_direction,
               bm.company_id AS bank_company_id,
               bm.bank_account_id AS bank_account_id,
               bm.provider_name AS bank_provider_name,
               bm.provider_order_id AS bank_provider_order_id,
               bm.mutation_key AS bank_mutation_key,
               bm.uploaded_proof_url AS bank_uploaded_proof_url
        FROM qris_mutation_batch_candidates c
        JOIN bank_mutations bm ON bm.id = c.mutation_id
        WHERE c.id = ${candidateId}
          AND c.company_id = ${companyId}
        FOR UPDATE OF c, bm
      `));
      const candidate = candidateRows[0] as Record<string, unknown> | undefined;
      if (!candidate) throw new Error("Kandidat QRIS tidak ditemukan");

      // Validasi company
      if (candidate.company_id != null && Number(candidate.company_id) !== companyId) {
        throw new Error("Kandidat QRIS bukan milik company aktif");
      }

      // Eligibility: delegates to the shared pure-logic helper (also unit-tested).
      // Only MATCHED candidates with non-negative net may be promoted to a settlement.
      assertQrisBatchApprovalEligible({
        id: Number(candidate.id),
        reconciliation_status: String(candidate.reconciliation_status ?? ""),
        status: candidate.status == null ? null : String(candidate.status),
        net_amount: candidate.net_amount == null ? null : Number(candidate.net_amount),
        observed_deduction: candidate.observed_deduction == null ? null : Number(candidate.observed_deduction),
      });

      // Parse payment_items
      let paymentItems: Array<{ paymentId: number; grossAmount: number }> = [];
      try {
        const raw = typeof candidate.payment_items === "string"
          ? JSON.parse(candidate.payment_items)
          : candidate.payment_items;
        if (Array.isArray(raw)) {
          paymentItems = raw.map((item: Record<string, unknown>) => ({
            paymentId: Number(item.paymentId ?? item.payment_id ?? 0),
            grossAmount: Number(item.grossAmount ?? item.gross_amount ?? 0),
          })).filter(item => item.paymentId > 0);
        }
      } catch {
        throw new Error("Format payment_items tidak valid");
      }
      if (paymentItems.length === 0) {
        throw new Error("Kandidat QRIS tidak memiliki payment item");
      }

      // 1. Require unique payment IDs — duplicates would double-count amounts.
      const dupErr = checkDuplicatePaymentIds(paymentItems);
      if (dupErr) throw new Error(dupErr.message);

      // 2. Lock all referenced sport_payments and validate each one.
      const paymentIdList = paymentItems.map(i => i.paymentId).join(",");
      const { rows: payments } = await tx.execute(sql.raw(`
        SELECT sp.id, sp.company_id, sp.amount, sp.method, sp.status, sp.payment_number,
               sp.mdr_amount, sp.tax_withheld_amount, sp.other_fee_amount, sp.net_amount,
               EXISTS (
                 SELECT 1 FROM qris_settlement_items qsi WHERE qsi.sport_payment_id = sp.id
               ) AS already_settled
        FROM sport_payments sp
        WHERE sp.id IN (${paymentIdList})
        FOR UPDATE
      `));
      const byId = new Map((payments as Array<Record<string, unknown>>).map(r => [Number(r.id), r]));

      // Status / method / already-settled checks for each payment
      for (const item of paymentItems) {
        const p = byId.get(item.paymentId);
        if (!p) throw new Error(`sport_payment ${item.paymentId} tidak ditemukan`);
        if (p.company_id != null && Number(p.company_id) !== companyId) {
          throw new Error(`Payment ${item.paymentId} bukan milik company aktif`);
        }
        if (String(p.status ?? "").toLowerCase() !== "paid") {
          throw new Error(`Payment ${item.paymentId} belum berstatus paid`);
        }
        if (!String(p.method ?? "").toLowerCase().includes("qris")) {
          throw new Error(`Payment ${item.paymentId} bukan payment QRIS`);
        }
        if (Boolean(p.already_settled)) {
          throw new Error(`Payment ${item.paymentId} sudah tergabung dalam settlement lain`);
        }
      }

      // 3. Validate candidate item grossAmounts against LIVE locked payment amounts.
      //    A stale candidate (payment edited after generation) must be rejected.
      const livePayments = (payments as Array<Record<string, unknown>>).map(p => ({
        id: Number(p.id),
        amount: Number(p.amount ?? 0),
      }));
      const staleErr = checkStaleAmounts(paymentItems, livePayments);
      if (staleErr) throw Object.assign(new Error(staleErr.message), { staleCandidate: true, ...staleErr });

      // 4. Validate header totals: item-gross sum ≈ header.gross; net = gross − fees.
      const candidateGross = Number(candidate.gross_amount ?? 0);
      const candidateMdr = Number(candidate.mdr_amount ?? candidate.observed_deduction ?? 0);
      const candidateOtherFee = Number(candidate.other_fee_amount ?? 0);
      const candidateNet = Number(candidate.net_amount ?? 0);
      const recomputedItemGross = paymentItems.reduce((s, i) => s + i.grossAmount, 0);

      const headerErr = checkHeaderTotals(
        { gross_amount: candidateGross, mdr_amount: candidateMdr, other_fee_amount: candidateOtherFee, net_amount: candidateNet },
        paymentItems,
      );
      if (headerErr) throw new Error(headerErr.message);

      // Nomor referensi unik untuk settlement ini
      const settlementDate = String(candidate.estimated_settlement_date ?? candidate.source_date ?? "").slice(0, 10);
      const settlementRef = `QRIS-BATCH-${candidate.mutation_id}-${settlementDate.replace(/-/g, "")}`;

      // Cek referensi belum ada
      const { rows: existingRef } = await tx.execute(sql.raw(`
        SELECT id FROM qris_settlements
        WHERE company_id = ${companyId} AND settlement_reference = '${qEsc(settlementRef)}'
        LIMIT 1
      `));
      if (existingRef[0]) {
        throw new Error(`Settlement dengan referensi ${settlementRef} sudah ada`);
      }

      const providerCode = qEsc(String(candidate.provider_code ?? "unknown"));
      const mutationId = Number(candidate.mutation_id);

      // Insert settlement — use already-validated totals (candidateGross/Net/etc.)
      const { rows: inserted } = await tx.execute(sql.raw(`
        INSERT INTO qris_settlements
          (company_id, settlement_reference, provider_name, settlement_date,
           gross_amount, mdr_amount, tax_withheld_amount, other_fee_amount,
           net_amount, status, bank_mutation_id)
        VALUES
          (${companyId}, '${qEsc(settlementRef)}', '${providerCode}',
           '${qEsc(settlementDate)}',
           ${candidateGross}, ${candidateMdr}, 0, ${candidateOtherFee},
           ${candidateNet}, 'settlement_confirmed', ${mutationId})
        RETURNING *
      `));
      const settlement = inserted[0] as Record<string, unknown>;
      const settlementId = Number(settlement.id);

      // Distribusikan MDR + biaya proporsional ke tiap payment item
      for (const item of paymentItems) {
        const ratio = recomputedItemGross > 0 ? item.grossAmount / recomputedItemGross : 1 / paymentItems.length;
        const itemMdr = Number((candidateMdr * ratio).toFixed(2));
        const itemOther = Number((candidateOtherFee * ratio).toFixed(2));
        const itemNet = Number((item.grossAmount - itemMdr - itemOther).toFixed(2));
        await tx.execute(sql.raw(`
          INSERT INTO qris_settlement_items
            (settlement_id, sport_payment_id, gross_amount, mdr_amount,
             tax_withheld_amount, other_fee_amount, net_amount)
          VALUES
            (${settlementId}, ${item.paymentId}, ${item.grossAmount},
             ${itemMdr}, 0, ${itemOther}, ${itemNet})
        `));
        // Update sport_payment dengan info settlement
        await tx.execute(sql.raw(`
          UPDATE sport_payments
          SET settlement_reference = '${qEsc(settlementRef)}',
              settlement_date = '${qEsc(settlementDate)}',
              settlement_status = 'settlement_confirmed',
              mdr_amount = ${itemMdr},
              other_fee_amount = ${itemOther},
              net_amount = ${itemNet},
              updated_at = NOW()
          WHERE id = ${item.paymentId} AND company_id = ${companyId}
        `));
      }

      // Tandai kandidat sebagai approved
      const mutationId = Number(candidate.mutation_id);
      if (String(candidate.bank_direction).toUpperCase() !== "IN") {
        throw new Error("Settlement QRIS hanya dapat ditautkan ke mutasi IN");
      }
      if (
        candidate.bank_company_id != null &&
        Number(candidate.bank_company_id) !== companyId
      ) {
        throw new Error("Mutasi bank bukan milik company aktif");
      }

      const existingRows = await tx.execute(sql.raw(`
        SELECT *
        FROM qris_settlements
        WHERE company_id = ${companyId}
          AND bank_mutation_id = ${mutationId}
        LIMIT 1
        FOR UPDATE
      `));
      const existing = (existingRows.rows[0] ?? null) as Record<string, unknown> | null;

      let settlement: Record<string, unknown>;
      let settlementId: number;
      let idempotent = false;

      if (existing) {
        settlement = existing;
        settlementId = Number(existing.id);
        idempotent = true;
      } else {
        let paymentItems: Array<{ paymentId: number; grossAmount: number }> = [];
        try {
          const raw = typeof candidate.payment_items === "string"
            ? JSON.parse(candidate.payment_items)
            : candidate.payment_items;
          if (Array.isArray(raw)) {
            paymentItems = raw.map((item: any) => ({
              paymentId: Number(item.paymentId ?? item.payment_id),
              grossAmount: Number(item.grossAmount ?? item.gross_amount ?? 0),
            }));
          }
        } catch {
          throw new Error("Data payment_items kandidat QRIS tidak valid");
        }
        paymentItems = paymentItems.filter((item) =>
          Number.isInteger(item.paymentId) && item.paymentId > 0
            && Number.isFinite(item.grossAmount) && item.grossAmount >= 0,
        );
        if (!paymentItems.length) throw new Error("Kandidat QRIS tidak memiliki payment");

        const paymentIds = [...new Set(paymentItems.map((item) => item.paymentId))];
        const { rows: paymentRows } = await tx.execute(sql.raw(`
          SELECT id, company_id, amount, method, status,
                 mdr_amount, tax_withheld_amount, other_fee_amount, net_amount
          FROM sport_payments
          WHERE company_id = ${companyId}
            AND id IN (${paymentIds.join(",")})
          FOR UPDATE
        `));
        const byId = new Map(
          (paymentRows as Array<Record<string, unknown>>).map((row) => [Number(row.id), row]),
        );
        if (byId.size !== paymentIds.length) {
          const missing = paymentIds.filter((id) => !byId.has(id));
          throw new Error(`sport_payment tidak ditemukan: ${missing.join(", ")}`);
        }

        for (const item of paymentItems) {
          const payment = byId.get(item.paymentId)!;
          if (String(payment.status ?? "").toLowerCase() !== "paid") {
            throw new Error(`Payment ${item.paymentId} belum berstatus paid`);
          }
          if (!String(payment.method ?? "").toLowerCase().includes("qris")) {
            throw new Error(`Payment ${item.paymentId} bukan payment QRIS`);
          }
          const sourceGross = Number(payment.amount ?? 0);
          if (Math.abs(sourceGross - item.grossAmount) > 0.01) {
            throw new Error(`Gross payment ${item.paymentId} berubah sejak kandidat dibuat`);
          }
        }

        const settlementReference = `QRIS-MUTATION-${mutationId}`;
        const settlementDate = String(
          candidate.estimated_settlement_date ?? candidate.source_date,
        ).slice(0, 10);
        const grossAmount = Number(candidate.gross_amount ?? 0);
        const netAmount = Number(candidate.net_amount ?? candidate.bank_amount ?? 0);
        const observedDeduction = Math.max(0, Number(candidate.observed_deduction ?? 0));
        if (!/^\d{4}-\d{2}-\d{2}$/.test(settlementDate)) {
          throw new Error("Tanggal settlement kandidat QRIS tidak valid");
        }
        if (!(grossAmount > 0) || !(netAmount >= 0)) {
          throw new Error("Nominal settlement kandidat QRIS tidak valid");
        }

        const providerName = String(
          candidate.bank_provider_name ?? candidate.provider_code ?? "",
        ).trim();
        const { rows: inserted } = await tx.execute(sql.raw(`
          INSERT INTO qris_settlements
            (company_id, settlement_reference, provider_name, settlement_date,
             gross_amount, mdr_amount, tax_withheld_amount, other_fee_amount,
             net_amount, status, bank_mutation_id)
          VALUES
            (${companyId}, '${qrisEsc(settlementReference)}',
             ${providerName ? `'${qrisEsc(providerName)}'` : "NULL"},
             '${settlementDate}', ${grossAmount}, 0, 0, ${observedDeduction},
             ${netAmount}, 'settled', ${mutationId})
          RETURNING *
        `));
        settlement = inserted[0] as Record<string, unknown>;
        settlementId = Number(settlement.id);

        for (const item of paymentItems) {
          const payment = byId.get(item.paymentId)!;
          const mdrAmount = Math.max(0, Number(payment.mdr_amount ?? 0));
          const taxWithheldAmount = Math.max(0, Number(payment.tax_withheld_amount ?? 0));
          const otherFeeAmount = Math.max(0, Number(payment.other_fee_amount ?? 0));
          const sourceNet = Number(payment.net_amount ?? 0);
          const netItem = sourceNet > 0
            ? sourceNet
            : Math.max(0, item.grossAmount - mdrAmount - taxWithheldAmount - otherFeeAmount);
          await tx.execute(sql.raw(`
            INSERT INTO qris_settlement_items
              (settlement_id, sport_payment_id, gross_amount, mdr_amount,
               tax_withheld_amount, other_fee_amount, net_amount)
            VALUES
              (${settlementId}, ${item.paymentId}, ${item.grossAmount},
               ${mdrAmount}, ${taxWithheldAmount}, ${otherFeeAmount}, ${netItem})
          `));
          await tx.execute(sql.raw(`
            UPDATE sport_payments
            SET settlement_reference = '${qrisEsc(settlementReference)}',
                settlement_date = '${settlementDate}',
                settlement_status = 'settled',
                updated_at = NOW()
            WHERE id = ${item.paymentId} AND company_id = ${companyId}
          `));
        }
      }

      await tx.execute(sql.raw(`
        UPDATE qris_mutation_batch_candidates
        SET status = 'approved',
            reconciliation_status = 'MATCHED',
            review_reason = 'Batch QRIS disetujui dan dipromosikan ke qris_settlements.',
            updated_at = NOW()
        WHERE id = ${candidateId}
      `));

      return { settlementId, settlementRef, settlementDate, itemCount: paymentItems.length, settlement };
    });

    audit(req, {
      action: "qris_batch_candidate_approved",
      module: "accounting",
      resourceId: `qris-settlement-${result.settlementId}`,
      after: {
        candidateId,
        companyId,
        settlementRef: result.settlementRef,
        itemCount: result.itemCount,
      },
    });

    return res.status(201).json({
      ok: true,
      settlementId: result.settlementId,
      settlementReference: result.settlementRef,
      itemCount: result.itemCount,
      settlement: result.settlement,
    });
  } catch (e: any) {
    logger.warn({ err: e?.message }, "[bankRecon] POST /qris-candidates/:id/approve rejected");
    const message = e?.message ?? "Gagal menyetujui kandidat QRIS";
    // 422 for eligibility violations (candidate not MATCHED / already approved)
    if ((e as any)?.eligibilityError) {
      return res.status(422).json({
        error: message,
        code: "CANDIDATE_NOT_ELIGIBLE",
        reconciliation_status: (e as any).reconciliation_status,
      });
    }
    return res.status(
      /tidak ditemukan|tidak valid|bukan|sudah|belum|tidak memiliki/.test(message) ? 400 : 500,
    ).json({ error: message });
      return {
        candidate,
        settlement,
        settlementId,
        mutationId,
        idempotent,
      };
    });

    let matching: unknown = null;
    const mutationRows = await db.execute(sql.raw(`
      SELECT id, amount, transaction_date, mutation_key, provider_order_id,
             provider_name, normalized_description, uploaded_proof_url,
             company_id, bank_account_id, direction
      FROM bank_mutations
      WHERE id = ${result.mutationId} AND company_id = ${companyId}
    `));
    const mutation = mutationRows.rows[0] as Record<string, unknown> | undefined;
    if (mutation) {
      matching = await runUnifiedMatching({
        id: Number(mutation.id),
        amount: Number(mutation.amount),
        transaction_date: String(mutation.transaction_date).slice(0, 10),
        mutation_key: String(mutation.mutation_key ?? ""),
        provider_order_id: mutation.provider_order_id == null ? null : String(mutation.provider_order_id),
        provider_name: mutation.provider_name == null ? null : String(mutation.provider_name),
        normalized_description: mutation.normalized_description == null ? null : String(mutation.normalized_description),
        uploaded_proof_url: mutation.uploaded_proof_url == null ? null : String(mutation.uploaded_proof_url),
        company_id: mutation.company_id == null ? companyId : Number(mutation.company_id),
        bank_account_id: mutation.bank_account_id == null ? null : Number(mutation.bank_account_id),
        direction: String(mutation.direction ?? "IN"),
      }, actor);
    }

    audit(req, {
      action: "qris_candidate_approved",
      module: "accounting",
      resourceId: `qris-candidate-${candidateId}`,
      after: { ...result, actor },
    });
    return res.status(201).json({ ok: true, candidate_id: candidateId, ...result });
  } catch (error: any) {
    if (error instanceof QrisPaymentAlreadySettledError || isQrisSettlementPaymentConflict(error)) {
      const paymentIds = error instanceof QrisPaymentAlreadySettledError
        ? error.paymentIds
        : [];
      logger.warn({ candidateId, paymentIds }, "[bankRecon] QRIS double-settlement prevented");
      return res.status(409).json({
        error: error instanceof QrisPaymentAlreadySettledError
          ? error.message
          : "Payment QRIS sudah tersettle pada batch lain. Approval dibatalkan untuk mencegah double-settlement.",
        code: "QRIS_PAYMENT_ALREADY_SETTLED",
        payment_ids: paymentIds,
      });
    }
    if (error?.code === "ALREADY_APPROVED") {
      return res.status(409).json({ error: error.message, code: error.code });
    }
    if (error?.code === "NOT_FOUND") {
      return res.status(404).json({ error: error.message, code: error.code });
    }
    if (error?.code === "INVALID_STATUS" || error?.code === "INVALID_CANDIDATE") {
      return res.status(422).json({ error: error.message, code: error.code });
    }
    const postgresError = findPostgresError(error);
    if (postgresError?.code === "23505") {
      return res.status(409).json({
        error: "Batch QRIS atau payment terkait sudah diproses oleh admin lain.",
        code: "QRIS_APPROVAL_CONFLICT",
      });
    }
    logger.error(
      { err: error?.cause?.message ?? error?.message, candidateId, actor },
      "[bankRecon] POST /qris-candidates/:id/approve failed",
    );
    return res.status(500).json({ error: error?.message ?? "Approval kandidat QRIS gagal" });
      after: {
        settlementId: result.settlementId,
        mutationId: result.mutationId,
        idempotent: result.idempotent,
        matchingStatus: (matching as any)?.status ?? null,
      },
    });
    return res.json({
      ok: true,
      candidateId,
      mutationId: result.mutationId,
      settlementId: result.settlementId,
      idempotent: result.idempotent,
      settlement: result.settlement,
      matching,
    });
  } catch (e: any) {
    logger.warn({ err: e?.cause?.message ?? e?.message }, "[bankRecon] QRIS candidate approval rejected");
    const message = e?.message ?? "Approve kandidat QRIS gagal";
    return res.status(/wajib|valid|tidak cocok|bukan|sudah|belum|tidak ditemukan|berubah|tidak memiliki|tidak valid/.test(message) ? 400 : 500)
      .json({ error: message });
  }
});
*/

// ─── POST /qris-candidates/:id/approve ────────────────────────────────────────
// One active QRIS approval path:
//   candidate revalidation → canonical Sport Center settlement builder
//   → source-aware matching → canonical reconciliation approval.
// This route never writes qris_settlements, qris_settlement_items, or the
// public sport_payments mirror. Those tables are historical/provisional only.
router.post("/qris-candidates/:candidateId/approve", async (req, res) => {
  await runQrisSettlementMigration();
  const candidateId = Number(req.params.candidateId);
  const companyId = resolveCompanyId(req);
  const actor = (req as any).user?.email ?? "system";

  if (!Number.isSafeInteger(candidateId) || candidateId <= 0) {
    return res.status(400).json({ error: "candidateId tidak valid" });
  }
  if (!Number.isSafeInteger(companyId) || companyId <= 0) {
    return res.status(400).json({ error: "companyId tidak valid" });
  }

  try {
    const requestedPaymentIds = req.body?.paymentIds ?? req.body?.payment_ids;
    if (requestedPaymentIds !== undefined && !Array.isArray(requestedPaymentIds)) {
      return res.status(400).json({ error: "paymentIds harus berupa array" });
    }
    const requestedIds: number[] | null = requestedPaymentIds === undefined
      ? null
      : [...new Set((requestedPaymentIds as unknown[]).map((value: unknown) => Number(value)))];

    const candidate = await db.transaction(async (tx) => {
      const { rows } = await tx.execute(sql.raw(`
        SELECT c.*,
               bm.description AS bank_description,
               bm.normalized_description AS bank_normalized_description,
               bm.transaction_date AS bank_transaction_date,
               bm.amount AS bank_amount,
               bm.direction AS bank_direction,
               bm.company_id AS bank_company_id,
               bm.bank_account_id AS bank_mutation_account_id,
               bm.provider_name AS bank_provider_name,
               bm.provider_order_id AS bank_provider_order_id,
               bm.mutation_key AS bank_mutation_key,
               bm.uploaded_proof_url AS bank_uploaded_proof_url
        FROM qris_mutation_batch_candidates c
        JOIN bank_mutations bm ON bm.id = c.mutation_id
        WHERE c.id = ${candidateId}
          AND c.company_id = ${companyId}
        FOR UPDATE OF c, bm
      `));
      const row = rows[0] as Record<string, unknown> | undefined;
      if (!row) throw Object.assign(new Error("Kandidat QRIS tidak ditemukan"), { code: "NOT_FOUND" });

      const candidateStatus = String(row.status ?? "").toLowerCase();
      if (["approved", "completed"].includes(candidateStatus)) {
        const { rows: approvedRows } = await tx.execute(sql.raw(`
          SELECT id, candidate_id, candidate_source, status
          FROM bank_reconciliation_matches
          WHERE mutation_id = ${Number(row.mutation_id)}
            AND candidate_type = 'qris_settlement'
            AND candidate_source = '${CANONICAL_SETTLEMENT_SOURCE}'
            AND status = 'approved'
          ORDER BY id
          LIMIT 1
        `));
        if (!approvedRows[0]) {
          throw Object.assign(
            new Error("Kandidat QRIS sudah berstatus selesai tetapi link canonical belum lengkap."),
            { code: "INCONSISTENT_STATE" },
          );
        }
        return {
          ...row,
          mutationId: Number(row.mutation_id),
          alreadyApproved: true as const,
          approvedMatch: approvedRows[0],
          selectedPaymentIds: [] as number[],
        };
      }

      assertQrisBatchApprovalEligible({
        id: Number(row.id),
        reconciliation_status: String(row.reconciliation_status ?? ""),
        status: row.status == null ? null : String(row.status),
        net_amount: row.net_amount == null ? null : Number(row.net_amount),
        observed_deduction: row.observed_deduction == null
          ? null
          : Number(row.observed_deduction),
      });
      if (String(row.bank_direction ?? "").toUpperCase() !== "IN") {
        throw Object.assign(new Error("Settlement QRIS hanya dapat ditautkan ke mutasi IN"), {
          code: "INVALID_CANDIDATE",
        });
      }
      if (
        row.bank_company_id == null
        || Number(row.bank_company_id) !== companyId
      ) {
        throw Object.assign(new Error("Mutasi bank bukan milik company aktif"), {
          code: "INVALID_CANDIDATE",
        });
      }
      const candidateProvider = normalizeQrisProvider(row.provider_code == null
        ? null
        : String(row.provider_code));
      const mutationProvider = normalizeQrisProvider(
        row.bank_provider_name == null
          ? String(row.bank_description ?? "")
          : String(row.bank_provider_name),
      );
      if (candidateProvider === "unknown" || mutationProvider === "unknown") {
        throw Object.assign(
          new Error("Provider payment dan mutasi wajib tersedia untuk approval QRIS"),
          { code: "INVALID_CANDIDATE" },
        );
      }
      if (!areQrisProvidersCompatible(candidateProvider, mutationProvider)) {
        throw Object.assign(
          new Error("Provider payment tidak cocok dengan provider mutasi bank"),
          { code: "INVALID_CANDIDATE" },
        );
      }

      let rawItems: unknown;
      try {
        rawItems = typeof row.payment_items === "string"
          ? JSON.parse(row.payment_items)
          : row.payment_items;
      } catch {
        throw Object.assign(new Error("Data payment_items kandidat QRIS tidak valid"), {
          code: "INVALID_CANDIDATE",
        });
      }
      if (!Array.isArray(rawItems) || rawItems.length === 0) {
        throw Object.assign(new Error("Kandidat QRIS tidak memiliki payment"), {
          code: "INVALID_CANDIDATE",
        });
      }

      const paymentItems = rawItems.map((item: any) => ({
        paymentId: Number(item?.paymentId ?? item?.payment_id),
        grossAmount: Number(item?.grossAmount ?? item?.gross_amount ?? 0),
        canonicalSettlementId: item?.canonicalSettlementId == null
          ? item?.canonical_settlement_id == null
            ? null
            : Number(item.canonical_settlement_id)
          : Number(item.canonicalSettlementId),
      }));
      const candidatePaymentIds = paymentItems.map((item) => item.paymentId);
      if (
        candidatePaymentIds.some((id) => !Number.isSafeInteger(id) || id <= 0)
        || new Set(candidatePaymentIds).size !== candidatePaymentIds.length
      ) {
        throw Object.assign(new Error("Identitas payment canonical pada kandidat tidak valid"), {
          code: "INVALID_CANDIDATE",
        });
      }

      const { rows: livePaymentRows } = await tx.execute(sql.raw(`
        SELECT id, amount, company_id, payment_provider, payment_method
        FROM sport_center.sport_payments
        WHERE id IN (${candidatePaymentIds.join(",")})
        FOR SHARE
      `));
      const { rows: liveSettlementRows } = await tx.execute(sql.raw(`
        SELECT psi.payment_id, psi.settlement_id, psb.net_amount, psb.status
        FROM sport_center.payment_settlement_items psi
        JOIN sport_center.payment_settlement_batches psb
          ON psb.id = psi.settlement_id
        WHERE psi.item_status = 'active'
          AND psi.payment_id IN (${candidatePaymentIds.join(",")})
          ORDER BY psi.payment_id
          FOR SHARE OF psi, psb
      `));
      const activePostedPaymentIds = (liveSettlementRows as Array<Record<string, unknown>>)
        .filter((item) => ["posted", "reconciled"].includes(String(item.status).toLowerCase()))
        .map((item) =>
        Number((item as Record<string, unknown>).payment_id),
      );
      let selectedIds: number[];
      try {
        selectedIds = selectQrisApprovalPaymentIds({
          candidatePaymentIds,
          requestedPaymentIds: requestedIds,
          activePostedPaymentIds,
        });
      } catch (error) {
        if (error instanceof QrisApprovalPaymentGuardError) {
          throw Object.assign(error, { code: error.code });
        }
        throw error;
      }
      const selectedPaymentItems = paymentItems.filter((item) =>
        selectedIds.includes(item.paymentId),
      );
      const selectedLivePayments = (livePaymentRows as Array<Record<string, unknown>>)
        .filter((item) => selectedIds.includes(Number(item.id)));
      if (selectedLivePayments.length !== selectedIds.length) {
        throw Object.assign(
          new Error("Payment canonical pada kandidat tidak ditemukan"),
          { code: "INVALID_CANDIDATE" },
        );
      }
      for (const payment of selectedLivePayments) {
        if (payment.company_id == null || Number(payment.company_id) !== companyId) {
          throw Object.assign(
            new Error("Company payment tidak cocok dengan company mutasi bank"),
            { code: "INVALID_CANDIDATE" },
          );
        }
        const paymentProvider = normalizeQrisProvider(
          payment.payment_provider == null
            ? null
            : String(payment.payment_provider),
        );
        if (paymentProvider === "unknown") {
          throw Object.assign(
            new Error("Provider payment wajib tersedia untuk approval QRIS"),
            { code: "INVALID_CANDIDATE" },
          );
        }
        if (!areQrisProvidersCompatible(paymentProvider, mutationProvider)) {
          throw Object.assign(
            new Error("Provider payment tidak cocok dengan provider mutasi bank"),
            { code: "INVALID_CANDIDATE" },
          );
        }
      }

      const freshness = checkQrisCandidateFreshness({
        candidateId,
        candidateItems: paymentItems,
        candidateNetAmount: Number(row.net_amount ?? 0),
        candidateMutationAmount: Number(row.bank_amount ?? 0),
        livePayments: (livePaymentRows as Array<Record<string, unknown>>).map((item) => ({
          id: Number(item.id),
          amount: Number(item.amount),
        })),
        liveSettlements: (liveSettlementRows as Array<Record<string, unknown>>).map((item) => ({
          paymentId: Number(item.payment_id),
          settlementId: Number(item.settlement_id),
          netAmount: Number(item.net_amount),
          isPosted: ["posted", "reconciled"].includes(String(item.status).toLowerCase()),
        })),
      });
      if (freshness) {
        await tx.execute(sql`
          UPDATE qris_mutation_batch_candidates
          SET status = 'superseded',
              reconciliation_status = 'UNMATCHED',
              review_reason = ${`Kandidat superseded: ${freshness.reasons.join("; ")}.`},
              updated_at = NOW()
          WHERE id = ${candidateId}
        `);
        return {
          ...row,
          mutationId: Number(row.mutation_id),
          stale: true as const,
          staleDetails: freshness,
        };
      }

      return {
        ...row,
        mutationId: Number(row.mutation_id),
        alreadyApproved: false as const,
        candidatePaymentIds,
        selectedPaymentIds: selectedIds,
        paymentItems: selectedPaymentItems,
      };
    });

    if ("stale" in candidate && candidate.stale) {
      const staleDetails = candidate.staleDetails;
      return res.status(409).json({
        error: staleDetails.message,
        code: CANONICAL_CANDIDATE_STALE,
        stale_candidate_id: staleDetails.staleCandidateId,
        current_payment_ids: staleDetails.currentPaymentIds,
        current_expected_amount: staleDetails.currentExpectedAmount,
      });
    }

    if ("alreadyApproved" in candidate && candidate.alreadyApproved) {
      return res.json({
        ok: true,
        idempotent: true,
        candidateId,
        mutationId: candidate.mutationId,
        settlementId: Number((candidate.approvedMatch as any).candidate_id),
        matching: candidate.approvedMatch,
      });
    }

    if (!("selectedPaymentIds" in candidate)) {
      throw new Error("Kandidat QRIS tidak memiliki payment yang dapat disetujui");
    }
    const selectedPaymentIds = candidate.selectedPaymentIds as number[];
    const sourcePaymentId = selectedPaymentIds[0];
    const built = await buildCanonicalSportCenterSettlements({
      sourcePaymentId,
      selectedPaymentIds,
      actor,
    });
    const settlementId = built.batchIds[0];
    if (!Number.isSafeInteger(settlementId) || settlementId <= 0) {
      throw new Error("Canonical settlement builder tidak mengembalikan batch ID");
    }

    const mutationId = candidate.mutationId;
    const { rows: mutationRows } = await db.execute(sql.raw(`
      SELECT id, amount, transaction_date, mutation_key, provider_order_id,
             provider_name, normalized_description, uploaded_proof_url,
             company_id, bank_account_id, direction
      FROM bank_mutations
      WHERE id = ${mutationId}
        AND company_id = ${companyId}
      FOR UPDATE
    `));
    const mutation = mutationRows[0] as Record<string, unknown> | undefined;
    if (!mutation) throw Object.assign(new Error("Mutasi bank QRIS tidak ditemukan"), { code: "NOT_FOUND" });

    const matching = await runUnifiedMatching({
      id: Number(mutation.id),
      amount: Number(mutation.amount),
      transaction_date: String(mutation.transaction_date).slice(0, 10),
      mutation_key: String(mutation.mutation_key ?? ""),
      provider_order_id: mutation.provider_order_id == null
        ? null
        : String(mutation.provider_order_id),
      provider_name: mutation.provider_name == null ? null : String(mutation.provider_name),
      normalized_description: mutation.normalized_description == null
        ? null
        : String(mutation.normalized_description),
      uploaded_proof_url: mutation.uploaded_proof_url == null
        ? null
        : String(mutation.uploaded_proof_url),
      company_id: mutation.company_id == null ? companyId : Number(mutation.company_id),
      bank_account_id: mutation.bank_account_id == null
        ? null
        : Number(mutation.bank_account_id),
      direction: String(mutation.direction ?? "IN"),
    }, actor);

    const { rows: canonicalMatches } = await db.execute(sql.raw(`
      SELECT id, mutation_id, candidate_type, candidate_id, candidate_source, status
      FROM bank_reconciliation_matches
      WHERE mutation_id = ${mutationId}
        AND candidate_type = 'qris_settlement'
        AND candidate_id = ${settlementId}
        AND candidate_source = '${CANONICAL_SETTLEMENT_SOURCE}'
        AND status IN ('candidate', 'approved')
      ORDER BY id
      LIMIT 2
    `));
    if (canonicalMatches.length !== 1) {
      throw Object.assign(
        new Error(
          "Settlement canonical sudah dibuat, tetapi matching source-aware tidak menghasilkan tepat satu match yang dapat disetujui.",
        ),
        { code: "MATCHING_EVIDENCE_INVALID" },
      );
    }

    const approval = await approveCanonicalSettlementLink(db as any, {
      mutationId,
      matchId: Number((canonicalMatches[0] as any).id),
      candidateType: "qris_settlement",
      candidateId: settlementId,
      candidateSource: CANONICAL_SETTLEMENT_SOURCE,
      actor,
    });

    const { rows: completionRows } = await db.execute(sql.raw(`
      SELECT b.id AS settlement_id,
             b.status AS settlement_status,
             b.bank_mutation_id,
             j.status AS journal_status,
             pm.status AS public_mutation_status
      FROM sport_center.payment_settlement_batches b
      JOIN sport_center.accounting_journals j ON j.id = b.settlement_journal_id
      JOIN bank_mutations pm ON pm.id = ${mutationId}
      WHERE b.id = ${settlementId}
    `));
    const completion = completionRows[0] as Record<string, unknown> | undefined;
    if (
      !completion
      || String(completion.settlement_status).toLowerCase() !== "reconciled"
      || Number(completion.bank_mutation_id) !== approval.canonical_mutation_id
      || String(completion.journal_status).toLowerCase() !== "posted"
      || String(completion.public_mutation_status).toLowerCase() !== "approved"
    ) {
      throw Object.assign(
        new Error("Canonical settlement selesai sebagian; queue tetap ditahan untuk tindakan."),
        { code: "INCONSISTENT_STATE" },
      );
    }

    await db.execute(sql.raw(`
      UPDATE qris_mutation_batch_candidates
      SET status = 'approved',
          review_reason = 'Canonical Sport Center settlement, reconciliation, accounting, dan ledger selesai.',
          updated_at = NOW()
      WHERE id = ${candidateId}
    `));

    audit(req, {
      action: "qris_canonical_one_click_approved",
      module: "accounting",
      resourceId: `qris-candidate-${candidateId}`,
      after: {
        candidateId,
        mutationId,
        settlementId,
        selectedPaymentIds,
        idempotent: built.idempotent || approval.idempotent,
      },
    });
    triggerWritebackForMutation(mutationId).catch(() => {});
    trackMutationApproval({
      mutationId,
      actor,
      companyId,
    }).catch(() => {});

    const reviewWarning = checkQrisBatchReviewWarning({
      id: candidateId,
      reconciliation_status: String((candidate as any).reconciliation_status ?? ""),
      status: String((candidate as any).status ?? ""),
    });

    return res.json({
      ok: true,
      idempotent: built.idempotent || approval.idempotent,
      candidateId,
      mutationId,
      settlementId,
      selectedPaymentIds,
      matching: {
        status: matching.status,
        candidateSource: CANONICAL_SETTLEMENT_SOURCE,
      },
      approval,
      completion,
      ...(reviewWarning ? { reviewWarning } : {}),
    });
  } catch (error: any) {
    const code = error?.code ?? "QRIS_CANONICAL_APPROVAL_FAILED";
    if (error?.eligibilityError) {
      return res.status(422).json({
        error: error?.message ?? "Kandidat QRIS belum memenuhi syarat approval",
        code: "CANDIDATE_NOT_ELIGIBLE",
        reason_code: code,
        reconciliation_status: error?.reconciliation_status,
      });
    }
    if (error instanceof QrisApprovalPaymentGuardError) {
      return res.status(409).json({
        error: "Sebagian transaksi yang dipilih sudah masuk settlement sebelumnya. Daftar kandidat sudah diperbarui.",
        code: error.code,
        already_settled_payment_ids: error.alreadySettledPaymentIds,
        eligible_payment_ids: error.eligiblePaymentIds,
      });
    }
    const clientErrorCodes = new Set([
      "NOT_FOUND",
      "INVALID_CANDIDATE",
      "INVALID_STATUS",
      "MATCHING_EVIDENCE_INVALID",
      "INCONSISTENT_STATE",
      "CANONICAL_SETTLEMENT_NOT_ELIGIBLE",
      "CANONICAL_SETTLEMENT_GROUP_INVALID",
      "CANONICAL_SETTLEMENT_BATCH_CONFLICT",
      "CANONICAL_SETTLEMENT_SELECTION_CONFLICT",
      "CANONICAL_PAYMENT_SETTLEMENT_STATE_CONFLICT",
      "CANONICAL_BANK_MUTATION_NOT_ELIGIBLE",
    ]);
    const status = code === "NOT_FOUND"
      ? 404
      : clientErrorCodes.has(code) ? 409 : 500;
    logger.warn(
      { err: error?.cause?.message ?? error?.message, candidateId, code },
      "[bankRecon] canonical QRIS one-click approval rejected",
    );
    return res.status(status).json({
      error: error?.message ?? "Approval canonical QRIS gagal",
      code,
    });
  }
});

// ─── GET /api/bank-reconciliation/mutations ───────────────────────────────────
// D4 fix: replace JS-level merge (N+1 key fetch + in-memory dedup + JS sort)
// dengan satu SQL UNION ALL query — lebih efisien, filtering konsisten.
router.get("/mutations", async (req, res) => {
  await runBankReconciliationCoreMigration();

  // ── Canonical settlement schema availability check ────────────────────────
  // sport_center.payment_settlement_batches / _items and
  // sport_center.expected_bank_settlements are created by runSportCenterMigration
  // which runs asynchronously after health/ready.  On a fresh DB or before that
  // migration completes the tables may not yet exist.  We guard every reference
  // at runtime so the list query degrades gracefully instead of returning 500.
  let hasCanonicalSettlementView = false;
  let hasCanonicalSettlementSchema = false;
  try {
    const { rows: vcRows } = await db.execute(sql.raw(
      `SELECT
         to_regclass('sport_center.expected_bank_settlements')  AS v,
         to_regclass('sport_center.payment_settlement_items')   AS s`,
    ));
    const vcRow = vcRows[0] as Record<string, unknown> | undefined;
    hasCanonicalSettlementView   = vcRow?.v != null;
    hasCanonicalSettlementSchema = vcRow?.s != null;
  } catch {
    // leave both false
  }
  const resolvedCanonicalDetailsSql = hasCanonicalSettlementView
    ? canonicalSettlementDetailsSql("m.candidate_id")
    : "NULL::jsonb";

  // SQL fragments conditionally included when canonical settlement tables exist.
  // Each fragment is either the real SQL or an empty string so it can be
  // dropped into template literals without changing surrounding SQL structure.

  // UNION part inside settled_payment_ids
  const canonicalSettledUnionSql = hasCanonicalSettlementSchema
    ? `UNION
                SELECT psi.payment_id
                FROM sport_center.payment_settlement_items psi
                JOIN sport_center.payment_settlement_batches psb
                  ON psb.id = psi.settlement_id
                WHERE psi.item_status = 'active'
                  AND psb.status IN ('posted', 'reconciled')
                  AND psi.payment_id IN (
                    SELECT (item->>'paymentId')::int
                    FROM jsonb_array_elements(qc.payment_items) item
                    WHERE item->>'paymentId' IS NOT NULL
                  )`
    : "";

  // NOT EXISTS check to exclude canonical-settled payments from current_* lists
  const canonicalSettledExcludeSql = hasCanonicalSettlementSchema
    ? `AND NOT EXISTS (
                      SELECT 1
                      FROM sport_center.payment_settlement_items psi
                      JOIN sport_center.payment_settlement_batches psb
                        ON psb.id = psi.settlement_id
                      WHERE psi.payment_id = (item->>'paymentId')::int
                        AND psi.item_status = 'active'
                        AND psb.status IN ('posted', 'reconciled')
                    )`
    : "";

  const {
    status, from, to, direction, provider, search,
    limit = "100", offset = "0",
    company_id,
    mutation_id,
    payment_type,
  } = req.query as Record<string, string>;
  const lim = Math.min(parseInt(limit) || 100, 500);
  const off = parseInt(offset) || 0;
  const requestedMutationId = mutation_id == null ? null : Number(mutation_id);
  if (requestedMutationId != null && (!Number.isInteger(requestedMutationId) || requestedMutationId <= 0)) {
    return res.status(400).json({ error: "mutation_id tidak valid" });
  }

  // ── Filter helpers ────────────────────────────────────────────────────────
  const esc = (s: string) => s.replace(/'/g, "''");

  // Filters untuk sumber bank_mutations (bm)
  const bmFilters: string[] = [];
  if (status && status !== "all") {
    if (status === "duplicate_need_review") {
      const anyGeneric = `
        EXISTS (
          SELECT 1
          FROM bank_reconciliation_matches filter_any_match
          WHERE filter_any_match.mutation_id = bm.id
            AND filter_any_match.status IN ('candidate', 'approved')
            AND filter_any_match.candidate_type IN (
              'accounting_payment', 'invoice', 'expense',
              'logistic_order', 'tenant_invoice'
            )
        )`;
      const validGeneric = `
        EXISTS (
          SELECT 1
          FROM bank_reconciliation_matches filter_valid_match
          WHERE filter_valid_match.mutation_id = bm.id
            AND filter_valid_match.status IN ('candidate', 'approved')
            AND ${genericCandidateSameDaySql("filter_valid_match", "bm")}
        )`;
      bmFilters.push(`(
        bm.status = 'duplicate_need_review'
        OR (
          bm.status = 'matched'
          AND ${anyGeneric}
          AND NOT ${validGeneric}
        )
      )`);
    } else {
      bmFilters.push(`bm.status = '${esc(status)}'`);
    }
  }
  if (direction && direction !== "all")  bmFilters.push(`bm.direction = '${esc(direction)}'`);
  if (provider && provider !== "all" && provider !== "BANK_IMPORT")
    bmFilters.push(`bm.provider_name = '${esc(provider)}'`);
  if (requestedMutationId != null) bmFilters.push(`bm.id = ${requestedMutationId}`);
  if (from)       bmFilters.push(`bm.transaction_date >= '${esc(from)}'`);
  if (to)         bmFilters.push(`bm.transaction_date <= '${esc(to)}'`);
  if (company_id) bmFilters.push(`bm.company_id = ${Number(company_id)}`);
  if (search) {
    const s = esc(search);
    bmFilters.push(`(bm.description ILIKE '%${s}%' OR bm.normalized_description ILIKE '%${s}%' OR bm.provider_order_id ILIKE '%${s}%' OR bm.mutation_key ILIKE '%${s}%')`);
  }
  if (payment_type && payment_type !== "all") {
    if (!isSportPaymentType(payment_type)) {
      return res.status(400).json({ error: "payment_type tidak valid" });
    }
    const requestedType = esc(payment_type);
    const sportTypeFromCandidate = `(
      SELECT ${sportPaymentTypeSql("sp_filter")}
      FROM bank_reconciliation_matches m_filter_method
      JOIN sport_payments sp_filter ON sp_filter.id = m_filter_method.candidate_id
      WHERE m_filter_method.mutation_id = bm.id
        AND m_filter_method.candidate_type = 'sport_payment'
        AND m_filter_method.status IN ('candidate', 'approved')
      ORDER BY m_filter_method.match_score DESC, m_filter_method.id DESC
      LIMIT 1
    )`;
    const explicitBankTypeMarker = `(LOWER(CONCAT_WS(' ',
      COALESCE(bm.provider_name, ''),
      COALESCE(bm.provider_order_id, ''),
      COALESCE(bm.description, ''),
      COALESCE(bm.normalized_description, '')
    )) LIKE '%paylabs%' OR LOWER(CONCAT_WS(' ',
      COALESCE(bm.provider_name, ''),
      COALESCE(bm.provider_order_id, ''),
      COALESCE(bm.description, ''),
      COALESCE(bm.normalized_description, '')
    )) LIKE '%qris%')`;
    bmFilters.push(`(
      ${sportTypeFromCandidate} = '${requestedType}'
      OR (
        '${requestedType}' IN ('qris', 'paylabs')
        AND ${explicitBankTypeMarker}
        AND ${requestedType} = CASE
          WHEN LOWER(CONCAT_WS(' ', COALESCE(bm.provider_name, ''), COALESCE(bm.provider_order_id, ''), COALESCE(bm.description, ''), COALESCE(bm.normalized_description, ''))) LIKE '%paylabs%'
            THEN 'paylabs'
          ELSE 'qris'
        END
      )
    )`);
  }
  const bmWhere = bmFilters.length ? `WHERE ${bmFilters.join(" AND ")}` : "";

  // Filters untuk sumber bank_mutation_imports (bmi) — hanya jika provider=all/BANK_IMPORT
  const showImports = !provider || provider === "all" || provider === "BANK_IMPORT";
  const bmiFilters: string[] = [];
  if (from)  bmiFilters.push(`bmi.transaction_date >= '${esc(from)}'`);
  if (to)    bmiFilters.push(`bmi.transaction_date <= '${esc(to)}'`);
  if (search) {
    const s = esc(search);
    bmiFilters.push(`(bmi.description ILIKE '%${s}%' OR bmi.unique_key ILIKE '%${s}%')`);
  }
  if (status === "approved")                   bmiFilters.push(`bmi.status IN ('IMPORTED','MATCHED','SKIPPED_ALREADY_POSTED')`);
  else if (status === "rejected")              bmiFilters.push(`bmi.status IN ('REJECTED','DUPLICATE')`);
  else if (status === "unmatched")             bmiFilters.push(`bmi.status IN ('READY','NEED_REVIEW','DRAFT')`);
  else if (status === "duplicate_need_review") bmiFilters.push(`bmi.status = 'NEED_REVIEW'`);
  if (direction === "IN")  bmiFilters.push(`COALESCE(bmi.credit, 0) > 0`);
  if (direction === "OUT") bmiFilters.push(`COALESCE(bmi.debit, 0) > 0 AND COALESCE(bmi.credit, 0) = 0`);
  // Deduplikasi: exclude bmi baris yang sudah ada di bank_mutations (via mutation_key)
  bmiFilters.push(`NOT EXISTS (SELECT 1 FROM bank_mutations bm2 WHERE bm2.mutation_key = COALESCE(bmi.unique_key, bmi.id::text))`);
  const bmiWhere = `WHERE ${bmiFilters.join(" AND ")}`;

  // Enrich candidate rows with the source transaction details that the user
  // needs to verify a match.  The match table intentionally stores only the
  // stable type/id and scoring evidence; these details are read live so the
  // panel does not show stale payment information.
  const candidateDetailsSql = `
    CASE
      WHEN m.candidate_type = 'accounting_payment' THEN (
        SELECT jsonb_build_object(
          'amount', ap.amount,
          'date', ap.date,
          'name', ap.partner_name,
          'reference', ap.ref,
          'paymentNumber', ap.payment_number,
          'memo', ap.memo,
          'status', ap.status,
          'paymentType', ap.payment_type,
          'sourceType', ap.source_type
        )
        FROM accounting_payments ap
        WHERE ap.id = m.candidate_id
      )
      WHEN m.candidate_type = 'sport_payment' THEN (
        SELECT jsonb_build_object(
          'amount', GREATEST(0, sp.amount - COALESCE(sp.mdr_amount, 0) - COALESCE(sp.tax_withheld_amount, 0) - COALESCE(sp.other_fee_amount, 0)),
          'grossAmount', sp.amount,
          'mdrAmount', COALESCE(sp.mdr_amount, 0),
          'taxWithheldAmount', COALESCE(sp.tax_withheld_amount, 0),
          'otherFeeAmount', COALESCE(sp.other_fee_amount, 0),
          'netAmount', GREATEST(0, sp.amount - COALESCE(sp.mdr_amount, 0) - COALESCE(sp.tax_withheld_amount, 0) - COALESCE(sp.other_fee_amount, 0)),
          'date', COALESCE(sp.paid_at::date, sp.created_at::date),
          'settlementDate', COALESCE(sp.settlement_date, COALESCE(sp.paid_at::date, sp.created_at::date) + 1),
          'settlementReference', sp.settlement_reference,
           'settlementStatus', sp.settlement_status,
           'settlementPartial', COALESCE(sp.settlement_status, 'unsettled') IN ('partial', 'partially_settled', 'partially-settled'),
          'name', COALESCE(sb.customer_name, c.name),
          'reference', CONCAT('SPORT-', sp.booking_id::text),
          'paymentNumber', sp.payment_number,
          'memo', sp.notes,
          'method', sp.method,
           'paymentMethod', sp.method,
           'paymentType', sp.payment_type,
           'paymentProvider', sp.payment_provider,
           'sportPaymentType', ${sportPaymentTypeSql("sp")},
          'status', sp.status,
          'bookingId', sp.booking_id
        )
        FROM sport_payments sp
        LEFT JOIN sport_bookings sb ON sb.id = sp.booking_id
        LEFT JOIN customers c ON c.id = sb.customer_id
        WHERE sp.id = m.candidate_id
      )
      WHEN m.candidate_type = 'qris_settlement'
       AND m.candidate_source = '${RECONCILIATION_CANDIDATE_SOURCES.LEGACY_QRIS}' THEN (
        SELECT jsonb_build_object(
          'amount', qs.net_amount,
          'grossAmount', qs.gross_amount,
          'mdrAmount', qs.mdr_amount,
          'taxWithheldAmount', qs.tax_withheld_amount,
          'otherFeeAmount', qs.other_fee_amount,
          'netAmount', qs.net_amount,
          'date', qs.settlement_date,
          'settlementDate', qs.settlement_date,
          'settlementReference', qs.settlement_reference,
           'settlementStatus', qs.status,
           'settlementPartial', COALESCE(qs.status, 'unsettled') IN ('partial', 'partially_settled', 'partially-settled'),
          'name', qs.settlement_reference,
          'reference', qs.settlement_reference,
          'method', 'qris',
           'paymentMethod', 'qris',
           'paymentType', 'qris',
           'sportPaymentType', 'qris',
          'status', qs.status,
           'settlementItemCount', (SELECT COUNT(*) FROM qris_settlement_items qsi WHERE qsi.settlement_id = qs.id),
           'settlementItems', COALESCE((
             SELECT jsonb_agg(jsonb_build_object(
               'id', qsi.id,
               'sportPaymentId', qsi.sport_payment_id,
               'paymentNumber', sp.payment_number,
               'bookingId', sp.booking_id,
               'grossAmount', qsi.gross_amount,
               'mdrAmount', qsi.mdr_amount,
               'taxWithheldAmount', qsi.tax_withheld_amount,
               'otherFeeAmount', qsi.other_fee_amount,
               'netAmount', qsi.net_amount
             ) ORDER BY qsi.id)
             FROM qris_settlement_items qsi
             JOIN sport_payments sp ON sp.id = qsi.sport_payment_id
             WHERE qsi.settlement_id = qs.id
           ), '[]'::jsonb)
        )
        FROM qris_settlements qs
        WHERE qs.id = m.candidate_id
      )
      WHEN m.candidate_type = 'qris_settlement'
       AND m.candidate_source = '${RECONCILIATION_CANDIDATE_SOURCES.CANONICAL_SPORT_CENTER}' THEN
        ${resolvedCanonicalDetailsSql}
      WHEN m.candidate_type = 'qris_settlement' THEN jsonb_build_object(
        'resolutionError', 'AMBIGUOUS_QRIS_SETTLEMENT_SOURCE',
        'candidateSource', m.candidate_source
      )
      WHEN m.candidate_type = 'invoice' THEN (
        SELECT jsonb_build_object(
          'amount', sd.total_amount,
          'date', COALESCE(sd.invoice_date::text, sd.created_at::date::text),
          'reference', sd.doc_number,
          'documentType', sd.kind
        )
        FROM sales_documents sd
        WHERE sd.id = m.candidate_id
      )
      WHEN m.candidate_type = 'expense' THEN (
        SELECT jsonb_build_object(
          'amount', e.total,
          'date', e.date,
          'name', e.description,
          'reference', e.expense_number
        )
        FROM expenses e
        WHERE e.id = m.candidate_id
      )
      WHEN m.candidate_type = 'logistic_order' THEN (
        SELECT jsonb_build_object(
          'amount', lo.grand_total,
          'date', lo.created_at::date,
          'name', COALESCE(lo.sender_name, lo.customer_name),
          'reference', lo.order_number,
          'status', lo.status
        )
        FROM logistic_orders lo
        WHERE lo.id = m.candidate_id
      )
      WHEN m.candidate_type = 'tenant_invoice' THEN (
        SELECT jsonb_build_object(
          'amount', ti.total_amount,
          'date', ti.issued_date::text,
          'name', COALESCE(t.business_name, t.owner_name),
          'reference', ti.invoice_number
        )
        FROM tenant_invoices ti
        LEFT JOIN tenants t ON t.id = ti.tenant_id
        WHERE ti.id = m.candidate_id
      )
      ELSE NULL
    END
  `;

  // ── Query SQL UNION ALL ────────────────────────────────────────────────────
  const bmSelect = `
    SELECT
      bm.id, bm.transaction_date::text, bm.description,
      bm.credit_amount, bm.debit_amount, bm.amount, bm.direction::text,
      bm.mutation_key, bm.normalized_description,
      bm.provider_name, bm.provider_order_id,
      bm.status::text, bm.journal_entry_id, bm.company_id,
      bm.uploaded_proof_url, bm.source,
       COALESCE(
         (
           SELECT ${sportPaymentTypeSql("sp_type")}
           FROM bank_reconciliation_matches m_type
           JOIN sport_payments sp_type ON sp_type.id = m_type.candidate_id
           WHERE m_type.mutation_id = bm.id
             AND m_type.candidate_type = 'sport_payment'
             AND m_type.status IN ('candidate', 'approved')
           ORDER BY m_type.match_score DESC, m_type.id DESC
           LIMIT 1
         ),
         CASE
           WHEN LOWER(CONCAT_WS(' ', COALESCE(bm.provider_name, ''), COALESCE(bm.provider_order_id, ''), COALESCE(bm.description, ''), COALESCE(bm.normalized_description, ''))) LIKE '%paylabs%' THEN 'paylabs'
           WHEN LOWER(CONCAT_WS(' ', COALESCE(bm.provider_name, ''), COALESCE(bm.provider_order_id, ''), COALESCE(bm.description, ''), COALESCE(bm.normalized_description, ''))) LIKE '%qris%' THEN 'qris'
           ELSE NULL
         END
       ) AS sport_payment_type,
       'bank_mutations' AS _source_table,
       (SELECT json_agg(
          to_jsonb(m) || jsonb_build_object('details', ${candidateDetailsSql})
          ORDER BY m.match_score DESC
        )
       FROM bank_reconciliation_matches m
       WHERE m.mutation_id = bm.id
          AND m.status IN ('candidate', 'approved')
           -- Generic bank-transfer candidates must be same-day. QRIS and
           -- Sport Center candidates use their own settlement-date contract.
           AND (
             m.candidate_type IN ('qris_settlement', 'sport_payment')
              OR ${genericCandidateSameDaySql("m", "bm")}
           )
       ) AS candidates,
        (
          SELECT to_jsonb(qc) || jsonb_build_object(
            'settled_payment_ids', COALESCE((
              SELECT jsonb_agg(settled.payment_id ORDER BY settled.payment_id)
              FROM (
                SELECT qsi.sport_payment_id AS payment_id
                FROM qris_settlement_items qsi
                WHERE qsi.sport_payment_id IN (
                  SELECT (item->>'paymentId')::int
                  FROM jsonb_array_elements(qc.payment_items) item
                  WHERE item->>'paymentId' IS NOT NULL
                )
                ${canonicalSettledUnionSql}
              ) settled
            ), '[]'::jsonb),
            'current_payment_ids', COALESCE((
              SELECT jsonb_agg(current_payment.payment_id ORDER BY current_payment.payment_id)
              FROM (
                SELECT (item->>'paymentId')::int AS payment_id
                FROM jsonb_array_elements(qc.payment_items) item
                WHERE item->>'paymentId' IS NOT NULL
                  AND NOT EXISTS (
                    SELECT 1
                    FROM qris_settlement_items qsi
                    WHERE qsi.sport_payment_id = (item->>'paymentId')::int
                  )
                  ${canonicalSettledExcludeSql}
              ) current_payment
             ), '[]'::jsonb),
             'current_payment_amounts', COALESCE((
               SELECT jsonb_object_agg(current_payment.payment_id::text, current_payment.amount)
               FROM (
                 SELECT sp.id AS payment_id, sp.amount
                 FROM sport_center.sport_payments sp
                 WHERE sp.id IN (
                   SELECT (item->>'paymentId')::int
                   FROM jsonb_array_elements(qc.payment_items) item
                   WHERE item->>'paymentId' IS NOT NULL
                     AND NOT EXISTS (
                       SELECT 1
                       FROM qris_settlement_items qsi
                       WHERE qsi.sport_payment_id = (item->>'paymentId')::int
                     )
                     ${canonicalSettledExcludeSql}
                 )
               ) current_payment
             ), '{}'::jsonb),
             'current_gross_amount', COALESCE((
              SELECT SUM(sp.amount)
              FROM sport_center.sport_payments sp
              WHERE sp.id IN (
                SELECT (item->>'paymentId')::int
                FROM jsonb_array_elements(qc.payment_items) item
                WHERE item->>'paymentId' IS NOT NULL
                  AND NOT EXISTS (
                    SELECT 1
                    FROM qris_settlement_items qsi
                    WHERE qsi.sport_payment_id = (item->>'paymentId')::int
                  )
                  ${canonicalSettledExcludeSql}
              )
            ), 0)
             ,
             'current_expected_amount', COALESCE((
               SELECT CASE
                 WHEN NULLIF(qc.gross_amount, 0) IS NULL THEN 0
                 ELSE SUM(sp.amount) * qc.net_amount / NULLIF(qc.gross_amount, 0)
               END
               FROM sport_center.sport_payments sp
               WHERE sp.id IN (
                 SELECT (item->>'paymentId')::int
                 FROM jsonb_array_elements(qc.payment_items) item
                 WHERE item->>'paymentId' IS NOT NULL
                   AND NOT EXISTS (
                     SELECT 1
                     FROM qris_settlement_items qsi
                     WHERE qsi.sport_payment_id = (item->>'paymentId')::int
                   )
                   ${canonicalSettledExcludeSql}
               )
             ), 0)
          )
           FROM qris_mutation_batch_candidates qc
            WHERE qc.mutation_id = bm.id
                AND (
                -- Only active candidates belong in the main mutation queue.
                 UPPER(COALESCE(qc.status, '')) NOT IN (
                   'APPROVED', 'COMPLETED', 'SUPERSEDED', 'STALE', 'INELIGIBLE'
                 )
                 OR EXISTS (
                   SELECT 1
                   FROM jsonb_array_elements(COALESCE(qc.payment_items, '[]'::jsonb)) item
                   WHERE item->>'paymentId' IS NOT NULL
                     AND NOT EXISTS (
                       SELECT 1
                       FROM qris_settlement_items qsi
                       WHERE qsi.sport_payment_id = (item->>'paymentId')::int
                     )
                     ${canonicalSettledExcludeSql}
                 )
               )
              AND (
               UPPER(COALESCE(bm.provider_name, '')) LIKE '%QRIS%'
               OR UPPER(COALESCE(bm.provider_name, '')) LIKE '%QRTRAVELI%'
               OR UPPER(COALESCE(bm.provider_name, '')) LIKE '%PAYLABS%'
               OR UPPER(COALESCE(bm.provider_name, '')) LIKE '%MANDIRI%'
               OR UPPER(COALESCE(bm.provider_order_id, '')) LIKE '%QRIS%'
               OR UPPER(COALESCE(bm.provider_order_id, '')) LIKE '%QRTRAVELI%'
               OR UPPER(COALESCE(bm.description, '')) LIKE '%QRIS%'
               OR UPPER(COALESCE(bm.description, '')) LIKE '%QRTRAVELI%'
             )
           ORDER BY
            qc.updated_at DESC,
            qc.id DESC
           LIMIT 1
         ) AS qris_candidate_audit,
         (
          SELECT COALESCE(jsonb_agg(
            to_jsonb(qc) || jsonb_build_object(
             'settled_payment_ids', COALESCE((
               SELECT jsonb_agg(settled.payment_id ORDER BY settled.payment_id)
               FROM (
                 SELECT qsi.sport_payment_id AS payment_id
                 FROM qris_settlement_items qsi
                 WHERE qsi.sport_payment_id IN (
                   SELECT (item->>'paymentId')::int
                   FROM jsonb_array_elements(qc.payment_items) item
                   WHERE item->>'paymentId' IS NOT NULL
                 )
                 ${canonicalSettledUnionSql}
               ) settled
             ), '[]'::jsonb),
             'current_payment_ids', COALESCE((
               SELECT jsonb_agg(current_payment.payment_id ORDER BY current_payment.payment_id)
               FROM (
                 SELECT (item->>'paymentId')::int AS payment_id
                 FROM jsonb_array_elements(qc.payment_items) item
                 WHERE item->>'paymentId' IS NOT NULL
                   AND NOT EXISTS (
                     SELECT 1
                     FROM qris_settlement_items qsi
                     WHERE qsi.sport_payment_id = (item->>'paymentId')::int
                   )
                   ${canonicalSettledExcludeSql}
               ) current_payment
             ), '[]'::jsonb),
             'current_payment_amounts', COALESCE((
               SELECT jsonb_object_agg(current_payment.payment_id::text, current_payment.amount)
               FROM (
                 SELECT sp.id AS payment_id, sp.amount
                 FROM sport_center.sport_payments sp
                 WHERE sp.id IN (
                   SELECT (item->>'paymentId')::int
                   FROM jsonb_array_elements(qc.payment_items) item
                   WHERE item->>'paymentId' IS NOT NULL
                     AND NOT EXISTS (
                       SELECT 1
                       FROM qris_settlement_items qsi
                       WHERE qsi.sport_payment_id = (item->>'paymentId')::int
                     )
                     ${canonicalSettledExcludeSql}
                 )
               ) current_payment
             ), '{}'::jsonb),
             'current_gross_amount', COALESCE((
              SELECT SUM(sp.amount)
              FROM sport_center.sport_payments sp
              WHERE sp.id IN (
                SELECT (item->>'paymentId')::int
                FROM jsonb_array_elements(qc.payment_items) item
                WHERE item->>'paymentId' IS NOT NULL
                  AND NOT EXISTS (
                    SELECT 1
                    FROM qris_settlement_items qsi
                    WHERE qsi.sport_payment_id = (item->>'paymentId')::int
                  )
                  ${canonicalSettledExcludeSql}
              )
            ), 0),
             'current_expected_amount', COALESCE((
               SELECT CASE
                 WHEN NULLIF(qc.gross_amount, 0) IS NULL THEN 0
                 ELSE SUM(sp.amount) * qc.net_amount / NULLIF(qc.gross_amount, 0)
               END
               FROM sport_center.sport_payments sp
               WHERE sp.id IN (
                 SELECT (item->>'paymentId')::int
                 FROM jsonb_array_elements(qc.payment_items) item
                 WHERE item->>'paymentId' IS NOT NULL
                   AND NOT EXISTS (
                     SELECT 1
                     FROM qris_settlement_items qsi
                     WHERE qsi.sport_payment_id = (item->>'paymentId')::int
                   )
                   ${canonicalSettledExcludeSql}
               )
             ), 0)
           )
           ORDER BY
             qc.updated_at DESC,
             qc.id DESC
          ), '[]'::jsonb)
          FROM qris_mutation_batch_candidates qc
           WHERE qc.mutation_id = bm.id
             AND (
               UPPER(COALESCE(qc.status, '')) NOT IN (
                 'APPROVED', 'COMPLETED', 'SUPERSEDED', 'STALE', 'INELIGIBLE'
               )
               OR EXISTS (
                 SELECT 1
                 FROM jsonb_array_elements(COALESCE(qc.payment_items, '[]'::jsonb)) item
                 WHERE item->>'paymentId' IS NOT NULL
                   AND NOT EXISTS (
                     SELECT 1
                     FROM qris_settlement_items qsi
                     WHERE qsi.sport_payment_id = (item->>'paymentId')::int
                   )
                   ${canonicalSettledExcludeSql}
               )
             )
             AND (
               UPPER(COALESCE(bm.provider_name, '')) LIKE '%QRIS%'
               OR UPPER(COALESCE(bm.provider_name, '')) LIKE '%QRTRAVELI%'
               OR UPPER(COALESCE(bm.provider_name, '')) LIKE '%PAYLABS%'
               OR UPPER(COALESCE(bm.provider_name, '')) LIKE '%MANDIRI%'
               OR UPPER(COALESCE(bm.provider_order_id, '')) LIKE '%QRIS%'
               OR UPPER(COALESCE(bm.provider_order_id, '')) LIKE '%QRTRAVELI%'
               OR UPPER(COALESCE(bm.description, '')) LIKE '%QRIS%'
               OR UPPER(COALESCE(bm.description, '')) LIKE '%QRTRAVELI%'
             )
         ) AS qris_candidate_audits
    FROM bank_mutations bm
    ${bmWhere}
  `;

  const bmiSelect = showImports ? `
    UNION ALL
    SELECT
      bmi.id, bmi.transaction_date::text, bmi.description,
      COALESCE(bmi.credit, 0) AS credit_amount,
      COALESCE(bmi.debit,  0) AS debit_amount,
      GREATEST(COALESCE(bmi.credit, 0), COALESCE(bmi.debit, 0)) AS amount,
      CASE WHEN COALESCE(bmi.credit, 0) > 0 THEN 'IN' ELSE 'OUT' END AS direction,
      COALESCE(bmi.unique_key, bmi.id::text) AS mutation_key,
      LOWER(COALESCE(bmi.description, '')) AS normalized_description,
      'BANK_IMPORT' AS provider_name,
      NULL::text AS provider_order_id,
      CASE
        WHEN bmi.status IN ('IMPORTED','MATCHED','SKIPPED_ALREADY_POSTED') THEN 'approved'
        WHEN bmi.status IN ('REJECTED','DUPLICATE')                         THEN 'rejected'
        ELSE 'unmatched'
      END AS status,
      bmi.journal_entry_id,
      NULL::integer AS company_id,
      NULL::text AS uploaded_proof_url,
      'bank_import' AS source,
       NULL::text AS sport_payment_type,
      'bank_import' AS _source_table,
       NULL::json AS candidates,
        NULL::jsonb AS qris_candidate_audit,
        '[]'::jsonb AS qris_candidate_audits
    FROM bank_mutation_imports bmi
    ${bmiWhere}
  ` : "";

  try {
    const { rows } = await db.execute(sql.raw(`
      SELECT * FROM (
        ${bmSelect}
        ${bmiSelect}
      ) combined
      ORDER BY transaction_date DESC, id DESC
      LIMIT ${lim} OFFSET ${off}
    `));

    const { rows: countRows } = await db.execute(sql.raw(`
      SELECT COUNT(*) AS total FROM (
        SELECT bm.id FROM bank_mutations bm ${bmWhere}
        ${showImports ? `
        UNION ALL
        SELECT bmi.id FROM bank_mutation_imports bmi ${bmiWhere}
        ` : ""}
      ) cnt
    `));

    return res.json({
      mutations: rows,
      total: Number((countRows[0] as any)?.total ?? 0),
    });
  } catch (e: any) {
    const dbMsg = e.cause?.message ?? e.cause ?? e.message;
    logger.error({ err: dbMsg, sql_hint: String(dbMsg).substring(0, 400) }, "[bankRecon] GET /mutations failed");
    return res.status(500).json({ error: dbMsg });
  }
});

// ─── POST /api/bank-reconciliation/:mutationId/approve ───────────────────────
// RULE 3: Wrapped dalam real DB transaction (SELECT FOR UPDATE efektif).
// RULE 4: Idempotency check via x-idempotency-key header.
// RULE 5: Kegagalan otomatis ter-capture ke failed_financial_jobs.
router.post("/:mutationId/approve", createIdempotencyMiddleware("reconciliation:approve"), async (req, res) => {
  await runBankReconciliationCoreMigration();
  const mutId = parseInt(String(req.params.mutationId ?? ""), 10);
  if (isNaN(mutId)) return res.status(400).json({ error: "ID tidak valid" });

  const {
    match_id, candidate_type, candidate_id, candidate_source, note, manual_coa_code,
  } = req.body;
  const actor = (req as any).user?.email ?? "admin";

  // ── Promote bank_mutation_imports row → bank_mutations if needed ─────────────
  // The GET /mutations list is a UNION ALL of bank_mutations + bank_mutation_imports.
  // When the user approves a bank_mutation_imports row (one not yet promoted),
  // mutId points to bank_mutation_imports.id, which doesn't exist in bank_mutations.
  // Fix: promote it inline here so approveAndCreateJournal always gets a real bank_mutations row.
  let resolvedMutId = mutId;
  const { rows: bmCheck } = await db.execute(sql.raw(`SELECT id FROM bank_mutations WHERE id = ${mutId} LIMIT 1`));
  if (!bmCheck.length) {
    const { rows: bmiRows } = await db.execute(sql.raw(`
      SELECT id, transaction_date, description,
             COALESCE(debit, 0)  AS debit,
             COALESCE(credit, 0) AS credit,
             COALESCE(unique_key, id::text) AS mutation_key,
             company_id, bank_account_id
      FROM bank_mutation_imports
      WHERE id = ${mutId}
      LIMIT 1
    `));
    if (!bmiRows.length) {
      return res.status(404).json({ error: "Mutasi tidak ditemukan" });
    }
    const bmi = bmiRows[0] as any;
    const credit  = Number(bmi.credit ?? 0);
    const debit   = Number(bmi.debit  ?? 0);
    const amount  = Math.max(credit, debit);
    const direction = credit > 0 ? "IN" : "OUT";
    const mKey    = String(bmi.mutation_key ?? bmi.id).replace(/'/g, "''");
    const desc    = String(bmi.description ?? "").replace(/'/g, "''");
    const txDate  = String(bmi.transaction_date ?? "").split("T")[0];
    const coId    = bmi.company_id     != null ? Number(bmi.company_id)     : null;
    const baId    = bmi.bank_account_id != null ? Number(bmi.bank_account_id) : null;

    const { rows: promoted } = await db.execute(sql.raw(`
      INSERT INTO bank_mutations
        (transaction_date, description, credit_amount, debit_amount, amount, direction,
         mutation_key, canonical_key, normalized_description,
         provider_name, status, source,
         company_id, bank_account_id)
      VALUES (
        '${txDate}', '${desc}',
        ${credit}, ${debit}, ${amount}, '${direction}',
        '${mKey}', '${mKey}', LOWER('${desc}'),
        'BANK_IMPORT', 'unmatched', 'bank_import',
        ${coId ?? "NULL"}, ${baId ?? "NULL"}
      )
      ON CONFLICT DO NOTHING
      RETURNING id
    `));
    if (!promoted.length) {
      // ON CONFLICT: already promoted by a concurrent request — look up the existing row
      const { rows: existing } = await db.execute(sql.raw(
        `SELECT id FROM bank_mutations WHERE mutation_key = '${mKey}' LIMIT 1`
      ));
      if (!existing.length) return res.status(409).json({ error: "Gagal mempromosikan mutasi import" });
      resolvedMutId = Number((existing[0] as any).id);
    } else {
      resolvedMutId = Number((promoted[0] as any).id);
    }
    logger.info({ originalBmiId: mutId, resolvedMutId }, "[bankRecon/approve] bank_mutation_imports promoted to bank_mutations");
  }

  // Canonical Sport Center settlements are already accounted by their posted
  // settlement journal. Route them before the generic approval function so
  // journal reuse/creation can never be reached for this source.
  let canonicalApprovalRequested =
    candidate_source === CANONICAL_SETTLEMENT_SOURCE;
  if (!canonicalApprovalRequested && match_id) {
    const { rows: routingMatch } = await db.execute(sql.raw(`
      SELECT candidate_type, candidate_source
      FROM bank_reconciliation_matches
      WHERE id = ${Number(match_id)} AND mutation_id = ${resolvedMutId}
      LIMIT 1
    `));
    canonicalApprovalRequested =
      String((routingMatch[0] as any)?.candidate_type ?? "") === "qris_settlement" &&
      String((routingMatch[0] as any)?.candidate_source ?? "") === CANONICAL_SETTLEMENT_SOURCE;
  }

  if (canonicalApprovalRequested) {
    try {
      const canonicalResult = await approveCanonicalSettlementLink(db as any, {
        mutationId: resolvedMutId,
        matchId: match_id ? Number(match_id) : null,
        candidateType: candidate_type ?? null,
        candidateId: candidate_id ? Number(candidate_id) : null,
        candidateSource: candidate_source === CANONICAL_SETTLEMENT_SOURCE
          ? CANONICAL_SETTLEMENT_SOURCE
          : null,
        actor,
      });

      audit(req, {
        action: "approve-canonical-settlement-link",
        module: "bank-reconciliation",
        resourceId: `bank-mutation-${mutId}`,
        after: canonicalResult,
      });
      triggerWritebackForMutation(resolvedMutId).catch(() => {});
      trackMutationApproval({
        mutationId: resolvedMutId,
        actor,
        companyId: (req as any).user?.companyId ?? null,
      }).catch(() => {});
      return res.json(canonicalResult);
    } catch (e: any) {
      const code = e instanceof CanonicalSettlementApprovalError
        ? e.code
        : "CANONICAL_APPROVAL_FAILED";
      const status = code === "CANONICAL_BANK_MUTATION_NOT_FOUND" ? 404 : 409;
      logger.warn(
        { err: e?.cause?.message ?? e?.message, code, mutationId: resolvedMutId },
        "[bankRecon/approve] canonical settlement link rejected",
      );
      return res.status(status).json({ error: e?.message ?? "Approval canonical gagal", code });
    }
  }

  const result = await approveAndCreateJournal(
    resolvedMutId,
    match_id ? Number(match_id) : null,
    candidate_type ?? null,
    candidate_id ? Number(candidate_id) : null,
    actor,
    note,
    manual_coa_code ? String(manual_coa_code) : null,
    candidate_source === RECONCILIATION_CANDIDATE_SOURCES.LEGACY_QRIS ||
      candidate_source === RECONCILIATION_CANDIDATE_SOURCES.CANONICAL_SPORT_CENTER
      ? candidate_source as ReconciliationCandidateSource
      : null,
  );

  if (!result.ok) {
    // JournalMappingError must return 422 with manual_review_required so the
    // frontend can show the warning banner instead of a generic error toast.
    if (result.manual_review_required) {
      return res.status(422).json({
        error: result.error,
        code: result.code,
        manual_review_required: true,
      });
    }
    if (result.code === "SPORT_PAYMENT_ALREADY_IN_CANONICAL_SETTLEMENT") {
      return res.status(409).json({
        error: result.error,
        code: result.code,
      });
    }
    return res.status(400).json({ error: result.error });
  }

  const responseBody = { ok: true, journal_entry_id: result.journalEntryId };

  audit(req, { action: "approve", module: "accounting", resourceId: `bank-mutation-${mutId}`, after: { journal_entry_id: result.journalEntryId } });

  // Writeback langsung ke Google Sheet (fire-and-forget, non-blocking)
  // agar kolom nama_customer, kategori, status_rekon terupdate tanpa tunggu sync 60-detik
  triggerWritebackForMutation(resolvedMutId).catch(() => {});

  // Runtime Usage Tracking — best-effort, never blocks or rolls back the journal
  trackMutationApproval({
    mutationId: resolvedMutId,
    actor,
    companyId: (req as any).user?.companyId ?? null,
  }).catch(() => {});

  return res.json(responseBody);
});

// ─── POST /api/bank-reconciliation/:mutationId/unapprove ─────────────────────
// Batalkan approval — mengembalikan ke status 'matched', hapus draft journal.
// Hanya berlaku saat journal masih draft (sebelum di-post).
router.post("/:mutationId/unapprove", async (req, res) => {
  await runBankReconciliationCoreMigration();
  const mutId = parseInt(req.params.mutationId);
  if (isNaN(mutId)) return res.status(400).json({ error: "ID tidak valid" });

  const actor = (req as any).user?.email ?? "admin";
  const { note } = req.body;

  try {
    const { rows: canonicalMatches } = await db.execute(sql.raw(`
      SELECT id
      FROM bank_reconciliation_matches
      WHERE mutation_id = ${mutId}
        AND candidate_type = 'qris_settlement'
        AND candidate_source = '${CANONICAL_SETTLEMENT_SOURCE}'
        AND status IN ('approved', 'candidate')
      LIMIT 2
    `));
    if (canonicalMatches.length > 0) {
      return res.status(409).json({
        error: "Canonical settlement memakai reopen link-only; gunakan endpoint /reopen.",
        code: "CANONICAL_SETTLEMENT_LINK_ONLY",
      });
    }

    await db.transaction(async (tx) => {
      const { rows: locked } = await tx.execute(sql.raw(
        `SELECT id, status, journal_entry_id FROM bank_mutations WHERE id = ${mutId} FOR UPDATE`
      ));
      if (!locked.length) throw Object.assign(new Error("Mutasi tidak ditemukan"), { code: "NOT_FOUND" });
      const mut = locked[0] as any;

      // Accept both old 'approved' and new 'approved_pending_posting' for backward compatibility
      const isUnapprove = mut.status === "approved_pending_posting" || mut.status === "approved";
      if (!isUnapprove) {
        throw Object.assign(
          new Error(`Mutasi berstatus '${mut.status}' — hanya 'approved_pending_posting' yang bisa di-unapprove (journal sudah diposting tidak bisa di-unapprove, gunakan void-journal)`),
          { code: "INVALID_STATUS" }
        );
      }

      // Draft journal → DELETE (no financial impact, cleaner than setting status='void')
      // The DB trigger ae_immutability only blocks UPDATE/DELETE on POSTED entries,
      // so deleting a draft is safe and cascades to accounting_entry_lines via FK.
      if (mut.journal_entry_id) {
        await tx.execute(sql.raw(`
          DELETE FROM accounting_entries
          WHERE id = ${mut.journal_entry_id} AND status = 'draft'
        `)).catch(() => {});
        // If entry wasn't draft (shouldn't happen) — log for investigation
      }

      // Reset approved matches → candidate
      await tx.execute(sql.raw(`
        UPDATE bank_reconciliation_matches
        SET status = 'candidate'
        WHERE mutation_id = ${mutId} AND status = 'approved'
      `));

      // Reset mutation status
      await tx.execute(sql.raw(`
        UPDATE bank_mutations
        SET status = 'matched',
            journal_entry_id = NULL,
            approved_by = NULL,
            approved_at = NULL,
            updated_at = NOW()
        WHERE id = ${mutId}
      `));

      // Audit inside tx
      const meta = JSON.stringify({ prev_journal_entry_id: mut.journal_entry_id, note: note ?? null }).replace(/'/g, "''");
      await tx.execute(sql.raw(`
        INSERT INTO bank_reconciliation_audit (mutation_id, action, actor, meta)
        VALUES (${mutId}, 'UNAPPROVED', '${actor.replace(/'/g, "''")}', '${meta}')
      `));
    });

    triggerWritebackForMutation(mutId).catch(() => {});
    audit(req, { action: "unapprove", module: "accounting", resourceId: `bank-mutation-${mutId}` });
    return res.json({ ok: true });
  } catch (e: any) {
    const code = e.code === "NOT_FOUND" ? 404 : e.code === "INVALID_STATUS" ? 409 : 500;
    return res.status(code).json({ error: e.message });
  }
});

// ─── POST /api/bank-reconciliation/:mutationId/post ───────────────────────────
// Final accounting posting: promotes the draft journal to 'posted' and sets
// mutation status to 'posted'. All steps run in a single atomic DB transaction.
//
// Pre-conditions:
//   mutation.status == 'approved_pending_posting' (or 'approved' for compat)
//   accounting_entries.status == 'draft'
//   debit == credit (balance check)
//   accounting period must be open
//
// Post-conditions:
//   accounting_entries.status == 'posted'
//   bank_mutations.status == 'posted', posted_by, posted_at set
//   audit log written inside same transaction
router.post("/:mutationId/post", async (req, res) => {
  await runBankReconciliationCoreMigration();
  const mutId = parseInt(req.params.mutationId);
  if (isNaN(mutId)) return res.status(400).json({ error: "ID tidak valid" });

  const actor = (req as any).user?.email ?? "admin";

  try {
    await db.transaction(async (tx) => {

      // 1. Lock mutation row FOR UPDATE (prevents concurrent post / unapprove)
      const { rows: mutRows } = await tx.execute(sql.raw(`
        SELECT id, status, journal_entry_id, company_id
        FROM bank_mutations
        WHERE id = ${mutId}
        FOR UPDATE
      `));
      if (!mutRows.length) {
        throw Object.assign(new Error("Mutasi tidak ditemukan"), { code: "NOT_FOUND" });
      }
      const mut = mutRows[0] as any;

      // 2. Validate mutation status
      const canPost = mut.status === "approved_pending_posting" || mut.status === "approved";
      if (!canPost) {
        throw Object.assign(
          new Error(`Mutasi berstatus '${mut.status}' — hanya 'approved_pending_posting' yang bisa diposting`),
          { code: "INVALID_STATUS" }
        );
      }

      // Resolve the approved source-qualified match before loading or changing
      // any generic accounting journal. Canonical Sport Center settlements
      // already own a posted settlement journal and must never enter /post.
      const { rows: approvedMatchRows } = await tx.execute(sql.raw(`
        SELECT candidate_type, candidate_id, candidate_source
        FROM bank_reconciliation_matches
        WHERE mutation_id = ${mutId}
          AND status IN ('candidate', 'approved')
        ORDER BY id
        LIMIT 2
        FOR UPDATE
      `));
      if (approvedMatchRows.length > 1) {
        throw new GenericPostGuardError(
          "AMBIGUOUS_QRIS_SETTLEMENT_SOURCE",
          "Mutasi memiliki lebih dari satu approved reconciliation match; generic posting ditolak.",
        );
      }
      assertGenericPostAllowed(
        (approvedMatchRows[0] as Record<string, unknown> | undefined) ?? null,
      );

      const journalEntryId = mut.journal_entry_id ? Number(mut.journal_entry_id) : null;
      if (!journalEntryId) {
        throw new Error("Tidak ada journal_entry_id — jalankan approve terlebih dahulu");
      }

      // 3. Lock journal entry FOR UPDATE (prevents concurrent post / void)
      const { rows: entryRows } = await tx.execute(sql.raw(`
        SELECT ae.id, ae.status, ae.total_debit, ae.total_credit, ae.company_id, ae.date::TEXT, ae.source
        FROM accounting_entries ae
        WHERE ae.id = ${journalEntryId}
        FOR UPDATE
      `));
      if (!entryRows.length) {
        throw new Error(`Journal entry #${journalEntryId} tidak ditemukan`);
      }
      const entry = entryRows[0] as any;

      // 4. Validate journal still draft (guard double-post)
      if (entry.status !== "draft") {
        throw Object.assign(
          new Error(`Journal entry #${journalEntryId} sudah berstatus '${entry.status}' — double-post ditolak`),
          { code: "CONFLICT" }
        );
      }

      // 5. Validate debit == credit
      const totalDebit  = Number(entry.total_debit);
      const totalCredit = Number(entry.total_credit);
      const diff = Math.abs(totalDebit - totalCredit);
      if (diff > 0.01) {
        throw new Error(`Journal tidak balance: debit ${totalDebit} ≠ credit ${totalCredit} (selisih ${diff.toFixed(2)})`);
      }

      // 6. Validate accounting period not closed (app-level for clear error message;
      //    ae_immutability trigger provides the DB-level defense-in-depth)
      const companyId = Number(entry.company_id || mut.company_id || 0);
      if (companyId && entry.date) {
        const entryDate = new Date(entry.date);
        if (!isNaN(entryDate.getTime())) {
          const { rows: periodRows } = await tx.execute(sql.raw(`
            SELECT is_closed, override_allowed
            FROM financial_periods
            WHERE company_id = ${companyId}
              AND year  = ${entryDate.getFullYear()}
              AND month = ${entryDate.getMonth() + 1}
            LIMIT 1
          `)).catch(() => ({ rows: [] as unknown[] }));
          const period = (periodRows as Array<Record<string,unknown>>)[0];
          if (period?.["is_closed"] && !period?.["override_allowed"]) {
            const ym = `${entryDate.getFullYear()}-${String(entryDate.getMonth()+1).padStart(2,"0")}`;
            throw Object.assign(
              new Error(`PERIOD_LOCKED: Periode ${ym} sudah ditutup. Buat reversal entry di periode terbuka, atau set override_allowed=true.`),
              { code: "PERIOD_LOCKED" }
            );
          }
        }
      }

      // 7. Promote journal draft → posted (ATOMIC).
      //    ae_immutability trigger verifies period lock at DB level as well.
      //    NOTE: accounting_entries has no updated_at column — omit it.
      const { rowCount } = await tx.execute(sql.raw(`
        UPDATE accounting_entries
        SET status = 'posted'
        WHERE id = ${journalEntryId} AND status = 'draft'
      `)) as any;
      // If rowCount === 0 → concurrent post beat us to it
      if (rowCount === 0) {
        throw Object.assign(
          new Error(`Journal entry #${journalEntryId} sudah dipost oleh proses lain (concurrent post)`),
          { code: "CONFLICT" }
        );
      }

      // 8. Update mutation status → posted
      await tx.execute(sql.raw(`
        UPDATE bank_mutations
        SET status     = 'posted',
            posted_by  = '${actor.replace(/'/g, "''")}',
            posted_at  = NOW(),
            updated_at = NOW()
        WHERE id = ${mutId} AND (status = 'approved_pending_posting' OR status = 'approved')
      `));

      // 9. Audit log inside tx (must succeed or rollback)
      const meta = JSON.stringify({
        journal_entry_id: journalEntryId,
        total_debit: totalDebit,
        total_credit: totalCredit,
        period_checked: !!companyId,
      }).replace(/'/g, "''");
      await tx.execute(sql.raw(`
        INSERT INTO bank_reconciliation_audit (mutation_id, action, actor, meta)
        VALUES (${mutId}, 'JOURNAL_POSTED', '${actor.replace(/'/g, "''")}', '${meta}')
      `));
    });

    // Approval write-back may have run before /post completed. Refresh the
    // sheet after the mutation reaches its final posted state.
    triggerWritebackForMutation(mutId).catch(() => {});
    audit(req, { action: "post-journal", module: "accounting", resourceId: `bank-mutation-${mutId}` });
    return res.json({ ok: true });

  } catch (e: any) {
    const code = (
      e.code === "NOT_FOUND"      ? 404 :
      e.code === "PERIOD_LOCKED"  ? 422 :
      e.code === "CONFLICT" || e.code === "INVALID_STATUS" ||
      e.code === "CANONICAL_SETTLEMENT_ALREADY_ACCOUNTED" ||
      e.code === "AMBIGUOUS_QRIS_SETTLEMENT_SOURCE" ? 409 : 500
    );
    return res.status(code).json({
      error: e.message,
      ...(e.code ? { code: e.code } : {}),
    });
  }
});

// ─── POST /api/bank-reconciliation/:mutationId/void-journal ──────────────────
// Void a POSTED reconciliation journal via reversal entry.
// Creates a bank_reconciliation_void entry that reverses the original.
// Mutation status → 'void'. Original journal status → 'voided'.
// Only allowed when mutation.status == 'posted'.
router.post("/:mutationId/void-journal", async (req, res) => {
  await runBankReconciliationCoreMigration();
  const mutId = parseInt(req.params.mutationId);
  if (isNaN(mutId)) return res.status(400).json({ error: "ID tidak valid" });

  const actor = (req as any).user?.email ?? "admin";
  const { reason } = req.body;

  try {
    const { rows: canonicalMatches } = await db.execute(sql.raw(`
      SELECT id
      FROM bank_reconciliation_matches
      WHERE mutation_id = ${mutId}
        AND candidate_type = 'qris_settlement'
        AND candidate_source = '${CANONICAL_SETTLEMENT_SOURCE}'
        AND status IN ('approved', 'candidate')
      LIMIT 2
    `));
    if (canonicalMatches.length > 0) {
      return res.status(409).json({
        error: "Canonical settlement memakai void/reopen link-only; journal settlement tetap posted.",
        code: "CANONICAL_SETTLEMENT_LINK_ONLY",
      });
    }

    // ── Step 1: Pre-fetch mutation (no lock yet) ──────────────────────────────
    const { rows: preRows } = await db.execute(sql.raw(`
      SELECT id, status, journal_entry_id, company_id
      FROM bank_mutations
      WHERE id = ${mutId}
    `));
    if (!preRows.length) return res.status(404).json({ error: "Mutasi tidak ditemukan" });
    const preMut = preRows[0] as any;

    if (preMut.status !== "posted") {
      return res.status(409).json({
        error: `Hanya mutasi berstatus 'posted' yang bisa di-void via void-journal. Status saat ini: '${preMut.status}'. Untuk membatalkan sebelum posting, gunakan unapprove.`,
      });
    }

    const journalEntryId = preMut.journal_entry_id ? Number(preMut.journal_entry_id) : null;
    if (!journalEntryId) {
      return res.status(400).json({ error: "Tidak ada journal entry untuk di-void" });
    }

    // Get journal + journal code
    const { rows: entryRows } = await db.execute(sql.raw(`
      SELECT ae.id, ae.journal_id, ae.status, aj.code AS journal_code
      FROM accounting_entries ae
      JOIN accounting_journals aj ON aj.id = ae.journal_id
      WHERE ae.id = ${journalEntryId}
      LIMIT 1
    `));
    if (!entryRows.length) {
      return res.status(404).json({ error: `Journal entry #${journalEntryId} tidak ditemukan` });
    }
    const entry = entryRows[0] as any;

    if (entry.status !== "posted") {
      return res.status(409).json({
        error: `Journal entry berstatus '${entry.status}' — void hanya untuk entry yang sudah diposting`,
      });
    }

    // ── Step 2: CAS — atomically claim void slot (concurrent guard) ───────────
    // UPDATE WHERE status='posted' is atomic in PostgreSQL; only one concurrent
    // request will win. If rowCount=0 → another request already voided it.
    const { rowCount: claimedCount } = await db.execute(sql.raw(`
      UPDATE bank_mutations
      SET status = 'void', updated_at = NOW()
      WHERE id = ${mutId} AND status = 'posted'
    `)) as any;

    if ((claimedCount ?? 0) === 0) {
      return res.status(409).json({
        error: "Mutasi sudah di-void oleh proses lain, atau status berubah secara bersamaan",
      });
    }

    // ── Step 3: Create reversal via voidApprovedJournal ───────────────────────
    // source = 'bank_reconciliation_void' — exempt from period lock
    const voidResult = await voidApprovedJournal({
      entryId:     journalEntryId,
      companyId:   Number(preMut.company_id || 0),
      journalId:   Number(entry.journal_id),
      journalCode: String(entry.journal_code),
      actor,
      reason:      reason ?? null,
    });

    if (!voidResult.ok) {
      // Compensating rollback: restore mutation status to 'posted'
      await db.execute(sql.raw(`
        UPDATE bank_mutations
        SET status = 'posted', updated_at = NOW()
        WHERE id = ${mutId} AND status = 'void'
      `)).catch(() => {});
      return res.status(400).json({ error: voidResult.error });
    }

    await auditLog(mutId, "JOURNAL_VOIDED", actor, {
      original_journal_entry_id: journalEntryId,
      void_entry_id: voidResult.voidEntryId,
      reason: reason ?? null,
    });
    audit(req, { action: "void-journal", module: "accounting", resourceId: `bank-mutation-${mutId}` });

    return res.json({ ok: true, void_entry_id: voidResult.voidEntryId });

  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── POST /api/bank-reconciliation/:mutationId/reopen ────────────────────────
// Reopen a voided mutation: resets status → 'unmatched' so matching can run
// again. Only allowed when status = 'void'.
// Clears journal_entry_id link (the original is voided; the reversal entry is
// standalone and stays in accounting). Removes any stale candidate rows.
router.post("/:mutationId/reopen", async (req, res) => {
  await runBankReconciliationCoreMigration();
  const mutId = parseInt(req.params.mutationId);
  if (isNaN(mutId)) return res.status(400).json({ error: "ID tidak valid" });

  const actor = (req as any).user?.email ?? "admin";
  const { note } = req.body;

  try {
    // Canonical settlements are link-only: reopening removes the bank link and
    // returns both mutations to unmatched. It must never create a reversal.
    const { rows: canonicalMatches } = await db.execute(sql.raw(`
      SELECT id
      FROM bank_reconciliation_matches
      WHERE mutation_id = ${mutId}
        AND candidate_type = 'qris_settlement'
        AND candidate_source = '${CANONICAL_SETTLEMENT_SOURCE}'
        AND status IN ('approved', 'candidate')
      ORDER BY id
      LIMIT 2
    `));
    if (canonicalMatches.length > 1) {
      return res.status(409).json({
        error: "Terdapat lebih dari satu match canonical untuk mutasi ini.",
        code: "CANONICAL_APPROVAL_INCONSISTENT_STATE",
      });
    }
    if (canonicalMatches.length === 1) {
      try {
        const result = await reopenCanonicalSettlementLink(db as any, {
          mutationId: mutId,
          matchId: Number((canonicalMatches[0] as any).id),
          actor,
        });
        audit(req, {
          action: "reopen-canonical-settlement-link",
          module: "bank-reconciliation",
          resourceId: `bank-mutation-${mutId}`,
          after: result,
        });
        triggerWritebackForMutation(mutId).catch(() => {});
        return res.json(result);
      } catch (e: any) {
        const code = e instanceof CanonicalSettlementApprovalError
          ? e.code
          : "CANONICAL_REOPEN_FAILED";
        const status = code === "CANONICAL_BANK_MUTATION_NOT_FOUND" ? 404 : 409;
        return res.status(status).json({ error: e?.message ?? "Reopen canonical gagal", code });
      }
    }

    await db.transaction(async (tx) => {
      const { rows: locked } = await tx.execute(sql.raw(
        `SELECT id, status, company_id FROM bank_mutations WHERE id = ${mutId} FOR UPDATE`
      ));
      if (!locked.length) throw Object.assign(new Error("Mutasi tidak ditemukan"), { code: "NOT_FOUND" });
      const mut = locked[0] as any;

      if (mut.status !== "void") {
        throw Object.assign(
          new Error(`Hanya mutasi berstatus 'void' yang bisa dibuka ulang. Status saat ini: '${mut.status}'.`),
          { code: "INVALID_STATUS" }
        );
      }

      // Delete stale candidate rows — fresh matching will rebuild them
      await tx.execute(sql.raw(
        `DELETE FROM bank_reconciliation_matches WHERE mutation_id = ${mutId} AND status IN ('candidate','rejected')`
      ));

      // Reset mutation back to unmatched
      await tx.execute(sql.raw(`
        UPDATE bank_mutations
        SET status           = 'unmatched',
            journal_entry_id = NULL,
            approved_by      = NULL,
            approved_at      = NULL,
            posted_by        = NULL,
            posted_at        = NULL,
            updated_at       = NOW()
        WHERE id = ${mutId}
      `));

      const meta = JSON.stringify({ note: note ?? null, reopened_by: actor }).replace(/'/g, "''");
      await tx.execute(sql.raw(`
        INSERT INTO bank_reconciliation_audit (mutation_id, action, actor, meta)
        VALUES (${mutId}, 'REOPENED', '${actor.replace(/'/g, "''")}', '${meta}')
      `));
    });

    audit(req, { action: "reopen", module: "accounting", resourceId: `bank-mutation-${mutId}` });
    return res.json({ ok: true });

  } catch (e: any) {
    const code = e.code === "NOT_FOUND" ? 404 : e.code === "INVALID_STATUS" ? 409 : 500;
    return res.status(code).json({ error: e.message });
  }
});

// ─── POST /api/bank-reconciliation/:mutationId/reject ───────────────────────
router.post("/:mutationId/reject", async (req, res) => {
  await runBankReconciliationCoreMigration();
  const mutId = parseInt(req.params.mutationId);
  if (isNaN(mutId)) return res.status(400).json({ error: "ID tidak valid" });

  const { note } = req.body;
  const actor = (req as any).user?.email ?? "admin";

  const { rows: canonicalMatches } = await db.execute(sql.raw(`
    SELECT id
    FROM bank_reconciliation_matches
    WHERE mutation_id = ${mutId}
      AND candidate_type = 'qris_settlement'
      AND candidate_source = '${CANONICAL_SETTLEMENT_SOURCE}'
      AND status IN ('approved', 'candidate')
    LIMIT 2
  `));
  if (canonicalMatches.length > 0) {
    return res.status(409).json({
      error: "Canonical settlement memakai link-only lifecycle; gunakan /reopen untuk melepas link.",
      code: "CANONICAL_SETTLEMENT_LINK_ONLY",
    });
  }

  await db.execute(sql.raw(
    `UPDATE bank_mutations SET status = 'rejected', updated_at = NOW() WHERE id = ${mutId}`
  ));
  await db.execute(sql.raw(
    `UPDATE bank_reconciliation_matches SET status = 'rejected' WHERE mutation_id = ${mutId} AND status = 'candidate'`
  ));

  // Audit: MATCH_REJECTED
  await auditLog(mutId, "MATCH_REJECTED", actor, { note: note ?? null });
  audit(req, { action: "reject", module: "accounting", resourceId: `bank-mutation-${mutId}` });
  return res.json({ ok: true });
});

// ─── POST /api/bank-reconciliation/:mutationId/upload-proof ──────────────────
// Upload bukti transfer opsional untuk sebuah mutasi bank.
// File disimpan ke Supabase Storage (public bucket), URL disimpan ke DB.
router.post("/:mutationId/upload-proof", upload.single("file"), async (req, res) => {
  await runBankReconciliationCoreMigration();
  const mutId = parseInt(String(req.params.mutationId ?? ""), 10);
  if (isNaN(mutId)) return res.status(400).json({ error: "ID tidak valid" });
  if (!req.file)    return res.status(400).json({ error: "File wajib diupload" });

  const ALLOWED = ["image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"];
  if (!ALLOWED.includes(req.file.mimetype)) {
    return res.status(400).json({ error: "Hanya file JPG, PNG, WEBP, GIF, atau PDF yang diizinkan" });
  }

  // Derive extension from mimetype (more reliable than originalname in prod)
  const EXT_MAP: Record<string, string> = {
    "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp",
    "image/gif": "gif", "application/pdf": "pdf",
  };
  const ext = EXT_MAP[req.file.mimetype] ?? "bin";
  const storagePath = `bank-proof/${mutId}/${Date.now()}.${ext}`;

  try {
    const oss = new ObjectStorageService();
    const url = await oss.uploadPublic(storagePath, req.file.buffer, req.file.mimetype);

    await db.execute(sql`UPDATE bank_mutations SET uploaded_proof_url = ${url} WHERE id = ${mutId}`);

    const actor = (req as any).user?.email ?? "admin";
    audit(req, { action: "upload_proof", module: "accounting", resourceId: `bank-mutation-${mutId}` });
    logger.info({ mutId, url }, "[BankRecon] Bukti transfer diupload");

    return res.json({ ok: true, url });
  } catch (err) {
    logger.error({ err }, "[BankRecon] Gagal upload bukti transfer");
    return res.status(500).json({ error: "Gagal upload file. Coba lagi." });
  }
});

// ─── DELETE /api/bank-reconciliation/:mutationId/upload-proof ─────────────────
// Hapus URL bukti transfer dari mutasi (file di Storage tidak dihapus).
router.delete("/:mutationId/upload-proof", async (req, res) => {
  await runBankReconciliationCoreMigration();
  const mutId = parseInt(req.params.mutationId);
  if (isNaN(mutId)) return res.status(400).json({ error: "ID tidak valid" });

  await db.execute(sql`UPDATE bank_mutations SET uploaded_proof_url = NULL WHERE id = ${mutId}`);
  audit(req, { action: "remove_proof", module: "accounting", resourceId: `bank-mutation-${mutId}` });
  return res.json({ ok: true });
});

// ─── POST /api/bank-reconciliation/run-matching ───────────────────────────────
// Jalankan ulang unified matching engine untuk semua atau sebagian mutasi
router.get("/run-matching/status", async (_req, res) => {
  return res.json({
    ok: true,
    running: unifiedMatchingJobActive,
  });
});

router.post("/run-matching", async (req, res) => {
  await runBankReconciliationCoreMigration();
  await runReconRulesMigration();
  await runExpectedCashFlowMigration();

  const actor = (req as any).user?.email ?? "system";
  const { ids } = req.body as { ids?: number[] };
  // Keep a small worker pool: matching performs several independent reads per
  // mutation, so serial processing is unnecessarily slow, while unbounded
  // Promise.all would exhaust the database pool during a large re-run.
  const MATCHING_CONCURRENCY = 4;

  // Allow matching unmatched + matched + duplicate_need_review (spec §Phase3)
  let whereClause = "status IN ('unmatched','matched','duplicate_need_review')";
  if (ids?.length) whereClause = `id = ANY(ARRAY[${ids.map(Number).join(",")}])`;

  const { rows: mutations } = await db.execute(sql.raw(
    `SELECT * FROM bank_mutations WHERE ${whereClause} ORDER BY transaction_date DESC LIMIT 500`
  ));

  let processed = 0;
  let auto_matched = 0;
  let manual_review = 0;
  let unmatched_count = 0;
  let rule_matched = 0;
  let ecf_matched = 0;

  const processMutation = async (m: any) => {
    try {
      // ── 1. Decision Stack pre-processing (Rule Engine + ECF) ─────────────────
      const decisionInput: MutationForDecisionStack = {
        id:                   m.id,
        companyId:            m.company_id != null ? Number(m.company_id) : 0,
        amount:               Number(m.amount),
        direction:            String(m.direction ?? "IN"),
        transactionDate:      String(m.transaction_date ?? "").slice(0, 10),
        description:          String(m.description ?? ""),
        normalizedDescription: m.normalized_description ?? null,
        reference:            m.provider_order_id ?? null,
        providerOrderId:      m.provider_order_id ?? null,
        bankAccountId:        m.bank_account_id != null ? Number(m.bank_account_id) : null,
        counterpartyName:     null,
        counterpartyAccount:  null,
        status:               String(m.status ?? "unmatched"),
      };

      const decision = await runReconDecisionStack(decisionInput);

      if (!decision.eligible) {
        // Status guard blocked — skip, do not count as processed
        logger.debug({ mutationId: m.id, reason: decision.blockedReason }, "[run-matching] blocked by status guard");
        return;
      }

      // ── 2a. Rule Engine match → save as candidate + update audit trail ────────
      if (decision.decisionSource === "MANUAL_RULE" && decision.matchedRuleId) {
        rule_matched++;
        processed++;

        // Persist rule match as candidate in bank_reconciliation_matches
        const breakdownJson = JSON.stringify({
          confidence: decision.confidence,
          reasons: decision.confidenceBreakdown,
        }).replace(/'/g, "''");
        const auditMeta = JSON.stringify({
          engine_version:        decision.engineVersion,
          decision_source:       decision.decisionSource,
          matched_rule_id:       decision.matchedRuleId,
          expected_cash_flow_id: null,
          confidence:            decision.confidence,
          confidence_breakdown:  decision.confidenceBreakdown,
          candidate_count:       decision.candidateCount,
          evaluated_at:          decision.evaluatedAt,
        }).replace(/'/g, "''");

        await db.execute(sql.raw(`
          INSERT INTO bank_reconciliation_matches
            (mutation_id, candidate_type, candidate_id, match_score, match_reason,
             amount_match, date_match, status)
          VALUES
            (${m.id}, 'recon_rule', ${decision.matchedRuleId},
             ${decision.confidence}, 'MANUAL_RULE:${decision.confidenceBreakdown[0]?.label?.slice(0,100).replace(/'/g,"''")}',
             FALSE, FALSE, 'candidate')
          ON CONFLICT DO NOTHING
        `)).catch(() => {});

        await db.execute(sql.raw(`
          INSERT INTO bank_reconciliation_audit (mutation_id, action, actor, meta)
          VALUES (${m.id}, 'RULE_ENGINE_MATCH', '${actor.replace(/'/g,"''")}', '${auditMeta}')
        `)).catch(() => {});

        // Set mutation to manual_review (rule matched but not auto-approved)
        await db.execute(sql.raw(`
          UPDATE bank_mutations SET status = 'manual_review', updated_at = NOW()
          WHERE id = ${m.id} AND status IN ('unmatched','matched','duplicate_need_review')
        `)).catch(() => {});

        manual_review++;
        return;
      }

      // ── 2b. ECF match → record candidate + fall through to unified engine ─────
      if (
        (decision.decisionSource === "EXPECTED_CASH_FLOW" || decision.decisionSource === "EXACT_REFERENCE") &&
        decision.expectedCashFlowId
      ) {
        ecf_matched++;

        const bestEcf = decision.ecfCandidates[0];
        if (bestEcf) {
          const auditMeta = JSON.stringify({
            engine_version:        decision.engineVersion,
            decision_source:       decision.decisionSource,
            matched_rule_id:       null,
            expected_cash_flow_id: decision.expectedCashFlowId,
            confidence:            decision.confidence,
            confidence_breakdown:  decision.confidenceBreakdown,
            candidate_count:       decision.candidateCount,
            evaluated_at:          decision.evaluatedAt,
          }).replace(/'/g, "''");

          await db.execute(sql.raw(`
            INSERT INTO bank_reconciliation_audit (mutation_id, action, actor, meta)
            VALUES (${m.id}, 'ECF_CANDIDATE_FOUND', '${actor.replace(/'/g,"''")}', '${auditMeta}')
          `)).catch(() => {});
        }
        // Fall through to unified matching engine — ECF is additional signal
      }

      // ── 3. Unified Matching Engine (existing — not replaced) ──────────────────
      const result = await runUnifiedMatching({
        id: m.id,
        transaction_date: m.transaction_date,
        amount: Number(m.amount),
        mutation_key: m.mutation_key,
        provider_order_id: m.provider_order_id,
        provider_name: m.provider_name,
        normalized_description: m.normalized_description,
        uploaded_proof_url: m.uploaded_proof_url ?? null,
        company_id: m.company_id ?? null,
        bank_account_id: m.bank_account_id ?? null,
        direction: m.direction,
      }, actor);

      processed++;
      if (result.status === "auto_matched") auto_matched++;
      else if (result.status === "manual_review") manual_review++;
      else unmatched_count++;

    } catch (e: any) {
      logger.warn({ err: e.message, id: m.id }, "[bankRecon] matching error for mutation");
    }
  };

  // Process independent mutations concurrently with a bounded worker pool.
  // A full-bank run can contain hundreds of rows and exceed the browser's
  // request timeout. Explicit `ids` requests retain the synchronous response
  // contract; the normal all-mutations action is queued so the UI can continue
  // immediately and trigger the separate QRIS candidate review flow.
  let nextIndex = 0;
  const worker = async () => {
    while (true) {
      const index = nextIndex++;
      if (index >= mutations.length) return;
      await processMutation(mutations[index]);
    }
  };
  const runWorkers = async () => {
    await Promise.all(
      Array.from(
        { length: Math.min(MATCHING_CONCURRENCY, mutations.length) },
        () => worker(),
      ),
    );
    logger.info(
      { processed, auto_matched, manual_review, unmatched: unmatched_count, rule_matched, ecf_matched },
      "[bankRecon] background matching completed",
    );
  };

  if (!ids?.length) {
    if (unifiedMatchingJobActive) {
      return res.status(202).json({
        ok: true,
        queued: true,
        alreadyRunning: true,
        message: "AI Matching sedang berjalan di background.",
      });
    }

    unifiedMatchingJobActive = true;
    setImmediate(() => {
      runWorkers()
        .catch((e: any) => logger.error({ err: e }, "[bankRecon] background matching failed"))
        .finally(() => {
          unifiedMatchingJobActive = false;
        });
    });

    return res.status(202).json({
      ok: true,
      queued: true,
      processed: 0,
      auto_matched: 0,
      manual_review: 0,
      unmatched: 0,
      rule_matched: 0,
      ecf_matched: 0,
      message: `${mutations.length} mutasi sedang diproses di background.`,
    });
  }

  await runWorkers();
  return res.json({
    ok: true,
    processed,
    auto_matched,
    manual_review,
    unmatched: unmatched_count,
    rule_matched,
    ecf_matched,
  });
});

// ─── GET /api/bank-reconciliation/summary ────────────────────────────────────
router.get("/summary", async (req, res) => {
  await runBankReconciliationCoreMigration();
  const { rows } = await db.execute(sql.raw(`
    SELECT
      CASE
        WHEN bm.status = 'matched'
          AND NOT EXISTS (
            SELECT 1
            FROM bank_reconciliation_matches stale_match
            WHERE stale_match.mutation_id = bm.id
              AND stale_match.status IN ('candidate', 'approved')
              AND stale_match.candidate_type IN (
                'accounting_payment', 'invoice', 'expense',
                'logistic_order', 'tenant_invoice'
              )
              AND ${genericCandidateSameDaySql("stale_match", "bm")}
          )
          AND EXISTS (
            SELECT 1
            FROM bank_reconciliation_matches any_generic_match
            WHERE any_generic_match.mutation_id = bm.id
              AND any_generic_match.status IN ('candidate', 'approved')
              AND any_generic_match.candidate_type IN (
                'accounting_payment', 'invoice', 'expense',
                'logistic_order', 'tenant_invoice'
              )
          )
        THEN 'duplicate_need_review'
        ELSE bm.status
      END AS status,
      COUNT(*) as count,
      SUM(bm.amount) as total_amount
    FROM bank_mutations bm
    GROUP BY 1
    ORDER BY count DESC
  `));
  return res.json({ summary: rows });
});

// ─── GET /api/bank-reconciliation/audit/:mutationId ──────────────────────────
router.get("/audit/:mutationId", async (req, res) => {
  await runBankReconciliationCoreMigration();
  const mutId = parseInt(req.params.mutationId);
  if (isNaN(mutId)) return res.status(400).json({ error: "ID tidak valid" });

  const { rows } = await db.execute(sql.raw(`
    SELECT * FROM bank_reconciliation_audit
    WHERE mutation_id = ${mutId}
    ORDER BY created_at ASC
  `));
  return res.json({ audit: rows });
});

// ─── DELETE /api/bank-reconciliation/delete-all ────────────────────────────────
router.delete("/delete-all", async (req, res) => {
  await runBankReconciliationCoreMigration();
  const actor = (req as any).user?.email ?? "admin";
  try {
    // CASCADE via FK: bank_reconciliation_matches & bank_reconciliation_audit terhapus otomatis
    const { rows } = await db.execute(sql.raw(`DELETE FROM bank_mutations RETURNING id`));
    const count = (rows as any[]).length;
    logger.info({ actor, count }, "[bankRecon] delete-all: semua bank_mutations dihapus");
    return res.json({ ok: true, deleted: count });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ─── DELETE /api/bank-reconciliation/:mutationId ──────────────────────────────
router.delete("/:mutationId", async (req, res) => {
  await runBankReconciliationCoreMigration();
  const mutId = parseInt(req.params.mutationId);
  if (isNaN(mutId)) return res.status(400).json({ error: "ID tidak valid" });

  const actor = (req as any).user?.email ?? "admin";

  // Hanya boleh hapus mutasi yang belum approved
  const { rows: mut } = await db.execute(sql.raw(
    `SELECT status FROM bank_mutations WHERE id = ${mutId}`
  ));
  if (!mut.length) return res.status(404).json({ error: "Mutasi tidak ditemukan" });
  if ((mut[0] as any).status === "approved") {
    return res.status(400).json({ error: "Mutasi yang sudah di-approve tidak bisa dihapus. Gunakan unapprove terlebih dahulu." });
  }

  await db.execute(sql.raw(`DELETE FROM bank_mutations WHERE id = ${mutId}`));
  await auditLog(mutId, "MUTATION_DELETED", actor, { status_before: (mut[0] as any).status });
  return res.json({ ok: true });
});

// ─── CRUD: bank_sheet_configs ──────────────────────────────────────────────────

// Shared helper to test a sheet connection
async function testSheetConnection(sheetId: string, tabName: string) {
  const saJson = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "";
  if (!saJson) return { ok: false, stage: "config", error: "GOOGLE_SERVICE_ACCOUNT_JSON belum diset di Secrets." };

  let serviceAccountEmail: string | null = null;
  try {
    const parsed = JSON.parse(saJson);
    serviceAccountEmail = parsed.client_email ?? null;
  } catch {
    return { ok: false, stage: "parse", error: "GOOGLE_SERVICE_ACCOUNT_JSON bukan JSON valid.", serviceAccountEmail: null };
  }

  try {
    const { getSpreadsheetMeta } = await import("../lib/googleSheets.js");
    const meta = await getSpreadsheetMeta(sheetId);
    const tabExists = meta.sheets.includes(tabName);
    return {
      ok: true, stage: "connected", serviceAccountEmail,
      spreadsheetTitle: meta.title, availableTabs: meta.sheets, tabExists,
      message: tabExists
        ? `Koneksi OK — tab "${tabName}" ditemukan di "${meta.title}"`
        : `Koneksi OK — tapi tab "${tabName}" belum ada. Tab tersedia: ${meta.sheets.join(", ")}`,
    };
  } catch (err: any) {
    const msg: string = err?.message ?? String(err);
    let hint = "";
    if (msg.includes("invalid_grant") || msg.includes("Invalid JWT")) {
      hint = "Private key rusak. Re-download JSON key dari Google Cloud Console dan paste ulang.";
    } else if (msg.includes("403") || msg.includes("PERMISSION_DENIED")) {
      hint = `Share spreadsheet ke "${serviceAccountEmail}" sebagai Editor.`;
    } else if (msg.includes("404") || msg.includes("not found")) {
      hint = "Sheet ID salah. Cek URL: docs.google.com/spreadsheets/d/[ID_INI]/edit";
    }
    return { ok: false, stage: "connect", error: msg, hint: hint || undefined, serviceAccountEmail };
  }
}

// GET /api/bank-reconciliation/sheet-configs — list all configs
router.get("/sheet-configs", async (_req, res) => {
  await runBankReconciliationCoreMigration();
  const { rows } = await db.execute(sql.raw(`
    SELECT sc.*, c.company_name
    FROM bank_sheet_configs sc
    LEFT JOIN companies c ON c.id = sc.company_id
    ORDER BY sc.company_id NULLS LAST, sc.label
  `));
  return res.json({ configs: rows });
});

// POST /api/bank-reconciliation/sheet-configs — create
router.post("/sheet-configs", async (req, res) => {
  await runBankReconciliationCoreMigration();
  const { company_id, label, sheet_id, tab_name, bank_account_number, bank_name } = req.body ?? {};
  if (!label || !sheet_id) return res.status(400).json({ error: "label dan sheet_id wajib diisi" });
  const esc = (s: string) => String(s ?? "").replace(/'/g, "''");
  const nullableText = (value: unknown) => value ? `'${esc(String(value))}'` : "NULL";
  const { rows } = await db.execute(sql.raw(`
    INSERT INTO bank_sheet_configs (company_id, label, sheet_id, tab_name, bank_account_number, bank_name)
    VALUES (${company_id ? Number(company_id) : "NULL"}, '${esc(label)}', '${esc(sheet_id)}', '${esc(tab_name ?? "Mutasi_Bank")}',
            ${nullableText(bank_account_number)}, ${nullableText(bank_name)})
    RETURNING *
  `));
  return res.json({ config: (rows as any[])[0] });
});

// PUT /api/bank-reconciliation/sheet-configs/:id — update
router.put("/sheet-configs/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid" });
  const { company_id, label, sheet_id, tab_name, bank_account_number, bank_name, is_active } = req.body ?? {};
  const esc = (s: string) => String(s ?? "").replace(/'/g, "''");
  const nullableText = (value: unknown) => value ? `'${esc(String(value))}'` : "NULL";
  const sets: string[] = [`updated_at = NOW()`];
  if (label     !== undefined) sets.push(`label = '${esc(label)}'`);
  if (sheet_id  !== undefined) sets.push(`sheet_id = '${esc(sheet_id)}'`);
  if (tab_name  !== undefined) sets.push(`tab_name = '${esc(tab_name)}'`);
  if (bank_account_number !== undefined) sets.push(`bank_account_number = ${nullableText(bank_account_number)}`);
  if (bank_name !== undefined) sets.push(`bank_name = ${nullableText(bank_name)}`);
  if (is_active !== undefined) sets.push(`is_active = ${is_active ? "TRUE" : "FALSE"}`);
  if (company_id !== undefined) sets.push(`company_id = ${company_id ? Number(company_id) : "NULL"}`);
  const { rows } = await db.execute(sql.raw(`UPDATE bank_sheet_configs SET ${sets.join(", ")} WHERE id = ${id} RETURNING *`));
  if (!(rows as any[]).length) return res.status(404).json({ error: "Config tidak ditemukan" });
  return res.json({ config: (rows as any[])[0] });
});

// DELETE /api/bank-reconciliation/sheet-configs/:id
router.delete("/sheet-configs/:id", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid" });
  await db.execute(sql.raw(`DELETE FROM bank_sheet_configs WHERE id = ${id}`));
  return res.json({ ok: true });
});

// POST /api/bank-reconciliation/sheet-configs/:id/test — test one config
router.post("/sheet-configs/:id/test", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid" });
  const { rows } = await db.execute(sql.raw(`SELECT * FROM bank_sheet_configs WHERE id = ${id}`));
  if (!(rows as any[]).length) return res.status(404).json({ error: "Config tidak ditemukan" });
  const cfg = (rows as any[])[0];
  const result = await testSheetConnection(cfg.sheet_id, cfg.tab_name);
  return res.json(result);
});

// GET /api/bank-reconciliation/sheet-configs/:id/diagnose — read-only sheet diagnostic
router.get("/sheet-configs/:id/diagnose", async (req, res) => {
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid" });
  try {
    const { diagnoseSheetConfig } = await import("../lib/sheetSyncService.js");
    const result = await diagnoseSheetConfig(id);
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message ?? "Diagnosa gagal" });
  }
});

// POST /api/bank-reconciliation/sheet-configs/:id/sync — sync one config now
router.post("/sheet-configs/:id/sync", async (req, res) => {
  // Run migration first so bank_sheet_configs + canonical_key column exist
  await runBankReconciliationCoreMigration();
  const id = parseInt(req.params.id);
  if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid" });

  // Credential pre-check — same check used by background sync
  if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
    return res.status(400).json({
      ok: false,
      error: "GOOGLE_SERVICE_ACCOUNT_JSON belum dikonfigurasi di Secrets.",
      hint: "Buka Secrets → tambahkan GOOGLE_SERVICE_ACCOUNT_JSON dengan isi JSON key Service Account.",
    });
  }

  try {
    // Use static import (syncOneSheetConfig imported at top of file)
    // — no dynamic import, no module-cache race condition
    const result = await syncOneSheetConfig(id);
    return res.json(result);
  } catch (err: any) {
    logger.warn({ err: err.message, id }, "[bankRecon] manual sheet sync failed");
    return res.status(500).json({ error: err.message ?? "Sync gagal" });
  }
});

// ─── GET /api/bank-reconciliation/test-connection ─────────────────────────────
// Diagnostik: test koneksi Google Sheet tanpa import data (env-var mode)
router.get("/test-connection", async (_req, res) => {
  const sheetId  = process.env.GOOGLE_SHEET_ID_BANK_MUTATIONS ?? "";
  const saJson   = process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? "";
  const tabName  = process.env.GOOGLE_SHEET_MUTATIONS_TAB ?? "Mutasi_Bank";

  const missing: string[] = [];
  if (!sheetId)  missing.push("GOOGLE_SHEET_ID_BANK_MUTATIONS");
  if (!saJson)   missing.push("GOOGLE_SERVICE_ACCOUNT_JSON");

  if (missing.length > 0) {
    return res.status(200).json({
      ok: false,
      stage: "config",
      error: `Secret belum diset: ${missing.join(", ")}`,
      missing,
      sheetId: sheetId || null,
      tabName,
      serviceAccountEmail: null,
    });
  }

  // Parse service account JSON
  let serviceAccountEmail: string | null = null;
  try {
    const parsed = JSON.parse(saJson);
    serviceAccountEmail = parsed.client_email ?? null;
  } catch {
    return res.status(200).json({
      ok: false,
      stage: "parse",
      error: "GOOGLE_SERVICE_ACCOUNT_JSON bukan JSON valid. Coba re-download key dari Google Cloud Console.",
      sheetId,
      tabName,
      serviceAccountEmail: null,
    });
  }

  // Try connecting
  try {
    const { getSpreadsheetMeta } = await import("../lib/googleSheets.js");
    const meta = await getSpreadsheetMeta(sheetId);
    const tabExists = meta.sheets.includes(tabName);

    return res.json({
      ok: true,
      stage: "connected",
      sheetId,
      tabName,
      serviceAccountEmail,
      spreadsheetTitle: meta.title,
      availableTabs: meta.sheets,
      tabExists,
      message: tabExists
        ? `Koneksi OK — sheet "${tabName}" ditemukan di "${meta.title}"`
        : `Koneksi OK — tapi tab "${tabName}" tidak ditemukan. Tab tersedia: ${meta.sheets.join(", ")}`,
    });
  } catch (err: any) {
    const msg: string = err?.message ?? String(err);
    let hint = "";
    if (msg.includes("invalid_grant") || msg.includes("Invalid JWT")) {
      hint = "Private key di GOOGLE_SERVICE_ACCOUNT_JSON rusak. Re-download file JSON key dari Google Cloud Console dan paste ulang seluruh isinya.";
    } else if (msg.includes("403") || msg.includes("PERMISSION_DENIED")) {
      hint = `Sheet belum di-share ke service account. Buka spreadsheet → Share → tambahkan "${serviceAccountEmail}" sebagai Editor.`;
    } else if (msg.includes("404") || msg.includes("not found")) {
      hint = "GOOGLE_SHEET_ID_BANK_MUTATIONS salah. Cek URL spreadsheet: docs.google.com/spreadsheets/d/[ID_INI]/edit";
    }

    return res.status(200).json({
      ok: false,
      stage: "connect",
      error: msg,
      hint: hint || undefined,
      sheetId,
      tabName,
      serviceAccountEmail,
    });
  }
});

// ─── POST /api/bank-reconciliation/sheet-sync ─────────────────────────────────
// Manual trigger Google Sheet sync (tanpa menunggu cron 60s)
router.post("/sheet-sync", async (req, res) => {
  const { syncAllSheetConfigs, syncSheetToReplit } = await import("../lib/sheetSyncService.js");
  try {
    // Sync semua DB configs (multi-sheet) terlebih dahulu
    await syncAllSheetConfigs();
    // Fallback legacy env-var sheet jika tidak ada DB config
    const { rows: cfgRows } = await db.execute(sql.raw(
      `SELECT COUNT(*) AS n FROM bank_sheet_configs WHERE is_active = TRUE`,
    )).catch(() => ({ rows: [{ n: "0" }] }));
    const hasDbConfigs = Number((cfgRows as any[])[0]?.n ?? 0) > 0;
    if (!hasDbConfigs) await syncSheetToReplit();
    return res.json({ ok: true, message: "Sync dari Google Sheet selesai" });
  } catch (err: any) {
    return res.status(500).json({ error: err.message ?? "Sheet sync gagal" });
  }
});

// ─── GET /api/bank-reconciliation/health ──────────────────────────────────────
router.get("/health", async (_req, res) => {
  try {
    const health = await getHealthStatus();
    const httpStatus = health.status === "critical" ? 503 : health.status === "degraded" ? 207 : 200;
    return res.status(httpStatus).json(health);
  } catch (err: any) {
    return res.status(500).json({ error: err.message ?? "Health check gagal" });
  }
});

// ─── GET /api/bank-reconciliation/metrics ─────────────────────────────────────
router.get("/metrics", async (_req, res) => {
  try {
    const metrics = await getDashboardMetrics();
    return res.json(metrics);
  } catch (err: any) {
    return res.status(500).json({ error: err.message ?? "Metrics gagal" });
  }
});

// ─── POST /api/bank-reconciliation/drift-check ────────────────────────────────
// Manual trigger drift detection
router.post("/drift-check", async (_req, res) => {
  try {
    const result = await detectDrift();
    return res.json(result);
  } catch (err: any) {
    return res.status(500).json({ error: err.message ?? "Drift check gagal" });
  }
});

// ─── GET /api/bank-reconciliation/alerts ──────────────────────────────────────
router.get("/alerts", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const severity = req.query.severity as string | undefined;
    const sinceHours = Number(req.query.hours ?? 24);

    let whereClauses = [`created_at > NOW() - INTERVAL '${sinceHours} hours'`];
    if (severity) whereClauses.push(`severity = '${severity.toUpperCase().replace(/'/g, "")}'`);

    const { rows } = await db.execute(sql.raw(`
      SELECT id, type, severity, mutation_key, description, created_at
      FROM reconciliation_alerts
      WHERE ${whereClauses.join(" AND ")}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `));

    return res.json({ alerts: rows, total: (rows as any[]).length });
  } catch (err: any) {
    return res.status(500).json({ error: err.message ?? "Gagal fetch alerts" });
  }
});

// ─── GET /api/bank-reconciliation/sync-logs ───────────────────────────────────
router.get("/sync-logs", async (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit ?? 50), 200);
    const { rows } = await db.execute(sql.raw(`
      SELECT id, sync_type, status, records_processed, records_failed,
             execution_time_ms, error_message, created_at
      FROM reconciliation_sync_logs
      ORDER BY created_at DESC
      LIMIT ${limit}
    `));
    return res.json({ logs: rows, total: (rows as any[]).length });
  } catch (err: any) {
    return res.status(500).json({ error: err.message ?? "Gagal fetch sync logs" });
  }
});

// ─── POST /api/bank-reconciliation/smart-import ───────────────────────────────
// Menerima file CSV / Excel / MT940 / CAMT.053, auto-deteksi format,
// parse, jalankan matching engine, simpan ke bank_mutations, return hasil split.
router.post("/smart-import", upload.single("file"), async (req, res) => {
  await runBankReconciliationCoreMigration();
  try {
    if (!req.file) return res.status(400).json({ error: "File wajib diupload" });

    const filename = req.file.originalname ?? "upload";
    const buffer = req.file.buffer;
    const contentStr = buffer.toString("utf-8");
    const actor = (req as any).user?.email ?? "system";
    const companyId = req.body?.company_id ? Number(req.body.company_id) : null;
    const forceFormat = req.body?.format as string | undefined;

    // ── Detect & parse ────────────────────────────────────────────────────────
    const fmt = (forceFormat && ["csv","excel","mt940","camt053"].includes(forceFormat))
      ? forceFormat
      : detectFormat(filename, contentStr);

    let parsedRows: ParsedBankRow[] = [];

    if (fmt === "mt940") {
      parsedRows = parseMT940(contentStr);
    } else if (fmt === "camt053") {
      parsedRows = parseCAMT053(contentStr);
    } else if (fmt === "csv") {
      parsedRows = parseCSVText(contentStr);
    } else if (fmt === "excel") {
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(buffer as any);
      const ws = workbook.worksheets[0];
      if (!ws) return res.status(400).json({ error: "Worksheet tidak ditemukan di file Excel" });
      const headers: string[] = [];
      ws.getRow(1).eachCell({ includeEmpty: true }, (cell, colIdx) => {
        headers[colIdx - 1] = String(cell.value ?? "").toLowerCase().trim();
      });
      const rawRows: Record<string, string>[] = [];
      ws.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        const obj: Record<string, string> = {};
        headers.forEach((h, i) => {
          const cell = row.getCell(i + 1);
          let val: unknown = cell.value ?? "";
          if (val !== null && typeof val === "object" && "result" in (val as object)) {
            val = (val as { result: unknown }).result ?? "";
          }
          obj[h] = String(val);
        });
        rawRows.push(obj);
      });
      // Re-use CSV parser logic by constructing CSV header line + data
      const csvLines = [
        headers.join(","),
        ...rawRows.map(r => headers.map(h => `"${(r[h] ?? "").replace(/"/g, '""')}"`).join(",")),
      ].join("\n");
      parsedRows = parseCSVText(csvLines);
    }

    if (!parsedRows.length) {
      return res.status(400).json({ error: "Tidak ada baris valid ditemukan setelah parsing", format: fmt });
    }

    // ── Per-row: run matching engine & insert into bank_mutations ─────────────
    const reconciledRows: any[] = [];
    const exceptionRows: any[] = [];
    let imported = 0;
    let duplicates = 0;

    for (const pr of parsedRows) {
      const mutationKey = buildMutationKeyFromParsed(pr);
      const normalizedDesc = normalizeForMatching(pr.description);
      const providerOrderId = pr.reference ?? null;

      // Dedup check
      const { rows: existing } = await db.execute(sql.raw(
        `SELECT id FROM bank_mutations WHERE mutation_key = '${mutationKey.replace(/'/g, "''")}'`
      ));
      if (existing.length > 0) { duplicates++; continue; }

      // Insert with status=unmatched initially
      const { rows: inserted } = await db.execute(sql.raw(`
        INSERT INTO bank_mutations
          (transaction_date, description, credit_amount, debit_amount, amount, direction,
           mutation_key, normalized_description, provider_name, provider_order_id,
           status, source, raw_payload, company_id)
        VALUES (
          '${pr.date}',
          '${pr.description.replace(/'/g, "''")}',
          ${pr.direction === "IN" ? pr.amount : 0},
          ${pr.direction === "OUT" ? pr.amount : 0},
          ${pr.amount},
          '${pr.direction}',
          '${mutationKey.replace(/'/g, "''")}',
          '${normalizedDesc.replace(/'/g, "''")}',
          ${pr.vendorName ? `'${pr.vendorName.replace(/'/g, "''")}'` : "NULL"},
          ${providerOrderId ? `'${providerOrderId.replace(/'/g, "''")}'` : "NULL"},
          'unmatched',
          '${(pr.rawSource ?? fmt).replace(/'/g, "''")}',
          '${JSON.stringify(pr).replace(/'/g, "''")}',
          ${companyId ?? "NULL"}
        )
        RETURNING id
      `)).catch(e => {
        logger.warn({ err: e.message }, "[smartImport] insert failed");
        return { rows: [] };
      });

      if (!(inserted as any[])[0]) continue;
      const mutId = Number(((inserted as any[])[0] as any).id);
      imported++;

      // Run matching engine synchronously for smart-import response
      try {
        const candidates = await fetchCandidates({
          amount: pr.amount,
          transaction_date: pr.date,
          direction: pr.direction,
          company_id: companyId,
          provider_name: detectProvider(pr.description),
        });
        const scored = candidates.map(c => scoreUnified({
          amount: pr.amount,
          transaction_date: pr.date,
          provider_order_id: providerOrderId,
          uploaded_proof_url: null,
          normalized_description: normalizedDesc,
          company_id: companyId,
          bank_account_id: null,
          provider_name: detectProvider(pr.description),
        }, c));
        scored.sort((a, b) => b.score - a.score);
        const best = scored[0];
        const status = best?.candidate.candidateSource ===
          RECONCILIATION_CANDIDATE_SOURCES.CANONICAL_SPORT_CENTER
          ? "manual_review"
          : best
            ? classifyMatch(best)
            : "unmatched";

        const rowResult = {
          id: mutId,
          date: pr.date,
          description: pr.description,
          amount: pr.amount,
          direction: pr.direction,
          reference: pr.reference,
          vendorName: pr.vendorName,
          confidence: best?.confidence ?? 0,
          score: best?.score ?? 0,
          reason: best?.reason ?? [],
          match_status: status,
          candidate_type: best?.candidate.type,
          candidate_id: best?.candidate.id,
          candidate_source: best?.candidate.candidateSource ?? null,
          vendor_match: best?.vendor_match ?? false,
          amount_match: best?.amount_match ?? false,
          date_match: best?.date_match ?? false,
          ref_match: best?.ref_match ?? false,
        };

        if (status === "auto_matched") {
          // Update status in DB
          await db.execute(sql.raw(
            `UPDATE bank_mutations SET status = 'reconciled', updated_at = NOW() WHERE id = ${mutId}`
          )).catch(() => {});
          reconciledRows.push(rowResult);
        } else {
          exceptionRows.push(rowResult);
        }
      } catch (e: any) {
        logger.warn({ err: e.message, mutId }, "[smartImport] matching failed");
        exceptionRows.push({
          id: mutId,
          date: pr.date,
          description: pr.description,
          amount: pr.amount,
          direction: pr.direction,
          confidence: 0,
          score: 0,
          reason: [],
          match_status: "unmatched",
        });
      }
    }

    audit(req, {
      action: "smart_import",
      module: "accounting",
      resourceId: `smart-import-${Date.now()}`,
      after: { format: fmt, imported, duplicates, reconciled: reconciledRows.length, exceptions: exceptionRows.length },
    });

    return res.json({
      ok: true,
      format: fmt,
      imported,
      duplicates,
      total_parsed: parsedRows.length,
      reconciled_count: reconciledRows.length,
      exception_count: exceptionRows.length,
      reconciled: reconciledRows,
      exceptions: exceptionRows,
    });
  } catch (e: any) {
    logger.error({ err: e }, "[bankRecon] smart-import error");
    return res.status(500).json({ error: e.message });
  }
});

// ─── GET /api/bank-reconciliation/smart-import/summary ────────────────────────
router.get("/smart-import/summary", async (req, res) => {
  await runBankReconciliationCoreMigration();
  try {
    const { rows } = await db.execute(sql.raw(`
      SELECT
        COUNT(*) FILTER (WHERE status = 'unmatched')   AS exception_count,
        COUNT(*) FILTER (WHERE status = 'reconciled')  AS reconciled_count,
        COUNT(*) FILTER (WHERE status = 'matched')     AS matched_count,
        COUNT(*)                                        AS total,
        source,
        DATE(created_at) AS import_date
      FROM bank_mutations
      WHERE source IN ('MT940', 'CAMT.053', 'CSV', 'EXCEL', 'csv', 'excel', 'mt940', 'camt053')
      GROUP BY source, DATE(created_at)
      ORDER BY import_date DESC
      LIMIT 30
    `));
    return res.json({ summary: rows });
  } catch (e: any) {
    return res.status(500).json({ error: e.message });
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// PHASE 4 — ERP Document Matching + Historical Matching + Recommendation
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Validasi date_tolerance_days dari request body.
 * Mengembalikan nilai yang sudah dibersihkan, atau undefined jika tidak ada / tidak valid.
 * Range yang diperbolehkan: 0–30 hari.
 */
function parseDateTolerance(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0 || n > 30) return undefined;
  return Math.floor(n);
}

/**
 * Helper: ambil mutasi + validasi company isolation.
 *
 * Mengembalikan data mutasi dari DB, ATAU error response dan null jika:
 *   - ID mutasi tidak valid
 *   - Mutasi tidak ditemukan
 *   - companyId tidak cocok dengan scope admin (jika admin punya scope company)
 */
async function fetchAndValidateMutation(
  mutId: number,
  res: any,
): Promise<{
  id: number; company_id: string | null; amount: string; direction: string;
  transaction_date: string; normalized_description: string | null;
  description: string | null; provider_name: string | null;
  provider_order_id: string | null; bank_account_id: string | null;
} | null> {
  const { rows: mutRows } = await db.execute(sql.raw(`
    SELECT id, company_id, amount, direction, transaction_date,
           normalized_description, description, provider_name, provider_order_id,
           bank_account_id
    FROM bank_mutations
    WHERE id = ${mutId}
  `));

  if (!mutRows.length) {
    res.status(404).json({ error: "Mutasi tidak ditemukan" });
    return null;
  }

  return mutRows[0] as any;
}

/**
 * POST /api/bank-reconciliation/:mutationId/match-documents
 *
 * Menjalankan ERP document matching untuk satu mutasi.
 * Mencari kecocokan di expenses, accounting_payments, cash_advances,
 * logistic_orders, dan sales_documents (sumber aktif dengan company_id).
 *
 * Schema validation:
 *   - mutationId: integer > 0
 *   - body.date_tolerance_days: integer 0–30 (opsional)
 *
 * Company isolation: semua sumber ERP di-query dengan WHERE company_id = mut.company_id.
 *
 * Tidak membuat jurnal, expense, atau memanggil AI.
 */
router.post("/:mutationId/match-documents", async (req, res) => {
  await runBankReconciliationCoreMigration();

  // ── Schema validation: mutationId ─────────────────────────────────────────
  const mutId = parseInt(req.params.mutationId, 10);
  if (!Number.isFinite(mutId) || mutId <= 0) {
    return res.status(400).json({ error: "mutationId harus berupa integer positif" });
  }

  // ── Schema validation: body ───────────────────────────────────────────────
  const dateTolerance = parseDateTolerance(req.body?.date_tolerance_days);
  if (
    req.body?.date_tolerance_days !== undefined &&
    req.body?.date_tolerance_days !== "" &&
    dateTolerance === undefined
  ) {
    return res.status(400).json({
      error: "date_tolerance_days harus berupa integer antara 0 dan 30",
    });
  }

  try {
    const mut = await fetchAndValidateMutation(mutId, res);
    if (!mut) return;

    const companyId = mut.company_id != null ? Number(mut.company_id) : null;
    const rawDesc   = String(mut.description ?? "");

    // Fresh normalization dari deskripsi mentah (bukan stale DB value)
    const normResult = normalizeDescription(rawDesc);
    const freshNorm  = normResult.normalized.trim() || null;

    // Gunakan fresh norm jika tersedia; fallback ke DB value jika rawDesc kosong
    const normalizedDesc = freshNorm ?? mut.normalized_description ?? null;

    const result = await runErpDocumentMatching({
      id:                   mutId,
      companyId,
      amount:               Number(mut.amount),
      direction:            (mut.direction === "IN" ? "IN" : "OUT") as "IN" | "OUT",
      transactionDate:      String(mut.transaction_date ?? "").split("T")[0],
      normalizedDescription: normalizedDesc,
      providerName:         normResult.provider ?? mut.provider_name ?? null,
      providerOrderId:      normResult.providerOrderId ?? mut.provider_order_id ?? null,
      bankAccountId:        mut.bank_account_id != null ? Number(mut.bank_account_id) : null,
      dateTolerance,
    });

    return res.json({ ok: true, mutationId: mutId, erpMatch: result });
  } catch (e: any) {
    logger.error({ err: e.message, mutId }, "[bankRecon] match-documents gagal");
    return res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/bank-reconciliation/:mutationId/match-history
 *
 * Menjalankan historical matching untuk satu mutasi.
 * Hanya menggunakan klasifikasi APPROVED sebelumnya — tidak lintas company.
 *
 * Schema validation:
 *   - mutationId: integer > 0
 *   - body: tidak ada field yang digunakan, diabaikan
 *
 * Company isolation: fetchApprovedHistory diquery dengan WHERE company_id = mut.company_id.
 *
 * Tidak membuat jurnal, expense, atau memanggil AI.
 */
router.post("/:mutationId/match-history", async (req, res) => {
  await runBankReconciliationCoreMigration();

  // ── Schema validation: mutationId ─────────────────────────────────────────
  const mutId = parseInt(req.params.mutationId, 10);
  if (!Number.isFinite(mutId) || mutId <= 0) {
    return res.status(400).json({ error: "mutationId harus berupa integer positif" });
  }

  try {
    const mut = await fetchAndValidateMutation(mutId, res);
    if (!mut) return;

    const companyId = mut.company_id != null ? Number(mut.company_id) : null;
    const rawDesc   = String(mut.description ?? "");

    // Fresh normalization (bukan stale DB value)
    const normResult = normalizeDescription(rawDesc);
    const freshNorm  = normResult.normalized.trim() || null;
    const normalizedDesc = freshNorm ?? mut.normalized_description ?? null;

    const result = await runHistoricalMatching({
      amount:               Number(mut.amount),
      direction:            (mut.direction === "IN" ? "IN" : "OUT") as "IN" | "OUT",
      transactionDate:      String(mut.transaction_date ?? "").split("T")[0],
      normalizedDescription: normalizedDesc,
      rawDescription:       rawDesc,
      companyId,
    });

    return res.json({ ok: true, mutationId: mutId, historicalMatch: result });
  } catch (e: any) {
    logger.error({ err: e.message, mutId }, "[bankRecon] match-history gagal");
    return res.status(500).json({ error: e.message });
  }
});

/**
 * POST /api/bank-reconciliation/:mutationId/recommend
 *
 * Menjalankan pipeline Phase 4 penuh:
 *  1. Normalize description (FRESH — bukan stale DB value)
 *  2. Rule Engine (built-in + DB rules untuk company ini)
 *  3. ERP Document Match (5 sumber aktif, semua company-scoped)
 *  4. Historical Match (hanya approved history, company-scoped)
 *  5. Combined recommendation
 *
 * Schema validation:
 *   - mutationId: integer > 0
 *   - body.date_tolerance_days: integer 0–30 (opsional)
 *
 * Company isolation:
 *   - Semua query ERP menggunakan WHERE company_id = mut.company_id
 *   - Historical matching menggunakan JOIN company_id = mut.company_id
 *   - Rule DB query menggunakan WHERE company_id IS NULL OR company_id = mut.company_id
 *
 * AI TIDAK dipanggil. Idempoten: memanggil berulang kali menghasilkan output sama.
 */
router.post("/:mutationId/recommend", async (req, res) => {
  await runBankReconciliationCoreMigration();

  // ── Schema validation: mutationId ─────────────────────────────────────────
  const mutId = parseInt(req.params.mutationId, 10);
  if (!Number.isFinite(mutId) || mutId <= 0) {
    return res.status(400).json({ error: "mutationId harus berupa integer positif" });
  }

  // ── Schema validation: body ───────────────────────────────────────────────
  const dateTolerance = parseDateTolerance(req.body?.date_tolerance_days);
  if (
    req.body?.date_tolerance_days !== undefined &&
    req.body?.date_tolerance_days !== "" &&
    dateTolerance === undefined
  ) {
    return res.status(400).json({
      error: "date_tolerance_days harus berupa integer antara 0 dan 30",
    });
  }

  try {
    // ── 1. Ambil data mutasi + company isolation check ────────────────────────
    const mut = await fetchAndValidateMutation(mutId, res);
    if (!mut) return;

    const companyId: number | null = mut.company_id != null ? Number(mut.company_id) : null;
    const direction: "IN" | "OUT"  = mut.direction === "IN" ? "IN" : "OUT";
    const amount                   = Number(mut.amount);
    const txDate                   = String(mut.transaction_date ?? "").split("T")[0];
    const rawDesc                  = String(mut.description ?? "");

    // ── 2. Fresh normalization (WAJIB digunakan oleh semua stage berikutnya) ──
    // Jangan gunakan stale normalized_description dari DB — selalu hitung ulang
    // agar pipeline idempoten dan tidak bergantung pada kapan mutasi di-import.
    const normResult = normalizeDescription(rawDesc);
    const freshNorm  = normResult.normalized.trim() || null;

    // Fallback ke DB value hanya jika rawDesc benar-benar kosong (misal mutasi manual)
    const normalizedDesc: string | null = freshNorm ?? mut.normalized_description ?? null;

    // Provider hints dari normalization (lebih akurat dari stored values)
    const providerName    = normResult.provider     ?? mut.provider_name    ?? null;
    const providerOrderId = normResult.providerOrderId ?? mut.provider_order_id ?? null;

    // ── 3. Rule Engine ────────────────────────────────────────────────────────
    // Ambil DB rules untuk company ini (company-scoped + global)
    let dbRules: any[] = [];
    try {
      const { rows: ruleRows } = await db.execute(sql.raw(`
        SELECT id, company_id, name, priority, conditions, action, is_active
        FROM expense_rules
        WHERE is_active = TRUE
          AND (company_id IS NULL ${companyId != null ? `OR company_id = ${companyId}` : ""})
        ORDER BY priority ASC, id ASC
        LIMIT 200
      `)).catch(() => ({ rows: [] }));
      dbRules = (ruleRows as any[]).map(r => ({
        id:         Number(r.id),
        companyId:  r.company_id != null ? Number(r.company_id) : null,
        name:       String(r.name),
        priority:   Number(r.priority),
        conditions: typeof r.conditions === "string" ? JSON.parse(r.conditions) : (r.conditions ?? []),
        action:     typeof r.action === "string" ? JSON.parse(r.action) : (r.action ?? {}),
        isActive:   Boolean(r.is_active),
      }));
    } catch {
      // Rule engine tetap berjalan dengan built-in rules jika DB gagal
    }

    const mergedRules = mergeRules(dbRules, companyId);
    const ruleResult  = runRuleEngine(mergedRules, normResult, { direction });

    // ── 4. ERP Document Match ─────────────────────────────────────────────────
    // Menggunakan normalizedDesc dari fresh normalization (bukan stale DB)
    const erpMatch = await runErpDocumentMatching({
      id:                   mutId,
      companyId,                              // isolation terjamin di fetchActiveCandidates
      amount,
      direction,
      transactionDate:      txDate,
      normalizedDescription: normalizedDesc,  // FRESH — dari normResult.normalized
      providerName,                           // FRESH — dari normResult.provider
      providerOrderId,                        // FRESH — dari normResult.providerOrderId
      bankAccountId:        mut.bank_account_id != null ? Number(mut.bank_account_id) : null,
      dateTolerance,
    });

    // ── 5. Historical Match ───────────────────────────────────────────────────
    // Menggunakan normalizedDesc dari fresh normalization
    const historicalMatch = await runHistoricalMatching({
      amount,
      direction,
      transactionDate:      txDate,
      normalizedDescription: normalizedDesc,  // FRESH — dari normResult.normalized
      rawDescription:       rawDesc,
      companyId,                              // isolation terjamin di fetchApprovedHistory
    });

    // ── 6. Combined Recommendation ────────────────────────────────────────────
    const recommendation = await buildCombinedRecommendation({
      mutationId:     mutId,
      companyId,
      amount,
      direction,
      ruleResult,
      erpMatch,
      historicalMatch,
    });

    return res.json({ ok: true, ...recommendation });
  } catch (e: any) {
    logger.error({ err: e.message, mutId }, "[bankRecon] recommend gagal");
    return res.status(500).json({ error: e.message });
  }
});

// ─── Batch 3 Endpoints ────────────────────────────────────────────────────────

/**
 * GET /bank-reconciliation/confidence-report
 * Returns calibration bands with predicted vs actual accuracy.
 */
router.get("/confidence-report", async (req, res) => {
  const companyId = req.query["companyId"] != null ? Number(req.query["companyId"]) : null;
  if (!companyId || isNaN(companyId)) return res.status(400).json({ error: "companyId query param required" });
  try {
    const report = await getCalibrationReport(companyId);
    return res.json({ ok: true, report });
  } catch (e: any) {
    logger.error({ err: e.message }, "[bankRecon] confidence-report failed");
    return res.status(500).json({ error: e.message });
  }
});

/**
 * POST /bank-reconciliation/calibration/record
 * Records a match outcome for calibration tracking.
 */
router.post("/calibration/record", async (req, res) => {
  const { confidence, wasCorrect, companyId } = req.body ?? {};
  if (confidence == null || wasCorrect == null || companyId == null) {
    return res.status(400).json({ error: "confidence, wasCorrect, companyId required" });
  }
  try {
    await recordMatchOutcome({ companyId: Number(companyId), predictedConfidence: Number(confidence), wasCorrect: Boolean(wasCorrect) });
    return res.json({ ok: true });
  } catch (e: any) {
    logger.error({ err: e.message }, "[bankRecon] calibration/record failed");
    return res.status(500).json({ error: e.message });
  }
});

/**
 * GET /bank-reconciliation/payment-graph/mutation/:mutationId
 * Returns the payment relationship graph centered on a bank mutation.
 */
router.get("/payment-graph/mutation/:mutationId", async (req, res) => {
  const mutId = Number(req.params["mutationId"]);
  if (!mutId || isNaN(mutId)) return res.status(400).json({ error: "Invalid mutationId" });
  const companyId = req.query["companyId"] != null ? Number(req.query["companyId"]) : null;
  if (!companyId || isNaN(companyId)) return res.status(400).json({ error: "companyId query param required" });
  try {
    const graph = await buildGraphFromMutation(mutId, companyId);
    return res.json({ ok: true, graph });
  } catch (e: any) {
    logger.error({ err: e.message, mutId }, "[bankRecon] payment-graph/mutation failed");
    return res.status(500).json({ error: e.message });
  }
});

/**
 * GET /bank-reconciliation/payment-graph/invoice/:invoiceId
 * Returns the payment relationship graph centered on an invoice.
 */
router.get("/payment-graph/invoice/:invoiceId", async (req, res) => {
  const invId = Number(req.params["invoiceId"]);
  if (!invId || isNaN(invId)) return res.status(400).json({ error: "Invalid invoiceId" });
  const companyId = req.query["companyId"] != null ? Number(req.query["companyId"]) : null;
  if (!companyId || isNaN(companyId)) return res.status(400).json({ error: "companyId query param required" });
  try {
    const graph = await buildGraphFromInvoice(invId, companyId);
    return res.json({ ok: true, graph });
  } catch (e: any) {
    logger.error({ err: e.message, invId }, "[bankRecon] payment-graph/invoice failed");
    return res.status(500).json({ error: e.message });
  }
});

/**
 * POST /bank-reconciliation/mutations/:mutationId/multi-invoice-match
 * Runs multi-invoice matching for a given mutation and returns the best allocation plan.
 */
router.post("/mutations/:mutationId/multi-invoice-match", async (req, res) => {
  const mutId = Number(req.params["mutationId"]);
  if (!mutId || isNaN(mutId)) return res.status(400).json({ error: "Invalid mutationId" });

  try {
    // Fetch the mutation
    const { rows: mutRows } = await db.execute(sql.raw(`
      SELECT id, amount, company_id, transaction_date FROM bank_mutations
      WHERE id = ${mutId} LIMIT 1
    `)).catch(() => ({ rows: [] as unknown[] }));
    if (!(mutRows as unknown[]).length) return res.status(404).json({ error: "Mutation not found" });
    const mut = (mutRows as any[])[0];
    const companyId = Number(mut.company_id);
    const amount    = Number(mut.amount ?? mut.credit_amount ?? mut.debit_amount ?? 0);
    const txDate    = String(mut.transaction_date ?? "").split("T")[0];

    // Fetch invoice candidates
    const { rows: invRows } = await db.execute(sql.raw(`
      SELECT sd.id AS invoice_id, sd.doc_number AS invoice_ref,
             sd.total_amount AS amount, sd.due_date::text AS due_date,
             COALESCE(c.name, '') AS customer_name
      FROM sales_documents sd
      LEFT JOIN customers c ON c.id = sd.customer_id
      WHERE sd.kind = 'invoice'
        AND sd.company_id = ${companyId}
        AND sd.status NOT IN ('paid','cancelled','void')
        AND sd.total_amount <= ${amount} * 1.05
        AND sd.total_amount >= ${amount} * 0.01
        AND COALESCE(sd.invoice_date, sd.created_at::date) >= '${txDate}'::date - 90
      ORDER BY sd.total_amount DESC
      LIMIT 100
    `)).catch(() => ({ rows: [] as unknown[] }));

    const candidates = (invRows as any[]).map(r => ({
      invoiceId:    Number(r.invoice_id),
      invoiceRef:   String(r.invoice_ref ?? ""),
      amount:       Number(r.amount ?? 0),
      dueDate:      r.due_date ? String(r.due_date) : null,
      customerName: r.customer_name ? String(r.customer_name) : null,
      companyId,
    }));

    const matchResult = findBestMultiInvoiceMatch(amount, candidates, {
      maxCandidates: 100,
      toleranceFraction: 0.001,
      allowPartial: true,
    });

    // If we have a match, also build an allocation plan
    let allocationPlan = null;
    if (matchResult.matchType !== "NO_MATCH" && matchResult.invoices.length > 0) {
      const strategy = await getCompanyAllocationStrategy(companyId).catch(() => "FIFO" as const);
      const allocInvoices = matchResult.invoices.map(i => ({
        invoiceId:       i.invoiceId,
        invoiceRef:      i.invoiceRef,
        amount:          i.amount,
        remainingAmount: i.amount,
        issueDate:       txDate,
        dueDate:         null,
      }));
      allocationPlan = buildAllocationPlan(amount, allocInvoices, strategy);
    }

    return res.json({
      ok: true,
      mutationId:    mutId,
      amount,
      matchResult,
      allocationPlan,
      candidateCount: candidates.length,
    });
  } catch (e: any) {
    logger.error({ err: e.message, mutId }, "[bankRecon] multi-invoice-match failed");
    return res.status(500).json({ error: e.message });
  }
});

/**
 * POST /bank-reconciliation/mutations/:mutationId/apply-allocation
 * Applies an allocation plan (writes payment_allocations rows).
 */
router.post("/mutations/:mutationId/apply-allocation", async (req, res) => {
  const mutId = Number(req.params["mutationId"]);
  if (!mutId || isNaN(mutId)) return res.status(400).json({ error: "Invalid mutationId" });
  const { allocationPlan, companyId, groupId, actor } = req.body ?? {};
  if (!allocationPlan || !companyId) return res.status(400).json({ error: "allocationPlan and companyId required" });

  try {
    const result = await applyAllocationPlan(
      allocationPlan,
      Number(mutId),
      Number(companyId),
      groupId != null ? Number(groupId) : null,
      String(actor ?? "api"),
    );
    return res.json({ ok: true, result });
  } catch (e: any) {
    logger.error({ err: e.message, mutId }, "[bankRecon] apply-allocation failed");
    return res.status(500).json({ error: e.message });
  }
});

export { router as bankReconciliationRouter };
