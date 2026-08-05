import { db, portalContentTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map<string, { value: string; expiresAt: number }>();

export interface SecretDef {
  key: string;
  label: string;
  description: string;
  envFallback: string;
  envFallbackAlt?: string[];
  sensitive: boolean;
  group: string;
}

export const SECRETS_CATALOG: SecretDef[] = [
  {
    key: "fonnte_token",
    label: "Fonnte API Token",
    description: "Token API Fonnte untuk pengiriman WhatsApp",
    envFallback: "FONNTE_TOKEN",
    sensitive: true,
    group: "WhatsApp",
  },
  {
    key: "fonnte_admin_wa",
    label: "WA Admin Personal",
    description: "Nomor WhatsApp admin personal (format: 628xxx)",
    envFallback: "FONNTE_ADMIN_WA",
    sensitive: false,
    group: "WhatsApp",
  },
  {
    key: "fonnte_admin_group_wa",
    label: "WA Admin Group",
    description: "ID grup WhatsApp admin (format: 628xxx-timestamp@g.us)",
    envFallback: "FONNTE_ADMIN_GROUP_ID",
    sensitive: false,
    group: "WhatsApp",
  },
  {
    key: "admin_wa_phones",
    label: "Nomor Admin WA (CSV)",
    description: "Daftar nomor WA berwenang kirim perintah admin, dipisah koma",
    envFallback: "ADMIN_WA_PHONES",
    sensitive: false,
    group: "WhatsApp",
  },
  {
    key: "smtp_pass",
    label: "Password Email SMTP",
    description: "Password email Hostinger (atau API key Resend jika pakai Resend)",
    envFallback: "SMTP_PASS",
    sensitive: true,
    group: "Email",
  },
  {
    key: "smtp_from",
    label: "Email Pengirim (From / SMTP_USER)",
    description: "Alamat email pengirim notifikasi, misal: info@cstlogistic.co.id",
    envFallback: "SMTP_FROM",
    sensitive: false,
    group: "Email",
  },
  {
    key: "admin_email",
    label: "Email Admin",
    description: "Alamat email admin untuk notifikasi internal",
    envFallback: "ADMIN_EMAIL",
    sensitive: false,
    group: "Email",
  },
  {
    key: "portal_admin_key",
    label: "Portal Admin Key",
    description: "Key untuk klaim role admin di Customer Portal",
    envFallback: "PORTAL_ADMIN_KEY",
    sensitive: true,
    group: "Auth",
  },
  {
    key: "google_client_secret",
    label: "Google OAuth Client Secret",
    description: "Client secret untuk login via Google OAuth",
    envFallback: "GOOGLE_CLIENT_SECRET",
    sensitive: true,
    group: "Auth",
  },
  {
    key: "google_sheet_id_bank_mutations",
    label: "Google Sheet ID — Mutasi Bank",
    description: "ID spreadsheet Google Sheet sumber data mutasi bank untuk auto-sync rekonsiliasi (ambil dari URL sheet)",
    envFallback: "GOOGLE_SHEET_ID_BANK_MUTATIONS",
    sensitive: false,
    group: "Rekonsiliasi",
  },
  {
    key: "google_sheet_mutations_tab",
    label: "Nama Tab Sheet Mutasi",
    description: "Nama tab/worksheet di Google Sheet (default: Mutasi)",
    envFallback: "GOOGLE_SHEET_MUTATIONS_TAB",
    sensitive: false,
    group: "Rekonsiliasi",
  },
  {
    key: "openai_api_key",
    label: "OpenAI API Key",
    description: "API key OpenAI untuk fitur AI (OCR, scan dokumen, chat)",
    envFallback: "OPENAI_API_KEY",
    sensitive: true,
    group: "AI",
  },
  {
    key: "supabase_url",
    label: "Supabase URL (Prod)",
    description: "URL project Supabase produksi — dipakai storage & admin API (VITE_SUPABASE_URL atau SUPABASE_URL)",
    envFallback: "VITE_SUPABASE_URL",
    envFallbackAlt: ["SUPABASE_URL"],
    sensitive: false,
    group: "Supabase",
  },
  {
    key: "supabase_service_role_key",
    label: "Supabase Service Role Key (Prod)",
    description: "Service role key Supabase produksi — untuk storage, admin API. Nilai JWT dimulai 'eyJ'",
    envFallback: "SUPABASE_SERVICE_ROLE_KEY",
    sensitive: true,
    group: "Supabase",
  },
  {
    key: "supabase_anon_key",
    label: "Supabase Anon Key (Prod)",
    description: "Anon/public key Supabase produksi — dipakai frontend & Expo",
    envFallback: "SUPABASE_ANON_KEY",
    sensitive: true,
    group: "Supabase",
  },
  {
    key: "supabase_url_dev",
    label: "Supabase URL (Dev)",
    description: "URL project Supabase untuk environment development",
    envFallback: "SUPABASE_URL_DEV",
    sensitive: false,
    group: "Supabase",
  },
  {
    key: "supabase_service_role_key_dev",
    label: "Supabase Service Role Key (Dev)",
    description: "Service role key Supabase untuk environment development",
    envFallback: "SUPABASE_SERVICE_ROLE_KEY_DEV",
    sensitive: true,
    group: "Supabase",
  },
  {
    key: "supabase_anon_key_dev",
    label: "Supabase Anon Key (Dev)",
    description: "Anon key Supabase untuk environment development",
    envFallback: "SUPABASE_ANON_KEY_DEV",
    sensitive: true,
    group: "Supabase",
  },
  {
    key: "expo_public_supabase_url",
    label: "Expo Supabase URL",
    description: "URL Supabase untuk aplikasi driver (EXPO_PUBLIC_SUPABASE_URL)",
    envFallback: "EXPO_PUBLIC_SUPABASE_URL",
    sensitive: false,
    group: "Supabase",
  },
  {
    key: "expo_public_supabase_anon_key",
    label: "Expo Supabase Anon Key",
    description: "Anon key Supabase untuk aplikasi driver (EXPO_PUBLIC_SUPABASE_ANON_KEY)",
    envFallback: "EXPO_PUBLIC_SUPABASE_ANON_KEY",
    sensitive: true,
    group: "Supabase",
  },
  {
    key: "vapid_public_key",
    label: "VAPID Public Key",
    description: "Public key untuk Web Push Notifications",
    envFallback: "VAPID_PUBLIC_KEY",
    sensitive: false,
    group: "Notifikasi",
  },
  {
    key: "vapid_private_key",
    label: "VAPID Private Key",
    description: "Private key untuk Web Push Notifications",
    envFallback: "VAPID_PRIVATE_KEY",
    sensitive: true,
    group: "Notifikasi",
  },
];

export function maskSecret(value: string): string {
  if (!value) return "";
  if (value.length <= 8) return "••••••••";
  return "••••" + value.slice(-4);
}

export async function getSetting(key: string, envFallback = ""): Promise<string> {
  const cached = cache.get(key);
  if (cached && Date.now() < cached.expiresAt) return cached.value;
  try {
    const [row] = await db
      .select()
      .from(portalContentTable)
      .where(eq(portalContentTable.key, key));
    const value = row?.value?.trim() || envFallback;
    cache.set(key, { value, expiresAt: Date.now() + CACHE_TTL_MS });
    return value;
  } catch {
    return envFallback;
  }
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(portalContentTable)
    .values({ key, value: value.trim(), updatedAt: new Date() } as any)
    .onConflictDoUpdate({
      target: [portalContentTable.key, (portalContentTable as any).locale],
      set: { value: value.trim(), updatedAt: new Date() },
    });
  cache.delete(key);
}

export function invalidateSettingCache(key?: string): void {
  if (key) {
    cache.delete(key);
  } else {
    cache.clear();
  }
}

export async function getFonnteToken(): Promise<string> {
  return getSetting("fonnte_token", process.env.FONNTE_TOKEN ?? "");
}

export async function getSmtpPass(): Promise<string> {
  return getSetting("smtp_pass", process.env.SMTP_PASS ?? "");
}

export async function getSmtpFrom(): Promise<string> {
  return getSetting(
    "smtp_from",
    process.env.SMTP_FROM ?? "noreply@cstlogistic.co.id",
  );
}

export async function getAdminEmail(): Promise<string> {
  return getSetting("admin_email", process.env.ADMIN_EMAIL ?? "");
}

export async function getPortalAdminKey(): Promise<string> {
  return getSetting("portal_admin_key", process.env.PORTAL_ADMIN_KEY ?? "");
}

