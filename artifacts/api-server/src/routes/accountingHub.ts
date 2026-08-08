/**
 * Accounting Hub Routes — /api/accounting/hub/*
 * Multi-company dashboard, general ledger, trial balance, P&L, balance sheet,
 * payment journal, posting errors, COA module mapping, dan posting endpoints.
 */
import { Router } from "express";
import { db } from "@workspace/db";
import { logger } from "../lib/logger.js";
import {
  accountingEntriesTable,
  accountingEntryLinesTable,
  accountingPaymentsTable,
  accountingPostingErrorsTable,
  paymentsTable,
  salesDocumentsTable,
  coaModuleMappingTable,
  chartOfAccountsTable,
  accountingJournalsTable,
  companiesTable,
} from "@workspace/db";
import { sql, eq, and, gte, lte, desc, asc, isNull, isNotNull, count } from "drizzle-orm";
import { requireAdmin } from "../lib/requireAdmin.js";
import { backfillSportCenterAccountingPayments } from "../lib/backfillSportCenterPayments.js";
import {
  postToAccountingHub,
  voidAccountingEntry,
  voidAccountingPayment,
  postTenantPaymentToAccounting,
  postSportBookingPaymentToAccounting,
  postExpenseToAccounting,
  postInvoicePaymentToAccounting,
} from "../lib/accountingPostingService.js";
import { postPaymentReceived, postSalesInvoice, postTenantRentPayment } from "../lib/accounting.js";

const router = Router();

// ── Auth guard ────────────────────────────────────────────────────────────────
router.use(async (req, res, next) => {
  if (!(await requireAdmin(req, res))) return;
  next();
});

// ── Helper ────────────────────────────────────────────────────────────────────
function parseFilters(query: Record<string, any>) {
  const VALID_SORT_COLS = [
    "date", "month", "entry_number", "source_module",
    "account_code", "account_type", "partner_name",
    "ref", "debit", "credit", "status",
  ] as const;
  type SortCol = typeof VALID_SORT_COLS[number];

  const rawSortBy = query.sort_by as string | undefined;
  const sortBy: SortCol = VALID_SORT_COLS.includes(rawSortBy as SortCol)
    ? (rawSortBy as SortCol)
    : "date";
  const sortDir: "asc" | "desc" = query.sort_dir === "asc" ? "asc" : "desc";

  return {
    companyId: query.company_id ? Number(query.company_id) : undefined,
    branchId:  query.branch_id  ? Number(query.branch_id)  : undefined,
    divisionId: query.division_id ? Number(query.division_id) : undefined,
    dateFrom:  query.date_from  as string | undefined,
    dateTo:    query.date_to    as string | undefined,
    sourceModule: query.source_module as string | undefined,
    accountId: query.account_id ? Number(query.account_id) : undefined,
    paymentMethod: query.payment_method as string | undefined,
    page:  Math.max(1, Number(query.page  ?? 1)),
    limit: Math.min(500, Number(query.limit ?? 50)),
    sortBy,
    sortDir,
  };
}

/**
 * Normalized module expression — maps ALL known `accounting_entry_source` enum
 * values to the canonical module names used in the dropdown filter.
 *
 * Old entries only have the `source` enum set; new entries (posted via
 * postToAccountingHub) set `source_module` directly. Without normalization,
 * filtering by "tenant" would miss entries stored as "tenant_rent_payment",
 * and "sport_center" would miss "sport_center_booking", etc.
 *
 * @param alias - SQL table alias for accounting_entries, or "" for no alias
 */
function normModuleExpr(alias = "e") {
  const p = alias ? `${alias}.` : "";   // column prefix — empty when no alias
  return sql.raw(`CASE
    WHEN ${p}source_module IS NOT NULL THEN ${p}source_module
    WHEN ${p}source::text IN ('tenant_rent_payment','tenant_sc_payment','tenant_rent_reversal') THEN 'tenant'
    WHEN ${p}source::text IN ('sport_center_booking','sport_center_refund','sport_center_membership',
         'sport_center_booking_refund','sport_center_operational_expense','sport_center_booking_reversal') THEN 'sport_center'
    WHEN ${p}source::text IN ('purchase_bill','purchase_payment','purchase_return','grn_receipt','stock_received') THEN 'purchase'
    WHEN ${p}source::text IN ('sales_invoice','sales_payment','sales_return','cogs_delivery') THEN 'sales'
    WHEN ${p}source::text IN ('pos_sale') THEN 'pos'
    WHEN ${p}source::text IN ('ecommerce_order') THEN 'ecommerce'
    WHEN ${p}source::text IN ('logistic_vendor_cost','logistics_payment') THEN 'logistics'
    WHEN ${p}source::text IN ('payroll','hrd_salary_payment') THEN 'hrd'
    WHEN ${p}source::text IN ('fleet_cash_payment','travel_payment','trading_payment') THEN 'expense'
    WHEN ${p}source::text IN ('manual','manual_payment','reversal','closing_entry','opname_adjust',
         'damage_adjust','other_income','bank_mutation_import') THEN 'manual'
    ELSE COALESCE(${p}source_module, ${p}source::text, 'manual')
  END`);
}

// ── GET /api/accounting/hub/overview ─────────────────────────────────────────
router.get("/hub/overview", async (req, res) => {
  try {
    const { companyId, dateFrom, dateTo } = parseFilters(req.query as any);

    const conditions: any[] = [];
    if (companyId) conditions.push(sql`e.company_id = ${companyId}`);
    if (dateFrom)  conditions.push(sql`e.date >= ${dateFrom}`);
    if (dateTo)    conditions.push(sql`e.date <= ${dateTo}`);
    const where = conditions.length ? sql`WHERE ${sql.join(conditions, sql` AND `)}` : sql``;

    const [totals] = await db.execute<any>(sql`
      SELECT
        COUNT(DISTINCT e.id)::int                                    AS total_entries,
        (SELECT COUNT(*)::int FROM companies)                        AS total_companies,
        COALESCE(SUM(el.debit), 0)::numeric                         AS total_debit,
        COALESCE(SUM(el.credit), 0)::numeric                        AS total_credit,
        COUNT(DISTINCT CASE WHEN e.status = 'posted' THEN e.id END)::int AS posted_count,
        COUNT(DISTINCT CASE WHEN e.voided_at IS NOT NULL THEN e.id END)::int AS voided_count
      FROM accounting_entries e
      LEFT JOIN accounting_entry_lines el ON el.entry_id = e.id
      ${where}
    `).then(r => r.rows);

    const moduleBreakdown = await db.execute<any>(sql`
      SELECT
        ${normModuleExpr()} AS module,
        COUNT(DISTINCT e.id)::int                           AS entry_count,
        COALESCE(SUM(el.debit), 0)::numeric                 AS total_debit
      FROM accounting_entries e
      LEFT JOIN accounting_entry_lines el ON el.entry_id = e.id
      ${where}
      GROUP BY ${normModuleExpr()}
      ORDER BY entry_count DESC
      LIMIT 20
    `).then(r => r.rows);

    const errorCount = await db
      .select({ count: count() })
      .from(accountingPostingErrorsTable)
      .where(isNull(accountingPostingErrorsTable.resolvedAt));

    const companyBreakdown = await db.execute<any>(sql`
      SELECT
        c.id                                AS company_id,
        COALESCE(c.name, c.company_name)    AS company_name,
        COUNT(DISTINCT e.id)::int           AS entry_count,
        COALESCE(SUM(el.debit), 0)::numeric AS total_debit
      FROM companies c
      LEFT JOIN accounting_entries e
        ON e.company_id = c.id
        AND (${dateFrom ?? null}::date IS NULL OR e.date >= ${dateFrom ?? null}::date)
        AND (${dateTo   ?? null}::date IS NULL OR e.date <= ${dateTo   ?? null}::date)
      LEFT JOIN accounting_entry_lines el ON el.entry_id = e.id
      GROUP BY c.id, COALESCE(c.name, c.company_name)
      ORDER BY entry_count DESC, c.id ASC
      LIMIT 20
    `).then(r => r.rows);

    res.json({
      totals: totals ?? {},
      moduleBreakdown,
      companyBreakdown,
      pendingErrors: errorCount[0]?.count ?? 0,
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// ── GET /api/accounting/hub/general-ledger ────────────────────────────────────
//
// Running Balance Architecture:
//
//   BALANCE POLICY (Phase 6):
//     Balance (opening, running, closing) follows ALL transactions for the
//     account in the date range — not just filtered rows (source_module etc).
//     Source-module / text filters only affect which rows are DISPLAYED.
//     This is standard GL behavior: the balance column on each row shows the
//     cumulative account balance up to that point chronologically, regardless
//     of what other rows are hidden by display filters.
//
//   SORT SAFETY (Phase 4):
//     Running balance is always calculated in chronological order
//     (date ASC → entry id ASC → line id ASC) regardless of the display sort.
//     The window function orders the cumulative sum chronologically; the outer
//     ORDER BY only controls display order.
//
//   PAGINATION SAFETY (Phase 5):
//     opening_bal CTE accumulates ALL posted entries before dateFrom.
//     running_bal window cumulates ALL posted entries in the date range.
//     Page 2's first row carries the correct cumulative balance from page 1.
//
//   STATUS POLICY (Phase 10):
//     Only POSTED entries affect the balance. Draft/voided entries show in the
//     display with a null running_balance (not included in balance math).
//
router.get("/hub/general-ledger", async (req, res) => {
  try {
    const f = parseFilters(req.query as any);
    const offset = (f.page - 1) * f.limit;

    // ── Condition sets ───────────────────────────────────────────────────────
    // base: company/branch/division/account — NO date, NO source_module
    //   Used for opening balance (pre-period) and as the foundation for others.
    const baseConds: any[] = [];
    if (f.companyId)  baseConds.push(sql`e.company_id = ${f.companyId}`);
    if (f.branchId)   baseConds.push(sql`e.branch_id = ${f.branchId}`);
    if (f.divisionId) baseConds.push(sql`e.division_id = ${f.divisionId}`);
    if (f.accountId)  baseConds.push(sql`el.account_id = ${f.accountId}`);

    // balance: base + date range — used by running_bal CTE (no source_module)
    const balanceConds = [...baseConds];
    if (f.dateFrom) balanceConds.push(sql`e.date >= ${f.dateFrom}`);
    if (f.dateTo)   balanceConds.push(sql`e.date <= ${f.dateTo}`);

    // display: balance + source_module — the final row filter
    const displayConds = [...balanceConds];
    if (f.sourceModule) displayConds.push(sql`${normModuleExpr()} = ${f.sourceModule}`);

    // SQL fragments for WHERE injection in CTEs and outer query
    const baseAnd    = baseConds.length    ? sql` AND ${sql.join(baseConds,    sql` AND `)}` : sql``;
    const balanceAnd = balanceConds.length ? sql` AND ${sql.join(balanceConds, sql` AND `)}` : sql``;
    const displayWhere = displayConds.length
      ? sql`WHERE ${sql.join(displayConds, sql` AND `)}`
      : sql``;

    // ── Dynamic ORDER BY (display sort only — does not affect balance calc) ──
    const dir = sql.raw(f.sortDir.toUpperCase());
    const primarySort = {
      date:          sql`e.date ${dir}, e.id ${dir}`,
      month:         sql`e.date ${dir}, e.id ${dir}`,
      entry_number:  sql`e.entry_number ${dir}, e.id ${dir}`,
      source_module: sql`${normModuleExpr()} ${dir}, e.date DESC, e.id DESC`,
      account_code:  sql`coa.code ${dir}, e.date DESC, e.id ${dir}`,
      account_type:  sql`coa.type ${dir}, coa.code ASC, e.id ${dir}`,
      partner_name:  sql`ap.partner_name ${dir} NULLS LAST, e.date DESC, e.id DESC`,
      ref:           sql`e.ref ${dir} NULLS LAST, e.date DESC, e.id DESC`,
      debit:         sql`el.debit::numeric ${dir}, e.id ${dir}`,
      credit:        sql`el.credit::numeric ${dir}, e.id ${dir}`,
      status:        sql`e.status ${dir}, e.date DESC, e.id DESC`,
    } as const;
    const orderBy = primarySort[f.sortBy as keyof typeof primarySort]
      ?? sql`e.date DESC, e.id DESC`;

    // ── Main query: two CTEs + display join ──────────────────────────────────
    const rows = await db.execute<any>(sql`
      WITH
      -- CTE 1: opening_bal
      --   Sum of POSTED entries BEFORE dateFrom, grouped by account.
      --   Skipped (returns no rows) when dateFrom is not set → opening = 0.
      opening_bal AS (
        SELECT
          el.account_id,
          COALESCE(SUM(
            CASE WHEN coa.normal_balance = 'DEBIT'
                 THEN el.debit::numeric - el.credit::numeric
                 ELSE el.credit::numeric - el.debit::numeric
            END
          ), 0) AS opening_balance
        FROM accounting_entry_lines el
        JOIN accounting_entries e ON e.id = el.entry_id
        JOIN chart_of_accounts coa ON coa.id = el.account_id
        WHERE e.status = 'posted'
          ${baseAnd}
          ${f.dateFrom ? sql`AND e.date < ${f.dateFrom}` : sql`AND FALSE`}
        GROUP BY el.account_id
      ),
      -- CTE 2: running_bal
      --   Cumulative balance per account, chronological order.
      --   Includes ALL source_modules (balance policy A).
      --   Only POSTED entries (draft/voided excluded from balance).
      running_bal AS (
        SELECT
          el.id AS line_id,
          el.account_id,
          SUM(
            CASE WHEN coa.normal_balance = 'DEBIT'
                 THEN el.debit::numeric - el.credit::numeric
                 ELSE el.credit::numeric - el.debit::numeric
            END
          ) OVER (
            PARTITION BY el.account_id
            ORDER BY e.date ASC, e.id ASC, el.id ASC
            ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
          ) AS cum_balance
        FROM accounting_entry_lines el
        JOIN accounting_entries e ON e.id = el.entry_id
        JOIN chart_of_accounts coa ON coa.id = el.account_id
        WHERE e.status = 'posted'
          ${balanceAnd}
      )
      SELECT
        el.id AS line_id, e.id AS entry_id, e.entry_number,
        e.company_id, e.branch_id, e.division_id,
        e.date, ${normModuleExpr()} AS source_module,
        e.source_schema, e.source_table, e.source_id, e.ref,
        e.description AS entry_description, el.description AS line_description,
        e.status, j.name AS journal_name, j.type AS journal_type,
        coa.id AS account_id, coa.code AS account_code, coa.name AS account_name,
        coa.type AS account_type, coa.normal_balance,
        el.debit, el.credit, e.created_at, e.posted_at,
        ap.partner_name, ap.source_doc_number, ap.payment_method,
        -- running_balance: null for non-posted rows (they don't affect balance)
        CASE WHEN e.status = 'posted'
             THEN COALESCE(ob.opening_balance, 0) + rb.cum_balance
             ELSE NULL
        END AS running_balance,
        COALESCE(ob.opening_balance, 0) AS account_opening_balance
      FROM accounting_entry_lines el
      JOIN accounting_entries e   ON e.id = el.entry_id
      JOIN accounting_journals j  ON j.id = e.journal_id
      JOIN chart_of_accounts coa  ON coa.id = el.account_id
      LEFT JOIN running_bal rb    ON rb.line_id = el.id
      LEFT JOIN opening_bal ob    ON ob.account_id = el.account_id
      LEFT JOIN LATERAL (
        SELECT partner_name,
               COALESCE(ref, source_module) AS source_doc_number,
               payment_method
        FROM accounting_payments
        WHERE entry_id = e.id
        ORDER BY id ASC
        LIMIT 1
      ) ap ON true
      ${(() => {
        const mainConds = f.paymentMethod
          ? [...displayConds, sql`ap.payment_method = ${f.paymentMethod}`]
          : displayConds;
        return mainConds.length ? sql`WHERE ${sql.join(mainConds, sql` AND `)}` : sql``;
      })()}
      ORDER BY ${orderBy}, el.id ASC
      LIMIT ${f.limit} OFFSET ${offset}
    `).then(r => r.rows);

    // ── Summary stats (all display-filtered rows, all pages) ────────────────
    // When filtering by payment_method we need the LATERAL join in the summary query too.
    const [displaySummary] = await db.execute<any>(
      f.paymentMethod
        ? sql`
          SELECT
            COUNT(el.id)::int                       AS total,
            COALESCE(SUM(el.debit::numeric),  0)    AS total_debit,
            COALESCE(SUM(el.credit::numeric), 0)    AS total_credit
          FROM accounting_entry_lines el
          JOIN accounting_entries e ON e.id = el.entry_id
          JOIN chart_of_accounts coa ON coa.id = el.account_id
          LEFT JOIN LATERAL (
            SELECT payment_method FROM accounting_payments
            WHERE entry_id = e.id ORDER BY id ASC LIMIT 1
          ) ap ON true
          WHERE ${sql.join([...displayConds, sql`ap.payment_method = ${f.paymentMethod}`], sql` AND `)}`
        : sql`
          SELECT
            COUNT(el.id)::int                       AS total,
            COALESCE(SUM(el.debit::numeric),  0)    AS total_debit,
            COALESCE(SUM(el.credit::numeric), 0)    AS total_credit
          FROM accounting_entry_lines el
          JOIN accounting_entries e ON e.id = el.entry_id
          JOIN chart_of_accounts coa ON coa.id = el.account_id
          ${displayWhere}`
    ).then(r => r.rows);

    // ── Opening balance for summary panel ────────────────────────────────────
    // Sum of ALL posted entries before dateFrom (ignores source_module).
    // When no dateFrom, opening = 0 (nothing precedes an unbounded start).
    const [openingRow] = f.dateFrom
      ? await db.execute<any>(sql`
          SELECT COALESCE(SUM(
            CASE WHEN coa.normal_balance = 'DEBIT'
                 THEN el.debit::numeric - el.credit::numeric
                 ELSE el.credit::numeric - el.debit::numeric
            END
          ), 0) AS opening_balance
          FROM accounting_entry_lines el
          JOIN accounting_entries e ON e.id = el.entry_id
          JOIN chart_of_accounts coa ON coa.id = el.account_id
          WHERE e.status = 'posted'
            ${baseAnd}
            AND e.date < ${f.dateFrom}
        `).then(r => r.rows)
      : [{ opening_balance: "0" }];

    // ── Period net change (for closing balance) ───────────────────────────────
    // All posted entries in date range — ignores source_module (policy A).
    const [periodRow] = await db.execute<any>(sql`
      SELECT COALESCE(SUM(
        CASE WHEN coa.normal_balance = 'DEBIT'
             THEN el.debit::numeric - el.credit::numeric
             ELSE el.credit::numeric - el.debit::numeric
        END
      ), 0) AS period_net
      FROM accounting_entry_lines el
      JOIN accounting_entries e ON e.id = el.entry_id
      JOIN chart_of_accounts coa ON coa.id = el.account_id
      WHERE e.status = 'posted'
        ${balanceAnd}
    `).then(r => r.rows);

    const openingBalance = Number(openingRow?.opening_balance ?? 0);
    const periodNet      = Number(periodRow?.period_net       ?? 0);
    const closingBalance = openingBalance + periodNet;

    res.json({
      data: rows,
      total:          displaySummary?.total    ?? 0,
      page:           f.page,
      limit:          f.limit,
      openingBalance,
      closingBalance,
      totalDebit:     Number(displaySummary?.total_debit  ?? 0),
      totalCredit:    Number(displaySummary?.total_credit ?? 0),
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// ── GET /api/accounting/hub/trial-balance ─────────────────────────────────────
router.get("/hub/trial-balance", async (req, res) => {
  try {
    const f = parseFilters(req.query as any);

    const conditions: any[] = [sql`e.status = 'posted'`];
    if (f.companyId)    conditions.push(sql`e.company_id = ${f.companyId}`);
    if (f.branchId)     conditions.push(sql`e.branch_id = ${f.branchId}`);
    if (f.divisionId)   conditions.push(sql`e.division_id = ${f.divisionId}`);
    if (f.dateFrom)     conditions.push(sql`e.date >= ${f.dateFrom}`);
    if (f.dateTo)       conditions.push(sql`e.date <= ${f.dateTo}`);

    const where = sql`WHERE ${sql.join(conditions, sql` AND `)}`;

    const rows = await db.execute<any>(sql`
      SELECT
        coa.id AS account_id, coa.code, coa.name, coa.type,
        e.company_id, e.branch_id, e.division_id,
        c.company_name,
        c.company_code,
        SUM(el.debit)::numeric   AS total_debit,
        SUM(el.credit)::numeric  AS total_credit,
        (SUM(el.debit) - SUM(el.credit))::numeric AS balance,
        -- Counterparty company for intercompany accounts (2-2098 / 1-1099)
        -- Current path ref format: 'IC-ADV-{num}' (postIntercompanyDisbursementPair / postIntercompanyRepaymentPair)
        -- Legacy ref format kept for backward compat: 'IC-{num}' (old single-book path, no longer generated)
        CASE
          WHEN coa.code = '2-2098' THEN (
            SELECT STRING_AGG(DISTINCT COALESCE(cp.company_code, cp.company_name), ', ' ORDER BY COALESCE(cp.company_code, cp.company_name))
            FROM accounting_entries ae2
            JOIN cash_advances ca2 ON (
              ae2.ref = 'IC-' || ca2.advance_number
              OR ae2.ref = 'IC-ADV-' || ca2.advance_number
            )
            JOIN companies cp ON cp.id = ca2.source_company_id
            WHERE ae2.company_id = e.company_id
              AND ae2.source_module LIKE 'advance_intercompany%'
              AND ae2.status = 'posted'
          )
          WHEN coa.code = '1-1099' THEN (
            SELECT STRING_AGG(DISTINCT COALESCE(cp.company_code, cp.company_name), ', ' ORDER BY COALESCE(cp.company_code, cp.company_name))
            FROM accounting_entries ae2
            JOIN cash_advances ca2 ON (
              ae2.ref = 'IC-' || ca2.advance_number
              OR ae2.ref = 'IC-ADV-' || ca2.advance_number
            )
            -- Show the OTHER party: if this company is the funder, show responsible; if responsible, show funder (CST)
            JOIN companies cp ON cp.id = CASE
              WHEN ca2.source_company_id = e.company_id THEN ca2.responsible_company_id
              ELSE ca2.source_company_id
            END
            WHERE ae2.company_id = e.company_id
              AND ae2.source_module LIKE 'advance_intercompany%'
              AND ae2.status = 'posted'
          )
          ELSE NULL
        END AS counterparty_companies
      FROM accounting_entry_lines el
      JOIN accounting_entries e   ON e.id = el.entry_id
      JOIN chart_of_accounts coa  ON coa.id = el.account_id
      LEFT JOIN companies c       ON c.id = e.company_id
      ${where}
      GROUP BY coa.id, coa.code, coa.name, coa.type, e.company_id, e.branch_id, e.division_id, c.company_name, c.company_code
      ORDER BY coa.code ASC
    `).then(r => r.rows);

    res.json({ data: rows });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// ── GET /api/accounting/hub/profit-loss ───────────────────────────────────────
router.get("/hub/profit-loss", async (req, res) => {
  try {
    const f = parseFilters(req.query as any);

    const conditions: any[] = [sql`e.status = 'posted'`, sql`coa.type IN ('revenue', 'expense')`];
    if (f.companyId)    conditions.push(sql`e.company_id = ${f.companyId}`);
    if (f.branchId)     conditions.push(sql`e.branch_id = ${f.branchId}`);
    if (f.divisionId)   conditions.push(sql`e.division_id = ${f.divisionId}`);
    if (f.dateFrom)     conditions.push(sql`e.date >= ${f.dateFrom}`);
    if (f.dateTo)       conditions.push(sql`e.date <= ${f.dateTo}`);
    if (f.sourceModule) conditions.push(sql`${normModuleExpr()} = ${f.sourceModule}`);

    const where = sql`WHERE ${sql.join(conditions, sql` AND `)}`;

    const rows = await db.execute<any>(sql`
      SELECT
        coa.type AS account_type, coa.id AS account_id, coa.code, coa.name,
        e.company_id, e.branch_id, e.division_id,
        ${normModuleExpr()} AS source_module,
        TO_CHAR(e.date::date, 'YYYY-MM') AS period,
        SUM(el.debit)::numeric  AS total_debit,
        SUM(el.credit)::numeric AS total_credit,
        CASE
          WHEN coa.type = 'revenue' THEN (SUM(el.credit) - SUM(el.debit))
          WHEN coa.type = 'expense' THEN (SUM(el.debit)  - SUM(el.credit))
          ELSE 0
        END::numeric AS net_amount
      FROM accounting_entry_lines el
      JOIN accounting_entries e   ON e.id = el.entry_id
      JOIN chart_of_accounts coa  ON coa.id = el.account_id
      ${where}
      GROUP BY coa.type, coa.id, coa.code, coa.name,
               e.company_id, e.branch_id, e.division_id,
               ${normModuleExpr()},
               TO_CHAR(e.date::date, 'YYYY-MM')
      ORDER BY coa.type DESC, coa.code ASC
    `).then(r => r.rows);

    const revenue = rows.filter(r => r.account_type === "revenue").reduce((s, r) => s + parseFloat(r.net_amount ?? "0"), 0);
    const expense  = rows.filter(r => r.account_type === "expense").reduce((s, r) => s + parseFloat(r.net_amount ?? "0"), 0);

    res.json({ data: rows, summary: { total_revenue: revenue, total_expense: expense, net_profit: revenue - expense } });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// ── GET /api/accounting/hub/balance-sheet ─────────────────────────────────────
router.get("/hub/balance-sheet", async (req, res) => {
  try {
    const f = parseFilters(req.query as any);

    const conditions: any[] = [sql`e.status = 'posted'`, sql`coa.type IN ('asset', 'liability', 'equity')`];
    if (f.companyId)  conditions.push(sql`e.company_id = ${f.companyId}`);
    if (f.branchId)   conditions.push(sql`e.branch_id = ${f.branchId}`);
    if (f.divisionId) conditions.push(sql`e.division_id = ${f.divisionId}`);
    if (f.dateTo)     conditions.push(sql`e.date <= ${f.dateTo}`);

    const where = sql`WHERE ${sql.join(conditions, sql` AND `)}`;

    const rows = await db.execute<any>(sql`
      SELECT
        coa.type AS account_type, coa.id AS account_id, coa.code, coa.name,
        e.company_id, c.company_code, e.branch_id,
        SUM(el.debit)::numeric  AS total_debit,
        SUM(el.credit)::numeric AS total_credit,
        CASE
          WHEN coa.type = 'asset'              THEN (SUM(el.debit) - SUM(el.credit))
          WHEN coa.type IN ('liability','equity') THEN (SUM(el.credit) - SUM(el.debit))
          ELSE 0
        END::numeric AS balance
      FROM accounting_entry_lines el
      JOIN accounting_entries e   ON e.id = el.entry_id
      JOIN chart_of_accounts coa  ON coa.id = el.account_id
      LEFT JOIN companies c       ON c.id = e.company_id
      ${where}
      GROUP BY coa.type, coa.id, coa.code, coa.name, e.company_id, c.company_code, e.branch_id
      ORDER BY coa.type ASC, coa.code ASC
    `).then(r => r.rows);

    const assets      = rows.filter(r => r.account_type === "asset").reduce((s, r) => s + parseFloat(r.balance ?? "0"), 0);
    const liabilities = rows.filter(r => r.account_type === "liability").reduce((s, r) => s + parseFloat(r.balance ?? "0"), 0);
    const equity      = rows.filter(r => r.account_type === "equity").reduce((s, r) => s + parseFloat(r.balance ?? "0"), 0);

    res.json({ data: rows, summary: { total_assets: assets, total_liabilities: liabilities, total_equity: equity, balanced: Math.abs(assets - (liabilities + equity)) < 1 } });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// ── GET /api/accounting/hub/payments ─────────────────────────────────────────
router.get("/hub/payments", async (req, res) => {
  try {
    const f = parseFilters(req.query as any);
    const offset = (f.page - 1) * f.limit;

    const conditions: any[] = [];
    if (f.companyId)    conditions.push(eq(accountingPaymentsTable.companyId, f.companyId));
    if (f.branchId)     conditions.push(eq(accountingPaymentsTable.branchId as any, f.branchId));
    if (f.sourceModule) conditions.push(eq(accountingPaymentsTable.sourceModule as any, f.sourceModule));

    const rows = await db.execute<any>(sql`
      SELECT
        p.*,
        j.name AS journal_name,
        j.type AS journal_type,
        COALESCE(sp.posting_status, tp.posting_status, lp.posting_status, 'posted') AS source_posting_status,
        COALESCE(sp.posting_error, tp.posting_error, lp.posting_error) AS source_posting_error,
        COALESCE(sp.payment_number, tp.payment_number, lp.payment_number, p.ref) AS source_reference
      FROM accounting_payments p
      JOIN accounting_journals j ON j.id = p.journal_id
      LEFT JOIN sport_payments sp
        ON p.source_type = 'sport_center' AND p.source_doc_id = sp.id
      LEFT JOIN tenant_payments tp
        ON p.source_type = 'tenant' AND p.source_doc_id = tp.id
      LEFT JOIN logistics_payments lp
        ON p.source_type = 'logistics' AND p.source_doc_id = lp.id
      ${conditions.length ? sql`WHERE ${sql.join(conditions.map(c => sql`${c}`), sql` AND `)}` : sql``}
      ORDER BY p.date DESC, p.id DESC
      LIMIT ${f.limit} OFFSET ${offset}
    `).then(r => r.rows);

    const [tot] = await db.execute<any>(sql`
      SELECT COUNT(*)::int AS total FROM accounting_payments p
      ${conditions.length ? sql`WHERE ${sql.join(conditions.map(c => sql`${c}`), sql` AND `)}` : sql``}
    `).then(r => r.rows);

    res.json({ data: rows, total: tot?.total ?? 0, page: f.page, limit: f.limit });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// ── GET /api/accounting/hub/posting-errors ────────────────────────────────────
router.get("/hub/posting-errors", async (req, res) => {
  try {
    const f = parseFilters(req.query as any);
    const offset = (f.page - 1) * f.limit;
    const onlyUnresolved = req.query.unresolved !== "false";

    const conds: any[] = [];
    if (f.companyId)    conds.push(sql`company_id = ${f.companyId}`);
    if (f.sourceModule) conds.push(sql`source_module = ${f.sourceModule}`);
    if (onlyUnresolved) conds.push(sql`resolved_at IS NULL`);

    const where = conds.length ? sql`WHERE ${sql.join(conds, sql` AND `)}` : sql``;

    const rows = await db.execute<any>(sql`
      SELECT * FROM accounting_posting_errors
      ${where}
      ORDER BY created_at DESC
      LIMIT ${f.limit} OFFSET ${offset}
    `).then(r => r.rows);

    const [tot] = await db.execute<any>(sql`
      SELECT COUNT(*)::int AS total FROM accounting_posting_errors ${where}
    `).then(r => r.rows);

    res.json({ data: rows, total: tot?.total ?? 0, page: f.page, limit: f.limit });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// ── PATCH /api/accounting/hub/posting-errors/:id/resolve ─────────────────────
router.patch("/hub/posting-errors/:id/resolve", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { resolve_note, resolved_by } = req.body ?? {};
    await db
      .update(accountingPostingErrorsTable)
      .set({ resolvedAt: new Date(), resolvedBy: resolved_by ?? null, resolveNote: resolve_note ?? null })
      .where(eq(accountingPostingErrorsTable.id, id));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// POST /api/accounting/hub/posting-errors/:id/retry
// Currently supports payment auto-post failures. The original error remains
// immutable; a successful retry marks only that failure record resolved.
router.post("/hub/posting-errors/:id/retry", async (req, res) => {
  try {
    const errorId = Number(req.params.id);
    if (!Number.isInteger(errorId) || errorId <= 0) {
      return res.status(400).json({ error: "Invalid posting error id" });
    }

    const [postingError] = await db
      .select()
      .from(accountingPostingErrorsTable)
      .where(eq(accountingPostingErrorsTable.id, errorId))
      .limit(1);
    if (!postingError) return res.status(404).json({ error: "Posting error not found" });
    if (postingError.resolvedAt) return res.status(409).json({ error: "Posting error already resolved" });
    const isPaymentPostingError =
      postingError.sourceModule === "payments" &&
      postingError.sourceTable === "payments" &&
      postingError.sourceId != null;
    const isSalesPostingError =
      postingError.sourceModule === "sales" &&
      postingError.sourceTable === "sales_documents" &&
      postingError.sourceId != null;
    if (!isPaymentPostingError && !isSalesPostingError) {
      return res.status(422).json({ error: "This posting error is not retryable" });
    }
    const sourceId = postingError.sourceId;
    if (sourceId == null) {
      return res.status(422).json({ error: "Posting error source id is missing" });
    }

    let posted: boolean;
    let postedSourceId = sourceId;
    if (isPaymentPostingError) {
      const [payment] = await db
        .select()
        .from(paymentsTable)
        .where(eq(paymentsTable.id, sourceId))
        .limit(1);
      if (!payment) return res.status(404).json({ error: "Payment not found" });
      posted = await postPaymentReceived({
        paymentId: payment.id,
        refKind: payment.refKind,
        refDocNumber: payment.refDocNumber,
        amount: Number(payment.amount),
        paymentMethod: payment.paymentMethod ?? undefined,
        companyId: payment.companyId,
      });
    } else {
      const [salesDoc] = await db
        .select()
        .from(salesDocumentsTable)
        .where(eq(salesDocumentsTable.id, sourceId))
        .limit(1);
      if (!salesDoc) return res.status(404).json({ error: "Sales document not found" });
      posted = await postSalesInvoice({
        salesDocId: salesDoc.id,
        docNumber: salesDoc.docNumber,
        customerName: salesDoc.customerName,
        netAmount: Number(salesDoc.totalAmount),
        taxAmount: Number(salesDoc.taxAmount ?? 0),
        taxAccountId: null,
        companyId: salesDoc.companyId,
      });
      postedSourceId = salesDoc.id;
    }
    if (!posted) return res.status(422).json({ ok: false, error: "Retry failed; posting error remains unresolved" });

    await db
      .update(accountingPostingErrorsTable)
      .set({ resolvedAt: new Date(), resolvedBy: "system-retry", resolveNote: "Payment journal retry succeeded" })
      .where(eq(accountingPostingErrorsTable.id, errorId));
    return res.json({ ok: true, sourceId: postedSourceId });
  } catch (err: unknown) {
    return res.status(500).json({ error: err instanceof Error ? err.message : String(err) });
  }
});

// ── GET /api/accounting/hub/coa-mapping ───────────────────────────────────────
router.get("/hub/coa-mapping", async (req, res) => {
  try {
    const companyId = req.query.company_id ? Number(req.query.company_id) : undefined;
    const conds: any[] = [];
    if (companyId) conds.push(eq(coaModuleMappingTable.companyId, companyId));

    const rows = await db
      .select({
        id: coaModuleMappingTable.id,
        companyId: coaModuleMappingTable.companyId,
        module: coaModuleMappingTable.module,
        transactionType: coaModuleMappingTable.transactionType,
        debitAccountId: coaModuleMappingTable.debitAccountId,
        creditAccountId: coaModuleMappingTable.creditAccountId,
        description: coaModuleMappingTable.description,
        isActive: coaModuleMappingTable.isActive,
        createdAt: coaModuleMappingTable.createdAt,
        debitCode: chartOfAccountsTable.code,
        debitName: chartOfAccountsTable.name,
      })
      .from(coaModuleMappingTable)
      .leftJoin(chartOfAccountsTable, eq(chartOfAccountsTable.id, coaModuleMappingTable.debitAccountId))
      .where(conds.length ? and(...conds) : undefined)
      .orderBy(asc(coaModuleMappingTable.module), asc(coaModuleMappingTable.transactionType));

    res.json(rows);
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// ── POST /api/accounting/hub/coa-mapping ──────────────────────────────────────
router.post("/hub/coa-mapping", async (req, res) => {
  try {
    const { company_id, module, transaction_type, debit_account_id, credit_account_id, description } = req.body;
    const [row] = await db
      .insert(coaModuleMappingTable)
      .values({
        companyId: Number(company_id),
        module,
        transactionType: transaction_type,
        debitAccountId: Number(debit_account_id),
        creditAccountId: Number(credit_account_id),
        description: description ?? null,
      })
      .onConflictDoUpdate({
        target: [coaModuleMappingTable.companyId, coaModuleMappingTable.module, coaModuleMappingTable.transactionType],
        set: { debitAccountId: Number(debit_account_id), creditAccountId: Number(credit_account_id), description: description ?? null, updatedAt: new Date() },
      })
      .returning();
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// ── PUT /api/accounting/hub/coa-mapping/:id ───────────────────────────────────
router.put("/hub/coa-mapping/:id", async (req, res) => {
  try {
    const id = Number(req.params.id);
    const { debit_account_id, credit_account_id, description, is_active } = req.body;
    const [row] = await db
      .update(coaModuleMappingTable)
      .set({
        debitAccountId: debit_account_id ? Number(debit_account_id) : undefined,
        creditAccountId: credit_account_id ? Number(credit_account_id) : undefined,
        description: description ?? undefined,
        isActive: is_active !== undefined ? Boolean(is_active) : undefined,
        updatedAt: new Date(),
      })
      .where(eq(coaModuleMappingTable.id, id))
      .returning();
    res.json(row);
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// ── DELETE /api/accounting/hub/coa-mapping/:id ────────────────────────────────
router.delete("/hub/coa-mapping/:id", async (req, res) => {
  try {
    await db.delete(coaModuleMappingTable).where(eq(coaModuleMappingTable.id, Number(req.params.id)));
    res.json({ ok: true });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// ── Posting endpoints ─────────────────────────────────────────────────────────

// POST /api/accounting/post/tenant-payment/:id
router.post("/post/tenant-payment/:id", async (req, res) => {
  try {
    const paymentId = Number(req.params.id);
    const { company_id, amount, tenant_name, date, branch_id } = req.body;
    const result = await postTenantPaymentToAccounting(paymentId, Number(company_id), {
      amount, tenantName: tenant_name, date, branchId: branch_id ? Number(branch_id) : undefined,
    });
    if (!result) return res.status(422).json({ error: "Posting gagal — lihat accounting_posting_errors" });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// POST /api/accounting/post/sport-payment/:id
router.post("/post/sport-payment/:id", async (req, res) => {
  try {
    const paymentId = Number(req.params.id);
    const { company_id, amount, customer_name, date, facility_name } = req.body;
    const result = await postSportBookingPaymentToAccounting(paymentId, Number(company_id), {
      amount, customerName: customer_name, date, facilityName: facility_name,
    });
    if (!result) return res.status(422).json({ error: "Posting gagal — lihat accounting_posting_errors" });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// POST /api/accounting/post/expense/:id
router.post("/post/expense/:id", async (req, res) => {
  try {
    const expenseId = Number(req.params.id);
    const { company_id, amount, description, date, branch_id, division_id } = req.body;
    const result = await postExpenseToAccounting(expenseId, Number(company_id), {
      amount, description, date,
      branchId: branch_id ? Number(branch_id) : undefined,
      divisionId: division_id ? Number(division_id) : undefined,
    });
    if (!result) return res.status(422).json({ error: "Posting gagal — lihat accounting_posting_errors" });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// POST /api/accounting/post/invoice-payment/:id
router.post("/post/invoice-payment/:id", async (req, res) => {
  try {
    const paymentId = Number(req.params.id);
    const { company_id, amount, invoice_number, partner_name, date, type } = req.body;
    const result = await postInvoicePaymentToAccounting(paymentId, Number(company_id), {
      amount, invoiceNumber: invoice_number, partnerName: partner_name, date,
      type: type === "outbound" ? "outbound" : "inbound",
    });
    if (!result) return res.status(422).json({ error: "Posting gagal — lihat accounting_posting_errors" });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// POST /api/accounting/void-payment/:id
router.post("/void-payment/:id", async (req, res) => {
  try {
    const paymentId = Number(req.params.id);
    const { reason, voided_by } = req.body ?? {};
    if (!reason) return res.status(400).json({ error: "reason wajib diisi" });
    const result = await voidAccountingPayment(paymentId, reason, voided_by);
    if (!result) return res.status(422).json({ error: "Void gagal" });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// POST /api/accounting/void-entry/:id
router.post("/void-entry/:id", async (req, res) => {
  try {
    const entryId = Number(req.params.id);
    const { reason, voided_by } = req.body ?? {};
    if (!reason) return res.status(400).json({ error: "reason wajib diisi" });
    const result = await voidAccountingEntry(entryId, reason, voided_by);
    if (!result) return res.status(422).json({ error: "Void gagal" });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// ── GET /api/accounting/hub/audit-report ─────────────────────────────────────
router.get("/hub/audit-report", async (req, res) => {
  try {
    const [journalStats] = await db.execute<any>(sql`
      SELECT
        COUNT(*)::int AS total_entries,
        COUNT(DISTINCT company_id)::int AS company_count,
        COUNT(DISTINCT COALESCE(source_module, source::text))::int AS module_count, -- raw count ok here
        SUM(CASE WHEN voided_at IS NOT NULL THEN 1 ELSE 0 END)::int AS voided_count,
        SUM(CASE WHEN posted_at IS NULL THEN 1 ELSE 0 END)::int AS unposted_count
      FROM accounting_entries
    `).then(r => r.rows);

    const moduleStats = await db.execute<any>(sql`
      SELECT ${normModuleExpr("")} AS module,
             COUNT(*)::int AS entry_count,
             COUNT(DISTINCT company_id)::int AS company_count
      FROM accounting_entries
      GROUP BY 1
      ORDER BY entry_count DESC
    `).then(r => r.rows);

    const errorStats = await db.execute<any>(sql`
      SELECT error_code, source_module, COUNT(*)::int AS count
      FROM accounting_posting_errors
      WHERE resolved_at IS NULL
      GROUP BY error_code, source_module
      ORDER BY count DESC
    `).then(r => r.rows);

    const [coaMappingStats] = await db.execute<any>(sql`
      SELECT COUNT(*)::int AS total_mappings,
             COUNT(CASE WHEN is_active THEN 1 END)::int AS active_mappings
      FROM coa_module_mapping
    `).then(r => r.rows);

    res.json({
      summary: journalStats ?? {},
      moduleBreakdown: moduleStats,
      pendingErrors: errorStats,
      coaMappingStats: coaMappingStats ?? {},
      archiveCandidates: [
        "sport_center schema tables (cross-schema, mirrored to public sport_* tables)",
        "accounting_journals (legacy entries) jika semua sudah dimigrate ke accounting_entries",
      ],
    });
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

// ── POST /api/accounting/hub/backfill-tenant ─────────────────────────────────
// Backfill jurnal akuntansi dari tenant_invoices yang sudah dibayar (paid/partial)
// tapi belum punya accounting entry. Idempoten — aman dijalankan berkali-kali.
router.post("/hub/backfill-tenant", async (req, res) => {
  try {
    const rawCompanyId = req.body?.company_id ?? req.query?.company_id;
    const companyId = rawCompanyId ? Number(rawCompanyId) : null;

    const invoicesRes = await db.execute<any>(sql`
      SELECT
        ti.id,
        ti.invoice_number,
        ti.company_id,
        ti.tenant_id,
        ti.paid_amount,
        ti.total_amount,
        ti.paid_at,
        ti.created_at,
        ti.status,
        COALESCE(t.business_name, 'Tenant #' || ti.tenant_id::text) AS business_name,
        tp.id           AS payment_id,
        tp.payment_number
      FROM tenant_invoices ti
      LEFT JOIN tenants t ON t.id = ti.tenant_id
      LEFT JOIN LATERAL (
        SELECT id, payment_number
        FROM tenant_payments
        WHERE invoice_id = ti.id
          AND status IN ('confirmed', 'paid')
        ORDER BY id DESC
        LIMIT 1
      ) tp ON true
      WHERE ti.paid_amount > 0
        ${companyId != null ? sql`AND ti.company_id = ${companyId}` : sql``}
      ORDER BY ti.company_id, ti.id
    `);

    const invoices = invoicesRes.rows as any[];
    let posted = 0;
    let skipped = 0;
    let errors = 0;
    const detail: { invoice_number: string; status: string; error?: string }[] = [];

    for (const inv of invoices) {
      try {
        // Gunakan payment_id jika ada, fallback ke invoice_id untuk invoices tanpa payment record
        const sourceId = inv.payment_id ? Number(inv.payment_id) : Number(inv.id);
        const amount = Number(inv.paid_amount);
        if (amount <= 0) {
          skipped++;
          detail.push({ invoice_number: inv.invoice_number, status: "skipped (amount=0)" });
          continue;
        }

        // Cek apakah entry sudah ada (company-scoped — sudah diperbaiki di postTenantRentPayment)
        const existingCheck = await db.execute<any>(sql`
          SELECT id FROM accounting_entries
          WHERE source = 'tenant_rent_payment'
            AND source_id = ${sourceId}
            AND company_id = ${Number(inv.company_id)}
          LIMIT 1
        `);
        if (existingCheck.rows.length > 0) {
          skipped++;
          detail.push({ invoice_number: inv.invoice_number, status: "skipped (already posted)" });
          continue;
        }

        await postTenantRentPayment({
          paymentId: sourceId,
          paymentNumber: inv.payment_number ?? inv.invoice_number ?? `INV-${inv.id}`,
          orderNumber: inv.invoice_number ?? `INV-${inv.id}`,
          businessName: inv.business_name,
          date: (inv.paid_at ?? inv.created_at ?? new Date()).toISOString(),
          amount,
          createdById: null,
          companyId: Number(inv.company_id),
        });

        posted++;
        detail.push({ invoice_number: inv.invoice_number, status: "posted" });
      } catch (e: any) {
        errors++;
        detail.push({ invoice_number: inv.invoice_number, status: "error", error: e?.message });
        logger.warn({ e, invoiceId: inv.id }, "[backfill-tenant] Error posting invoice");
      }
    }

    logger.info({ companyId, total: invoices.length, posted, skipped, errors }, "[backfill-tenant] selesai");
    return res.json({ ok: true, total: invoices.length, posted, skipped, errors, detail });
  } catch (err: any) {
    logger.error({ err }, "[backfill-tenant] failed");
    return res.status(500).json({ error: err?.message ?? "Gagal menjalankan backfill" });
  }
});

// ── POST /api/accounting/hub/backfill-sport-center ───────────────────────────
// Backfill accounting_payments for sport_payments that are 'paid' but never got
// an accounting_payments row (e.g. when cash_journal_id was null at time of payment).
// Covers all payment_type values (booking + membership). Idempotent.
router.post("/hub/backfill-sport-center", async (req, res) => {
  try {
    const result = await backfillSportCenterAccountingPayments();
    res.json({
      ok: true,
      ...result,
      message:
        result.total === 0
          ? "Tidak ada sport_payment yang perlu dibackfill — semua sudah tercatat."
          : `Backfill selesai: ${result.posted} dibuat, ${result.skipped} dilewati, ${result.errors} gagal (dari ${result.total} yang diproses).`,
    });
  } catch (err: any) {
    logger.error({ err }, "[backfill-sport-center] failed");
    return res.status(500).json({ error: err?.message ?? "Gagal menjalankan backfill" });
  }
});

// ── POST /api/accounting/hub/post-manual ─────────────────────────────────────
router.post("/hub/post-manual", async (req, res) => {
  try {
    const { company_id, branch_id, division_id, source_module, date, ref, description, lines, journal_id, payment_type, amount, partner_name } = req.body;
    const result = await postToAccountingHub({
      ctx: {
        companyId: Number(company_id),
        branchId: branch_id ? Number(branch_id) : undefined,
        divisionId: division_id ? Number(division_id) : undefined,
        sourceModule: source_module ?? "manual",
      },
      date, ref, description,
      lines: (lines ?? []).map((l: any) => ({
        accountId: Number(l.account_id),
        debit: String(l.debit ?? "0"),
        credit: String(l.credit ?? "0"),
        description: l.description,
      })),
      journalId: journal_id ? Number(journal_id) : undefined,
      paymentType: payment_type,
      amount: amount ? String(amount) : undefined,
      partnerName: partner_name,
    });
    if (!result) return res.status(422).json({ error: "Posting gagal — lihat accounting_posting_errors" });
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err?.message });
  }
});

export default router;
