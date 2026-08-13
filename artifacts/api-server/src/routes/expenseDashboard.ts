/**
 * Fase 11: Expense Dashboard & Monitoring
 * GET /api/expense-dashboard — aggregate summary for all financial obligations
 * GET /api/expense-dashboard/reminders — active reminders for dashboard display
 * GET /api/expense-dashboard/audit-log — audit log for expense module
 */
import { Router, type Request } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../lib/requireAdmin.js";
import { resolveCompanyId } from "../lib/resolveCompany.js";
import { deferStartupTask } from "../lib/deferredStartupTasks.js";

const router = Router();
router.use(async (req, res, next) => {
  if (!(await requireAdmin(req, res))) return;
  next();
});

// ─── Inline migration for audit log ──────────────────────────────────────────
async function ensureTables() {
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS expense_audit_log (
      id SERIAL PRIMARY KEY,
      company_id INTEGER,
      ref_type TEXT NOT NULL,
      ref_id INTEGER NOT NULL,
      ref_number TEXT,
      action TEXT NOT NULL,
      actor_id TEXT,
      actor_name TEXT,
      old_value JSONB,
      new_value JSONB,
      notes TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS expense_audit_log_ref_idx ON expense_audit_log(ref_type, ref_id);
    CREATE INDEX IF NOT EXISTS expense_audit_log_company_idx ON expense_audit_log(company_id);
  `));
}
deferStartupTask("expense-dashboard", ensureTables);

// ─── GET /api/expense-dashboard ───────────────────────────────────────────────
router.get("/", async (req: Request, res) => {
  const companyId = resolveCompanyId(req);
  const co = companyId ? `company_id = ${companyId}` : "1=1";
  const coCashAdv = companyId ? `AND company_id = ${companyId}` : "";
  const coLoan = companyId ? `AND company_id = ${companyId}` : "";
  const coExp = companyId ? `AND company_id = ${companyId}` : "";

  // ── Cash Advances (Kasbon + Talangan) ────────────────────────────────────
  const cashAdvResult = await db.execute(sql.raw(`
    SELECT
      type,
      COUNT(*) AS count,
      SUM(CAST(amount AS NUMERIC)) AS total_amount,
      SUM(CAST(remaining_amount AS NUMERIC)) AS remaining_amount
    FROM cash_advances
    WHERE status IN ('active','partial') ${coCashAdv}
    GROUP BY type
  `)).catch(() => ({ rows: [] }));

  // ── Bank Loans ────────────────────────────────────────────────────────────
  const loanResult = await db.execute(sql.raw(`
    SELECT
      loan_type,
      COUNT(*) AS count,
      SUM(CAST(outstanding_amount AS NUMERIC)) AS outstanding_amount
    FROM bank_loans
    WHERE status IN ('active','partial') ${coLoan}
    GROUP BY loan_type
  `)).catch(() => ({ rows: [] }));

  // ── Vendor Installments ───────────────────────────────────────────────────
  const installResult = await db.execute(sql.raw(`
    SELECT
      COUNT(*) AS count,
      SUM(CAST(remaining_amount AS NUMERIC)) AS remaining_amount
    FROM vendor_installments
    WHERE status IN ('active','partial') ${coCashAdv}
  `)).catch(() => ({ rows: [] }));

  // ── Expense by Category (YTD) ────────────────────────────────────────────
  const year = new Date().getFullYear();
  const expCatResult = await db.execute(sql.raw(`
    SELECT
      COALESCE(c.name, 'Tanpa Kategori') AS category,
      e.status,
      COUNT(*) AS count,
      SUM(CAST(e.total AS NUMERIC)) AS total
    FROM expenses e
    LEFT JOIN expense_categories c ON c.id = e.category_id
    WHERE e.date >= '${year}-01-01' ${coExp}
    GROUP BY c.name, e.status
    ORDER BY SUM(CAST(e.total AS NUMERIC)) DESC
  `)).catch(() => ({ rows: [] }));

  // ── Approval Stats ────────────────────────────────────────────────────────
  const approvalResult = await db.execute(sql.raw(`
    SELECT status, COUNT(*) AS count
    FROM expense_approval_requests
    ${companyId ? `WHERE company_id = ${companyId}` : ""}
    GROUP BY status
  `)).catch(() => ({ rows: [] }));

  // ── Monthly Expense Trend (last 6 months) ─────────────────────────────────
  const trendResult = await db.execute(sql.raw(`
    SELECT
      TO_CHAR(date::date, 'YYYY-MM') AS month,
      SUM(CAST(total AS NUMERIC)) AS total,
      COUNT(*) AS count
    FROM expenses
    WHERE date >= (NOW() - INTERVAL '6 months')::date ${coExp}
      AND status NOT IN ('draft','rejected')
    GROUP BY TO_CHAR(date::date, 'YYYY-MM')
    ORDER BY 1
  `)).catch(() => ({ rows: [] }));

  // ── Reminders count ───────────────────────────────────────────────────────
  const remCount = await db.execute(sql.raw(`
    SELECT severity, COUNT(*) AS count
    FROM expense_reminders
    WHERE dismissed = FALSE
      ${companyId ? `AND (company_id = ${companyId} OR company_id IS NULL)` : ""}
    GROUP BY severity
  `)).catch(() => ({ rows: [] }));

  // ── Pending approvals waiting >2 days ─────────────────────────────────────
  const pendingApprCount = await db.execute(sql.raw(`
    SELECT COUNT(*) AS count
    FROM expense_approval_requests
    WHERE status IN ('pending','l1_approved')
    ${companyId ? `AND (company_id = ${companyId} OR company_id IS NULL)` : ""}
  `)).catch(() => ({ rows: [{ count: 0 }] }));

  // ── Build summaries ───────────────────────────────────────────────────────
  const kasbonRow   = (cashAdvResult.rows as any[]).find((r) => r.type === "kasbon");
  const talaganRow  = (cashAdvResult.rows as any[]).find((r) => r.type === "talangan");
  const bankLoanRow = (loanResult.rows as any[]).find((r) => r.loan_type === "bank");
  const leasingRow  = (loanResult.rows as any[]).find((r) => r.loan_type === "leasing");
  const instRow     = (installResult.rows[0] as any) ?? null;

  const approvalStats = (approvalResult.rows as any[]).reduce((acc: any, r: any) => {
    acc[r.status] = parseInt(r.count, 10);
    return acc;
  }, {});

  const reminderStats = (remCount.rows as any[]).reduce((acc: any, r: any) => {
    acc[r.severity] = parseInt(r.count, 10);
    return acc;
  }, {});

  return res.json({
    year,
    cashAdvances: {
      kasbon:   { count: parseInt(kasbonRow?.count ?? 0),  remaining: parseFloat(kasbonRow?.remaining_amount  ?? 0) },
      talangan: { count: parseInt(talaganRow?.count ?? 0), remaining: parseFloat(talaganRow?.remaining_amount ?? 0) },
    },
    bankLoans: {
      bank:    { count: parseInt(bankLoanRow?.count ?? 0), outstanding: parseFloat(bankLoanRow?.outstanding_amount ?? 0) },
      leasing: { count: parseInt(leasingRow?.count ?? 0),  outstanding: parseFloat(leasingRow?.outstanding_amount  ?? 0) },
    },
    vendorInstallments: {
      count:     parseInt(instRow?.count ?? 0),
      remaining: parseFloat(instRow?.remaining_amount ?? 0),
    },
    expenseByCategory: (expCatResult.rows as any[]).map((r) => ({
      category: r.category,
      status:   r.status,
      count:    parseInt(r.count, 10),
      total:    parseFloat(r.total),
    })),
    approvalStats,
    monthlyTrend: (trendResult.rows as any[]).map((r) => ({
      month: r.month,
      total: parseFloat(r.total),
      count: parseInt(r.count, 10),
    })),
    reminders: reminderStats,
    pendingApprovals: parseInt((pendingApprCount.rows[0] as any)?.count ?? 0, 10),
  });
});

// ─── GET /api/expense-dashboard/reminders ─────────────────────────────────────
router.get("/reminders", async (req: Request, res) => {
  const companyId = resolveCompanyId(req);
  const { dismissed = "false", severity } = req.query as Record<string, string>;
  let where = dismissed === "true" ? "" : "WHERE dismissed = FALSE";
  if (companyId) where += (where ? " AND" : "WHERE") + ` (company_id = ${companyId} OR company_id IS NULL)`;
  if (severity) where += (where ? " AND" : "WHERE") + ` severity = '${severity}'`;
  const rows = await db.execute(sql.raw(
    `SELECT * FROM expense_reminders ${where} ORDER BY severity DESC, created_at DESC LIMIT 50`
  )).catch(() => ({ rows: [] }));
  return res.json(rows.rows);
});

// ─── POST /api/expense-dashboard/reminders/:id/dismiss ───────────────────────
router.post("/reminders/:id/dismiss", async (req: Request, res) => {
  const id = parseInt(String(req.params.id));
  await db.execute(sql.raw(`UPDATE expense_reminders SET dismissed = TRUE WHERE id = ${id}`));
  return res.json({ ok: true });
});

// ─── GET /api/expense-dashboard/audit-log ────────────────────────────────────
router.get("/audit-log", async (req: Request, res) => {
  const companyId = resolveCompanyId(req);
  const { refType, refId, limit = "100", offset = "0" } = req.query as Record<string, string>;
  let where = companyId ? `WHERE (company_id = ${companyId} OR company_id IS NULL)` : "WHERE 1=1";
  if (refType) where += ` AND ref_type = '${refType}'`;
  if (refId)   where += ` AND ref_id = ${parseInt(refId)}`;
  const rows = await db.execute(sql.raw(
    `SELECT * FROM expense_audit_log ${where} ORDER BY created_at DESC LIMIT ${Math.min(parseInt(limit), 500)} OFFSET ${parseInt(offset)}`
  )).catch(() => ({ rows: [] }));
  return res.json(rows.rows);
});

// ─── POST /api/expense-dashboard/audit-log (internal use by other routes) ─────
router.post("/audit-log", async (req: Request, res) => {
  const companyId = resolveCompanyId(req);
  const { refType, refId, refNumber, action, actorId, actorName, oldValue, newValue, notes } = req.body;
  if (!refType || !action) return res.status(400).json({ message: "refType and action required" });
  const actorIdEsc    = actorId    ? `'${actorId}'`                            : "NULL";
  const actorNameEsc  = actorName  ? `'${String(actorName).replace(/'/g, "''")}'`  : "NULL";
  const refNumberEsc  = refNumber  ? `'${String(refNumber).replace(/'/g, "''")}'`  : "NULL";
  const notesEsc      = notes      ? `'${String(notes).replace(/'/g, "''")}'`      : "NULL";
  const oldValueEsc   = oldValue   ? `'${JSON.stringify(oldValue).replace(/'/g, "''")}'::jsonb`   : "NULL";
  const newValueEsc   = newValue   ? `'${JSON.stringify(newValue).replace(/'/g, "''")}'::jsonb`   : "NULL";
  await db.execute(sql.raw(`
    INSERT INTO expense_audit_log
      (company_id, ref_type, ref_id, ref_number, action, actor_id, actor_name, old_value, new_value, notes)
    VALUES
      (${companyId ?? "NULL"}, '${refType}', ${parseInt(refId)},
       ${refNumberEsc}, '${String(action).replace(/'/g, "''")}',
       ${actorIdEsc}, ${actorNameEsc}, ${oldValueEsc}, ${newValueEsc}, ${notesEsc})
  `));
  return res.status(201).json({ ok: true });
});

// ─── GET /api/expense-dashboard/spt-export ───────────────────────────────────
// Simple SPT-style expense report export (CSV)
router.get("/spt-export", async (req: Request, res) => {
  const companyId = resolveCompanyId(req);
  const { year = String(new Date().getFullYear()) } = req.query as Record<string, string>;
  const coWhere = companyId ? `AND e.company_id = ${companyId}` : "";

  const rows = await db.execute(sql.raw(`
    SELECT
      e.expense_number, e.date, c.name AS category, e.vendor_employee,
      e.description, e.qty, e.unit_price, e.tax_amount, e.total, e.status,
      e.currency, e.notes
    FROM expenses e
    LEFT JOIN expense_categories c ON c.id = e.category_id
    WHERE EXTRACT(YEAR FROM e.date::date) = ${parseInt(year)}
      AND e.status NOT IN ('draft','rejected')
      ${coWhere}
    ORDER BY e.date, e.expense_number
  `)).catch(() => ({ rows: [] }));

  const lines = [
    "No. Expense,Tanggal,Kategori,Vendor/Karyawan,Deskripsi,Qty,Harga Satuan,Pajak,Total,Status,Mata Uang,Keterangan",
    ...(rows.rows as any[]).map((r) =>
      [r.expense_number, r.date, r.category ?? "", r.vendor_employee ?? "",
       (r.description ?? "").replace(/,/g, ";"), r.qty, r.unit_price, r.tax_amount, r.total, r.status,
       r.currency ?? "IDR", (r.notes ?? "").replace(/,/g, ";")
      ].join(",")
    ),
  ];

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="SPT-Expense-${year}.csv"`);
  return res.send("\uFEFF" + lines.join("\n")); // BOM for Excel
});

export default router;
