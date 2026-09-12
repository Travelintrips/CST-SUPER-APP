/**
 * GET /api/audit-logs — Lihat audit trail ERP
 * Hanya admin/owner yang boleh mengakses.
 */

import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin, requireClerkUser } from "../lib/requireAdmin.js";
import { resolveCompanyId } from "../lib/resolveCompany.js";

const router = Router();

router.use(async (req: Request, res: Response, next) => {
  if (!(await requireClerkUser(req, res))) return;
  next();
});

// GET /api/audit-logs — list audit log dengan filter
router.get("/", async (req: Request, res: Response) => {
  // Hanya admin/owner boleh lihat semua audit log
  const user = req.user as { role?: string | null; companyId?: number | null };
  const isAdmin = ["admin", "owner"].includes(user?.role ?? "");
  if (!isAdmin) {
    res.status(403).json({ message: "Hanya admin/owner yang bisa mengakses audit log" });
    return;
  }

  const companyId = resolveCompanyId(req);
  const { from, to, module: mod, action, userId, branchId, referenceId } = req.query as Record<string, string>;
  const limit = Math.min(Number(req.query.limit ?? 100), 500);
  const offset = Number(req.query.offset ?? 0);

  const rows = await db.execute(sql`
    SELECT
      al.id, al.company_id, al.branch_id, al.user_id, al.user_email,
      al.action, al.module, al.reference_id,
      al.old_data, al.new_data,
      al.ip_address, al.created_at,
      b.name AS branch_name
    FROM erp_audit_logs al
    LEFT JOIN pos_branches b ON b.id = al.branch_id
    WHERE (al.company_id = ${companyId} OR al.company_id IS NULL)
      ${mod ? sql`AND al.module = ${mod}` : sql``}
      ${action ? sql`AND al.action = ${action}` : sql``}
      ${userId ? sql`AND al.user_id = ${userId}` : sql``}
      ${branchId ? sql`AND al.branch_id = ${Number(branchId)}` : sql``}
      ${referenceId ? sql`AND al.reference_id ILIKE ${"%" + referenceId + "%"}` : sql``}
      ${from ? sql`AND al.created_at >= ${from}::timestamp` : sql``}
      ${to ? sql`AND al.created_at <= ${to}::timestamp + interval '1 day'` : sql``}
    ORDER BY al.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `);

  const countRows = await db.execute(sql`
    SELECT COUNT(*)::int AS total
    FROM erp_audit_logs al
    WHERE (al.company_id = ${companyId} OR al.company_id IS NULL)
      ${mod ? sql`AND al.module = ${mod}` : sql``}
      ${action ? sql`AND al.action = ${action}` : sql``}
      ${userId ? sql`AND al.user_id = ${userId}` : sql``}
      ${branchId ? sql`AND al.branch_id = ${Number(branchId)}` : sql``}
      ${referenceId ? sql`AND al.reference_id ILIKE ${"%" + referenceId + "%"}` : sql``}
      ${from ? sql`AND al.created_at >= ${from}::timestamp` : sql``}
      ${to ? sql`AND al.created_at <= ${to}::timestamp + interval '1 day'` : sql``}
  `);

  res.json({
    rows: rows.rows,
    total: (countRows.rows[0] as any)?.total ?? 0,
    limit,
    offset,
  });
});

// GET /api/audit-logs/stats — ringkasan aktivitas
router.get("/stats", async (req: Request, res: Response) => {
  const user = req.user as { role?: string | null; companyId?: number | null };
  const isAdmin = ["admin", "owner"].includes(user?.role ?? "");
  if (!isAdmin) { res.status(403).json({ message: "Forbidden" }); return; }

  const companyId = resolveCompanyId(req);
  const { from, to } = req.query as Record<string, string>;
  const today = new Date().toISOString().split("T")[0];
  const fromDate = from ?? today;
  const toDate = to ?? today;

  const [byModule, byAction, byUser, totalRow] = await Promise.all([
    db.execute(sql`
      SELECT module, COUNT(*)::int AS total
      FROM erp_audit_logs
      WHERE (company_id = ${companyId} OR company_id IS NULL)
        AND created_at >= ${fromDate}::date
        AND created_at < ${toDate}::date + interval '1 day'
      GROUP BY module ORDER BY total DESC
    `),
    db.execute(sql`
      SELECT action, COUNT(*)::int AS total
      FROM erp_audit_logs
      WHERE (company_id = ${companyId} OR company_id IS NULL)
        AND created_at >= ${fromDate}::date
        AND created_at < ${toDate}::date + interval '1 day'
      GROUP BY action ORDER BY total DESC
    `),
    db.execute(sql`
      SELECT user_email, COUNT(*)::int AS total
      FROM erp_audit_logs
      WHERE (company_id = ${companyId} OR company_id IS NULL)
        AND created_at >= ${fromDate}::date
        AND created_at < ${toDate}::date + interval '1 day'
        AND user_email IS NOT NULL
      GROUP BY user_email ORDER BY total DESC LIMIT 10
    `),
    db.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM erp_audit_logs
      WHERE (company_id = ${companyId} OR company_id IS NULL)
        AND created_at >= ${fromDate}::date
        AND created_at < ${toDate}::date + interval '1 day'
    `),
  ]);

  res.json({
    total: (totalRow.rows[0] as any)?.total ?? 0,
    byModule: byModule.rows,
    byAction: byAction.rows,
    byUser: byUser.rows,
    period: { from: fromDate, to: toDate },
  });
});

// GET /api/audit-logs/modules — daftar modul unik
router.get("/modules", async (req: Request, res: Response) => {
  const rows = await db.execute(sql`SELECT DISTINCT module FROM erp_audit_logs ORDER BY module`);
  res.json(rows.rows.map((r: any) => r.module));
});

// ── Security Center endpoints ─────────────────────────────────────────────────

// GET /api/audit-logs/security/overview — hitungan 7 hari untuk 6 metrik kartu (admin + super_admin)
router.get("/security/overview", async (req: Request, res: Response) => {
  const user = req.user as { role?: string | null; companyId?: number | null };
  const isAdmin = ["admin", "owner", "super_admin"].includes(user?.role ?? "");
  if (!isAdmin) { res.status(403).json({ message: "Hanya admin/owner/super_admin" }); return; }

  const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  const ACTIONS = [
    "RBAC_LOOKUP_FAILED",
    "CROSS_COMPANY_RESOURCE_ACCESS_DENIED",
    "CROSS_TENANT_RESOURCE_ACCESS_DENIED",
    "FINANCE_OVERRIDE",
    "PUBLIC_TOKEN_EXPIRED",
    "LOGIN_FAILED",
  ] as const;

  const counts = await Promise.all(
    ACTIONS.map((action) =>
      db.execute(sql`
        SELECT COUNT(*)::int AS total
        FROM erp_audit_logs
        WHERE action = ${action}
          AND created_at >= ${since}::timestamp
      `)
    )
  );

  res.json({
    rbacFailures:       (counts[0].rows[0] as any)?.total ?? 0,
    crossCompanyDenied: (counts[1].rows[0] as any)?.total ?? 0,
    crossTenantDenied:  (counts[2].rows[0] as any)?.total ?? 0,
    financeOverrides:   (counts[3].rows[0] as any)?.total ?? 0,
    expiredTokens:      (counts[4].rows[0] as any)?.total ?? 0,
    failedLogins:       (counts[5].rows[0] as any)?.total ?? 0,
    since,
  });
});

// GET /api/audit-logs/security/events — event terfilter per section (super_admin only)
// Query params: section=high-severity|overrides|bulk-ops|timeline  limit  offset
router.get("/security/events", async (req: Request, res: Response) => {
  const user = req.user as { role?: string | null; companyId?: number | null };
  const isSuperAdmin = user?.role === "super_admin";
  if (!isSuperAdmin) { res.status(403).json({ message: "Hanya super_admin yang bisa mengakses security events" }); return; }

  const { section = "high-severity", limit: limitQ = "50", offset: offsetQ = "0" } = req.query as Record<string, string>;
  const limit = Math.min(Number(limitQ) || 50, 200);
  const offset = Math.max(Number(offsetQ) || 0, 0);

  const ACTION_SETS: Record<string, string[]> = {
    "high-severity": [
      "RBAC_LOOKUP_FAILED",
      "CROSS_COMPANY_RESOURCE_ACCESS_DENIED",
      "CROSS_TENANT_RESOURCE_ACCESS_DENIED",
      "PUBLIC_TOKEN_EXPIRED",
      "FINANCE_OVERRIDE",
    ],
    "overrides": [
      "CROSS_COMPANY_RESOURCE_ACCESS_ALLOWED",
      "CROSS_TENANT_RESOURCE_ACCESS_ALLOWED",
      "FINANCE_OVERRIDE",
    ],
    "bulk-ops": [
      "BULK_OPERATION_VERIFIED",
      "BULK_OPERATION_DENIED",
    ],
    "timeline": [],
  };

  const actions = ACTION_SETS[section] ?? ACTION_SETS["high-severity"]!;
  const isTimeline = section === "timeline";

  const [dataRows, countRow] = await Promise.all([
    isTimeline
      ? db.execute(sql`
          SELECT id, created_at, action, module, user_email, user_id, company_id, ip_address, new_data
          FROM erp_audit_logs
          ORDER BY created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `)
      : db.execute(sql`
          SELECT id, created_at, action, module, user_email, user_id, company_id, ip_address, new_data
          FROM erp_audit_logs
          WHERE action = ANY(${actions}::text[])
          ORDER BY created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `),
    isTimeline
      ? db.execute(sql`SELECT COUNT(*)::int AS total FROM erp_audit_logs`)
      : db.execute(sql`SELECT COUNT(*)::int AS total FROM erp_audit_logs WHERE action = ANY(${actions}::text[])`),
  ]);

  res.json({
    rows: dataRows.rows,
    total: (countRow.rows[0] as any)?.total ?? 0,
    limit,
    offset,
  });
});

// GET /api/audit-logs/cross-company — daftar COMPANY_CONTEXT_SWITCH events (admin only)
router.get("/cross-company", async (req: Request, res: Response) => {
  const user = req.user as { role?: string | null; companyId?: number | null };
  const isAdmin = ["admin", "owner", "super_admin"].includes(user?.role ?? "");
  if (!isAdmin) {
    res.status(403).json({ message: "Hanya admin/owner/super_admin yang bisa mengakses log ini" });
    return;
  }

  const { from, to, userId, limit: limitQ, offset: offsetQ } = req.query as Record<string, string>;
  const limit = Math.min(Number(limitQ ?? 100), 500);
  const offset = Number(offsetQ ?? 0);

  const rows = await db.execute(sql`
    SELECT
      al.id,
      al.company_id,
      al.user_id,
      al.user_email,
      al.action,
      al.module,
      al.reference_id,
      al.new_data,
      al.ip_address,
      al.user_agent,
      al.created_at
    FROM erp_audit_logs al
    WHERE al.action = 'COMPANY_CONTEXT_SWITCH'
      ${userId ? sql`AND al.user_id = ${userId}` : sql``}
      ${from   ? sql`AND al.created_at >= ${from}::timestamp` : sql``}
      ${to     ? sql`AND al.created_at <= ${to}::timestamp + interval '1 day'` : sql``}
    ORDER BY al.created_at DESC
    LIMIT ${limit} OFFSET ${offset}
  `);

  const countRows = await db.execute(sql`
    SELECT COUNT(*)::int AS total
    FROM erp_audit_logs al
    WHERE al.action = 'COMPANY_CONTEXT_SWITCH'
      ${userId ? sql`AND al.user_id = ${userId}` : sql``}
      ${from   ? sql`AND al.created_at >= ${from}::timestamp` : sql``}
      ${to     ? sql`AND al.created_at <= ${to}::timestamp + interval '1 day'` : sql``}
  `);

  res.json({
    rows: rows.rows,
    total: (countRows.rows[0] as any)?.total ?? 0,
    limit,
    offset,
  });
});

export default router;
