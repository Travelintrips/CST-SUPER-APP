#!/usr/bin/env node
/**
 * Development-only runtime proof for the expense/AP posting contract.
 *
 * All business writes in this harness go through HTTP routes. SQL is used only
 * for runtime discovery, evidence capture, and marker-scoped DEV cleanup.
 * Run only through load-secrets.mjs with APP_ENV=development.
 */
import pg from "pg";

const BASE = process.env.RUNTIME_PROOF_BASE_URL ?? "http://127.0.0.1:18444";
const APP_ENV = process.env.APP_ENV;
const MARKER = `[RUNTIME-PROOF-${Date.now()}]`;
const COMPANY_ID = 1;
const OTHER_COMPANY_ID = 2;

if (APP_ENV !== "development") {
  throw new Error("Refusing to run outside APP_ENV=development");
}
if (!process.env.SUPABASE_DATABASE_URL_DEV) {
  throw new Error("SUPABASE_DATABASE_URL_DEV is required");
}

const pool = new pg.Pool({
  connectionString: process.env.SUPABASE_DATABASE_URL_DEV,
  ssl: { rejectUnauthorized: false },
  max: 2,
});
const sql = async (text, values = []) => (await pool.query(text, values)).rows;

let cookie = "";
const evidence = [];
const fixture = {
  expenses: [],
  invoices: [],
  disbursements: [],
  entries: [],
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function json(value) {
  return JSON.parse(JSON.stringify(value, (_key, v) =>
    typeof v === "bigint" ? Number(v) : v));
}

function valueOf(object, ...keys) {
  for (const key of keys) {
    if (object?.[key] !== undefined && object?.[key] !== null) return object[key];
  }
  return null;
}

async function api(path, options = {}) {
  const headers = {
    accept: "application/json",
    ...(options.body === undefined ? {} : { "content-type": "application/json" }),
    ...(cookie ? { cookie } : {}),
    ...(options.headers ?? {}),
  };
  const response = await fetch(`${BASE}${path}`, {
    ...options,
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let body;
  try { body = text ? JSON.parse(text) : null; } catch { body = text; }
  return { status: response.status, body };
}

function must(result, label, expected = [200, 201]) {
  if (!expected.includes(result.status)) {
    throw new Error(`${label}: HTTP ${result.status} ${JSON.stringify(result.body)}`);
  }
  return result.body;
}

async function login(email) {
  const result = await fetch(`${BASE}/api/auth/dev-login`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json" },
    body: JSON.stringify({ email }),
  });
  if (!result.ok) throw new Error(`dev-login failed: ${result.status}`);
  const setCookie = result.headers.get("set-cookie");
  if (!setCookie) throw new Error("dev-login did not return a session cookie");
  cookie = setCookie.split(";")[0];
}

async function discover() {
  const [settings, journals, accounts, categories, users] = await Promise.all([
    sql(`select company_id, ap_account_id, ppn_input_account_id,
                 default_bank_account_id, default_cash_account_id
          from accounting_settings where company_id = $1`, [COMPANY_ID]),
    sql(`select id, company_id, code, name, type, default_credit_account_id,
                 default_debit_account_id
          from accounting_journals
          where company_id = $1 and type in ('bank','cash')
          order by id`, [COMPANY_ID]),
    sql(`select id, company_id, code, name, type, subtype, is_postable, is_active, status
          from chart_of_accounts
          where company_id = $1
            and (is_postable = true and is_active = true and status = 'ACTIVE')
            and (type = 'expense' or subtype in ('tax_asset','cash_bank')
                 or code in ('2-1010-CST','2-1030-CST','2-1094-CST'))
          order by id`, [COMPANY_ID]),
    sql(`select id, company_id, name, expense_account_id
          from expense_categories where company_id = $1 order by id`, [COMPANY_ID]),
    sql(`select id, email, role, company_id from users
          where role not in ('admin','super_admin') and company_id is not null
          order by id limit 20`),
  ]);
  const setting = settings[0];
  const journal = journals.find((row) =>
    row.default_credit_account_id || row.default_debit_account_id);
  const expenseAccount = accounts.find((row) =>
    row.type === "expense" && row.is_postable && row.is_active && row.status === "ACTIVE");
  const category = categories.find((row) =>
    row.expense_account_id === expenseAccount?.id) ?? categories[0];
  const ppnAccount = accounts.find((row) =>
    row.id === setting?.ppn_input_account_id || row.subtype === "tax_asset");
  const apAccount = accounts.find((row) =>
    row.id === setting?.ap_account_id || row.code === "2-1010-CST");
  const withholdingAccount = accounts.find((row) =>
    row.code === "2-1094-CST" ||
    (row.type === "liability" && /pph\s*23|withhold/i.test(row.name)));
  const bankAccountId = Number(
    journal?.default_credit_account_id ??
    journal?.default_debit_account_id ??
    setting?.default_bank_account_id ??
    setting?.default_cash_account_id,
  );
  if (!setting || !journal || !expenseAccount || !category || !apAccount ||
      !ppnAccount || !withholdingAccount || !bankAccountId) {
    throw new Error(`Runtime accounting fixture incomplete: ${JSON.stringify({
      setting, journal, expenseAccount, category, apAccount, ppnAccount,
      withholdingAccount, bankAccountId,
    })}`);
  }
  const nonAdmin = users.find((row) => row.company_id === COMPANY_ID);
  if (!nonAdmin) {
    throw new Error("No existing non-admin user assigned to company 1 for IDOR proof");
  }
  return {
    setting, journal, accounts, category, expenseAccount, apAccount, ppnAccount,
    withholdingAccount, bankAccountId, nonAdmin,
  };
}

async function entryEvidence(entryId) {
  const entries = await sql(`select id, company_id, journal_id, date, ref, description,
                                    source, status
                             from accounting_entries where id = $1`, [entryId]);
  const lines = await sql(`select l.id, l.entry_id, l.account_id, c.code, c.name,
                                  c.type, l.debit, l.credit, l.description
                           from accounting_entry_lines l
                           left join chart_of_accounts c on c.id = l.account_id
                           where l.entry_id = $1 order by l.id`, [entryId]);
  const totals = lines.reduce((a, row) => ({
    debit: a.debit + Number(row.debit ?? 0),
    credit: a.credit + Number(row.credit ?? 0),
  }), { debit: 0, credit: 0 });
  return { entry: entries[0] ?? null, lines, totals };
}

async function invoiceEvidence(invoiceId) {
  const rows = await sql(`select id, company_id, invoice_number, vendor_invoice_ref,
                                 supplier_name, status, total_amount, tax_amount,
                                 grand_total, amount_paid, journal_entry_id
                          from vendor_invoices where id = $1`, [invoiceId]);
  const lines = await sql(`select id, invoice_id, name, quantity, unit_cost, subtotal,
                                  tax_amount, coa_account_id
                           from vendor_invoice_lines where invoice_id = $1 order by id`, [invoiceId]);
  const taxes = await sql(`select id, invoice_line_id, tax_type, tax_object, tax_amount,
                                  liability_account_id, resolution_status
                           from vendor_invoice_line_taxes
                           where invoice_line_id = any($1::int[]) order by id`,
    [lines.map((row) => row.id)]);
  const withholding = await sql(`select id, line_tax_id, tax_type, tax_amount,
                                        liability_account_id, status
                                 from vendor_withholding_records
                                 where vendor_invoice_id = $1 order by id`, [invoiceId]);
  return { invoice: rows[0] ?? null, lines, taxes, withholding };
}

async function createInvoice(discovery, suffix, opts = {}) {
  const amount = opts.amount ?? 100_000;
  const taxAmount = opts.taxAmount ?? 0;
  const whtAmount = opts.whtAmount ?? 0;
  const ref = `${MARKER}-${suffix}`;
  const body = {
    companyId: COMPANY_ID,
    supplierName: `${MARKER} Supplier ${suffix}`,
    vendorInvoiceRef: ref,
    invoiceDate: "2026-09-05",
    dueDate: "2026-10-05",
    notes: MARKER,
    lines: [{
      name: `${MARKER} ${suffix}`,
      quantity: 1,
      unit: "unit",
      unitCost: amount,
      taxAmount,
      coaAccountId: discovery.expenseAccount.id,
      coaResolutionStatus: "confirmed",
      ...(whtAmount ? {
        withholdingTaxes: [{
          taxType: "PPh 23",
          taxObject: "Jasa",
          baseAmount: amount,
          taxAmount: whtAmount,
          liabilityAccountId: discovery.withholdingAccount.id,
        }],
      } : {}),
    }],
  };
  const created = must(await api(`/api/purchase-workflow/vendor-invoices?companyId=${COMPANY_ID}`, {
    method: "POST", body,
  }), `create ${suffix}`);
  const invoiceId = Number(created.id);
  fixture.invoices.push(invoiceId);
  const beforeReview = await invoiceEvidence(invoiceId);
  const line = beforeReview.lines[0];
  must(await api(`/api/purchase-workflow/vendor-invoices/${invoiceId}/finance-review?companyId=${COMPANY_ID}`, {
    method: "PUT",
    body: {
      companyId: COMPANY_ID,
      lines: [{ lineId: line.id, coaAccountId: discovery.expenseAccount.id }],
      taxes: whtAmount ? [{
        invoiceLineId: line.id,
        taxType: "PPh 23",
        taxObject: "Jasa",
        baseAmount: amount,
        taxAmount: whtAmount,
        liabilityAccountId: discovery.withholdingAccount.id,
      }] : [],
    },
  }), `finance-review ${suffix}`);
  must(await api(`/api/purchase-workflow/vendor-invoices/${invoiceId}/post?companyId=${COMPANY_ID}`, {
    method: "POST", body: { companyId: COMPANY_ID },
  }), `post ${suffix}`);
  return { invoiceId, lineId: line.id, ref, amount, taxAmount, whtAmount };
}

async function payInvoice(discovery, invoice, suffix, idempotencyKey) {
  // This route accepts the bank/net amount; it adds whtAmount back when
  // checking gross settlement and debits AP for net + withholding.
  const paymentAmount = invoice.amount + invoice.taxAmount - invoice.whtAmount;
  const body = {
    companyId: COMPANY_ID,
    journalId: discovery.journal.id,
    date: "2026-09-05",
    ref: `${MARKER}-PAY-${suffix}`,
    memo: `${MARKER} ${suffix}`,
    paymentType: "vendor_invoice",
    invoicePayments: [{
      vendorInvoiceId: invoice.invoiceId,
      paymentAmount,
      ...(invoice.whtAmount ? {
        whtAmount: invoice.whtAmount,
        whtAccountId: discovery.withholdingAccount.id,
        withholdingAllocations: [{
          lineTaxId: invoice.lineTaxId,
          amount: invoice.whtAmount,
          accountId: discovery.withholdingAccount.id,
        }],
      } : {}),
    }],
  };
  const result = must(await api(`/api/accounting/bank-disbursements?companyId=${COMPANY_ID}`, {
    method: "POST",
    headers: idempotencyKey ? { "x-idempotency-key": idempotencyKey } : {},
    body,
  }), `pay ${suffix}`);
  const disbId = Number(result.id);
  fixture.disbursements.push(disbId);
  const entryId = Number(valueOf(result, "entry_id", "entryId"));
  if (entryId) fixture.entries.push(entryId);
  return { result, disbId, entryId, evidence: await entryEvidence(entryId) };
}

async function record(name, pass, details) {
  evidence.push({ scenario: name, pass, details: json(details) });
  if (!pass) throw new Error(`${name} failed: ${JSON.stringify(details)}`);
}

async function cleanup() {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local session_replication_role = replica");
    const ids = (values) => values.length ? values : [-1];
    await client.query(`delete from vendor_withholding_records
                        where vendor_invoice_id = any($1::int[])`, [ids(fixture.invoices)]);
    await client.query(`delete from vendor_invoice_line_taxes
                        where invoice_line_id in
                          (select id from vendor_invoice_lines where invoice_id = any($1::int[]))`,
      [ids(fixture.invoices)]);
    await client.query(`delete from vendor_invoice_lines
                        where invoice_id = any($1::int[])`, [ids(fixture.invoices)]);
    await client.query(`delete from vendor_invoices where id = any($1::int[])`,
      [ids(fixture.invoices)]);
    await client.query(`delete from bank_disbursement_items
                        where disbursement_id = any($1::int[])`, [ids(fixture.disbursements)]);
    await client.query(`delete from bank_disbursements where id = any($1::int[])`,
      [ids(fixture.disbursements)]);
    await client.query(`delete from expense_lines
                        where expense_id = any($1::int[])
                           or description like $2`,
      [ids(fixture.expenses), `${MARKER}%`]);
    await client.query(`delete from expenses where id = any($1::int[])`, [ids(fixture.expenses)]);
    await client.query(`delete from accounting_entry_lines
                        where entry_id = any($1::int[])`, [ids(fixture.entries)]);
    await client.query(`delete from accounting_entries where id = any($1::int[])`,
      [ids(fixture.entries)]);
    await client.query(`delete from erp_audit_logs
                        where new_data::text like $1 or old_data::text like $1`,
      [`%${MARKER}%`]).catch(() => {});
    await client.query("commit");
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}

async function residuals() {
  return {
    expenses: await sql(`select count(*)::int as count from expenses
                         where description like $1 or notes like $1`, [`%${MARKER}%`]),
    invoices: await sql(`select count(*)::int as count from vendor_invoices
                         where notes like $1 or supplier_name like $1`, [`%${MARKER}%`]),
    disbursements: await sql(`select count(*)::int as count from bank_disbursements
                              where memo like $1 or ref like $1`, [`%${MARKER}%`]),
    expenseLines: await sql(`select count(*)::int as count from expense_lines
                             where description like $1`, [`%${MARKER}%`]),
    entries: await sql(`select count(*)::int as count from accounting_entries
                        where description like $1 or ref like $1`, [`%${MARKER}%`]),
  };
}

async function main() {
  const discovery = await discover();
  const adminEmail = (process.env.ADMIN_EMAIL ?? "").split(",")[0].trim();
  if (!adminEmail) throw new Error("ADMIN_EMAIL is required for the admin API proof");
  await login(adminEmail);

  const readinessBefore = await api("/api/health/ready");
  if (!readinessBefore.body?.ready) throw new Error(`Readiness failed: ${JSON.stringify(readinessBefore.body)}`);

  // 1. Direct expense: canonical expense route posts DR expense / CR bank.
  const directBody = {
    companyId: COMPANY_ID,
    date: "2026-09-05",
    categoryId: discovery.category.id,
    description: `${MARKER} direct-expense`,
    qty: 1,
    unit: "unit",
    unitPrice: 12_345,
    expenseAccountId: discovery.expenseAccount.id,
    sourceAccountId: discovery.bankAccountId,
    notes: MARKER,
  };
  const direct = must(await api(`/api/expenses?companyId=${COMPANY_ID}`, {
    method: "POST",
    headers: { "x-idempotency-key": `${MARKER}-expense-1` },
    body: directBody,
  }), "direct expense");
  fixture.expenses.push(Number(direct.id));
  const directEntryId = Number(valueOf(direct, "entry_id", "entryId"));
  const directEntry = await entryEvidence(directEntryId);
  fixture.entries.push(directEntryId);
  await record("1 direct expense uses expense COA, not AP", Number(valueOf(direct, "company_id", "companyId")) === COMPANY_ID &&
    directEntry.lines.some((line) => Number(line.account_id) === discovery.expenseAccount.id &&
      Number(line.debit) === 12_345) &&
    !directEntry.lines.some((line) => Number(line.account_id) === discovery.apAccount.id &&
      Number(line.debit) > 0) &&
    directEntry.totals.debit === directEntry.totals.credit, {
    marker: MARKER, expenseId: direct.id, journalEntryId: directEntryId,
    companyId: valueOf(direct, "company_id", "companyId"), sourceAccountId: discovery.bankAccountId,
    ...directEntry,
  });

  // 2. Canonical vendor invoice posts gross AP.
  const gross = await createInvoice(discovery, "GROSS");
  const grossInvoice = await invoiceEvidence(gross.invoiceId);
  fixture.entries.push(Number(grossInvoice.invoice.journal_entry_id));
  const grossEntry = await entryEvidence(Number(grossInvoice.invoice.journal_entry_id));
  await record("2 vendor invoice posts gross AP", Number(grossInvoice.invoice.company_id) === COMPANY_ID &&
    grossEntry.lines.some((line) => Number(line.account_id) === discovery.apAccount.id &&
      Number(line.credit) === Number(grossInvoice.invoice.grand_total)) &&
    grossEntry.totals.debit === grossEntry.totals.credit, {
    marker: MARKER, invoiceId: gross.invoiceId,
    journalEntryId: grossInvoice.invoice.journal_entry_id, companyId: grossInvoice.invoice.company_id,
    sourceAccountId: null, invoice: grossInvoice.invoice, ...grossEntry,
  });

  // 3. Bank Disbursement settles vendor invoice through AP, not Expense.
  const paid = await payInvoice(discovery, gross, "GROSS", null);
  await record("3 vendor payment debits AP and credits bank", paid.evidence.entry.company_id === COMPANY_ID &&
    paid.evidence.lines.some((line) => Number(line.account_id) === discovery.apAccount.id &&
      Number(line.debit) === Number(grossInvoice.invoice.grand_total)) &&
    !paid.evidence.lines.some((line) => Number(line.account_id) === discovery.expenseAccount.id &&
      Number(line.debit) > 0) &&
    paid.evidence.totals.debit === paid.evidence.totals.credit, {
    marker: MARKER, invoiceId: gross.invoiceId, disbursementId: paid.disbId,
    journalEntryId: paid.evidence.entry.id, companyId: paid.evidence.entry.company_id,
    sourceAccountId: discovery.bankAccountId, ...paid.evidence,
  });

  // 4. Expense idempotency returns the original resource and journal.
  const idemKey = `${MARKER}-expense-retry`;
  const first = must(await api(`/api/expenses?companyId=${COMPANY_ID}`, {
    method: "POST", headers: { "x-idempotency-key": idemKey }, body: {
      ...directBody, description: `${MARKER} idempotent-expense`, unitPrice: 22_222,
    },
  }), "idempotent expense first");
  fixture.expenses.push(Number(first.id));
  const firstEntryId = Number(valueOf(first, "entry_id", "entryId"));
  fixture.entries.push(firstEntryId);
  let retryResult;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    await sleep(250);
    retryResult = await api(`/api/expenses?companyId=${COMPANY_ID}`, {
      method: "POST", headers: { "x-idempotency-key": idemKey }, body: {
        ...directBody, description: `${MARKER} idempotent-expense`, unitPrice: 22_222,
      },
    });
    if (retryResult.status !== 409 ||
        retryResult.body?.error !== "IDEMPOTENCY_IN_FLIGHT") break;
  }
  const second = must(retryResult, "idempotent expense retry");
  const retryCount = await sql(`select count(*)::int as count from expenses
                                where id = $1 or description = $2`,
    [Number(first.id), `${MARKER} idempotent-expense`]);
  await record("4 same expense idempotency key reuses journal", Number(first.id) === Number(second.id) &&
    firstEntryId === Number(valueOf(second, "entry_id", "entryId")) && retryCount[0].count === 1, {
    marker: MARKER, firstExpenseId: first.id, retryExpenseId: second.id,
    firstJournalEntryId: firstEntryId, retryJournalEntryId: valueOf(second, "entry_id", "entryId"),
    persistedRows: retryCount[0].count,
  });

  // 5. Non-admin cross-company access is denied.
  const originalCookie = cookie;
  await login(discovery.nonAdmin.email);
  const denied = await api(`/api/purchase-workflow/vendor-invoices/${gross.invoiceId}?companyId=${OTHER_COMPANY_ID}`);
  await record("5 cross-company invoice access is rejected", denied.status === 403, {
    marker: MARKER, invoiceId: gross.invoiceId, requestedCompanyId: OTHER_COMPANY_ID,
    httpStatus: denied.status, result: denied.body,
  });
  cookie = originalCookie;

  // 6. PPN Input is recorded once on the invoice journal.
  const ppn = await createInvoice(discovery, "PPN", { amount: 100_000, taxAmount: 11_000 });
  const ppnInv = await invoiceEvidence(ppn.invoiceId);
  fixture.entries.push(Number(ppnInv.invoice.journal_entry_id));
  const ppnEntry = await entryEvidence(Number(ppnInv.invoice.journal_entry_id));
  const ppnRows = ppnEntry.lines.filter((line) => Number(line.account_id) === discovery.ppnAccount.id);
  await record("6 PPN Input is posted exactly once", ppnRows.length === 1 &&
    Number(ppnRows[0].debit) === 11_000 && ppnEntry.totals.debit === ppnEntry.totals.credit, {
    marker: MARKER, invoiceId: ppn.invoiceId, journalEntryId: ppnInv.invoice.journal_entry_id,
    companyId: ppnInv.invoice.company_id, sourceAccountId: null,
    ppnAccountId: discovery.ppnAccount.id, ppnRows, invoice: ppnInv.invoice,
    ...ppnEntry,
  });

  // 7. PPh withholding is stored once and settled as a separate liability.
  const wht = await createInvoice(discovery, "PPh", { amount: 100_000, whtAmount: 2_000 });
  const whtInv = await invoiceEvidence(wht.invoiceId);
  const whtTax = whtInv.taxes[0];
  wht.lineTaxId = Number(whtTax.id);
  fixture.entries.push(Number(whtInv.invoice.journal_entry_id));
  const whtPayment = await payInvoice(discovery, wht, "PPh", null);
  const whtRows = whtPayment.evidence.lines.filter((line) =>
    Number(line.account_id) === discovery.withholdingAccount.id);
  await record("7 PPh withholding is persisted once and credited once", whtInv.withholding.length === 1 &&
    whtRows.length === 1 && Number(whtRows[0].credit) === 2_000 &&
    whtPayment.evidence.totals.debit === whtPayment.evidence.totals.credit, {
    marker: MARKER, invoiceId: wht.invoiceId, disbursementId: whtPayment.disbId,
    journalEntryId: whtPayment.evidence.entry.id, companyId: whtPayment.evidence.entry.company_id,
    sourceAccountId: discovery.bankAccountId, withholding: whtInv.withholding,
    withholdingRows: whtRows, invoice: whtInv.invoice, ...whtPayment.evidence,
  });

  const beforeCleanup = await residuals();
  await cleanup();
  const afterCleanup = await residuals();
  const readinessAfter = await api("/api/health/ready");
  const cleanupPass = Object.values(afterCleanup).every((rows) => Number(rows[0]?.count ?? 0) === 0);
  const readyPass = Boolean(readinessAfter.body?.ready);
  console.log(JSON.stringify({
    verdict: evidence.every((row) => row.pass) && cleanupPass && readyPass
      ? "SAFE_TO_PUBLISH"
      : "BLOCKED",
    marker: MARKER,
    scenarios: evidence,
    cleanup: { before: beforeCleanup, after: afterCleanup, pass: cleanupPass },
    readiness: { before: readinessBefore.body, after: readinessAfter.body, pass: readyPass },
  }, null, 2));
}

try {
  await main();
} catch (error) {
  console.error(JSON.stringify({
    verdict: "BLOCKED",
    marker: MARKER,
    error: error instanceof Error ? error.message : String(error),
    fixture,
  }, null, 2));
  try { await cleanup(); } catch (cleanupError) {
    console.error(`cleanup failed: ${cleanupError instanceof Error ? cleanupError.message : cleanupError}`);
  }
  process.exitCode = 1;
} finally {
  await pool.end();
}