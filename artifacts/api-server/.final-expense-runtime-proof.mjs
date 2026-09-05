import pg from "pg";

const { Pool } = pg;
const API = "http://127.0.0.1:18444/api";
const marker = `FINAL_EXPENSE_PROOF_${Date.now()}`;
const pool = new Pool({
  connectionString: process.env.SUPABASE_DATABASE_URL,
  max: 1,
  connectionTimeoutMillis: 20_000,
  idleTimeoutMillis: 20_000,
});

const jar = new Map();
const expenseIds = [];
const invoiceIds = [];
const disbursementIds = [];
const entryIds = [];
const processedKeys = [];
const steps = [];
const evidence = {};

function cookieHeader() {
  return [...jar.entries()].map(([name, value]) => `${name}=${value}`).join("; ");
}

function captureCookies(headers) {
  const values = typeof headers.getSetCookie === "function"
    ? headers.getSetCookie()
    : ((headers.get("set-cookie") || "").match(/(?:^|,\s*)([^=;,]+=[^;]*)/g) || [])
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
  try { parsed = text ? JSON.parse(text) : null; } catch {}
  return { status: response.status, body: parsed };
}

function message(body) {
  if (body && typeof body === "object") {
    for (const key of ["message", "error", "detail"]) {
      if (typeof body[key] === "string") return body[key];
    }
  }
  return typeof body === "string" ? body.slice(0, 240) : JSON.stringify(body);
}

function record(name, pass, detail = "") {
  steps.push({ name, pass, detail: detail || undefined });
  if (!pass) throw new Error(`${name}: ${detail || "failed"}`);
}

async function query(text, values = []) {
  const result = await pool.query(text, values);
  return result.rows;
}

async function one(text, values = []) {
  return (await query(text, values))[0] || null;
}

async function expectStatus(name, response, statuses) {
  const pass = statuses.includes(response.status);
  record(name, pass, `HTTP ${response.status}: ${message(response.body)}`);
  return response;
}

async function createExpense(key, body) {
  processedKeys.push(key);
  const response = await request("/expenses", {
    method: "POST",
    headers: { "x-idempotency-key": key },
    body,
  });
  if (response.status !== 201) {
    throw new Error(`create expense ${key}: HTTP ${response.status}: ${message(response.body)}`);
  }
  const id = Number(response.body?.id);
  if (!Number.isInteger(id)) throw new Error(`create expense ${key}: missing id`);
  expenseIds.push(id);
  const entryId = Number(response.body?.entryId || 0);
  if (entryId) entryIds.push(entryId);
  return response;
}

async function loadEntry(entryId) {
  const entry = await one(
    `select id, company_id, status, source, source_id, description
       from accounting_entries where id = $1`,
    [entryId],
  );
  const lines = await query(
    `select account_id, debit, credit, description
       from accounting_entry_lines where entry_id = $1 order by id`,
    [entryId],
  );
  const balance = lines.reduce((sum, line) => sum + Number(line.debit) - Number(line.credit), 0);
  return { entry, lines, balance: Math.round(balance * 100) / 100 };
}

async function cleanup() {
  const errors = [];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    if (disbursementIds.length) {
      await client.query(
        "delete from bank_disbursement_items where disbursement_id = any($1::int[])",
        [disbursementIds],
      );
      await client.query(
        "delete from bank_disbursements where id = any($1::int[])",
        [disbursementIds],
      );
    }

    if (invoiceIds.length) {
      await client.query(
        "delete from vendor_withholding_records where vendor_invoice_id = any($1::int[])",
        [invoiceIds],
      ).catch(() => {});
      await client.query(
        `delete from vendor_invoice_line_taxes
          where invoice_line_id in
            (select id from vendor_invoice_lines where invoice_id = any($1::int[]))`,
        [invoiceIds],
      ).catch(() => {});
      await client.query(
        "delete from vendor_invoice_lines where invoice_id = any($1::int[])",
        [invoiceIds],
      );
    }

    if (expenseIds.length) {
      await client.query(
        "delete from transaction_taxes where transaction_id = any($1::int[])",
        [expenseIds],
      ).catch(() => {});
      await client.query(
        "delete from expense_lines where expense_id = any($1::int[])",
        [expenseIds],
      );
    }

    if (processedKeys.length) {
      await client.query(
        "delete from processed_requests where namespace = 'expense:create' and idempotency_key = any($1::text[])",
        [processedKeys],
      ).catch(() => {});
    }

    if (invoiceIds.length) {
      await client.query(
        "update vendor_invoices set journal_entry_id = null where id = any($1::int[])",
        [invoiceIds],
      ).catch(() => {});
      await client.query(
        "delete from vendor_invoices where id = any($1::int[])",
        [invoiceIds],
      );
    }

    if (expenseIds.length) {
      await client.query(
        "update expenses set entry_id = null, disbursement_id = null where id = any($1::int[])",
        [expenseIds],
      ).catch(() => {});
      await client.query(
        "delete from expenses where id = any($1::int[])",
        [expenseIds],
      );
    }

    if (entryIds.length) {
      // Posted entries are intentionally immutable. This is a scoped,
      // development-only proof cleanup; restore every trigger before commit.
      await client.query("alter table fleet_ledger_entries disable trigger trg_fleet_ledger_immutable").catch(() => {});
      await client.query("alter table accounting_entry_lines disable trigger trg_block_lines_mutation").catch(() => {});
      await client.query("alter table accounting_entry_lines disable trigger trg_block_lines_delete").catch(() => {});
      await client.query("alter table accounting_entry_lines disable trigger trg_block_lines_update").catch(() => {});
      await client.query("alter table accounting_entry_lines disable trigger trg_entry_line_to_ledger").catch(() => {});
      await client.query("alter table accounting_entry_lines disable trigger trg_sync_entry_line_to_ledger").catch(() => {});
      await client.query("alter table accounting_entries disable trigger trg_block_posted_delete").catch(() => {});
      await client.query("alter table accounting_entries disable trigger trg_block_posted_update").catch(() => {});
      await client.query("alter table accounting_entries disable trigger trg_check_period_locked_entries").catch(() => {});
      await client.query(
        `delete from fleet_ledger_entries fle
          using accounting_entries ae
         where ae.id = any($1::int[])
           and fle.source_type = ae.source::text
           and fle.source_id = ae.source_id`,
        [entryIds],
      );
      await client.query(
        "delete from accounting_entry_lines where entry_id = any($1::int[])",
        [entryIds],
      );
      await client.query(
        "delete from accounting_entries where id = any($1::int[])",
        [entryIds],
      );
      await client.query("alter table fleet_ledger_entries enable trigger trg_fleet_ledger_immutable").catch(() => {});
      await client.query("alter table accounting_entry_lines enable trigger trg_block_lines_mutation").catch(() => {});
      await client.query("alter table accounting_entry_lines enable trigger trg_block_lines_delete").catch(() => {});
      await client.query("alter table accounting_entry_lines enable trigger trg_block_lines_update").catch(() => {});
      await client.query("alter table accounting_entry_lines enable trigger trg_entry_line_to_ledger").catch(() => {});
      await client.query("alter table accounting_entry_lines enable trigger trg_sync_entry_line_to_ledger").catch(() => {});
      await client.query("alter table accounting_entries enable trigger trg_block_posted_delete").catch(() => {});
      await client.query("alter table accounting_entries enable trigger trg_block_posted_update").catch(() => {});
      await client.query("alter table accounting_entries enable trigger trg_check_period_locked_entries").catch(() => {});
    }

    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    client.release();
  }

  const leftovers = {
    expenses: expenseIds.length
      ? Number((await one("select count(*)::int as count from expenses where id = any($1::int[])", [expenseIds]))?.count || 0)
      : 0,
    expenseLines: expenseIds.length
      ? Number((await one("select count(*)::int as count from expense_lines where expense_id = any($1::int[])", [expenseIds]))?.count || 0)
      : 0,
    invoices: invoiceIds.length
      ? Number((await one("select count(*)::int as count from vendor_invoices where id = any($1::int[])", [invoiceIds]))?.count || 0)
      : 0,
    disbursements: disbursementIds.length
      ? Number((await one("select count(*)::int as count from bank_disbursements where id = any($1::int[])", [disbursementIds]))?.count || 0)
      : 0,
    entries: entryIds.length
      ? Number((await one("select count(*)::int as count from accounting_entries where id = any($1::int[])", [entryIds]))?.count || 0)
      : 0,
    processedRequests: processedKeys.length
      ? Number((await one("select count(*)::int as count from processed_requests where namespace = 'expense:create' and idempotency_key = any($1::text[])", [processedKeys]))?.count || 0)
      : 0,
  };
  const clean = Object.values(leftovers).every((value) => value === 0) && errors.length === 0;
  steps.push({ name: "marker cleanup", pass: clean, detail: JSON.stringify({ errors, leftovers }) });
  return { clean, errors, leftovers };
}

async function run() {
  const safety = await fetch(`${API}/health/e2e-safety`).then(async (response) => ({
    status: response.status,
    body: await response.json(),
  }));
  record(
    "development safe mode",
    safety.status === 200 && safety.body.e2eMode === true &&
      safety.body.email === "mocked" &&
      safety.body.payment === "mocked" &&
      safety.body.webhooks === "disabled" &&
      safety.body.workers === "disabled",
    message(safety.body),
  );

  const readiness = await fetch(`${API}/health/ready`).then(async (response) => ({
    status: response.status,
    body: await response.json(),
  }));
  record("development readiness", readiness.status === 200 && readiness.body.ready === true, message(readiness.body));

  const fixtures = {
    company: await one("select id, name from companies where id = 1"),
    category: await one(
      `select id, expense_account_id, ppn_input_account_id
         from expense_categories
        where company_id = 1 and is_active = true and expense_account_id is not null
        order by id limit 1`,
    ),
    expenseAccounts: await query(
      `select id, company_id, code, name
         from chart_of_accounts
        where company_id = 1 and type = 'expense' and is_active = true
          and is_postable = true and status = 'ACTIVE'
        order by id limit 3`,
    ),
    source: await one(
      `select id, company_id, code, name
         from chart_of_accounts
        where company_id = 1 and type = 'asset' and is_active = true
          and is_postable = true and status = 'ACTIVE'
        order by id limit 1`,
    ),
    otherExpense: await one(
      `select id, company_id, code, name
         from chart_of_accounts
        where company_id <> 1 and type = 'expense' and is_active = true
          and is_postable = true and status = 'ACTIVE'
        order by id limit 1`,
    ),
    otherSource: await one(
      `select id, company_id, code, name
         from chart_of_accounts
        where company_id <> 1 and type = 'asset' and is_active = true
          and is_postable = true and status = 'ACTIVE'
        order by id limit 1`,
    ),
    taxPpn: await one(
      "select id, rate, kind from accounting_taxes where company_id = 1 and kind = 'purchase' and is_active = true order by id limit 1",
    ),
    taxPph: await one(
      "select id, rate, kind from accounting_taxes where company_id = 1 and kind = 'withholding' and is_active = true order by id limit 1",
    ),
    vendor: await one(
      "select id, company_id, name from suppliers where company_id = 1 and status = 'active' order by id limit 1",
    ),
    otherVendor: await one(
      "select id, company_id, name from suppliers where company_id <> 1 order by id limit 1",
    ),
    bankJournal: await one(
      "select id, code, type, default_credit_account_id from accounting_journals where company_id = 1 and type = 'bank' order by id limit 1",
    ),
    admin: await one("select email from users where role = 'admin' and email is not null order by email limit 1"),
    ap: await one("select ap_account_id from accounting_settings where company_id = 1"),
    withholding: await one(
      `select id, company_id, code, name
         from chart_of_accounts
        where company_id = 1 and type = 'liability' and is_active = true
          and is_postable = true and status = 'ACTIVE'
        order by id limit 1`,
    ),
  };
  record("development fixture completeness",
    Boolean(
      fixtures.company && fixtures.category && fixtures.expenseAccounts.length >= 2 &&
      fixtures.source && fixtures.otherExpense && fixtures.otherSource &&
      fixtures.taxPpn && fixtures.taxPph && fixtures.vendor && fixtures.otherVendor &&
      fixtures.bankJournal && fixtures.admin && fixtures.ap?.ap_account_id && fixtures.withholding,
    ),
    "company=1, scoped COA, tax, vendor, journal, and AP fixtures",
  );

  const login = await request("/auth/dev-login", {
    method: "POST",
    body: { email: fixtures.admin.email },
  });
  record("admin authentication", login.status === 200 && jar.size > 0, message(login.body));

  const common = {
    date: "2026-09-05",
    companyId: 1,
    categoryId: Number(fixtures.category.id),
    expenseAccountId: Number(fixtures.expenseAccounts[0].id),
    sourceAccountId: Number(fixtures.source.id),
    expenseType: "vendor_bill",
    transactionType: "expense",
    currency: "IDR",
  };

  const single = await createExpense(`${marker}:single`, {
    ...common,
    description: `${marker} single direct expense`,
    qty: 1,
    unitPrice: 100000,
  });
  const singleEntry = await loadEntry(Number(single.body.entryId));
  entryIds.push(Number(single.body.entryId));
  evidence.single = {
    expenseId: Number(single.body.id),
    journalEntryId: Number(single.body.entryId),
    companyId: single.body.companyId,
    sourceAccountId: single.body.sourceAccountId,
    lines: singleEntry.lines,
    balance: singleEntry.balance,
  };
  record(
    "direct expense one line",
    single.body.status === "active" &&
      Number(single.body.companyId) === 1 &&
      Number(single.body.sourceAccountId) === Number(fixtures.source.id) &&
      singleEntry.lines.length === 2 &&
      singleEntry.lines.filter((line) => Number(line.debit) > 0).length === 1 &&
      singleEntry.lines.filter((line) => Number(line.credit) > 0).length === 1 &&
      singleEntry.balance === 0,
    JSON.stringify(evidence.single),
  );

  const multi = await createExpense(`${marker}:multi`, {
    ...common,
    description: `${marker} OCR multi line`,
    qty: 1,
    unitPrice: 50000,
    lines: [
      { description: `${marker} OCR line 1`, qty: 1, unit: "pcs", unitPrice: 50000, coaAccountId: Number(fixtures.expenseAccounts[0].id) },
      { description: `${marker} OCR line 2`, qty: 2, unit: "pcs", unitPrice: 25000, coaAccountId: Number(fixtures.expenseAccounts[1].id) },
    ],
  });
  const multiEntry = await loadEntry(Number(multi.body.entryId));
  entryIds.push(Number(multi.body.entryId));
  const multiLines = await query(
    "select coa_account_id, subtotal, total from expense_lines where expense_id = $1 order by line_no",
    [Number(multi.body.id)],
  );
  evidence.multi = {
    expenseId: Number(multi.body.id),
    journalEntryId: Number(multi.body.entryId),
    companyId: multi.body.companyId,
    sourceAccountId: multi.body.sourceAccountId,
    expenseLines: multiLines,
    journalLines: multiEntry.lines,
    balance: multiEntry.balance,
  };
  record(
    "direct expense multi line",
    multiLines.length === 2 &&
      multiLines.every((line) => Number(line.coa_account_id) === Number(fixtures.expenseAccounts[0].id) || Number(line.coa_account_id) === Number(fixtures.expenseAccounts[1].id)) &&
      multiEntry.lines.length === 3 &&
      multiEntry.balance === 0,
    JSON.stringify(evidence.multi),
  );

  const retryKey = `${marker}:retry`;
  const retryBody = {
    ...common,
    description: `${marker} idempotent retry`,
    qty: 1,
    unitPrice: 77000,
  };
  const retryFirst = await createExpense(retryKey, retryBody);
  const retrySecond = await request("/expenses", {
    method: "POST",
    headers: { "x-idempotency-key": retryKey },
    body: { ...retryBody, description: `${marker} changed on retry`, unitPrice: 88000 },
  });
  let retryReplay = retrySecond;
  if (retrySecond.status === 409) {
    // The first response records its replay body asynchronously. A rapid
    // double-click may correctly receive the in-flight 409; verify that the
    // same key becomes replayable without creating another row.
    for (let attempt = 0; attempt < 10 && retryReplay.status === 409; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      retryReplay = await request("/expenses", {
        method: "POST",
        headers: { "x-idempotency-key": retryKey },
        body: { ...retryBody, description: `${marker} changed on replay`, unitPrice: 88000 },
      });
    }
  }
  const retryRows = await query(
    "select id, entry_id, company_id from expenses where id = $1 or description = $2",
    [Number(retryFirst.body.id), retryBody.description],
  );
  record(
    "retry double-click idempotency",
    (retrySecond.status === 201 || retrySecond.status === 409) &&
      retryReplay.status === 201 &&
      Number(retryReplay.body.id) === Number(retryFirst.body.id) &&
      retryRows.length === 1,
    `first=${retryFirst.body.id}, second=${retrySecond.status}, replay=${retryReplay.status}:${retryReplay.body?.id}, rows=${retryRows.length}`,
  );

  const ppn = await createExpense(`${marker}:ppn`, {
    ...common,
    description: `${marker} PPN direct expense`,
    qty: 1,
    unitPrice: 100000,
    taxRateId: Number(fixtures.taxPpn.id),
  });
  const ppnEntry = await loadEntry(Number(ppn.body.entryId));
  entryIds.push(Number(ppn.body.entryId));
  const ppnTaxRows = await query(
    "select id, transaction_type, transaction_id, tax_amount from transaction_taxes where transaction_id = $1",
    [Number(ppn.body.id)],
  ).catch(() => []);
  evidence.ppn = {
    expenseId: Number(ppn.body.id),
    journalEntryId: Number(ppn.body.entryId),
    companyId: ppn.body.companyId,
    sourceAccountId: ppn.body.sourceAccountId,
    journalLines: ppnEntry.lines,
    taxRows: ppnTaxRows,
    balance: ppnEntry.balance,
  };
  record(
    "PPN single-post",
    ppn.body.status === "active" &&
      ppnEntry.balance === 0 &&
      ppnEntry.lines.filter((line) => String(line.description).includes("PPN Masukan")).length === 1 &&
      ppnTaxRows.length <= 1,
    JSON.stringify(evidence.ppn),
  );

  const pph = await request("/expenses", {
    method: "POST",
    headers: { "x-idempotency-key": `${marker}:pph-reject` },
    body: {
      ...common,
      description: `${marker} PPh direct reject`,
      qty: 1,
      unitPrice: 100000,
      taxRateId: Number(fixtures.taxPph.id),
    },
  });
  processedKeys.push(`${marker}:pph-reject`);
  await expectStatus("PPh direct expense rejected", pph, [400]);

  const payable = await request("/expenses", {
    method: "POST",
    headers: { "x-idempotency-key": `${marker}:payable-reject` },
    body: {
      ...common,
      description: `${marker} payable direct reject`,
      qty: 1,
      unitPrice: 100000,
      payableAccountId: Number(fixtures.ap.ap_account_id),
    },
  });
  processedKeys.push(`${marker}:payable-reject`);
  await expectStatus("posted AP cannot become direct expense", payable, [400]);

  const crossExpense = await request("/expenses", {
    method: "POST",
    headers: { "x-idempotency-key": `${marker}:cross-expense` },
    body: { ...common, description: `${marker} cross company COA`, expenseAccountId: Number(fixtures.otherExpense.id), qty: 1, unitPrice: 10000 },
  });
  processedKeys.push(`${marker}:cross-expense`);
  await expectStatus("cross-company expense COA rejected", crossExpense, [400]);

  const crossSource = await request("/expenses", {
    method: "POST",
    headers: { "x-idempotency-key": `${marker}:cross-source` },
    body: { ...common, description: `${marker} cross company source`, sourceAccountId: Number(fixtures.otherSource.id), qty: 1, unitPrice: 10000 },
  });
  processedKeys.push(`${marker}:cross-source`);
  await expectStatus("cross-company source account rejected", crossSource, [400]);

  const crossVendor = await request("/expenses", {
    method: "POST",
    headers: { "x-idempotency-key": `${marker}:cross-vendor` },
    body: { ...common, description: `${marker} cross company vendor`, vendorId: Number(fixtures.otherVendor.id), qty: 1, unitPrice: 10000 },
  });
  processedKeys.push(`${marker}:cross-vendor`);
  await expectStatus("cross-company vendor rejected", crossVendor, [400, 403]);

  const invoice = await request("/purchase-workflow/vendor-invoices", {
    method: "POST",
    body: {
      vendorInvoiceRef: `${marker}-INV`,
      companyId: 1,
      supplierId: Number(fixtures.vendor.id),
      supplierName: fixtures.vendor.name,
      invoiceDate: "2026-09-05",
      dueDate: "2026-10-05",
      lines: [{
        name: `${marker} service`,
        quantity: 1,
        unit: "service",
        unitCost: 200000,
        taxAmount: 0,
        coaAccountId: Number(fixtures.expenseAccounts[0].id),
      }],
    },
  });
  record("vendor invoice fixture created", invoice.status === 200 && Number(invoice.body?.id) > 0, message(invoice.body));
  const invoiceId = Number(invoice.body.id);
  invoiceIds.push(invoiceId);
  const invoiceLines = await query(
    "select id from vendor_invoice_lines where invoice_id = $1 order by id",
    [invoiceId],
  );
  const review = await request(`/purchase-workflow/vendor-invoices/${invoiceId}/finance-review`, {
    method: "PUT",
    body: { lines: [{ lineId: Number(invoiceLines[0].id), coaAccountId: Number(fixtures.expenseAccounts[0].id) }] },
  });
  record("vendor invoice COA reviewed", review.status === 200 && review.body?.ok === true, message(review.body));
  const posted = await request(`/purchase-workflow/vendor-invoices/${invoiceId}/post`, { method: "POST", body: {} });
  record("vendor invoice posted AP", posted.status === 200 && posted.body?.status === "posted", message(posted.body));
  const postedInvoice = await one(
    "select id, company_id, status, grand_total, journal_entry_id from vendor_invoices where id = $1",
    [invoiceId],
  );
  if (Number(postedInvoice?.journal_entry_id)) entryIds.push(Number(postedInvoice.journal_entry_id));
  const apEntry = postedInvoice?.journal_entry_id ? await loadEntry(Number(postedInvoice.journal_entry_id)) : null;
  evidence.vendorInvoice = {
    invoiceId,
    companyId: postedInvoice?.company_id,
    status: postedInvoice?.status,
    journalEntryId: postedInvoice?.journal_entry_id,
    journalLines: apEntry?.lines || [],
    balance: apEntry?.balance ?? null,
  };
  record(
    "posted vendor invoice is AP, not direct expense",
    postedInvoice?.status === "posted" &&
      apEntry?.balance === 0 &&
      apEntry.lines.some((line) => Number(line.account_id) === Number(fixtures.ap.ap_account_id) && Number(line.credit) > 0),
    JSON.stringify(evidence.vendorInvoice),
  );

  const disbursement = await request("/accounting/bank-disbursements", {
    method: "POST",
    body: {
      journalId: Number(fixtures.bankJournal.id),
      companyId: 1,
      date: "2026-09-05",
      ref: `${marker}-PAY`,
      memo: `${marker} vendor payment`,
      paymentType: "vendor_invoice",
      invoicePayments: [{ vendorInvoiceId: invoiceId, paymentAmount: 200000, whtAmount: 0 }],
    },
  });
  record("vendor invoice payment created", disbursement.status === 201, message(disbursement.body));
  const disbursementId = Number(disbursement.body?.disbursementId || disbursement.body?.id);
  const paymentEntryId = Number(disbursement.body?.entryId);
  if (disbursementId) disbursementIds.push(disbursementId);
  if (paymentEntryId) entryIds.push(paymentEntryId);
  const paymentLines = paymentEntryId ? await loadEntry(paymentEntryId) : null;
  evidence.vendorPayment = {
    invoiceId,
    disbursementId,
    journalEntryId: paymentEntryId,
    companyId: await one("select company_id from bank_disbursements where id = $1", [disbursementId]).then((row) => row?.company_id),
    journalLines: paymentLines?.lines || [],
    balance: paymentLines?.balance ?? null,
  };
  record(
    "vendor payment debits AP",
    disbursement.status === 201 &&
      paymentLines?.balance === 0 &&
      paymentLines.lines.some((line) => Number(line.account_id) === Number(fixtures.ap.ap_account_id) && Number(line.debit) > 0) &&
      !paymentLines.lines.some((line) => Number(line.account_id) === Number(fixtures.expenseAccounts[0].id) && Number(line.debit) > 0),
    JSON.stringify(evidence.vendorPayment),
  );

  const directPayAttempt = await request(`/expenses/${single.body.id}/pay`, {
    method: "POST",
    body: { bankAccountId: Number(fixtures.source.id), date: "2026-09-05", memo: `${marker} forbidden direct re-pay` },
  });
  await expectStatus("direct expense cannot be paid again as AP", directPayAttempt, [400, 409]);

  // A second post attempt must not create a second AP journal.
  const repost = await request(`/purchase-workflow/vendor-invoices/${invoiceId}/post`, { method: "POST", body: {} });
  await expectStatus("posted vendor invoice cannot be posted twice", repost, [400]);
  const invoiceEntryCount = await one(
    "select count(*)::int as count from accounting_entries where source = 'purchase_bill' and source_id = $1",
    [invoiceId],
  );
  record("vendor invoice no duplicate journal", Number(invoiceEntryCount?.count) === 1, `count=${invoiceEntryCount?.count}`);

  return { marker, steps, evidence };
}

let result;
let runError = null;
try {
  result = await run();
} catch (error) {
  runError = error instanceof Error ? error.message : String(error);
}

let cleanupResult;
try {
  cleanupResult = await cleanup();
} catch (error) {
  cleanupResult = { clean: false, errors: [error instanceof Error ? error.message : String(error)] };
}

await pool.end();

console.log(JSON.stringify({
  ok: !runError && cleanupResult.clean,
  runError,
  cleanup: cleanupResult,
  steps,
  evidence,
}, null, 2));

if (runError || !cleanupResult.clean || steps.some((step) => !step.pass)) process.exitCode = 1;