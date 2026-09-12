#!/usr/bin/env node
/**
 * compress-storage-images.mjs
 *
 * Bulk-compress gambar yang sudah ada di Supabase Storage (production).
 * Format dipertahankan (JPEG→JPEG, PNG→PNG, WebP→WebP) sehingga URL tidak berubah.
 * File yang sudah kecil (<50 KB) atau tidak memberi penghematan di-skip.
 *
 * Usage:
 *   cd artifacts/api-server
 *   APP_ENV=production node load-secrets.mjs node scripts/compress-storage-images.mjs
 *
 * Options (env vars):
 *   DRY_RUN=1          — tampilkan rencana tanpa upload
 *   BUCKET=public-assets — hanya proses bucket tertentu (default: keduanya)
 *   CONCURRENCY=5      — jumlah parallel per batch (default: 5)
 */

import sharp from 'sharp';
import ws from 'ws';
import { createClient } from '@supabase/supabase-js';

// ── Config ─────────────────────────────────────────────────────────────────────
const DRY_RUN = process.env.DRY_RUN === '1';
const ONLY_BUCKET = process.env.BUCKET || null; // null = proses keduanya
const CONCURRENCY = parseInt(process.env.CONCURRENCY ?? '5', 10);
const MIN_SIZE_BYTES = 50 * 1024; // skip file < 50 KB (sudah kecil)

const IMAGE_MIMES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
  'image/tiff', 'image/bmp',
]);

// GIF/HEIC tidak diproses — animated GIF dan HEIC tidak bisa di-in-place compress aman
const SKIP_MIMES = new Set(['image/gif', 'image/heic', 'image/heif', 'image/svg+xml']);

// ── Supabase client ────────────────────────────────────────────────────────────
function makeSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY tidak tersedia');
  const normalizedUrl = url.startsWith('http') ? url : `https://${url}.supabase.co`;
  return createClient(normalizedUrl, key, {
    auth: { autoRefreshToken: false, persistSession: false },
    realtime: { transport: ws },
  });
}

// ── List semua file secara rekursif ──────────────────────────────────────────
async function listAll(sb, bucket, prefix = '', results = []) {
  const { data, error } = await sb.storage.from(bucket).list(prefix, { limit: 1000 });
  if (error || !data) return results;

  for (const item of data) {
    const fullPath = prefix ? `${prefix}/${item.name}` : item.name;
    if (item.id) {
      // File (item.id !== null)
      results.push({
        path: fullPath,
        size: item.metadata?.size ?? 0,
        mime: (item.metadata?.mimetype ?? '').toLowerCase(),
      });
    } else {
      // Folder — rekursi
      await listAll(sb, bucket, fullPath, results);
    }
  }
  return results;
}

// ── Kompresi satu gambar (preserve format) ────────────────────────────────────
async function compressBuffer(buffer, mime) {
  const image = sharp(buffer, { failOn: 'none' }).rotate();
  const meta = await image.metadata();
  const width = meta.width ?? 0;

  // Resize jika lebih lebar dari 1920px (batas maksimal untuk web)
  let pipeline = image;
  if (width > 1920) {
    pipeline = pipeline.resize({ width: 1920, withoutEnlargement: true });
  }

  if (mime === 'image/jpeg' || mime === 'image/jpg') {
    return { buffer: await pipeline.jpeg({ quality: 82, mozjpeg: true }).toBuffer(), mime: 'image/jpeg' };
  }
  if (mime === 'image/png') {
    return { buffer: await pipeline.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer(), mime: 'image/png' };
  }
  if (mime === 'image/webp') {
    return { buffer: await pipeline.webp({ quality: 82, effort: 4, smartSubsample: true }).toBuffer(), mime: 'image/webp' };
  }
  if (mime === 'image/tiff') {
    return { buffer: await pipeline.tiff({ compression: 'jpeg', quality: 82 }).toBuffer(), mime: 'image/tiff' };
  }
  if (mime === 'image/bmp') {
    // BMP → PNG (preserve-ish, jauh lebih kecil)
    return { buffer: await pipeline.png({ compressionLevel: 9 }).toBuffer(), mime: 'image/png' };
  }

  return { buffer, mime }; // fallback: kembalikan asli
}

// ── Proses satu file ──────────────────────────────────────────────────────────
async function processFile(sb, bucket, file, stats) {
  const { path, size, mime } = file;

  if (SKIP_MIMES.has(mime)) {
    stats.skipped++;
    return;
  }
  if (!IMAGE_MIMES.has(mime)) {
    stats.skipped++;
    return;
  }
  if (size < MIN_SIZE_BYTES) {
    stats.tooSmall++;
    return;
  }

  try {
    // Download
    const { data: blob, error: dlErr } = await sb.storage.from(bucket).download(path);
    if (dlErr || !blob) {
      console.error(`  ✗ Download gagal: ${path} — ${dlErr?.message}`);
      stats.failed++;
      return;
    }
    const original = Buffer.from(await blob.arrayBuffer());

    // Compress
    let compressed, compressedMime;
    try {
      const result = await compressBuffer(original, mime);
      compressed = result.buffer;
      compressedMime = result.mime;
    } catch (sharpErr) {
      console.error(`  ✗ Sharp error: ${path} — ${sharpErr.message}`);
      stats.failed++;
      return;
    }

    // Jangan upload jika tidak ada penghematan (compressed >= original)
    if (compressed.length >= original.length) {
      console.log(`  → Skip (sudah optimal): ${path} [${(original.length/1024).toFixed(0)}KB]`);
      stats.alreadyOptimal++;
      return;
    }

    const savedBytes = original.length - compressed.length;
    const savedPct = ((savedBytes / original.length) * 100).toFixed(1);

    if (DRY_RUN) {
      console.log(`  [DRY] ${path}: ${(original.length/1024).toFixed(0)}KB → ${(compressed.length/1024).toFixed(0)}KB (-${savedPct}%)`);
      stats.wouldSaveBytes += savedBytes;
      stats.processed++;
      return;
    }

    // Upload (upsert)
    const { error: upErr } = await sb.storage.from(bucket).upload(path, compressed, {
      contentType: compressedMime,
      upsert: true,
    });
    if (upErr) {
      console.error(`  ✗ Upload gagal: ${path} — ${upErr.message}`);
      stats.failed++;
      return;
    }

    console.log(`  ✓ ${path}: ${(original.length/1024).toFixed(0)}KB → ${(compressed.length/1024).toFixed(0)}KB (-${savedPct}%)`);
    stats.processed++;
    stats.savedBytes += savedBytes;
  } catch (err) {
    console.error(`  ✗ Error: ${path} — ${err.message}`);
    stats.failed++;
  }
}

// ── Batch processor ───────────────────────────────────────────────────────────
async function runBatch(sb, bucket, files, stats) {
  for (let i = 0; i < files.length; i += CONCURRENCY) {
    const batch = files.slice(i, i + CONCURRENCY);
    await Promise.all(batch.map((f) => processFile(sb, bucket, f, stats)));
    const done = Math.min(i + CONCURRENCY, files.length);
    process.stdout.write(`\r  Progress: ${done}/${files.length} files...`);
  }
  process.stdout.write('\n');
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  console.log('=== Supabase Storage Image Compressor ===');
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (tidak ada perubahan)' : 'LIVE'}`);
  console.log(`Concurrency: ${CONCURRENCY}`);
  console.log('');

  const sb = makeSupabase();
  const buckets = ONLY_BUCKET
    ? [ONLY_BUCKET]
    : ['public-assets', 'private-uploads'];

  let totalStats = {
    processed: 0, skipped: 0, failed: 0,
    tooSmall: 0, alreadyOptimal: 0,
    savedBytes: 0, wouldSaveBytes: 0,
  };

  for (const bucket of buckets) {
    console.log(`\n📦 Bucket: ${bucket}`);
    console.log('  Listing files...');

    const allFiles = await listAll(sb, bucket, '');
    const imageFiles = allFiles.filter(
      (f) => IMAGE_MIMES.has(f.mime) || SKIP_MIMES.has(f.mime)
    );

    console.log(`  Total files: ${allFiles.length} | Image: ${imageFiles.length}`);

    const stats = {
      processed: 0, skipped: 0, failed: 0,
      tooSmall: 0, alreadyOptimal: 0,
      savedBytes: 0, wouldSaveBytes: 0,
    };

    await runBatch(sb, bucket, imageFiles, stats);

    const saved = DRY_RUN ? stats.wouldSaveBytes : stats.savedBytes;
    console.log(`\n  📊 ${bucket} selesai:`);
    console.log(`     Berhasil dikompres : ${stats.processed}`);
    console.log(`     Sudah optimal       : ${stats.alreadyOptimal}`);
    console.log(`     Terlalu kecil (<50K): ${stats.tooSmall}`);
    console.log(`     Di-skip (GIF/HEIC) : ${stats.skipped}`);
    console.log(`     Gagal              : ${stats.failed}`);
    console.log(`     Hemat ruang        : ${(saved / 1024 / 1024).toFixed(2)} MB`);

    totalStats.processed += stats.processed;
    totalStats.skipped += stats.skipped;
    totalStats.failed += stats.failed;
    totalStats.tooSmall += stats.tooSmall;
    totalStats.alreadyOptimal += stats.alreadyOptimal;
    totalStats.savedBytes += stats.savedBytes;
    totalStats.wouldSaveBytes += stats.wouldSaveBytes;
  }

  const totalSaved = DRY_RUN ? totalStats.wouldSaveBytes : totalStats.savedBytes;
  console.log('\n══════════════════════════════════════════');
  console.log('📊 TOTAL RINGKASAN:');
  console.log(`   File dikompres : ${totalStats.processed}`);
  console.log(`   Sudah optimal  : ${totalStats.alreadyOptimal}`);
  console.log(`   Gagal          : ${totalStats.failed}`);
  console.log(`   Total hemat    : ${(totalSaved / 1024 / 1024).toFixed(2)} MB`);
  if (DRY_RUN) {
    console.log('\n⚠️  DRY RUN — jalankan tanpa DRY_RUN=1 untuk menerapkan kompresi.');
  }
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
