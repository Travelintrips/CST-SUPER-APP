/**
 * watch.mjs — watches openapi.yaml and re-runs orval on change.
 *
 * Features:
 * - SHA-256 hash check: skips codegen if file content hasn't changed
 * - Debounce 300ms: collapses burst saves into one run
 * - Post-codegen diff: prints added/removed hooks so you know exactly what changed
 *
 * Usage: node lib/api-spec/watch.mjs
 */

import { watch, readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname  = path.dirname(fileURLToPath(import.meta.url));
const SPEC_FILE  = path.join(__dirname, "openapi.yaml");
const ORVAL_CFG  = path.join(__dirname, "orval.config.ts");
const GENERATED  = path.join(__dirname, "..", "api-client-react", "src", "generated", "api.ts");

// ── ANSI colours ──────────────────────────────────────────────────────────────
const GREEN  = "\x1b[32m";
const YELLOW = "\x1b[33m";
const RED    = "\x1b[31m";
const CYAN   = "\x1b[36m";
const DIM    = "\x1b[2m";
const BOLD   = "\x1b[1m";
const NC     = "\x1b[0m";

// ── Helpers ───────────────────────────────────────────────────────────────────

function ts() {
  return new Date().toLocaleTimeString("id-ID", { hour12: false });
}

function hashFile(p) {
  try { return createHash("sha256").update(readFileSync(p)).digest("hex"); }
  catch { return null; }
}

/**
 * Extract all exported hook names from the generated api.ts.
 * Matches lines like:  export function useGetSomething<
 * Returns a Set<string>.
 */
function snapshotHooks() {
  if (!existsSync(GENERATED)) return new Set();
  const src = readFileSync(GENERATED, "utf8");
  const hooks = new Set();
  for (const m of src.matchAll(/^export function (use\w+)</gm)) {
    hooks.add(m[1]);
  }
  return hooks;
}

/**
 * Print a compact diff between two Sets.
 * Returns true if there were any changes.
 */
function printDiff(before, after) {
  const added   = [...after].filter(h => !before.has(h)).sort();
  const removed = [...before].filter(h => !after.has(h)).sort();

  if (added.length === 0 && removed.length === 0) {
    console.log(`${DIM}  (no hook changes)${NC}`);
    return false;
  }

  if (added.length) {
    console.log(`${GREEN}${BOLD}  + ${added.length} hook(s) added:${NC}`);
    for (const h of added) console.log(`${GREEN}      ${h}${NC}`);
  }
  if (removed.length) {
    console.log(`${RED}${BOLD}  - ${removed.length} hook(s) removed:${NC}`);
    for (const h of removed) console.log(`${RED}      ${h}${NC}`);
  }
  return true;
}

// ── Codegen runner ────────────────────────────────────────────────────────────

let lastHash     = null;
let running      = false;
let queued       = false;
let debounceTimer = null;

function runCodegen(force = false) {
  const currentHash = hashFile(SPEC_FILE);

  if (!force && currentHash !== null && currentHash === lastHash) {
    console.log(`${DIM}[${ts()}] saved — content unchanged, skip${NC}`);
    return;
  }

  if (running) {
    queued = true;
    console.log(`${DIM}[${ts()}] queued (codegen already running)${NC}`);
    return;
  }

  const hashShort = currentHash ? currentHash.slice(0, 8) : "?";
  running = true;

  // Snapshot hooks BEFORE codegen
  const hooksBefore = snapshotHooks();

  console.log(`\n${CYAN}[${ts()}] content changed (${hashShort}…) — running orval...${NC}`);

  const proc = spawn("pnpm", ["exec", "orval", "--config", ORVAL_CFG], {
    cwd: __dirname,
    stdio: "inherit",
  });

  proc.on("close", (code) => {
    running = false;

    if (code === 0) {
      lastHash = currentHash;

      // Snapshot hooks AFTER codegen and diff
      const hooksAfter = snapshotHooks();
      const changed = printDiff(hooksBefore, hooksAfter);

      const summary = changed
        ? `${GREEN}[${ts()}] ✔ codegen complete — see diff above${NC}`
        : `${GREEN}[${ts()}] ✔ codegen complete — no API surface changes${NC}`;
      console.log(summary);
    } else {
      console.log(`${RED}[${ts()}] ✘ codegen failed (exit ${code}) — fix openapi.yaml and save again${NC}`);
      // Don't advance lastHash so the next save retries
    }

    if (queued) {
      queued = false;
      runCodegen(false);
    }
  });

  proc.on("error", (err) => {
    running = false;
    console.error(`${RED}[${ts()}] spawn error: ${err.message}${NC}`);
  });
}

function scheduleCodegen() {
  clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => runCodegen(false), 300);
}

// ── Startup ───────────────────────────────────────────────────────────────────

console.log(`${CYAN}${BOLD}API Spec Watcher${NC}`);
console.log(`${DIM}Watching : ${SPEC_FILE}${NC}`);
console.log(`${DIM}Strategy : SHA-256 hash check + post-codegen hook diff${NC}`);
console.log(`${DIM}Ctrl+C   : stop${NC}\n`);

runCodegen(true); // initial run — always executes

watch(SPEC_FILE, { persistent: true }, (ev) => {
  if (ev === "change") scheduleCodegen();
});

watch(__dirname, { persistent: true }, (ev, filename) => {
  if (filename === "openapi.yaml") scheduleCodegen();
});

console.log(`${YELLOW}[${ts()}] watcher started${NC}`);
