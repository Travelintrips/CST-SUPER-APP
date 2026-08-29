import type { Request, Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

/**
 * Marketplace authority is deliberately narrower than BizPortal administration.
 * A user's company is the data boundary; the permission is the lifecycle
 * capability. Neither one is inferred from the other.
 */
export const MARKETPLACE_OPERATOR_COMPANY_ID = 1;
export const MARKETPLACE_PERMISSION_MODULE = "customer_portal.marketplace";

type MarketplaceAction = "view" | "create" | "edit" | "delete";

function requestAction(req: Request): MarketplaceAction {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD") return "view";
  if (method === "PUT" || method === "PATCH") return "edit";
  if (method === "DELETE") return "delete";
  return "create";
}

function normalizePermissions(raw: unknown): Set<string> {
  if (Array.isArray(raw)) return new Set(raw.filter((p): p is string => typeof p === "string"));
  if (typeof raw !== "string") return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((p): p is string => typeof p === "string"))
      : new Set();
  } catch {
    return new Set();
  }
}

function hasMarketplacePermission(rawPermissions: unknown, action: MarketplaceAction): boolean {
  const permissions = normalizePermissions(rawPermissions);
  const module = MARKETPLACE_PERMISSION_MODULE;

  // `manage` is the explicit operator capability. CRUD entries are supported
  // because custom roles already expose module/action permissions in the UI.
  return (
    permissions.has(`${module}:manage`) ||
    permissions.has(`${module}.manage`) ||
    permissions.has(`${module}:${action}`) ||
    (action === "view" && permissions.has(module))
  );
}

/**
 * Authenticated internal user with explicit Customer Portal Marketplace
 * authority, scoped to the operator company (Company 1).
 *
 * Super Admin remains the platform-wide canonical bypass. Ordinary `admin`
 * and `owner` roles do not bypass this check.
 */
export async function requireMarketplaceOperator(req: Request, res: Response): Promise<boolean> {
  if (!req.isAuthenticated || !req.isAuthenticated() || !(req as any).isInternalSession) {
    res.status(401).json({ message: "Unauthorized" });
    return false;
  }

  const sessionUser = req.user as { id?: string; role?: string | null } | undefined;
  if (!sessionUser?.id) {
    res.status(401).json({ message: "Unauthorized" });
    return false;
  }

  // Preserve the existing platform-wide Super Admin policy even if the user
  // record is temporarily unavailable.
  if ((sessionUser.role ?? "").toLowerCase() === "super_admin") return true;

  try {
    const result = await db.execute(sql`
      SELECT
        u.company_id,
        u.role,
        u.system_role,
        cr.permissions
      FROM users u
      LEFT JOIN custom_roles cr ON cr.id = u.custom_role_id
      WHERE u.id = ${sessionUser.id}
      LIMIT 1
    `);
    const user = result.rows[0] as {
      company_id?: number | string | null;
      role?: string | null;
      system_role?: string | null;
      permissions?: unknown;
    } | undefined;

    const effectiveRole = (user?.system_role ?? user?.role ?? sessionUser.role ?? "").toLowerCase();
    if (effectiveRole === "super_admin") return true;

    // Customer-portal customers and vendor/driver accounts are never internal
    // Marketplace administrators, even if a stale custom-role row exists.
    if (["customer", "vendor", "driver", "ecommerce"].includes(effectiveRole)) {
      res.status(403).json({ message: "Forbidden: staff Marketplace Operator access required" });
      return false;
    }

    if (Number(user?.company_id) !== MARKETPLACE_OPERATOR_COMPANY_ID) {
      res.status(403).json({ message: "Forbidden: Marketplace Operator hanya untuk Company 1" });
      return false;
    }

    if (!hasMarketplacePermission(user?.permissions, requestAction(req))) {
      res.status(403).json({ message: "Forbidden: Marketplace permission diperlukan" });
      return false;
    }

    return true;
  } catch (error) {
    // Authorization lookup failures must never turn into an allow decision.
    console.error("[Marketplace RBAC] authorization lookup failed", {
      userId: sessionUser.id,
      error: error instanceof Error ? error.message : String(error),
    });
    res.status(503).json({ message: "Authorization service unavailable" });
    return false;
  }
}

export function hasMarketplaceOperatorPermission(
  rawPermissions: unknown,
  action: MarketplaceAction = "view",
): boolean {
  return hasMarketplacePermission(rawPermissions, action);
}