import type { Request, Response } from "express";
import { db, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

/**
 * Check if a user (by userId) has a given permission string, either via their
 * system role or via a custom_role with the permission in its JSONB array.
 * Falls back to req.user.role if DB is unavailable.
 */
export async function hasPermission(userId: string, permission: string, sessionRole?: string | null): Promise<boolean> {
  // Fast-path: session role says admin — try DB first, fall back if unavailable
  try {
    const trace = process.env.SAFE_DEV_TEST_MODE === "true";
    const startedAt = trace ? Date.now() : 0;
    if (trace) console.log(`[requireAdmin] permission lookup start user=${userId} permission=${permission}`);
    const rows = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    if (trace) console.log(`[requireAdmin] permission user lookup done ${Date.now() - startedAt}ms rows=${rows.length}`);
    const u = rows[0];
    if (!u) {
      // User not in DB — trust session role
      return permission === "admin"
        ? sessionRole === "admin"
        : sessionRole === "admin" || sessionRole === permission;
    }

    if (u.role === "admin") return true;

    if (u.customRoleId != null) {
      const result = await db.execute(sql`
        SELECT permissions FROM custom_roles WHERE id = ${u.customRoleId}
      `);
      if (trace) console.log(`[requireAdmin] custom role lookup done ${Date.now() - startedAt}ms`);
      const crRow = result.rows[0] as { permissions: unknown } | undefined;
      const perms = crRow?.permissions;
      if (Array.isArray(perms)) {
        if ((perms as string[]).includes(permission) || (perms as string[]).includes("admin")) {
          return true;
        }
      }
    }

    return false;
  } catch {
    if (process.env.SAFE_DEV_TEST_MODE === "true") {
      console.log(`[requireAdmin] permission lookup fell back to session role=${sessionRole ?? "null"}`);
    }
    // DB unavailable — fall back to session role
    if (permission === "admin") return sessionRole === "admin";
    return sessionRole === "admin" || sessionRole === permission;
  }
}

/**
 * Authenticated internal BizPortal user with one of the specified roles.
 * Also grants access if the user's custom_role has any of the roles (or "admin") in permissions.
 */
export async function requireRole(req: Request, res: Response, roles: string[]): Promise<boolean> {
  if (!req.isAuthenticated() || !req.isInternalSession) {
    res.status(401).json({ message: "Unauthorized" });
    return false;
  }

  const userId = (req.user as { id: string }).id;
  const sessionRole = (req.user as { role?: string | null }).role ?? null;

  try {
    const rows = await db.select().from(usersTable).where(eq(usersTable.id, userId)).limit(1);
    const u = rows[0];
    if (!u) {
      // Not in DB — trust session role
      if (roles.includes(sessionRole ?? "") || sessionRole === "admin") return true;
      res.status(403).json({ message: "Forbidden: insufficient role" });
      return false;
    }

    if (roles.includes(u.role ?? "")) return true;

    if (u.customRoleId != null) {
      const result = await db.execute(sql`
        SELECT permissions FROM custom_roles WHERE id = ${u.customRoleId}
      `);
      const crRow = result.rows[0] as { permissions: unknown } | undefined;
      const perms = crRow?.permissions;
      if (Array.isArray(perms)) {
        const hasMatch = roles.some(
          (r) => (perms as string[]).includes(r) || (perms as string[]).includes("admin"),
        );
        if (hasMatch) return true;
      }
    }
  } catch {
    // DB unavailable — trust session role
    if (roles.includes(sessionRole ?? "") || sessionRole === "admin") return true;
    res.status(403).json({ message: "Forbidden: insufficient role" });
    return false;
  }

  res.status(403).json({ message: "Forbidden: insufficient role" });
  return false;
}

/**
 * Any authenticated **internal** BizPortal staff user.
 * Rejects customer-portal and mobile bearer tokens (req.isInternalSession = false).
 */
export async function requireClerkUser(req: Request, res: Response): Promise<boolean> {
  if (!req.isAuthenticated() || !req.isInternalSession) {
    res.status(401).json({ message: "Unauthorized" });
    return false;
  }
  if ((req.user as { role?: string | null }).role === "ecommerce") {
    res.status(403).json({ message: "Forbidden: staff access only" });
    return false;
  }
  return true;
}

/**
 * Express middleware wrapper around requireClerkUser, for routes that need
 * auth to run as a normal middleware step (e.g. before per-user rate
 * limiters), rather than as an inline await-and-return-early check.
 */
export function requireClerkUserMiddleware(req: Request, res: Response, next: () => void): void {
  requireClerkUser(req, res).then((ok) => {
    if (ok) next();
  });
}

/**
 * Authenticated internal BizPortal user with role = "admin",
 * OR a user whose custom_role includes "admin" in its JSONB permissions array.
 * Falls back to session role if DB is unavailable.
 */
export async function requireAdmin(req: Request, res: Response): Promise<boolean> {
  if (!req.isAuthenticated() || !req.isInternalSession) {
    res.status(401).json({ message: "Unauthorized" });
    return false;
  }

  const userId = (req.user as { id: string }).id;
  const sessionRole = (req.user as { role?: string | null }).role ?? null;
  if (process.env.SAFE_DEV_TEST_MODE === "true") {
    console.log(`[requireAdmin] start user=${userId} role=${sessionRole ?? "null"}`);
  }
  const allowed = await hasPermission(userId, "admin", sessionRole);
  if (process.env.SAFE_DEV_TEST_MODE === "true") {
    console.log(`[requireAdmin] result allowed=${allowed}`);
  }
  if (!allowed) {
    res.status(403).json({ message: "Forbidden: admin only" });
    return false;
  }
  return true;
}
