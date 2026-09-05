#!/usr/bin/env node

/**
 * CF-CP-6 Customer Portal central-finance development proof.
 *
 * This file is intentionally kept under the API workspace. The package
 * runner bundles it to this directory and leaves pg/@workspace/db external,
 * so Node resolves the same workspace packages as the API. Do not execute a
 * generated bundle from /tmp.
 */

import pg from "pg";
import { confirmCustomerPortalPayment } from "../src/lib/customerPortalPaymentFinance.js";
import { processCustomerPortalFinance } from "../src/lib/customerPortalFinanceConsumer.js";
import { resolveFinanceProjectConfigWithClient } from "../src/lib/financeProjectConfigResolver.js";

const { Pool } = pg;
const PREFIX = `CFCP6_E2E_${Date.now()}`;
const COMPANY_ID = 1;
const GROSS = 111_000;
const pool = new Pool({
  connectionString: process.env.SUPABASE_DATABASE_URL_DEV,
  max: 2,
  connectionTimeoutMillis: 20_000,
  idleTimeoutMillis: 20_000,
});

const created = {
  documentId: null,
  lineId: null,
  paymentId: null,
  eventId: null,
  processingId: null,
  settlementId: null,
  publicMutationId: null,
  accountingEntryIds: [],
};
const DEV_PROJECT_REF = "xssrfshdrtdfupgqwfdw";
const PROD_PROJECT_REF = "nzdweipzckfszczzqtuw";

function extractProjectRef(url) {
  if (!url) return null;
  return url.match(/postgres(?:ql)?:\/\/[^.]+\.([a-z0-9]+):/i)?.[1]
    ?? url.match(/db\.([a-z0-9]+)\.supabase\.co/i)?.[1]
    ?? null;
}

function assert(condition, message) {
  if (!condition) throw new Error(`CF_CP_6_ASSERTION_FAILED: ${message}`);
}

function guard() {
  assert(process.env.APP_ENV === "development", "APP_ENV must be development");
  assert(process.env.NODE_ENV !== "production", "NODE_ENV must not be production");
  assert(process.env.SAFE_DEV_TEST_MODE === "true", "SAFE_DEV_TEST_MODE=true is required");
  assert(process.env.SUPABASE_DATABASE_URL_DEV, "SUPABASE_DATABASE_URL_DEV is required");
  const projectRef = extractProjectRef(process.env.SUPABASE_DATABASE_URL_DEV);
  assert(projectRef === DEV_PROJECT_REF, `unexpected DEV project ref: ${projectRef ?? "unknown"}`);
  assert(projectRef !== PROD_PROJECT_REF, "DEV URL matches production project");
  assert(
    extractProjectRef(process.env.SUPABASE_DATABASE_URL) !== PROD_PROJECT_REF,
    "canonical database URL resolves to production",
  );
  assert(
    process.env.SAFE_DEV_TEST_MODE === "true" &&
      projectRef === DEV_PROJECT_REF &&
      projectRef !== PROD_PROJECT_REF,
    "safe development DB guard rejected target",
  );
  assert(process.env.CUSTOMER_PORTAL_FINANCE_MODE === "central", "harness must explicitly enable central mode");
  assert(process.env.SPORT_CENTER_FINANCE_MODE !== "central", "Sport Center central mode must stay disabled");
  return projectRef;
}

async function one(client, text, values = []) {
  const result = await client.query(text, values);
  return result.rows[0] ?? null;
}

async function snapshot(client) {
  return one(client, `
    SELECT
      (SELECT count(*)::int FROM customer_payment_finance_events) AS event_count,
      (SELECT count(*)::int FROM customer_finance_processing) AS processing_count,
      (SELECT count(*)::int FROM accounting_entries) AS accounting_count,
      (SELECT count(*)::int FROM public.bank_mutations) AS mutation_count,
      (SELECT count(*)::int FROM customer_portal_settlement_batches) AS settlement_count
  `);
}

async function createFixture(client) {
  const tax = await one(client, `
    SELECT tm.tax_rule_id, tr.tax_rate
      FROM finance_project_tax_mappings tm
      JOIN tax_rules tr ON tr.id=tm.tax_rule_id
     WHERE tm.finance_project_config_id=3
       AND tm.transaction_type='sales_order'
       AND tm.product_scope='goods'
       AND tm.is_active
     ORDER BY tm.id
     LIMIT 1
  `);
  assert(tax, "Customer Portal goods tax mapping is missing");
  const net = Math.round(GROSS / 1.11 * 100) / 100;
  const taxAmount = Math.round((GROSS - net) * 100) / 100;
  const doc = await one(client, `
    INSERT INTO sales_documents
      (doc_number, kind, status, invoice_status, payment_status,
       amount_paid, customer_name, total_amount, tax_rate_id, tax_amount,
       grand_total, notes, company_id, product_scope, tax_treatment)
    VALUES ($1, 'order', 'confirmed', 'invoiced', 'unpaid',
            0, $2, $3, $4, $5, $6, $7, $8, 'goods', 'exclusive')
    RETURNING id
  `, [
    `${PREFIX}_DOC`, `${PREFIX} Customer`, net, Number(tax.tax_rule_id),
    taxAmount, GROSS, PREFIX, COMPANY_ID,
  ]);
  assert(doc, "sales document fixture was not created");
  created.documentId = Number(doc.id);

  const line = await one(client, `
    INSERT INTO sales_document_lines
      (document_id, name, description, quantity, unit_price, subtotal,
       product_scope, service_scope)
    VALUES ($1, $2, $3, 1, $4, $4, 'goods', NULL)
    RETURNING id
  `, [created.documentId, `${PREFIX} Goods`, "CF-CP-6 development fixture", net]);
  created.lineId = Number(line.id);

  const payment = await one(client, `
    INSERT INTO payments
      (ref_kind, ref_id, ref_doc_number, amount, status, provider,
       payment_method, provider_merchant_trade_no, raw, company_id)
    VALUES ('sales', $1, $2, $3, 'pending', 'paylabs', 'qris', $4,
            $5::jsonb, $6)
    RETURNING id
  `, [
    created.documentId, `${PREFIX}_DOC`, GROSS, `${PREFIX}_PAY`,
    JSON.stringify({ source: "CF-CP-6", environment: "development" }),
    COMPANY_ID,
  ]);
  assert(payment, "payment fixture was not created");
  created.paymentId = Number(payment.id);
}

async function prove(client) {
  const config = await resolveFinanceProjectConfigWithClient(client, {
    projectCode: "customer_portal",
    companyId: COMPANY_ID,
    paymentMethod: "qris",
    providerCode: "paylabs",
    effectiveDate: new Date().toISOString().slice(0, 10),
  });
  assert(config.currency === "IDR", "currency must be IDR");
  assert(config.bankAccountId === 17, `bank account must be 17, got ${config.bankAccountId}`);
  assert(config.mdrRate === 0.003, `MDR must be 0.003, got ${config.mdrRate}`);
  assert(config.fixedProviderFee === 0, "fixed fee must be zero");
  assert(config.feeTaxRate === 0, "fee tax must be zero");
  assert(config.settlementDelayBusinessDays === 1, "settlement delay must be T+1 business day");

  const confirmation = await confirmCustomerPortalPayment({
    paymentId: created.paymentId,
    companyId: COMPANY_ID,
    paymentMethod: "qris",
    provider: "paylabs",
    providerReference: `${PREFIX}_REF`,
    raw: { source: "CF-CP-6", environment: "development" },
  });
  assert(confirmation.firstPaidTransition, "payment must make its first paid transition");
  assert(confirmation.financeEventId, "confirmation must create a finance event");
  created.eventId = confirmation.financeEventId;

  const event = await one(client, `
    SELECT * FROM customer_payment_finance_events
     WHERE id=$1
  `, [created.eventId]);
  assert(event?.product_scope === "goods", "event product snapshot must be goods");
  assert(Number(event?.tax_rule_id) === config.taxRuleId, "event tax rule snapshot mismatch");
  assert(event?.tax_rate != null, `event tax rate snapshot missing (tax_rule_id=${event?.tax_rule_id ?? "null"})`);
  assert(event?.tax_treatment === "exclusive", "event tax treatment must be exclusive");

  const first = await processCustomerPortalFinance({ client, limit: 1 });
  const firstProcessing = await one(client, `
    SELECT p.status, p.last_error, p.source_project, p.source_payment_id,
           e.company_id AS event_company_id, e.tax_rule_id, e.tax_rate,
           e.tax_treatment, e.product_scope, e.payment_method, e.payment_provider,
           pay.company_id AS payment_company_id, sd.company_id AS document_company_id,
           sd.doc_number
      FROM customer_finance_processing p
      LEFT JOIN customer_payment_finance_events e
        ON e.source_project=p.source_project
       AND e.source_payment_id=p.source_payment_id
       AND e.event_type=p.event_type
      LEFT JOIN payments pay ON pay.id=p.source_payment_id
      LEFT JOIN sales_documents sd ON sd.id=e.sales_document_id
     WHERE p.source_payment_id=$1 AND p.event_type='payment_confirmed'
  `, [created.paymentId]);
  assert(
    first.claimed === 1 && first.posted === 1,
    `first consumer run must claim/post 1: ${JSON.stringify(first)} debug=${JSON.stringify(firstProcessing)}`,
  );

  const retry = await processCustomerPortalFinance({ client, limit: 1 });
  assert(retry.claimed === 0 && retry.posted === 0, `retry must be idempotent: ${JSON.stringify(retry)}`);

  const processing = await one(client, `
    SELECT id, status, attempts FROM customer_finance_processing
     WHERE source_payment_id=$1 AND event_type='payment_confirmed'
  `, [created.paymentId]);
  created.processingId = Number(processing.id);
  assert(processing.status === "posted" && Number(processing.attempts) === 1, "processing must be posted once");

  const accounting = await one(client, `
    SELECT e.id, e.status, e.total_debit, e.total_credit,
           count(l.id)::int AS line_count
      FROM accounting_entries e
      LEFT JOIN accounting_entry_lines l ON l.entry_id=e.id
      WHERE e.source='sales_invoice' AND e.source_id=$1
     GROUP BY e.id
  `, [created.documentId]);
  assert(accounting, "sales accounting entry missing");
  created.accountingEntryIds.push(Number(accounting.id));
  assert(accounting.status === "posted", "sales accounting must be posted");
  assert(Number(accounting.total_debit) === Number(accounting.total_credit), "sales journal must balance");
  assert(Number(accounting.line_count) === 3, "sales journal must contain receivable, revenue, and tax lines");

  const mutation = await one(client, `
    SELECT id, canonical_key, mutation_key, source_app, source_module, source_table, source_id
      FROM public.bank_mutations
     WHERE canonical_key=$1
  `, [`customer_portal:payment:${created.paymentId}`]);
  assert(mutation, "canonical public bank mutation missing");
  created.publicMutationId = Number(mutation.id);
  assert(mutation.mutation_key === `CP-PAY-${created.paymentId}`, "mutation key mismatch");
  assert(mutation.source_app === "customer_portal" && mutation.source_module === "central_finance", "mutation owner mismatch");
  assert(mutation.source_table === "payments" && Number(mutation.source_id) === created.paymentId, "mutation source mismatch");

  const settlement = await one(client, `
      SELECT b.id, b.provider_code, b.bank_account_id, b.gross_amount, b.mdr_amount,
           b.fixed_fee_amount, b.fee_tax_amount, b.net_amount,
            b.settlement_rule_version, b.settlement_journal_id, count(i.id)::int AS item_count
      FROM customer_portal_settlement_batches b
      JOIN customer_portal_settlement_items i ON i.settlement_id=b.id
     WHERE i.payment_id=$1
     GROUP BY b.id
  `, [created.paymentId]);
  assert(settlement, "Customer Portal settlement missing");
  created.settlementId = Number(settlement.id);
  created.accountingEntryIds.push(Number(settlement.settlement_journal_id));
  assert(Number(settlement.item_count) === 1, "settlement item count must be one");
  assert(Number(settlement.mdr_amount) === Math.round(GROSS * 0.003 * 100) / 100, "MDR economics mismatch");
  assert(Number(settlement.fixed_fee_amount) === 0 && Number(settlement.fee_tax_amount) === 0, "fee economics mismatch");
  assert(Number(settlement.net_amount) === GROSS - Number(settlement.mdr_amount), "net economics mismatch");
  assert(settlement.settlement_rule_version === "T+1_BUSINESS_DAY", "settlement rule mismatch");

  const sport = await one(client, `
    SELECT
      (SELECT count(*)::int FROM sport_center.central_finance_processing WHERE source_payment_id=$1) AS processing,
      (SELECT count(*)::int FROM sport_center.payment_settlement_items WHERE payment_id=$1) AS settlements
  `, [created.paymentId]);
  assert(Number(sport.processing) === 0 && Number(sport.settlements) === 0, "Sport Center direct effects must be zero");
  return { config, first, retry, accounting, mutation, settlement };
}

async function cleanup(client) {
  await client.query("BEGIN");
  try {
    if (created.publicMutationId) await client.query("DELETE FROM public.bank_mutations WHERE id=$1", [created.publicMutationId]);
    if (created.settlementId) await client.query("DELETE FROM customer_portal_settlement_items WHERE settlement_id=$1", [created.settlementId]);
    if (created.settlementId) await client.query("DELETE FROM customer_portal_settlement_batches WHERE id=$1", [created.settlementId]);
    const fixtureEntries = await client.query(`
      SELECT id
        FROM accounting_entries
       WHERE (source='sales_invoice' AND source_id=$1)
          OR (source='sales_payment' AND source_id=$2)
    `, [created.documentId, created.paymentId]);
    const accountingEntryIds = new Set([
      ...created.accountingEntryIds,
      ...fixtureEntries.rows.map((row) => Number(row.id)),
    ]);
    for (const id of accountingEntryIds) {
      await client.query(`
        UPDATE accounting_entries
           SET status='draft', cancel_reason='CFCP6_E2E fixture cleanup', cancelled_at=NOW()
         WHERE id=$1 AND status='posted'
      `, [id]);
      await client.query("DELETE FROM accounting_entry_lines WHERE entry_id=$1", [id]);
      await client.query("DELETE FROM accounting_entries WHERE id=$1", [id]);
    }
    if (created.processingId) {
      await client.query("DELETE FROM customer_finance_processing WHERE id=$1", [created.processingId]);
    } else if (created.paymentId) {
      await client.query("DELETE FROM customer_finance_processing WHERE source_payment_id=$1", [created.paymentId]);
    }
    if (created.eventId) await client.query("DELETE FROM customer_payment_finance_events WHERE id=$1", [created.eventId]);
    if (created.paymentId) await client.query("DELETE FROM payments WHERE id=$1", [created.paymentId]);
    if (created.lineId) await client.query("DELETE FROM sales_document_lines WHERE id=$1", [created.lineId]);
    if (created.documentId) await client.query("DELETE FROM sales_documents WHERE id=$1", [created.documentId]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function main() {
  const projectRef = guard();
  const client = await pool.connect();
  const before = await snapshot(client);
  let proof;
  let failure;
  try {
    await createFixture(client);
    proof = await prove(client);
  } catch (error) {
    failure = error;
  } finally {
    try {
      await cleanup(client);
    } catch (error) {
      failure ||= error;
    }
    const after = await snapshot(client).catch(() => null);
    client.release();
    await pool.end();
    if (failure) throw failure;
    assert(JSON.stringify(before) === JSON.stringify(after), "existing DEV counts changed after cleanup");
  }
  console.log(JSON.stringify({
    status: "PASS",
    harnessPackaging: "PASS",
    pgModuleResolution: "PASS",
    projectRef: `${projectRef.slice(0, 4)}…${projectRef.slice(-4)}`,
    goodsE2E: "PASS",
    retryIdempotency: "PASS",
    rollbackCleanup: "PASS",
    existingDevDataChanged: 0,
    sportCenterDirectEffects: 0,
    proof: {
      accountingEntryId: proof.accounting.id,
      publicMutationId: proof.mutation.id,
      settlementId: proof.settlement.id,
      mdr: proof.settlement.mdr_amount,
      net: proof.settlement.net_amount,
    },
  }, null, 2));
}

await main();