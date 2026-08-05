import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../lib/requireAdmin.js";

const router = Router();

router.use(async (req: Request, res: Response, next) => {
  const ok = await requireAdmin(req, res);
  if (ok) next();
});

router.get("/", async (_req: Request, res: Response) => {
  const roles = await db.execute(sql`
    SELECT
      cr.id, cr.name, cr.description, cr.color, cr.permissions, cr.created_at,
      cr.scope_type, cr.branch_id, cr.division_id, cr.department_id,
      cr.company_id,
      c.company_name, c.company_code,
      b.name AS branch_name,
      div.name AS division_name,
      dep.name AS department_name,
      COUNT(u.id)::int AS user_count
    FROM custom_roles cr
    LEFT JOIN users u ON u.custom_role_id = cr.id
    LEFT JOIN companies c ON c.id = cr.company_id
    LEFT JOIN branches b ON b.id = cr.branch_id
    LEFT JOIN divisions div ON div.id = cr.division_id
    LEFT JOIN departments dep ON dep.id = cr.department_id
    GROUP BY cr.id, c.company_name, c.company_code, b.name, div.name, dep.name
    ORDER BY cr.created_at ASC
  `);
  res.json(roles.rows);
});

router.get("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const roleRes = await db.execute(sql`
    SELECT
      cr.*,
      c.company_name, c.company_code,
      b.name AS branch_name,
      div.name AS division_name,
      dep.name AS department_name
    FROM custom_roles cr
    LEFT JOIN companies c ON c.id = cr.company_id
    LEFT JOIN branches b ON b.id = cr.branch_id
    LEFT JOIN divisions div ON div.id = cr.division_id
    LEFT JOIN departments dep ON dep.id = cr.department_id
    WHERE cr.id = ${Number(id)}
  `);
  const role = roleRes.rows[0];
  if (!role) return res.status(404).json({ message: "Role tidak ditemukan" });

  const usersRes = await db.execute(sql`
    SELECT u.id, u.email, u.name, u.role, u.division,
           c.company_name, b.name AS branch_name, dv.name AS division_name, dep.name AS department_name
    FROM users u
    LEFT JOIN companies c ON c.id = u.company_id
    LEFT JOIN branches b ON b.id = u.branch_id
    LEFT JOIN divisions dv ON dv.id = u.division_id
    LEFT JOIN departments dep ON dep.id = u.department_id
    WHERE u.custom_role_id = ${Number(id)}
    ORDER BY u.name
  `);
  return res.json({ ...role, users: usersRes.rows });
});

router.post("/", async (req: Request, res: Response) => {
  const {
    name, description, color, permissions,
    companyId, scopeType, branchId, divisionId, departmentId,
  } = req.body as {
    name: string; description?: string; color?: string; permissions?: string[];
    companyId?: number | null; scopeType?: string;
    branchId?: number | null; divisionId?: number | null; departmentId?: number | null;
  };

  if (!name?.trim()) return res.status(400).json({ message: "Nama role wajib diisi" });

  const result = await db.execute(sql`
    INSERT INTO custom_roles (name, description, color, permissions, company_id, scope_type, branch_id, division_id, department_id)
    VALUES (
      ${name.trim()},
      ${description ?? null},
      ${color ?? "#6366f1"},
      ${JSON.stringify(permissions ?? [])}::jsonb,
      ${companyId ? Number(companyId) : null},
      ${scopeType ?? "company_only"},
      ${branchId ? Number(branchId) : null},
      ${divisionId ? Number(divisionId) : null},
      ${departmentId ? Number(departmentId) : null}
    )
    RETURNING *
  `);
  return res.status(201).json(result.rows[0]);
});

router.put("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  const {
    name, description, color, permissions,
    companyId, scopeType, branchId, divisionId, departmentId,
  } = req.body as {
    name?: string; description?: string; color?: string; permissions?: string[];
    companyId?: number | null; scopeType?: string;
    branchId?: number | null; divisionId?: number | null; departmentId?: number | null;
  };

  const existing = await db.execute(sql`SELECT * FROM custom_roles WHERE id = ${Number(id)}`);
  if (!existing.rows[0]) return res.status(404).json({ message: "Role tidak ditemukan" });

  const cur = existing.rows[0] as any;
  const newName = name?.trim() ?? cur.name;
  const newDesc = description !== undefined ? description : cur.description;
  const newColor = color ?? cur.color;
  const newPerms = permissions !== undefined ? JSON.stringify(permissions) : JSON.stringify(cur.permissions);
  const newScope = scopeType ?? cur.scope_type ?? "company_only";
  const newCompanyId = companyId !== undefined ? (companyId ? Number(companyId) : null) : cur.company_id;
  const newBranchId = branchId !== undefined ? (branchId ? Number(branchId) : null) : cur.branch_id;
  const newDivisionId = divisionId !== undefined ? (divisionId ? Number(divisionId) : null) : cur.division_id;
  const newDepartmentId = departmentId !== undefined ? (departmentId ? Number(departmentId) : null) : cur.department_id;

  const result = await db.execute(sql`
    UPDATE custom_roles
    SET name          = ${newName},
        description   = ${newDesc},
        color         = ${newColor},
        permissions   = ${newPerms}::jsonb,
        scope_type    = ${newScope},
        company_id    = ${newCompanyId},
        branch_id     = ${newBranchId},
        division_id   = ${newDivisionId},
        department_id = ${newDepartmentId},
        updated_at    = NOW()
    WHERE id = ${Number(id)}
    RETURNING *
  `);
  return res.json(result.rows[0]);
});

router.delete("/:id", async (req: Request, res: Response) => {
  const { id } = req.params;
  await db.execute(sql`UPDATE users SET custom_role_id = NULL WHERE custom_role_id = ${Number(id)}`);
  await db.execute(sql`DELETE FROM custom_roles WHERE id = ${Number(id)}`);
  return res.json({ message: "Role dihapus" });
});

router.post("/:id/assign", async (req: Request, res: Response) => {
  const { id } = req.params;
  const { userId } = req.body as { userId: string };
  if (!userId) return res.status(400).json({ message: "userId wajib diisi" });

  const roleRes = await db.execute(sql`SELECT id FROM custom_roles WHERE id = ${Number(id)}`);
  if (!roleRes.rows[0]) return res.status(404).json({ message: "Role tidak ditemukan" });

  await db.execute(sql`UPDATE users SET custom_role_id = ${Number(id)} WHERE id = ${userId}`);
  return res.json({ message: "Pengguna berhasil ditetapkan ke role" });
});

router.delete("/:id/assign/:userId", async (req: Request, res: Response) => {
  const { userId, id } = req.params;
  await db.execute(sql`
    UPDATE users SET custom_role_id = NULL WHERE id = ${userId} AND custom_role_id = ${Number(id)}
  `);
  return res.json({ message: "Pengguna dilepas dari role" });
});

export default router;
