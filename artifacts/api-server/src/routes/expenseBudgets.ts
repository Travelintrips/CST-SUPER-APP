/**
 * Fase 13: Multi-Currency & Budget
 * - currency_rates table: manual rate management (IDR base)
 * - expense_budgets table: budget per category per month/year
 * - Budget warning endpoint
 */
import { Router, type Request } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../lib/requireAdmin.js";
import { resolveCompanyId } from "../lib/resolveCompany.js";

const router = Router();
router.use(async (req, res, next) => {
  if (!(await requireAdmin(req, res))) return;
  next();
});

// ─── Inline migration ─────────────────────────────────────────────────────────
async function ensureTables() {
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS currency_rates (
      id SERIAL PRIMARY KEY,
      currency_code TEXT NOT NULL UNIQUE,
      currency_name TEXT NOT NULL,
      rate_to_idr NUMERIC(18,4) NOT NULL DEFAULT 1,
      symbol TEXT,
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    INSERT INTO currency_rates (currency_code, currency_name, rate_to_idr, symbol)
    VALUES
      ('IDR', 'Rupiah Indonesia', 1, 'Rp'),
      ('USD', 'US Dollar', 16000, '$'),
      ('EUR', 'Euro', 17500, '€'),
      ('SGD', 'Singapore Dollar', 12000, 'S$'),
      ('CNY', 'Chinese Yuan', 2200, '¥'),
      ('JPY', 'Japanese Yen', 107, '¥'),
      ('GBP', 'British Pound', 20000, '£'),
      ('AUD', 'Australian Dollar', 10500, 'A$'),
      ('MYR', 'Malaysian Ringgit', 3500, 'RM'),
      ('THB', 'Thai Baht', 440, '฿')
    ON CONFLICT (currency_code) DO NOTHING;

    CREATE TABLE IF NOT EXISTS expense_budgets (
      id SERIAL PRIMARY KEY,
      company_id INTEGER,
      year INTEGER NOT NULL,
      month INTEGER,
      category_id INTEGER,
      department TEXT,
      project TEXT,
      budget_amount NUMERIC(14,2) NOT NULL,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(company_id, year, month, category_id, department, project)
    );
    CREATE INDEX IF NOT EXISTS expense_budgets_company_idx ON expense_budgets(company_id);
    CREATE INDEX IF NOT EXISTS expense_budgets_year_idx ON expense_budgets(year, month);

    ALTER TABLE expenses ADD COLUMN IF NOT EXISTS currency_code TEXT DEFAULT 'IDR';
    ALTER TABLE expenses ADD COLUMN IF NOT EXISTS original_amount NUMERIC(14,2);
    ALTER TABLE expenses ADD COLUMN IF NOT EXISTS exchange_rate NUMERIC(18,4) DEFAULT 1;
    ALTER TABLE expenses ADD COLUMN IF NOT EXISTS department TEXT;
    ALTER TABLE expenses ADD COLUMN IF NOT EXISTS project TEXT;
  `));
}
let migrated = false;
async function runMigration() { if (!migrated) { await ensureTables(); migrated = true; } }

// ─────────────────────────────────────────────────────────────────────────────
// CURRENCY RATES
// ─────────────────────────────────────────────────────────────────────────────

router.get("/currencies", async (_req: Request, res) => {
  await runMigration();
  const rows = await db.execute(sql.raw(`SELECT * FROM currency_rates WHERE is_active = TRUE ORDER BY currency_code`)).catch(() => ({ rows: [] }));
  return res.json(rows.rows);
});

router.put("/currencies/:code", async (req: Request, res) => {
  await runMigration();
  const code = String(req.params.code).toUpperCase();
  const { ratToIdr, currencyName, symbol, isActive } = req.body;
  if (ratToIdr != null && parseFloat(ratToIdr) <= 0)
    return res.status(400).json({ message: "Rate harus lebih dari 0." });
  await db.execute(sql.raw(`
    UPDATE currency_rates SET
      rate_to_idr = ${ratToIdr != null ? parseFloat(ratToIdr) : "rate_to_idr"},
      currency_name = ${currencyName ? `'${String(currencyName).replace(/'/g, "''")}'` : "currency_name"},
      symbol = ${symbol !== undefined ? (symbol ? `'${String(symbol).replace(/'/g, "''")}'` : "NULL") : "symbol"},
      is_active = ${isActive !== undefined ? isActive : "is_active"},
      updated_at = NOW()
    WHERE currency_code = '${code}'
  `));
  const result = await db.execute(sql.raw(`SELECT * FROM currency_rates WHERE currency_code = '${code}'`));
  return res.json(result.rows[0] ?? { error: "Not found" });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUDGETS
// ─────────────────────────────────────────────────────────────────────────────

router.get("/budgets", async (req: Request, res) => {
  await runMigration();
  const companyId = resolveCompanyId(req);
  const { year = String(new Date().getFullYear()), month } = req.query as Record<string, string>;
  let where = `WHERE b.year = ${parseInt(year)}`;
  if (month) where += ` AND b.month = ${parseInt(month)}`;
  if (companyId) where += ` AND (b.company_id = ${companyId} OR b.company_id IS NULL)`;

  const rows = await db.execute(sql.raw(`
    SELECT b.*, c.name AS category_name, c.code AS category_code
    FROM expense_budgets b
    LEFT JOIN expense_categories c ON c.id = b.category_id
    ${where}
    ORDER BY b.month NULLS LAST, c.name
  `)).catch(() => ({ rows: [] }));
  return res.json(rows.rows);
});

router.post("/budgets", async (req: Request, res) => {
  await runMigration();
  const companyId = resolveCompanyId(req);
  const { year, month, categoryId, department, project, budgetAmount, notes } = req.body;
  if (!year) return res.status(400).json({ message: "Tahun wajib diisi." });
  if (!budgetAmount || parseFloat(budgetAmount) <= 0)
    return res.status(400).json({ message: "Nominal budget harus lebih dari 0." });
  const result = await db.execute(sql.raw(`
    INSERT INTO expense_budgets
      (company_id, year, month, category_id, department, project, budget_amount, notes)
    VALUES
      (${companyId ?? "NULL"}, ${parseInt(year)},
       ${month ? parseInt(month) : "NULL"},
       ${categoryId ? parseInt(categoryId) : "NULL"},
       ${department ? `'${String(department).replace(/'/g, "''")}'` : "NULL"},
       ${project    ? `'${String(project).replace(/'/g, "''")}'`    : "NULL"},
       ${parseFloat(budgetAmount)},
       ${notes ? `'${String(notes).replace(/'/g, "''")}'` : "NULL"})
    ON CONFLICT (company_id, year, month, category_id, department, project)
    DO UPDATE SET budget_amount = EXCLUDED.budget_amount, notes = EXCLUDED.notes, updated_at = NOW()
    RETURNING *
  `));
  return res.status(201).json(result.rows[0]);
});

router.put("/budgets/:id", async (req: Request, res) => {
  await runMigration();
  const id = parseInt(String(req.params.id));
  const { budgetAmount, notes, department, project } = req.body;
  await db.execute(sql.raw(`
    UPDATE expense_budgets SET
      budget_amount = ${budgetAmount != null ? parseFloat(budgetAmount) : "budget_amount"},
      notes = ${notes !== undefined ? (notes ? `'${String(notes).replace(/'/g, "''")}'` : "NULL") : "notes"},
      department = ${department !== undefined ? (department ? `'${String(department).replace(/'/g, "''")}'` : "NULL") : "department"},
      project    = ${project    !== undefined ? (project    ? `'${String(project).replace(/'/g, "''")}'`    : "NULL") : "project"},
      updated_at = NOW()
    WHERE id = ${id}
  `));
  const result = await db.execute(sql.raw(`SELECT * FROM expense_budgets WHERE id = ${id}`));
  return res.json(result.rows[0]);
});

router.delete("/budgets/:id", async (req: Request, res) => {
  await runMigration();
  await db.execute(sql.raw(`DELETE FROM expense_budgets WHERE id = ${parseInt(String(req.params.id))}`));
  return res.json({ ok: true });
});

// ─── GET /api/expense-config/budgets/check ── check remaining budget ──────────
router.get("/budgets/check", async (req: Request, res) => {
  await runMigration();
  const companyId = resolveCompanyId(req);
  const { categoryId, year = String(new Date().getFullYear()), month = String(new Date().getMonth() + 1), amount } = req.query as Record<string, string>;

  if (!categoryId || !amount) return res.status(400).json({ message: "categoryId and amount required" });

  // Find budget
  const budgetResult = await db.execute(sql.raw(`
    SELECT budget_amount FROM expense_budgets
    WHERE year = ${parseInt(year)} AND (month = ${parseInt(month)} OR month IS NULL)
      AND (category_id = ${parseInt(categoryId)} OR category_id IS NULL)
      AND (company_id = ${companyId ?? "NULL"} OR company_id IS NULL)
    ORDER BY month NULLS LAST, category_id NULLS LAST
    LIMIT 1
  `)).catch(() => ({ rows: [] }));

  const budget = budgetResult.rows[0] as any | null;
  if (!budget) return res.json({ hasBudget: false });

  // Sum actual spend this period
  const spendResult = await db.execute(sql.raw(`
    SELECT COALESCE(SUM(CAST(total AS NUMERIC)), 0) AS spent
    FROM expenses
    WHERE category_id = ${parseInt(categoryId)}
      AND EXTRACT(YEAR FROM date::date) = ${parseInt(year)}
      ${month ? `AND EXTRACT(MONTH FROM date::date) = ${parseInt(month)}` : ""}
      AND status NOT IN ('draft','rejected')
      ${companyId ? `AND (company_id = ${companyId} OR company_id IS NULL)` : ""}
  `)).catch(() => ({ rows: [{ spent: 0 }] }));

  const spent = parseFloat((spendResult.rows[0] as any)?.spent ?? 0);
  const budgetAmt = parseFloat(budget.budget_amount);
  const amountN = parseFloat(amount);
  const projectedTotal = spent + amountN;
  const remaining = budgetAmt - spent;
  const willExceed = projectedTotal > budgetAmt;

  return res.json({
    hasBudget: true,
    budget: budgetAmt,
    spent,
    remaining,
    amountRequested: amountN,
    projectedTotal,
    willExceed,
    overBy: willExceed ? projectedTotal - budgetAmt : 0,
    usagePct: Math.round((projectedTotal / budgetAmt) * 100),
  });
});

export default router;
