/**
 * Authenticated development proof for:
 *   1. Google Sheet -> bank_mutations sync idempotency
 *   2. Mutasi Kas & Bank UI API visibility
 *   3. Sport Center paid payment -> posted accounting entry
 *   4. posting rerun idempotency
 *
 * This is intentionally an HTTP-only harness. It uses the same official
 * dev-login flow and session cookie as the application, so it does not bypass
 * authentication or query the database out-of-band.
 *
 * Run:
 *   APP_ENV=development node artifacts/api-server/load-secrets.mjs \
 *     node scripts/authenticated-sport-center-e2e.mjs
 *
 * Optional:
 *   API_BASE_URL=http://127.0.0.1:18444
 *   COMPANY_ID=123
 *   SHEET_CONFIG_ID=123
 *   SPORT_PAYMENT_ID=123
 */

import {
  apiRequest,
  assertDevelopmentHarness,
  devLogin,
  waitForApiReady,
} from "./regression-harness-helpers.mjs";

const EXPECTED_SHEET_ROWS = process.env.EXPECTED_SHEET_ROWS
  ? Number(process.env.EXPECTED_SHEET_ROWS)
  : null;
const EXPECTED_SHEET_TOTAL = process.env.EXPECTED_SHEET_TOTAL
  ? Number(process.env.EXPECTED_SHEET_TOTAL)
  : null;
const COMPANY_ID_OVERRIDE = process.env.COMPANY_ID
  ? Number(process.env.COMPANY_ID)
  : null;
const SHEET_CONFIG_ID_OVERRIDE = process.env.SHEET_CONFIG_ID
  ? Number(process.env.SHEET_CONFIG_ID)
  : null;
const SPORT_PAYMENT_ID_OVERRIDE = process.env.SPORT_PAYMENT_ID
  ? Number(process.env.SPORT_PAYMENT_ID)
  : null;

function fail(message, details) {
  const suffix = details === undefined ? "" : ` ${JSON.stringify(details)}`;
  throw new Error(`${message}${suffix}`);
}

function assertOk(response, label) {
  if (response.status < 200 || response.status >= 300) {
    fail(`${label} failed: HTTP ${response.status}`, response.body);
  }
  return response.body ?? {};
}

function asRows(body, ...keys) {
  for (const key of keys) {
    if (Array.isArray(body?.[key])) return body[key];
  }
  return Array.isArray(body) ? body : [];
}

function numberValue(value) {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function rounded(value) {
  return Math.round(numberValue(value) * 100) / 100;
}

function sameNumber(left, right, tolerance = 0.01) {
  return Math.abs(numberValue(left) - numberValue(right)) <= tolerance;
}

function uniqueValues(rows, key) {
  return new Set(rows.map((row) => row?.[key]).filter((value) => value != null));
}

function compactResponse(body) {
  if (!body || typeof body !== "object") return body;
  const allowed = [
    "ok",
    "imported",
    "total",
    "parsed",
    "existing",
    "accountingPaymentId",
    "accountingEntryId",
    "alreadyPosted",
    "error",
    "summary",
    "results",
  ];
  return Object.fromEntries(
    allowed
      .filter((key) => Object.prototype.hasOwnProperty.call(body, key))
      .map((key) => [key, body[key]]),
  );
}

async function main() {
  assertDevelopmentHarness({ requireDatabase: true });
  const readiness = await waitForApiReady();
  const login = await devLogin({ email: process.env.DEV_ADMIN_EMAIL });
  const checks = [];

  const auth = assertOk(
    await apiRequest("/api/auth/user", { cookie: login.cookie }),
    "authenticated user check",
  );
  const authenticatedUser = auth.user ?? auth;
  if (authenticatedUser?.role !== "admin") {
    fail("Authenticated development user is not an admin", {
      role: authenticatedUser?.role,
    });
  }
  checks.push({
    name: "official dev login + /api/auth/user",
    passed: true,
    detail: { email: login.email, role: authenticatedUser.role },
  });

  const companiesBody = assertOk(
    await apiRequest("/api/companies/list", { cookie: login.cookie }),
    "company discovery",
  );
  const companies = asRows(companiesBody, "companies", "data");
  const companyId =
    COMPANY_ID_OVERRIDE ??
    Number(authenticatedUser.companyId ?? companies[0]?.id ?? 0);
  if (!Number.isInteger(companyId) || companyId <= 0) {
    fail("No active company was found; set COMPANY_ID explicitly", {
      userCompanyId: authenticatedUser.companyId ?? null,
      companyCount: companies.length,
    });
  }
  checks.push({
    name: "active company discovered",
    passed: true,
    detail: { companyId },
  });

  const configsBody = assertOk(
    await apiRequest("/api/bank-reconciliation/sheet-configs", {
      cookie: login.cookie,
    }),
    "sheet config discovery",
  );
  const configs = asRows(configsBody, "configs");
  const config =
    configs.find(
      (candidate) =>
        Number(candidate?.id) === SHEET_CONFIG_ID_OVERRIDE,
    ) ??
    configs.find(
      (candidate) =>
        candidate?.is_active !== false &&
        (candidate?.company_id == null ||
          Number(candidate.company_id) === companyId),
    );
  if (!config) {
    fail("No active Google Sheet config found for the active company", {
      companyId,
      configCount: configs.length,
    });
  }
  const configId = Number(config.id);

  const diagnosis = assertOk(
    await apiRequest(
      `/api/bank-reconciliation/sheet-configs/${configId}/diagnose`,
      { cookie: login.cookie },
    ),
    "Google Sheet diagnosis",
  );
  const sheetSourceRows = Number(diagnosis.totalRows);
  const parsedSheetRows = Number(diagnosis.parsedOk);
  if (!Number.isInteger(sheetSourceRows) || sheetSourceRows < 0) {
    fail("Google Sheet diagnosis did not return a valid source row count", {
      totalRows: diagnosis.totalRows ?? null,
    });
  }
  if (EXPECTED_SHEET_ROWS != null && sheetSourceRows !== EXPECTED_SHEET_ROWS) {
    fail("Google Sheet row count does not match expected proof count", {
      expected: EXPECTED_SHEET_ROWS,
      actual: sheetSourceRows,
      parsedOk: parsedSheetRows,
      skippedCount: diagnosis.skippedCount ?? null,
    });
  }
  if (parsedSheetRows !== sheetSourceRows) {
    fail("Google Sheet contains rows that the parser skipped", {
      expectedParsed: sheetSourceRows,
      parsedOk: parsedSheetRows,
      skippedCount: diagnosis.skippedCount ?? null,
      skippedSample: diagnosis.skippedSample ?? [],
    });
  }
  checks.push({
    name: "Google Sheet diagnosis",
    passed: true,
    detail: {
      configId,
      totalRows: sheetSourceRows,
      parsedOk: parsedSheetRows,
      skippedCount: Number(diagnosis.skippedCount ?? 0),
      existingInDbBeforeSync: Number(diagnosis.existingInDb ?? 0),
    },
  });

  const sync1 = assertOk(
    await apiRequest(
      `/api/bank-reconciliation/sheet-configs/${configId}/sync`,
      { method: "POST", cookie: login.cookie },
    ),
    "first Google Sheet sync",
  );
  const sync2 = assertOk(
    await apiRequest(
      `/api/bank-reconciliation/sheet-configs/${configId}/sync`,
      { method: "POST", cookie: login.cookie },
    ),
    "second Google Sheet sync",
  );
  if (Number(sync1.total) !== sheetSourceRows || Number(sync2.total) !== sheetSourceRows) {
    fail("Sync response total does not match the Google Sheet row count", {
      expected: sheetSourceRows,
      first: compactResponse(sync1),
      second: compactResponse(sync2),
    });
  }
  if (Number(sync2.imported ?? 0) !== 0) {
    fail("Second Google Sheet sync imported new rows; deduplication failed", {
      secondSync: compactResponse(sync2),
    });
  }
  checks.push({
    name: "Google Sheet sync rerun idempotency",
    passed: true,
    detail: {
      firstSync: compactResponse(sync1),
      secondSync: compactResponse(sync2),
    },
  });

  const bankMutationsBody = assertOk(
    await apiRequest(
      `/api/bank-reconciliation/mutations?companyId=${companyId}&limit=500&offset=0`,
      { cookie: login.cookie },
    ),
    "bank mutation listing",
  );
  const bankMutations = asRows(bankMutationsBody, "mutations", "data");
  // The listing endpoint is company-scoped and intentionally omits
  // sheet_config_id. The sheet diagnostic provides the config-scoped
  // persisted baseline; compare the company listing against it instead of
  // filtering on a field the endpoint does not return.
  const persistedRowsBeforeSync = Number(diagnosis.existingInDb ?? 0);
  const mutationKeys = uniqueValues(bankMutations, "mutation_key");
  const persistedTotal = Number(bankMutationsBody.total ?? bankMutations.length);
  const persistedAmountTotal = bankMutations.reduce(
    (sum, row) => sum + numberValue(row?.amount),
    0,
  );
  if (bankMutations.length !== persistedRowsBeforeSync || persistedTotal !== persistedRowsBeforeSync) {
    fail("bank_mutations persisted count does not match the Sheet config baseline", {
      expectedPersistedRows: persistedRowsBeforeSync,
      actualReturned: bankMutations.length,
      endpointTotal: persistedTotal,
      configId,
    });
  }
  if (mutationKeys.size !== bankMutations.length) {
    fail("bank_mutations contains duplicate mutation_key values", {
      rows: bankMutations.length,
      uniqueKeys: mutationKeys.size,
    });
  }
  if (EXPECTED_SHEET_TOTAL != null && !sameNumber(persistedAmountTotal, EXPECTED_SHEET_TOTAL)) {
    fail("Sheet nominal total does not match EXPECTED_SHEET_TOTAL", {
      expected: EXPECTED_SHEET_TOTAL,
      actual: rounded(persistedAmountTotal),
    });
  }
  checks.push({
    name: "bank_mutations count, total, and key uniqueness",
    passed: true,
    detail: {
      configId,
      sourceRows: sheetSourceRows,
      persistedRows: bankMutations.length,
      uniqueMutationKeys: mutationKeys.size,
      amountTotal: rounded(persistedAmountTotal),
      endpointTotal: persistedTotal,
    },
  });

  const accountsBody = assertOk(
    await apiRequest(`/api/cash-bank/accounts?companyId=${companyId}`, {
      cookie: login.cookie,
    }),
    "cash-bank account listing",
  );
  const cashBankMutationsBody = assertOk(
    await apiRequest(
      `/api/cash-bank/mutations?companyId=${companyId}&limit=100&page=1`,
      { cookie: login.cookie },
    ),
    "Mutasi Kas & Bank listing",
  );
  const cashBankRows = asRows(cashBankMutationsBody, "data");
  const accounts = asRows(accountsBody, "data");
  const cashBankDebit = cashBankRows.reduce(
    (sum, row) => sum + numberValue(row?.debit),
    0,
  );
  const cashBankCredit = cashBankRows.reduce(
    (sum, row) => sum + numberValue(row?.credit),
    0,
  );
  checks.push({
    name: "Mutasi Kas & Bank UI API",
    passed: true,
    detail: {
      companyId,
      rowsReturned: cashBankRows.length,
      total: Number(cashBankMutationsBody.total ?? cashBankRows.length),
      activeAccounts: accounts.filter((account) => account?.is_active !== false).length,
      debitTotal: rounded(cashBankDebit),
      creditTotal: rounded(cashBankCredit),
      note:
        "Halaman Mutasi Kas & Bank membaca posted accounting_entry_lines; " +
        "bank_mutations dihitung terpisah di check sebelumnya.",
    },
  });

  const monitorBefore = assertOk(
    await apiRequest(
      `/api/accounting/posting-monitor?module=sport_center&companyId=${companyId}&limit=500`,
      { cookie: login.cookie },
    ),
    "Sport Center posting monitor",
  );
  const sportRows = asRows(monitorBefore, "rows").filter(
    (row) => row?.module === "sport_center",
  );
  const selectedSportPayment =
    sportRows.find(
      (row) =>
        Number(row?.source_id) === SPORT_PAYMENT_ID_OVERRIDE &&
        row?.payment_status === "paid" &&
        row?.posting_status !== "posted",
    ) ??
    sportRows.find(
      (row) =>
        row?.payment_status === "paid" &&
        row?.posting_status !== "posted",
    );
  if (!selectedSportPayment) {
    fail("No paid and unposted Sport Center payment found", {
      requestedPaymentId: SPORT_PAYMENT_ID_OVERRIDE,
      monitorSummary: monitorBefore.summary ?? null,
    });
  }
  const sportPaymentId = Number(selectedSportPayment.source_id);
  const sportPaymentDate = String(
    selectedSportPayment.paid_at ??
      selectedSportPayment.created_at ??
      new Date().toISOString(),
  ).slice(0, 10);
  const post1 = assertOk(
    await apiRequest("/api/accounting/posting-monitor/post", {
      method: "POST",
      cookie: login.cookie,
      body: {
        moduleType: "sport_center",
        sourceDocId: sportPaymentId,
        companyId,
        date: sportPaymentDate,
      },
    }),
    "Sport Center first posting",
  );
  if (post1.ok !== true || !post1.accountingPaymentId || !post1.accountingEntryId) {
    fail("Sport Center posting did not return a valid accounting link", {
      paymentId: sportPaymentId,
      result: compactResponse(post1),
    });
  }

  const monitorAfter = assertOk(
    await apiRequest(
      `/api/accounting/posting-monitor?module=sport_center&companyId=${companyId}&limit=500`,
      { cookie: login.cookie },
    ),
    "Sport Center posting monitor after first post",
  );
  const postedRow = asRows(monitorAfter, "rows").find(
    (row) => Number(row?.source_id) === sportPaymentId,
  );
  if (
    !postedRow ||
    postedRow.payment_status !== "paid" ||
    postedRow.posting_status !== "posted" ||
    Number(postedRow.accounting_payment_id) !== Number(post1.accountingPaymentId)
  ) {
    fail("Sport Center payment was not visibly posted and linked", {
      paymentId: sportPaymentId,
      row: postedRow ?? null,
      firstPost: compactResponse(post1),
    });
  }

  const accountingPayment = assertOk(
    await apiRequest(
      `/api/accounting/payments/${Number(post1.accountingPaymentId)}?companyId=${companyId}`,
      { cookie: login.cookie },
    ),
    "accounting payment detail",
  );
  if (
    accountingPayment.sourceType !== "sport_center" ||
    Number(accountingPayment.sourceDocId) !== sportPaymentId ||
    Number(accountingPayment.entryId) !== Number(post1.accountingEntryId)
  ) {
    fail("Accounting payment does not point back to the Sport Center source and entry", {
      sourcePaymentId: sportPaymentId,
      accountingPayment: {
        id: accountingPayment.id ?? null,
        sourceType: accountingPayment.sourceType ?? null,
        sourceDocId: accountingPayment.sourceDocId ?? null,
        entryId: accountingPayment.entryId ?? null,
      },
    });
  }

  const accountingEntry = assertOk(
    await apiRequest(
      `/api/accounting/entries/${Number(post1.accountingEntryId)}?companyId=${companyId}`,
      { cookie: login.cookie },
    ),
    "accounting entry detail",
  );
  const entryLines = asRows(accountingEntry, "lines");
  const lineDebit = entryLines.reduce(
    (sum, line) => sum + numberValue(line?.debit),
    0,
  );
  const lineCredit = entryLines.reduce(
    (sum, line) => sum + numberValue(line?.credit),
    0,
  );
  if (
    accountingEntry.status !== "posted" ||
    entryLines.length < 2 ||
    !sameNumber(accountingEntry.totalDebit, accountingEntry.totalCredit) ||
    !sameNumber(lineDebit, lineCredit) ||
    !sameNumber(lineDebit, accountingEntry.totalDebit)
  ) {
    fail("Accounting entry is not a balanced posted journal", {
      entryId: post1.accountingEntryId,
      status: accountingEntry.status ?? null,
      header: {
        totalDebit: accountingEntry.totalDebit ?? null,
        totalCredit: accountingEntry.totalCredit ?? null,
      },
      lines: {
        count: entryLines.length,
        debit: rounded(lineDebit),
        credit: rounded(lineCredit),
      },
    });
  }
  checks.push({
    name: "Sport Center payment, accounting payment, and balanced journal",
    passed: true,
    detail: {
      sourcePaymentId: sportPaymentId,
      accountingPaymentId: Number(post1.accountingPaymentId),
      accountingEntryId: Number(post1.accountingEntryId),
      postingStatus: postedRow.posting_status,
      accountingPaymentSource: accountingPayment.sourceType,
      accountingPaymentSourceDocId: Number(accountingPayment.sourceDocId),
      entryStatus: accountingEntry.status,
      entryLineCount: entryLines.length,
      debitTotal: rounded(lineDebit),
      creditTotal: rounded(lineCredit),
    },
  });

  const ledgerEventsBody = assertOk(
    await apiRequest(
      `/api/accounting/ledger/events?company_id=${companyId}&event_type=POST&limit=200`,
      { cookie: login.cookie },
    ),
    "ledger event audit listing",
  );
  const ledgerEvents = asRows(ledgerEventsBody);
  const postingEvent = ledgerEvents.find(
    (event) =>
      Number(event?.company_id) === companyId &&
      event?.event_type === "POST" &&
      Number(event?.entry_id) === Number(post1.accountingEntryId),
  );
  if (!postingEvent) {
    fail("Sport Center posting did not persist its ledger audit event", {
      companyId,
      entryId: Number(post1.accountingEntryId),
      matchingEvents: ledgerEvents.filter(
        (event) => Number(event?.entry_id) === Number(post1.accountingEntryId),
      ),
      eventCount: ledgerEvents.length,
    });
  }
  checks.push({
    name: "Sport Center posting ledger audit event persisted",
    passed: true,
    detail: {
      eventId: postingEvent.id ?? null,
      eventType: postingEvent.event_type,
      companyId: Number(postingEvent.company_id),
      entryId: Number(postingEvent.entry_id),
      period: postingEvent.period ?? null,
    },
  });

  const post2 = assertOk(
    await apiRequest("/api/accounting/posting-monitor/post", {
      method: "POST",
      cookie: login.cookie,
      body: {
        moduleType: "sport_center",
        sourceDocId: sportPaymentId,
        companyId,
        date: sportPaymentDate,
      },
    }),
    "Sport Center second posting",
  );
  if (
    post2.ok !== true ||
    Number(post2.accountingPaymentId) !== Number(post1.accountingPaymentId) ||
    (post2.accountingEntryId != null &&
      Number(post2.accountingEntryId) !== Number(post1.accountingEntryId))
  ) {
    fail("Sport Center posting rerun changed the accounting identity", {
      firstPost: compactResponse(post1),
      secondPost: compactResponse(post2),
    });
  }
  checks.push({
    name: "Sport Center posting rerun idempotency",
    passed: true,
    detail: {
      firstPost: compactResponse(post1),
      secondPost: compactResponse(post2),
    },
  });

  const proof = {
    ok: true,
    environment: "development",
    readiness: {
      ready: readiness.ready === true,
      status: readiness.status ?? null,
    },
    adminEmail: login.email,
    companyId,
    sheetConfigId: configId,
    sportPaymentId,
    checks,
  };
  console.log(JSON.stringify(proof, null, 2));
}

main().catch((error) => {
  console.error(
    JSON.stringify({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
  process.exitCode = 1;
});