import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../lib/requireAdmin.js";

const router = Router();

function isAdmin(req: any): boolean {
  return req.isAuthenticated() && req.user?.role === "admin";
}

function resolveCompanyId(req: any): number | null | "forbidden" {
  const qp = req.query.companyId as string | undefined;
  const userCompanyId: number | null = req.user?.companyId ?? null;
  const admin = isAdmin(req);
  if (!qp || qp === "all") return admin ? null : userCompanyId;
  const id = Number(qp);
  if (Number.isNaN(id)) return "forbidden";
  if (!admin && userCompanyId !== null && id !== userCompanyId) return "forbidden";
  return id;
}

// GET /api/approval-rules
router.get("/", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
  const cid = resolveCompanyId(req);
  if (cid === "forbidden") return res.status(403).json({ message: "Forbidden" });

  const module = req.query.module as string | undefined;
  const rows = await db.execute(sql`
    SELECT
      ar.*,
      c.company_name, c.company_code,
      b.name AS branch_name,
      div.name AS division_name,
      dep.name AS department_name,
      cr.name AS approver_role_name, cr.color AS approver_role_color,
      u.name AS approver_user_name, u.email AS approver_user_email
    FROM approval_rules ar
    LEFT JOIN companies c   ON c.id = ar.company_id
    LEFT JOIN branches b    ON b.id = ar.branch_id
    LEFT JOIN divisions div ON div.id = ar.division_id
    LEFT JOIN departments dep ON dep.id = ar.department_id
    LEFT JOIN custom_roles cr ON cr.id = ar.approver_role_id
    LEFT JOIN users u        ON u.id = ar.approver_user_id
    WHERE TRUE
      ${cid !== null ? sql`AND ar.company_id = ${cid}` : sql``}
      ${module ? sql`AND ar.module = ${module}` : sql``}
    ORDER BY ar.level ASC, ar.module, ar.name
  `);
  return res.json(rows.rows);
});

// GET /api/approval-rules/:id
router.get("/:id", async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });

  const row = await db.execute(sql`
    SELECT
      ar.*,
      c.company_name, b.name AS branch_name,
      div.name AS division_name, dep.name AS department_name,
      cr.name AS approver_role_name,
      u.name AS approver_user_name, u.email AS approver_user_email
    FROM approval_rules ar
    LEFT JOIN companies c   ON c.id = ar.company_id
    LEFT JOIN branches b    ON b.id = ar.branch_id
    LEFT JOIN divisions div ON div.id = ar.division_id
    LEFT JOIN departments dep ON dep.id = ar.department_id
    LEFT JOIN custom_roles cr ON cr.id = ar.approver_role_id
    LEFT JOIN users u        ON u.id = ar.approver_user_id
    WHERE ar.id = ${id}
  `);
  if (!row.rows[0]) return res.status(404).json({ message: "Tidak ditemukan" });
  return res.json(row.rows[0]);
});

// POST /api/approval-rules
router.post("/", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const {
    name, module, scope, companyId, branchId, divisionId, departmentId,
    amountThreshold, approverRoleId, approverUserId, level, description,
  } = req.body ?? {};

  if (!name?.trim()) return res.status(400).json({ message: "Nama wajib diisi" });

  const result = await db.execute(sql`
    INSERT INTO approval_rules (
      name, module, scope, company_id, branch_id, division_id, department_id,
      amount_threshold, approver_role_id, approver_user_id, level, description
    ) VALUES (
      ${name.trim()},
      ${module ?? "general"},
      ${scope ?? "company"},
      ${companyId ? Number(companyId) : null},
      ${branchId ? Number(branchId) : null},
      ${divisionId ? Number(divisionId) : null},
      ${departmentId ? Number(departmentId) : null},
      ${amountThreshold ? String(amountThreshold) : null},
      ${approverRoleId ? Number(approverRoleId) : null},
      ${approverUserId ?? null},
      ${level ? Number(level) : 1},
      ${description ?? null}
    )
    RETURNING *
  `);
  return res.status(201).json(result.rows[0]);
});

// PUT /api/approval-rules/:id
router.put("/:id", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });

  const existing = await db.execute(sql`SELECT id FROM approval_rules WHERE id = ${id}`);
  if (!existing.rows[0]) return res.status(404).json({ message: "Tidak ditemukan" });

  const {
    name, module, scope, companyId, branchId, divisionId, departmentId,
    amountThreshold, approverRoleId, approverUserId, level, description, isActive,
  } = req.body ?? {};

  const result = await db.execute(sql`
    UPDATE approval_rules SET
      name               = COALESCE(${name ?? null}, name),
      module             = COALESCE(${module ?? null}::approval_module, module),
      scope              = COALESCE(${scope ?? null}::approval_scope, scope),
      company_id         = ${companyId !== undefined ? (companyId ? Number(companyId) : null) : sql`company_id`},
      branch_id          = ${branchId !== undefined ? (branchId ? Number(branchId) : null) : sql`branch_id`},
      division_id        = ${divisionId !== undefined ? (divisionId ? Number(divisionId) : null) : sql`division_id`},
      department_id      = ${departmentId !== undefined ? (departmentId ? Number(departmentId) : null) : sql`department_id`},
      amount_threshold   = ${amountThreshold !== undefined ? (amountThreshold ? String(amountThreshold) : null) : sql`amount_threshold`},
      approver_role_id   = ${approverRoleId !== undefined ? (approverRoleId ? Number(approverRoleId) : null) : sql`approver_role_id`},
      approver_user_id   = ${approverUserId !== undefined ? (approverUserId ?? null) : sql`approver_user_id`},
      level              = COALESCE(${level !== undefined ? Number(level) : null}, level),
      description        = ${description !== undefined ? (description ?? null) : sql`description`},
      is_active          = COALESCE(${isActive !== undefined ? Boolean(isActive) : null}, is_active),
      updated_at         = NOW()
    WHERE id = ${id}
    RETURNING *
  `);
  return res.json(result.rows[0]);
});

// DELETE /api/approval-rules/:id
router.delete("/:id", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  await db.execute(sql`DELETE FROM approval_rules WHERE id = ${id}`);
  return res.json({ success: true });
});

export default router;
