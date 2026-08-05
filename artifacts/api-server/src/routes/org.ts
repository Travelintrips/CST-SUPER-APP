import { Router } from "express";
import { db } from "@workspace/db";
import { sql, eq } from "drizzle-orm";
import { branchesTable, divisionsTable, departmentsTable, sectionsTable } from "@workspace/db/schema";
import { requireAdmin } from "../lib/requireAdmin.js";

const router = Router();

// ── helpers ───────────────────────────────────────────────────────────────────

function isAdmin(req: any): boolean {
  return req.isAuthenticated() && req.user?.role === "admin";
}

function resolveCompanyId(req: any): number | null | "forbidden" {
  const qp = req.query.companyId as string | undefined;
  const userCompanyId: number | null = req.user?.companyId ?? null;
  const admin = isAdmin(req);
  if (qp === "all" || !qp) {
    if (admin) return null;
    return userCompanyId;
  }
  const id = Number(qp);
  if (Number.isNaN(id)) return "forbidden";
  if (!admin && userCompanyId !== null && id !== userCompanyId) return "forbidden";
  return id;
}

/**
 * Detects PostgreSQL unique constraint violation (error code 23505) for our
 * org-structure partial unique indexes. Returns a friendly error message or
 * null if the error is unrelated.
 */
function getDuplicateCodeMessage(err: any, entityLabel: string): string | null {
  const pgCode: string | undefined = err?.cause?.code ?? err?.code;
  if (pgCode !== "23505") return null;

  const constraint: string =
    err?.cause?.constraint ?? err?.constraint ??
    err?.cause?.message ?? err?.message ?? "";

  if (
    constraint.includes("branches_company_code_unique") ||
    constraint.includes("divisions_company_code_unique") ||
    constraint.includes("departments_company_code_unique") ||
    constraint.includes("sections_company_code_unique") ||
    // Fallback: drizzle wraps the message — check the inner message text too
    (pgCode === "23505" && constraint.includes("company_code"))
  ) {
    return `Kode ${entityLabel} sudah digunakan oleh ${entityLabel} lain dalam perusahaan yang sama. Gunakan kode yang berbeda.`;
  }

  // Generic unique violation (e.g. other constraints)
  if (pgCode === "23505") {
    return `Terjadi konflik data unik pada ${entityLabel}. Periksa kembali nilai yang Anda masukkan.`;
  }

  return null;
}

// ── camelCase helper ──────────────────────────────────────────────────────────

function snakeToCamel(s: string): string {
  return s.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function rowToCamel(row: Record<string, any>): Record<string, any> {
  const out: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    out[snakeToCamel(k)] = v;
  }
  return out;
}

// ── BRANCHES ─────────────────────────────────────────────────────────────────

router.get("/branches", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
  const cid = resolveCompanyId(req);
  if (cid === "forbidden") return res.status(403).json({ message: "Forbidden" });

  const rows = await db.execute(sql`
    SELECT b.*, c.company_name, c.company_code
    FROM branches b
    JOIN companies c ON c.id = b.company_id
    ${cid !== null ? sql`WHERE b.company_id = ${cid}` : sql``}
    ORDER BY c.company_code, b.name
  `);
  return res.json(rows.rows.map(rowToCamel));
});

router.get("/branches/check-code", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
  const code = String(req.query.code ?? "").trim().toUpperCase();
  const companyId = req.query.companyId ? Number(req.query.companyId) : null;
  const excludeId = req.query.excludeId ? Number(req.query.excludeId) : null;
  if (!code) return res.json({ taken: false });
  const result = await db.execute(sql`
    SELECT id FROM branches
    WHERE UPPER(COALESCE(code, '')) = ${code}
    ${companyId && !Number.isNaN(companyId) ? sql`AND company_id = ${companyId}` : sql``}
    ${excludeId && !Number.isNaN(excludeId) ? sql`AND id != ${excludeId}` : sql``}
    LIMIT 1
  `);
  return res.json({ taken: result.rows.length > 0 });
});

router.post("/branches", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const { companyId, name, code, address, phone } = req.body ?? {};
  if (!companyId || !name) return res.status(400).json({ message: "companyId and name required" });
  try {
    const [created] = await db.insert(branchesTable)
      .values({ companyId: Number(companyId), name, code, address, phone })
      .returning();
    return res.status(201).json(created);
  } catch (err: any) {
    const msg = getDuplicateCodeMessage(err, "Cabang");
    if (msg) return res.status(409).json({ message: msg });
    throw err;
  }
});

router.patch("/branches/:id", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  const { name, code, address, phone, isActive } = req.body ?? {};
  const patch: Record<string, unknown> = {};
  if (name !== undefined) patch.name = name;
  if (code !== undefined) patch.code = code;
  if (address !== undefined) patch.address = address;
  if (phone !== undefined) patch.phone = phone;
  if (isActive !== undefined) patch.isActive = isActive;
  if (!Object.keys(patch).length) return res.status(400).json({ message: "No fields to update" });
  try {
    const [updated] = await db.update(branchesTable).set(patch).where(eq(branchesTable.id, id)).returning();
    if (!updated) return res.status(404).json({ message: "Not found" });
    return res.json(updated);
  } catch (err: any) {
    const msg = getDuplicateCodeMessage(err, "Cabang");
    if (msg) return res.status(409).json({ message: msg });
    throw err;
  }
});

router.delete("/branches/:id", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  await db.delete(branchesTable).where(eq(branchesTable.id, id));
  return res.json({ success: true });
});

// ── DIVISIONS ─────────────────────────────────────────────────────────────────

router.get("/divisions", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
  const cid = resolveCompanyId(req);
  if (cid === "forbidden") return res.status(403).json({ message: "Forbidden" });

  const branchId = req.query.branchId ? Number(req.query.branchId) : null;

  const rows = await db.execute(sql`
    SELECT
      d.*,
      c.company_name, c.company_code,
      b.name AS branch_name,
      u.name AS manager_name, u.email AS manager_email
    FROM divisions d
    JOIN companies c ON c.id = d.company_id
    LEFT JOIN branches b ON b.id = d.branch_id
    LEFT JOIN users u ON u.id = d.manager_id
    WHERE TRUE
      ${cid !== null ? sql`AND d.company_id = ${cid}` : sql``}
      ${branchId !== null ? sql`AND d.branch_id = ${branchId}` : sql``}
    ORDER BY c.company_code, d.name
  `);
  return res.json(rows.rows.map(rowToCamel));
});

router.get("/divisions/check-code", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
  const code = String(req.query.code ?? "").trim().toUpperCase();
  const companyId = req.query.companyId ? Number(req.query.companyId) : null;
  const excludeId = req.query.excludeId ? Number(req.query.excludeId) : null;
  if (!code) return res.json({ taken: false });
  const result = await db.execute(sql`
    SELECT id FROM divisions
    WHERE UPPER(COALESCE(code, '')) = ${code}
    ${companyId && !Number.isNaN(companyId) ? sql`AND company_id = ${companyId}` : sql``}
    ${excludeId && !Number.isNaN(excludeId) ? sql`AND id != ${excludeId}` : sql``}
    LIMIT 1
  `);
  return res.json({ taken: result.rows.length > 0 });
});

router.post("/divisions", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const { companyId, branchId, name, code, description, managerId } = req.body ?? {};
  if (!companyId || !name) return res.status(400).json({ message: "companyId and name required" });
  try {
    const [created] = await db.insert(divisionsTable)
      .values({ companyId: Number(companyId), name, code, description })
      .returning();
    return res.status(201).json(created);
  } catch (err: any) {
    const msg = getDuplicateCodeMessage(err, "Divisi");
    if (msg) return res.status(409).json({ message: msg });
    throw err;
  }
  const result = await db.execute(sql`
    INSERT INTO divisions (company_id, branch_id, name, code, description, manager_id)
    VALUES (
      ${Number(companyId)},
      ${branchId ? Number(branchId) : null},
      ${name},
      ${code ?? null},
      ${description ?? null},
      ${managerId ?? null}
    )
    RETURNING *
  `);
  return res.status(201).json(result.rows[0]);
});

router.patch("/divisions/:id", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  const { name, code, description, isActive, branchId, managerId } = req.body ?? {};
  const patch: Record<string, unknown> = {};
  if (name !== undefined) patch.name = name;
  if (code !== undefined) patch.code = code;
  if (description !== undefined) patch.description = description;
  if (isActive !== undefined) patch.isActive = isActive;
  if (branchId !== undefined) patch.branchId = branchId ? Number(branchId) : null;
  if (managerId !== undefined) patch.managerId = managerId ?? null;
  if (!Object.keys(patch).length) return res.status(400).json({ message: "No fields" });
  try {
    const [updated] = await db.update(divisionsTable).set(patch).where(eq(divisionsTable.id, id)).returning();
    if (!updated) return res.status(404).json({ message: "Not found" });
    return res.json(updated);
  } catch (err: any) {
    const msg = getDuplicateCodeMessage(err, "Divisi");
    if (msg) return res.status(409).json({ message: msg });
    throw err;
  }
});

router.delete("/divisions/:id", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  await db.delete(divisionsTable).where(eq(divisionsTable.id, id));
  return res.json({ success: true });
});

// ── DEPARTMENTS ───────────────────────────────────────────────────────────────

router.get("/departments", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
  const cid = resolveCompanyId(req);
  if (cid === "forbidden") return res.status(403).json({ message: "Forbidden" });

  const divId = req.query.divisionId ? Number(req.query.divisionId) : null;
  const branchId = req.query.branchId ? Number(req.query.branchId) : null;

  const rows = await db.execute(sql`
    SELECT
      dep.*,
      c.company_name, c.company_code,
      div.name AS division_name, div.code AS division_code,
      b.name AS branch_name,
      u.name AS manager_name, u.email AS manager_email
    FROM departments dep
    JOIN companies c ON c.id = dep.company_id
    LEFT JOIN divisions div ON div.id = dep.division_id
    LEFT JOIN branches b ON b.id = dep.branch_id
    LEFT JOIN users u ON u.id = dep.manager_id
    WHERE TRUE
      ${cid !== null ? sql`AND dep.company_id = ${cid}` : sql``}
      ${divId !== null ? sql`AND dep.division_id = ${divId}` : sql``}
      ${branchId !== null ? sql`AND dep.branch_id = ${branchId}` : sql``}
    ORDER BY c.company_code, div.name, dep.name
  `);
  return res.json(rows.rows.map(rowToCamel));
});

router.get("/departments/check-code", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
  const code = String(req.query.code ?? "").trim().toUpperCase();
  const companyId = req.query.companyId ? Number(req.query.companyId) : null;
  const excludeId = req.query.excludeId ? Number(req.query.excludeId) : null;
  if (!code) return res.json({ taken: false });
  const result = await db.execute(sql`
    SELECT id FROM departments
    WHERE UPPER(COALESCE(code, '')) = ${code}
    ${companyId && !Number.isNaN(companyId) ? sql`AND company_id = ${companyId}` : sql``}
    ${excludeId && !Number.isNaN(excludeId) ? sql`AND id != ${excludeId}` : sql``}
    LIMIT 1
  `);
  return res.json({ taken: result.rows.length > 0 });
});

router.post("/departments", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const { companyId, divisionId, branchId, name, code, description, managerId } = req.body ?? {};
  if (!companyId || !name) return res.status(400).json({ message: "companyId and name required" });
  try {
    const [created] = await db.insert(departmentsTable)
      .values({ companyId: Number(companyId), divisionId: divisionId ? Number(divisionId) : null, name, code, description })
      .returning();
    return res.status(201).json(created);
  } catch (err: any) {
    const msg = getDuplicateCodeMessage(err, "Departemen");
    if (msg) return res.status(409).json({ message: msg });
    throw err;
  }
  const result = await db.execute(sql`
    INSERT INTO departments (company_id, division_id, branch_id, name, code, description, manager_id)
    VALUES (
      ${Number(companyId)},
      ${divisionId ? Number(divisionId) : null},
      ${branchId ? Number(branchId) : null},
      ${name},
      ${code ?? null},
      ${description ?? null},
      ${managerId ?? null}
    )
    RETURNING *
  `);
  return res.status(201).json(result.rows[0]);
});

router.patch("/departments/:id", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  const { name, code, description, divisionId, branchId, isActive, managerId } = req.body ?? {};
  const patch: Record<string, unknown> = {};
  if (name !== undefined) patch.name = name;
  if (code !== undefined) patch.code = code;
  if (description !== undefined) patch.description = description;
  if (divisionId !== undefined) patch.divisionId = divisionId ? Number(divisionId) : null;
  if (branchId !== undefined) patch.branchId = branchId ? Number(branchId) : null;
  if (isActive !== undefined) patch.isActive = isActive;
  if (managerId !== undefined) patch.managerId = managerId ?? null;
  if (!Object.keys(patch).length) return res.status(400).json({ message: "No fields" });
  try {
    const [updated] = await db.update(departmentsTable).set(patch).where(eq(departmentsTable.id, id)).returning();
    if (!updated) return res.status(404).json({ message: "Not found" });
    return res.json(updated);
  } catch (err: any) {
    const msg = getDuplicateCodeMessage(err, "Departemen");
    if (msg) return res.status(409).json({ message: msg });
    throw err;
  }
});

router.delete("/departments/:id", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  await db.delete(departmentsTable).where(eq(departmentsTable.id, id));
  return res.json({ success: true });
});

// ── SECTIONS ──────────────────────────────────────────────────────────────────

router.get("/sections", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
  const cid = resolveCompanyId(req);
  if (cid === "forbidden") return res.status(403).json({ message: "Forbidden" });

  const deptId = req.query.departmentId ? Number(req.query.departmentId) : null;
  const rows = await db.execute(sql`
    SELECT s.*, c.company_name, c.company_code, dep.name AS department_name
    FROM sections s
    JOIN companies c ON c.id = s.company_id
    LEFT JOIN departments dep ON dep.id = s.department_id
    WHERE TRUE
      ${cid !== null ? sql`AND s.company_id = ${cid}` : sql``}
      ${deptId !== null ? sql`AND s.department_id = ${deptId}` : sql``}
    ORDER BY c.company_code, dep.name, s.name
  `);
  return res.json(rows.rows.map(rowToCamel));
});

router.get("/sections/check-code", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
  const code = String(req.query.code ?? "").trim().toUpperCase();
  const companyId = req.query.companyId ? Number(req.query.companyId) : null;
  const excludeId = req.query.excludeId ? Number(req.query.excludeId) : null;
  if (!code) return res.json({ taken: false });
  const result = await db.execute(sql`
    SELECT id FROM sections
    WHERE UPPER(COALESCE(code, '')) = ${code}
    ${companyId && !Number.isNaN(companyId) ? sql`AND company_id = ${companyId}` : sql``}
    ${excludeId && !Number.isNaN(excludeId) ? sql`AND id != ${excludeId}` : sql``}
    LIMIT 1
  `);
  return res.json({ taken: result.rows.length > 0 });
});

router.post("/sections", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const { companyId, departmentId, name, code, description } = req.body ?? {};
  if (!companyId || !name) return res.status(400).json({ message: "companyId and name required" });
  try {
    const [created] = await db.insert(sectionsTable)
      .values({ companyId: Number(companyId), departmentId: departmentId ? Number(departmentId) : null, name, code, description })
      .returning();
    return res.status(201).json(created);
  } catch (err: any) {
    const msg = getDuplicateCodeMessage(err, "Seksi");
    if (msg) return res.status(409).json({ message: msg });
    throw err;
  }
});

router.patch("/sections/:id", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  const { name, code, description, departmentId, isActive } = req.body ?? {};
  const patch: Record<string, unknown> = {};
  if (name !== undefined) patch.name = name;
  if (code !== undefined) patch.code = code;
  if (description !== undefined) patch.description = description;
  if (departmentId !== undefined) patch.departmentId = departmentId ? Number(departmentId) : null;
  if (isActive !== undefined) patch.isActive = isActive;
  if (!Object.keys(patch).length) return res.status(400).json({ message: "No fields" });
  try {
    const [updated] = await db.update(sectionsTable).set(patch).where(eq(sectionsTable.id, id)).returning();
    if (!updated) return res.status(404).json({ message: "Not found" });
    return res.json(updated);
  } catch (err: any) {
    const msg = getDuplicateCodeMessage(err, "Seksi");
    if (msg) return res.status(409).json({ message: msg });
    throw err;
  }
});

router.delete("/sections/:id", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const id = Number(req.params.id);
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });
  await db.delete(sectionsTable).where(eq(sectionsTable.id, id));
  return res.json({ success: true });
});

// ── HIERARCHY ─────────────────────────────────────────────────────────────────

router.get("/hierarchy", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
  const cid = resolveCompanyId(req);
  if (cid === "forbidden") return res.status(403).json({ message: "Forbidden" });

  const companies = await db.execute(sql`
    SELECT id, company_name AS name, company_code AS code, is_active
    FROM companies
    ${cid !== null ? sql`WHERE id = ${cid}` : sql``}
    ORDER BY id
  `);

  const branches = await db.execute(sql`
    SELECT * FROM branches
    ${cid !== null ? sql`WHERE company_id = ${cid}` : sql``}
    ORDER BY company_id, name
  `);

  const divisions = await db.execute(sql`
    SELECT d.*, u.name AS manager_name, b.name AS branch_name
    FROM divisions d
    LEFT JOIN users u ON u.id = d.manager_id
    LEFT JOIN branches b ON b.id = d.branch_id
    ${cid !== null ? sql`WHERE d.company_id = ${cid}` : sql``}
    ORDER BY d.company_id, d.name
  `);

  const departments = await db.execute(sql`
    SELECT dep.*, u.name AS manager_name, b.name AS branch_name
    FROM departments dep
    LEFT JOIN users u ON u.id = dep.manager_id
    LEFT JOIN branches b ON b.id = dep.branch_id
    ${cid !== null ? sql`WHERE dep.company_id = ${cid}` : sql``}
    ORDER BY dep.company_id, dep.division_id, dep.name
  `);

  const sections = await db.execute(sql`
    SELECT * FROM sections
    ${cid !== null ? sql`WHERE company_id = ${cid}` : sql``}
    ORDER BY company_id, department_id, name
  `);

  const userCounts = await db.execute(sql`
    SELECT company_id, branch_id, division_id, department_id, COUNT(*) AS cnt
    FROM users
    ${cid !== null ? sql`WHERE company_id = ${cid}` : sql``}
    GROUP BY company_id, branch_id, division_id, department_id
  `);

  const ucRows = userCounts.rows as Array<{
    company_id: number; branch_id: number | null;
    division_id: number | null; department_id: number | null; cnt: string
  }>;

  function userCountByCompany(cId: number) {
    return ucRows.filter(r => r.company_id === cId).reduce((s, r) => s + Number(r.cnt), 0);
  }
  function userCountByBranch(bId: number) {
    return ucRows.filter(r => r.branch_id === bId).reduce((s, r) => s + Number(r.cnt), 0);
  }
  function userCountByDivision(dId: number) {
    return ucRows.filter(r => r.division_id === dId).reduce((s, r) => s + Number(r.cnt), 0);
  }
  function userCountByDept(dId: number) {
    return ucRows.filter(r => r.department_id === dId).reduce((s, r) => s + Number(r.cnt), 0);
  }

  const companiesC = (companies.rows as any[]).map(rowToCamel);
  const branchesC  = (branches.rows  as any[]).map(rowToCamel);
  const divisionsC = (divisions.rows  as any[]).map(rowToCamel);
  const departmentsC = (departments.rows as any[]).map(rowToCamel);
  const sectionsC  = (sections.rows  as any[]).map(rowToCamel);

  const tree = companiesC.map((co) => ({
    ...co,
    userCount: userCountByCompany(co.id),
    branches: branchesC
      .filter(b => b.companyId === co.id)
      .map(b => ({ ...b, userCount: userCountByBranch(b.id) })),
    divisions: divisionsC
      .filter(d => d.companyId === co.id)
      .map(div => ({
        ...div,
        userCount: userCountByDivision(div.id),
        departments: departmentsC
          .filter(dep => dep.companyId === co.id && dep.divisionId === div.id)
          .map(dep => ({
            ...dep,
            userCount: userCountByDept(dep.id),
            sections: sectionsC
              .filter(s => s.companyId === co.id && s.departmentId === dep.id),
          })),
      })),
  }));

  return res.json(tree);
});

export default router;
