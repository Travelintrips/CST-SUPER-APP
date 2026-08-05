/**
 * Fase 12: Expense Preset / Template
 * Templates auto-fill: category, debit/credit accounts, tax, payment method, description prefix
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
    CREATE TABLE IF NOT EXISTS expense_templates (
      id SERIAL PRIMARY KEY,
      company_id INTEGER,
      name TEXT NOT NULL,
      description TEXT,
      category_id INTEGER,
      expense_account_id INTEGER,
      payable_account_id INTEGER,
      tax_rate_id INTEGER,
      payment_method TEXT NOT NULL DEFAULT 'bank',
      default_vendor TEXT,
      amount_preset NUMERIC(14,2),
      is_active BOOLEAN NOT NULL DEFAULT TRUE,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS expense_templates_company_idx ON expense_templates(company_id);
  `));
}
let migrated = false;
async function runMigration() { if (!migrated) { await ensureTables(); migrated = true; } }

// ─── GET /api/expense-templates ──────────────────────────────────────────────
router.get("/", async (req: Request, res) => {
  await runMigration();
  const companyId = resolveCompanyId(req);
  const rows = await db.execute(sql.raw(`
    SELECT t.*,
      c.name AS category_name,
      a.name AS expense_account_name, a.code AS expense_account_code,
      p.name AS payable_account_name,
      tx.name AS tax_name, tx.rate AS tax_rate
    FROM expense_templates t
    LEFT JOIN expense_categories c ON c.id = t.category_id
    LEFT JOIN chart_of_accounts a ON a.id = t.expense_account_id
    LEFT JOIN chart_of_accounts p ON p.id = t.payable_account_id
    LEFT JOIN accounting_taxes tx ON tx.id = t.tax_rate_id
    WHERE t.is_active = TRUE
      ${companyId ? `AND (t.company_id = ${companyId} OR t.company_id IS NULL)` : ""}
    ORDER BY t.sort_order, t.name
  `)).catch(() => ({ rows: [] }));
  return res.json(rows.rows);
});

router.get("/all", async (req: Request, res) => {
  await runMigration();
  const companyId = resolveCompanyId(req);
  const rows = await db.execute(sql.raw(`
    SELECT t.*,
      c.name AS category_name,
      a.name AS expense_account_name, a.code AS expense_account_code,
      tx.name AS tax_name, tx.rate AS tax_rate
    FROM expense_templates t
    LEFT JOIN expense_categories c ON c.id = t.category_id
    LEFT JOIN chart_of_accounts a ON a.id = t.expense_account_id
    LEFT JOIN accounting_taxes tx ON tx.id = t.tax_rate_id
    ${companyId ? `WHERE (t.company_id = ${companyId} OR t.company_id IS NULL)` : ""}
    ORDER BY t.sort_order, t.name
  `)).catch(() => ({ rows: [] }));
  return res.json(rows.rows);
});

// ─── POST /api/expense-templates ─────────────────────────────────────────────
router.post("/", async (req: Request, res) => {
  await runMigration();
  const companyId = resolveCompanyId(req);
  const { name, description, categoryId, expenseAccountId, payableAccountId, taxRateId,
          paymentMethod, defaultVendor, amountPreset, isActive = true, sortOrder = 0 } = req.body;
  if (!name) return res.status(400).json({ message: "Nama template wajib diisi." });
  const result = await db.execute(sql.raw(`
    INSERT INTO expense_templates
      (company_id, name, description, category_id, expense_account_id, payable_account_id,
       tax_rate_id, payment_method, default_vendor, amount_preset, is_active, sort_order)
    VALUES
      (${companyId ?? "NULL"}, '${String(name).replace(/'/g, "''")}',
       ${description ? `'${String(description).replace(/'/g, "''")}'` : "NULL"},
       ${categoryId ? parseInt(categoryId) : "NULL"},
       ${expenseAccountId ? parseInt(expenseAccountId) : "NULL"},
       ${payableAccountId ? parseInt(payableAccountId) : "NULL"},
       ${taxRateId ? parseInt(taxRateId) : "NULL"},
       '${paymentMethod ?? "bank"}',
       ${defaultVendor ? `'${String(defaultVendor).replace(/'/g, "''")}'` : "NULL"},
       ${amountPreset ? parseFloat(amountPreset) : "NULL"},
       ${isActive !== false}, ${parseInt(String(sortOrder)) || 0})
    RETURNING *
  `));
  return res.status(201).json(result.rows[0]);
});

// ─── PUT /api/expense-templates/:id ──────────────────────────────────────────
router.put("/:id", async (req: Request, res) => {
  await runMigration();
  const id = parseInt(String(req.params.id));
  const { name, description, categoryId, expenseAccountId, payableAccountId, taxRateId,
          paymentMethod, defaultVendor, amountPreset, isActive, sortOrder } = req.body;
  await db.execute(sql.raw(`
    UPDATE expense_templates SET
      name            = ${name          ? `'${String(name).replace(/'/g, "''")}'`              : "name"},
      description     = ${description !== undefined ? (description ? `'${String(description).replace(/'/g, "''")}'` : "NULL") : "description"},
      category_id     = ${categoryId    !== undefined ? (categoryId ? parseInt(categoryId) : "NULL")             : "category_id"},
      expense_account_id = ${expenseAccountId !== undefined ? (expenseAccountId ? parseInt(expenseAccountId) : "NULL") : "expense_account_id"},
      payable_account_id = ${payableAccountId !== undefined ? (payableAccountId ? parseInt(payableAccountId) : "NULL") : "payable_account_id"},
      tax_rate_id     = ${taxRateId      !== undefined ? (taxRateId ? parseInt(taxRateId) : "NULL")             : "tax_rate_id"},
      payment_method  = ${paymentMethod  ? `'${paymentMethod}'`                                                  : "payment_method"},
      default_vendor  = ${defaultVendor !== undefined ? (defaultVendor ? `'${String(defaultVendor).replace(/'/g, "''")}'` : "NULL") : "default_vendor"},
      amount_preset   = ${amountPreset  !== undefined ? (amountPreset ? parseFloat(amountPreset) : "NULL")      : "amount_preset"},
      is_active       = ${isActive       !== undefined ? isActive                                                : "is_active"},
      sort_order      = ${sortOrder      !== undefined ? parseInt(String(sortOrder))                             : "sort_order"},
      updated_at = NOW()
    WHERE id = ${id}
  `));
  const result = await db.execute(sql.raw(`SELECT * FROM expense_templates WHERE id = ${id}`));
  return res.json(result.rows[0]);
});

// ─── DELETE /api/expense-templates/:id ───────────────────────────────────────
router.delete("/:id", async (req: Request, res) => {
  await runMigration();
  await db.execute(sql.raw(`DELETE FROM expense_templates WHERE id = ${parseInt(String(req.params.id))}`));
  return res.json({ ok: true });
});

// ─── POST /api/expense-templates/seed ─── seed standard templates ────────────
router.post("/seed", async (req: Request, res) => {
  await runMigration();
  const companyId = resolveCompanyId(req);

  // Get category and account IDs from DB
  const cats = await db.execute(sql.raw(`SELECT id, code FROM expense_categories LIMIT 50`)).catch(() => ({ rows: [] }));
  const byCode = new Map((cats.rows as any[]).map((r) => [r.code, r.id]));

  const TEMPLATES = [
    { name: "Makan & Minum Tim",       categoryCode: "MAKAN_MINUM",   pm: "cash",  amount: 500_000 },
    { name: "Transport / Bensin",       categoryCode: "OPERATIONAL",   pm: "cash",  amount: 200_000 },
    { name: "Sewa Kantor (Bulanan)",    categoryCode: "SEWA_KANTOR",   pm: "bank",  amount: 5_000_000 },
    { name: "Listrik & Air",            categoryCode: "UTILITAS",      pm: "bank",  amount: 2_000_000 },
    { name: "ATK / Peralatan Kantor",   categoryCode: "PERALATAN",     pm: "cash",  amount: 300_000 },
    { name: "Entertainment Klien",      categoryCode: "ENTERTAINMENT", pm: "cash",  amount: 1_000_000 },
    { name: "Reimburse Karyawan",       categoryCode: "REIMBURSEMENT", pm: "bank",  amount: null },
    { name: "Biaya Trucking",           categoryCode: "TRUCKING",      pm: "bank",  amount: null },
    { name: "Biaya Handling Pelabuhan", categoryCode: "HANDLING",      pm: "bank",  amount: null },
    { name: "Biaya Dokumen / Custom",   categoryCode: "CUSTOMS",       pm: "bank",  amount: null },
  ];

  let inserted = 0;
  for (const t of TEMPLATES) {
    const catId = byCode.get(t.categoryCode);
    const amtSQL = t.amount != null ? t.amount : "NULL";
    try {
      await db.execute(sql.raw(`
        INSERT INTO expense_templates (company_id, name, category_id, payment_method, amount_preset, is_active, sort_order)
        VALUES (${companyId ?? "NULL"}, '${t.name}', ${catId ?? "NULL"}, '${t.pm}', ${amtSQL}, TRUE, ${inserted})
        ON CONFLICT DO NOTHING
      `));
      inserted++;
    } catch { /* skip duplicates */ }
  }
  const rows = await db.execute(sql.raw(`SELECT * FROM expense_templates ${companyId ? `WHERE company_id = ${companyId} OR company_id IS NULL` : ""} ORDER BY sort_order`)).catch(() => ({ rows: [] }));
  return res.json({ seeded: inserted, templates: rows.rows });
});

export default router;
