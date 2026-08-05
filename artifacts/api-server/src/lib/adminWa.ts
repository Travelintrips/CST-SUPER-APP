import { db, portalContentTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const ADMIN_WA_KEY = "fonnte_admin_wa";
const ADMIN_GROUP_WA_KEY = "fonnte_admin_group_wa";
const ADMIN_PHONES_KEY = "fonnte_admin_phones";

const CACHE_TTL_MS = 5 * 60 * 1000;
let adminWaCache: { value: string; expiresAt: number } | null = null;
let adminGroupWaCache: { value: string; expiresAt: number } | null = null;
let adminPhonesCache: { value: string[]; expiresAt: number } | null = null;

export function invalidateAdminWaCache() {
  adminWaCache = null;
  adminGroupWaCache = null;
  adminPhonesCache = null;
}

export async function getAdminWa(): Promise<string> {
  if (adminWaCache && Date.now() < adminWaCache.expiresAt) {
    return adminWaCache.value;
  }
  try {
    const [row] = await db
      .select()
      .from(portalContentTable)
      .where(eq(portalContentTable.key, ADMIN_WA_KEY));
    const value = row?.value?.trim() || process.env.FONNTE_ADMIN_WA || "";
    adminWaCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  } catch {
    return process.env.FONNTE_ADMIN_WA ?? "";
  }
}

export async function setAdminWa(value: string): Promise<void> {
  await db
    .insert(portalContentTable)
    .values({ key: ADMIN_WA_KEY, value: value.trim(), updatedAt: new Date() } as any)
    .onConflictDoUpdate({
      target: [portalContentTable.key, (portalContentTable as any).locale],
      set: { value: value.trim(), updatedAt: new Date() },
    });
  adminWaCache = null;
}

export async function getAdminGroupWa(): Promise<string> {
  if (adminGroupWaCache && Date.now() < adminGroupWaCache.expiresAt) {
    return adminGroupWaCache.value;
  }
  try {
    const [row] = await db
      .select()
      .from(portalContentTable)
      .where(eq(portalContentTable.key, ADMIN_GROUP_WA_KEY));
    const value = row?.value?.trim() || process.env.FONNTE_ADMIN_GROUP_ID || "";
    adminGroupWaCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  } catch {
    return process.env.FONNTE_ADMIN_GROUP_ID ?? "";
  }
}

export async function setAdminGroupWa(value: string): Promise<void> {
  await db
    .insert(portalContentTable)
    .values({ key: ADMIN_GROUP_WA_KEY, value: value.trim(), updatedAt: new Date() } as any)
    .onConflictDoUpdate({
      target: [portalContentTable.key, (portalContentTable as any).locale],
      set: { value: value.trim(), updatedAt: new Date() },
    });
  adminGroupWaCache = null;
}

/**
 * Daftar nomor WhatsApp yang diizinkan mengirim perintah admin via webhook.
 * Dibaca dari DB (key: fonnte_admin_phones), fallback ke env ADMIN_WA_PHONES.
 * Format DB: string nomor dipisah koma, sudah dinormalisasi (628xxx).
 */
export async function getAdminPhones(): Promise<string[]> {
  if (adminPhonesCache && Date.now() < adminPhonesCache.expiresAt) {
    return adminPhonesCache.value;
  }
  try {
    const [row] = await db
      .select()
      .from(portalContentTable)
      .where(eq(portalContentTable.key, ADMIN_PHONES_KEY));
    const raw = row?.value?.trim() || process.env.ADMIN_WA_PHONES || "";
    const value = raw.split(",").map((s: string) => s.trim()).filter(Boolean);
    adminPhonesCache = { value, expiresAt: Date.now() + CACHE_TTL_MS };
    return value;
  } catch {
    const raw = process.env.ADMIN_WA_PHONES ?? "";
    return raw.split(",").map((s) => s.trim()).filter(Boolean);
  }
}

export async function setAdminPhones(phones: string[]): Promise<void> {
  const value = phones.map((p) => p.trim()).filter(Boolean).join(",");
  await db
    .insert(portalContentTable)
    .values({ key: ADMIN_PHONES_KEY, value, updatedAt: new Date() } as any)
    .onConflictDoUpdate({
      target: [portalContentTable.key, (portalContentTable as any).locale],
      set: { value, updatedAt: new Date() },
    });
  adminPhonesCache = null;
}
