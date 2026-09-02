#!/usr/bin/env node
/**
 * Reset the verified orphaned canonical QRIS settlement flags in PROD.
 *
 * This is an exact-manifest repair, not a general "unsettle" tool. It only
 * changes the 27 payment sources proven to be settled without canonical or
 * legacy settlement items. It never creates a settlement, journal, or bank
 * reconciliation link.
 *
 * Usage:
 *   APP_ENV=production CF_SC_ORPHAN_QRIS_STATUS_RESET_APPLY=true \
 *     node artifacts/api-server/load-secrets.mjs \
 *     node scripts/repair-prod-orphan-qris-status.mjs
 */

import pg from "pg";
import { PROD_PROJECT_REF, extractProjectRef } from "./runtime-db-guard.mjs";

const { Client } = pg;
const ACTOR = "production-orphan-qris-status-repair";
const APPLY_FLAG = "true";
const PAYMENT_BANK_ACCOUNT_ID = "1640006707220";
const PAYMENT_PROVIDER = "mandiri_direct";

// These are the read-only audited PROD facts. Candidate paymentIds includes
// every item in the candidate; paymentIds includes only settled orphan sources
// that this repair is authorized to reset.
const TARGETS = [
  { mutationId: 4750, candidateId: 2640, companyId: 1, bankAccountId: 2, bankDate: "2026-06-17", bankAmount: 297900, bankStatus: "matched", bankProvider: "QRIS", candidatePaymentIds: [78, 79], paymentIds: [78, 79], expectedDates: { 78: "2026-06-17", 79: "2026-06-17" } },
  { mutationId: 4761, candidateId: 2642, companyId: 1, bankAccountId: 2, bankDate: "2026-06-19", bankAmount: 426990, bankStatus: "matched", bankProvider: "QRIS", candidatePaymentIds: [65, 67, 70], paymentIds: [65, 67, 70], expectedDates: { 65: "2026-06-19", 67: "2026-06-19", 70: "2026-06-19" } },
  { mutationId: 4775, candidateId: 2646, companyId: 1, bankAccountId: 2, bankDate: "2026-06-24", bankAmount: 426990, bankStatus: "matched", bankProvider: "QRIS", candidatePaymentIds: [38, 51], paymentIds: [38, 51], expectedDates: { 38: "2026-06-24", 51: "2026-06-24" } },
  { mutationId: 4781, candidateId: 2648, companyId: 1, bankAccountId: 2, bankDate: "2026-06-26", bankAmount: 744750, bankStatus: "matched", bankProvider: "QRIS", candidatePaymentIds: [34, 35, 36, 37, 47, 48, 49], paymentIds: [34, 35, 36, 37, 47, 48, 49], expectedDates: { 34: "2026-06-26", 35: "2026-06-26", 36: "2026-06-26", 37: "2026-06-26", 47: "2026-06-26", 48: "2026-06-26", 49: "2026-06-26" } },
  { mutationId: 4786, candidateId: 2649, companyId: 1, bankAccountId: 2, bankDate: "2026-06-28", bankAmount: 1092300, bankStatus: "unmatched", bankProvider: "QRIS", candidatePaymentIds: [10], paymentIds: [10], expectedDates: { 10: "2026-06-29" } },
  { mutationId: 4787, candidateId: 2650, companyId: 1, bankAccountId: 2, bankDate: "2026-06-29", bankAmount: 228390, bankStatus: "unmatched", bankProvider: "QRIS", candidatePaymentIds: [18, 23, 24], paymentIds: [18], expectedDates: { 18: "2026-06-29" } },
  { mutationId: 4816, candidateId: 2657, companyId: 1, bankAccountId: 2, bankDate: "2026-07-06", bankAmount: 625590, bankStatus: "matched", bankProvider: "QRIS", candidatePaymentIds: [105, 106, 107], paymentIds: [105, 106, 107], expectedDates: { 105: "2026-07-06", 106: "2026-07-06", 107: "2026-07-06" } },
  { mutationId: 4825, candidateId: 2658, companyId: 1, bankAccountId: 2, bankDate: "2026-07-07", bankAmount: 695100, bankStatus: "matched", bankProvider: "QRIS", candidatePaymentIds: [108, 125, 138], paymentIds: [108, 125, 138], expectedDates: { 108: "2026-07-07", 125: "2026-07-07", 138: "2026-07-07" } },
  { mutationId: 4835, candidateId: 2663, companyId: 1, bankAccountId: 2, bankDate: "2026-07-12", bankAmount: 99300, bankStatus: "matched", bankProvider: "QRIS", candidatePaymentIds: [184], paymentIds: [184], expectedDates: { 184: "2026-07-13" } },
  { mutationId: 4953, candidateId: 2687, companyId: 1, bankAccountId: 2, bankDate: "2026-08-16", bankAmount: 496500, bankStatus: "unmatched", bankProvider: "QRIS", candidatePaymentIds: [361, 365], paymentIds: [365], expectedDates: { 365: "2026-08-17" } },
  { mutationId: 4984, candidateId: 2694, companyId: 1, bankAccountId: 2, bankDate: "2026-08-28", bankAmount: 575940, bankStatus: "unmatched", bankProvider: "QRIS", candidatePaymentIds: [411, 412, 413, 415], paymentIds: [411, 413, 415], expectedDates: { 411: "2026-08-28", 413: "2026-08-28", 415: "2026-08-28" } },
];

const TARGET_MUTATION_IDS = TARGETS.map((target) => target.mutationId);
const TARGET_CANDIDATE_IDS = TARGETS.map((target) => target.candidateId);
const TARGET_PAYMENT_IDS = [...new Set(TARGETS.flatMap((target) => target.paymentIds))].sort((a, b) => a - b);
const TARGET_CANDIDATE_PAYMENT_IDS = [...new Set(TARGETS.flatMap((target) => target.candidatePaymentIds))].sort((a, b) => a - b);
const targetByMutation = new Map(TARGETS.map((target) => [target.mutationId, target]));
const targetByCandidate = new Map(TARGETS.map((target) => [target.candidateId, target]));
const expectedDateByPayment = new Map(
  TARGETS.flatMap((target) => Object.entries(target.expectedDates).map(([id, date]) => [Number(id), date])),
);

if (process.env.APP_ENV !== "production") {
  throw new Error("ORPHAN_QRIS_RESET_PROD_ONLY: APP_ENV=production is required.");
}
if (process.env.CF_SC_ORPHAN_QRIS_STATUS_RESET_APPLY !== APPLY_FLAG) {
  throw new Error(
    "ORPHAN_QRIS_RESET_NOT_ARMED: set CF_SC_ORPHAN_QRIS_STATUS_RESET_APPLY=true for the guarded write.",
  );
}

const url = process.env.SUPABASE_DATABASE_URL;
if (!url) throw new Error("ORPHAN_QRIS_RESET_MISSING_DATABASE_URL");
const projectRef = extractProjectRef(url);
if (projectRef !== PROD_PROJECT_REF) {
  throw new Error(`ORPHAN_QRIS_RESET_TARGET_UNVERIFIED: ${projectRef ?? "unknown"}`);
}

const client = new Client({
  connectionString: url,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 10_000,
});

const exactSet = (actual, expected) => {
  if (!Array.isArray(actual) || actual.length !== expected.length) return false;
  return actual.slice().sort((a, b) => a - b).every((id, index) => id === expected[index]);
};

const candidatePaymentIds = (paymentItems) => {
  if (!Array.isArray(paymentItems)) return [];
  return paymentItems
    .map((item) => Number(item?.paymentId ?? item?.payment_id))
    .filter((id) => Number.isInteger(id))
    .sort((a, b) => a - b);
};

try {
  await client.connect();
  await client.query("BEGIN");

  for (const mutationId of TARGET_MUTATION_IDS) {
    await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `sport-center:qris:orphan-status:${mutationId}`,
    ]);
  }

  const mutationResult = await client.query(
    `SELECT id, company_id, bank_account_id, transaction_date::text AS transaction_date,
            amount::numeric::text AS amount, status::text AS status, provider_name
       FROM public.bank_mutations
      WHERE id = ANY($1::int[])
      ORDER BY id
      FOR UPDATE`,
    [TARGET_MUTATION_IDS],
  );
  if (mutationResult.rowCount !== TARGETS.length) {
    throw new Error(`ORPHAN_QRIS_RESET_MUTATION_COUNT_FAILED: expected ${TARGETS.length}, found ${mutationResult.rowCount}`);
  }
  for (const bank of mutationResult.rows) {
    const target = targetByMutation.get(Number(bank.id));
    if (
      !target
      || Number(bank.company_id) !== target.companyId
      || Number(bank.bank_account_id) !== target.bankAccountId
      || String(bank.transaction_date).slice(0, 10) !== target.bankDate
      || Number(bank.amount) !== target.bankAmount
      || String(bank.status).toLowerCase() !== target.bankStatus
      || String(bank.provider_name).toLowerCase() !== target.bankProvider.toLowerCase()
    ) {
      throw new Error(`ORPHAN_QRIS_RESET_MUTATION_PRECONDITION_FAILED: ${JSON.stringify(bank)}`);
    }
  }

  const candidateResult = await client.query(
    `SELECT id, mutation_id, company_id, payment_items
       FROM public.qris_mutation_batch_candidates
      WHERE id = ANY($1::int[])
      FOR UPDATE`,
    [TARGET_CANDIDATE_IDS],
  );
  if (candidateResult.rowCount !== TARGETS.length) {
    throw new Error(`ORPHAN_QRIS_RESET_CANDIDATE_COUNT_FAILED: expected ${TARGETS.length}, found ${candidateResult.rowCount}`);
  }
  for (const candidate of candidateResult.rows) {
    const target = targetByCandidate.get(Number(candidate.id));
    if (
      !target
      || Number(candidate.mutation_id) !== target.mutationId
      || Number(candidate.company_id) !== target.companyId
      || !exactSet(candidatePaymentIds(candidate.payment_items), target.candidatePaymentIds)
    ) {
      throw new Error(`ORPHAN_QRIS_RESET_CANDIDATE_PRECONDITION_FAILED: ${JSON.stringify(candidate)}`);
    }
  }

  const paymentsResult = await client.query(
    `SELECT id, company_id, payment_method::text AS payment_method,
            payment_provider::text AS payment_provider, bank_account_id,
            expected_settlement_date::text AS expected_settlement_date,
            settlement_status::text AS settlement_status
       FROM sport_center.sport_payments
      WHERE id = ANY($1::int[])
      ORDER BY id
      FOR UPDATE`,
    [TARGET_PAYMENT_IDS],
  );
  if (paymentsResult.rowCount !== TARGET_PAYMENT_IDS.length) {
    throw new Error(`ORPHAN_QRIS_RESET_PAYMENT_COUNT_FAILED: expected ${TARGET_PAYMENT_IDS.length}, found ${paymentsResult.rowCount}`);
  }
  for (const payment of paymentsResult.rows) {
    const paymentId = Number(payment.id);
    if (
      Number(payment.company_id) !== 1
      || String(payment.payment_method).toLowerCase() !== "qris"
      || String(payment.payment_provider).toLowerCase() !== PAYMENT_PROVIDER
      || String(payment.bank_account_id) !== PAYMENT_BANK_ACCOUNT_ID
      || String(payment.expected_settlement_date).slice(0, 10) !== expectedDateByPayment.get(paymentId)
      || String(payment.settlement_status).toLowerCase() !== "settled"
    ) {
      throw new Error(`ORPHAN_QRIS_RESET_PAYMENT_PRECONDITION_FAILED: ${JSON.stringify(payment)}`);
    }
  }

  const canonicalItems = await client.query(
    `SELECT i.id, i.payment_id, i.settlement_id, b.status AS batch_status
       FROM sport_center.payment_settlement_items i
       LEFT JOIN sport_center.payment_settlement_batches b ON b.id = i.settlement_id
      WHERE i.payment_id = ANY($1::int[])
      FOR UPDATE OF i`,
    [TARGET_PAYMENT_IDS],
  );
  if (canonicalItems.rowCount !== 0) {
    throw new Error(`ORPHAN_QRIS_RESET_CANONICAL_ITEMS_PRESENT: ${JSON.stringify(canonicalItems.rows)}`);
  }

  const legacyItems = await client.query(
    `SELECT id, settlement_id, sport_payment_id
       FROM public.qris_settlement_items
      WHERE sport_payment_id = ANY($1::int[])
      FOR UPDATE`,
    [TARGET_PAYMENT_IDS],
  );
  if (legacyItems.rowCount !== 0) {
    throw new Error(`ORPHAN_QRIS_RESET_LEGACY_ITEMS_PRESENT: ${JSON.stringify(legacyItems.rows)}`);
  }

  const legacySettlements = await client.query(
    `SELECT id, bank_mutation_id, status
       FROM public.qris_settlements
      WHERE bank_mutation_id = ANY($1::int[])
      FOR UPDATE`,
    [TARGET_MUTATION_IDS],
  );
  if (legacySettlements.rowCount !== 0) {
    throw new Error(`ORPHAN_QRIS_RESET_LEGACY_SETTLEMENT_PRESENT: ${JSON.stringify(legacySettlements.rows)}`);
  }

  const canonicalBatches = await client.query(
    `SELECT id, status, bank_mutation_id, canonical_bank_mutation_id, settlement_journal_id
       FROM sport_center.payment_settlement_batches
      WHERE bank_mutation_id = ANY($1::int[])
         OR canonical_bank_mutation_id = ANY($1::int[])
      FOR UPDATE`,
    [TARGET_MUTATION_IDS],
  );
  if (canonicalBatches.rowCount !== 0) {
    throw new Error(`ORPHAN_QRIS_RESET_CANONICAL_BATCH_PRESENT: ${JSON.stringify(canonicalBatches.rows)}`);
  }

  const settlementJournals = await client.query(
    `SELECT id, payment_id, source_id, status, journal_type, settlement_id, settlement_batch_id
       FROM sport_center.accounting_journals
      WHERE journal_type::text = 'settlement'
        AND payment_id = ANY($1::int[])
      FOR UPDATE`,
    [TARGET_PAYMENT_IDS],
  );
  if (settlementJournals.rowCount !== 0) {
    throw new Error(`ORPHAN_QRIS_RESET_SETTLEMENT_JOURNAL_PRESENT: ${JSON.stringify(settlementJournals.rows)}`);
  }

  // The existing source mirror trigger may refresh non-financial payment
  // metadata on posted payment journals. Keep triggers enabled and allow that
  // only inside the explicit transaction-local repair window.
  await client.query(
    "SET LOCAL sport_center.allow_posted_accounting_metadata_correction = 'on'",
  );

  const update = await client.query(
    `UPDATE sport_center.sport_payments
        SET settlement_status = 'unsettled',
            updated_at = NOW()
      WHERE id = ANY($1::int[])
        AND company_id = 1
        AND settlement_status::text = 'settled'
      RETURNING id, settlement_status::text AS settlement_status`,
    [TARGET_PAYMENT_IDS],
  );
  if (update.rowCount !== TARGET_PAYMENT_IDS.length) {
    throw new Error(`ORPHAN_QRIS_RESET_UPDATE_FAILED: expected ${TARGET_PAYMENT_IDS.length}, found ${update.rowCount}`);
  }

  for (const target of TARGETS) {
    await client.query(
      `INSERT INTO public.bank_reconciliation_audit
         (mutation_id, action, actor, meta)
       VALUES ($1, $2, $3, $4::jsonb)`,
      [
        target.mutationId,
        "ORPHAN_CANONICAL_QRIS_STATUS_RESET",
        ACTOR,
        JSON.stringify({
          candidateId: target.candidateId,
          paymentIds: target.paymentIds,
          previousStatus: "settled",
          nextStatus: "unsettled",
          reason: "Canonical source flags were settled without any canonical or legacy settlement item.",
          projectRef,
        }),
      ],
    );
  }

  await client.query("COMMIT");
  console.log(JSON.stringify({
    applied: true,
    projectRef,
    targetCount: TARGETS.length,
    mutationIds: TARGET_MUTATION_IDS,
    candidateIds: TARGET_CANDIDATE_IDS,
    paymentIds: TARGET_PAYMENT_IDS,
    resetCount: update.rowCount,
    canonicalItems: canonicalItems.rowCount,
    legacyItems: legacyItems.rowCount,
    legacySettlements: legacySettlements.rowCount,
    canonicalBatches: canonicalBatches.rowCount,
    settlementJournals: settlementJournals.rowCount,
  }, null, 2));
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end().catch(() => {});
}