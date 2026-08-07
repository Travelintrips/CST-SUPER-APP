#!/usr/bin/env node
/**
 * update-kasir-product-image-urls.mjs
 *
 * Updates kasir_products.image_url values that still point to local paths
 * (e.g. /images/products/Chocolate.jpg) to their Supabase Storage URLs.
 *
 * Strategy: build a filename→URL map from existing rows that already have
 * Supabase Storage URLs, then apply that map to the local-path rows.
 *
 * Run via:
 *   cd artifacts/api-server && APP_ENV=development node load-secrets.mjs node ../../scripts/update-kasir-product-image-urls.mjs
 */
import pg from "pg";

const DB_URL = process.env.SUPABASE_DATABASE_URL_DEV ?? process.env.SUPABASE_DATABASE_URL;
if (!DB_URL) {
  console.error("ERROR: SUPABASE_DATABASE_URL_DEV (or SUPABASE_DATABASE_URL) is not set");
  process.exit(1);
}

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
    // Step 1: Collect all existing Supabase Storage URLs from kasir_products
    // to build a filename → canonical URL map.
    const { rows: storageRows } = await client.query(`
      SELECT DISTINCT image_url
      FROM kasir_products
      WHERE image_url IS NOT NULL
        AND image_url LIKE 'https://%'
    `);

    // Map: lowercase filename → preferred storage URL
    // (prefer xssrfshdrtdfupgqwfdw — the dev project — over nzdweipzckfszczzqtuw)
    const filenameToUrl = new Map();
    for (const { image_url } of storageRows) {
      // Extract filename from URL path
      const parts = image_url.split("/");
      const filename = parts[parts.length - 1]; // e.g. "Premium_Thai_Tea.jpg"
      const key = filename.toLowerCase();
      const existing = filenameToUrl.get(key);
      if (!existing || image_url.includes("xssrfshdrtdfupgqwfdw")) {
        // Prefer the xssrfshdrtdfupgqwfdw project (dev), overwrite if we find it
        filenameToUrl.set(key, image_url);
      }
    }
    console.log(`Built filename→URL map with ${filenameToUrl.size} entries`);
    for (const [k, v] of filenameToUrl) console.log(`  ${k} → ${v}`);

    // Step 2: Find all rows with local-path image_url
    const { rows: localRows } = await client.query(`
      SELECT id, name, image_url
      FROM kasir_products
      WHERE image_url IS NOT NULL
        AND (
          image_url LIKE '/images/%'
          OR image_url LIKE '/menu/%'
          OR image_url LIKE '/api/pos-images/%'
        )
      ORDER BY name
    `);

    console.log(`\nFound ${localRows.length} kasir_products row(s) with local image URLs`);
    if (localRows.length === 0) {
      console.log("Nothing to update — already clean.");
      return;
    }

    let updated = 0;
    let skipped = 0;

    for (const row of localRows) {
      const oldUrl = row.image_url;
      // Extract filename from local path: /images/products/Bubble.jpg → Bubble.jpg
      const filename = oldUrl.split("/").pop();
      const newUrl = filenameToUrl.get(filename?.toLowerCase());

      if (!newUrl) {
        console.warn(`  SKIP id=${row.id} "${row.name}" — no Supabase URL found for: ${oldUrl} (filename: ${filename})`);
        skipped++;
        continue;
      }

      await client.query(
        "UPDATE kasir_products SET image_url = $1 WHERE id = $2",
        [newUrl, row.id]
      );
      console.log(`  UPDATE "${row.name}" (${row.id.slice(0, 8)}…) | ${oldUrl} → ${newUrl}`);
      updated++;
    }

    console.log(`\nDone. Updated: ${updated}, Skipped: ${skipped}`);

    // Step 3: Verify — no more local paths should remain
    const { rows: remaining } = await client.query(`
      SELECT COUNT(*) AS cnt FROM kasir_products
      WHERE image_url IS NOT NULL
        AND (image_url LIKE '/images/%' OR image_url LIKE '/menu/%' OR image_url LIKE '/api/pos-images/%')
    `);
    console.log(`Remaining local-path rows: ${remaining[0].cnt}`);
    if (Number(remaining[0].cnt) > 0) {
      console.error("WARNING: Some rows still have local paths — manual review needed.");
      process.exit(1);
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
