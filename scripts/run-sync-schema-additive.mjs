#!/usr/bin/env node
/**
 * Run the scoped schema report/apply with the official environment loader.
 *
 * The new Secret Manager architecture exposes one canonical database URL per
 * APP_ENV. This wrapper intentionally loads development and production in
 * separate child processes and transfers only a temporary schema snapshot,
 * never credentials.
 *
 * Usage:
 *   node scripts/run-sync-schema-additive.mjs
 *   node scripts/run-sync-schema-additive.mjs --apply
 *   node scripts/run-sync-schema-additive.mjs --apply-safe
 *   node scripts/run-sync-schema-additive.mjs --write-review /tmp/review.json
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const loader = path.join(root, "artifacts", "api-server", "load-secrets.mjs");
const worker = path.join(root, "scripts", "sync-schema-additive.mjs");
const inputArgs = process.argv.slice(2);
const applyMode = inputArgs.includes("--apply");
const safeApplyMode = inputArgs.includes("--apply-safe");
const reviewFlagIndex = inputArgs.indexOf("--write-review");
if (
  reviewFlagIndex >= 0 &&
  (!inputArgs[reviewFlagIndex + 1] ||
    inputArgs[reviewFlagIndex + 1].startsWith("--"))
) {
  throw new Error("--write-review requires an output path.");
}
const reviewArgs =
  reviewFlagIndex >= 0
    ? ["--write-review", inputArgs[reviewFlagIndex + 1]]
    : [];

function runLoaded(appEnv, workerArgs) {
  return new Promise((resolve, reject) => {
    const child = spawn(
      process.execPath,
      [loader, process.execPath, worker, ...workerArgs],
      {
        cwd: root,
        env: {
          ...process.env,
          APP_ENV: appEnv,
          SCHEMA_SYNC_REQUIRE_BUNDLE_ENV: "1",
        },
        stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`schema worker terminated by ${signal}`));
      } else if (code !== 0) {
        reject(new Error(`schema worker exited with code ${code}`));
      } else {
        resolve();
      }
    });
  });
}

const tempDir = await mkdtemp(path.join(tmpdir(), "cst-schema-sync-"));
const snapshot = path.join(tempDir, "development-schema.json");

try {
  console.log("=== scoped schema reconciliation launcher ===");
  console.log("Loading development bundle for read-only schema snapshot...");
  await runLoaded("development", ["--write-dev-snapshot", snapshot]);

  console.log(
    `Loading production bundle for ${applyMode ? "scoped apply" : "read-only report"}...`,
  );
  await runLoaded(
    "production",
    [
      "--from-dev-snapshot",
      snapshot,
      ...reviewArgs,
      ...(safeApplyMode
        ? ["--apply-safe"]
        : applyMode
          ? ["--apply"]
          : []),
    ],
  );
} catch (error) {
  console.error(`\n❌ scoped schema reconciliation blocked: ${error.message}`);
  process.exitCode = 1;
} finally {
  await rm(tempDir, { recursive: true, force: true });
}