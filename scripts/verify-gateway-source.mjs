#!/usr/bin/env node

/**
 * Fail-closed source integrity check for the root Gateway.
 *
 * A bad source sync once repeated the complete gateway module many times.
 * Node's parser catches duplicate declarations, but this check also verifies
 * the structural markers that identify one complete Gateway module.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(scriptDir, "..");
const gatewayPath = path.join(workspaceRoot, "gateway.mjs");

if (!fs.existsSync(gatewayPath)) {
  console.error(`[gateway-check] Missing Gateway source: ${gatewayPath}`);
  process.exit(1);
}

const source = fs.readFileSync(gatewayPath, "utf8");

const uniqueMarkers = [
  { label: 'import "node:http"', pattern: /^import http from "node:http";$/gm },
  { label: 'import "node:net"', pattern: /^import net\s+from "node:net";$/gm },
  { label: 'import "node:fs"', pattern: /^import fs\s+from "node:fs";$/gm },
  { label: "ROUTES declaration", pattern: /^const ROUTES = \[$/gm },
  { label: "startGateway declaration", pattern: /^async function startGateway\(\) \{$/gm },
  { label: "Gateway server creation", pattern: /^\s+const srv = http\.createServer\(handleRequest\);$/gm },
  { label: "Gateway listen call", pattern: /^\s+srv\.listen\(PORT, "0\.0\.0\.0", \(\) => \{$/gm },
];

const failures = [];
for (const marker of uniqueMarkers) {
  const count = [...source.matchAll(marker.pattern)].length;
  if (count !== 1) {
    failures.push(`${marker.label}: expected 1 occurrence, found ${count}`);
  }
}

try {
  execFileSync(process.execPath, ["--check", gatewayPath], {
    cwd: workspaceRoot,
    stdio: "pipe",
  });
} catch (error) {
  const details = error?.stderr?.toString().trim() || error?.message || "unknown syntax error";
  failures.push(`Node syntax check failed: ${details}`);
}

if (failures.length > 0) {
  console.error("[gateway-check] FAILED — Gateway startup blocked.");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

console.log("[gateway-check] OK — gateway.mjs has valid syntax and one complete module.");