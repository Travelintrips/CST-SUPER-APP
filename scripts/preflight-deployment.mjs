#!/usr/bin/env node
/**
 * Preflight Deployment Validator
 *
 * READ-ONLY. This script never writes, migrates, deploys, sends messages,
 * modifies secrets, or touches any database. Safe to run multiple times.
 *
 * Checks:
 *   1. Environment variables
 *   2. Required secrets (presence + non-placeholder)
 *   3. Staging variables (TEST_DATABASE_URL / STAGING_DATABASE_URL)
 *   4. Storage configuration
 *   5. Build artifacts
 *   6. Secret rotation status
 *   7. Payment sandbox configuration
 *   8. SMTP configuration
 *   9. WhatsApp configuration
 *
 * Execution modes:
 *   MODE A — Dedicated staging available (TEST_DATABASE_URL set)
 *            → full validation including HTTP E2E staging
 *   MODE B — SAFE DEV runtime (TEST_DATABASE_URL not set)
 *            → SAFE DEV validation; staging shown as BLOCKED (not FAIL)
 *
 * Status model:
 *   PASS    — requirement met or check passed.
 *   BLOCKED — check cannot run because prerequisite environment not yet available.
 *             This is NOT a code or configuration failure.
 *   FAIL    — check ran and produced a failure; configuration is invalid or unsafe.
 *   WARNING — non-blocking advisory (does not affect exit code).
 *
 * INFO is only used as message notes, never as a gate status.
 *
 * Exit codes:
 *   0 — failCount === 0 && blockedCount === 0 (PASS / PASS WITH WARNINGS)
 *   1 — failCount > 0  (FAIL — configuration invalid or unsafe)
 *   2 — failCount === 0 && blockedCount > 0 (BLOCKED — prerequisites not yet available)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── Helpers ───────────────────────────────────────────────────────────────────

const PLACEHOLDERS = new Set([
  "changeme", "change_me", "example", "test123", "undefined", "null",
  "placeholder", "todo", "fixme", "secret", "_dummy_api_key_", "none", "empty",
]);

function envPresent(name, { minLength = 4 } = {}) {
  const val = process.env[name];
  if (!val || val.trim() === "") return "MISSING";
  if (PLACEHOLDERS.has(val.trim().toLowerCase())) return "PLACEHOLDER";
  if (val.trim().length < minLength) return "TOO_SHORT";
  return "PRESENT";
}

function fileExists(relPath) {
  return fs.existsSync(path.resolve(ROOT, relPath));
}

function dirExists(relPath) {
  try {
    return fs.statSync(path.resolve(ROOT, relPath)).isDirectory();
  } catch {
    return false;
  }
}

// ── Counters ──────────────────────────────────────────────────────────────────

const results = [];
let passCount    = 0;
let failCount    = 0;
let blockedCount = 0;
let warnCount    = 0;

function record(category, item, status, notes = "") {
  results.push({ category, item, status, notes });
  if (status === "PASS")    passCount++;
  if (status === "FAIL")    failCount++;
  if (status === "BLOCKED") blockedCount++;
  if (status === "WARNING") warnCount++;
}

// ── Execution Mode Detection ──────────────────────────────────────────────────

const testDbUrl     = envPresent("TEST_DATABASE_URL",    { minLength: 20 });
const stagingDbUrl  = envPresent("STAGING_DATABASE_URL", { minLength: 20 });
const hasDedicatedStaging = testDbUrl === "PRESENT" || stagingDbUrl === "PRESENT";

const EXEC_MODE = hasDedicatedStaging ? "MODE A — Dedicated Staging" : "MODE B — SAFE DEV";

// ── 1. Environment Variables ──────────────────────────────────────────────────

const nodeEnv = process.env.NODE_ENV ?? "(not set)";
record("Env", "NODE_ENV", nodeEnv ? "PASS" : "WARNING", `NODE_ENV=${nodeEnv}`);

const adminEmailDomains = process.env.ADMIN_EMAIL_DOMAINS;
const PUBLIC_EMAIL_DOMAINS = new Set([
  "gmail.com", "yahoo.com", "outlook.com", "icloud.com", "hotmail.com",
]);
const configuredAdminDomains = adminEmailDomains?.split(",").map((domain) => domain.trim().toLowerCase()).filter(Boolean) ?? [];
if (adminEmailDomains === undefined) {
  // Not present in this environment — BLOCKED (cannot verify)
  record("Env", "ADMIN_EMAIL_DOMAINS", "BLOCKED",
    "Production admin-domain configuration cannot be verified in this environment");
} else if (adminEmailDomains.trim() === "") {
  // Explicitly empty — domain-based auto-promotion is intentionally disabled
  record("Env", "ADMIN_EMAIL_DOMAINS", "PASS",
    "Domain-based admin auto-promotion is intentionally disabled. " +
    "Exact-email allowlist (ADMIN_EMAILS) will be used.");
} else if (configuredAdminDomains.includes("example.com")) {
  // Actively misconfigured — FAIL regardless of mode
  record("Env", "ADMIN_EMAIL_DOMAINS", "FAIL",
    "Placeholder domain is unsafe for production.");
} else if (configuredAdminDomains.some((domain) => PUBLIC_EMAIL_DOMAINS.has(domain))) {
  record("Env", "ADMIN_EMAIL_DOMAINS", "FAIL",
    "Public email domains must not be used for automatic admin promotion.");
} else {
  record("Env", "ADMIN_EMAIL_DOMAINS", "PASS", "Domain allowlist configured.");
}

const adminEmail = envPresent("ADMIN_EMAIL");
record("Env", "ADMIN_EMAIL", adminEmail === "PRESENT" ? "PASS" : "WARNING",
  adminEmail === "PRESENT" ? "" : `Status: ${adminEmail}`);

// ── 2. Required Secrets ───────────────────────────────────────────────────────
//
// Status rules per secret:
//   PRESENT   → PASS
//   MISSING   → BLOCKED — deployment-level secret not yet provisioned in this environment
//   PLACEHOLDER → FAIL  — value was set but is actively wrong (a placeholder literal)
//   TOO_SHORT → FAIL    — value was set but is too short to be valid
//
// Rationale: missing secrets are a "prerequisite not yet available" (BLOCKED), not a
// configuration error. Configuration errors require an actively invalid value.

const requiredSecrets = [
  { name: "SESSION_SECRET",               minLength: 32 },
  { name: "PORTAL_JWT_SECRET",            minLength: 32 },
  { name: "DRIVER_JWT_SECRET",            minLength: 32 },
  { name: "CASHIER_TOKEN_SECRET",         minLength: 32 },
  { name: "PORTAL_ADMIN_KEY",             minLength: 32 },
  { name: "FONNTE_TOKEN",                 minLength: 16 },
  { name: "WATI_API_TOKEN",               minLength: 32 },
  { name: "SMTP_PASS",                    minLength: 8  },
  { name: "PAYLABS_PRIVATE_KEY",          minLength: 100 },
  { name: "VAPID_PRIVATE_KEY",            minLength: 40 },
  { name: "VAPID_PUBLIC_KEY",             minLength: 40 },
  { name: "SUPABASE_DATABASE_URL_DEV",    minLength: 20 },
  { name: "SUPABASE_SERVICE_ROLE_KEY_DEV",minLength: 20 },
  { name: "SUPABASE_ANON_KEY_DEV",        minLength: 20 },
];

for (const { name, minLength } of requiredSecrets) {
  const status = envPresent(name, { minLength });
  if (status === "PRESENT") {
    record("Secrets", name, "PASS");
  } else if (status === "MISSING") {
    record("Secrets", name, "BLOCKED",
      "Not present in this environment — set via Replit Deploy → Secrets before go-live");
  } else {
    // PLACEHOLDER or TOO_SHORT → actively wrong value
    record("Secrets", name, "FAIL", `Status: ${status} — value is invalid`);
  }
}

// Production secrets — required before go-live, WARNING in dev
const prodSecrets = [
  { name: "SUPABASE_DATABASE_URL",         minLength: 20 },
  { name: "SUPABASE_SERVICE_ROLE_KEY",     minLength: 20 },
  { name: "SUPABASE_ANON_KEY",             minLength: 20 },
  { name: "SUPABASE_MIGRATION_URL",        minLength: 20 },
  { name: "GOOGLE_CLIENT_SECRET",          minLength: 8  },
  { name: "GITHUB_PERSONAL_ACCESS_TOKEN",  minLength: 20 },
];

for (const { name, minLength } of prodSecrets) {
  const status = envPresent(name, { minLength });
  if (status === "PRESENT") {
    record("Secrets (prod)", name, "PASS");
  } else {
    record("Secrets (prod)", name, "WARNING",
      `${status} — required in Replit Deploy → Secrets before production deployment`);
  }
}

// ── 3. Staging Variables ──────────────────────────────────────────────────────
//
// Two valid execution modes:
//   MODE A — Dedicated staging: TEST_DATABASE_URL configured → HTTP E2E staging available
//   MODE B — SAFE DEV runtime:  TEST_DATABASE_URL absent    → HTTP E2E staging BLOCKED
//
// Absence of TEST_DATABASE_URL is NOT a FAIL — it is BLOCKED (environment not yet provisioned).
// SAFE DEV is a recognised valid runtime mode.

if (hasDedicatedStaging) {
  // Execution Mode is informational metadata — not a gate, not counted in any counter.
  // Printed via console.log only; not passed to record().
  record("Staging", "Dedicated Target", "PASS",
    "TEST_DATABASE_URL available");
  record("Staging", "HTTP E2E staging", "PASS",
    "pnpm run audit:customer-http-e2e can run against dedicated staging target");
} else {
  // Execution Mode is informational metadata — not a gate, not counted in any counter.
  record("Staging", "Dedicated Target", "BLOCKED",
    "TEST_DATABASE_URL / STAGING_DATABASE_URL not configured — " +
    "provision a dedicated Supabase staging project; see docs/deployment/staging-environment.md");
  record("Staging", "HTTP E2E staging", "BLOCKED",
    "Dedicated staging target is not configured. " +
    "HTTP E2E staging cannot run until a dedicated target is provisioned. " +
    "See docs/deployment/staging-environment.md");
}

// ── 4. Storage Configuration ──────────────────────────────────────────────────

const storageBucketDev = envPresent("SUPABASE_STORAGE_BUCKET_DEV", { minLength: 10 });
record("Storage", "SUPABASE_STORAGE_BUCKET_DEV",
  storageBucketDev === "PRESENT" ? "PASS" : "WARNING",
  storageBucketDev === "PRESENT" ? "" : "Not configured — storage features may fail in dev");

const supabaseUrlDev = envPresent("SUPABASE_URL_DEV", { minLength: 10 });
record("Storage", "SUPABASE_URL_DEV",
  supabaseUrlDev === "PRESENT" ? "PASS" : "WARNING",
  supabaseUrlDev === "PRESENT" ? "" : "Not configured — storage/auth features may be degraded");

// ── 5. Build Artifacts ────────────────────────────────────────────────────────

const artifactPackages = [
  { name: "api-server",       distPath: "artifacts/api-server/dist" },
  { name: "bizportal",        distPath: "artifacts/bizportal/dist" },
  { name: "customer-portal",  distPath: "artifacts/customer-portal/dist" },
  { name: "logistic-order",   distPath: "artifacts/logistic-order/dist" },
];

for (const { name, distPath } of artifactPackages) {
  // In dev mode, dist may not exist (Vite serves from source).
  // Missing dist = WARNING here — build is required before production deploy.
  const exists = dirExists(distPath);
  record("Build", `${name}/dist`, exists ? "PASS" : "WARNING",
    exists ? "" : `dist/ not found — run: pnpm --filter @workspace/${name} run build`);
}

// Check node_modules symlinks for critical packages
const criticalPackages = [
  { pkg: "esbuild", dir: "artifacts/api-server/node_modules/esbuild" },
  { pkg: "vite",    dir: "artifacts/bizportal/node_modules/vite" },
];
for (const { pkg, dir } of criticalPackages) {
  record("Build", `node_modules/${pkg}`,
    dirExists(dir) ? "PASS" : "FAIL",
    dirExists(dir) ? "" : `Missing — run: pnpm install`);
}

// ── 6. Secret Rotation Status ─────────────────────────────────────────────────

const statusFilePath = path.resolve(ROOT, "docs/security/secret-rotation-status.json");
if (!fs.existsSync(statusFilePath)) {
  record("Secret Rotation", "secret-rotation-status.json", "BLOCKED",
    "File not found — rotation not yet documented; create docs/security/secret-rotation-status.json");
} else {
  try {
    const doc = JSON.parse(fs.readFileSync(statusFilePath, "utf8"));
    const creds = Array.isArray(doc.credentials) ? doc.credentials : [];
    const incomplete = creds.filter(c => !c.rotated || !c.oldCredentialRevoked || !c.verified);

    if (doc.verifiedByOwner && incomplete.length === 0) {
      record("Secret Rotation", "rotation-status", "PASS",
        `All ${creds.length} credentials rotated and verified`);
    } else {
      const reasons = [];
      if (!doc.verifiedByOwner) reasons.push("verifiedByOwner=false");
      if (incomplete.length > 0) reasons.push(`${incomplete.length}/${creds.length} credentials incomplete`);
      record("Secret Rotation", "rotation-status", "BLOCKED",
        reasons.join("; ") + " — see docs/security/secret-rotation-checklist.md");
    }
  } catch (e) {
    record("Secret Rotation", "secret-rotation-status.json", "FAIL",
      `Cannot parse: ${e.message}`);
  }
}

// ── 7. Payment Sandbox Configuration ─────────────────────────────────────────

const paylabsSandbox = envPresent("PAYLABS_PRIVATE_KEY_SANDBOX", { minLength: 100 });
record("Payment", "PAYLABS_PRIVATE_KEY_SANDBOX",
  paylabsSandbox === "PRESENT" ? "PASS" : "WARNING",
  paylabsSandbox === "PRESENT" ? "" : `Status: ${paylabsSandbox} — sandbox key needed for E2E testing`);

const paylabsMerchantId = envPresent("PAYLABS_MERCHANT_ID", { minLength: 4 });
record("Payment", "PAYLABS_MERCHANT_ID",
  paylabsMerchantId === "PRESENT" ? "PASS" : "WARNING",
  paylabsMerchantId === "PRESENT" ? "" : `Status: ${paylabsMerchantId}`);

const paylabsPublicKey = envPresent("PAYLABS_PUBLIC_KEY", { minLength: 100 });
record("Payment", "PAYLABS_PUBLIC_KEY",
  paylabsPublicKey === "PRESENT" ? "PASS" : "WARNING",
  "");

// ── 8. SMTP Configuration ─────────────────────────────────────────────────────

const smtpChecks = [
  { name: "SMTP_HOST",  minLength: 4 },
  { name: "SMTP_USER",  minLength: 4 },
  { name: "SMTP_FROM",  minLength: 4 },
  { name: "SMTP_PORT",  minLength: 1 },
];
for (const { name, minLength } of smtpChecks) {
  const status = envPresent(name, { minLength });
  record("SMTP", name,
    status === "PRESENT" ? "PASS" : "WARNING",
    status === "PRESENT" ? "" : `Status: ${status}`);
}

// ── 9. WhatsApp Configuration ─────────────────────────────────────────────────

const fontneAdminWa = envPresent("FONNTE_ADMIN_WA", { minLength: 8 });
record("WhatsApp", "FONNTE_ADMIN_WA",
  fontneAdminWa === "PRESENT" ? "PASS" : "WARNING",
  fontneAdminWa === "PRESENT" ? "" : `Status: ${fontneAdminWa}`);

const watiBaseUrl = envPresent("WATI_BASE_URL", { minLength: 10 });
record("WhatsApp", "WATI_BASE_URL",
  watiBaseUrl === "PRESENT" ? "PASS" : "WARNING",
  watiBaseUrl === "PRESENT" ? "" : `Status: ${watiBaseUrl}`);

const adminWaPhones = envPresent("ADMIN_WA_PHONES", { minLength: 8 });
record("WhatsApp", "ADMIN_WA_PHONES",
  adminWaPhones === "PRESENT" ? "PASS" : "WARNING",
  adminWaPhones === "PRESENT" ? "" : `Status: ${adminWaPhones}`);

// ── Report ────────────────────────────────────────────────────────────────────

const isDryRun = process.argv.includes("--dry-run");

console.log("");
console.log(`=== CST SUPER APP — ${isDryRun ? "DEPLOYMENT DRY RUN" : "PREFLIGHT DEPLOYMENT VALIDATOR"} ===`);
console.log(`  Mode       : READ-ONLY — no changes made`);
console.log(`ℹ️  Execution Mode: ${EXEC_MODE}`);
console.log(`  NODE_ENV   : ${nodeEnv}`);
console.log(`  Timestamp  : ${new Date().toISOString()}`);
console.log("");

const categories = [...new Set(results.map(r => r.category))];
for (const cat of categories) {
  console.log(`── ${cat} ${"─".repeat(Math.max(0, 46 - cat.length))}`);
  for (const r of results.filter(x => x.category === cat)) {
    const icon = r.status === "PASS"    ? "✅" :
                 r.status === "BLOCKED" ? "⛔" :
                 r.status === "FAIL"    ? "❌" :
                 r.status === "WARNING" ? "⚠️ " : "ℹ️ ";
    const pad = r.item.padEnd(42);
    const notes = r.notes ? `  (${r.notes})` : "";
    console.log(`  ${icon} ${pad} ${r.status}${notes}`);
  }
  console.log("");
}

// ── Summary ───────────────────────────────────────────────────────────────────

console.log("── SUMMARY ──────────────────────────────────────────");
console.log(`  ✅ PASS    : ${passCount}`);
console.log(`  ⛔ BLOCKED : ${blockedCount}`);
console.log(`  ❌ FAIL    : ${failCount}`);
console.log(`  ⚠️  WARNING : ${warnCount}`);
console.log("");

// ── Verdict & Exit ────────────────────────────────────────────────────────────

if (failCount > 0) {
  const failures = results.filter(r => r.status === "FAIL");
  console.log("PREFLIGHT: FAIL — configuration errors must be resolved before deployment:");
  for (const f of failures) {
    console.log(`  ❌ [${f.category}] ${f.item}: ${f.notes}`);
  }
  if (blockedCount > 0) {
    const blocked = results.filter(r => r.status === "BLOCKED");
    console.log("");
    console.log(`  Additionally, ${blockedCount} item(s) BLOCKED (prerequisites not yet available):`);
    for (const b of blocked) {
      console.log(`  ⛔ [${b.category}] ${b.item}: ${b.notes}`);
    }
  }
  console.log("");
  console.log("Resolve all FAIL items before proceeding. BLOCKED items will clear once prerequisites are provisioned.");
  console.log("");
  process.exit(1);
}

if (blockedCount > 0) {
  const blocked = results.filter(r => r.status === "BLOCKED");
  console.log("PREFLIGHT: BLOCKED — prerequisites not yet available:");
  for (const b of blocked) {
    console.log(`  ⛔ [${b.category}] ${b.item}: ${b.notes}`);
  }
  console.log("");
  console.log("No configuration errors detected. BLOCKED items clear once prerequisites are provisioned.");
  console.log("");
  process.exit(2);
}

if (warnCount > 0) {
  console.log("PREFLIGHT: PASS WITH WARNINGS — no deployment blockers, but review warnings above.");
} else {
  console.log("PREFLIGHT: PASS — all checks passed.");
}
console.log("");
process.exit(0);
