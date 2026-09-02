#!/usr/bin/env node
/**
 * Reset an orphaned canonical QRIS settlement flag in PROD.
 *
 * This is intentionally narrower than a general "unsettle" tool. It only
 * repairs the verified August 1, 2026 candidate after proving the exact bank
 * mutation, candidate payment set, company, and absence of every canonical or
 * legacy settlement item. It never creates a settlement, journal, or bank
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
const TARGET_COMPANY_ID = 1;
const TARGET_MUTATION_ID = 4903;
const TARGET_CANDIDATE_ID = 2673;
const TARGET_PAYMENT_IDS = [278, 279, 280];
const TARGET_BANK_ACCOUNT_ID = 2;
const TARGET_BANK_AMOUNT = 158880;
const TARGET_BANK_DATE = "2026-08-01";
const TARGET_PROVIDER = "mandiri_direct";
const ACTOR = "production-orphan-qris-status-repair";
const APPLY_FLAG = "true";

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

const exactPaymentSet = (items) => {
  if (!Array.isArray(items) || items.length !== TARGET_PAYMENT_IDS.length) {
    return false;
  }
  const ids = items
    .map((item) => Number(item?.paymentId ?? item?.payment_id))
    .sort((a, b) => a - b);
  return ids.length === TARGET_PAYMENT_IDS.length
    && ids.every((id, index) => id === TARGET_PAYMENT_IDS[index]);
};

try {
  await client.connect();
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
    `sport-center:qris:orphan-status:${TARGET_MUTATION_ID}`,
  ]);

  const mutation = await client.query(
    `SELECT id, company_id, bank_account_id, transaction_date::text,
            amount::numeric::text AS amount, status, provider_name
       FROM public.bank_mutations
      WHERE id = $1
      FOR UPDATE`,
    [TARGET_MUTATION_ID],
  );
  const bank = mutation.rows[0];
  if (
    mutation.rowCount !== 1
    || Number(bank.company_id) !== TARGET_COMPANY_ID
    || Number(bank.bank_account_id) !== TARGET_BANK_ACCOUNT_ID
    || String(bank.transaction_date).slice(0, 10) !== TARGET_BANK_DATE
    || Number(bank.amount) !== TARGET_BANK_AMOUNT
    || String(bank.status).toLowerCase() !== "matched"
  ) {
    throw new Error(
      `ORPHAN_QRIS_RESET_MUTATION_PRECONDITION_FAILED: ${JSON.stringify(bank ?? null)}`,
    );
  }

  const candidate = await client.query(
    `SELECT id, mutation_id, company_id, payment_items
       FROM public.qris_mutation_batch_candidates
      WHERE id = $1 AND mutation_id = $2 AND company_id = $3
      FOR UPDATE`,
    [TARGET_CANDIDATE_ID, TARGET_MUTATION_ID, TARGET_COMPANY_ID],
  );
  const candidateRow = candidate.rows[0];
  if (candidate.rowCount !== 1 || !exactPaymentSet(candidateRow?.payment_items)) {
    throw new Error(
      `ORPHAN_QRIS_RESET_CANDIDATE_PRECONDITION_FAILED: ${JSON.stringify(candidateRow ?? null)}`,
    );
  }

  const payments = await client.query(
    `SELECT id, company_id, amount::numeric::text AS amount,
            payment_method::text AS payment_method,
            payment_provider::text AS payment_provider,
            bank_account_id, expected_settlement_date::text,
            settlement_status::text AS settlement_status
       FROM sport_center.sport_payments
      WHERE id = ANY($1::int[])
      ORDER BY id
      FOR UPDATE`,
    [TARGET_PAYMENT_IDS],
  );
  if (
    payments.rowCount !== TARGET_PAYMENT_IDS.length
    || payments.rows.some((payment) =>
      Number(payment.company_id) !== TARGET_COMPANY_ID
      || String(payment.payment_method).toLowerCase() !== "qris"
      || String(payment.payment_provider).toLowerCase() !== TARGET_PROVIDER
      || String(payment.bank_account_id) !== "1640006707220"
      || String(payment.expected_settlement_date).slice(0, 10) !== TARGET_BANK_DATE
      || String(payment.settlement_status).toLowerCase() !== "settled"
    )
  ) {
    throw new Error(
      `ORPHAN_QRIS_RESET_PAYMENT_PRECONDITION_FAILED: ${JSON.stringify(payments.rows)}`,
    );
  }

  const canonicalItems = await client.query(
    `SELECT i.id, i.payment_id, i.settlement_id, b.status AS batch_status
       FROM sport_center.payment_settlement_items i
       LEFT JOIN sport_center.payment_settlement_batches b
         ON b.id = i.settlement_id
      WHERE i.payment_id = ANY($1::int[])
      FOR UPDATE OF i`,
    [TARGET_PAYMENT_IDS],
  );
  if (canonicalItems.rowCount !== 0) {
    throw new Error(
      `ORPHAN_QRIS_RESET_CANONICAL_ITEMS_PRESENT: ${JSON.stringify(canonicalItems.rows)}`,
    );
  }

  const legacyItems = await client.query(
    `SELECT id, settlement_id, sport_payment_id
       FROM public.qris_settlement_items
      WHERE sport_payment_id = ANY($1::int[])
      FOR UPDATE`,
    [TARGET_PAYMENT_IDS],
  );
  if (legacyItems.rowCount !== 0) {
    throw new Error(
      `ORPHAN_QRIS_RESET_LEGACY_ITEMS_PRESENT: ${JSON.stringify(legacyItems.rows)}`,
    );
  }

  // The canonical source update fires the existing accounting mirror trigger.
  // PROD permits that trigger to refresh payment metadata on a posted journal
  // only inside this explicit transaction-local repair window. This does not
  // bypass triggers and does not permit financial-field changes.
  await client.query(
    "SET LOCAL sport_center.allow_posted_accounting_metadata_correction = 'on'",
  );

  const update = await client.query(
    `UPDATE sport_center.sport_payments
        SET settlement_status = 'unsettled',
            updated_at = NOW()
      WHERE id = ANY($1::int[])
        AND company_id = $2
        AND settlement_status::text = 'settled'
      RETURNING id, settlement_status::text AS settlement_status`,
    [TARGET_PAYMENT_IDS, TARGET_COMPANY_ID],
  );
  if (update.rowCount !== TARGET_PAYMENT_IDS.length) {
    throw new Error(
      `ORPHAN_QRIS_RESET_UPDATE_FAILED: expected ${TARGET_PAYMENT_IDS.length}, found ${update.rowCount}`,
    );
  }

  await client.query(
    `INSERT INTO public.bank_reconciliation_audit
       (mutation_id, action, actor, meta)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [
      TARGET_MUTATION_ID,
      "ORPHAN_CANONICAL_QRIS_STATUS_RESET",
      ACTOR,
      JSON.stringify({
        candidateId: TARGET_CANDIDATE_ID,
        paymentIds: TARGET_PAYMENT_IDS,
        previousStatus: "settled",
        nextStatus: "unsettled",
        reason: "Canonical source flags were settled without any canonical or legacy settlement item.",
        projectRef,
      }),
    ],
  );

  await client.query("COMMIT");
  console.log(JSON.stringify({
    applied: true,
    projectRef,
    mutationId: TARGET_MUTATION_ID,
    candidateId: TARGET_CANDIDATE_ID,
    paymentIds: TARGET_PAYMENT_IDS,
    resetCount: update.rowCount,
    canonicalItems: canonicalItems.rowCount,
    legacyItems: legacyItems.rowCount,
  }, null, 2));
} catch (error) {
  await client.query("ROLLBACK").catch(() => {});
  throw error;
} finally {
  await client.end().catch(() => {});
}