import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { invalidateUserCtxCache } from "../middlewares/authMiddleware.js";
import { deleteFromSupabase } from "../lib/supabaseStorage.js";

const router = Router();

// Boot migrations: add columns + user_allowed_companies table
db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS whatsapp TEXT`).catch(() => {});
db.execute(sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash TEXT`).catch(() => {});
db.execute(sql`
  CREATE TABLE IF NOT EXISTS user_allowed_companies (
    id SERIAL PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, company_id)
  )
`).catch(() => {});

const ADMIN_EMAILS = (process.env["ADMIN_EMAILS"] ?? "divatranssoetta@gmail.com")
  .split(",")
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

const ADMIN_EMAIL_DOMAINS = (process.env["ADMIN_EMAIL_DOMAINS"] ?? "")
  .split(",")
  .map((d) => d.trim().toLowerCase())
  .filter(Boolean);

function emailIsAdmin(email: string): boolean {
  const lower = email.toLowerCase();
  if (ADMIN_EMAILS.includes(lower)) return true;
  const domain = lower.split("@")[1] ?? "";
  return !!domain && ADMIN_EMAIL_DOMAINS.includes(domain);
}

const ALLOWED_ROLES = ["admin", "ecommerce", "trading", "logistics"] as const;
type AllowedRole = typeof ALLOWED_ROLES[number];

async function ensureUserRecord(userId: string, email?: string | null, name?: string | null) {
  const existing = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  const isAdminEmail = !!email && emailIsAdmin(email);

  if (existing.length === 0) {
    await db.insert(usersTable).values({
      id: userId,
      email: email ?? `${userId}@unknown.com`,
      name: name ?? "User",
      role: isAdminEmail ? "admin" : "ecommerce",
    }).onConflictDoNothing();
  } else {
    const cur = existing[0];
    const patch: Partial<typeof cur> = {};
    if (email && cur.email !== email) patch.email = email;
    if (name && (!cur.name || cur.name === "User")) patch.name = name;
    if (isAdminEmail && cur.role !== "admin") patch.role = "admin";
    if (Object.keys(patch).length > 0) {
      await db.update(usersTable).set(patch).where(eq(usersTable.id, userId));
    }
  }

  const final = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
  return final[0];
}

async function requireAdmin(req: any, res: any): Promise<boolean> {
  if (!req.isAuthenticated()) {
    res.status(401).json({ message: "Unauthorized" });
    return false;
  }
  const u = await ensureUserRecord(req.user.id, req.user.email, [req.user.firstName, req.user.lastName].filter(Boolean).join(" ") || null);
  if (!u || u.role !== "admin") {
    res.status(403).json({ message: "Forbidden: admin only" });
    return false;
  }
  return true;
}

// GET /api/users/me
router.get("/me", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });

  const authUser = req.user;
  const fullName = [authUser.firstName, authUser.lastName].filter(Boolean).join(" ") || null;

  try {
    await ensureUserRecord(authUser.id, authUser.email, fullName);

    const rows = await db.execute(sql`
      SELECT
        u.id, u.email, u.name, u.role, u.division, u.department,
        u.company_id, u.branch_id, u.division_id, u.department_id, u.section_id,
        u.whatsapp,
        cr.id   AS custom_role_id,
        cr.name AS custom_role_name,
        cr.permissions AS custom_role_permissions,
        c.company_name,
        c.company_code,
        b.name AS branch_name,
        dv.name AS division_name,
        dep.name AS department_name,
        sec.name AS section_name
      FROM users u
      LEFT JOIN custom_roles cr  ON cr.id  = u.custom_role_id
      LEFT JOIN companies    c   ON c.id   = u.company_id
      LEFT JOIN branches     b   ON b.id   = u.branch_id
      LEFT JOIN divisions    dv  ON dv.id  = u.division_id
      LEFT JOIN departments  dep ON dep.id = u.department_id
      LEFT JOIN sections     sec ON sec.id = u.section_id
      WHERE u.id = ${authUser.id}
    `);
    const u = rows.rows[0] as any;
    if (!u) {
      // DB returned no row — fall back to session data
      return res.json({
        id: authUser.id,
        email: authUser.email ?? null,
        name: fullName ?? authUser.email ?? null,
        role: authUser.role ?? null,
        division: null, department: null,
        companyId: authUser.companyId ?? null, companyName: null, companyCode: null,
        branchId: null, branchName: null, divisionId: null, divisionName: null,
        departmentId: null, departmentName: null, sectionId: null, sectionName: null,
        customRoleId: null, customRoleName: null, customRolePermissions: null,
      });
    }

    let customRolePermissions: string[] | null = null;
    if (u.custom_role_permissions != null) {
      customRolePermissions = Array.isArray(u.custom_role_permissions)
        ? u.custom_role_permissions
        : JSON.parse(u.custom_role_permissions);
    }

    return res.json({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      division: u.division,
      department: u.department,
      whatsapp: u.whatsapp ?? null,
      companyId: u.company_id ?? null,
      companyName: u.company_name ?? null,
      companyCode: u.company_code ?? null,
      branchId: u.branch_id ?? null,
      branchName: u.branch_name ?? null,
      divisionId: u.division_id ?? null,
      divisionName: u.division_name ?? null,
      departmentId: u.department_id ?? null,
      departmentName: u.department_name ?? null,
      sectionId: u.section_id ?? null,
      sectionName: u.section_name ?? null,
      customRoleId: u.custom_role_id ?? null,
      customRoleName: u.custom_role_name ?? null,
      customRolePermissions,
    });
  } catch (_err) {
    // DB transient error — return session user data as fallback so the frontend
    // can still route correctly without redirecting to login.
    return res.json({
      id: authUser.id,
      email: authUser.email ?? null,
      name: fullName ?? authUser.email ?? null,
      role: authUser.role ?? null,
      division: null, department: null,
      companyId: authUser.companyId ?? null, companyName: null, companyCode: null,
      branchId: null, branchName: null, divisionId: null, divisionName: null,
      departmentId: null, departmentName: null, sectionId: null, sectionName: null,
      customRoleId: null, customRoleName: null, customRolePermissions: null,
    });
  }
});

// GET /api/users — admin only
router.get("/", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const rows = await db.execute(sql`
    SELECT
      u.id, u.email, u.name, u.role, u.division, u.department,
      u.company_id, u.branch_id, u.division_id, u.department_id, u.section_id,
      cr.id    AS custom_role_id,
      cr.name  AS custom_role_name,
      cr.color AS custom_role_color,
      c.company_name,
      c.company_code,
      b.name  AS branch_name,
      dv.name AS division_name,
      dep.name AS department_name,
      sec.name AS section_name
    FROM users u
    LEFT JOIN custom_roles cr  ON cr.id  = u.custom_role_id
    LEFT JOIN companies    c   ON c.id   = u.company_id
    LEFT JOIN branches     b   ON b.id   = u.branch_id
    LEFT JOIN divisions    dv  ON dv.id  = u.division_id
    LEFT JOIN departments  dep ON dep.id = u.department_id
    LEFT JOIN sections     sec ON sec.id = u.section_id
    ORDER BY u.name
  `);
  return res.json(rows.rows.map((u: any) => ({
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    division: u.division,
    department: u.department,
    companyId: u.company_id ?? null,
    companyName: u.company_name ?? null,
    companyCode: u.company_code ?? null,
    branchId: u.branch_id ?? null,
    branchName: u.branch_name ?? null,
    divisionId: u.division_id ?? null,
    divisionName: u.division_name ?? null,
    departmentId: u.department_id ?? null,
    departmentName: u.department_name ?? null,
    sectionId: u.section_id ?? null,
    sectionName: u.section_name ?? null,
    customRoleId: u.custom_role_id ?? null,
    customRoleName: u.custom_role_name ?? null,
    customRoleColor: u.custom_role_color ?? null,
  })));
});

// PATCH /api/users/me — self-update (name, whatsapp)
router.patch("/me", async (req, res) => {
  if (!req.isAuthenticated()) return res.status(401).json({ message: "Unauthorized" });
  const authUser = req.user;
  const { whatsapp } = req.body as { whatsapp?: string };
  const patch: Record<string, unknown> = {};
  if (whatsapp !== undefined) {
    // Normalize: strip spaces, ensure starts with 62 if Indonesian format
    const normalized = whatsapp.trim().replace(/\s+/g, "");
    patch["whatsapp"] = normalized || null;
  }
  if (Object.keys(patch).length === 0) return res.json({ ok: true });
  const [updated] = await db.update(usersTable).set(patch as any).where(eq(usersTable.id, authUser.id)).returning();
  if (!updated) return res.status(404).json({ message: "User not found" });
  invalidateUserCtxCache(authUser.id);
  return res.json({ ok: true, whatsapp: (updated as any).whatsapp ?? null });
});

// POST /api/users — admin only, pre-register user by email
router.post("/", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const { email, name, role } = req.body as { email?: string; name?: string; role?: string };

  if (!email || !email.includes("@")) {
    return res.status(400).json({ message: "Email tidak valid" });
  }
  if (!role || !ALLOWED_ROLES.includes(role as AllowedRole)) {
    return res.status(400).json({ message: "Role tidak valid" });
  }

  const normalizedEmail = email.trim().toLowerCase();
  const existing = await db.select().from(usersTable).where(eq(usersTable.email, normalizedEmail)).limit(1);
  if (existing.length > 0) {
    return res.status(409).json({ message: "User dengan email ini sudah terdaftar" });
  }

  const userId = `pre_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const [created] = await db.insert(usersTable).values({
    id: userId,
    email: normalizedEmail,
    name: name?.trim() || normalizedEmail.split("@")[0] || "User",
    role: role as AllowedRole,
  }).returning();

  return res.status(201).json({
    id: created.id,
    email: created.email,
    name: created.name,
    role: created.role,
    division: created.division,
    companyId: created.companyId ?? null,
    branchId: created.branchId ?? null,
    divisionId: created.divisionId ?? null,
    departmentId: created.departmentId ?? null,
    sectionId: created.sectionId ?? null,
    customRoleId: created.customRoleId ?? null,
  });
});

// GET /api/users/:id/allowed-companies — unrestricted admin only
// A restricted admin (non-empty allowedCompanyIds) must NOT be able to read or
// write allowlists — otherwise they could self-escalate by modifying their own entry.
router.get("/:id/allowed-companies", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const callerAllowedIds = (req.user as any)?.allowedCompanyIds as number[] | undefined;
  if (callerAllowedIds && callerAllowedIds.length > 0) {
    return res.status(403).json({ message: "Forbidden: hanya unrestricted admin yang dapat mengelola allowed-companies" });
  }
  const { id } = req.params;
  const rows = await db.execute(sql`
    SELECT uac.company_id, c.company_name, c.company_code
    FROM user_allowed_companies uac
    JOIN companies c ON c.id = uac.company_id
    WHERE uac.user_id = ${id}
    ORDER BY c.company_name
  `);
  return res.json(rows.rows);
});

// PUT /api/users/:id/allowed-companies — unrestricted admin only
// Pass companyIds: [] to remove all restrictions (allow all companies)
router.put("/:id/allowed-companies", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const callerAllowedIds = (req.user as any)?.allowedCompanyIds as number[] | undefined;
  if (callerAllowedIds && callerAllowedIds.length > 0) {
    return res.status(403).json({ message: "Forbidden: hanya unrestricted admin yang dapat mengelola allowed-companies" });
  }
  const { id } = req.params;
  const { companyIds } = req.body as { companyIds: number[] };

  if (!Array.isArray(companyIds)) {
    return res.status(400).json({ message: "companyIds harus berupa array" });
  }
  const validIds = companyIds.filter((c) => typeof c === "number" && Number.isFinite(c) && c > 0);

  // Replace entire allowlist atomically — DELETE then INSERT in one transaction so there
  // is never a window where the list is empty (which would transiently grant unrestricted access).
  await db.transaction(async (tx) => {
    await tx.execute(sql`DELETE FROM user_allowed_companies WHERE user_id = ${id}`);
    for (const companyId of validIds) {
      await tx.execute(sql`
        INSERT INTO user_allowed_companies (user_id, company_id)
        VALUES (${id}, ${companyId})
        ON CONFLICT DO NOTHING
      `);
    }
  });

  invalidateUserCtxCache(id);
  return res.json({ ok: true, companyIds: validIds });
});

// DELETE /api/users/:id — admin only
router.delete("/:id", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const { id } = req.params;
  const [user] = await db.select({ profileImageUrl: usersTable.profileImageUrl }).from(usersTable).where(eq(usersTable.id, id));
  const deleted = await db.delete(usersTable).where(eq(usersTable.id, id)).returning();
  if (deleted.length === 0) return res.status(404).json({ message: "User tidak ditemukan" });
  invalidateUserCtxCache(id);
  if (user?.profileImageUrl) deleteFromSupabase(user.profileImageUrl).catch(() => {});
  return res.json({ ok: true });
});

// PUT /api/users/:id — admin only
router.put("/:id", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const { id } = req.params;
  const {
    role, division, name, whatsapp,
    companyId, branchId, divisionId, departmentId, sectionId,
    customRoleId,
  } = req.body as {
    role: AllowedRole;
    division?: string | null;
    name?: string;
    whatsapp?: string | null;
    companyId?: number | null;
    branchId?: number | null;
    divisionId?: number | null;
    departmentId?: number | null;
    sectionId?: number | null;
    customRoleId?: number | null;
  };

  if (!role || !ALLOWED_ROLES.includes(role)) {
    return res.status(400).json({ message: "Invalid role" });
  }

  const patch: Record<string, unknown> = { role };
  if (division !== undefined) patch["division"] = division;
  if (typeof name === "string" && name.trim()) patch["name"] = name.trim();
  if (whatsapp !== undefined) patch["whatsapp"] = whatsapp?.trim() || null;
  if (companyId !== undefined) patch["companyId"] = companyId ?? null;
  if (branchId !== undefined) patch["branchId"] = branchId ?? null;
  if (divisionId !== undefined) patch["divisionId"] = divisionId ?? null;
  if (departmentId !== undefined) patch["departmentId"] = departmentId ?? null;
  if (sectionId !== undefined) patch["sectionId"] = sectionId ?? null;
  if (customRoleId !== undefined) patch["customRoleId"] = customRoleId ?? null;

  const [updated] = await db.update(usersTable).set(patch).where(eq(usersTable.id, id)).returning();
  if (!updated) return res.status(404).json({ message: "User not found" });

  // Bust the in-memory auth cache so next request picks up new company/role
  invalidateUserCtxCache(id);

  return res.json({
    id: updated.id,
    email: updated.email,
    name: updated.name,
    role: updated.role,
    division: updated.division,
    companyId: updated.companyId ?? null,
    branchId: updated.branchId ?? null,
    divisionId: updated.divisionId ?? null,
    departmentId: updated.departmentId ?? null,
    sectionId: updated.sectionId ?? null,
    customRoleId: updated.customRoleId ?? null,
  });
});

export default router;
