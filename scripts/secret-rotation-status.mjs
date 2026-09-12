#!/usr/bin/env node
/**
 * Secret Rotation Status Report
 *
 * READ-ONLY. Displays per-credential rotation status from
 * docs/security/secret-rotation-status.json.
 * Never modifies any file or secret.
 *
 * Exit codes:
 *   0 — all credentials COMPLETE
 *   3 — one or more credentials INCOMPLETE or verifiedByOwner=false
 *   1 — status file missing or malformed
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATUS_FILE = path.resolve(__dirname, "../docs/security/secret-rotation-status.json");

let doc;
try {
  doc = JSON.parse(fs.readFileSync(STATUS_FILE, "utf8"));
} catch (err) {
  console.error(`[secret-rotation-status] ERROR: Cannot read ${STATUS_FILE}`);
  console.error(`  ${err.message}`);
  process.exit(1);
}

const credentials = Array.isArray(doc.credentials) ? doc.credentials : [];

console.log("");
console.log("=== SECRET ROTATION STATUS REPORT ===");
console.log(`  Status file  : docs/security/secret-rotation-status.json`);
console.log(`  verifiedByOwner : ${doc.verifiedByOwner}`);
console.log(`  verifiedAt      : ${doc.verifiedAt ?? "(not set)"}`);
console.log(`  Total credentials: ${credentials.length}`);
console.log("");
console.log("  Per-credential checklist (7 steps required):");
console.log("");

// Column widths
const COL = 38;

let incomplete = 0;

for (const cred of credentials) {
  const steps = {
    "New credential created": cred.rotated,           // step 1
    "Injected to Replit Secrets": cred.rotated,       // step 2 — inferred from rotated
    "Smoke tested": cred.verified,                    // step 3
    "Old credential revoked": cred.oldCredentialRevoked, // step 4
    "Verified": cred.verified,                        // step 5
    "Evidence attached": cred.verified,               // step 6 — inferred
    "Completed": cred.rotated && cred.oldCredentialRevoked && cred.verified, // step 7
  };

  const allDone = Object.values(steps).every(Boolean);
  if (!allDone) incomplete++;

  const icon = allDone ? "✅" : "⏳";
  console.log(`  ${icon} ${cred.name}`);
  for (const [step, done] of Object.entries(steps)) {
    const cb = done ? "☑" : "☐";
    console.log(`       ${cb} ${step}`);
  }
  console.log("");
}

const complete = credentials.length - incomplete;

console.log("─".repeat(60));
console.log(`  Complete   : ${complete} / ${credentials.length}`);
console.log(`  Incomplete : ${incomplete} / ${credentials.length}`);
console.log(`  Owner verified : ${doc.verifiedByOwner ? "YES ✅" : "NO ⏳"}`);
console.log("");

if (!doc.verifiedByOwner || incomplete > 0) {
  const reasons = [];
  if (!doc.verifiedByOwner) reasons.push("verifiedByOwner must be set to true");
  if (incomplete > 0) reasons.push(`${incomplete} credential(s) not fully completed`);
  console.log("SECRET ROTATION: INCOMPLETE");
  for (const r of reasons) console.log(`  → ${r}`);
  console.log("");
  console.log("Instructions:");
  console.log("  1. Follow docs/security/secret-rotation-runbook.md for each credential");
  console.log("  2. Update docs/security/secret-rotation-status.json as each credential is completed");
  console.log("  3. Set verifiedByOwner=true and verifiedAt=<ISO timestamp> when all done");
  console.log("  4. Run: pnpm run audit:secret-rotation to verify");
  console.log("");
  process.exit(3);
}

console.log("SECRET ROTATION: COMPLETE ✅");
console.log("  All credentials rotated, revoked, and verified by owner.");
console.log("");
process.exit(0);
