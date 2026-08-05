#!/usr/bin/env node
/**
 * DEV/QA Marketplace Seed Script
 * ================================
 * GUARD: tidak boleh berjalan di PROD.
 * Idempotent: INSERT ... ON CONFLICT DO NOTHING dengan unique key buatan.
 *
 * Jalankan: node scripts/seed-dev-marketplace.mjs
 */

import { execSync } from "child_process";

// ── Safety guard ──────────────────────────────────────────────────────────────
const APP_ENV = process.env.APP_ENV ?? process.env.NODE_ENV ?? "development";
const DB_URL  = process.env.SUPABASE_DATABASE_URL_DEV ?? process.env.DATABASE_URL;

if (!DB_URL) {
  console.error("[seed] ERROR: SUPABASE_DATABASE_URL_DEV tidak tersedia. Abort.");
  process.exit(1);
}
if (APP_ENV === "production") {
  console.error("[seed] ERROR: APP_ENV=production — seed tidak boleh berjalan di PROD. Abort.");
  process.exit(1);
}
const PROD_REF = "nzdweipzckfszczzqtuw";
if (DB_URL.includes(PROD_REF)) {
  console.error(`[seed] ERROR: Koneksi mengarah ke PROD project (${PROD_REF}). Abort.`);
  process.exit(1);
}

console.log(`[seed] APP_ENV=${APP_ENV} — Aman berjalan di DEV.\n`);

// ── SQL yang akan dijalankan ──────────────────────────────────────────────────
// Menggunakan WHERE NOT EXISTS per item untuk idempotency yang aman.
// Image URLs: Unsplash public domain (bisa diganti gambar lokal nanti).
const SQL = `
-- ── QA Seed: DEV Marketplace Data ──────────────────────────────────────────
-- Idempotent: setiap INSERT hanya berjalan jika item belum ada (vendor_id + name)

-- [A1] Batubara Thermal — kategori coal, on_order, ada harga + gambar
INSERT INTO vendor_catalog_items
  (vendor_id, vendor_name, name, description, kategori, category_key,
   stock_status, is_active, is_published, price_sell, currency, unit, moq,
   origin, location, template_kind, media_assets)
SELECT
  24, 'PT Cahaya Sejati Teknologi', '[QA] Batubara Thermal GAR 4200',
  'Batubara thermal low rank, GAR 4200 kcal/kg. Cocok untuk PLTU dan industri. [QA seed]',
  'coal', 'coal', 'on_order', true, true, 850000, 'IDR', 'MT', 500,
  'Kalimantan Selatan, Indonesia', 'Banjarmasin, Kalimantan Selatan', 'product',
  '[{"type":"image","url":"https://images.unsplash.com/photo-1601597111158-2fceff292cdc?w=800&q=80","isPrimary":true}]'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM vendor_catalog_items WHERE vendor_id = 24 AND name = '[QA] Batubara Thermal GAR 4200'
);

-- [A2] Bawang Merah Super — fresh_vegetable, available, harga IDR
INSERT INTO vendor_catalog_items
  (vendor_id, vendor_name, name, description, kategori, category_key,
   stock_status, is_active, is_published, price_sell, currency, unit, moq,
   origin, location, template_kind, media_assets)
SELECT
  34, 'PT TEST INDONESIA', '[QA] Bawang Merah Super',
  'Bawang merah kualitas super, ukuran sedang, kering sempurna. [QA seed]',
  'fresh_vegetable', 'fresh_vegetable', 'available', true, true, 35000, 'IDR', 'Kg', 50,
  'Jawa Tengah, Indonesia', 'Brebes, Jawa Tengah', 'product',
  '[{"type":"image","url":"https://images.unsplash.com/photo-1540420773420-3366772f4999?w=800&q=80","isPrimary":true}]'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM vendor_catalog_items WHERE vendor_id = 34 AND name = '[QA] Bawang Merah Super'
);

-- [A3] Coffee available — tanpa harga (null price_sell edge case), ada gambar
INSERT INTO vendor_catalog_items
  (vendor_id, vendor_name, name, description, kategori, category_key,
   stock_status, is_active, is_published, price_sell, currency, unit, moq,
   origin, location, template_kind, media_assets)
SELECT
  24, 'PT Cahaya Sejati Teknologi', '[QA] Kopi Arabica Flores – Available Sample',
  'Kopi Arabica Flores Grade 1, harga on request. [QA seed — tanpa harga]',
  'coffee', 'coffee', 'available', true, true, NULL, 'USD', 'MT', 1,
  'Flores, Nusa Tenggara Timur', 'Flores, NTT', 'product',
  '[{"type":"image","url":"https://images.unsplash.com/photo-1611854779393-1b2da9d400fe?w=800&q=80","isPrimary":true}]'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM vendor_catalog_items WHERE vendor_id = 24 AND name = '[QA] Kopi Arabica Flores – Available Sample'
);

-- [A4] Tanpa gambar — limited stock, edge case QA
INSERT INTO vendor_catalog_items
  (vendor_id, vendor_name, name, description, kategori, category_key,
   stock_status, is_active, is_published, price_sell, currency, unit, moq,
   origin, location, template_kind, media_assets)
SELECT
  34, 'PT TEST INDONESIA', '[QA] Kacang Tanah Kupas – No Image',
  'Kacang tanah kupas, kadar air <9%. [QA seed — tanpa gambar]',
  'peanut', 'peanut', 'limited', true, true, 28000, 'IDR', 'Kg', 100,
  'Jawa Timur, Indonesia', 'Lamongan, Jawa Timur', 'product',
  '[]'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM vendor_catalog_items WHERE vendor_id = 34 AND name = '[QA] Kacang Tanah Kupas – No Image'
);

-- ── UPDATE: fix kolom di item existing ───────────────────────────────────────

-- id=21: Arabica Coffee → set available agar ada 1 coffee dengan stock available
UPDATE vendor_catalog_items
  SET stock_status = 'available', category_key = 'coffee', kategori = 'coffee'
  WHERE id = 21;

-- id=37: Bawang Putih → tambah category_key dan stock_status
UPDATE vendor_catalog_items
  SET category_key = 'fresh_vegetable', kategori = 'fresh_vegetable', stock_status = 'available'
  WHERE id = 37;

-- id=40: Cabai Rawit → pastikan category_key
UPDATE vendor_catalog_items
  SET category_key = 'fresh_vegetable'
  WHERE id = 40;

-- id=19: Palm Acid Oil → pastikan category_key terisi
UPDATE vendor_catalog_items
  SET category_key = 'palm_oil'
  WHERE id = 19;

-- ── Verifikasi akhir ──────────────────────────────────────────────────────────
SELECT
  COUNT(*) FILTER (WHERE is_active AND is_published) AS active_published,
  COUNT(DISTINCT COALESCE(category_key, kategori)) FILTER (WHERE is_active AND is_published) AS kategori_count,
  COUNT(DISTINCT vendor_id) FILTER (WHERE is_active AND is_published) AS vendor_count,
  COUNT(*) FILTER (WHERE is_active AND is_published AND stock_status = 'available') AS available_count,
  COUNT(*) FILTER (WHERE is_active AND is_published AND stock_status = 'on_order') AS on_order_count,
  COUNT(*) FILTER (WHERE is_active AND is_published AND stock_status = 'limited') AS limited_count
FROM vendor_catalog_items;
`;

// ── Jalankan via psql ─────────────────────────────────────────────────────────
try {
  const out = execSync(`psql "${DB_URL}" << 'EOSQL'\n${SQL}\nEOSQL`, {
    shell: "/bin/bash",
    encoding: "utf-8",
    env: process.env,
  });
  console.log(out);
  console.log("[seed] Selesai. Idempotent — aman dijalankan ulang.");
} catch (err) {
  console.error("[seed] FATAL:", err.message);
  if (err.stderr) console.error(err.stderr);
  process.exit(1);
}
