/**
 * Portal Vendor Service
 *
 * Business logic for:
 *  - Delivery vendors (public + admin CRUD)
 *  - Vendor mini-form links (admin CRUD)
 *  - Vendor mini-form submissions (admin read)
 *
 * Controller (portal.ts) handles HTTP, auth, and side-effects
 * (cache invalidation via invalidateTokenCache).
 */

import {
  db,
  suppliersTable,
  vendorMiniFormLinksTable,
  vendorMiniFormSubmissionsTable,
} from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";

// ─── Delivery Vendors ─────────────────────────────────────────────────────────

// vendorCode digunakan sebagai unique business key untuk seed idempotent
const DEFAULT_VENDORS: Array<{
  vendorCode: string;
  name: string;
  logo: string;
  eta: string;
  fee: string;
  note: string | null;
  sortOrder: number;
}> = [
  { vendorCode: "SEED-JNE-REG",  name: "JNE REG",       logo: "📦", eta: "2-3 hari",  fee: "15000", note: null,         sortOrder: 1 },
  { vendorCode: "SEED-JNE-YES",  name: "JNE YES",        logo: "⚡", eta: "1 hari",    fee: "35000", note: null,         sortOrder: 2 },
  { vendorCode: "SEED-JNT",      name: "J&T Express",    logo: "📫", eta: "2-3 hari",  fee: "14000", note: null,         sortOrder: 3 },
  { vendorCode: "SEED-SICEPAT",  name: "SiCepat REG",    logo: "🚀", eta: "2-3 hari",  fee: "13000", note: null,         sortOrder: 4 },
  { vendorCode: "SEED-ANTERAJA", name: "AnterAja",        logo: "🏃", eta: "2-4 hari",  fee: "12000", note: null,         sortOrder: 5 },
  { vendorCode: "SEED-POS",      name: "Pos Indonesia",  logo: "📮", eta: "3-5 hari",  fee: "10000", note: null,         sortOrder: 6 },
  { vendorCode: "SEED-GOSEND",   name: "GoSend",          logo: "🛵", eta: "Same day",  fee: "25000", note: null,         sortOrder: 7 },
  { vendorCode: "SEED-GRAB",     name: "Grab Express",   logo: "🟢", eta: "Same day",  fee: "28000", note: null,         sortOrder: 8 },
  { vendorCode: "SEED-B2B",      name: "B2B Marketplace and Logistic", logo: "🚢", eta: "1-2 hari", fee: "0", note: "Harga nego", sortOrder: 9 },
];

/**
 * Seed vendor default secara idempotent berdasarkan vendorCode.
 * - Tidak mengaktifkan kembali vendor yang suspended/blacklisted.
 * - Tidak menimpa data yang sudah diedit manual (hanya INSERT jika belum ada).
 * - Aman dijalankan berkali-kali tanpa duplikasi.
 */
export async function ensureDefaultVendors(): Promise<void> {
  // Cek semua vendorCode sekaligus untuk menghindari N+1 query
  const existing = await db
    .select({ vendorCode: suppliersTable.vendorCode, status: suppliersTable.status })
    .from(suppliersTable)
    .where(
      sql`"vendor_code" IN (${sql.join(
        DEFAULT_VENDORS.map((v) => sql`${v.vendorCode}`),
        sql`, `
      )})`
    );

  const existingCodes = new Set(existing.map((r) => r.vendorCode).filter(Boolean));

  const toInsert = DEFAULT_VENDORS.filter((v) => !existingCodes.has(v.vendorCode));
  if (toInsert.length === 0) return;

  await db.insert(suppliersTable).values(
    toInsert.map((v) => ({
      ...v,
      isActive: true,
      status: "active",
    }))
  ).onConflictDoNothing();
}

export function toVendorResponse(v: typeof suppliersTable.$inferSelect) {
  return {
    id:          v.id,
    name:        v.name,
    logo:        v.logo,
    eta:         v.eta,
    fee:         Number(v.fee ?? 0),
    note:        v.note,
    isActive:    v.isActive,
    sortOrder:   v.sortOrder,
    phone:       v.phone ?? null,
    email:       v.contactEmail ?? null,
    serviceType: v.serviceType ?? null,
  };
}

/** adminMode=false → active+verified+published only; adminMode=true → all vendors */
export async function listVendors(adminMode: boolean) {
  await ensureDefaultVendors();
  const query = db.select().from(suppliersTable);
  const rows = adminMode
    ? await query.orderBy(suppliersTable.sortOrder, suppliersTable.id)
    : await query
        .where(
          sql`${suppliersTable.isActive} = true
            AND (${suppliersTable.status} IS NULL OR ${suppliersTable.status} = 'active')
            AND (${suppliersTable.marketplaceStatus} IS NULL OR ${suppliersTable.marketplaceStatus} = 'draft' OR ${suppliersTable.marketplaceStatus} = 'published')`
        )
        .orderBy(suppliersTable.sortOrder, suppliersTable.id);
  return rows.map(toVendorResponse);
}

export interface CreateVendorInput {
  name: string;
  logo?: string;
  eta?: string;
  fee?: number | string;
  note?: string;
  phone?: string;
  email?: string;
  serviceType?: string;
}

export async function createVendor(input: CreateVendorInput) {
  const { name, logo, eta, fee, note, phone, email, serviceType } = input;
  const [maxRow] = await db
    .select({ max: sql<number>`COALESCE(MAX(sort_order), 0)` })
    .from(suppliersTable);
  const nextSort = Number(maxRow?.max ?? 0) + 1;
  const [created] = await db.insert(suppliersTable).values({
    name:         name.trim(),
    logo:         logo ? String(logo).trim() : "📦",
    eta:          eta ? String(eta).trim() : "2-3 hari",
    fee:          fee !== undefined ? String(parseFloat(String(fee)) || 0) : "0",
    note:         note ? String(note).trim() : null,
    isActive:     true,
    sortOrder:    nextSort,
    phone:        phone ? String(phone).trim() : null,
    contactEmail: email ? String(email).trim() : null,
    serviceType:  serviceType ? String(serviceType).trim() : null,
  }).returning();
  return toVendorResponse(created);
}

export interface UpdateVendorInput {
  name?: string;
  logo?: string;
  eta?: string;
  fee?: number | string;
  note?: string | null;
  isActive?: boolean;
  sortOrder?: number | string;
  phone?: string | null;
  email?: string | null;
  serviceType?: string | null;
}

export async function updateVendor(id: number, input: UpdateVendorInput) {
  const { name, logo, eta, fee, note, isActive, sortOrder, phone, email, serviceType } = input;
  const updates: Record<string, unknown> = {};
  if (name        !== undefined) updates.name         = String(name).trim();
  if (logo        !== undefined) updates.logo         = String(logo).trim();
  if (eta         !== undefined) updates.eta          = String(eta).trim();
  if (fee         !== undefined) updates.fee          = String(parseFloat(String(fee)) || 0);
  if (note        !== undefined) updates.note         = note ? String(note).trim() : null;
  if (isActive    !== undefined) updates.isActive     = Boolean(isActive);
  if (sortOrder   !== undefined) updates.sortOrder    = parseInt(String(sortOrder)) || 0;
  if (phone       !== undefined) updates.phone        = phone ? String(phone).trim() : null;
  if (email       !== undefined) updates.contactEmail = email ? String(email).trim() : null;
  if (serviceType !== undefined) updates.serviceType  = serviceType ? String(serviceType).trim() : null;
  if (Object.keys(updates).length === 0) {
    throw Object.assign(new Error("Tidak ada field yang diubah"), { statusCode: 400 });
  }
  const [updated] = await db
    .update(suppliersTable)
    .set(updates)
    .where(eq(suppliersTable.id, id))
    .returning();
  if (!updated) throw Object.assign(new Error("Vendor tidak ditemukan"), { statusCode: 404 });
  return toVendorResponse(updated);
}

export interface DeleteVendorResult {
  logoUrl: string | null;
}

export async function deleteVendor(id: number): Promise<DeleteVendorResult> {
  const [deleted] = await db
    .delete(suppliersTable)
    .where(eq(suppliersTable.id, id))
    .returning();
  const logoUrl =
    deleted?.logo && (deleted.logo.startsWith("http") || deleted.logo.startsWith("/api/storage"))
      ? deleted.logo
      : null;
  return { logoUrl };
}

// ─── Vendor Mini-Form Links ───────────────────────────────────────────────────

export async function listVendorFormLinks(formTarget: string) {
  const links = await db
    .select()
    .from(vendorMiniFormLinksTable)
    .where(eq(vendorMiniFormLinksTable.formTarget, formTarget))
    .orderBy(desc(vendorMiniFormLinksTable.createdAt));

  const vendorIds = links.map((l) => l.supplierId).filter(Boolean) as number[];
  let vendorMap: Record<number, string> = {};
  if (vendorIds.length) {
    const vendors = await db
      .select({ id: suppliersTable.id, name: suppliersTable.name })
      .from(suppliersTable);
    vendorMap = Object.fromEntries(vendors.map((v) => [v.id, v.name]));
  }
  return links.map((l) => ({
    ...l,
    vendorName: l.supplierId ? (vendorMap[l.supplierId] ?? null) : null,
    expiresAt:  l.expiresAt?.toISOString() ?? null,
    createdAt:  l.createdAt.toISOString(),
  }));
}

export interface CreateVendorFormLinkInput {
  serviceType: string;
  title?: string;
  notes?: string;
  adminNotes?: string;
  expiresInDays?: number;
  mode?: "rate_collection" | "operational_update";
  vendorName?: string;
  maxSubmissions?: number;
  formTarget?: string;
}

export async function createVendorFormLink(input: CreateVendorFormLinkInput) {
  const { serviceType, title, notes, adminNotes, expiresInDays, mode, vendorName, maxSubmissions, formTarget } = input;
  const { randomBytes } = await import("crypto");
  const token     = randomBytes(24).toString("hex");
  const expiresAt = expiresInDays
    ? new Date(Date.now() + expiresInDays * 24 * 60 * 60 * 1000)
    : null;
  const [link] = await db
    .insert(vendorMiniFormLinksTable)
    .values({
      token,
      supplierId:     null,
      serviceType,
      title:          title ?? null,
      notes:          notes ?? null,
      adminNotes:     adminNotes ?? null,
      expiresAt:      expiresAt ?? undefined,
      mode:           mode ?? "rate_collection",
      vendorName:     vendorName ?? null,
      maxSubmissions: maxSubmissions ?? null,
      formTarget:     (formTarget ?? "vendor") as string,
    })
    .returning();
  return { ...link, expiresAt: link.expiresAt?.toISOString() ?? null, createdAt: link.createdAt.toISOString() };
}

export interface PatchVendorFormLinkInput {
  isActive?:  boolean;
  expiresAt?: string | null;
  title?:     string | null;
  notes?:     string | null;
}

/** Returns the updated record (token included so caller can invalidate cache). */
export async function patchVendorFormLink(id: number, input: PatchVendorFormLinkInput) {
  const { isActive, expiresAt, title, notes } = input;
  const patch: Record<string, unknown> = {};
  if (typeof isActive === "boolean") patch["isActive"] = isActive;
  if (expiresAt === null) {
    patch["expiresAt"] = null;
  } else if (typeof expiresAt === "string") {
    const d = new Date(expiresAt);
    if (isNaN(d.getTime())) {
      throw Object.assign(new Error("expiresAt tidak valid"), { statusCode: 400 });
    }
    patch["expiresAt"] = d;
  }
  if (title !== undefined) patch["title"] = title;
  if (notes !== undefined) patch["notes"] = notes;
  if (Object.keys(patch).length === 0) {
    throw Object.assign(new Error("Tidak ada field untuk diupdate"), { statusCode: 400 });
  }
  const [updated] = await db
    .update(vendorMiniFormLinksTable)
    .set(patch)
    .where(eq(vendorMiniFormLinksTable.id, id))
    .returning();
  if (!updated) throw Object.assign(new Error("Link tidak ditemukan"), { statusCode: 404 });
  return {
    ...updated,
    expiresAt: updated.expiresAt?.toISOString() ?? null,
    createdAt: updated.createdAt.toISOString(),
  };
}

/** Returns { token } so caller can call invalidateTokenCache(token). */
export async function deleteVendorFormLink(id: number): Promise<{ token: string }> {
  const [deleted] = await db
    .delete(vendorMiniFormLinksTable)
    .where(eq(vendorMiniFormLinksTable.id, id))
    .returning();
  if (!deleted) throw Object.assign(new Error("Link tidak ditemukan"), { statusCode: 404 });
  return { token: deleted.token };
}

// ─── Vendor Mini-Form Submissions ─────────────────────────────────────────────

export async function listVendorFormSubmissions() {
  const submissions = await db
    .select()
    .from(vendorMiniFormSubmissionsTable)
    .orderBy(desc(vendorMiniFormSubmissionsTable.submittedAt));
  return submissions.map((s) => ({
    ...s,
    submittedAt: s.submittedAt
      ? new Date(s.submittedAt as unknown as string).toISOString()
      : null,
  }));
}
