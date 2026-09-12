#!/usr/bin/env node
/**
 * Reads docs/security/secret-rotation-status.json and determines whether
 * secret rotation has been manually verified by the account owner.
 *
 * Exit codes:
 *   0 — secretRotation = PASS
 *   3 — secretRotation = INCOMPLETE
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
  console.error(`[secret-rotation] ERROR: Cannot read ${STATUS_FILE}`);
  console.error(`  ${err.message}`);
  process.exit(1);
}

console.log("\n=== SECRET ROTATION VERIFICATION ===");
console.log(`  verifiedByOwner: ${doc.verifiedByOwner}`);
console.log(`  verifiedAt     : ${doc.verifiedAt ?? "(not set)"}`);
console.log("");

if (!doc.verifiedByOwner) {
  console.log("  ⏳ Owner verification: INCOMPLETE");
  console.log("");
  console.log("  To mark verified, set verifiedByOwner=true and verifiedAt in");
  console.log("  docs/security/secret-rotation-status.json after completing all rotations.");
  console.log("");
  console.log("ROTATION VERIFICATION: INCOMPLETE — owner verification not complete");
  process.exit(3);
}

const credentials = Array.isArray(doc.credentials) ? doc.credentials : [];
const incomplete = credentials.filter(
  (c) => !c.rotated || !c.oldCredentialRevoked || !c.verified,
);

const colW = 36;
for (const cred of credentials) {
  const isOk = cred.rotated && cred.oldCredentialRevoked && cred.verified;
  const missing = [];
  if (!cred.rotated) missing.push("not-rotated");
  if (!cred.oldCredentialRevoked) missing.push("old-not-revoked");
  if (!cred.verified) missing.push("not-verified");
  const pad = cred.name.padEnd(colW);
  if (isOk) {
    console.log(`  ✅ ${pad} VERIFIED`);
  } else {
    console.log(`  ⏳ ${pad} INCOMPLETE  (${missing.join(", ")})`);
  }
}

console.log("");
console.log(`  Verified   : ${credentials.length - incomplete.length}`);
console.log(`  Incomplete : ${incomplete.length}`);
console.log("");

if (incomplete.length > 0) {
  console.log("ROTATION VERIFICATION: INCOMPLETE — complete all credential rotations before GO");
  process.exit(3);
}

console.log("ROTATION VERIFICATION: PASS — all credentials rotated, revoked, and verified");
process.exit(0);
