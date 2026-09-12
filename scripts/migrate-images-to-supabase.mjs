/**
 * migrate-images-to-supabase.mjs
 * Uploads all local images from artifacts/customer-portal/public/images/
 * to Supabase Storage (public-assets bucket) under portal/images/...
 * Also upserts portal_content DB entries for known CMS keys.
 */

import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import pg from "pg";
import { resolveSupabaseDatabaseUrl } from "./resolve-supabase-db-url.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// ── Config ────────────────────────────────────────────────────────────────────
const SUPABASE_URL = process.env.SUPABASE_URL_DEV || process.env.VITE_SUPABASE_URL_DEV;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY_DEV || process.env.SUPABASE_SERVICE_ROLE_KEY;
const { url: DB_URL } = resolveSupabaseDatabaseUrl();

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("Missing SUPABASE_URL_DEV / SUPABASE_SERVICE_ROLE_KEY_DEV");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const PUBLIC_BUCKET = "public-assets";
const IMAGES_DIR = path.join(ROOT, "artifacts/customer-portal/public/images");

// ── MIME helper ───────────────────────────────────────────────────────────────
function mimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const map = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
    ".png": "image/png", ".webp": "image/webp",
    ".gif": "image/gif", ".svg": "image/svg+xml",
  };
  return map[ext] ?? "application/octet-stream";
}

async function prepareImage(buffer, contentType) {
  if (!contentType.startsWith("image/") || contentType === "image/svg+xml" || contentType === "image/gif") {
    return { buffer, contentType };
  }

  try {
    const image = sharp(buffer, { failOn: "none" }).rotate();
    if (contentType === "image/jpeg" || contentType === "image/jpg") {
      return { buffer: await image.jpeg({ quality: 80, mozjpeg: true }).toBuffer(), contentType: "image/jpeg" };
    }
    if (contentType === "image/png") {
      return { buffer: await image.png({ compressionLevel: 9, adaptiveFiltering: true, palette: true }).toBuffer(), contentType };
    }
    return { buffer: await image.webp({ quality: 80, effort: 4, smartSubsample: true }).toBuffer(), contentType: "image/webp" };
  } catch {
    return { buffer, contentType };
  }
}

// ── Walk directory recursively ────────────────────────────────────────────────
function walkDir(dir, base = dir) {
  const results = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(full, base));
    } else {
      results.push(path.relative(base, full));
    }
  }
  return results;
}

// ── Upload one file ───────────────────────────────────────────────────────────
async function uploadFile(localRelPath) {
  const localFull = path.join(IMAGES_DIR, localRelPath);
  const storagePath = `portal/images/${localRelPath.replace(/\\/g, "/")}`;
  const prepared = await prepareImage(fs.readFileSync(localFull), mimeType(localFull));

  const { error } = await supabase.storage
    .from(PUBLIC_BUCKET)
    .upload(storagePath, prepared.buffer, { contentType: prepared.contentType, upsert: true });

  if (error) {
    console.error(`  ✗ ${storagePath}: ${error.message}`);
    return null;
  }
  console.log(`  ✓ ${storagePath}`);
  return `/api/storage/public-objects/${storagePath}`;
}

// ── Update portal_content DB for CMS keys ────────────────────────────────────
const CMS_KEYS = [
  { key: "hero_bg",        image: "hero-bg.jpg" },
  { key: "logo",           image: "logo-baru.png" },
  { key: "og_cover",       image: "og-cover.png" },
  { key: "warehouse_bg",   image: "warehouse.png" },
  { key: "port_operations",image: "port-operations.png" },
  { key: "customs_img",    image: "customs.png" },
];

async function updatePortalContent(dbUrl) {
  if (!dbUrl) {
    console.log("  (no DB_URL — skipping portal_content update)");
    return;
  }
  const client = new pg.Client({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  await client.connect();
  for (const { key, image } of CMS_KEYS) {
    const storageValue = `/api/storage/public-objects/portal/images/${image}`;
    await client.query(
      `INSERT INTO portal_content (key, value) VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [key, storageValue]
    );
    console.log(`  ✓ portal_content: ${key} → ${storageValue}`);
  }
  await client.end();
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=== Uploading images to Supabase Storage ===");
  const files = walkDir(IMAGES_DIR);
  console.log(`Found ${files.length} images to upload\n`);

  let ok = 0, fail = 0;
  for (const f of files) {
    const result = await uploadFile(f);
    if (result) ok++; else fail++;
  }

  console.log(`\nUpload complete: ${ok} OK, ${fail} failed`);

  console.log("\n=== Updating portal_content DB entries ===");
  await updatePortalContent(DB_URL);

  console.log("\nDone! All images are now in Supabase Storage.");
}

main().catch((e) => { console.error(e); process.exit(1); });
