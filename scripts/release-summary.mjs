/**
 * Atomic release summary writer.
 *
 * Maintains summary.json with all gate results. Never exposes secret values.
 * Writes atomically via a temp file + rename to avoid partial reads.
 *
 * Schema (extended for full HTTP E2E):
 * {
 *   "static":          "PASS|FAIL|RUNNING|INCOMPLETE",
 *   "runtimeSafeDev":  "PASS|FAIL|RUNNING|INCOMPLETE",
 *   "httpE2E":         "PASS|FAIL|BLOCKED|RUNNING|INCOMPLETE",
 *   "secretRotation":  "PASS|INCOMPLETE",
 *   "tenantIsolation": "PASS|FAIL|BLOCKED",
 *   "security":        "PASS|FAIL|BLOCKED",
 *   "accounting":      "PASS|FAIL|BLOCKED",
 *   "cleanup":         "PASS|FAIL|BLOCKED",
 *   "production":      "GO|NO-GO|RUNNING",
 *   "reason":          []
 * }
 */

import fs from "node:fs";
import path from "node:path";

const summaryPath = path.resolve(process.cwd(), "summary.json");

const DEFAULTS = {
  static:             "NO-GO",
  runtimeSafeDev:     "INCOMPLETE",
  httpE2E:            "BLOCKED",
  secretAvailability: "INCOMPLETE",
  secretRotation:     "INCOMPLETE",
  tenantIsolation:    "BLOCKED",
  security:        "BLOCKED",
  accounting:      "BLOCKED",
  sse:             "BLOCKED",
  cleanup:         "BLOCKED",
  production:      "NO-GO",
  reason:          ["Release gate has not completed successfully"],
};

// Back-compat: map legacy "runtime" key to "runtimeSafeDev"
const LEGACY_KEY_MAP = { runtime: "runtimeSafeDev" };

function readSummary() {
  try {
    const raw = JSON.parse(fs.readFileSync(summaryPath, "utf8"));
    // Migrate legacy keys
    const migrated = { ...DEFAULTS };
    for (const [k, v] of Object.entries(raw)) {
      const mapped = LEGACY_KEY_MAP[k] ?? k;
      migrated[mapped] = v;
    }
    return migrated;
  } catch {
    return { ...DEFAULTS };
  }
}

export function writeReleaseSummary(patch) {
  const current = readSummary();
  const reasonPatch = Array.isArray(patch.reason) ? patch.reason : current.reason;
  const next = { ...current, ...patch, reason: reasonPatch };
  const tempPath = `${summaryPath}.tmp`;
  fs.writeFileSync(tempPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  fs.renameSync(tempPath, summaryPath);
}

// CLI usage:
//   node scripts/release-summary.mjs <key> <value> [reason...]
if (import.meta.url === `file://${process.argv[1]}`) {
  const [key, value, ...reasons] = process.argv.slice(2);
  const validKeys = Object.keys(DEFAULTS);
  if (!key || !value) {
    console.error(`Usage: node scripts/release-summary.mjs <${validKeys.join("|")}> <value> [reason...]`);
    process.exit(1);
  }
  const mappedKey = LEGACY_KEY_MAP[key] ?? key;
  if (!validKeys.includes(mappedKey)) {
    console.error(`Unknown key "${key}". Valid keys: ${validKeys.join(", ")}`);
    process.exit(1);
  }
  writeReleaseSummary({
    [mappedKey]: value,
    ...(reasons.length > 0 ? { reason: reasons } : {}),
  });
}
