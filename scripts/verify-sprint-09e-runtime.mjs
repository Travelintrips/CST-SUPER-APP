#!/usr/bin/env node
/**
 * Official Sprint 09E-H runtime proof.
 *
 * Safety contract:
 * - Development DB only; production deployment and non-DEV DB URLs are rejected.
 * - The API must report ready before any fixture write is attempted.
 * - Every fixture carries a unique marker.
 * - The client sends only an idempotency key; authoritative fields are read by the server.
 * - Cleanup runs from finally and is verified before exit.
 * - The reconciliation-link endpoint is reference-only and must not touch banking/accounting rows.
 */

import crypto from "node:crypto";
import pg from "pg";

const { Client } = pg;
const API_BASE = process.env.SPRINT_09E_API_BASE ?? "http://127.0.0.1:18444";
const DEV_DB_URL = process.env.SUPABASE_DATABASE_URL_DEV;

if (process.env.REPLIT_DEPLOYMENT === "1") {
  throw new Error("Refusing Sprint 09E runtime proof in production deployment");
}
if (!DEV_DB_URL) {
  throw new Error("SUPABASE_DATABASE_URL_DEV is required");
}
if (DEV_DB_URL === process.env.SUPABASE_DATABASE_URL) {
  throw new Error("Refusing runtime proof when DEV and production DB URLs are identical");
}

const marker = `SPRINT09E_H_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
const handoffKey = `${marker}_HANDOFF`;
const linkKey = `${marker}_LINK`;
const originalAmount = "125000.00";
const tamperedAmount = "125001.00";
const client = new Client({
  connectionString: DEV_DB_URL,
  connectionTimeoutMillis: 15000,
  ssl: { rejectUnauthorized: false },
});

const fixture = {};
let cookie = "";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function query(text, params = []) {
  return client.query(text, params);
}

async function api(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "content-type": "application/json" } : {}),
      ...(cookie ? { cookie } : {}),
      ...(options.headers ?? {}),
    },
  });
  const body = await response.json().catch(() => null);
  return { status: response.status, body };
}

async function assertReady() {
  const response = await fetch(`${API_BASE}/api/health/ready`);
  const body = await response.json().catch(() => null);
  assert(response.ok && body?.ready === true,
    `API is not ready; refusing fixture writes: HTTP ${response.status} ${JSON.stringify(body)}`);
}

async function devLogin() {
  const usersResponse = await fetch(`${API_BASE}/api/dev-users`);
  assert(usersResponse.ok, `dev-users failed: HTTP ${usersResponse.status}`);
  const usersBody = await usersResponse.json();
  const adminUser = usersBody?.users?.find(
    (user) => user?.role === "admin" && typeof user?.email === "string",
  );
  assert(adminUser, "dev-users did not return an existing admin user");

  const response = await fetch(`${API_BASE}/api/dev-login`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `email=${encodeURIComponent(adminUser.email)}`,
  });
  assert(response.ok, `dev-login failed: HTTP ${response.status}`);
  const body = await response.json();
  assert(body?.ok === true && body?.role === "admin",
    `dev-login did not create an admin session: ${JSON.stringify(body)}`);
  const setCookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : (response.headers.get("set-cookie") ?? "").split(/,(?=[^;]+?=)/);
  const sessionCookie = setCookies
    .map((value) => value.split(";", 1)[0])
    .find((value) => value.startsWith("sid="));
  assert(sessionCookie, "dev-login did not set the official sid cookie");
  cookie = sessionCookie;
}

async function createFixture() {
  const company = await query(
    `SELECT id FROM companies WHERE is_active = true ORDER BY id LIMIT 1`,
  );
  assert(company.rows[0], "No active development company found");
  fixture.companyId = Number(company.rows[0].id);

  await query("BEGIN");
  try {
    const supplier = await query(
      `INSERT INTO suppliers
         (name, company_id, service_type, is_active, is_verified, status, marketplace_status, logo, sort_order)
       VALUES ($1, $2, 'test', true, true, 'active', 'published', '🧪', 999)
       RETURNING id`,
      [`${marker}_SUPPLIER`, fixture.companyId],
    );
    fixture.supplierId = Number(supplier.rows[0].id);

    const rfq = await query(
      `INSERT INTO mkt_rfqs
         (rfq_number, company_id, catalog_vendor_id, buyer_name, buyer_email, buyer_company,
          status, priority, notes)
       VALUES ($1, $2, $3, $4, $5, $6, 'awarded', 'normal', $7)
       RETURNING id`,
      [
        `${marker}_RFQ`,
        fixture.companyId,
        fixture.supplierId,
        `${marker} Buyer`,
        `${marker.toLowerCase()}@dev.local`,
        `${marker}_COMPANY`,
        marker,
      ],
    );
    fixture.rfqId = Number(rfq.rows[0].id);

    const quote = await query(
      `INSERT INTO mkt_vendor_quotes
         (rfq_id, vendor_id, token, status, quotation_number, notes)
       VALUES ($1, $2, $3, 'selected', $4, $5)
       RETURNING id`,
      [
        fixture.rfqId,
        fixture.supplierId,
        `${marker}_QUOTE_TOKEN`,
        `${marker}_QUOTE`,
        marker,
      ],
    );
    fixture.quoteId = Number(quote.rows[0].id);

    const po = await query(
      `INSERT INTO mkt_purchase_orders
         (po_number, rfq_id, quote_id, company_id, vendor_id, status,
          total_amount, tax_amount, grand_total, vendor_name_snapshot, currency_snapshot,
          created_by)
       VALUES ($1, $2, $3, $4, $5, 'confirmed', $6, 0, $6, $7, 'IDR', $8)
       RETURNING id`,
      [
        `${marker}_PO`,
        fixture.rfqId,
        fixture.quoteId,
        fixture.companyId,
        fixture.supplierId,
        originalAmount,
        `${marker}_SUPPLIER`,
        "sprint-09e-runtime-proof",
      ],
    );
    fixture.poId = Number(po.rows[0].id);

    const shipment = await query(
      `INSERT INTO mkt_po_shipments
         (po_id, shipment_number, shipment_status, shipment_type, notes, created_by)
       VALUES ($1, $2, 'delivered', 'other', $3, 'sprint-09e-runtime-proof')
       RETURNING id`,
      [fixture.poId, `${marker}_SHIPMENT`, marker],
    );
    fixture.shipmentId = Number(shipment.rows[0].id);

    const gr = await query(
      `INSERT INTO mkt_po_goods_receipts
         (shipment_id, receipt_number, receipt_type, inspection_status, notes, received_by)
       VALUES ($1, $2, 'full', 'passed', $3, 'sprint-09e-runtime-proof')
       RETURNING id`,
      [fixture.shipmentId, `${marker}_GR`, marker],
    );
    fixture.grId = Number(gr.rows[0].id);

    const invoice = await query(
      `INSERT INTO vendor_invoices
         (invoice_number, vendor_invoice_ref, company_id, supplier_id, supplier_name,
          mkt_purchase_order_id, mkt_goods_receipt_id, status, currency,
          total_amount, tax_amount, grand_total, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'ready_for_ap', 'IDR',
               $8, 0, $8, $9, 'sprint-09e-runtime-proof')
       RETURNING id`,
      [
        `${marker}_INVOICE`,
        `${marker}_INVOICE_REF`,
        fixture.companyId,
        fixture.supplierId,
        `${marker}_SUPPLIER`,
        fixture.poId,
        fixture.grId,
        originalAmount,
        marker,
      ],
    );
    fixture.invoiceId = Number(invoice.rows[0].id);

    const ap = await query(
      `INSERT INTO mkt_ap_preparations
         (preparation_number, vendor_invoice_id, mkt_purchase_order_id, mkt_goods_receipt_id,
          company_id, supplier_id, supplier_name, invoice_number_snapshot,
          vendor_invoice_ref_snapshot, currency_snapshot, total_amount_snapshot,
          tax_amount_snapshot, grand_total_snapshot, status, notes, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'IDR', $10, 0, $10,
               'waiting_payment', $11, 'sprint-09e-runtime-proof')
       RETURNING id`,
      [
        `${marker}_AP`,
        fixture.invoiceId,
        fixture.poId,
        fixture.grId,
        fixture.companyId,
        fixture.supplierId,
        `${marker}_SUPPLIER`,
        `${marker}_INVOICE`,
        `${marker}_INVOICE_REF`,
        originalAmount,
        marker,
      ],
    );
    fixture.apId = Number(ap.rows[0].id);

    const payment = await query(
      `INSERT INTO payment_requests
         (pay_req_number, company_id, supplier_id, supplier_name, status,
          total_amount, paid_amount, currency, payment_method, notes,
          source_type, source_id, mkt_ap_preparation_id, idempotency_key,
          mkt_lifecycle_status, mkt_completed_at)
       VALUES ($1, $2, $3, $4, 'paid', $5, $5, 'IDR', 'transfer', $6,
               'marketplace_ap_preparation', $7, $8, $9, 'completed', NOW())
       RETURNING id`,
      [
        `${marker}_PAYMENT`,
        fixture.companyId,
        fixture.supplierId,
        `${marker}_SUPPLIER`,
        originalAmount,
        marker,
        fixture.apId,
        fixture.apId,
        handoffKey,
      ],
    );
    fixture.paymentId = Number(payment.rows[0].id);

    await query(
      `UPDATE mkt_ap_preparations
       SET payment_request_id = $1, payment_handoff_at = NOW(),
           payment_handoff_by = 'sprint-09e-runtime-proof'
       WHERE id = $2`,
      [fixture.paymentId, fixture.apId],
    );
    await query("COMMIT");
  } catch (error) {
    await query("ROLLBACK");
    throw error;
  }
}

async function cleanupFixture() {
  if (!fixture.apId) return;
  await query("BEGIN");
  try {
    await query(
      `DELETE FROM mkt_notification_queue
       WHERE purchase_order_id = $1
          OR payload_json->>'apPreparationId' = $2
          OR payload_json->>'paymentRequestId' = $3`,
      [fixture.poId, String(fixture.apId), String(fixture.paymentId)],
    );
    await query(
      `DELETE FROM activity_logs
       WHERE mkt_purchase_order_id = $1
          OR new_value->>'paymentRequestId' = $2
          OR new_value->>'apPreparationId' = $3`,
      [fixture.poId, String(fixture.paymentId), String(fixture.apId)],
    );
    await query(`DELETE FROM mkt_reconciliation_links WHERE payment_request_id = $1`, [fixture.paymentId]);
    await query(`DELETE FROM mkt_accounting_handoffs WHERE ap_preparation_id = $1`, [fixture.apId]);
    await query(`DELETE FROM payment_requests WHERE id = $1`, [fixture.paymentId]);
    await query(`DELETE FROM mkt_ap_preparations WHERE id = $1`, [fixture.apId]);
    await query(`DELETE FROM vendor_invoices WHERE id = $1`, [fixture.invoiceId]);
    await query(`DELETE FROM mkt_po_goods_receipts WHERE id = $1`, [fixture.grId]);
    await query(`DELETE FROM mkt_po_shipments WHERE id = $1`, [fixture.shipmentId]);
    await query(`DELETE FROM mkt_purchase_orders WHERE id = $1`, [fixture.poId]);
    await query(`DELETE FROM mkt_vendor_quotes WHERE id = $1`, [fixture.quoteId]);
    await query(`DELETE FROM mkt_rfqs WHERE id = $1`, [fixture.rfqId]);
    await query(`DELETE FROM suppliers WHERE id = $1`, [fixture.supplierId]);
    await query("COMMIT");
  } catch (error) {
    await query("ROLLBACK");
    throw error;
  }
}

async function boundarySnapshot() {
  const result = await query(`
    SELECT
      (SELECT count(*)::int FROM accounting_entries) AS accounting_entries,
      (SELECT count(*)::int FROM accounting_payments) AS accounting_payments,
      (SELECT count(*)::int FROM bank_mutations) AS bank_mutations,
      (SELECT count(*)::int FROM mkt_reconciliation_links) AS reconciliation_links
  `);
  return result.rows[0];
}

async function fixtureSnapshot() {
  const result = await query(
    `SELECT
       (SELECT count(*)::int FROM suppliers WHERE id = $1) AS supplier,
       (SELECT count(*)::int FROM mkt_rfqs WHERE id = $2) AS rfq,
       (SELECT count(*)::int FROM mkt_vendor_quotes WHERE id = $3) AS quote,
       (SELECT count(*)::int FROM mkt_purchase_orders WHERE id = $4) AS po,
       (SELECT count(*)::int FROM mkt_po_shipments WHERE id = $5) AS shipment,
       (SELECT count(*)::int FROM mkt_po_goods_receipts WHERE id = $6) AS goods_receipt,
       (SELECT count(*)::int FROM vendor_invoices WHERE id = $7) AS invoice,
       (SELECT count(*)::int FROM mkt_ap_preparations WHERE id = $8) AS ap,
       (SELECT count(*)::int FROM payment_requests WHERE id = $9) AS payment,
       (SELECT count(*)::int FROM mkt_accounting_handoffs WHERE ap_preparation_id = $8) AS handoff,
       (SELECT count(*)::int FROM mkt_reconciliation_links WHERE payment_request_id = $9) AS link,
       (SELECT count(*)::int FROM activity_logs WHERE mkt_purchase_order_id = $4) AS activity,
       (SELECT count(*)::int FROM mkt_notification_queue WHERE purchase_order_id = $4) AS notification`,
    [
      fixture.supplierId,
      fixture.rfqId,
      fixture.quoteId,
      fixture.poId,
      fixture.shipmentId,
      fixture.grId,
      fixture.invoiceId,
      fixture.apId,
      fixture.paymentId,
    ],
  );
  return result.rows[0];
}

async function main() {
  await client.connect();
  await assertReady();
  await devLogin();
  await createFixture();

  const before = await boundarySnapshot();
  const handoffPath = `/api/mkt/admin/payment-requests/${fixture.paymentId}/accounting-handoff`;
  const handoffResponse = await api(handoffPath, {
    method: "POST",
    headers: { "Idempotency-Key": handoffKey },
  });
  assert(handoffResponse.status === 201 && handoffResponse.body?.ok === true,
    `accounting handoff failed: ${JSON.stringify(handoffResponse)}`);
  const handoff = handoffResponse.body.data;
  assert(handoff.status === "accepted", `unexpected handoff status: ${handoff.status}`);
  assert(String(handoff.correlationReference).startsWith(`MKT-ACC-${fixture.paymentId}-`),
    "accounting handoff correlation mismatch");

  const path = `/api/mkt/admin/payment-requests/${fixture.paymentId}/reconciliation-link`;
  const created = await api(path, {
    method: "POST",
    headers: { "Idempotency-Key": linkKey },
  });
  assert(created.status === 201 && created.body?.ok === true,
    `reconciliation link create failed: ${JSON.stringify(created)}`);
  assert(created.body.alreadyExists === false, "first reconciliation link was unexpectedly reused");
  const link = created.body.data;
  const immutablePayload = JSON.stringify(link.payload);
  const immutableFingerprint = link.payloadFingerprint;
  assert(link.status === "created", `unexpected reconciliation link status: ${link.status}`);
  assert(link.accountingHandoffId === handoff.id, "link does not point to the accounting handoff");
  assert(link.paymentRequestId === fixture.paymentId, "link does not point to the Marketplace payment");
  assert(String(link.correlationReference).startsWith(`MKT-RECON-${fixture.paymentId}-`),
    "reconciliation correlation mismatch");
  assert(link.payload?.amount === originalAmount, "server did not return authoritative amount");
  assert(link.payload?.currency === "IDR", "server did not return authoritative currency");

  const fetched = await api(path);
  assert(fetched.status === 200 && fetched.body?.ok === true,
    `reconciliation link GET failed: ${JSON.stringify(fetched)}`);
  assert(fetched.body.data.id === link.id, "GET returned a different link");
  assert(JSON.stringify(fetched.body.data.payload) === immutablePayload, "GET changed payload");

  const reused = await api(path, {
    method: "POST",
    headers: { "Idempotency-Key": linkKey },
  });
  assert(reused.status === 200 && reused.body?.alreadyExists === true,
    `reconciliation link reuse failed: ${JSON.stringify(reused)}`);
  assert(reused.body.data.id === link.id, "reuse returned a different link");
  assert(JSON.stringify(reused.body.data.payload) === immutablePayload, "reuse changed payload");
  assert(reused.body.data.payloadFingerprint === immutableFingerprint, "reuse changed fingerprint");

  await query(
    `UPDATE payment_requests SET total_amount = $1, paid_amount = $1 WHERE id = $2`,
    [tamperedAmount, fixture.paymentId],
  );
  await query(
    `UPDATE mkt_ap_preparations SET grand_total_snapshot = $1 WHERE id = $2`,
    [tamperedAmount, fixture.apId],
  );
  const conflict = await api(path, {
    method: "POST",
    headers: { "Idempotency-Key": linkKey },
  });
  assert(conflict.status === 409 && conflict.body?.error === "IDEMPOTENCY_CONFLICT",
    `duplicate conflict failed: ${JSON.stringify(conflict)}`);

  const stored = await query(
    `SELECT payload, payload_fingerprint, status, correlation_reference
     FROM mkt_reconciliation_links WHERE payment_request_id = $1`,
    [fixture.paymentId],
  );
  assert(stored.rows.length === 1, "reconciliation link row count changed");
  assert(JSON.stringify(stored.rows[0].payload) === immutablePayload, "stored link payload was mutated");
  assert(stored.rows[0].payload_fingerprint === immutableFingerprint, "stored link fingerprint was mutated");
  assert(stored.rows[0].status === "created", "stored link status changed");

  const after = await boundarySnapshot();
  assert(Number(after.accounting_entries) === Number(before.accounting_entries),
    "accounting_entries changed during reconciliation-link flow");
  assert(Number(after.accounting_payments) === Number(before.accounting_payments),
    "accounting_payments changed during reconciliation-link flow");
  assert(Number(after.bank_mutations) === Number(before.bank_mutations),
    "bank_mutations changed during reconciliation-link flow");
  assert(Number(after.reconciliation_links) === Number(before.reconciliation_links) + 1,
    "reconciliation link count did not increase by one");

  console.log(JSON.stringify({
    marker,
    readiness: "PASS",
    serverAuthority: "PASS",
    create: "PASS",
    get: "PASS",
    reuse: "PASS",
    duplicateConflict: "PASS",
    payloadImmutable: "PASS",
    correlation: link.correlationReference,
    correlationChain: {
      paymentRequestId: fixture.paymentId,
      accountingHandoffId: handoff.id,
      reconciliationLinkId: link.id,
    },
    boundary: {
      accountingEntriesBefore: before.accounting_entries,
      accountingEntriesAfter: after.accounting_entries,
      accountingPaymentsBefore: before.accounting_payments,
      accountingPaymentsAfter: after.accounting_payments,
      bankMutationsBefore: before.bank_mutations,
      bankMutationsAfter: after.bank_mutations,
      reconciliationLinksBefore: before.reconciliation_links,
      reconciliationLinksAfter: after.reconciliation_links,
    },
  }, null, 2));
}

try {
  await main();
} finally {
  try {
    await cleanupFixture();
    const cleanup = await fixtureSnapshot();
    assert(Object.values(cleanup).every((value) => Number(value) === 0),
      `cleanup left rows: ${JSON.stringify(cleanup)}`);
    console.log(JSON.stringify({ cleanup: "PASS", remaining: cleanup }, null, 2));
  } catch (error) {
    console.error(`[cleanup] FAIL: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
  await client.end().catch(() => {});
}