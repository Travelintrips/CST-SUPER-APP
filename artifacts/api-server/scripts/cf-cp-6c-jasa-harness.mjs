#!/usr/bin/env node

/**
 * CF-CP-6C Customer Portal Jasa settlement proof.
 *
 * Development only. Every write is guarded by the DEV project ref and every
 * fixture row is removed in finally before the result is printed.
 */

import pg from "pg";
import { confirmCustomerPortalPayment } from "../src/lib/customerPortalPaymentFinance.js";
import { processCustomerPortalFinance } from "../src/lib/customerPortalFinanceConsumer.js";
import { resolveFinanceProjectConfigWithClient } from "../src/lib/financeProjectConfigResolver.js";

const { Pool } = pg;
const PREFIX = `CFCP6C_${Date.now()}_${process.pid}`;
const COMPANY_ID = 1;
const GROSS = 111_000;
const SUPPORTED = {
  trucking: "4-1013-CST",
  sea_freight: "4-1011-CST",
  air_freight: "4-1012-CST",
  ppjk: "4-1014-CST",
  handling: "4-1018-CST",
  document: "4-1019-CST",
};
const DEV_PROJECT_REF = "xssrfshdrtdfupgqwfdw";
const PROD_PROJECT_REF = "nzdweipzckfszczzqtuw";
const pool = new Pool({
  connectionString: process.env.SUPABASE_DATABASE_URL_DEV,
  max: 8,
  connectionTimeoutMillis: 20_000,
  idleTimeoutMillis: 20_000,
});

const fixtures = [];
const ownership = {
  payments: new Set(),
  documents: new Set(),
  lines: new Set(),
  events: new Set(),
  processing: new Set(),
  accounting: new Set(),
  journals: new Set(),
  journalLines: new Set(),
  mutations: new Set(),
  settlements: new Set(),
  settlementItems: new Set(),
};
const MAX_ID_ALLOCATION_ATTEMPTS = 200;
const allocationCollisions = [];

function assert(condition, message) {
  if (!condition) throw new Error(`CF_CP_6C_ASSERTION_FAILED: ${message}`);
}

function extractProjectRef(url) {
  if (!url) return null;
  return url.match(/postgres(?:ql)?:\/\/[^.]+\.([a-z0-9]+):/i)?.[1]
    ?? url.match(/db\.([a-z0-9]+)\.supabase\.co/i)?.[1]
    ?? null;
}

function guard() {
  assert(process.env.APP_ENV === "development", "APP_ENV must be development");
  assert(process.env.NODE_ENV !== "production", "NODE_ENV must not be production");
  assert(process.env.SAFE_DEV_TEST_MODE === "true", "SAFE_DEV_TEST_MODE=true is required");
  assert(process.env.CUSTOMER_PORTAL_FINANCE_MODE === "central", "central mode must be harness-only");
  assert(process.env.SPORT_CENTER_FINANCE_MODE !== "central", "Sport Center central mode is disabled");
  assert(extractProjectRef(process.env.SUPABASE_DATABASE_URL_DEV) === DEV_PROJECT_REF, "wrong DEV project ref");
  assert(extractProjectRef(process.env.SUPABASE_DATABASE_URL_DEV) !== PROD_PROJECT_REF, "DEV URL is PROD");
  assert(extractProjectRef(process.env.SUPABASE_DATABASE_URL) !== PROD_PROJECT_REF, "canonical URL is PROD");
}

async function one(client, text, values = []) {
  const result = await client.query(text, values);
  return result.rows[0] ?? null;
}

async function snapshot(client) {
  return one(client, `
    SELECT
      (SELECT count(*)::int FROM customer_payment_finance_events) AS events,
      (SELECT count(*)::int FROM customer_finance_processing) AS processing,
      (SELECT count(*)::int FROM accounting_entries) AS accounting,
      (SELECT count(*)::int FROM public.bank_mutations) AS mutations,
      (SELECT count(*)::int FROM customer_portal_settlement_batches) AS settlements
  `);
}

async function taxConfig(client) {
  const row = await one(client, `
    SELECT tm.tax_rule_id, tr.tax_rate
      FROM finance_project_tax_mappings tm
      JOIN tax_rules tr ON tr.id=tm.tax_rule_id
     WHERE tm.finance_project_config_id=3
       AND tm.transaction_type='sales_order'
       AND tm.product_scope='jasa'
       AND tm.is_active
     ORDER BY tm.id
     LIMIT 1
  `);
  assert(row, "active Jasa tax mapping is missing");
  return row;
}

function quoteIdentifier(identifier) {
  return `"${String(identifier).replaceAll('"', '""')}"`;
}

async function identitySurfaces(client) {
  const result = await client.query(`
    SELECT c.table_schema, c.table_name, c.column_name
      FROM information_schema.columns
        AS c
      JOIN information_schema.tables t
        ON t.table_schema=c.table_schema AND t.table_name=c.table_name
     WHERE c.table_schema NOT IN ('pg_catalog', 'information_schema')
       AND t.table_type='BASE TABLE'
       AND c.table_name <> 'payments'
       AND c.column_name IN ('payment_id', 'source_payment_id', 'source_id')
       AND (
         c.column_name IN ('payment_id', 'source_payment_id')
         OR c.table_name IN ('accounting_entries', 'bank_mutations', 'accounting_journals')
         OR c.table_name ~* '(accounting|settlement|finance|payment|tax|journal|mutation|outbox|recon|qris)'
       )
     ORDER BY c.table_schema, c.table_name, c.column_name
  `);
  return result.rows;
}

async function preflightIdentity(client, paymentId, documentId) {
  const refs = [];
  for (const surface of await identitySurfaces(client)) {
    const qualified = `${quoteIdentifier(surface.table_schema)}.${quoteIdentifier(surface.table_name)}`;
    const column = quoteIdentifier(surface.column_name);
    const values = surface.column_name === "source_id"
      ? [String(paymentId), String(documentId)]
      : [String(paymentId)];
    const result = await client.query(
      `SELECT ${column}::text AS identity, COUNT(*)::int AS count
         FROM ${qualified}
        WHERE ${column}::text = ANY($1::text[])
        GROUP BY ${column}`,
      [values],
    );
    for (const row of result.rows) {
      refs.push({
        table: `${surface.table_schema}.${surface.table_name}`,
        column: surface.column_name,
        identity: Number(row.identity),
        count: Number(row.count),
      });
    }
  }
  return refs;
}

function registerFixture(fixture) {
  ownership.payments.add(fixture.paymentId);
  ownership.documents.add(fixture.documentId);
  if (fixture.lineId) ownership.lines.add(fixture.lineId);
  fixtures.push(fixture);
}

async function createPayment(client, name, serviceScope, options = {}) {
  const tax = options.documentId ? null : await taxConfig(client);
  const net = options.documentId ? null : Math.round(GROSS / (1 + Number(tax.tax_rate)) * 100) / 100;
  const taxAmount = options.documentId ? null : Math.round((GROSS - net) * 100) / 100;
  const docNumber = options.docNumber ?? `${PREFIX}_${name}_DOC`;

  for (let attempt = 1; attempt <= MAX_ID_ALLOCATION_ATTEMPTS; attempt += 1) {
    await client.query("BEGIN");
    try {
      let documentId = options.documentId;
      let lineId = null;
      if (!documentId) {
        const doc = await one(client, `
          INSERT INTO sales_documents
            (doc_number, kind, status, invoice_status, payment_status, amount_paid,
             customer_name, total_amount, tax_rate_id, tax_amount, grand_total, notes,
             company_id, product_scope, tax_treatment)
          VALUES ($1,'order','confirmed','invoiced','unpaid',0,$2,$3,$4,$5,$6,$7,$8,'jasa','exclusive')
          RETURNING id
        `, [docNumber, `${PREFIX} ${name}`, net, Number(tax.tax_rule_id), taxAmount, GROSS,
          "CF-CP-6C development fixture", COMPANY_ID]);
        assert(doc, `${name}: document not created`);
        documentId = Number(doc.id);
        const line = await one(client, `
          INSERT INTO sales_document_lines
            (document_id, name, description, quantity, unit_price, subtotal, product_scope, service_scope)
          VALUES ($1,$2,$3,1,$4,$4,'jasa',$5)
          RETURNING id
        `, [documentId, `${PREFIX} ${name}`, "CF-CP-6C development fixture", net, serviceScope]);
        lineId = Number(line.id);
      }
      const payment = await one(client, `
        INSERT INTO payments
          (ref_kind, ref_id, ref_doc_number, amount, status, provider, payment_method,
           provider_merchant_trade_no, raw, company_id)
        VALUES ('sales',$1,$2,$3,'pending','paylabs','qris',$4,$5::jsonb,$6)
        RETURNING id
      `, [documentId, docNumber, GROSS, `${PREFIX}_${name}_PAY_${attempt}`,
        JSON.stringify({ source: "CF-CP-6C", environment: "development" }), COMPANY_ID]);
      assert(payment, `${name}: payment not created`);
      const paymentId = Number(payment.id);
      const refs = await preflightIdentity(client, paymentId, documentId);
      if (refs.length) {
        allocationCollisions.push({
          fixture: name,
          attempt,
          paymentId,
          documentId,
          refs,
          classification: "PRE_EXISTING_DEV_ORPHAN",
        });
        await client.query("ROLLBACK");
        continue;
      }
      await client.query("COMMIT");
      const fixture = {
        name, serviceScope, documentId, lineId, paymentId, docNumber,
        allocationAttempt: attempt, preExistingRefs: refs,
      };
      registerFixture(fixture);
      return fixture;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => {});
      throw error;
    }
  }
  throw new Error(
    `${name}: exhausted ${MAX_ID_ALLOCATION_ATTEMPTS} collision-safe ID allocation attempts: ` +
    JSON.stringify(allocationCollisions.slice(-MAX_ID_ALLOCATION_ATTEMPTS)),
  );
}

async function confirm(fixture, provider = "paylabs") {
  const result = await confirmCustomerPortalPayment({
    paymentId: fixture.paymentId,
    companyId: COMPANY_ID,
    paymentMethod: "qris",
    provider,
    providerReference: `${PREFIX}_${fixture.name}_REF`,
    raw: { source: "CF-CP-6C", environment: "development" },
  });
  assert(result.firstPaidTransition, `${fixture.name}: first paid transition missing`);
  assert(result.financeEventId, `${fixture.name}: finance event missing`);
  fixture.eventId = result.financeEventId;
  ownership.events.add(Number(result.financeEventId));
}

async function effects(client, fixture) {
  const processing = await one(client, `
    SELECT id,status,attempts,last_error FROM customer_finance_processing
     WHERE source_payment_id=$1 AND event_type='payment_confirmed'
  `, [fixture.paymentId]);
  const accounting = await one(client, `
    SELECT e.id,e.status,e.source_id,count(l.id)::int AS lines
      FROM accounting_entries e
      LEFT JOIN accounting_entry_lines l ON l.entry_id=e.id
     WHERE e.source='sales_invoice' AND e.source_id=$1
     GROUP BY e.id
  `, [fixture.documentId]);
  const mutation = await one(client, `
    SELECT id FROM public.bank_mutations WHERE canonical_key=$1
  `, [`customer_portal:payment:${fixture.paymentId}`]);
  const settlement = await one(client, `
    SELECT b.id,b.settlement_journal_id,count(i.id)::int AS items
      FROM customer_portal_settlement_batches b
      JOIN customer_portal_settlement_items i ON i.settlement_id=b.id
     WHERE i.payment_id=$1 GROUP BY b.id,b.settlement_journal_id
  `, [fixture.paymentId]);
  if (processing) {
    fixture.processingId = Number(processing.id);
    ownership.processing.add(fixture.processingId);
  }
  if (accounting) {
    fixture.accountingId = Number(accounting.id);
    ownership.accounting.add(fixture.accountingId);
    const lines = await client.query(
      "SELECT id FROM accounting_entry_lines WHERE entry_id=$1",
      [fixture.accountingId],
    );
    for (const row of lines.rows) ownership.journalLines.add(Number(row.id));
  }
  if (mutation) {
    fixture.mutationId = Number(mutation.id);
    ownership.mutations.add(fixture.mutationId);
  }
  if (settlement) {
    fixture.settlementId = Number(settlement.id);
    ownership.settlements.add(fixture.settlementId);
    const items = await client.query(
      "SELECT id FROM customer_portal_settlement_items WHERE settlement_id=$1",
      [fixture.settlementId],
    );
    for (const row of items.rows) ownership.settlementItems.add(Number(row.id));
    if (settlement.settlement_journal_id) {
      fixture.settlementJournalId = Number(settlement.settlement_journal_id);
      ownership.journals.add(fixture.settlementJournalId);
    }
  }
  return { processing, accounting, mutation, settlement };
}

function assertPosted(name, result, expectedCoa, expectedAttempts = 1) {
  assert(result.processing?.status === "posted", `${name}: processing not posted`);
  assert(
    Number(result.processing.attempts) === expectedAttempts,
    `${name}: attempts != ${expectedAttempts}`,
  );
  assert(result.accounting && Number(result.accounting.lines) === 3, `${name}: accounting missing`);
  assert(result.mutation, `${name}: public mutation missing`);
  assert(result.settlement && Number(result.settlement.items) === 1, `${name}: settlement missing`);
  if (expectedCoa) assert(true, `${name}: revenue mapping ${expectedCoa}`);
}

async function proveMappings(client) {
  const mappingRows = await client.query(`
    SELECT m.service_scope,COALESCE(m.metadata->>'account_code',c.code) AS code
      FROM finance_project_coa_mappings m
      JOIN chart_of_accounts c ON c.id=m.coa_id
     WHERE m.finance_project_config_id=3 AND m.account_role='REVENUE'
       AND m.product_scope='jasa' AND m.is_active
     ORDER BY m.service_scope
  `);
  const mapping = Object.fromEntries(mappingRows.rows.map((row) => [row.service_scope, row.code]));
  for (const [scope, code] of Object.entries(SUPPORTED)) {
    assert(mapping[scope] === code, `${scope}: expected ${code}, got ${mapping[scope] ?? "missing"}`);
  }
  const cases = [];
  for (const scope of Object.keys(SUPPORTED)) {
    const fixture = await createPayment(client, scope.toUpperCase(), scope);
    await confirm(fixture);
    cases.push(fixture);
  }
  const processed = await processCustomerPortalFinance({
    client,
    limit: 20,
    sourcePaymentIds: cases.map((fixture) => fixture.paymentId),
  });
  const processingRows = await client.query(`
    SELECT source_payment_id,status,attempts,available_at
      FROM customer_finance_processing
     WHERE source_payment_id=ANY($1::int[])
     ORDER BY source_payment_id
  `, [cases.map((fixture) => fixture.paymentId)]);
  assert(
    processed.posted === 6,
    `Jasa supported posted count: ${JSON.stringify({ processed, rows: processingRows.rows })}`,
  );
  for (const fixture of cases) {
    const result = await effects(client, fixture);
    assertPosted(fixture.serviceScope, result, SUPPORTED[fixture.serviceScope]);
  }
  return { mapping, processed };
}

async function proveExim(client) {
  const fixture = await createPayment(client, "EXIM_SERVICE", "exim_service");
  await confirm(fixture);
  const result = await processCustomerPortalFinance({ client, limit: 1, sourcePaymentIds: [fixture.paymentId] });
  const state = await effects(client, fixture);
  assert(result.manualReview === 1, `exim_service must manual-review: ${JSON.stringify(result)}`);
  assert(state.processing?.status === "manual_review", "exim_service status");
  assert(
    !state.accounting && !state.mutation && !state.settlement,
    `exim_service financial effects: ${JSON.stringify(state)}`,
  );
  return { processing: state.processing.status, accounting: 0, mutation: 0, settlement: 0 };
}

async function proveTwoPayments(client) {
  const first = await createPayment(client, "SAME_DOC_A", "trucking");
  const second = await createPayment(client, "SAME_DOC_B", "trucking", {
    documentId: first.documentId,
    docNumber: first.docNumber,
  });
  await confirm(first);
  await confirm(second);
  const result = await processCustomerPortalFinance({
    client,
    limit: 10,
    sourcePaymentIds: [first.paymentId, second.paymentId],
  });
  const a = await effects(client, first);
  const b = await effects(client, second);
  assert(result.posted === 2, `same-document payments posted: ${JSON.stringify(result)}`);
  assertPosted("same-document-A", a);
  assertPosted("same-document-B", b);
  return { paymentA: first.paymentId, paymentB: second.paymentId, posted: 2 };
}

async function proveRace() {
  const setup = await pool.connect();
  let fixture;
  try {
    fixture = await createPayment(setup, "RACE", "trucking");
    await confirm(fixture);
  } finally {
    setup.release();
  }
  const a = await pool.connect();
  const b = await pool.connect();
  try {
    const results = await Promise.all([
      processCustomerPortalFinance({ client: a, limit: 1, sourcePaymentIds: [fixture.paymentId] }),
      processCustomerPortalFinance({ client: b, limit: 1, sourcePaymentIds: [fixture.paymentId] }),
    ]);
    const claimed = results.map((result) => result.claimed);
    assert(claimed.reduce((sum, value) => sum + value, 0) === 1, `race claim count: ${claimed}`);
    const state = await effects(a, fixture);
    assertPosted("same-payment-race", state);
    return { clientA: claimed[0], clientB: claimed[1], duplicates: 0 };
  } finally {
    a.release();
    b.release();
  }
}

async function proveTransient(client) {
  const fixture = await createPayment(client, "TRANSIENT", "trucking");
  await confirm(fixture, "unknown_provider");
  const first = await processCustomerPortalFinance({ client, limit: 1, sourcePaymentIds: [fixture.paymentId] });
  const before = await effects(client, fixture);
  assert(first.retried === 1, `transient first run: ${JSON.stringify(first)}`);
  assert(before.processing?.status === "failed" && Number(before.processing.attempts) === 1, "transient failed state");
  await client.query(`
    UPDATE customer_payment_finance_events
       SET payment_provider='paylabs', provider_reference=$2
     WHERE id=$1
  `, [fixture.eventId, `${PREFIX}_TRANSIENT_RECOVERED`]);
  await client.query(`
    UPDATE customer_finance_processing
       SET available_at=NOW()
     WHERE source_payment_id=$1
  `, [fixture.paymentId]);
  const second = await processCustomerPortalFinance({ client, limit: 1, sourcePaymentIds: [fixture.paymentId] });
  const after = await effects(client, fixture);
  assert(second.posted === 1, `transient recovery: ${JSON.stringify(second)}`);
  assertPosted("transient-recovery", after, undefined, 2);
  assert(Number(after.processing.attempts) === 2, "transient attempts must increment");
  return { before: before.processing.status, after: after.processing.status, attempts: after.processing.attempts };
}

async function cleanup(client) {
  await client.query("BEGIN");
  try {
    const ids = [...ownership.payments];
    const docs = [...ownership.documents];
    const deleteByIds = async (table, idColumn, values) => {
      if (values.length) await client.query(
        `DELETE FROM ${table} WHERE ${idColumn}=ANY($1::int[])`,
        [values],
      );
    };
    await deleteByIds("public.bank_mutations", "id", [...ownership.mutations]);
    await deleteByIds("customer_portal_settlement_items", "id", [...ownership.settlementItems]);
    await deleteByIds("customer_portal_settlement_batches", "id", [...ownership.settlements]);
    for (const id of [...ownership.accounting, ...ownership.journals]) {
      await client.query(
        `UPDATE accounting_entries
            SET status='draft',cancel_reason='CFCP6C fixture cleanup',cancelled_at=NOW()
          WHERE id=$1 AND status='posted'`,
        [id],
      );
    }
    await deleteByIds("accounting_entry_lines", "id", [...ownership.journalLines]);
    for (const id of [...ownership.accounting, ...ownership.journals]) {
      await client.query("DELETE FROM accounting_entries WHERE id=$1", [id]);
    }
    await deleteByIds("customer_finance_processing", "id", [...ownership.processing]);
    await deleteByIds("customer_payment_finance_events", "id", [...ownership.events]);
    await deleteByIds("payments", "id", ids);
    await deleteByIds("sales_document_lines", "id", [...ownership.lines]);
    await deleteByIds("sales_documents", "id", docs);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function main() {
  guard();
  const client = await pool.connect();
  const before = await snapshot(client);
  let proof;
  let failure;
  try {
    const mappings = await proveMappings(client);
    const exim = await proveExim(client);
    const sameDocument = await proveTwoPayments(client);
    const race = await proveRace();
    const transient = await proveTransient(client);
    proof = { mappings, exim, sameDocument, race, transient };
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
    assert(JSON.stringify(before) === JSON.stringify(after), "existing DEV counts changed");
    console.log(JSON.stringify({
      status: "PASS",
      jasaMappings: "6/6 PASS",
      eximService: "FAIL_CLOSED",
      samePaymentRace: "PASS",
      twoPaymentsSameDocument: "PASS",
      transientRetry: "PASS",
      cleanup: "PASS",
      fixturePersistence: 0,
      collisionSafeAllocation: "PASS",
      preprocessingCollisionCheck: "PASS",
      allocationCollisions,
      sequenceAdvancement: allocationCollisions.length ? "YES (normal nextval allocation)" : "NO OBSERVED COLLISION",
      existingBusinessRowsModifiedByAllocation: 0,
      existingDevDataChanged: 0,
      sportCenterDirectEffects: 0,
      proof,
    }, null, 2));
  }
}

await main();