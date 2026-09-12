#!/usr/bin/env node
/**
 * build-vite.mjs — Smart vite build wrapper.
 *
 * - Jika GCP credentials tersedia (deployment production): jalankan melalui
 *   load-secrets.mjs sehingga VITE_SUPABASE_URL dan secrets lain ter-inject
 *   dari GCP Secret Manager sebelum vite build.
 * - Jika tidak ada GCP (dev/CI lokal): langsung jalankan vite build
 *   menggunakan env vars yang sudah ada di environment.
 *
 * Dipanggil dari package.json "build" script supaya artifact.toml
 * production build juga mendapat secrets yang benar.
 */

import { spawnSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const artifactRoot = path.resolve(__dirname, "..");
const apiServerDir = path.resolve(artifactRoot, "../api-server");

const hasGcp =
  process.env.GCP_PROJECT_ID &&
  process.env.GCP_SECRET_ID &&
  process.env.GCP_SECRET_MANAGER_BOOTSTRAP_JSON;

let result;

if (hasGcp) {
  console.log("[build-vite] GCP credentials detected — injecting production secrets via load-secrets.mjs");
  const loadSecretsPath = path.join(apiServerDir, "load-secrets.mjs");
  result = spawnSync(
    "node",
    [loadSecretsPath, "pnpm", "exec", "vite", "build", "--config", "vite.config.ts"],
    {
      stdio: "inherit",
      cwd: artifactRoot,
      env: { ...process.env, APP_ENV: "production" },
    }
  );
} else {
  console.log("[build-vite] No GCP credentials — running vite build with current env vars");
  result = spawnSync(
    "pnpm",
    ["exec", "vite", "build", "--config", "vite.config.ts"],
    {
      stdio: "inherit",
      cwd: artifactRoot,
      env: process.env,
    }
  );
}

process.exit(result.status ?? 1);
