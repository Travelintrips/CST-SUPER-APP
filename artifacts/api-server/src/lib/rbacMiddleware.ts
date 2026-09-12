import type { Request, Response, NextFunction, RequestHandler } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { writeAuditLog } from "./auditLog.js";

const PREFIX = "[RBAC]";

// ── Permission cache ──────────────────────────────────────────────────────────
// key: "role:module:action" → boolean
// Setiap entry TTL 60 detik untuk kurangi query DB per request
const permCache = new Map<string, { v: boolean; exp: number }>();
const CACHE_TTL_MS = 60_000;

function cacheGet(key: string): boolean | undefined {
  const entry = permCache.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.exp) { permCache.delete(key); return undefined; }
  return entry.v;
}

function cacheSet(key: string, v: boolean): void {
  permCache.set(key, { v, exp: Date.now() + CACHE_TTL_MS });
  // Bersihkan entry lama jika cache terlalu besar (>2000 entries)
  if (permCache.size > 2000) {
    const now = Date.now();
    for (const [k, e] of permCache) {
      if (now > e.exp) permCache.delete(k);
    }
  }
}

// ── HTTP method → RBAC action ─────────────────────────────────────────────────
function methodToAction(method: string, path: string): string {
  const m = method.toUpperCase();
  // POST ke path yang mengandung kata "approve" / "reject" → approve
  if (m === "POST" && /\/approv|\/reject/i.test(path)) return "approve";
  switch (m) {
    case "GET":    return "view";
    case "POST":   return "create";
    case "PUT":
    case "PATCH":  return "edit";
    case "DELETE": return "delete";
    default:       return "view";
  }
}

// ── Core permission check ─────────────────────────────────────────────────────
async function checkRbacPermission(
  systemRole: string,
  module: string,
  action: string
): Promise<boolean> {
  // Super admin & admin selalu lolos (tidak perlu DB)
  if (systemRole === "super_admin" || systemRole === "admin") return true;

  const key = `${systemRole}:${module}:${action}`;
  const cached = cacheGet(key);
  if (cached !== undefined) return cached;

  // Tidak ada try-catch di sini: DB error harus propagate ke makeRbacGuard
  // sehingga request mendapatkan 503 (fail-closed), BUKAN diizinkan masuk.
  const res = await db.execute(sql`
    SELECT 1 FROM rbac_role_permissions
    WHERE role_name = ${systemRole}
      AND module = ${module}
      AND action = ${action}
    LIMIT 1
  `);
  const allowed = res.rows.length > 0;
  cacheSet(key, allowed);
  return allowed;
}

// ── Resolve effective system role ─────────────────────────────────────────────
// DB error dibiarkan propagate ke caller (makeRbacGuard) sehingga request
// mendapatkan 503, bukan lolos dengan role yang mungkin salah.
async function resolveSystemRole(userId: string, sessionRole: string | null): Promise<string> {
  const res = await db.execute(sql`
    SELECT system_role, role FROM users WHERE id = ${userId} LIMIT 1
  `);
  const row = res.rows[0] as { system_role?: string | null; role?: string | null } | undefined;
  if (row) {
    // Utamakan system_role baru; fallback ke role lama
    return (row.system_role ?? row.role ?? sessionRole ?? "customer").toLowerCase();
  }
  return (sessionRole ?? "customer").toLowerCase();
}

// ── Middleware factory ─────────────────────────────────────────────────────────
/**
 * makeRbacGuard(module)
 * Express middleware yang memvalidasi akses berdasarkan RBAC matrix.
 * Gunakan ini sebagai middleware sebelum router di index.ts:
 *
 *   router.use("/settings", makeRbacGuard("settings"), settingsRouter);
 *
 * Behavior:
 * - Unauthenticated / non-internal session → 401
 * - super_admin & admin → selalu lolos (tanpa DB query)
 * - Role lain → cek rbac_role_permissions (dengan cache 60s)
 * - DB tidak tersedia / lookup gagal / timeout → 503 FAIL-CLOSED
 *   (tidak pernah mengizinkan akses saat authorization service error)
 */
export function makeRbacGuard(module: string): RequestHandler {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    // Hanya enforce untuk internal session BizPortal
    if (!req.isAuthenticated || !req.isAuthenticated() || !(req as any).isInternalSession) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    const user = req.user as { id?: string; role?: string | null } | undefined;
    if (!user?.id) {
      res.status(401).json({ success: false, message: "Unauthorized" });
      return;
    }

    try {
      const sessionRole = user.role ?? null;
      const systemRole = await resolveSystemRole(user.id, sessionRole);
      const action = methodToAction(req.method, req.path);

      const allowed = await checkRbacPermission(systemRole, module, action);
      if (!allowed) {
        console.warn(
          `${PREFIX} DENIED role=${systemRole} module=${module} action=${action} path=${req.method} ${req.path}`
        );
        res.status(403).json({
          success: false,
          message: `Forbidden: role '${systemRole}' tidak memiliki akses '${action}' pada modul '${module}'`,
          module,
          action,
          role: systemRole,
        });
        return;
      }

      next();
    } catch (err) {
      // DB tidak tersedia, query timeout, atau error apapun saat RBAC lookup.
      // FAIL-CLOSED: tolak request dengan 503 — tidak pernah mengizinkan akses.
      const errMsg = err instanceof Error ? err.message : String(err);
      const userId  = user?.id ?? null;
      const role    = user?.role ?? null;
      const companyId = (user as any)?.companyId ?? null;

      // HIGH severity security event — wajib dicatat sebelum tolak request
      console.error(
        `${PREFIX} [HIGH] RBAC_LOOKUP_FAILED — fail-closed` +
        ` userId=${userId} role=${role} module=${module}` +
        ` method=${req.method} path=${req.path} error=${errMsg}`
      );

      writeAuditLog({
        userId,
        userEmail: (user as any)?.email ?? null,
        companyId,
        action: "RBAC_LOOKUP_FAILED",
        module,
        referenceId: `${req.method}:${req.originalUrl}`,
        newData: {
          userId,
          role,
          route: req.originalUrl,
          method: req.method,
          companyId,
          error: errMsg,
          timestamp: new Date().toISOString(),
          severity: "HIGH",
        },
      });

      res.status(503).json({
        success: false,
        message: "Authorization service unavailable",
      });
    }
  };
}

/**
 * Invalidasi seluruh permission cache.
 * Panggil setelah matrix diubah (POST /rbac/matrix/toggle atau reset).
 */
export function invalidateRbacCache(): void {
  permCache.clear();
  console.log(`${PREFIX} Permission cache cleared`);
}
