/**
 * Development-only integration proof for exact bank-match auto-posting.
 *
 * The proof creates one marker-scoped expense and bank mutation, then calls
 * the real authenticated run-matching endpoint concurrently. Cleanup removes
 * only rows owned by this proof.
 *
 * Run:
 *   APP_ENV=development SAFE_DEV_TEST_MODE=true \
 *   node load-secrets.mjs node scripts/exact-match-auto-post-runtime-proof.mjs
 */
import pg from "pg";
import { randomUUID } from "node:crypto";

const API = (process.env.PROOF_API_URL ?? "http://127.0.0.1:18444/api").replace(/\/+$/, "");
const marker = `EXACT-MATCH-AUTO-POST-PROOF-${randomUUID()}`;
const appEnv = String(process.env.APP_ENV ?? "");
const safeMode = String(process.env.SAFE_DEV_TEST_MODE ?? "").toLowerCase() === "true";
const devUrl = process.env.SUPABASE_DATABASE_URL_DEV;

if (appEnv !== "development" || !safeMode || process.env.REPLIT_DEPLOYMENT === "1") {
  throw new Error(
    "Refusing to run: this proof requires APP_ENV=development, SAFE_DEV_TEST_MODE=true, and no deployment runtime.",
  );
}
if (!devUrl) {
  throw new Error("SUPABASE_DATABASE_URL_DEV is required; refusing to use an implicit database fallback.");
}

const pool = new pg.Pool({
  connectionString: devUrl,
  ssl: { rejectUnauthorized: false },
  max: 4,
  connectionTimeoutMillis: 20_000,
});

const fixture = {
  companyId: 0,
  expenseId: 0,
  mutationId: 0,
  expenseNumber: "",
};
const checks = [];
const jar = new Map();

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
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    // Preserve non-JSON response text for the assertion detail.
  }
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

    const settingsResult = await client.query(`
      SELECT
        s.company_id,
        s.default_bank_account_id,
        s.purchase_expense_account_id,
        s.bank_journal_id,
        cba.id AS mutation_bank_account_id
      FROM accounting_settings s
      LEFT JOIN company_bank_accounts cba
        ON cba.company_id = s.company_id
       AND cba.coa_id = s.default_bank_account_id
       AND cba.is_active = TRUE
      WHERE s.company_id IS NOT NULL
        AND s.default_bank_account_id IS NOT NULL
        AND s.bank_journal_id IS NOT NULL
      ORDER BY s.company_id
      LIMIT 1
    `);
    const settings = settingsResult.rows[0];
    if (!settings) {
      throw new Error("No development company has a default bank COA and bank journal configured.");
    }

    fixture.companyId = Number(settings.company_id);
    const fallbackExpense = await client.query(`
      SELECT id
      FROM chart_of_accounts
      WHERE company_id = $1
        AND type = 'expense'
        AND is_active = TRUE
        AND is_header = FALSE
        AND is_postable = TRUE
      ORDER BY id
      LIMIT 1
    `, [fixture.companyId]);
    const expenseAccountId = Number(
      settings.purchase_expense_account_id ?? fallbackExpense.rows[0]?.id ?? 0,
    );
    if (!expenseAccountId) {
      throw new Error("No postable expense COA is available for the development company.");
    }

    const amount = 321_789;
    const description = `${marker} bank transfer expense`;
    fixture.expenseNumber = `${marker}-EXPENSE`;

    const expense = await client.query(`
      INSERT INTO expenses (
        company_id, expense_number, date, vendor_employee, expense_type,
        description, qty, unit_price, subtotal, tax_amount, total, currency,
        status, expense_account_id, notes
      )
      VALUES ($1, $2, CURRENT_DATE, $3, 'vendor_bill', $4,
              1, $5, $5, 0, $5, 'IDR', 'posted', $6, $7)
      RETURNING id
    `, [
      fixture.companyId,
      fixture.expenseNumber,
      marker,
      description,
      amount,
      expenseAccountId,
      marker,
    ]);
    fixture.expenseId = Number(expense.rows[0]?.id ?? 0);
    if (!fixture.expenseId) throw new Error("Failed to create expense fixture.");

    const mutation = await client.query(`
      INSERT INTO bank_mutations (
        bank_account_id, transaction_date, description, credit_amount,
        debit_amount, amount, direction, mutation_key, normalized_description,
        provider_name, provider_order_id, uploaded_proof_url, status,
        source, company_id
      )
      VALUES ($1, CURRENT_DATE, $2, 0, $3, $3, 'OUT', $4, $2,
              'BANK_TRANSFER', $5, $6, 'unmatched', 'integration-proof', $7)
      RETURNING id
    `, [
      settings.mutation_bank_account_id == null
        ? null
        : Number(settings.mutation_bank_account_id),
      description,
      amount,
      `${marker}-MUTATION`,
      fixture.expenseNumber,
      `proof://${marker}`,
      fixture.companyId,
    ]);
    fixture.mutationId = Number(mutation.rows[0]?.id ?? 0);
    if (!fixture.mutationId) throw new Error("Failed to create bank mutation fixture.");

    const mutationPreflight = await client.query(`
      SELECT id, company_id, transaction_date::text AS transaction_date,
             description, normalized_description, amount, direction,
             provider_order_id, uploaded_proof_url, status
      FROM bank_mutations
      WHERE id = $1
    `, [fixture.mutationId]);
    console.log("[proof] mutation preflight:", JSON.stringify(mutationPreflight.rows));

    const candidatePreflight = await client.query(`
      SELECT e.id, e.company_id, e.date::text AS date, e.total,
             e.expense_number, e.description
      FROM expenses e
      WHERE e.id = $1
        AND e.company_id = $2
        AND e.date = CURRENT_DATE
        AND ABS(e.total::numeric - $3::numeric) <= 0.01
    `, [fixture.expenseId, fixture.companyId, amount]);
    console.log("[proof] expense candidate preflight:", JSON.stringify(candidatePreflight.rows));

    const engineCandidatePreflight = await client.query(`
      SELECT e.id, e.company_id, e.date::text AS date, e.total,
             e.expense_number, e.description
      FROM expenses e
      WHERE ABS(e.total::numeric - $1::numeric) <= 0.01
        AND e.date BETWEEN $2::date AND $2::date
        AND e.company_id = $3
    `, [amount, new Date().toISOString().slice(0, 10), fixture.companyId]);
    console.log("[proof] engine expense candidate preflight:", JSON.stringify(engineCandidatePreflight.rows));

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
    // Posted entries are immutable during normal operation. This proof owns
    // only its marker-scoped rows, so replica mode is used solely for cleanup.
    await client.query("SET LOCAL session_replication_role = replica");

    if (fixture.mutationId) {
      const entries = await client.query(`
        SELECT id
        FROM accounting_entries
        WHERE source = 'bank_reconciliation'
          AND source_id = $1
      `, [fixture.mutationId]);
      const entryIds = entries.rows.map((row) => Number(row.id)).filter(Boolean);

      if (entryIds.length) {
        await client.query(
          "DELETE FROM ledger_events WHERE entry_id = ANY($1::int[])",
          [entryIds],
        ).catch(() => {});
        await client.query(`
          DELETE FROM accounting_reconciliations
          WHERE line_id IN (
            SELECT id FROM accounting_entry_lines WHERE entry_id = ANY($1::int[])
          )
        `, [entryIds]).catch(() => {});
        await client.query(
          "DELETE FROM accounting_entry_lines WHERE entry_id = ANY($1::int[])",
          [entryIds],
        );
        await client.query(
          "DELETE FROM accounting_entries WHERE id = ANY($1::int[])",
          [entryIds],
        );
      }

      await client.query(
        "DELETE FROM bank_reconciliation_audit WHERE mutation_id = $1",
        [fixture.mutationId],
      );
      await client.query(
        "DELETE FROM bank_reconciliation_matches WHERE mutation_id = $1",
        [fixture.mutationId],
      );
      await client.query(
        "DELETE FROM bank_mutations WHERE id = $1",
        [fixture.mutationId],
      );
    }

    if (fixture.expenseId) {
      await client.query("DELETE FROM expenses WHERE id = $1", [fixture.expenseId]);
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Cleanup failed:", error?.message ?? error);
  } finally {
    client.release();
  }
}

async function runMatching() {
  return request("/bank-reconciliation/run-matching", {
    method: "POST",
    headers: { "x-company-id": String(fixture.companyId) },
    body: {
      ids: [fixture.mutationId],
      matching_mode: "new",
    },
  });
}

async function main() {
  const configuredEmail = [
    ...(process.env.ADMIN_EMAIL ?? "").split(","),
    ...(process.env.ADMIN_EMAILS ?? "").split(","),
  ].map((value) => value.trim()).find(Boolean);
  if (!configuredEmail) {
    throw new Error("ADMIN_EMAIL or ADMIN_EMAILS is required for the authenticated proof.");
  }

  const login = await request("/dev-login", {
    method: "POST",
    body: { email: configuredEmail },
  });
  check(
    "authenticated admin development session",
    login.status === 200 && jar.size > 0,
    `HTTP ${login.status}`,
  );

  await dbFixture();
  check(
    "marker-scoped expense and bank mutation created",
    fixture.companyId > 0 && fixture.expenseId > 0 && fixture.mutationId > 0,
  );

  const concurrent = await Promise.all([runMatching(), runMatching()]);
  console.log("[proof] concurrent matching responses:", JSON.stringify(concurrent));
  const safeStatuses = concurrent.every((response) => response.status === 200 || response.status === 409);
  check(
    "concurrent matching requests have safe responses",
    safeStatuses && concurrent.some((response) => response.status === 200),
    concurrent.map((response) => response.status).join(","),
  );

  // The run-level advisory lock may reject one request while the first is
  // active. Retry only that request after the winner has completed.
  for (const response of concurrent) {
    if (response.status === 409) {
      const retry = await runMatching();
      check("advisory-lock retry completes", retry.status === 200, `HTTP ${retry.status}`);
    }
  }

  const mutation = await one(`
    SELECT status, journal_entry_id
    FROM bank_mutations
    WHERE id = $1
  `, [fixture.mutationId]);
  console.log("[proof] persisted matching state:", JSON.stringify({
    mutation,
    matches: await query(`
      SELECT id, candidate_type, candidate_id, candidate_source, match_score, match_reason, status
      FROM bank_reconciliation_matches
      WHERE mutation_id = $1
      ORDER BY id
    `, [fixture.mutationId]),
    audit: await query(`
      SELECT action, meta
      FROM bank_reconciliation_audit
      WHERE mutation_id = $1
      ORDER BY id
    `, [fixture.mutationId]),
  }));
  check(
    "exact match posts the bank mutation",
    mutation?.status === "posted" && Number(mutation?.journal_entry_id) > 0,
    JSON.stringify(mutation),
  );

  const journals = await query(`
    SELECT id, status, total_debit, total_credit
    FROM accounting_entries
    WHERE source = 'bank_reconciliation'
      AND source_id = $1
  `, [fixture.mutationId]);
  check(
    "concurrent matching creates exactly one posted balanced journal",
    journals.length === 1
      && journals[0].status === "posted"
      && Math.abs(Number(journals[0].total_debit) - Number(journals[0].total_credit)) < 0.01,
    JSON.stringify(journals),
  );

  const approvedMatches = await one(`
    SELECT COUNT(*)::int AS count
    FROM bank_reconciliation_matches
    WHERE mutation_id = $1
      AND status = 'approved'
  `, [fixture.mutationId]);
  check(
    "one approved reconciliation match remains after the race",
    Number(approvedMatches?.count) === 1,
    JSON.stringify(approvedMatches),
  );

  const retry = await runMatching();
  check(
    "retry after posting does not reprocess the mutation",
    retry.status === 200 && Number(retry.body?.processed ?? -1) === 0,
    `HTTP ${retry.status} body=${JSON.stringify(retry.body)}`,
  );

  const journalCountAfterRetry = await one(`
    SELECT COUNT(*)::int AS count
    FROM accounting_entries
    WHERE source = 'bank_reconciliation'
      AND source_id = $1
  `, [fixture.mutationId]);
  check(
    "retry leaves the single journal intact",
    Number(journalCountAfterRetry?.count) === 1,
    JSON.stringify(journalCountAfterRetry),
  );

  const autoPostAudits = await one(`
    SELECT COUNT(*)::int AS count
    FROM bank_reconciliation_audit
    WHERE mutation_id = $1
      AND action = 'MATCH_APPROVED_AUTO_POSTED'
  `, [fixture.mutationId]);
  check(
    "auto-post success is auditable",
    Number(autoPostAudits?.count) >= 1,
    JSON.stringify(autoPostAudits),
  );

  console.log(JSON.stringify({
    ok: true,
    marker,
    companyId: fixture.companyId,
    expenseId: fixture.expenseId,
    mutationId: fixture.mutationId,
    concurrentStatuses: concurrent.map((response) => response.status),
    checks,
  }, null, 2));
}

try {
  await main();
} finally {
  await cleanup();
  await pool.end();
}