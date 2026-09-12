#!/usr/bin/env node
/**
 * Verify every critical static asset referenced by application code exists in
 * Supabase Storage using the list API (HEAD requests return 400 on this Supabase plan).
 *
 * Run:
 *   APP_ENV=development node artifacts/api-server/load-secrets.mjs \
 *     node artifacts/api-server/verify-storage-assets.mjs
 */

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET       = "public-assets";

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error("Missing VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  process.exit(1);
}

async function listDir(prefix) {
  const r = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${SERVICE_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({ prefix, limit: 1000 }),
  });
  if (!r.ok) throw new Error(`list ${prefix}: HTTP ${r.status}`);
  return (await r.json()).map(f => f.name);
}

// Each entry: [storagePrefix, [filenames...]]
const CHECK_DIRS = [
  ["portal-assets/static/customer-portal/images/", [
    "logo.png", "logo-baru.png", "og-cover.png",
    "hero-bg.jpg", "hero-bg.webp",
    "warehouse.webp", "port-operations.webp",
    "customs.png", "customs-document.png",
    "air-freight.png", "sea-freight.png",
    "logistics-routes.svg", "gambar-baru.png",
  ]],
  ["portal-assets/static/customer-portal/images/services/", [
    "freight-udara.png", "customs-clearance.png", "handling-cargo-laut.png",
    "biaya-storage.png", "trucking-container.png",
    "pengurusan-dokumen-ppjk.png", "asuransi-kargo.png",
  ]],
  ["portal-assets/static/bizportal/", [
    "logocst.png", "thai-tea-cst-logo.jpeg",
  ]],
  ["portal-assets/static/logistic-order/", [
    "logocst.jpg", "logocst-new.jpg",
  ]],
];

let total = 0, missing = 0;
for (const [prefix, files] of CHECK_DIRS) {
  const listed = new Set(await listDir(prefix));
  for (const f of files) {
    total++;
    const ok = listed.has(f);
    if (!ok) { missing++; console.log(`❌ ${prefix}${f}`); }
    else        console.log(`✅ ${prefix}${f}`);
  }
}

console.log(`\n${missing === 0 ? "✓ All" : `❌ ${missing}/${total} missing —`} ${total} assets verified in bucket '${BUCKET}'.`);
if (missing > 0) process.exit(1);
