/**
 * Recompress existing raster images in Supabase Storage without changing
 * their object paths. SVG, PDF, and video objects are intentionally skipped.
 *
 * Usage:
 *   APP_ENV=development node artifacts/api-server/load-secrets.mjs \
 *     node scripts/recompress-supabase-images.mjs
 *
 * Add --dry-run to inspect candidates without writing objects.
 */

import { createRequire } from "node:module";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const { createClient } = require("../artifacts/api-server/node_modules/@supabase/supabase-js");
const sharp = require("../artifacts/api-server/node_modules/sharp");
const WebSocket = require("../artifacts/api-server/node_modules/ws");

const appEnv = process.env.APP_ENV;
if (appEnv !== "development" && appEnv !== "production") {
  throw new Error("APP_ENV must be development or production");
}

const supabaseUrl = process.env.SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required");
}

const dryRun = process.argv.includes("--dry-run");
const requestedBucket = process.argv.find((arg) => arg.startsWith("--bucket="))?.split("=")[1];
const buckets = requestedBucket
  ? ["public-assets", "private-uploads"].filter((bucket) => bucket === requestedBucket)
  : ["public-assets", "private-uploads"];
if (buckets.length === 0) throw new Error(`Unknown bucket: ${requestedBucket}`);
const MAX_WIDTH = 1600;
const CONCURRENCY = 4;
const statePath = process.env.RECOMPRESS_STATE_FILE ?? `/tmp/recompress-supabase-images-${appEnv}.json`;
const processed = new Set(
  existsSync(statePath)
    ? JSON.parse(readFileSync(statePath, "utf8"))
    : [],
);

function checkpoint(key) {
  processed.add(key);
  writeFileSync(statePath, JSON.stringify([...processed]));
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
  realtime: { transport: WebSocket },
});

function extensionMime(path) {
  const ext = path.split(".").pop()?.toLowerCase();
  return {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    bmp: "image/bmp",
    tif: "image/tiff",
    tiff: "image/tiff",
    heic: "image/heic",
    heif: "image/heif",
    svg: "image/svg+xml",
  }[ext] ?? null;
}

function metadataMime(item, path) {
  const metadata = item.metadata ?? {};
  const mime = metadata.mimetype ?? metadata.contentType ?? metadata["content-type"];
  return typeof mime === "string" && mime.startsWith("image/")
    ? mime.toLowerCase()
    : extensionMime(path);
}

async function listAllObjects(bucket, prefix = "") {
  const objects = [];
  let offset = 0;

  while (true) {
    const { data, error } = await supabase.storage.from(bucket).list(prefix, {
      limit: 1000,
      offset,
      sortBy: { column: "name", order: "asc" },
    });
    if (error) throw new Error(`List failed [${bucket}/${prefix}]: ${error.message}`);
    if (!data?.length) break;

    for (const item of data) {
      const path = prefix ? `${prefix}/${item.name}` : item.name;
      // Supabase represents folders with id=null and files with an id.
      if (item.id == null) {
        objects.push(...await listAllObjects(bucket, path));
      } else {
        objects.push({ ...item, path });
      }
    }

    if (data.length < 1000) break;
    offset += data.length;
  }

  return objects;
}

async function compressImage(buffer, contentType) {
  if (contentType === "image/svg+xml") {
    return { buffer, contentType, changed: false, reason: "vector-svg" };
  }

  const animated = contentType === "image/gif";
  const image = sharp(buffer, { failOn: "none", animated });
  const metadata = await image.metadata();
  let pipeline = image.rotate();

  if ((metadata.width ?? 0) > MAX_WIDTH) {
    pipeline = pipeline.resize({ width: MAX_WIDTH, withoutEnlargement: true });
  }

  let output;
  let outputType = contentType;
  if (contentType === "image/jpeg" || contentType === "image/jpg") {
    output = await pipeline.jpeg({ quality: 80, mozjpeg: true }).toBuffer();
    outputType = "image/jpeg";
  } else if (contentType === "image/png") {
    output = await pipeline.png({
      compressionLevel: 9,
      adaptiveFiltering: true,
      palette: false,
    }).toBuffer();
  } else if (contentType === "image/webp") {
    output = await pipeline.webp({
      quality: 80,
      effort: 4,
      smartSubsample: true,
    }).toBuffer();
  } else {
    // GIF/BMP/TIFF/HEIC are normalized to WebP. The object path remains
    // unchanged so database references do not need to be rewritten.
    output = await pipeline.webp({
      quality: 80,
      effort: 4,
      smartSubsample: true,
    }).toBuffer();
    outputType = "image/webp";
  }

  // Never replace an object with a larger result unless it was resized.
  const resized = (metadata.width ?? 0) > MAX_WIDTH;
  if (!resized && output.length >= buffer.length) {
    return { buffer, contentType, changed: false, reason: "already-smaller" };
  }

  return { buffer: output, contentType: outputType, changed: true, reason: "recompressed" };
}

async function processBucket(bucket) {
  const objects = await listAllObjects(bucket);
  const images = objects.filter((item) => metadataMime(item, item.path)?.startsWith("image/"));
  let changed = 0;
  let unchanged = 0;
  let failed = 0;
  let savedBytes = 0;

  console.log(`[${appEnv}] ${bucket}: ${images.length} image object(s) found`);

  let nextIndex = 0;
  async function worker() {
    while (true) {
      const item = images[nextIndex++];
      if (!item) return;

      const path = item.path;
      const stateKey = `${bucket}/${path}`;
      if (processed.has(stateKey)) {
        unchanged++;
        continue;
      }
      const contentType = metadataMime(item, path);
      if (!contentType || contentType === "image/svg+xml" || contentType === "image/webp") {
        unchanged++;
        checkpoint(stateKey);
        continue;
      }

      try {
        const { data, error } = await supabase.storage.from(bucket).download(path);
        if (error || !data) throw new Error(error?.message ?? "download returned no data");
        const original = Buffer.from(await data.arrayBuffer());
        const result = await compressImage(original, contentType);

        if (!result.changed) {
          unchanged++;
          checkpoint(stateKey);
          continue;
        }

        const delta = original.length - result.buffer.length;
        if (!dryRun) {
          const { error: uploadError } = await supabase.storage.from(bucket).upload(path, result.buffer, {
            contentType: result.contentType,
            upsert: true,
          });
          if (uploadError) throw new Error(uploadError.message);
        }

        changed++;
        savedBytes += delta;
        checkpoint(stateKey);
        console.log(`${dryRun ? "  would-recompress" : "  recompressed"} ${bucket}/${path}: ${original.length} → ${result.buffer.length} bytes`);
      } catch (error) {
        failed++;
        console.error(`  FAILED ${bucket}/${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));

  console.log(`[${appEnv}] ${bucket}: changed=${changed}, unchanged=${unchanged}, failed=${failed}, saved=${savedBytes} bytes`);
  return { bucket, total: images.length, changed, unchanged, failed, savedBytes };
}

const results = [];
for (const bucket of buckets) {
  results.push(await processBucket(bucket));
}

const failed = results.reduce((sum, result) => sum + result.failed, 0);
if (failed > 0) process.exitCode = 1;