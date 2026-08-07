/**
 * migrate-images-to-storage.mjs
 *
 * Uploads all local public image files to Supabase Storage (public-assets bucket).
 * Run via:
 *   cd artifacts/api-server && APP_ENV=development node load-secrets.mjs node ../../scripts/migrate-images-to-storage.mjs
 *
 * Env vars needed (injected by load-secrets.mjs in dev):
 *   SUPABASE_URL (or SUPABASE_URL_DEV promoted by load-secrets)
 *   SUPABASE_SERVICE_ROLE_KEY (or _DEV promoted)
 */

import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync, statSync, existsSync, writeFileSync } from "node:fs";
import { join, relative, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const WORKSPACE_ROOT = join(__dirname, "..");

// ── Supabase client ────────────────────────────────────────────────────────────
function normalizeUrl(raw) {
  if (!raw) return "";
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  return `https://${raw}.supabase.co`;
}

const rawKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const devKey = process.env.SUPABASE_SERVICE_ROLE_KEY_DEV ?? "";
const devUrl = process.env.SUPABASE_URL_DEV ?? "";
const rawUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "";

const SUPABASE_KEY = rawKey.length > 100 ? rawKey : devKey;
const SUPABASE_URL = normalizeUrl(rawKey.length > 100 ? rawUrl : devUrl.replace(/\/rest\/v1\/?$/, ""));

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("[migrate] ERROR: Supabase credentials not found in environment.");
  console.error("  SUPABASE_URL:", SUPABASE_URL ? "set" : "missing");
  console.error("  SUPABASE_SERVICE_ROLE_KEY:", SUPABASE_KEY ? "set" : "missing");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const BUCKET = "public-assets";
const PROXY_PREFIX = "/api/storage/public-objects";

// ── MIME type mapping ─────────────────────────────────────────────────────────
const MIME = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".heic": "image/heic",
  ".bmp": "image/bmp",
};

function mimeFor(filename) {
  return MIME[extname(filename).toLowerCase()] ?? "application/octet-stream";
}

// ── Upload folders mapping ────────────────────────────────────────────────────
// Each entry: { localDir, storagePrefix }
// storagePrefix is the path under public-assets bucket
const UPLOAD_JOBS = [
  {
    localDir: "artifacts/customer-portal/public/images",
    storagePrefix: "portal-assets/static/customer-portal/images",
  },
  {
    localDir: "artifacts/customer-portal/public/menu",
    storagePrefix: "portal-assets/static/customer-portal/menu",
  },
  {
    localDir: "artifacts/bizportal/public/menu",
    storagePrefix: "portal-assets/static/bizportal/menu",
  },
  {
    localDir: "artifacts/api-server/public/pos-images",
    storagePrefix: "pos-images",
  },
  {
    localDir: "artifacts/logistic-order/public",
    storagePrefix: "portal-assets/static/logistic-order",
    filter: (f) => /logocst/i.test(f) || /logo/i.test(f),
  },
  {
    localDir: "artifacts/cst-driver/assets",
    storagePrefix: "portal-assets/static/cst-driver/assets",
    filter: (f) => f.startsWith("hero-"),
  },
];

// ── Recursive file lister ─────────────────────────────────────────────────────
function listFiles(dir) {
  if (!existsSync(dir)) return [];
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...listFiles(fullPath));
    } else if (entry.isFile()) {
      files.push(fullPath);
    }
  }
  return files;
}

// ── Upload single file ────────────────────────────────────────────────────────
async function uploadFile(localPath, storagePath, contentType) {
  const buffer = readFileSync(localPath);
  const { error } = await supabase.storage.from(BUCKET).upload(storagePath, buffer, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(`Upload failed [${storagePath}]: ${error.message}`);
  return `${PROXY_PREFIX}/${storagePath}`;
}

// ── Main ──────────────────────────────────────────────────────────────────────
const manifest = {}; // localRelPath → publicUrl
const errors = [];
let uploaded = 0;
let skipped = 0;

for (const job of UPLOAD_JOBS) {
  const absDir = join(WORKSPACE_ROOT, job.localDir);
  const files = listFiles(absDir);

  for (const filePath of files) {
    const filename = relative(absDir, filePath);

    // Apply optional filter
    if (job.filter && !job.filter(filename.split("/")[0])) {
      skipped++;
      continue;
    }

    // Only process image/asset files
    const ext = extname(filePath).toLowerCase();
    if (!MIME[ext] && ext !== ".svg") {
      skipped++;
      continue;
    }

    const storagePath = `${job.storagePrefix}/${filename}`;
    const contentType = mimeFor(filePath);
    const localRelPath = relative(WORKSPACE_ROOT, filePath);

    process.stdout.write(`  Uploading ${localRelPath} → ${storagePath} ... `);
    try {
      const url = await uploadFile(filePath, storagePath, contentType);
      manifest[localRelPath] = url;
      uploaded++;
      console.log("✓");
    } catch (err) {
      errors.push({ file: localRelPath, error: err.message });
      console.log(`✗ ${err.message}`);
    }
  }
}

// Write manifest to file
const manifestPath = join(WORKSPACE_ROOT, "scripts/image-migration-manifest.json");
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

console.log("\n─────────────────────────────────────────────────────");
console.log(`✓ Uploaded: ${uploaded}`);
console.log(`✗ Errors:   ${errors.length}`);
console.log(`  Skipped:  ${skipped}`);
console.log(`  Manifest: scripts/image-migration-manifest.json`);

if (errors.length > 0) {
  console.log("\nFailed files:");
  for (const e of errors) console.log(`  ${e.file}: ${e.error}`);
  process.exit(1);
}
