#!/usr/bin/env node
/**
 * Production GO Validator
 *
 * READ-ONLY. Never writes, migrates, deploys, or modifies anything.
 * Reads gate status from summary.json and other status files.
 * Safe to run multiple times.
 *
 * Status model (per gate):
 *   PASS    — gate requirement is fully met.
 *   BLOCKED — gate cannot be run; prerequisite environment not yet available.
 *             This is NOT an execution failure — it means the gate is pending provisioning.
 *   FAIL    — gate ran and produced a failure; condition is unsafe or invalid.
 *
 * Production verdict:
 *   SAFE DEV PASS does NOT satisfy:
 *     - Dedicated Staging (Gate 5)
 *     - HTTP E2E (Gate 6)
 *     - Tenant Isolation (Gate 7)
 *     - Security (Gate 8)
 *     - Accounting (Gate 9)
 *     - SSE (Gate 10)
 *     - Cleanup (Gate 11)
 *
 *   Production is NO-GO if any gate is BLOCKED, FAIL, or NOT_RUN.
 *
 * Exit codes:
 *   0 — all gates PASS (GO)
 *   1 — one or more gates FAIL, BLOCKED, NOT_RUN, or UNKNOWN (NO-GO)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── Read summary.json ─────────────────────────────────────────────────────────

const summaryPath = path.resolve(ROOT, "summary.json");
let summary = {};
let summaryLoaded = false;

try {
  summary = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
  summaryLoaded = true;
} catch {
  // summary.json may not exist if gate has never been run
}

// ── Read secret-rotation-status.json ─────────────────────────────────────────

const rotationPath = path.resolve(ROOT, "docs/security/secret-rotation-status.json");
let rotation = null;
try {
  rotation = JSON.parse(fs.readFileSync(rotationPath, "utf8"));
} catch {
  // ignore — flagged below
}

// ── Helper ────────────────────────────────────────────────────────────────────

function envPresent(name, minLength = 4) {
  const v = process.env[name];
  return v && v.trim().length >= minLength;
}

function gateStatus(value) {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof value.status === "string") {
    return value.status;
  }
  return undefined;
}

function gateReason(value) {
  if (value && typeof value === "object" && typeof value.reason === "string") {
    return value.reason;
  }
  return undefined;
}

// ── Determine if dedicated staging is available ───────────────────────────────

const hasDedicatedStaging =
  envPresent("TEST_DATABASE_URL", 20) ||
  envPresent("STAGING_DATABASE_URL", 20) ||
  summary.stagingTarget?.status === "PASS";

// ── Gate Definitions ──────────────────────────────────────────────────────────

const gates = [];

// Gate 1 — Static (typecheck + tests + build)
{
  const s = summary.customerStatic ?? summary.static;
  const currentStatus = gateStatus(s);
  const status = !summaryLoaded ? "NOT_RUN"
    : currentStatus === "PASS" ? "PASS"
    : currentStatus === "FAIL" ? "FAIL"
    : "NOT_RUN";
  gates.push({
    gate: "1 — Static",
    description: "TypeScript + unit tests + build",
    status,
    evidence: currentStatus === "PASS"
      ? "pnpm run audit:customer-static → exit 0"
      : status === "NOT_RUN"
      ? "NOT_RUN — current static audit evidence not found. Run: pnpm run audit:customer-static"
      : "Run: pnpm run audit:customer-static",
  });
}

// Gate 2 — Runtime Safe Dev
{
  const s = summary.runtimeSafeDev ?? summary.runtime;
  const currentStatus = gateStatus(s);
  const status = !summaryLoaded ? "NOT_RUN"
    : currentStatus === "PASS" ? "PASS"
    : currentStatus === "FAIL" ? "FAIL"
    : "NOT_RUN";
  gates.push({
    gate: "2 — Runtime Safe Dev",
    description: "DB connected, workers running, health checks green",
    status,
    evidence: currentStatus === "PASS"
      ? "pnpm run audit:customer-runtime → exit 0"
      : status === "NOT_RUN"
      ? "NOT_RUN — current runtime-safe-dev evidence not found. Run: pnpm run audit:customer-runtime"
      : "Run: pnpm run audit:customer-runtime",
  });
}

// Gate 3 — Secret Availability
{
  const s = summary.secretAvailability;
  const currentStatus = gateStatus(s);
  const status = !summaryLoaded ? "NOT_RUN"
    : currentStatus === "PASS" ? "PASS"
    : currentStatus === "FAIL" ? "FAIL"
    : "NOT_RUN";
  gates.push({
    gate: "3 — Secret Availability",
    description: "All required secrets PRESENT and non-placeholder",
    status,
    evidence: currentStatus === "PASS"
      ? "pnpm run audit:secrets → MISSING: 0, INVALID: 0"
      : status === "NOT_RUN"
      ? "NOT_RUN — secret availability audit has not run in the current validation cycle. Run: pnpm run audit:secrets"
      : "Run: pnpm run audit:secrets",
  });
}

// Gate 4 — Secret Rotation
{
  let rotStatus = "BLOCKED";
  let rotEvidence = "docs/security/secret-rotation-status.json not found";

  if (rotation) {
    const creds = Array.isArray(rotation.credentials) ? rotation.credentials : [];
    const incomplete = creds.filter(c => !c.rotated || !c.oldCredentialRevoked || !c.verified);
    if (rotation.verifiedByOwner && incomplete.length === 0) {
      rotStatus = "PASS";
      rotEvidence = `All ${creds.length} credentials rotated; verifiedByOwner=true; verifiedAt=${rotation.verifiedAt}`;
    } else {
      rotStatus = "BLOCKED";
      const reasons = [];
      if (!rotation.verifiedByOwner) reasons.push("verifiedByOwner=false");
      if (incomplete.length > 0) reasons.push(`${incomplete.length}/${creds.length} credentials incomplete`);
      rotEvidence = reasons.join("; ") + " — see docs/security/secret-rotation-runbook.md";
    }
  }

  // summary.json can override if the gate has been formally run and PASS
  if (gateStatus(summary.secretRotation) === "PASS") {
    rotStatus = "PASS";
  }

  gates.push({
    gate: "4 — Secret Rotation",
    description: "All credentials rotated, revoked, verified by owner",
    status: rotStatus,
    evidence: rotEvidence,
  });
}

// Gate 5 — Dedicated Staging Target
{
  const status = hasDedicatedStaging ? "PASS" : "BLOCKED";
  gates.push({
    gate: "5 — Dedicated Staging",
    description: "TEST_DATABASE_URL or STAGING_DATABASE_URL configured",
    status,
    evidence: hasDedicatedStaging
      ? "Dedicated staging target present"
      : "Not configured — provision Supabase staging project; see docs/deployment/staging-environment.md",
  });
}

// Gates 6–11 depend on Gate 5 (Dedicated Staging).
// If dedicated staging is not available, these gates are BLOCKED — not FAIL,
// and not UNKNOWN/NOT_RUN. The absence of staging is not an execution failure.

function stagingDependentGate(summaryKey, gateLabel, description, passSummary, blockedReason) {
  if (!hasDedicatedStaging) {
    return {
      gate: gateLabel,
      description,
      status: "BLOCKED",
      evidence: "Requires Gate 5 (Dedicated Staging) — " + blockedReason,
    };
  }
  const s = summary[summaryKey];
  const currentStatus = gateStatus(s);
  const status = !summaryLoaded ? "NOT_RUN"
    : currentStatus === "PASS"    ? "PASS"
    : currentStatus === "BLOCKED" ? "BLOCKED"
    : currentStatus === "FAIL"    ? "FAIL"
    : "NOT_RUN";
  return {
    gate: gateLabel,
    description,
    status,
    evidence: currentStatus === "PASS"
      ? passSummary
      : gateReason(s) || blockedReason,
  };
}

// Gate 6 — HTTP E2E
gates.push(stagingDependentGate(
  "httpE2E",
  "6 — HTTP E2E",
  "16 business scenarios + 1 cleanup on dedicated staging",
  "pnpm run audit:customer-http-e2e → exit 0; all scenarios PASS",
  "Provision staging target then run: pnpm run audit:customer-http-e2e",
));

// Gate 7 — Tenant Isolation
gates.push(stagingDependentGate(
  "tenantIsolation",
  "7 — Tenant Isolation",
  "Cross-company data access verified blocked in E2E",
  "Verified inside HTTP E2E output",
  "Resolved when Gate 6 PASS",
));

// Gate 8 — Security
gates.push(stagingDependentGate(
  "security",
  "8 — Security",
  "Auth 401, RBAC, token expiry, rate-limit 429 verified in E2E",
  "Verified inside HTTP E2E output",
  "Resolved when Gate 6 PASS",
));

// Gate 9 — Accounting
gates.push(stagingDependentGate(
  "accounting",
  "9 — Accounting",
  "Journal immutability, period lock, balanced entries verified in E2E",
  "Verified inside HTTP E2E output",
  "Resolved when Gate 6 PASS",
));

// Gate 10 — SSE
gates.push(stagingDependentGate(
  "sse",
  "10 — SSE",
  "Server-Sent Events real-time delivery verified in E2E",
  "Verified inside HTTP E2E output",
  "Resolved when Gate 6 PASS",
));

// Gate 11 — Cleanup
gates.push(stagingDependentGate(
  "cleanup",
  "11 — Cleanup",
  "All synthetic E2E records deleted after run",
  "Verified inside HTTP E2E cleanup step",
  "Resolved when Gate 6 PASS",
));

// Gate 12 — Production Verdict (from formal production gate run)
{
  const s = summary.production;
  const currentStatus = gateStatus(s);
  const status = !summaryLoaded ? "NOT_RUN"
    : currentStatus === "GO"    ? "PASS"
    : currentStatus === "NO-GO" ? "FAIL"
    : "NOT_RUN";
  const reasons = Array.isArray(s?.reasons) && s.reasons.length > 0
    ? s.reasons.join("; ")
    : "";
  gates.push({
    gate: "12 — Production Gate",
    description: "pnpm run audit:customer-production → GO",
    status,
    evidence: currentStatus === "GO"
      ? "summary.json production: GO"
      : status === "NOT_RUN"
      ? "NOT_RUN — dependent gates are not complete. Run: pnpm run audit:customer-production"
      : reasons || gateReason(s) || "Run: pnpm run audit:customer-production",
  });
}

// Gate 13 — Canonical Sport Center settlement contract
{
  const s = summary.canonicalSettlement;
  const currentStatus = gateStatus(s);
  const status = !summaryLoaded ? "NOT_RUN"
    : currentStatus === "PASS"    ? "PASS"
    : currentStatus === "BLOCKED" ? "BLOCKED"
    : currentStatus === "FAIL"    ? "FAIL"
    : "NOT_RUN";
  gates.push({
    gate: "13 — Canonical Settlement",
    description: "Required settlement schema and frozen reconciliation contract",
    status,
    evidence: currentStatus === "PASS"
      ? "pnpm run db:preflight:canonical:prod → PASS"
      : currentStatus === "BLOCKED"
      ? "Canonical settlement preflight is blocked by missing schema or unresolved ownership contract"
      : status === "NOT_RUN"
      ? "NOT_RUN — run: pnpm run db:preflight:canonical:prod"
      : "Run: pnpm run db:preflight:canonical:prod",
  });
}

// ── Report ────────────────────────────────────────────────────────────────────

console.log("");
console.log("=== CST SUPER APP — PRODUCTION GO VALIDATOR ===");
console.log(`  Mode         : READ-ONLY`);
console.log(`  Timestamp    : ${new Date().toISOString()}`);
console.log(`  summary.json : ${summaryLoaded ? "loaded" : "not found (gates have not been run)"}`);
console.log(`  Staging      : ${hasDedicatedStaging ? "DEDICATED TARGET available" : "SAFE DEV only (no dedicated staging)"}`);
console.log("");

// Column widths
const COL_GATE    = 26;
const COL_STATUS  = 10;
const COL_EVIDENCE = 60;

const header =
  "  " +
  "Gate".padEnd(COL_GATE) +
  "Status".padEnd(COL_STATUS) +
  "Evidence / Next Action";

console.log("─".repeat(106));
console.log(header);
console.log("─".repeat(106));

let gatePassCount    = 0;
let gateBlockedCount = 0;
let gateFailCount    = 0;
let gateNotRunCount  = 0;

for (const g of gates) {
  const icon = g.status === "PASS"    ? "✅"
    : g.status === "BLOCKED"          ? "⛔"
    : g.status === "FAIL"             ? "❌"
    : "⬜";

  const statusLabel = g.status;

  const gatePad   = g.gate.padEnd(COL_GATE);
  const statusPad = statusLabel.padEnd(COL_STATUS);
  const evidence  = (g.evidence ?? "").length > COL_EVIDENCE
    ? g.evidence.slice(0, COL_EVIDENCE - 3) + "..."
    : (g.evidence ?? "");

  console.log(`  ${icon} ${gatePad}${statusPad}${evidence}`);

  if (g.status === "PASS")                       gatePassCount++;
  else if (g.status === "BLOCKED")               gateBlockedCount++;
  else if (g.status === "FAIL")                  gateFailCount++;
  else /* NOT_RUN / UNKNOWN / INCOMPLETE */      gateNotRunCount++;
}

console.log("─".repeat(106));
console.log("");

// ── Gate Summary ──────────────────────────────────────────────────────────────

console.log("── SUMMARY ──────────────────────────────────────────");
console.log(`  ✅ PASS    : ${gatePassCount}`);
console.log(`  ⛔ BLOCKED : ${gateBlockedCount}`);
console.log(`  ❌ FAIL    : ${gateFailCount}`);
console.log(`  ⬜ NOT RUN : ${gateNotRunCount}`);
console.log("");

// ── Verdict ───────────────────────────────────────────────────────────────────

const blockers = gates.filter(g =>
  g.status === "FAIL" || g.status === "BLOCKED"
);

const incomplete = gates.filter(g =>
  g.status !== "PASS" && g.status !== "FAIL" && g.status !== "BLOCKED"
);

if (blockers.length > 0 || incomplete.length > 0) {
  console.log(`Production: ❌ NO-GO`);
  console.log("");

  if (gateFailCount > 0) {
    console.log(`FAIL gates (${gateFailCount}):`);
    for (const g of gates.filter(x => x.status === "FAIL")) {
      console.log(`  ❌ Gate ${g.gate}: FAIL`);
      if (g.evidence) console.log(`     → ${g.evidence}`);
    }
    console.log("");
  }

  if (gateBlockedCount > 0) {
    console.log(`BLOCKED gates (${gateBlockedCount}) — prerequisites not yet provisioned:`);
    for (const g of gates.filter(x => x.status === "BLOCKED")) {
      console.log(`  ⛔ Gate ${g.gate}: BLOCKED`);
      if (g.evidence) console.log(`     → ${g.evidence}`);
    }
    console.log("");
  }

  if (incomplete.length > 0) {
    console.log(`NOT RUN gates (${incomplete.length}) — must be executed before go-live:`);
    for (const g of incomplete) {
      console.log(`  ⬜ Gate ${g.gate}: ${g.status}`);
      if (g.evidence) console.log(`     → ${g.evidence}`);
    }
    console.log("");
  }

  console.log("Next steps:");
  if (blockers.some(g => g.gate.includes("4")) || incomplete.some(g => g.gate.includes("4")))
    console.log("  1. Owner: rotate all credentials → docs/security/secret-rotation-runbook.md");
  if (blockers.some(g => g.gate.includes("5")))
    console.log("  2. DevOps: provision Supabase staging → docs/deployment/staging-environment.md");
  if (blockers.some(g => g.gate.includes("6")) || incomplete.some(g => g.gate.includes("6")))
    console.log("  3. QA: run pnpm run audit:customer-http-e2e on dedicated staging");
  if (incomplete.some(g => g.gate.includes("12")))
    console.log("  4. Run: pnpm run audit:customer-production");
  console.log("");
  process.exit(1);
}

console.log("Production: ✅ GO — all gates PASS. Deployment may proceed per docs/release/final-go-checklist.md");
console.log("");
process.exit(0);
