import { Router, type Request } from "express";
import { resolveCompanyId, resolveCompanyScope } from "../lib/resolveCompany.js";
import { assertCompanyAccess } from "../lib/assertCompanyAccess.js";
import { eq, desc, and, gte, lte, like, sql, count, getTableColumns, or, isNull } from "drizzle-orm";
import { ObjectStorageService } from "../lib/objectStorage.js";
import { logStorageEvent, getRequestIp, getActor } from "../lib/storageAuditLog.js";
import {
  db,
  expenseCategoriesTable,
  expensesTable,
  expenseAttachmentsTable,
  chartOfAccountsTable,
  accountingTaxesTable,
  accountingJournalsTable,
  companiesTable,
} from "@workspace/db";
import { requireAdmin, requireClerkUser } from "../lib/requireAdmin.js";
import { postEntry } from "../lib/accounting.js";
import { voidAccountingEntry } from "../lib/accountingPostingService.js";
import { createIdempotencyMiddleware } from "../lib/financial/idempotency.js";
import { ensureAccountingSettings } from "../lib/accountingSeed.js";
import { auditFromReq, writeAuditLog, extractRequestMeta } from "../lib/auditLog.js";
import {
  allocateExpenseTax,
  normalizeExpenseLines,
  roundMoney,
  type NormalizedExpenseLine,
} from "../lib/expenseLinePolicy.js";

const _expenseObjectStorage = new ObjectStorageService();
const router = Router();

// ── DEPRECATED GUARD — before auth middleware ──────────────────────────────────
// Phase 3: POST /kas-transfer disabled. Returns 410 to all callers (authenticated or not)
// so external integrations know they must migrate to Bank Disbursement (fund_transfer).
router.post("/kas-transfer", (_req, res) => {
  return res.status(410).json({
    error: "DEPRECATED",
    message: "Kas Transfer sudah deprecated. Gunakan Finance → Fund Transfer atau Bank Disbursement fund_transfer.",
    redirectTo: "/accounting/bank-disbursements?type=fund_transfer",
  });
});

// ── Boot migration ──
let _columnsEnsured = false;
async function ensureExpenseColumns() {
  if (_columnsEnsured) return;
  _columnsEnsured = true;
  // pgBouncer (transaction mode) rejects multi-statement SQL in one call —
  // each DDL statement must run separately, with .catch(()=>{}) for idempotency.
  const stmts = [
    `ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS category_type TEXT NOT NULL DEFAULT 'both';`,
    `ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS ppn_input_account_id INTEGER REFERENCES chart_of_accounts(id) ON DELETE SET NULL;`,
    `ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS default_coa_id INTEGER REFERENCES chart_of_accounts(id) ON DELETE SET NULL;`,
    `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS transaction_type TEXT NOT NULL DEFAULT 'expense';`,
    `ALTER TABLE expenses ADD COLUMN IF NOT EXISTS ppn_input_account_id INTEGER REFERENCES chart_of_accounts(id) ON DELETE SET NULL;`,
    `ALTER TABLE expense_categories ADD COLUMN IF NOT EXISTS company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE;`,
    `CREATE TABLE IF NOT EXISTS expense_lines (
      id SERIAL PRIMARY KEY,
      company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
      expense_id INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
      line_no INTEGER NOT NULL DEFAULT 1,
      description TEXT NOT NULL,
      qty NUMERIC(14,4) NOT NULL DEFAULT 1,
      unit TEXT,
      unit_price NUMERIC(14,2) NOT NULL DEFAULT 0,
      subtotal NUMERIC(14,2) NOT NULL DEFAULT 0,
      tax_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
      total NUMERIC(14,2) NOT NULL DEFAULT 0,
      coa_account_id INTEGER NOT NULL REFERENCES chart_of_accounts(id) ON DELETE RESTRICT,
      coa_resolution_status TEXT NOT NULL DEFAULT 'confirmed',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT expense_lines_expense_line_no_uniq UNIQUE (expense_id, line_no)
    );`,
    `CREATE INDEX IF NOT EXISTS expense_lines_company_idx ON expense_lines(company_id);`,
    `CREATE INDEX IF NOT EXISTS expense_lines_expense_idx ON expense_lines(expense_id);`,
  ];
  for (const stmt of stmts) {
    try { await db.execute(sql.raw(stmt)); } catch {}
  }
  // Legacy/imported expense lines can leave the serial sequence behind the
  // current MAX(id), causing the first canonical insert to fail on a line
  // uniqueness conflict after the parent expense has been allocated.
  try {
    await db.execute(sql`
      SELECT setval(
        pg_get_serial_sequence('expense_lines', 'id'),
        GREATEST(COALESCE((SELECT MAX(id) FROM expense_lines), 0) + 1, 1),
        false
      )
    `);
  } catch {}
}

async function validateExpenseAccounts(
  companyId: number | null,
  lines: NormalizedExpenseLine[],
  sourceAccountId: number | null,
) {
  if (!companyId) throw new Error("Company context wajib tersedia untuk expense.");
  if (!sourceAccountId || !Number.isInteger(sourceAccountId)) {
    throw new Error("Akun sumber Bank/Kas wajib dipilih untuk direct expense.");
  }
  const ids = [...new Set([...lines.map((line) => line.coaAccountId), sourceAccountId])];
  const rows = (await db.execute(sql.raw(
    `SELECT id, type, company_id, is_postable, status
       FROM chart_of_accounts
      WHERE id IN (${ids.join(",")})`,
  ))).rows as any[];
  const byId = new Map(rows.map((row) => [Number(row.id), row]));
  for (const line of lines) {
    const account = byId.get(line.coaAccountId);
    if (!account || (account.company_id != null && Number(account.company_id) !== companyId) ||
        account.is_postable === false || String(account.status).toUpperCase() !== "ACTIVE" ||
        !["expense", "asset"].includes(String(account.type).toLowerCase())) {
      throw new Error(`COA line ${line.lineNo} tidak valid, tidak postable, atau bukan milik company aktif.`);
    }
  }
  const source = byId.get(sourceAccountId);
  if (!source || (source.company_id != null && Number(source.company_id) !== companyId) ||
      source.is_postable === false || String(source.status).toUpperCase() !== "ACTIVE" ||
      !["asset", "bank", "cash"].includes(String(source.type).toLowerCase())) {
    throw new Error("Akun sumber harus berupa COA Bank/Kas postable milik company.");
  }
}

async function insertExpenseLines(
  client: any,
  expenseId: number,
  companyId: number,
  lines: NormalizedExpenseLine[],
  taxAmount: number,
) {
  const persisted = allocateExpenseTax(lines, taxAmount);
  for (const line of persisted) {
    await client.execute(sql`
      INSERT INTO expense_lines
        (company_id, expense_id, line_no, description, qty, unit, unit_price, subtotal, tax_amount, total, coa_account_id, coa_resolution_status)
      VALUES
        (${companyId}, ${expenseId}, ${line.lineNo}, ${line.description}, ${String(line.qty)}, ${line.unit},
         ${String(line.unitPrice)}, ${String(line.subtotal)}, ${String(line.taxAmount)}, ${String(line.total)},
         ${line.coaAccountId}, 'confirmed')
    `);
  }
  return persisted;
}

async function replaceExpenseLines(
  expenseId: number,
  companyId: number,
  lines: NormalizedExpenseLine[],
  taxAmount: number,
) {
  return db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM expense_lines WHERE expense_id = ${expenseId}`);
    return insertExpenseLines(tx, expenseId, companyId, lines, taxAmount);
  });
}

// ── Boot migration: expense_categories used to be global (no company_id).
// This backfills every pre-existing global category (company_id IS NULL) into
// a per-company copy — one independent, editable row per company — using the
// original as a template, then drops the old global-unique(code) constraint
// in favor of a per-company unique(company_id, code) index. Idempotent: once
// no NULL-company rows remain, this is a no-op on every subsequent boot.
let _categoriesScoped = false;
async function ensureExpenseCategoriesCompanyScoped() {
  if (_categoriesScoped) return;
  _categoriesScoped = true;
  try {
    const templates = (
      await db.execute(sql.raw(`SELECT * FROM expense_categories WHERE company_id IS NULL`))
    ).rows as any[];

    if (templates.length > 0) {
      const companies = await db.select({ id: companiesTable.id }).from(companiesTable);

      for (const company of companies) {
        for (const tpl of templates) {
          const codeUpper = String(tpl.code ?? "").toUpperCase();
          const already = (
            await db.execute(sql.raw(
              `SELECT id FROM expense_categories WHERE company_id = ${company.id} AND UPPER(code) = '${codeUpper.replace(/'/g, "''")}'`,
            ))
          ).rows[0];
          if (already) continue;

          await db.insert(expenseCategoriesTable).values({
            companyId: company.id,
            name: tpl.name,
            code: codeUpper,
            expenseAccountId: tpl.expense_account_id ?? null,
            payableAccountId: tpl.payable_account_id ?? null,
            defaultTaxId: tpl.default_tax_id ?? null,
            defaultAmount: tpl.default_amount ?? null,
            defaultCoaId: tpl.default_coa_id ?? null,
            requiresAttachment: tpl.requires_attachment ?? false,
            isActive: tpl.is_active ?? true,
          } as any);
          await db.execute(sql.raw(
            `UPDATE expense_categories SET category_type = '${String(tpl.category_type ?? "both").replace(/'/g, "''")}' WHERE company_id = ${company.id} AND UPPER(code) = '${codeUpper.replace(/'/g, "''")}'`,
          ));
        }
      }

      // Any expense rows already pointing at a template row must be repointed
      // to that company's own copy before the template rows are removed.
      for (const tpl of templates) {
        const codeUpper = String(tpl.code ?? "").toUpperCase();
        await db.execute(sql.raw(`
          UPDATE expenses e
          SET category_id = ec.id
          FROM expense_categories ec
          WHERE e.category_id = ${tpl.id}
            AND ec.company_id = e.company_id
            AND UPPER(ec.code) = '${codeUpper.replace(/'/g, "''")}'
        `));
      }

      await db.execute(sql.raw(`DELETE FROM expense_categories WHERE company_id IS NULL`));
    }

    // Drop the old global-unique(code) constraint (name varies by how it was
    // originally created) — the composite (company_id, code) index below is
    // what should enforce uniqueness going forward.
    const dropStmts = [
      `ALTER TABLE expense_categories DROP CONSTRAINT IF EXISTS expense_categories_code_key;`,
      `ALTER TABLE expense_categories DROP CONSTRAINT IF EXISTS expense_categories_code_unique;`,
      `DROP INDEX IF EXISTS expense_categories_code_key;`,
    ];
    for (const stmt of dropStmts) {
      try { await db.execute(sql.raw(stmt)); } catch {}
    }
    try {
      await db.execute(sql.raw(
        `CREATE UNIQUE INDEX IF NOT EXISTS expense_categories_company_code_uniq ON expense_categories (company_id, code);`,
      ));
    } catch {}
  } catch {
    // Non-fatal: if this fails, categories keep working (still readable/writable),
    // just without company scoping until the next successful boot attempt.
    _categoriesScoped = false;
  }
}

// ── Auto-seed preset routine categories for ALL companies ──
let _presetSeeded = false;
async function ensurePresetRoutineCategories() {
  if (_presetSeeded) return;
  _presetSeeded = true;
  try {
    // Drop any leftover global-unique constraint on code
    for (const stmt of [
      `ALTER TABLE expense_categories DROP CONSTRAINT IF EXISTS expense_categories_code_key`,
      `ALTER TABLE expense_categories DROP CONSTRAINT IF EXISTS expense_categories_code_unique`,
      `DROP INDEX IF EXISTS expense_categories_code_key`,
      `DROP INDEX IF EXISTS uq_expense_categories_code`,
    ]) { try { await db.execute(sql.raw(stmt)); } catch {} }

    try {
      await db.execute(sql.raw(
        `CREATE UNIQUE INDEX IF NOT EXISTS expense_categories_company_code_uniq ON expense_categories (company_id, code)`,
      ));
    } catch {}

    // Migrate null-company templates to each company, then delete
    const nullRows = (await db.execute(sql.raw(
      `SELECT id, code, name FROM expense_categories WHERE company_id IS NULL`,
    ))).rows as any[];
    if (nullRows.length > 0) {
      const companies = (await db.execute(sql.raw(`SELECT id FROM companies WHERE is_active = true`))).rows as any[];
      for (const company of companies) {
        for (const tpl of nullRows) {
          const codeUpper = String(tpl.code ?? "").toUpperCase().replace(/'/g, "''");
          const nameEsc = String(tpl.name ?? "").replace(/'/g, "''");
          const already = (await db.execute(sql.raw(
            `SELECT id FROM expense_categories WHERE company_id = ${company.id} AND UPPER(code) = '${codeUpper}'`,
          ))).rows[0];
          if (!already) {
            try {
              await db.execute(sql.raw(
                `INSERT INTO expense_categories (company_id, name, code, is_active, category_type)
                 VALUES (${company.id}, '${nameEsc}', '${codeUpper}', true, 'expense')`,
              ));
            } catch {}
          }
        }
      }
      for (const tpl of nullRows) {
        try { await db.execute(sql.raw(`DELETE FROM expense_categories WHERE id = ${tpl.id}`)); } catch {}
      }
    }

    // Seed missing preset categories for each company
    const companies = (await db.execute(sql.raw(`SELECT id FROM companies WHERE is_active = true`))).rows as any[];
    for (const company of companies) {
      const existing = (await db.execute(sql.raw(
        `SELECT UPPER(code) as code FROM expense_categories WHERE company_id = ${company.id}`,
      ))).rows as any[];
      const existingSet = new Set(existing.map((r: any) => String(r.code)));
      for (const cat of PRESET_ROUTINE_CATEGORIES) {
        if (!existingSet.has(cat.code)) {
          const name = cat.name.replace(/'/g, "''");
          try {
            await db.execute(sql.raw(
              `INSERT INTO expense_categories (company_id, name, code, is_active, category_type)
               VALUES (${company.id}, '${name}', '${cat.code}', true, 'expense')`,
            ));
          } catch {}
        }
      }
    }
  } catch {
    _presetSeeded = false;
  }
}

// ── Middleware Authentication ──
router.use(async (req, res, next) => {
  if (!(await requireClerkUser(req, res))) return;
  await ensureExpenseColumns();
  await ensureExpenseCategoriesCompanyScoped();
  await ensurePresetRoutineCategories();
  next();
});

// ── GET /api/expenses/payment-accounts ──
// Mengembalikan akun Kas & Bank dari COA untuk dropdown Sumber Dana.
// Filter: type='asset' DAN (subtype='cash_bank' ATAU kode prefix standar 1-101x/1-102x).
// Ini memastikan semua akun kas/bank yang terdaftar di COA muncul, bukan hanya kode hardcoded.
router.get("/payment-accounts", async (req: Request, res) => {
  const scope = resolveCompanyScope(req);

  // Filter kas/bank: subtype eksplisit ATAU kode prefix standar Indonesia
  const kasOrBankFilter = or(
    eq(chartOfAccountsTable.subtype, "cash_bank"),
    like(chartOfAccountsTable.code, "1-101%"),
    like(chartOfAccountsTable.code, "1-102%"),
  );

  // Saat mode konsolidasi (?company=all), kembalikan akun dari SEMUA perusahaan
  // tanpa akun global (company_id IS NULL) agar setiap akun punya company_id valid.
  // Ini memungkinkan frontend menderivasi effectiveCompanyId dari akun yang dipilih.
  const companyFilter = scope === "all"
    ? sql`${chartOfAccountsTable.companyId} IS NOT NULL`
    : or(
        eq(chartOfAccountsTable.companyId, scope),
        isNull(chartOfAccountsTable.companyId),
      );

  const rows = await db
    .select({
      id: chartOfAccountsTable.id,
      code: chartOfAccountsTable.code,
      name: chartOfAccountsTable.name,
      subtype: chartOfAccountsTable.subtype,
      isActive: chartOfAccountsTable.isActive,
      companyId: chartOfAccountsTable.companyId,
    })
    .from(chartOfAccountsTable)
    .where(
      and(
        eq(chartOfAccountsTable.type, "asset"),
        kasOrBankFilter,
        companyFilter,
        eq(chartOfAccountsTable.isActive, true),
      ),
    )
    .orderBy(chartOfAccountsTable.code);

  const result = rows.map((r) => {
    const isKas = r.code.startsWith("1-101") ||
      (r.subtype === "cash_bank" && !r.code.startsWith("1-102"));
    return {
      id: r.id,
      code: r.code,
      name: r.name,
      subtype: r.subtype ?? "cash_bank",
      account_class: isKas ? "kas" : "bank",
      company_id: r.companyId ?? null,
    };
  });

  return res.json(result);
});

// ── Helpers ──
function serializeCategory(c: any) {
  return {
    id: c.id,
    companyId: c.company_id ?? c.companyId ?? null,
    name: c.name,
    code: c.code,
    expenseAccountId: c.expense_account_id ?? c.expenseAccountId ?? null,
    payableAccountId: c.payable_account_id ?? c.payableAccountId ?? null,
    defaultTaxId: c.default_tax_id ?? c.defaultTaxId ?? null,
    defaultAmount: c.default_amount ?? c.defaultAmount ?? null,
    defaultCoaId: c.default_coa_id ?? c.defaultCoaId ?? null,
    requiresAttachment: c.requires_attachment ?? c.requiresAttachment ?? false,
    isActive: c.is_active ?? c.isActive ?? true,
    categoryType: c.category_type ?? c.categoryType ?? "both",
    createdAt: c.created_at ?? c.createdAt ?? null,
  };
}

function serializeExpense(e: any) {
  return {
    id: Number(e.id),
    companyId: e.company_id ?? e.companyId ?? null,
    expenseNumber: e.expense_number ?? e.expenseNumber,
    date: e.date,
    vendorEmployee: e.vendor_employee ?? e.vendorEmployee ?? null,
    expenseType: e.expense_type ?? e.expenseType ?? "vendor_bill",
    transactionType: e.transaction_type ?? e.transactionType ?? "expense",
    salesDocId: e.sales_doc_id ?? e.salesDocId ?? null,
    shipmentId: e.shipment_id ?? e.shipmentId ?? null,
    categoryId: e.category_id ?? e.categoryId ?? null,
    description: e.description ?? null,
    qty: Number(e.qty ?? 1),
    unit: e.unit ?? null,
    unitPrice: Number(e.unit_price ?? e.unitPrice ?? 0),
    subtotal: Number(e.subtotal ?? 0),
    taxRateId: e.tax_rate_id ?? e.taxRateId ?? null,
    taxAmount: Number(e.tax_amount ?? e.taxAmount ?? 0),
    total: Number(e.total ?? 0),
    currency: e.currency ?? "IDR",
    status: e.status ?? "draft",
    notes: e.notes ?? null,
    entryId: e.entry_id ?? e.entryId ?? null,
    disbursementId: e.disbursement_id ?? e.disbursementId ?? null,
    expenseAccountId: e.expense_account_id ?? e.expenseAccountId ?? null,
    payableAccountId: e.payable_account_id ?? e.payableAccountId ?? null,
    sourceAccountId: e.source_account_id ?? e.sourceAccountId ?? null,
    vendorId: e.vendor_id ?? e.vendorId ?? null,
    userId: e.user_id ?? e.userId ?? null,
    rejectionReason: e.rejection_reason ?? e.rejectionReason ?? null,
    createdById: e.created_by_id ?? e.createdById ?? null,
    createdAt: e.created_at ?? e.createdAt,
    updatedAt: e.updated_at ?? e.updatedAt,
  };
}

async function nextExpenseNumber(): Promise<string> {
  const year = new Date().getFullYear();
  // Use MAX of the numeric sequence instead of COUNT so that gaps from
  // deleted expenses never produce a duplicate number (unique constraint).
  const rows = await db.execute(
    sql.raw(
      `SELECT COALESCE(MAX(CAST(SPLIT_PART(expense_number, '/', 3) AS INTEGER)), 0) AS max_seq
       FROM expenses
       WHERE expense_number LIKE 'EXP/${year}/%'`,
    ),
  );
  const maxSeq = Number((rows.rows[0] as any)?.max_seq ?? 0);
  return `EXP/${year}/${(maxSeq + 1).toString().padStart(5, "0")}`;
}

/**
 * Insert an expense row with automatic retry on expense_number collision.
 *
 * Two concurrent requests can read the same MAX and both attempt the same
 * next number. Only one INSERT wins; the loser retries with a fresh MAX so
 * it always gets the true next available number. Up to MAX_RETRIES attempts
 * are made before the error is re-thrown.
 */
const MAX_EXPENSE_NUMBER_RETRIES = 5;
async function insertExpenseWithRetry(
  values: Record<string, unknown>,
  lineData?: { companyId: number; lines: NormalizedExpenseLine[]; taxAmount: number },
): Promise<Record<string, unknown>> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= MAX_EXPENSE_NUMBER_RETRIES; attempt++) {
    const expenseNumber = await nextExpenseNumber();
    try {
      const created = lineData
        ? await db.transaction(async (tx) => {
            const [inserted] = await tx
              .insert(expensesTable)
              .values({ ...values, expenseNumber } as any)
              .returning();
            await insertExpenseLines(tx, Number(inserted.id), lineData.companyId, lineData.lines, lineData.taxAmount);
            return inserted;
          })
        : (await db
            .insert(expensesTable)
            .values({ ...values, expenseNumber } as any)
            .returning())[0];
      return created as Record<string, unknown>;
    } catch (err: any) {
      // PG code 23505 = unique_violation; retry only when expense_number is the culprit.
      const isExpenseNumConflict =
        err?.code === "23505" &&
        (err?.constraint?.includes("expense_number") ||
          err?.message?.includes("expense_number"));
      if (isExpenseNumConflict && attempt < MAX_EXPENSE_NUMBER_RETRIES) {
        lastErr = err;
        continue;
      }
      throw err;
    }
  }
  throw lastErr ?? new Error("Failed to generate a unique expense number");
}

// ── Expense Categories CRUD ──
router.get("/categories", async (req, res) => {
  const companyId = resolveCompanyId(req as Request);
  const { type } = req.query as Record<string, string>;
  const rows = await db.execute(sql.raw(
    `SELECT * FROM expense_categories WHERE company_id = ${companyId} ORDER BY name`
  ));
  let cats = rows.rows.map(serializeCategory);
  if (type === "income") {
    cats = cats.filter((c) => c.categoryType === "income" || c.categoryType === "both");
  } else if (type === "expense") {
    cats = cats.filter((c) => c.categoryType === "expense" || c.categoryType === "both");
  }
  return res.json(cats);
});

router.post("/categories", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const companyId = resolveCompanyId(req as Request);
  const { name, code, expenseAccountId, payableAccountId, defaultTaxId, defaultAmount, defaultCoaId, requiresAttachment, isActive, categoryType } = req.body ?? {};
  if (!name || !code) return res.status(400).json({ message: "name and code are required" });

  const [created] = await db
    .insert(expenseCategoriesTable)
    .values({
      companyId,
      name: String(name),
      code: String(code).toUpperCase(),
      expenseAccountId: expenseAccountId ? Number(expenseAccountId) : null,
      payableAccountId: payableAccountId ? Number(payableAccountId) : null,
      defaultTaxId: defaultTaxId ? Number(defaultTaxId) : null,
      defaultAmount: defaultAmount ? String(Number(defaultAmount)) : null,
      defaultCoaId: defaultCoaId ? Number(defaultCoaId) : null,
      requiresAttachment: Boolean(requiresAttachment),
      isActive: isActive !== false,
    } as any)
    .returning();

  if (categoryType && ["expense", "income", "both"].includes(categoryType)) {
    await db.execute(sql.raw(`UPDATE expense_categories SET category_type = '${categoryType}' WHERE id = ${(created as any).id}`));
  }

  const row = (await db.execute(sql.raw(`SELECT * FROM expense_categories WHERE id = ${(created as any).id}`))).rows[0];
  return res.status(201).json(serializeCategory(row));
});

// Seed preset kategori rutin (idempotent by code)
const PRESET_ROUTINE_CATEGORIES = [
  { code: "ENTERTAINMENT", name: "Entertainment" },
  { code: "MAKAN_MINUM", name: "Makan & Minum" },
  { code: "SEWA_KANTOR", name: "Sewa Kantor" },
  { code: "UTILITAS", name: "Utilitas" },
  { code: "PERALATAN", name: "Peralatan & ATK" },
  { code: "LAIN_LAIN", name: "Lain-lain" },
];

router.post("/seed-categories", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const companyId = resolveCompanyId(req as Request);

  // 1. Drop any leftover global-unique constraint on code (may still exist if migration failed)
  const dropStmts = [
    `ALTER TABLE expense_categories DROP CONSTRAINT IF EXISTS expense_categories_code_key`,
    `ALTER TABLE expense_categories DROP CONSTRAINT IF EXISTS expense_categories_code_unique`,
    `DROP INDEX IF EXISTS expense_categories_code_key`,
    `DROP INDEX IF EXISTS uq_expense_categories_code`,
  ];
  for (const stmt of dropStmts) {
    try { await db.execute(sql.raw(stmt)); } catch {}
  }

  // 2. Ensure per-company unique index exists
  try {
    await db.execute(sql.raw(
      `CREATE UNIQUE INDEX IF NOT EXISTS expense_categories_company_code_uniq ON expense_categories (company_id, code)`,
    ));
  } catch {}

  // 3. Migrate any null-company templates to this company, then delete them
  const nullRows = (await db.execute(sql.raw(
    `SELECT id, code, name FROM expense_categories WHERE company_id IS NULL`,
  ))).rows as any[];
  for (const tpl of nullRows) {
    const codeUpper = String(tpl.code ?? "").toUpperCase();
    const nameEsc = String(tpl.name ?? "").replace(/'/g, "''");
    const already = (await db.execute(sql.raw(
      `SELECT id FROM expense_categories WHERE company_id = ${companyId} AND UPPER(code) = '${codeUpper.replace(/'/g, "''")}'`,
    ))).rows[0];
    if (!already) {
      try {
        await db.execute(sql.raw(
          `INSERT INTO expense_categories (company_id, name, code, is_active, category_type)
           VALUES (${companyId}, '${nameEsc}', '${codeUpper}', true, 'expense')`,
        ));
      } catch {}
    }
    try { await db.execute(sql.raw(`DELETE FROM expense_categories WHERE id = ${tpl.id}`)); } catch {}
  }

  // 4. Now check what's missing for this company and insert
  const existing = await db.execute(sql.raw(`SELECT code FROM expense_categories WHERE company_id = ${companyId}`));
  const existingCodes = new Set(
    (existing.rows as any[]).map((r) => String(r.code ?? "").toUpperCase()),
  );

  const toCreate = PRESET_ROUTINE_CATEGORIES.filter(
    (c) => !existingCodes.has(c.code),
  );

  let seeded = 0;
  for (const cat of toCreate) {
    const name = cat.name.replace(/'/g, "''");
    const code = cat.code.replace(/'/g, "''");
    try {
      const result = await db.execute(sql.raw(
        `INSERT INTO expense_categories (company_id, name, code, is_active, category_type)
         VALUES (${companyId}, '${name}', '${code}', true, 'expense')
         RETURNING id`,
      ));
      if ((result.rows as any[]).length > 0) seeded += 1;
    } catch {}
  }

  const total = (await db.execute(sql.raw(
    `SELECT id FROM expense_categories WHERE company_id = ${companyId}`,
  ))).rows.length;

  return res.json({ seeded, total: PRESET_ROUTINE_CATEGORIES.length, totalInDb: total });
});

router.patch("/categories/:id", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const id = Number(String(req.params.id));
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });

  const companyId = resolveCompanyId(req as Request);
  const [existingCat] = await db.select().from(expenseCategoriesTable).where(eq(expenseCategoriesTable.id, id));
  if (!existingCat) return res.status(404).json({ message: "Not found" });
  if (!(await assertCompanyAccess((existingCat as any).companyId, companyId, req as Request, res, { resourceType: "expense_category", resourceId: id }))) return;

  const { name, code, expenseAccountId, payableAccountId, defaultTaxId, defaultAmount, defaultCoaId, requiresAttachment, isActive, categoryType } = req.body ?? {};
  const update: Record<string, unknown> = {};
  if (name !== undefined) update.name = String(name);
  if (code !== undefined) update.code = String(code).toUpperCase();
  if (expenseAccountId !== undefined) update.expenseAccountId = expenseAccountId ? Number(expenseAccountId) : null;
  if (payableAccountId !== undefined) update.payableAccountId = payableAccountId ? Number(payableAccountId) : null;
  if (defaultTaxId !== undefined) update.defaultTaxId = defaultTaxId ? Number(defaultTaxId) : null;
  if (defaultAmount !== undefined) update.defaultAmount = defaultAmount ? String(Number(defaultAmount)) : null;
  if (defaultCoaId !== undefined) update.defaultCoaId = defaultCoaId ? Number(defaultCoaId) : null;
  if (requiresAttachment !== undefined) update.requiresAttachment = Boolean(requiresAttachment);
  if (isActive !== undefined) update.isActive = Boolean(isActive);

  if (Object.keys(update).length > 0) {
    const [updated] = await db.update(expenseCategoriesTable).set(update as any).where(eq(expenseCategoriesTable.id, id)).returning();
    if (!updated) return res.status(404).json({ message: "Not found" });
  }

  if (categoryType && ["expense", "income", "both"].includes(categoryType)) {
    await db.execute(sql.raw(`UPDATE expense_categories SET category_type = '${categoryType}' WHERE id = ${id}`));
  }

  const row = (await db.execute(sql.raw(`SELECT * FROM expense_categories WHERE id = ${id}`))).rows[0];
  if (!row) return res.status(404).json({ message: "Not found" });
  return res.json(serializeCategory(row));
});

router.delete("/categories/:id", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const id = Number(String(req.params.id));
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });

  const companyId = resolveCompanyId(req as Request);
  const [existingCat] = await db.select().from(expenseCategoriesTable).where(eq(expenseCategoriesTable.id, id));
  if (!existingCat) return res.status(404).json({ message: "Not found" });
  if (!(await assertCompanyAccess((existingCat as any).companyId, companyId, req as Request, res, { resourceType: "expense_category", resourceId: id }))) return;

  await db.delete(expenseCategoriesTable).where(eq(expenseCategoriesTable.id, id));
  return res.json({ message: "Deleted" });
});

// ── Expenses CRUD ──
router.get("/", async (req: Request, res) => {
  const companyId = resolveCompanyId(req);
  const { status, categoryId, expenseType, transactionType, salesDocId, shipmentId, search, from, to } = req.query as Record<string, string>;

  const whereParts: string[] = [`e.company_id = ${companyId}`];
  if (status) whereParts.push(`e.status = '${status.replace(/'/g, "''")}'`);
  if (categoryId) whereParts.push(`e.category_id = ${Number(categoryId)}`);
  if (expenseType) whereParts.push(`e.expense_type = '${expenseType.replace(/'/g, "''")}'`);
  if (transactionType) whereParts.push(`e.transaction_type = '${transactionType.replace(/'/g, "''")}'`);
  if (salesDocId) whereParts.push(`e.sales_doc_id = ${Number(salesDocId)}`);
  if (shipmentId) whereParts.push(`e.shipment_id = ${Number(shipmentId)}`);
  if (from) whereParts.push(`e.date >= '${from}'`);
  if (to) whereParts.push(`e.date <= '${to}'`);

  const result = await db.execute(sql.raw(`
    SELECT e.*,
      ec.name   AS category_name,
      coa.name  AS source_account_name,
      coa.code  AS source_account_code,
      sup.name  AS vendor_name,
      u.name    AS user_name,
      u.email   AS user_email
    FROM expenses e
    LEFT JOIN expense_categories ec  ON e.category_id      = ec.id
    LEFT JOIN chart_of_accounts coa  ON e.source_account_id = coa.id
    LEFT JOIN suppliers sup          ON e.vendor_id         = sup.id
    LEFT JOIN users u                ON e.user_id           = u.id
    WHERE ${whereParts.join(" AND ")}
    ORDER BY e.date DESC, e.id DESC
    LIMIT 500
  `));

  let rows = result.rows as any[];

  if (search) {
    const q = search.toLowerCase();
    rows = rows.filter(
      (r) =>
        (r.expense_number ?? "").toLowerCase().includes(q) ||
        (r.vendor_employee ?? "").toLowerCase().includes(q) ||
        (r.vendor_name ?? "").toLowerCase().includes(q) ||
        (r.user_name ?? "").toLowerCase().includes(q) ||
        (r.description ?? "").toLowerCase().includes(q)
    );
  }

  return res.json(rows.map((r) => ({
    ...serializeExpense(r),
    categoryName: r.category_name ?? null,
    sourceAccountName: r.source_account_name ?? null,
    vendor: r.vendor_id ? { id: Number(r.vendor_id), name: r.vendor_name } : null,
    user: r.user_id ? { id: r.user_id, name: r.user_name, email: r.user_email } : null,
    sourceAccount: r.source_account_id ? { id: Number(r.source_account_id), name: r.source_account_name, code: r.source_account_code } : null,
    category: r.category_id ? { id: Number(r.category_id), name: r.category_name } : null,
  })));
});

router.get("/:id", async (req: Request, res) => {
  if (req.params.id === "missing-journals") {
    const companyId = resolveCompanyId(req);
    const rows = await db.execute(sql.raw(`
      SELECT e.id, e.expense_number, e.date, e.description, e.total, e.transaction_type, e.status,
             ec.name AS category_name
      FROM expenses e
      LEFT JOIN expense_categories ec ON ec.id = e.category_id
      WHERE e.status = 'active' AND e.entry_id IS NULL
        ${companyId ? `AND e.company_id = ${companyId}` : ""}
      ORDER BY e.date DESC, e.id DESC
      LIMIT 500
    `));
    return res.json({ count: rows.rows.length, items: rows.rows });
  }
  const id = Number(String(req.params.id));
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ message: "Invalid id" });
  const row = (await db.execute(sql.raw(`SELECT * FROM expenses WHERE id = ${id}`))).rows[0] as any;
  if (!row) return res.status(404).json({ message: "Expense tidak ditemukan" });
  const companyId = resolveCompanyId(req);
  if (!await assertCompanyAccess(Number(row.company_id) || null, companyId, req, res, { resourceType: "expense", resourceId: id })) return;
  const lineRows = (await db.execute(sql.raw(
    `SELECT id, line_no, description, qty, unit, unit_price, subtotal, tax_amount, total, coa_account_id, coa_resolution_status
       FROM expense_lines WHERE expense_id = ${id} ORDER BY line_no, id`,
  ))).rows as any[];
  const attachmentRows = (await db.select().from(expenseAttachmentsTable)
    .where(eq(expenseAttachmentsTable.expenseId, id))).map((attachment: any) => ({
      id: Number(attachment.id),
      expenseId: Number(attachment.expenseId),
      objectPath: attachment.objectPath,
      fileName: attachment.fileName,
      contentType: attachment.contentType,
      createdAt: attachment.createdAt,
    }));
  return res.json({
    ...serializeExpense(row),
    lines: lineRows.map((line) => ({
      id: Number(line.id),
      lineNo: Number(line.line_no),
      description: line.description,
      qty: Number(line.qty),
      unit: line.unit,
      unitPrice: Number(line.unit_price),
      subtotal: Number(line.subtotal),
      taxAmount: Number(line.tax_amount),
      total: Number(line.total),
      coaAccountId: Number(line.coa_account_id),
      coaResolutionStatus: line.coa_resolution_status,
    })),
    attachments: attachmentRows,
  });
});

router.post("/", createIdempotencyMiddleware("expense:create"), async (req, res) => {
  const { date, categoryId, description, qty, unitPrice, taxRateId, expenseAccountId, sourceAccountId, vendorId, userId, expenseType, transactionType, unit, currency, notes, payableAccountId, salesDocId, shipmentId, vendorEmployee, lines: rawLines } = req.body ?? {};
  if (!date) return res.status(400).json({ message: "date required" });
  if (!categoryId) return res.status(400).json({ message: "Kategori wajib dipilih." });
  if (payableAccountId) {
    return res.status(400).json({ message: "Direct expense tidak boleh memakai akun hutang. Gunakan Vendor Invoice/AP untuk transaksi kredit." });
  }

  const companyIdForInsert = resolveCompanyId(req as Request);
  const [category] = await db.select().from(expenseCategoriesTable)
    .where(and(eq(expenseCategoriesTable.id, Number(categoryId)), eq(expenseCategoriesTable.companyId, companyIdForInsert)));
  if (!category) return res.status(400).json({ message: "Kategori tidak ditemukan untuk company aktif." });

  const fallbackExpenseAccountId = expenseAccountId ? Number(expenseAccountId) : Number((category as any).expenseAccountId ?? 0);
  let lines: NormalizedExpenseLine[];
  try {
    lines = normalizeExpenseLines(rawLines, { description, qty, unit, unitPrice, expenseAccountId: fallbackExpenseAccountId });
    await validateExpenseAccounts(companyIdForInsert, lines, sourceAccountId ? Number(sourceAccountId) : null);
  } catch (error: any) {
    return res.status(400).json({ message: error?.message ?? "Line expense tidak valid." });
  }
  const qtyN = lines[0].qty;
  const upN = lines[0].unitPrice;
  const subtotal = roundMoney(lines.reduce((sum, line) => sum + line.subtotal, 0));

  let taxAmountN = 0;
  if (taxRateId) {
    const [tax] = await db.select().from(accountingTaxesTable).where(eq(accountingTaxesTable.id, Number(taxRateId)));
    if (tax?.kind === "withholding") {
      return res.status(400).json({ message: "PPh potong harus diproses melalui Vendor Invoice/AP, bukan direct expense." });
    }
    if (tax) taxAmountN = Math.round(subtotal * Number(tax.rate) / 100 * 100) / 100;
  }
  const total = subtotal + taxAmountN;

  const txType = (transactionType === "income" ? "income" : "expense");

  const created = await insertExpenseWithRetry({
    companyId: companyIdForInsert,
    date: String(date),
    categoryId: Number(categoryId),
    description: description ? String(description) : null,
    qty: String(qtyN),
    unit: unit ? String(unit) : null,
    unitPrice: String(upN),
    subtotal: String(subtotal),
    taxRateId: taxRateId ? Number(taxRateId) : null,
    taxAmount: String(taxAmountN),
    total: String(total),
    currency: currency ? String(currency) : "IDR",
    notes: notes ? String(notes) : null,
    expenseAccountId: lines[0].coaAccountId,
    payableAccountId: null,
    sourceAccountId: sourceAccountId ? Number(sourceAccountId) : null,
    vendorId: vendorId ? Number(vendorId) : null,
    userId: userId ? String(userId) : null,
    vendorEmployee: vendorEmployee ? String(vendorEmployee) : null,
    expenseType: expenseType ? String(expenseType) : "vendor_bill",
    salesDocId: salesDocId ? Number(salesDocId) : null,
    shipmentId: shipmentId ? Number(shipmentId) : null,
    status: "draft",
    createdById: (req as { userId?: string }).userId ?? null,
  }, { companyId: Number(companyIdForInsert), lines, taxAmount: taxAmountN });

  if (txType !== "expense") {
    await db.execute(sql.raw(`UPDATE expenses SET transaction_type = '${txType}' WHERE id = ${(created as any).id}`));
  }

  if (taxAmountN > 0) {
    import("../lib/taxAutoService.js").then(({ recordTransactionTax }) => {
      void recordTransactionTax({
        companyId: companyIdForInsert ?? 1,
        transactionType: "expense",
        transactionId: (created as any).id,
        transactionRef: (created as any).expenseNumber,
        baseAmount: subtotal,
        taxAmount: taxAmountN,
      });
    }).catch(() => {/* ignore */});
  }

  // Auto-post jurnal jika akun beban dan akun sumber sudah tersedia (dari form atau dari kategori)
  // Ini agar expense langsung muncul di Laba Rugi tanpa perlu manual "Post Jurnal"
  let autoPostedEntry: { id: number } | null = null;
  const createdId = (created as any).id;
  try {
    if (sourceAccountId) {
      autoPostedEntry = await postQuickExpenseJournal(createdId);
    }
  } catch (_autoPostErr) {
    // Non-fatal: biarkan expense tetap draft jika auto-post gagal
  }

  auditFromReq(req as Request, {
    action: "create",
    module: "expense",
    referenceId: String(createdId),
    newData: { expenseNumber: (created as any).expenseNumber, total: String(total), status: autoPostedEntry ? "active" : "draft", transactionType: txType },
  });

  // Kembalikan data terbaru (status sudah di-update oleh postQuickExpenseJournal jika sukses)
  const finalStatus = autoPostedEntry ? "active" : (created as any).status ?? "draft";
  return res.status(201).json(serializeExpense({ ...(created as any), transaction_type: txType, status: finalStatus, entry_id: autoPostedEntry?.id ?? null }));
});

// ── POST /api/expenses/quick ── Quick expense entry (Biaya Rutin form) ──
// Payload dari frontend: { date, categoryId, amount, vendorEmployee, notes,
// taxRateId, paymentMethod, sourceAccountId, debitAccountId }.
// Membuat expense record lalu auto-post jurnal jika akun beban & sumber lengkap.
router.post("/quick", async (req, res) => {
  try {
    const {
      date, categoryId, amount, vendorEmployee, notes,
      taxRateId, sourceAccountId, debitAccountId,
    } = req.body ?? {};

    if (!date) return res.status(400).json({ message: "Tanggal wajib diisi." });
    if (!categoryId) return res.status(400).json({ message: "Kategori wajib dipilih." });
    const amountN = Number(amount ?? 0);
    if (!(amountN > 0)) return res.status(400).json({ message: "Nominal harus lebih besar dari 0." });
    if (!sourceAccountId) return res.status(400).json({ message: "Akun Sumber (Kredit) wajib dipilih." });

    let taxAmountN = 0;
    if (taxRateId) {
      const [tax] = await db.select().from(accountingTaxesTable).where(eq(accountingTaxesTable.id, Number(taxRateId)));
      if (tax) taxAmountN = Math.round((amountN / (1 + Number(tax.rate) / 100)) * (Number(tax.rate) / 100) * 100) / 100;
    }
    const subtotal = Math.round((amountN - taxAmountN) * 100) / 100;

    const companyIdForInsert = resolveCompanyId(req as Request);

    let resolvedExpenseAccountId: number | null = debitAccountId ? Number(debitAccountId) : null;
    if (!resolvedExpenseAccountId) {
      const [cat] = await db.select().from(expenseCategoriesTable)
        .where(and(eq(expenseCategoriesTable.id, Number(categoryId)), eq(expenseCategoriesTable.companyId, companyIdForInsert)));
      resolvedExpenseAccountId = (cat as any)?.expense_account_id ? Number((cat as any).expense_account_id) : null;
    }

    const created = await insertExpenseWithRetry({
      companyId: companyIdForInsert,
      date: String(date),
      categoryId: Number(categoryId),
      description: notes ? String(notes) : null,
      qty: "1",
      unitPrice: String(subtotal),
      subtotal: String(subtotal),
      taxRateId: taxRateId ? Number(taxRateId) : null,
      taxAmount: String(taxAmountN),
      total: String(amountN),
      currency: "IDR",
      notes: notes ? String(notes) : null,
      expenseAccountId: resolvedExpenseAccountId,
      sourceAccountId: sourceAccountId ? Number(sourceAccountId) : null,
      vendorEmployee: vendorEmployee ? String(vendorEmployee) : null,
      expenseType: "routine",
      status: "draft",
      createdById: (req as { userId?: string }).userId ?? null,
    });

    const createdId = (created as any).id;

    if (taxAmountN > 0) {
      import("../lib/taxAutoService.js").then(({ recordTransactionTax }) => {
        void recordTransactionTax({
          companyId: companyIdForInsert ?? 1,
          transactionType: "expense",
          transactionId: createdId,
          transactionRef: (created as any).expenseNumber,
          baseAmount: subtotal,
          taxAmount: taxAmountN,
        });
      }).catch(() => {/* ignore */});
    }

    let autoPostedEntry: { id: number } | null = null;
    try {
      if (resolvedExpenseAccountId && sourceAccountId) {
        autoPostedEntry = await postQuickExpenseJournal(createdId);
      }
    } catch (_autoPostErr) {
      // Non-fatal: biarkan expense tetap draft jika auto-post gagal
    }

    auditFromReq(req as Request, {
      action: "create",
      module: "expense",
      referenceId: String(createdId),
      newData: { expenseNumber: (created as any).expenseNumber, total: String(amountN), status: autoPostedEntry ? "active" : "draft" },
    });

    const finalStatus = autoPostedEntry ? "active" : (created as any).status ?? "draft";
    return res.status(201).json(serializeExpense({
      ...(created as any),
      status: finalStatus,
      entry_id: autoPostedEntry?.id ?? null,
    }));
  } catch (err: any) {
    return res.status(500).json({ message: err?.message ?? "Gagal menyimpan biaya rutin." });
  }
});

router.patch("/:id", async (req, res) => {
  const id = Number(String(req.params.id));
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });

  const [existing] = await db.execute(sql.raw(`SELECT * FROM expenses WHERE id = ${id}`)).then((r) => r.rows);
  if (!existing) return res.status(404).json({ message: "Not found" });
  const exp = existing as any;
  // IDOR guard
  const companyId = resolveCompanyId(req);
  if (!await assertCompanyAccess(exp.company_id, companyId, req, res, { resourceType: "expense", resourceId: id })) return;
  if (exp.status !== "draft" && exp.status !== "rejected") {
    return res.status(400).json({ message: "Hanya expense berstatus draft atau rejected yang bisa diedit." });
  }

  const {
    date, categoryId, description, qty, unitPrice, taxRateId,
    expenseAccountId, payableAccountId, sourceAccountId,
    vendorId, userId, vendorEmployee, expenseType, transactionType,
    unit, currency, notes, salesDocId, shipmentId, lines: rawLines,
  } = req.body ?? {};
  if (payableAccountId) {
    return res.status(400).json({ message: "Direct expense tidak boleh memakai akun hutang. Gunakan Vendor Invoice/AP." });
  }

  const qtyN = qty !== undefined ? Number(qty) : Number(exp.qty ?? 1);
  const upN = unitPrice !== undefined ? Number(unitPrice) : Number(exp.unit_price ?? 0);
  const subtotal = Math.round(qtyN * upN * 100) / 100;

  const taxId = taxRateId !== undefined ? (taxRateId ? Number(taxRateId) : null) : (exp.tax_rate_id ? Number(exp.tax_rate_id) : null);
  let taxAmountN = 0;
  if (taxId) {
    const [tax] = await db.select().from(accountingTaxesTable).where(eq(accountingTaxesTable.id, taxId));
    if (tax) taxAmountN = Math.round(subtotal * Number(tax.rate) / 100 * 100) / 100;
  }
  const total = subtotal + taxAmountN;
  let normalizedLines: NormalizedExpenseLine[];
  try {
    normalizedLines = normalizeExpenseLines(
      rawLines,
      {
        description: description ?? exp.description,
        qty: qty ?? exp.qty,
        unit: unit ?? exp.unit,
        unitPrice: unitPrice ?? exp.unit_price,
        expenseAccountId: expenseAccountId ?? exp.expense_account_id,
      },
    );
    await validateExpenseAccounts(companyId, normalizedLines, sourceAccountId !== undefined
      ? (sourceAccountId ? Number(sourceAccountId) : null)
      : (exp.source_account_id ? Number(exp.source_account_id) : null));
  } catch (error: any) {
    return res.status(400).json({ message: error?.message ?? "Line expense tidak valid." });
  }

  const sets: string[] = [
    `date = '${(date ?? exp.date).toString().replace(/'/g, "''")}'`,
    `qty = ${qtyN}`,
    `unit_price = ${upN}`,
    `subtotal = ${subtotal}`,
    `tax_amount = ${taxAmountN}`,
    `total = ${total}`,
    `updated_at = NOW()`,
  ];
  if (categoryId !== undefined) sets.push(`category_id = ${categoryId ? Number(categoryId) : "NULL"}`);
  if (description !== undefined) sets.push(`description = ${description ? `'${String(description).replace(/'/g, "''")}'` : "NULL"}`);
  if (taxId !== null) sets.push(`tax_rate_id = ${taxId}`);
  else if (taxRateId !== undefined) sets.push(`tax_rate_id = NULL`);
  if (expenseAccountId !== undefined) sets.push(`expense_account_id = ${expenseAccountId ? Number(expenseAccountId) : "NULL"}`);
  if (payableAccountId !== undefined) sets.push(`payable_account_id = ${payableAccountId ? Number(payableAccountId) : "NULL"}`);
  if (sourceAccountId !== undefined) sets.push(`source_account_id = ${sourceAccountId ? Number(sourceAccountId) : "NULL"}`);
  if (vendorId !== undefined) sets.push(`vendor_id = ${vendorId ? Number(vendorId) : "NULL"}`);
  if (userId !== undefined) sets.push(`user_id = ${userId ? `'${String(userId).replace(/'/g, "''")}'` : "NULL"}`);
  if (vendorEmployee !== undefined) sets.push(`vendor_employee = ${vendorEmployee ? `'${String(vendorEmployee).replace(/'/g, "''")}'` : "NULL"}`);
  if (expenseType !== undefined) sets.push(`expense_type = '${String(expenseType).replace(/'/g, "''")}'`);
  if (transactionType !== undefined && ["expense", "income"].includes(transactionType)) sets.push(`transaction_type = '${transactionType}'`);
  if (unit !== undefined) sets.push(`unit = ${unit ? `'${String(unit).replace(/'/g, "''")}'` : "NULL"}`);
  if (currency !== undefined) sets.push(`currency = '${String(currency).replace(/'/g, "''")}'`);
  if (notes !== undefined) sets.push(`notes = ${notes ? `'${String(notes).replace(/'/g, "''")}'` : "NULL"}`);
  if (salesDocId !== undefined) sets.push(`sales_doc_id = ${salesDocId ? Number(salesDocId) : "NULL"}`);
  if (shipmentId !== undefined) sets.push(`shipment_id = ${shipmentId ? Number(shipmentId) : "NULL"}`);

  await db.execute(sql.raw(`UPDATE expenses SET ${sets.join(", ")} WHERE id = ${id}`));
  await replaceExpenseLines(Number(id), Number(companyId), normalizedLines, taxAmountN);
  await replaceExpenseLines(Number(id), Number(companyId), normalizedLines, taxAmountN);

  const row = (await db.execute(sql.raw(`SELECT * FROM expenses WHERE id = ${id}`))).rows[0];

  auditFromReq(req as Request, {
    action: "update",
    module: "expense",
    referenceId: String(id),
    newData: { total: String(total), status: (row as any)?.status },
  });

  return res.json(serializeExpense(row));
});

// ─── Missing journals: list ────────────────────────────────────────────────
router.get("/missing-journals", async (req: Request, res) => {
  const companyId = resolveCompanyId(req);
  const rows = await db.execute(sql.raw(`
    SELECT e.id, e.expense_number, e.date, e.description, e.total, e.transaction_type, e.status,
           ec.name AS category_name
    FROM expenses e
    LEFT JOIN expense_categories ec ON ec.id = e.category_id
    WHERE e.status = 'active' AND e.entry_id IS NULL
      ${companyId ? `AND e.company_id = ${companyId}` : ""}
    ORDER BY e.date DESC, e.id DESC
    LIMIT 500
  `));
  return res.json({ count: rows.rows.length, items: rows.rows });
});

// ─── Re-post jurnal: single expense ────────────────────────────────────────
router.post("/:id/repost-journal", async (req: Request, res) => {
  const id = Number(String(req.params.id));
  if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  // IDOR guard
  const expRow = await db.execute(sql.raw(`SELECT company_id FROM expenses WHERE id = ${id}`)).then((r) => r.rows[0] as any);
  if (!expRow) return res.status(404).json({ message: "Expense not found" });
  const companyId = resolveCompanyId(req);
  if (!await assertCompanyAccess(Number(expRow.company_id) || null, companyId, req, res, { resourceType: "expense", resourceId: id })) return;
  try {
    const entry = await postQuickExpenseJournal(id);
    return res.json({ success: true, entryId: entry.id });
  } catch (e: any) {
    return res.status(400).json({ success: false, message: e.message });
  }
});

// ─── Re-post jurnal: bulk (semua yang missing) ─────────────────────────────
router.post("/bulk-repost", async (req: Request, res) => {
  const companyId = resolveCompanyId(req);
  const rows = await db.execute(sql.raw(`
    SELECT id FROM expenses
    WHERE status IN ('active', 'draft') AND entry_id IS NULL
      ${companyId ? `AND company_id = ${companyId}` : ""}
    ORDER BY date, id
    LIMIT 500
  `));
  const ids = (rows.rows as any[]).map((r) => Number(r.id));

  const bulkMeta = extractRequestMeta(req);
  writeAuditLog({
    ...bulkMeta, companyId: companyId ?? null, action: "BULK_OPERATION_VERIFIED", module: "expenses",
    newData: {
      operationType: "bulk-repost", recordCount: ids.length,
      timestamp: new Date().toISOString(),
    },
  });

  const results: { id: number; success: boolean; entryId?: number; error?: string }[] = [];
  for (const id of ids) {
    try {
      const entry = await postQuickExpenseJournal(id);
      results.push({ id, success: true, entryId: entry.id });
    } catch (e: any) {
      results.push({ id, success: false, error: e.message });
    }
  }
  const succeeded = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;
  return res.json({ total: ids.length, succeeded, failed, results });
});

// ─── Helper: post journal untuk expense / penerimaan lain ────────────────────
export async function postQuickExpenseJournal(expId: number) {
  const result = await db.execute(sql.raw(`
    SELECT e.*,
           ec.expense_account_id AS cat_expense_account_id,
           ec.ppn_input_account_id AS cat_ppn_input_account_id
    FROM expenses e
    LEFT JOIN expense_categories ec ON ec.id = e.category_id
    WHERE e.id = ${expId}
  `));
  const e = result.rows[0] as any;
  if (!e) throw new Error("Expense tidak ditemukan");
  if (e.entry_id) {
    const existingEntry = (await db.execute(sql.raw(
      `SELECT * FROM accounting_entries WHERE id = ${Number(e.entry_id)} LIMIT 1`,
    ))).rows[0] as any;
    if (existingEntry) return existingEntry;
  }

  const companyId: number | null = Number(e.company_id) || null;
  if (!companyId) throw new Error("Company context wajib tersedia untuk posting expense.");
  const settings = await ensureAccountingSettings(companyId ?? undefined);
  const txType: string = e.transaction_type ?? "expense";
  const amountN = Number(e.total ?? 0);
  // Pisahkan PPN Masukan agar masuk ke akun COA tersendiri (bukan digabung ke akun beban)
  const taxAmountN = Math.round(Number(e.tax_amount ?? 0) * 100) / 100;
  const netAmountN = Math.round((amountN - taxAmountN) * 100) / 100;
  const ppnInputAcctId: number | null =
    taxAmountN > 0
      ? (Number(e.ppn_input_account_id) || Number(e.cat_ppn_input_account_id) || settings.ppnInputAccountId || null)
      : null;

  // Direct expense hanya cash/bank. AP/withholding dimiliki Vendor Invoice.
  const sourceAccountId: number | null =
    Number(e.source_account_id) || null;
  if (!sourceAccountId || e.payable_account_id) {
    throw new Error("Direct expense wajib memiliki akun sumber Bank/Kas dan tidak boleh memiliki akun hutang.");
  }

  const lineRows = (await db.execute(sql.raw(
    `SELECT description, qty, unit_price, subtotal, tax_amount, total, coa_account_id
       FROM expense_lines
      WHERE expense_id = ${expId}
      ORDER BY line_no, id`,
  ))).rows as any[];
  const expenseAccountId: number | null =
    Number(e.expense_account_id) || Number(e.cat_expense_account_id) || null;
  if (!expenseAccountId && lineRows.length === 0) {
    throw new Error("Setiap line expense wajib memiliki COA existing.");
  }

  // Cari jurnal umum (general) sebagai wadah — cari dulu per company, lalu fallback global
  let journal = companyId
    ? (
        await db
          .select()
          .from(accountingJournalsTable)
          .where(and(eq(accountingJournalsTable.companyId, companyId), eq(accountingJournalsTable.type, "general" as any)))
          .limit(1)
      )[0]
    : undefined;
  if (!journal)
    journal = (
      await db
        .select()
        .from(accountingJournalsTable)
        .where(eq(accountingJournalsTable.type, "general" as any))
        .limit(1)
    )[0];
  if (!journal)
    journal = (await db.select().from(accountingJournalsTable).limit(1))[0];
  if (!journal) throw new Error("Jurnal tidak ditemukan di database.");

  const label = e.description ?? e.expense_number;
  const counterLabel = "Kas/Bank";

  const lines =
    txType === "income"
      ? [
          // Penerimaan lain: Debit Kas/Bank → Credit Pendapatan
          { accountId: sourceAccountId, debit: amountN, credit: 0, description: `Penerimaan — ${label}` },
          { accountId: expenseAccountId ?? lineRows[0]?.coa_account_id, debit: 0, credit: amountN, description: label },
        ]
      : ppnInputAcctId && taxAmountN > 0
        ? [
            // Direct expense: Debit setiap COA line + Debit PPN Masukan → Credit Bank/Kas.
            ...(lineRows.length > 0
              ? lineRows.map((line) => ({
                  accountId: Number(line.coa_account_id),
                  debit: roundMoney(Number(line.subtotal)),
                  credit: 0,
                  description: String(line.description ?? label),
                }))
              : [{ accountId: expenseAccountId!, debit: netAmountN, credit: 0, description: label }]),
            { accountId: ppnInputAcctId, debit: taxAmountN, credit: 0, description: `PPN Masukan — ${label}` },
            { accountId: sourceAccountId, debit: 0, credit: amountN, description: counterLabel },
          ]
        : [
            // Direct expense tanpa PPN: Debit setiap COA line → Credit Bank/Kas.
            ...(lineRows.length > 0
              ? lineRows.map((line) => ({
                  accountId: Number(line.coa_account_id),
                  debit: roundMoney(Number(line.total)),
                  credit: 0,
                  description: String(line.description ?? label),
                }))
              : [{ accountId: expenseAccountId!, debit: amountN, credit: 0, description: label }]),
            { accountId: sourceAccountId, debit: 0, credit: amountN, description: counterLabel },
          ];

  const entry = await postEntry(
    {
      journalId: journal.id,
      date: new Date(String(e.date)),
      ref: e.expense_number,
      description: `${e.expense_number} — ${label}`,
      source: "manual_payment",
      // Negative namespace avoids colliding with positive IDs from other
      // manual-payment producers while remaining stable for retries.
      sourceId: -expId,
      companyId,
      lines,
    },
    journal.code
  );

  await db.execute(
    sql.raw(
      `UPDATE expenses SET entry_id = ${entry.id}, status = 'active', updated_at = NOW() WHERE id = ${expId}`
    )
  );
  return entry;
}

// ── POST /api/expenses/:id/pay ── Bridge: Expense → Bank Disbursement ──────
// Membayar sebuah expense (status='active') via Bank Disbursement, membuat
// jurnal otomatis, dan menautkan kedua record via kolom bridge (tanpa
// menggabungkan tabel). Validasi: exists, approved (status='active'), belum
// dibayar, company match; semua ditulis dalam satu DB transaction.
router.post("/:id/pay", async (req: Request, res) => {
  const id = Number(String(req.params.id));
  if (isNaN(id)) return res.status(400).json({ message: "Invalid id" });

  const expRow = (await db.execute(sql.raw(`SELECT * FROM expenses WHERE id = ${id}`))).rows[0] as any;
  if (!expRow) return res.status(404).json({ message: "Expense tidak ditemukan" });

  const companyId = resolveCompanyId(req);
  if (!(await assertCompanyAccess(Number(expRow.company_id) || null, companyId, req, res, { resourceType: "expense", resourceId: id }))) return;

  // ── Validasi: sudah disetujui/terverifikasi ──────────────────────────────
  if (expRow.status !== "active") {
    return res.status(400).json({
      message: `Expense harus berstatus 'active' (disetujui/terjurnal) sebelum dapat dibayar. Status saat ini: '${expRow.status}'.`,
    });
  }

  // ── Validasi: belum pernah dibayar (bridge column) ───────────────────────
  if (expRow.disbursement_id) {
    return res.status(409).json({ message: "Expense ini sudah memiliki disbursement (sudah dibayar)." });
  }

  // Belt-and-suspenders — cek langsung ke bank_disbursements jika kolom bridge belum sinkron.
  const existingActive = (await db.execute(sql.raw(`
    SELECT id FROM bank_disbursements
    WHERE (expense_id = ${id} OR (source_module = 'expense' AND source_id = ${id}))
      AND status <> 'voided'
    LIMIT 1
  `))).rows[0];
  if (existingActive) {
    return res.status(409).json({ message: "Expense ini sudah memiliki disbursement aktif yang menunjuknya." });
  }

  const { bankAccountId, date: dateBody, memo } = (req.body ?? {}) as Record<string, unknown>;
  const bankAcctId = Number(bankAccountId);
  if (!bankAcctId) {
    return res.status(400).json({ message: "bankAccountId wajib diisi (akun kas/bank sumber pembayaran)." });
  }

  const [bankAcct] = await db.select().from(chartOfAccountsTable).where(eq(chartOfAccountsTable.id, bankAcctId));
  if (!bankAcct) return res.status(400).json({ message: "Akun kas/bank tidak ditemukan." });
  if (bankAcct.type !== "asset") {
    return res.status(400).json({ message: "Akun sumber pembayaran harus akun bertipe aset (kas/bank)." });
  }

  const amountN = Number(expRow.total ?? 0);
  if (!(amountN > 0)) return res.status(400).json({ message: "Nominal expense tidak valid untuk dibayar." });

  // ── Guard double-post jurnal: DR beban jika belum dijurnal, DR hutang jika sudah ──
  const hasEntry = expRow.entry_id != null;
  const payableAccountId = expRow.payable_account_id ? Number(expRow.payable_account_id) : null;
  const expenseAccountId = expRow.expense_account_id ? Number(expRow.expense_account_id) : null;

  if (!hasEntry) {
    return res.status(400).json({
      message: "Expense direct harus diposting terlebih dahulu. Pembayaran tidak boleh membuat jurnal debit Expense kedua.",
    });
  }
  if (!payableAccountId) {
    return res.status(400).json({
      message: "Expense ini sudah lunas melalui jurnal direct cash. Jangan proses ulang sebagai AP/Bank Disbursement.",
    });
  }
  const drAccountId = payableAccountId;
  const drLabel = "Pelunasan Hutang";

  const dateVal = dateBody ? new Date(String(dateBody)) : new Date();
  const label = expRow.description ?? expRow.expense_number;

  // ── Resolve jurnal umum (sama pola seperti postQuickExpenseJournal) ──────
  let journal = companyId
    ? (
        await db
          .select()
          .from(accountingJournalsTable)
          .where(and(eq(accountingJournalsTable.companyId, companyId), eq(accountingJournalsTable.type, "general" as any)))
          .limit(1)
      )[0]
    : undefined;
  if (!journal)
    journal = (
      await db.select().from(accountingJournalsTable).where(eq(accountingJournalsTable.type, "general" as any)).limit(1)
    )[0];
  if (!journal) journal = (await db.select().from(accountingJournalsTable).limit(1))[0];
  if (!journal) return res.status(400).json({ message: "Jurnal tidak ditemukan di database." });

  const lines = [
    { accountId: drAccountId, debit: amountN, credit: 0, description: `${drLabel} — ${label}` },
    { accountId: bankAcctId, debit: 0, credit: amountN, description: `Bank Disbursement — ${label}` },
  ];

  const entry = await postEntry(
    {
      journalId: journal.id,
      date: dateVal,
      ref: expRow.expense_number,
      description: memo ? String(memo) : `Bayar Expense ${expRow.expense_number} — ${label}`,
      source: "manual_payment",
      companyId,
      lines,
    },
    journal.code,
  );

  // ── Tulis bridge secara atomik (satu DB transaction): disbursement + item + update expense ──
  try {
    const cntRow = (await db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt FROM bank_disbursements WHERE company_id ${companyId ? `= ${companyId}` : "IS NULL"}`))).rows[0] as any;
    const year = new Date().getFullYear();
    const seq = String(Number(cntRow?.cnt ?? 0) + 1).padStart(4, "0");
    const disbNum = `BD/${year}/${seq}`;
    const dateStr = dateVal.toISOString().split("T")[0];

    const disbId: number = await db.transaction(async (tx) => {
      const insertedRows = (
        await tx.execute(sql`
          INSERT INTO bank_disbursements
            (company_id, disbursement_number, journal_id, date, ref, memo, total_amount, status, entry_id,
             created_by_id, source_module, source_id, source_number, payment_type, expense_id)
          VALUES
            (${companyId}, ${disbNum}, ${journal.id}, ${dateStr}, ${expRow.expense_number}, ${memo ? String(memo) : label},
             ${String(amountN)}, 'posted', ${entry.id}, ${(req as any).user?.id ?? null},
             'expense', ${id}, ${expRow.expense_number}, 'direct', ${id})
          RETURNING id
        `)
      ).rows as any[];
      const newDisbId = Number(insertedRows[0].id);

      await tx.execute(sql`
        INSERT INTO bank_disbursement_items
          (disbursement_id, seq, transaction_type, account_id, description, amount, notes)
        VALUES
          (${newDisbId}, 1, 'expense', ${drAccountId}, ${label}, ${String(amountN)}, ${drLabel})
      `);

      await tx.execute(sql`
        UPDATE expenses SET disbursement_id = ${newDisbId}, status = 'paid', updated_at = NOW() WHERE id = ${id}
      `);

      return newDisbId;
    });

    auditFromReq(req as Request, {
      action: "PAY_EXPENSE_VIA_DISBURSEMENT",
      module: "expense",
      referenceId: String(id),
      newData: { disbursementId: disbId, entryId: entry.id, amount: amountN, bankAccountId: bankAcctId, drAccountId, drLabel },
    });

    return res.status(201).json({ success: true, disbursementId: disbId, disbursementNumber: disbNum, entryId: entry.id, expenseId: id, status: "paid" });
  } catch (e: any) {
    // Kompensasi: jurnal sudah terposting tapi bridge write gagal → void jurnal agar tidak orphan.
    await voidAccountingEntry(
      entry.id,
      `Rollback otomatis: gagal menulis bridge disbursement untuk expense #${id} (${e.message})`,
      (req as any).user?.id,
    ).catch(() => {});
    const isConflict = /duplicate key|unique constraint|bank_disbursements_expense_active_uidx/i.test(String(e.message));
    return res.status(isConflict ? 409 : 500).json({
      message: isConflict
        ? "Expense ini sudah dibayar oleh disbursement lain (konflik konkuren)."
        : `Gagal memproses pembayaran: ${e.message}`,
    });
  }
});

// ── POST /api/expenses/kas-transfer ─── DEPRECATED (Phase 3) ─────────────────
// Guard is registered at the top of the router, before auth middleware.

// ── [Phase 3] POST /api/expenses/kas-transfer archived — see docs/deprecation/bank-disbursement-sole-executor.md
// Original: DR target / CR source via postEntry(). Now handled by Bank Disbursement (fund_transfer).

// ── GET /api/expenses/kas-transfer-history ────────────────────────────────────
router.get("/kas-transfer-history", async (req: Request, res) => {
  const companyId = resolveCompanyId(req);
  const { limit: lq = "50" } = req.query as Record<string, string>;
  const limitN = Math.min(200, parseInt(lq) || 50);

  const rows = await db.execute(sql.raw(`
    SELECT ae.id, ae.ref, ae.date, ae.description, ae.created_at,
           SUM(ael.debit) AS amount
    FROM accounting_entries ae
    JOIN accounting_entry_lines ael ON ael.entry_id = ae.id AND ael.debit > 0
    WHERE ae.ref LIKE 'KTF/%'
      AND (ae.company_id = ${companyId} OR ae.company_id IS NULL)
    GROUP BY ae.id, ae.ref, ae.date, ae.description, ae.created_at
    ORDER BY ae.created_at DESC
    LIMIT ${limitN}
  `));

  return res.json(rows.rows.map((r: any) => ({
    id: Number(r.id),
    ref: r.ref,
    date: r.date,
    description: r.description,
    amount: Number(r.amount),
    createdAt: r.created_at,
  })));
});

// ── Export router ──
export default router;
