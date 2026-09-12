import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../lib/requireAdmin.js";

const router = Router();

function getCompanyId(req: any): number | null {
  const h = req.headers["x-company-id"];
  if (h) return Number(h);
  return req.user?.companyId ?? null;
}

async function runBootMigration() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS approval_matrix (
      id            SERIAL PRIMARY KEY,
      company_id    INTEGER REFERENCES companies(id) ON DELETE CASCADE,
      name          TEXT NOT NULL,
      module        TEXT NOT NULL DEFAULT 'general',
      department_id INTEGER REFERENCES departments(id) ON DELETE SET NULL,
      currency      TEXT,
      vendor_id     INTEGER REFERENCES suppliers(id) ON DELETE SET NULL,
      description   TEXT,
      is_active     BOOLEAN NOT NULL DEFAULT true,
      priority      INTEGER NOT NULL DEFAULT 0,
      created_at    TIMESTAMP DEFAULT NOW() NOT NULL,
      updated_at    TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `).catch(() => {});
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS approval_matrix_company_idx ON approval_matrix(company_id)
  `).catch(() => {});
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS approval_matrix_module_idx ON approval_matrix(module)
  `).catch(() => {});

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS approval_matrix_levels (
      id               SERIAL PRIMARY KEY,
      matrix_id        INTEGER NOT NULL REFERENCES approval_matrix(id) ON DELETE CASCADE,
      level            INTEGER NOT NULL DEFAULT 1,
      label            TEXT,
      min_amount       NUMERIC(18,2) NOT NULL DEFAULT 0,
      max_amount       NUMERIC(18,2),
      approver_role_id INTEGER REFERENCES custom_roles(id) ON DELETE SET NULL,
      approver_user_id TEXT,
      created_at       TIMESTAMP DEFAULT NOW() NOT NULL
    )
  `).catch(() => {});
  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS approval_matrix_levels_matrix_idx ON approval_matrix_levels(matrix_id)
  `).catch(() => {});
}

let migrated = false;
async function ensureMigration() {
  if (migrated) return;
  await runBootMigration();
  migrated = true;
}

function withMigration(handler: (req: Request, res: Response) => Promise<unknown>) {
  return async (req: Request, res: Response) => {
    await ensureMigration();
    return handler(req, res);
  };
}

const MATRIX_SELECT = sql`
  SELECT
    am.*,
    c.company_name, c.company_code,
    dep.name AS department_name,
    s.name   AS vendor_name
  FROM approval_matrix am
  LEFT JOIN companies  c   ON c.id   = am.company_id
  LEFT JOIN departments dep ON dep.id = am.department_id
  LEFT JOIN suppliers  s   ON s.id   = am.vendor_id
`;

const LEVELS_SELECT = (matrixId: number) => sql`
  SELECT
    aml.*,
    cr.name  AS approver_role_name,
    cr.color AS approver_role_color,
    u.name   AS approver_user_name,
    u.email  AS approver_user_email
  FROM approval_matrix_levels aml
  LEFT JOIN custom_roles cr ON cr.id = aml.approver_role_id
  LEFT JOIN users        u  ON u.id  = aml.approver_user_id
  WHERE aml.matrix_id = ${matrixId}
  ORDER BY aml.level ASC, aml.min_amount ASC
`;

// GET /api/approval-matrix
router.get("/", withMigration(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
  const companyId = getCompanyId(req);
  const module = req.query.module as string | undefined;

  const rows = await db.execute(sql`
    SELECT
      am.id, am.company_id, am.name, am.module, am.department_id,
      am.currency, am.vendor_id, am.description, am.is_active, am.priority,
      am.created_at, am.updated_at,
      c.company_name, c.company_code,
      dep.name AS department_name,
      s.name   AS vendor_name,
      aml.id          AS level_id,
      aml.level       AS level_num,
      aml.label       AS level_label,
      aml.min_amount,
      aml.max_amount,
      aml.approver_role_id,
      aml.approver_user_id,
      cr.name  AS approver_role_name,
      cr.color AS approver_role_color,
      u.name   AS approver_user_name,
      u.email  AS approver_user_email
    FROM approval_matrix am
    LEFT JOIN companies   c   ON c.id   = am.company_id
    LEFT JOIN departments dep ON dep.id = am.department_id
    LEFT JOIN suppliers   s   ON s.id   = am.vendor_id
    LEFT JOIN approval_matrix_levels aml ON aml.matrix_id = am.id
    LEFT JOIN custom_roles cr ON cr.id = aml.approver_role_id
    LEFT JOIN users        u  ON u.id  = aml.approver_user_id
    WHERE TRUE
      ${companyId ? sql`AND am.company_id = ${companyId}` : sql``}
      ${module ? sql`AND am.module = ${module}` : sql``}
    ORDER BY am.priority DESC, am.name ASC, aml.level ASC, aml.min_amount ASC
  `);

  const matrixMap: Record<number, any> = {};
  for (const row of rows.rows as any[]) {
    if (!matrixMap[row.id]) {
      matrixMap[row.id] = {
        id: row.id, companyId: row.company_id, name: row.name, module: row.module,
        departmentId: row.department_id, currency: row.currency, vendorId: row.vendor_id,
        description: row.description, isActive: row.is_active, priority: row.priority,
        createdAt: row.created_at, updatedAt: row.updated_at,
        company_name: row.company_name, company_code: row.company_code,
        department_name: row.department_name, vendor_name: row.vendor_name,
        is_active: row.is_active,
        levels: [],
      };
    }
    if (row.level_id) {
      matrixMap[row.id].levels.push({
        id: row.level_id, matrixId: row.id, level: row.level_num, label: row.level_label,
        min_amount: row.min_amount, max_amount: row.max_amount,
        approverRoleId: row.approver_role_id, approverUserId: row.approver_user_id,
        approver_role_name: row.approver_role_name, approver_role_color: row.approver_role_color,
        approver_user_name: row.approver_user_name, approver_user_email: row.approver_user_email,
      });
    }
  }

  return res.json(Object.values(matrixMap));
}));

// GET /api/approval-matrix/:id
router.get("/:id", withMigration(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });

  const matrixRow = await db.execute(sql`
    ${MATRIX_SELECT}
    WHERE am.id = ${id}
  `);
  if (!matrixRow.rows[0]) return res.status(404).json({ message: "Tidak ditemukan" });

  const levelsRows = await db.execute(LEVELS_SELECT(id));
  return res.json({ ...matrixRow.rows[0], levels: levelsRows.rows });
}));

// POST /api/approval-matrix
router.post("/", withMigration(async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const {
    name, module, companyId, departmentId, currency, vendorId,
    description, isActive, priority, levels,
  } = req.body ?? {};

  if (!name?.trim()) return res.status(400).json({ message: "Nama wajib diisi" });
  if (!Array.isArray(levels) || levels.length === 0) {
    return res.status(400).json({ message: "Minimal 1 level approval wajib diisi" });
  }

  const matrixResult = await db.execute(sql`
    INSERT INTO approval_matrix (
      company_id, name, module, department_id, currency, vendor_id,
      description, is_active, priority
    ) VALUES (
      ${companyId ? Number(companyId) : null},
      ${name.trim()},
      ${module ?? "general"},
      ${departmentId ? Number(departmentId) : null},
      ${currency || null},
      ${vendorId ? Number(vendorId) : null},
      ${description || null},
      ${isActive !== false},
      ${priority ? Number(priority) : 0}
    )
    RETURNING id
  `);
  const matrixId = (matrixResult.rows[0] as any).id as number;

  for (const lv of levels) {
    await db.execute(sql`
      INSERT INTO approval_matrix_levels (
        matrix_id, level, label, min_amount, max_amount, approver_role_id, approver_user_id
      ) VALUES (
        ${matrixId},
        ${Number(lv.level) || 1},
        ${lv.label || null},
        ${lv.minAmount !== undefined ? String(lv.minAmount) : "0"},
        ${lv.maxAmount !== undefined && lv.maxAmount !== null ? String(lv.maxAmount) : null},
        ${lv.approverRoleId ? Number(lv.approverRoleId) : null},
        ${lv.approverUserId || null}
      )
    `);
  }

  const matrixRow = await db.execute(sql`${MATRIX_SELECT} WHERE am.id = ${matrixId}`);
  const levelsRows = await db.execute(LEVELS_SELECT(matrixId));
  return res.status(201).json({ ...matrixRow.rows[0], levels: levelsRows.rows });
}));

// PUT /api/approval-matrix/:id
router.put("/:id", withMigration(async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });

  const existing = await db.execute(sql`SELECT id FROM approval_matrix WHERE id = ${id}`);
  if (!existing.rows[0]) return res.status(404).json({ message: "Tidak ditemukan" });

  const {
    name, module, companyId, departmentId, currency, vendorId,
    description, isActive, priority, levels,
  } = req.body ?? {};

  await db.execute(sql`
    UPDATE approval_matrix SET
      name          = COALESCE(${name?.trim() ?? null}, name),
      module        = COALESCE(${module ?? null}, module),
      company_id    = ${companyId !== undefined ? (companyId ? Number(companyId) : null) : sql`company_id`},
      department_id = ${departmentId !== undefined ? (departmentId ? Number(departmentId) : null) : sql`department_id`},
      currency      = ${currency !== undefined ? (currency || null) : sql`currency`},
      vendor_id     = ${vendorId !== undefined ? (vendorId ? Number(vendorId) : null) : sql`vendor_id`},
      description   = ${description !== undefined ? (description || null) : sql`description`},
      is_active     = COALESCE(${isActive !== undefined ? Boolean(isActive) : null}, is_active),
      priority      = COALESCE(${priority !== undefined ? Number(priority) : null}, priority),
      updated_at    = NOW()
    WHERE id = ${id}
  `);

  if (Array.isArray(levels)) {
    await db.execute(sql`DELETE FROM approval_matrix_levels WHERE matrix_id = ${id}`);
    for (const lv of levels) {
      await db.execute(sql`
        INSERT INTO approval_matrix_levels (
          matrix_id, level, label, min_amount, max_amount, approver_role_id, approver_user_id
        ) VALUES (
          ${id},
          ${Number(lv.level) || 1},
          ${lv.label || null},
          ${lv.minAmount !== undefined ? String(lv.minAmount) : "0"},
          ${lv.maxAmount !== undefined && lv.maxAmount !== null ? String(lv.maxAmount) : null},
          ${lv.approverRoleId ? Number(lv.approverRoleId) : null},
          ${lv.approverUserId || null}
        )
      `);
    }
  }

  const matrixRow = await db.execute(sql`${MATRIX_SELECT} WHERE am.id = ${id}`);
  const levelsRows = await db.execute(LEVELS_SELECT(id));
  return res.json({ ...matrixRow.rows[0], levels: levelsRows.rows });
}));

// DELETE /api/approval-matrix/:id
router.delete("/:id", withMigration(async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  await db.execute(sql`DELETE FROM approval_matrix WHERE id = ${id}`);
  return res.json({ success: true });
}));

// POST /api/approval-matrix/evaluate
// Body: { companyId, module, departmentId, currency, vendorId, amount }
// Returns: matching matrix + which levels are required for this amount
router.post("/evaluate", withMigration(async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
  const { companyId, module, departmentId, currency, vendorId, amount } = req.body ?? {};
  const amt = Number(amount ?? 0);

  const rows = await db.execute(sql`
    SELECT
      am.*,
      c.company_name,
      dep.name AS department_name,
      s.name   AS vendor_name
    FROM approval_matrix am
    LEFT JOIN companies   c   ON c.id   = am.company_id
    LEFT JOIN departments dep ON dep.id = am.department_id
    LEFT JOIN suppliers   s   ON s.id   = am.vendor_id
    WHERE am.is_active = true
      ${companyId ? sql`AND (am.company_id = ${Number(companyId)} OR am.company_id IS NULL)` : sql``}
      ${module ? sql`AND (am.module = ${module} OR am.module = 'general')` : sql``}
      ${departmentId ? sql`AND (am.department_id = ${Number(departmentId)} OR am.department_id IS NULL)` : sql``}
      ${currency ? sql`AND (am.currency = ${currency} OR am.currency IS NULL)` : sql``}
      ${vendorId ? sql`AND (am.vendor_id = ${Number(vendorId)} OR am.vendor_id IS NULL)` : sql``}
    ORDER BY
      (am.company_id IS NOT NULL)::int DESC,
      (am.department_id IS NOT NULL)::int DESC,
      (am.currency IS NOT NULL)::int DESC,
      (am.vendor_id IS NOT NULL)::int DESC,
      am.priority DESC
    LIMIT 1
  `);

  if (!rows.rows[0]) {
    return res.json({ matched: false, matrix: null, requiredLevels: [] });
  }

  const matrix = rows.rows[0] as any;
  const levelsRows = await db.execute(sql`
    SELECT
      aml.*,
      cr.name  AS approver_role_name,
      cr.color AS approver_role_color,
      u.name   AS approver_user_name,
      u.email  AS approver_user_email
    FROM approval_matrix_levels aml
    LEFT JOIN custom_roles cr ON cr.id = aml.approver_role_id
    LEFT JOIN users        u  ON u.id  = aml.approver_user_id
    WHERE aml.matrix_id = ${matrix.id}
      AND aml.min_amount <= ${String(amt)}
      AND (aml.max_amount IS NULL OR aml.max_amount >= ${String(amt)})
    ORDER BY aml.level ASC
  `);

  return res.json({
    matched: true,
    matrix,
    requiredLevels: levelsRows.rows,
  });
}));

// GET /api/approval-matrix/meta/modules
router.get("/meta/modules", withMigration(async (_req: Request, res: Response) => {
  return res.json([
    { value: "purchase_request",  label: "Purchase Request" },
    { value: "purchase_order",    label: "Purchase Order" },
    { value: "bank_disbursement", label: "Bank Disbursement" },
    { value: "expense",           label: "Pengeluaran (Expense)" },
    { value: "rfq",               label: "RFQ" },
    { value: "sales_order",       label: "Sales Order" },
    { value: "cash_advance",      label: "Cash Advance" },
    { value: "general",           label: "Umum" },
  ]);
}));

export default router;
