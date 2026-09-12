#!/usr/bin/env node
/**
 * convert-png-to-webp.mjs
 *
 * Konversi PNG besar (>500 KB) di Supabase Storage (public-assets) ke WebP,
 * lalu hapus file PNG lama. Update referensi DB di tabel products.
 *
 * Usage:
 *   cd artifacts/api-server
 *   APP_ENV=production node load-secrets.mjs node scripts/convert-png-to-webp.mjs
 *
 * DRY_RUN=1  → tampilkan rencana tanpa eksekusi
 */

import sharp from 'sharp';
import ws from 'ws';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';

const DRY_RUN = process.env.DRY_RUN === '1';
const MIN_SIZE_BYTES = 500 * 1024; // hanya proses PNG > 500 KB
const CONCURRENCY = parseInt(process.env.CONCURRENCY ?? '4', 10);

const FOLDER_TARGETS = [
  'portal-assets',
  'products',
  'vendor-fulfillment',
];

// ── Supabase client ─────────────────────────────────────────────────────────
function makeSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY tidak tersedia');
  const normalized = url.startsWith('http') ? url : `https://${url}.supabase.co`;
  return { sb: createClient(normalized, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws },
  }), baseUrl: normalized };
}

// ── DB client ───────────────────────────────────────────────────────────────
async function makeDb() {
  const client = new pg.Client({
    connectionString: process.env.SUPABASE_DATABASE_URL,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 15000,
  });
  await client.connect();
  return client;
}

// ── Recursive list ──────────────────────────────────────────────────────────
async function listAll(sb, bucket, prefix, results = []) {
  const { data } = await sb.storage.from(bucket).list(prefix, { limit: 1000 });
  if (!data) return results;
  for (const item of data) {
    const fullPath = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.id) {
      results.push({ path: fullPath, size: item.metadata?.size ?? 0, mime: (item.metadata?.mimetype ?? '').toLowerCase() });
    } else {
      await listAll(sb, bucket, fullPath, results);
    }
  }
  return results;
}

// ── Convert PNG buffer → WebP ───────────────────────────────────────────────
async function toWebp(buffer) {
  const meta = await sharp(buffer, { failOn: 'none' }).metadata();
  const width = meta.width ?? 0;

  let pipeline = sharp(buffer, { failOn: 'none' }).rotate();
  if (width > 1920) pipeline = pipeline.resize({ width: 1920, withoutEnlargement: true });

  return pipeline
    .webp({ quality: 85, effort: 5, smartSubsample: true, lossless: false })
    .toBuffer();
}

// ── Process single file ─────────────────────────────────────────────────────
async function processFile(sb, bucket, file, db, baseUrl, stats) {
  const { path: pngPath, size } = file;
  const webpPath = pngPath.replace(/\.png$/i, '.webp');

  try {
    // 1. Download PNG
    const { data: blob, error: dlErr } = await sb.storage.from(bucket).download(pngPath);
    if (dlErr || !blob) {
      console.error(`  ✗ Download gagal: ${pngPath} — ${dlErr?.message}`);
      stats.failed++;
      return;
    }
    const pngBuf = Buffer.from(await blob.arrayBuffer());

    // 2. Convert to WebP
    let webpBuf;
    try {
      webpBuf = await toWebp(pngBuf);
    } catch (err) {
      console.error(`  ✗ Konversi gagal: ${pngPath} — ${err.message}`);
      stats.failed++;
      return;
    }

    const savedPct = ((1 - webpBuf.length / pngBuf.length) * 100).toFixed(1);

    if (DRY_RUN) {
      console.log(`  [DRY] ${pngPath}`);
      console.log(`        ${(pngBuf.length/1024).toFixed(0)}KB PNG → ${(webpBuf.length/1024).toFixed(0)}KB WebP (-${savedPct}%)`);
      stats.wouldSaveBytes += pngBuf.length - webpBuf.length;
      stats.count++;
      return;
    }

    // 3. Upload WebP
    const { error: upErr } = await sb.storage.from(bucket).upload(webpPath, webpBuf, {
      contentType: 'image/webp',
      upsert: true,
    });
    if (upErr) {
      console.error(`  ✗ Upload WebP gagal: ${webpPath} — ${upErr.message}`);
      stats.failed++;
      return;
    }

    // 4. Update DB references (for products table — full Supabase CDN URLs)
    if (pngPath.startsWith('products/') && db) {
      const pngCdnUrl = `${baseUrl}/storage/v1/object/public/public-assets/${pngPath}`;
      const webpCdnUrl = `${baseUrl}/storage/v1/object/public/public-assets/${webpPath}`;
      const { rowCount } = await db.query(
        `UPDATE products SET image_url = $1 WHERE image_url = $2`,
        [webpCdnUrl, pngCdnUrl]
      );
      if (rowCount > 0) {
        console.log(`  📋 DB updated: products.image_url (${rowCount} row) → ${webpCdnUrl}`);
      }
    }

    // 5. Delete old PNG
    const { error: delErr } = await sb.storage.from(bucket).remove([pngPath]);
    if (delErr) {
      console.warn(`  ⚠ Hapus PNG gagal (tidak fatal): ${pngPath} — ${delErr.message}`);
    }

    console.log(`  ✓ ${pngPath}`);
    console.log(`    ${(pngBuf.length/1024).toFixed(0)}KB → ${(webpBuf.length/1024).toFixed(0)}KB WebP (-${savedPct}%)`);
    stats.count++;
    stats.savedBytes += pngBuf.length - webpBuf.length;
  } catch (err) {
    console.error(`  ✗ Error: ${pngPath} — ${err.message}`);
    stats.failed++;
  }
}

// ── Batch runner ────────────────────────────────────────────────────────────
async function runBatch(items, fn) {
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    await Promise.all(items.slice(i, i + CONCURRENCY).map(fn));
  }
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== PNG → WebP Converter (Production) ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN' : 'LIVE'}`);
  console.log('');

  const { sb, baseUrl } = makeSupabase();
  const db = DRY_RUN ? null : await makeDb();

  const BUCKET = 'public-assets';
  console.log(`📦 Listing ${BUCKET}...`);
  const allFiles = await listAll(sb, BUCKET, '');

  // Filter: PNG > 500 KB di folder target
  const targets = allFiles.filter(f =>
    f.mime === 'image/png' &&
    f.size >= MIN_SIZE_BYTES &&
    FOLDER_TARGETS.some(folder => f.path.startsWith(folder + '/'))
  );

  console.log(`Ditemukan ${targets.length} file PNG besar (≥${MIN_SIZE_BYTES/1024}KB)\n`);

  const stats = { count: 0, failed: 0, savedBytes: 0, wouldSaveBytes: 0 };

  await runBatch(targets, (file) => processFile(sb, BUCKET, file, db, baseUrl, stats));

  if (db) await db.end();

  const saved = DRY_RUN ? stats.wouldSaveBytes : stats.savedBytes;
  console.log('\n══════════════════════════════════════════');
  console.log('📊 RINGKASAN:');
  console.log(`   File dikonversi : ${stats.count}`);
  console.log(`   Gagal           : ${stats.failed}`);
  console.log(`   Total hemat     : ${(saved / 1024 / 1024).toFixed(2)} MB`);
  if (stats.count > 0) {
    const origMb = (targets.reduce((s, f) => s + f.size, 0) / 1024 / 1024).toFixed(2);
    console.log(`   (dari ${origMb} MB → hemat ${((saved / targets.reduce((s,f)=>s+f.size,0))*100).toFixed(1)}%)`);
  }
  if (DRY_RUN) console.log('\n⚠️  DRY RUN — jalankan tanpa DRY_RUN=1 untuk menerapkan.');
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
