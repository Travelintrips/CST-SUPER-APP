#!/usr/bin/env node
/**
 * dump-env-to-dotenv.mjs
 * Jalankan sekali untuk mengekspor semua env var yang diketahui ke file .env
 * Usage: node scripts/dump-env-to-dotenv.mjs
 */

import fs from "fs";
import path from "path";

// Semua key yang dikelola aplikasi ini
const KNOWN_KEYS = [
  // === DATABASE ===
  "SUPABASE_DATABASE_URL",
  "SUPABASE_DATABASE_URL_DEV",
  "SUPABASE_MIGRATION_URL",
  "DATABASE_URL",

  // === SUPABASE ===
  "SUPABASE_URL",
  "SUPABASE_URL_DEV",
  "SUPABASE_ANON_KEY",
  "SUPABASE_ANON_KEY_DEV",
  "SUPABASE_SERVICE_ROLE_KEY",
  "SUPABASE_SERVICE_ROLE_KEY_DEV",
  "SUPABASE_STORAGE_BUCKET",
  "SUPABASE_STORAGE_BUCKET_DEV",

  // === VITE (frontend) ===
  "VITE_SUPABASE_URL",
  "VITE_SUPABASE_URL_DEV",
  "VITE_SUPABASE_ANON_KEY",
  "VITE_SUPABASE_ANON_KEY_DEV",

  // === AUTH / SESSION ===
  "SESSION_SECRET",
  "PORTAL_JWT_SECRET",
  "DRIVER_JWT_SECRET",
  "CASHIER_TOKEN_SECRET",
  "PORTAL_ADMIN_KEY",

  // === GOOGLE ===
  "GOOGLE_SERVICE_ACCOUNT_JSON",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "GOOGLE_REDIRECT_BASE_URL",
  "GOOGLE_SHEET_ID_BANK_MUTATIONS",

  // === OPENAI / AI ===
  "OPENAI_API_KEY",
  "AI_INTEGRATIONS_OPENAI_API_KEY",
  "AI_INTEGRATIONS_OPENAI_BASE_URL",

  // === WHATSAPP ===
  "FONNTE_TOKEN",
  "FONNTE_ADMIN_WA",
  "WATI_API_TOKEN",
  "WATI_BASE_URL",

  // === PAYLABS ===
  "PAYLABS_MERCHANT_ID",
  "PAYLABS_MERCHANT_ID_SANDBOX",
  "PAYLABS_PRIVATE_KEY",
  "PAYLABS_PUBLIC_KEY",
  "PAYLABS_PUBLIC_KEY_SANDBOX",

  // === EMAIL / SMTP ===
  "SMTP_FROM",
  "SMTP_PASS",

  // === VAPID / PUSH NOTIF ===
  "VAPID_EMAIL",
  "VAPID_PRIVATE_KEY",
  "VAPID_PUBLIC_KEY",

  // === ADMIN ===
  "ADMIN_EMAIL",
  "ADMIN_EMAIL_DOMAINS",
  "ADMIN_EMAILS",
  "ADMIN_WA_PHONES",
  "PORTAL_ADMIN_EMAILS",

  // === STORAGE ===
  "DEFAULT_OBJECT_STORAGE_BUCKET_ID",
  "PRIVATE_OBJECT_DIR",
  "PUBLIC_OBJECT_SEARCH_PATHS",

  // === RUNTIME / SERVER ===
  "NODE_ENV",
  "PORT",
  "API_PORT",
  "BIZPORTAL_PORT",
  "CUSTOMER_PORT",
  "LOGISTIC_ORDER_PORT",
  "ALLOW_PRODUCTION_DB_IN_DEVELOPMENT",
  "ENABLE_REALTIME_TABLES",
];

const outPath = path.resolve(process.cwd(), ".env");

// Cek apakah .env sudah ada
let existing = {};
if (fs.existsSync(outPath)) {
  const lines = fs.readFileSync(outPath, "utf8").split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const idx = trimmed.indexOf("=");
    if (idx === -1) continue;
    const k = trimmed.slice(0, idx).trim();
    const v = trimmed.slice(idx + 1).trim();
    existing[k] = v;
  }
  console.log(`[dump] .env sudah ada — merge dengan nilai baru`);
}

let lines = [
  `# ==============================================================================`,
  `# .env — Environment variables untuk project ini`,
  `# Di-generate oleh scripts/dump-env-to-dotenv.mjs pada ${new Date().toISOString()}`,
  `# JANGAN commit file ini ke git!`,
  `# ==============================================================================`,
  ``,
];

let exported = 0;
let empty = 0;

const sections = [
  { label: "DATABASE", keys: ["SUPABASE_DATABASE_URL", "SUPABASE_DATABASE_URL_DEV", "SUPABASE_MIGRATION_URL", "DATABASE_URL"] },
  { label: "SUPABASE", keys: ["SUPABASE_URL", "SUPABASE_URL_DEV", "SUPABASE_ANON_KEY", "SUPABASE_ANON_KEY_DEV", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_SERVICE_ROLE_KEY_DEV", "SUPABASE_STORAGE_BUCKET", "SUPABASE_STORAGE_BUCKET_DEV"] },
  { label: "VITE (FRONTEND)", keys: ["VITE_SUPABASE_URL", "VITE_SUPABASE_URL_DEV", "VITE_SUPABASE_ANON_KEY", "VITE_SUPABASE_ANON_KEY_DEV"] },
  { label: "AUTH / SESSION", keys: ["SESSION_SECRET", "PORTAL_JWT_SECRET", "DRIVER_JWT_SECRET", "CASHIER_TOKEN_SECRET", "PORTAL_ADMIN_KEY"] },
  { label: "GOOGLE", keys: ["GOOGLE_SERVICE_ACCOUNT_JSON", "GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_BASE_URL", "GOOGLE_SHEET_ID_BANK_MUTATIONS"] },
  { label: "OPENAI / AI", keys: ["OPENAI_API_KEY", "AI_INTEGRATIONS_OPENAI_API_KEY", "AI_INTEGRATIONS_OPENAI_BASE_URL"] },
  { label: "WHATSAPP", keys: ["FONNTE_TOKEN", "FONNTE_ADMIN_WA", "WATI_API_TOKEN", "WATI_BASE_URL"] },
  { label: "PAYLABS", keys: ["PAYLABS_MERCHANT_ID", "PAYLABS_MERCHANT_ID_SANDBOX", "PAYLABS_PRIVATE_KEY", "PAYLABS_PUBLIC_KEY", "PAYLABS_PUBLIC_KEY_SANDBOX"] },
  { label: "EMAIL / SMTP", keys: ["SMTP_FROM", "SMTP_PASS"] },
  { label: "VAPID / PUSH NOTIF", keys: ["VAPID_EMAIL", "VAPID_PRIVATE_KEY", "VAPID_PUBLIC_KEY"] },
  { label: "ADMIN", keys: ["ADMIN_EMAIL", "ADMIN_EMAIL_DOMAINS", "ADMIN_EMAILS", "ADMIN_WA_PHONES", "PORTAL_ADMIN_EMAILS"] },
  { label: "STORAGE", keys: ["DEFAULT_OBJECT_STORAGE_BUCKET_ID", "PRIVATE_OBJECT_DIR", "PUBLIC_OBJECT_SEARCH_PATHS"] },
  { label: "RUNTIME / SERVER", keys: ["NODE_ENV", "PORT", "API_PORT", "BIZPORTAL_PORT", "CUSTOMER_PORT", "LOGISTIC_ORDER_PORT", "ALLOW_PRODUCTION_DB_IN_DEVELOPMENT", "ENABLE_REALTIME_TABLES"] },
];

for (const { label, keys } of sections) {
  lines.push(`# --- ${label} ---`);
  for (const key of keys) {
    const val = process.env[key] ?? existing[key] ?? "";
    // Escape nilai multi-baris (mis: GOOGLE_SERVICE_ACCOUNT_JSON)
    let safeVal = val;
    if (safeVal.includes("\n")) {
      safeVal = `"${safeVal.replace(/"/g, '\\"').replace(/\n/g, "\\n")}"`;
    } else if (safeVal.includes(" ") || safeVal.includes("#") || safeVal.includes("=")) {
      safeVal = `"${safeVal.replace(/"/g, '\\"')}"`;
    }
    lines.push(`${key}=${safeVal}`);
    if (val) exported++;
    else empty++;
  }
  lines.push("");
}

fs.writeFileSync(outPath, lines.join("\n"), "utf8");

console.log(`\n✅ .env berhasil ditulis ke: ${outPath}`);
console.log(`   ${exported} key terisi nilai`);
console.log(`   ${empty} key kosong (perlu diisi manual)`);
if (empty > 0) {
  console.log(`\n⚠️  Key yang masih kosong:`);
  for (const { keys } of sections) {
    for (const key of keys) {
      if (!process.env[key] && !existing[key]) {
        console.log(`   - ${key}`);
      }
    }
  }
}
