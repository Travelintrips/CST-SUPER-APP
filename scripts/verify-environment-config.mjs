#!/usr/bin/env node
/**
 * Verify configuration names after a clone/pull/merge.
 *
 * This script intentionally prints names and statuses only. It never prints
 * values, writes secrets, or attempts to recreate them. Values are managed
 * out-of-band by Replit Secrets and/or Google Cloud Secret Manager.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const contractPath = path.join(root, "config", "environment-contract.json");
const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));

const present = (name) => typeof process.env[name] === "string" && process.env[name].trim() !== "";
const bootstrapMissing = contract.bootstrap.filter((name) => !present(name));
const applicationMissing = contract.application.filter((name) => !present(name));
const hasCompleteBootstrap = bootstrapMissing.length === 0;

console.log("[environment] configuration name check (values hidden)");
console.log(`[environment] bootstrap: ${hasCompleteBootstrap ? "PRESENT" : "INCOMPLETE"}`);

if (bootstrapMissing.length) {
  console.log(`[environment] missing bootstrap names: ${bootstrapMissing.join(", ")}`);
  console.log("[environment] If using direct Replit configuration, application names must be present.");
} else {
  console.log("[environment] application secrets may be loaded by load-secrets.mjs from GCP.");
}

if (applicationMissing.length) {
  console.log(`[environment] application names not present in current process: ${applicationMissing.join(", ")}`);
} else {
  console.log("[environment] all application names are present in the current process.");
}

// A pull must never fail merely because GCP-loaded application secrets are not
// injected into this shell yet. The secure loader performs the authoritative
// startup validation before the API server starts.
process.exitCode = 0;