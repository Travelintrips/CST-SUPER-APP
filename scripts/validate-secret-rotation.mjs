#!/usr/bin/env node
/**
 * validate-secret-rotation.mjs
 *
 * Phase 2 — Post-Rotation Validation Script
 *
 * Aturan:
 *   - Hanya memeriksa ketersediaan dan format dasar
 *   - Tidak mencetak nilai secret
 *   - Tidak mengirim request eksternal
 *   - Tidak menyimpan hash secret
 *   - Output: nama variabel + status PRESENT / MISSING / INVALID
 */

const PLACEHOLDERS = new Set([
  "changeme",
  "example",
  "test123",
  "undefined",
  "null",
  "your-secret-here",
  "replace-me",
  "todo",
  "fixme",
  "xxxx",
  "placeholder",
  "_dummy_api_key_",
  "dummy",
]);

/**
 * Cek apakah nilai adalah placeholder yang jelas tidak valid.
 * TIDAK mencetak nilai — hanya membandingkan lowercase.
 */
function isPlaceholder(value) {
  if (!value) return false;
  const lower = value.toLowerCase().trim();
  // Exact match
  if (PLACEHOLDERS.has(lower)) return true;
  // Partial match untuk pola umum
  if (lower.startsWith("changeme") || lower.startsWith("example")) return true;
  return false;
}

function isPresent(name) {
  const val = process.env[name];
  return typeof val === "string" && val.trim().length > 0;
}

function checkSecret(name, { minLength = 8, envCategory = "any" } = {}) {
  const val = process.env[name];

  if (!val || val.trim().length === 0) {
    return { name, status: "MISSING", envCategory, detail: "variabel tidak ada atau kosong" };
  }

  if (isPlaceholder(val)) {
    return { name, status: "INVALID", envCategory, detail: "nilai adalah placeholder yang dikenal" };
  }

  if (val.trim().length < minLength) {
    return { name, status: "INVALID", envCategory, detail: `nilai terlalu pendek (min ${minLength} karakter)` };
  }

  return { name, status: "PRESENT", envCategory };
}

/**
 * Cek apakah dev URL (jika ada) tidak mengarah ke project ref prod.
 * Tidak mencetak URL — hanya nama variabel dan apakah terjadi mismatch.
 */
const PROD_PROJECT_REF = "nzdweipzckfszczzqtuw";
const DEV_PROJECT_REF  = "xssrfshdrtdfupgqwfdw";

function extractProjectRef(url) {
  if (!url) return null;
  const pooler = url.match(/postgres(?:ql)?:\/\/[^.]+\.([a-z0-9]+):/i);
  if (pooler) return pooler[1];
  const direct = url.match(/db\.([a-z0-9]+)\.supabase\.co/i);
  if (direct) return direct[1];
  return null;
}

function checkDbEnvSeparation() {
  const devUrl  = process.env.SUPABASE_DATABASE_URL_DEV;
  const prodUrl = process.env.SUPABASE_DATABASE_URL;
  const isDeployment = !!process.env.REPLIT_DEPLOYMENT;
  const results = [];

  if (prodUrl) {
    const ref = extractProjectRef(prodUrl);
    if (ref && ref !== PROD_PROJECT_REF) {
      results.push({
        name: "SUPABASE_DATABASE_URL",
        status: "INVALID",
        envCategory: "production",
        detail: `URL produksi mengarah ke project ref yang tidak dikenal (bukan prod ref)`,
      });
    }
  }

  if (devUrl && !isDeployment) {
    const ref = extractProjectRef(devUrl);
    if (ref === PROD_PROJECT_REF) {
      results.push({
        name: "SUPABASE_DATABASE_URL_DEV",
        status: "INVALID",
        envCategory: "development",
        detail: "URL dev mengarah ke project PROD — dev/prod environment tercampur",
      });
    }
  }

  return results;
}

// ─────────────────────────────────────────────
// Daftar secret yang diperiksa
// ─────────────────────────────────────────────

// Replit injects production secrets only when REPLIT_DEPLOYMENT=1.
// In dev shell, production-only secrets are intentionally absent.
// Mark them as PROD_ONLY so the script doesn't fail in dev.
const isProdRuntime = !!process.env.REPLIT_DEPLOYMENT;

function checkProdSecret(name, opts = {}) {
  if (!isProdRuntime) {
    const val = process.env[name];
    const present = val && val.trim().length > 0;
    return {
      name,
      status: present ? "PRESENT" : "SKIPPED",
      envCategory: "production",
      detail: present ? undefined : "not injected in dev shell (injected by Replit in production)",
    };
  }
  return checkSecret(name, { ...opts, envCategory: "production" });
}

const checks = [
  // Database — prod-only vars not available in dev shell
  checkProdSecret("SUPABASE_DATABASE_URL",      { minLength: 20 }),
  checkSecret("SUPABASE_DATABASE_URL_DEV",      { minLength: 20, envCategory: "development" }),
  checkProdSecret("SUPABASE_SERVICE_ROLE_KEY",  { minLength: 20 }),
  checkSecret("SUPABASE_SERVICE_ROLE_KEY_DEV",  { minLength: 20, envCategory: "development" }),
  checkProdSecret("SUPABASE_URL",               { minLength: 10 }),
  checkSecret("SUPABASE_URL_DEV",               { minLength: 10, envCategory: "development" }),
  checkProdSecret("SUPABASE_ANON_KEY",          { minLength: 20 }),
  checkSecret("SUPABASE_ANON_KEY_DEV",          { minLength: 20, envCategory: "development" }),

  // Auth / session
  checkSecret("SESSION_SECRET",             { minLength: 32, envCategory: "shared" }),
  checkSecret("CASHIER_TOKEN_SECRET",       { minLength: 32, envCategory: "shared" }),
  checkSecret("PORTAL_JWT_SECRET",          { minLength: 32, envCategory: "shared" }),
  checkSecret("DRIVER_JWT_SECRET",          { minLength: 32, envCategory: "shared" }),
  checkSecret("PORTAL_ADMIN_KEY",           { minLength: 16, envCategory: "shared" }),

  // External services
  checkSecret("FONNTE_TOKEN",               { minLength: 8,  envCategory: "shared" }),
  checkSecret("WATI_API_TOKEN",             { minLength: 20, envCategory: "shared" }),
  checkSecret("SMTP_PASS",                  { minLength: 8,  envCategory: "shared" }),
  checkSecret("OPENAI_API_KEY",             { minLength: 20, envCategory: "shared" }),

  // Push
  checkSecret("VAPID_PUBLIC_KEY",           { minLength: 20, envCategory: "shared" }),
  checkSecret("VAPID_PRIVATE_KEY",          { minLength: 20, envCategory: "shared" }),
  checkSecret("VAPID_EMAIL",                { minLength: 6,  envCategory: "shared" }),

  // Payment
  checkSecret("PAYLABS_PRIVATE_KEY",        { minLength: 50, envCategory: "shared" }),
  checkSecret("PAYLABS_PUBLIC_KEY",         { minLength: 50, envCategory: "shared" }),

  // Google OAuth
  checkSecret("GOOGLE_CLIENT_ID",           { minLength: 20, envCategory: "shared" }),
  checkSecret("GOOGLE_CLIENT_SECRET",       { minLength: 10, envCategory: "shared" }),
];

// OPTIONAL — tidak wajib untuk gate production, tapi dicek jika ada
const optional = [
  "GOOGLE_SERVICE_ACCOUNT_JSON",
  "PAYLABS_PRIVATE_KEY_SANDBOX",
  "GITHUB_PERSONAL_ACCESS_TOKEN",
  "SUPABASE_MIGRATION_URL",
];

// Tambahkan hasil validasi env separation
const separationIssues = checkDbEnvSeparation();
// Hapus hasil duplikat dari checks jika ada override dari separation
const allChecks = [
  ...checks.filter(c => !separationIssues.find(s => s.name === c.name)),
  ...separationIssues,
];

// ─────────────────────────────────────────────
// Output
// ─────────────────────────────────────────────

const WIDTH = 42;
const pad = (s, w) => s.padEnd(w, " ");

console.log("\n══════════════════════════════════════════════════════");
console.log("  SECRET ROTATION VALIDATION");
console.log(`  ${new Date().toISOString()}`);
console.log("══════════════════════════════════════════════════════\n");

let missing = 0;
let invalid = 0;
let present = 0;
let skipped = 0;

console.log(`${pad("SECRET NAME", WIDTH)} STATUS     ENV`);
console.log("─".repeat(70));

for (const r of allChecks) {
  const badge =
    r.status === "PRESENT"  ? "✅ PRESENT " :
    r.status === "MISSING"  ? "❌ MISSING " :
    r.status === "SKIPPED"  ? "⬜ SKIPPED " :
    "⚠️  INVALID ";
  const detail = r.detail ? `  ← ${r.detail}` : "";
  console.log(`${pad(r.name, WIDTH)} ${badge}  [${r.envCategory}]${detail}`);
  if (r.status === "MISSING") missing++;
  if (r.status === "INVALID") invalid++;
  if (r.status === "PRESENT") present++;
  if (r.status === "SKIPPED") skipped++;
}

console.log("\n── OPTIONAL ─────────────────────────────────────────");
for (const name of optional) {
  const val = process.env[name];
  const isOk = val && val.trim().length > 0 && !isPlaceholder(val);
  console.log(`${pad(name, WIDTH)} ${isOk ? "✅ PRESENT " : "⬜ NOT SET  "}  [optional]`);
}

console.log("\n──────────────────────────────────────────────────────");
const skipNote = !isProdRuntime ? `  |  SKIPPED (prod-only in dev): ${skipped}` : "";
console.log(`  PRESENT: ${present}  |  MISSING: ${missing}  |  INVALID: ${invalid}${skipNote}`);
console.log("──────────────────────────────────────────────────────\n");

if (missing > 0 || invalid > 0) {
  console.error(`AUDIT FAILED — ${missing} missing, ${invalid} invalid.`);
  console.error("Perbaiki secret di atas sebelum deploy ke production.\n");
  console.error("See docs/security/secret-rotation-checklist.md for rotation instructions.");
  process.exit(1);
} else {
  console.log("AUDIT PASSED — semua secret wajib tersedia dan valid.\n");
}

// ── Rotation verification section (informational — does not affect exit code) ─
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirSR = path.dirname(fileURLToPath(import.meta.url));
const statusFile = path.resolve(__dirSR, "../docs/security/secret-rotation-status.json");

console.log("");
console.log("ROTATION VERIFICATION");
try {
  const doc = JSON.parse(fs.readFileSync(statusFile, "utf8"));
  if (!doc.verifiedByOwner) {
    console.log("  ⏳ Owner verification : INCOMPLETE");
    console.log("  secretRotation        : INCOMPLETE");
    console.log("  → Set verifiedByOwner=true in docs/security/secret-rotation-status.json");
  } else {
    const creds = Array.isArray(doc.credentials) ? doc.credentials : [];
    const bad = creds.filter((c) => !c.rotated || !c.oldCredentialRevoked || !c.verified);
    if (bad.length === 0) {
      console.log("  ✅ All credentials VERIFIED");
      console.log("  secretRotation : PASS");
    } else {
      console.log(`  ⏳ ${bad.length} credential(s) INCOMPLETE:`);
      for (const c of bad) {
        const f = [];
        if (!c.rotated) f.push("not-rotated");
        if (!c.oldCredentialRevoked) f.push("old-not-revoked");
        if (!c.verified) f.push("not-verified");
        console.log(`     • ${c.name} (${f.join(", ")})`);
      }
      console.log("  secretRotation : INCOMPLETE");
    }
  }
} catch {
  console.log("  ⚠  docs/security/secret-rotation-status.json not found — rotation status unknown");
  console.log("  secretRotation : INCOMPLETE");
}

process.exit(0);
