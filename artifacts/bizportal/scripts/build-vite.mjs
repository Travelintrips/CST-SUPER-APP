#!/usr/bin/env node
/**
 * build-vite.mjs — Smart vite build wrapper untuk BizPortal.
 *
 * - Jika GCP credentials tersedia (deployment production): jalankan melalui
 *   load-secrets.mjs sehingga VITE_SUPABASE_URL dan secrets lain ter-inject
 *   dari GCP Secret Manager sebelum vite build.
 * - Jika tidak ada GCP (dev/CI lokal): langsung jalankan vite build
 *   menggunakan env vars yang sudah ada di environment.
 */

import { spawnSync } from "child_process";
import fs from "fs";
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

function listJavaScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return listJavaScriptFiles(entryPath);
    return entry.isFile() && entry.name.endsWith(".js") ? [entryPath] : [];
  });
}

function verifyManualReviewActionInBundle() {
  const outputDirectory = path.join(artifactRoot, "dist", "public");
  if (!fs.existsSync(outputDirectory)) {
    throw new Error(`Vite output tidak ditemukan: ${outputDirectory}`);
  }

  const javaScriptFiles = listJavaScriptFiles(outputDirectory);
  if (javaScriptFiles.length === 0) {
    throw new Error("Build BizPortal tidak menghasilkan aset JavaScript.");
  }

  const bundle = javaScriptFiles
    .map((filePath) => fs.readFileSync(filePath, "utf8"))
    .join("\n");
  const requiredMarkers = ["Review Manual", "Pilih COA", "Buat Draft"];
  const missingMarkers = requiredMarkers.filter((marker) => !bundle.includes(marker));

  if (missingMarkers.length > 0) {
    throw new Error(
      `Aksi review manual tidak ada pada bundle production: ${missingMarkers.join(", ")}`,
    );
  }

  const actionFiles = javaScriptFiles
    .filter((filePath) => {
      const content = fs.readFileSync(filePath, "utf8");
      return requiredMarkers.every((marker) => content.includes(marker));
    })
    .map((filePath) => path.relative(artifactRoot, filePath));

  if (actionFiles.length === 0) {
    throw new Error("Tidak ada aset JavaScript yang memuat aksi review manual secara utuh.");
  }

  console.log(
    `[build-vite] Verified manual-review action in ${actionFiles.length} production JavaScript asset(s): ${actionFiles.join(", ")}`,
  );
}

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

const exitCode = result.status ?? 1;
if (exitCode === 0) {
  try {
    verifyManualReviewActionInBundle();
  } catch (error) {
    console.error(
      `[build-vite] Production bundle verification failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    process.exit(1);
  }
}

process.exit(exitCode);
