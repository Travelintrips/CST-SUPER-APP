/**
 * AiReviewPermissionGuard
 *
 * Wraps AI-review UI sections that require specific finance roles.
 * Allowed roles mirror the backend FINANCE_ROLES list:
 *   admin | finance | accounting | treasury | tax | payroll
 *
 * IMPORTANT: The authoritative access control is always enforced server-side.
 * This guard is a UX-only layer — it hides buttons/sections for users whose
 * role cannot be determined, falling back to showing content by default
 * (the server will reject unauthorised requests regardless).
 *
 * Role extraction: the BizPortal AuthUser type does not currently expose role
 * information in the frontend session object.  When the backend surfaces role
 * data in the session, update `extractRole()` to read it.  Until then the
 * guard defaults to "show" so authorised users are never locked out of the UI.
 *
 * Company isolation: enforced by the backend on every API call.
 * This component does not pass companyId to the API.
 */

import React from "react";

// Roles that may access AI review features (must match backend FINANCE_ROLES)
export const AI_REVIEW_ROLES = [
  "admin",
  "finance",
  "accounting",
  "treasury",
  "tax",
  "payroll",
] as const;

export type AiReviewRole = (typeof AI_REVIEW_ROLES)[number];

// Roles that may trigger reevaluation (admin / Finance Manager level)
export const AI_REVIEW_ADMIN_ROLES: AiReviewRole[] = ["admin", "finance"];

interface AiReviewPermissionGuardProps {
  /**
   * Roles allowed to see the content.
   * Defaults to all AI_REVIEW_ROLES.
   * Currently unused until the session exposes role info.
   */
  roles?: AiReviewRole[];
  /** Rendered when the user lacks the required role. Defaults to null. */
  fallback?: React.ReactNode;
  children: React.ReactNode;
}

/**
 * Render children for authenticated users who hold a qualifying role.
 *
 * Since `AuthUser` does not currently include role metadata, the guard
 * defaults to always rendering children — the backend is the authoritative
 * access-control boundary and will return 403 for unauthorised actions.
 *
 * When role info becomes available on the session, replace the
 * `hasAccess = true` line with real role extraction.
 */
export function AiReviewPermissionGuard({
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  roles = [...AI_REVIEW_ROLES],
  fallback = null,
  children,
}: AiReviewPermissionGuardProps) {
  // TODO: replace with real role check once AuthUser exposes role metadata.
  // e.g. const userRole = user?.role; const hasAccess = roles.includes(userRole);
  const hasAccess = true;

  if (!hasAccess) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}

/**
 * Convenience guard for admin-only actions (reevaluate, rule packages).
 */
export function AdminOnlyGuard({
  fallback = null,
  children,
}: Omit<AiReviewPermissionGuardProps, "roles">) {
  return (
    <AiReviewPermissionGuard roles={AI_REVIEW_ADMIN_ROLES} fallback={fallback}>
      {children}
    </AiReviewPermissionGuard>
  );
}
