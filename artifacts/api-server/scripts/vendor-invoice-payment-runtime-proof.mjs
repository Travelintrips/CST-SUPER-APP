/**
 * Development-only authenticated proof for vendor-invoice bank reconciliation.
 *
 * The fixture is written directly to the development database so this proof
 * exercises the real authenticated HTTP route without depending on mutable
 * production data. Every row is marker-scoped and removed in finally.
 *
 * Run:
 *   APP_ENV=development SAFE_DEV_TEST_MODE=true \
 *   node load-secrets.mjs node scripts/vendor-invoice-payment-runtime-proof.mjs
 */
import pg from "pg";
import { randomUUID } from "node:crypto";

const API = (process.env.PROOF_API_URL ?? "http://127.0.0.1:8080/api").replace(/\/+$/, "");
const marker = `VENDOR-INVOICE-PAYMENT-PROOF-${randomUUID()}`;
const appEnv = String(process.env.APP_ENV ?? "");
const safeMode = String(process.env.SAFE_DEV_TEST_MODE ?? "").toLowerCase() === "true";
const devUrl = process.env.SUPABASE_DATABASE_URL_DEV;

if (appEnv !== "development" || !safeMode || process.env.REPLIT_DEPLOYMENT === "1") {
  throw new Error("Refusing to run: this proof requires APP_ENV=development, SAFE_DEV_TEST_MODE=true, and no deployment runtime.");
}
if (!devUrl) throw new Error("SUPABASE_DATABASE_URL_DEV is required; refusing to use an implicit database fallback.");

const pool = new pg.Pool({
  connectionString: devUrl,
  ssl: { rejectUnauthorized: false },
  max: 4,
  connectionTimeoutMillis: 20_000,
});

const jar = new Map();
const fixture = {
  companyId: 0,
  invoiceId: 0,
  withholdingInvoiceId: 0,
  mutationIds: [],
  withholdingMutationId: 0,
};
const checks = [];

function check(name, ok, detail = "") {
  checks.push({ name, ok: Boolean(ok), detail: detail || undefined });
  if (!ok) throw new Error(`${name}: ${detail || "assertion failed"}`);
  console.log(`PASS ${name}${detail ? ` — ${detail}` : ""}`);
}

function cookieHeader() {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function captureCookies(headers) {
  const values = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : ((headers.get("set-cookie") ?? "").match(/(?:^|,\s*)([^=;,]+=[^;]*)/g) ?? [])
      .map((value) => value.replace(/^,\s*/, ""));
  for (const value of values) {
    const pair = value.split(";")[0];
    const separator = pair.indexOf("=");
    if (separator > 0) jar.set(pair.slice(0, separator), pair.slice(separator + 1));
  }
}

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function request(path, { method = "GET", body, headers = {} } = {}) {
  const requestHeaders = { ...headers };
  if (jar.size) requestHeaders.cookie = cookieHeader();
  let requestBody;
  if (body !== undefined) {
    requestHeaders["content-type"] = "application/json";
    requestBody = JSON.stringify(body);
  }
  const response = await fetch(`${API}${path}`, {
    method,
    headers: requestHeaders,
    body: requestBody,
  });
  captureCookies(response.headers);
  const text = await response.text();
  let parsed = text;
  try { parsed = text ? JSON.parse(text) : null; } catch {}
  return { status: response.status, body: parsed };
}

async function query(text, values = []) {
  return (await pool.query(text, values)).rows;
}

async function one(text, values = []) {
  return (await query(text, values))[0] ?? null;
}

async function dbFixture() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const settings = await client.query(`
      SELECT company_id, default_bank_account_id, ap_account_id, bank_journal_id
      FROM accounting_settings
      WHERE default_bank_account_id IS NOT NULL
        AND ap_account_id IS NOT NULL
        AND bank_journal_id IS NOT NULL
      ORDER BY company_id
      LIMIT 1
    `);
    const configured = settings.rows[0];
    if (!configured) throw new Error("No development company has AP, bank COA, and bank journal configured.");
    fixture.companyId = Number(configured.company_id);

    const invoice = await client.query(`
      INSERT INTO vendor_invoices (
        invoice_number, vendor_invoice_ref, company_id, supplier_name,
        status, invoice_date, due_date, total_amount, tax_amount,
        withholding_tax_amount, grand_total, amount_paid, notes
      )
      VALUES ($1, $2, $3, $4, 'posted', CURRENT_DATE, CURRENT_DATE + 30,
              900, 0, 0, 900, 0, $5)
      RETURNING id
    `, [
      `${marker}-INVOICE`,
      `${marker}-REF`,
      fixture.companyId,
      `${marker} Supplier`,
      marker,
    ]);
    fixture.invoiceId = Number(invoice.rows[0].id);

    const withholdingInvoice = await client.query(`
      INSERT INTO vendor_invoices (
        invoice_number, vendor_invoice_ref, company_id, supplier_name,
        status, invoice_date, due_date, total_amount, tax_amount,
        withholding_tax_amount, withholding_review_status, grand_total,
        amount_paid, notes
      )
      VALUES ($1, $2, $3, $4, 'posted', CURRENT_DATE, CURRENT_DATE + 30,
              150, 0, 10, 'required', 150, 0, $5)
      RETURNING id
    `, [
      `${marker}-WHT-INVOICE`,
      `${marker}-WHT-REF`,
      fixture.companyId,
      `${marker} Withholding Supplier`,
      marker,
    ]);
    fixture.withholdingInvoiceId = Number(withholdingInvoice.rows[0].id);

    for (const [index, amount] of [300, 300, 300].entries()) {
      const mutation = await client.query(`
        INSERT INTO bank_mutations (
          bank_account_id, transaction_date, description, credit_amount,
          debit_amount, amount, direction, mutation_key,
          normalized_description, status, company_id, source_classification
        )
        VALUES (NULL, CURRENT_DATE, $1, 0, $2, $2, 'OUT', $3, $1, 'unmatched', $4, 'unknown')
        RETURNING id
      `, [
        `${marker} payment ${index + 1}`,
        amount,
        `${marker}-MUTATION-${index + 1}`,
        fixture.companyId,
      ]);
      fixture.mutationIds.push(Number(mutation.rows[0].id));
    }

    const withholdingMutation = await client.query(`
      INSERT INTO bank_mutations (
        bank_account_id, transaction_date, description, credit_amount,
        debit_amount, amount, direction, mutation_key,
        normalized_description, status, company_id, source_classification
      )
      VALUES (NULL, CURRENT_DATE, $1, 0, 150, 150, 'OUT', $2, $1, 'unmatched', $3, 'unknown')
      RETURNING id
    `, [
      `${marker} withholding payment`,
      `${marker}-WHT-MUTATION`,
      fixture.companyId,
    ]);
    fixture.withholdingMutationId = Number(withholdingMutation.rows[0].id);

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

async function cleanup() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    // This proof only owns marker rows. Replica mode is needed to remove the
    // posted fixture journals without weakening production ledger guards.
    await client.query("SET LOCAL session_replication_role = replica");
    const mutationIds = [...fixture.mutationIds, fixture.withholdingMutationId].filter(Boolean);
    if (mutationIds.length) {
      await client.query("DELETE FROM bank_reconciliation_audit WHERE mutation_id = ANY($1::int[])", [mutationIds]);
      await client.query("DELETE FROM bank_reconciliation_matches WHERE mutation_id = ANY($1::int[])", [mutationIds]);
      await client.query(`
        DELETE FROM accounting_entry_lines
        WHERE entry_id IN (
          SELECT id FROM accounting_entries
          WHERE source = 'bank_reconciliation' AND source_id = ANY($1::int[])
        )
      `, [mutationIds]);
      await client.query(
        "DELETE FROM accounting_entries WHERE source = 'bank_reconciliation' AND source_id = ANY($1::int[])",
        [mutationIds],
      );
      await client.query("DELETE FROM bank_mutations WHERE id = ANY($1::int[])", [mutationIds]);
    }
    const invoiceIds = [fixture.invoiceId, fixture.withholdingInvoiceId].filter(Boolean);
    if (invoiceIds.length) {
      await client.query("DELETE FROM vendor_invoices WHERE id = ANY($1::int[])", [invoiceIds]);
    }
    await client.query(
      "DELETE FROM processed_requests WHERE idempotency_key LIKE $1",
      [`${marker}%`],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Cleanup failed:", error?.message ?? error);
  } finally {
    client.release();
  }
}

async function main() {
  const configuredEmail = [
    ...(process.env.ADMIN_EMAIL ?? "").split(","),
    ...(process.env.ADMIN_EMAILS ?? "").split(","),
  ].map((value) => value.trim()).find(Boolean);
  if (!configuredEmail) throw new Error("ADMIN_EMAIL or ADMIN_EMAILS is required for the authenticated proof.");

  const login = await request("/dev-login", {
    method: "POST",
    body: { email: configuredEmail },
  });
  check("authenticated admin development session", login.status === 200 && jar.size > 0, `HTTP ${login.status}`);

  await dbFixture();
  check("development fixture has one invoice and three bank mutations", fixture.invoiceId > 0 && fixture.mutationIds.length === 3);

  const payload = {
    vendor_invoice_id: fixture.invoiceId,
    amount: 300,
  };
  const firstKey = `${marker}-approval-1`;
  const concurrent = await Promise.all([
    request(`/bank-reconciliation/${fixture.mutationIds[0]}/vendor-invoice-payment`, {
      method: "POST",
      headers: { "x-idempotency-key": firstKey, "x-company-id": String(fixture.companyId) },
      body: payload,
    }),
    request(`/bank-reconciliation/${fixture.mutationIds[0]}/vendor-invoice-payment`, {
      method: "POST",
      headers: { "x-idempotency-key": `${marker}-approval-1-race`, "x-company-id": String(fixture.companyId) },
      body: payload,
    }),
  ]);
  const successful = concurrent.filter((response) => response.status === 200);
  const rejected = concurrent.filter((response) => response.status === 409);
  check(
    "concurrent approval has one winner",
    successful.length === 1 && rejected.length === 1,
    concurrent.map((response) => response.status).join(","),
  );
  const firstResponse = successful[0];
  // The middleware records the completed response asynchronously after
  // res.json; wait for that durable replay record before retrying.
  await sleep(400);
  const retry = await request(`/bank-reconciliation/${fixture.mutationIds[0]}/vendor-invoice-payment`, {
    method: "POST",
    headers: { "x-idempotency-key": firstKey, "x-company-id": String(fixture.companyId) },
    body: payload,
  });
  check("successful retry replays idempotent response", retry.status === 200 && retry.body?.__idempotency?.cached === true);

  for (const [index, mutationId] of fixture.mutationIds.slice(1).entries()) {
    const response = await request(`/bank-reconciliation/${mutationId}/vendor-invoice-payment`, {
      method: "POST",
      headers: {
        "x-idempotency-key": `${marker}-approval-${index + 2}`,
        "x-company-id": String(fixture.companyId),
      },
      body: payload,
    });
    check(`partial payment ${index + 2} is posted`, response.status === 200, `HTTP ${response.status}`);
  }

  const invoice = await one(
    "SELECT amount_paid, status FROM vendor_invoices WHERE id = $1",
    [fixture.invoiceId],
  );
  check("three distinct mutations fully settle invoice once", Number(invoice?.amount_paid) === 900 && invoice?.status === "paid");

  const journalRows = await query(`
    SELECT ae.id, ae.source_id, ael.account_id, ael.debit, ael.credit
    FROM accounting_entries ae
    JOIN accounting_entry_lines ael ON ael.entry_id = ae.id
    WHERE ae.source = 'bank_reconciliation'
      AND ae.source_id = ANY($1::int[])
    ORDER BY ae.source_id, ael.id
  `, [fixture.mutationIds]);
  const entryIds = new Set(journalRows.map((row) => Number(row.id)));
  const apAccount = await one(
    "SELECT ap_account_id FROM accounting_settings WHERE company_id = $1",
    [fixture.companyId],
  );
  const firstLines = journalRows.filter((row) => Number(row.source_id) === fixture.mutationIds[0]);
  check("one journal per mutation with balanced AP/bank lines", entryIds.size === 3 && firstLines.length === 2
    && firstLines.some((line) => Number(line.account_id) === Number(apAccount?.ap_account_id) && Number(line.debit) === 300)
    && Math.abs(firstLines.reduce((sum, line) => sum + Number(line.debit) - Number(line.credit), 0)) < 0.01);

  const approvedMatches = await one(
    "SELECT COUNT(*)::int AS count FROM bank_reconciliation_matches WHERE mutation_id = ANY($1::int[]) AND status = 'approved'",
    [fixture.mutationIds],
  );
  check("one approved reconciliation match per mutation", Number(approvedMatches?.count) === 3);

  const withholdingResponse = await request(
    `/bank-reconciliation/${fixture.withholdingMutationId}/vendor-invoice-payment`,
    {
      method: "POST",
      headers: {
        "x-idempotency-key": `${marker}-withholding`,
        "x-company-id": String(fixture.companyId),
      },
      body: { vendor_invoice_id: fixture.withholdingInvoiceId, amount: 150 },
    },
  );
  check("withholding invoice is rejected by generic reconciliation", withholdingResponse.status === 422);
  const withholdingState = await one(
    "SELECT amount_paid, status FROM vendor_invoices WHERE id = $1",
    [fixture.withholdingInvoiceId],
  );
  const withholdingJournal = await one(
    "SELECT COUNT(*)::int AS count FROM accounting_entries WHERE source = 'bank_reconciliation' AND source_id = $1",
    [fixture.withholdingMutationId],
  );
  check(
    "withholding rejection leaves invoice and journal untouched",
    Number(withholdingState?.amount_paid) === 0
      && withholdingState?.status === "posted"
      && Number(withholdingJournal?.count) === 0,
  );

  console.log(JSON.stringify({
    ok: true,
    marker,
    companyId: fixture.companyId,
    invoiceId: fixture.invoiceId,
    mutationIds: fixture.mutationIds,
    raceStatuses: concurrent.map((response) => response.status),
    firstResponse: firstResponse.body,
    checks,
  }, null, 2));
}

try {
  await main();
} finally {
  await cleanup();
  await pool.end();
}