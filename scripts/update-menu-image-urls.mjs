#!/usr/bin/env node
/**
 * update-menu-image-urls.mjs
 *
 * Updates pos_products.image_url values that still point to local paths
 * (e.g. /menu/thai-tea.jpg, /api/pos-images/{uuid}.png) to their
 * corresponding Supabase Storage URLs.
 *
 * Run via:
 *   cd artifacts/api-server && APP_ENV=development node load-secrets.mjs node ../../scripts/update-menu-image-urls.mjs
 */
import pg from "pg";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DB_URL = process.env.SUPABASE_DATABASE_URL_DEV ?? process.env.SUPABASE_DATABASE_URL;
if (!DB_URL) {
  console.error("ERROR: SUPABASE_DATABASE_URL_DEV (or SUPABASE_DATABASE_URL) is not set");
  process.exit(1);
}

// Load the manifest that maps local paths → Supabase Storage URLs
const manifestPath = join(__dirname, "image-migration-manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"));

// Build a flat lookup: filename → list of storage URLs
// The DB stores URLs like /menu/thai-tea.jpg or /api/pos-images/{uuid}.png
// We need to map these to their Supabase Storage equivalents.

// Build mapping: local-web-path → storage-url
// Local web path is derived from the local fs path:
//   artifacts/customer-portal/public/menu/foo.jpg  → /menu/foo.jpg (served from customer-portal)
//   artifacts/bizportal/public/menu/foo.jpg         → /menu/foo.jpg (served from bizportal)
//   artifacts/api-server/public/pos-images/foo.png  → /api/pos-images/foo.png (served from api-server)

/**
 * Given a manifest local path, return the web-serving path as it would appear in the DB.
 */
function localPathToWebPath(localPath) {
  // customer-portal: artifacts/customer-portal/public/... → /...
  if (localPath.startsWith("artifacts/customer-portal/public/")) {
    return localPath.slice("artifacts/customer-portal/public".length);
  }
  // bizportal: artifacts/bizportal/public/... → /...
  if (localPath.startsWith("artifacts/bizportal/public/")) {
    return localPath.slice("artifacts/bizportal/public".length);
  }
  // api-server: artifacts/api-server/public/pos-images/... → /api/pos-images/...
  if (localPath.startsWith("artifacts/api-server/public/pos-images/")) {
    return "/api" + localPath.slice("artifacts/api-server/public".length);
  }
  return null;
}

// Build web-path → storage-url map
// If multiple local paths map to the same web path (bizportal and customer-portal
// both have /menu/foo.jpg), we keep both mappings and pick based on context later.
// For pos_products we try customer-portal first, then bizportal.
const webPathToStorageUrl = new Map();
const webPathToStorageUrlBizportal = new Map();

for (const [localPath, storageUrl] of Object.entries(manifest)) {
  const webPath = localPathToWebPath(localPath);
  if (!webPath) continue;

  if (localPath.startsWith("artifacts/bizportal/")) {
    webPathToStorageUrlBizportal.set(webPath, storageUrl);
  } else {
    webPathToStorageUrl.set(webPath, storageUrl);
  }
}

console.log(`Manifest web-path entries (non-bizportal): ${webPathToStorageUrl.size}`);
console.log(`Manifest web-path entries (bizportal):     ${webPathToStorageUrlBizportal.size}`);

const pool = new pg.Pool({
  connectionString: DB_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
  connectionTimeoutMillis: 30000,
  idleTimeoutMillis: 60000,
});

async function run() {
  const client = await pool.connect();
  try {
    // Check if pos_products table exists
    const tableCheck = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name = 'pos_products'
    `);

    if (tableCheck.rows.length === 0) {
      console.log("Table pos_products does not exist — nothing to migrate.");
      return;
    }

    // Fetch all products with local image URLs
    const { rows: products } = await client.query(`
      SELECT id, name, image_url
      FROM pos_products
      WHERE image_url IS NOT NULL
        AND (
          image_url LIKE '/menu/%'
          OR image_url LIKE '/images/%'
          OR image_url LIKE '/api/pos-images/%'
        )
      ORDER BY id
    `);

    console.log(`\nFound ${products.length} pos_products row(s) with local image URLs:\n`);
    if (products.length === 0) {
      console.log("No rows to update — database already up to date.");
      return;
    }

    for (const p of products) {
      console.log(`  id=${p.id} | "${p.name}" | ${p.image_url}`);
    }
    console.log();

    let updated = 0;
    let skipped = 0;

    for (const product of products) {
      const oldUrl = product.image_url;
      // Try customer-portal lookup first, then bizportal
      const newUrl = webPathToStorageUrl.get(oldUrl) ?? webPathToStorageUrlBizportal.get(oldUrl);

      if (!newUrl) {
        console.warn(`  SKIP id=${product.id} — no mapping found for: ${oldUrl}`);
        skipped++;
        continue;
      }

      await client.query(
        "UPDATE pos_products SET image_url = $1 WHERE id = $2",
        [newUrl, product.id]
      );
      console.log(`  UPDATE id=${product.id} | ${oldUrl} → ${newUrl}`);
      updated++;
    }

    console.log(`\nDone. Updated: ${updated}, Skipped: ${skipped}`);

    // Also check if there's a menu_items table (mentioned in task description)
    const menuTableCheck = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
        AND table_name = 'menu_items'
    `);

    if (menuTableCheck.rows.length > 0) {
      const { rows: menuItems } = await client.query(`
        SELECT id, name, image_url
        FROM menu_items
        WHERE image_url IS NOT NULL
          AND (
            image_url LIKE '/menu/%'
            OR image_url LIKE '/images/%'
            OR image_url LIKE '/api/pos-images/%'
          )
        ORDER BY id
      `);

      console.log(`\nmenu_items: Found ${menuItems.length} row(s) with local image URLs`);
      let menuUpdated = 0;
      let menuSkipped = 0;
      for (const item of menuItems) {
        const oldUrl = item.image_url;
        const newUrl = webPathToStorageUrl.get(oldUrl) ?? webPathToStorageUrlBizportal.get(oldUrl);
        if (!newUrl) {
          console.warn(`  SKIP menu_items id=${item.id} — no mapping for: ${oldUrl}`);
          menuSkipped++;
          continue;
        }
        await client.query(
          "UPDATE menu_items SET image_url = $1 WHERE id = $2",
          [newUrl, item.id]
        );
        console.log(`  UPDATE menu_items id=${item.id} | ${oldUrl} → ${newUrl}`);
        menuUpdated++;
      }
      console.log(`menu_items done. Updated: ${menuUpdated}, Skipped: ${menuSkipped}`);
    } else {
      console.log("\nmenu_items table does not exist — skipping.");
    }
  } finally {
    client.release();
    await pool.end();
  }
}

run().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
