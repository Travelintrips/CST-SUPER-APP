/**
 * Portal Customer Service
 *
 * Business logic for admin customer management.
 * Controller (portal.ts) calls these functions; no logic lives in the controller.
 */

import {
  db,
  portalCustomersTable,
  userProfilesTable,
} from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CustomerListOptions {
  role?: string;
  q?: string;
}

export interface CustomerListItem {
  id: number;
  name: string | null;
  email: string | null;
  phone: string | null;
  company: string | null;
  role: string | null;
  avatarUrl: string | null;
  source: "wa" | "oauth" | "email";
  createdAt: Date | null;
  profileStatus: string;
  profileAccountType: string | null;
  profileFullName: string | null;
  profileAddress: string | null;
}

export interface CustomerStats {
  total: number;
  wa: number;
  customer: number;
  vendor: number;
  profileIncomplete: number;
  profilePending: number;
  profileActive: number;
}

// ─── listCustomers ────────────────────────────────────────────────────────────

export async function listCustomers(opts: CustomerListOptions): Promise<{ items: CustomerListItem[]; total: number }> {
  const conds = [];
  if (opts.role) conds.push(eq(portalCustomersTable.role, opts.role));

  const rows = await db
    .select({
      id:                 portalCustomersTable.id,
      name:               portalCustomersTable.name,
      email:              portalCustomersTable.email,
      phone:              portalCustomersTable.phone,
      company:            portalCustomersTable.company,
      role:               portalCustomersTable.role,
      avatarUrl:          sql<string | null>`${portalCustomersTable}.avatar_url`,
      oauthProvider:      portalCustomersTable.oauthProvider,
      createdAt:          portalCustomersTable.createdAt,
      profileStatus:      userProfilesTable.status,
      profileAccountType: userProfilesTable.accountType,
      profileFullName:    userProfilesTable.fullName,
      profileAddress:     userProfilesTable.address,
    })
    .from(portalCustomersTable)
    .leftJoin(userProfilesTable, eq(userProfilesTable.customerId, portalCustomersTable.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(portalCustomersTable.createdAt));

  const search = opts.q ? opts.q.toLowerCase().trim() : "";
  const filtered = search
    ? rows.filter((r) =>
        (r.name   ?? "").toLowerCase().includes(search) ||
        (r.email  ?? "").toLowerCase().includes(search) ||
        (r.phone  ?? "").toLowerCase().includes(search) ||
        (r.company ?? "").toLowerCase().includes(search))
    : rows;

  const enriched: CustomerListItem[] = filtered.map((r) => {
    let source: "wa" | "oauth" | "email" = "email";
    if (r.email && r.email.endsWith("@wa.local")) source = "wa";
    else if (r.oauthProvider) source = "oauth";
    return {
      id:                 r.id,
      name:               r.name,
      email:              r.email,
      phone:              r.phone,
      company:            r.company,
      role:               r.role,
      avatarUrl:          r.avatarUrl ?? null,
      source,
      createdAt:          r.createdAt,
      profileStatus:      r.profileStatus ?? "not_started",
      profileAccountType: r.profileAccountType,
      profileFullName:    r.profileFullName,
      profileAddress:     r.profileAddress,
    };
  });

  return { items: enriched, total: enriched.length };
}

// ─── getCustomerStats ─────────────────────────────────────────────────────────

export async function getCustomerStats(): Promise<CustomerStats> {
  const rows = await db
    .select({
      id:            portalCustomersTable.id,
      role:          portalCustomersTable.role,
      email:         portalCustomersTable.email,
      profileStatus: userProfilesTable.status,
    })
    .from(portalCustomersTable)
    .leftJoin(userProfilesTable, eq(userProfilesTable.customerId, portalCustomersTable.id));

  return {
    total:              rows.length,
    wa:                 rows.filter((r) => r.email?.endsWith("@wa.local")).length,
    customer:           rows.filter((r) => r.role === "customer").length,
    vendor:             rows.filter((r) => r.role === "vendor").length,
    profileIncomplete:  rows.filter((r) => !r.profileStatus || r.profileStatus === "incomplete" || r.profileStatus === "not_started").length,
    profilePending:     rows.filter((r) => r.profileStatus === "pending").length,
    profileActive:      rows.filter((r) => r.profileStatus === "active").length,
  };
}
