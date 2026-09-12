/**
 * Compress existing raster images in Supabase Storage without changing paths.
 *
 * Safe default is a dry run:
 *   APP_ENV=production node load-secrets.mjs node scripts/compress-supabase-images.mjs
 *
 * Apply only after reviewing the dry-run summary:
 *   APP_ENV=production node load-secrets.mjs node scripts/compress-supabase-images.mjs --apply
 *
 * The script:
 *   - scans public-assets and private-uploads recursively;
 *   - preserves object paths and raster formats;
 *   - uploads only when the compressed result is smaller;
 *   - skips SVG, GIF, and unsupported formats;
 *   - never deletes an object.
 *
 * When Storage list metadata is unavailable, use verified manifests:
 *   ...compress-supabase-images.mjs --manifest docs/static-assets-manifest.json,docs/customer-portal-static-assets.json --manifest-only
 */

import sharp from "sharp";

const BUCKETS = ["public-assets", "private-uploads"];
const PAGE_SIZE = 1000;
const APPLY = process.argv.includes("--apply");
const MANIFEST_ONLY = process.argv.includes("--manifest-only");
const requestedBucket = getOption("--bucket");
const manifestArgument = getOption("--manifest");
const selectedBuckets = requestedBucket
  ? BUCKETS.filter((bucket) => bucket === requestedBucket)
  : BUCKETS;

if (requestedBucket && selectedBuckets.length === 0) {
  throw new Error(`Unknown bucket "${requestedBucket}". Use public-assets or private-uploads.`);
}

function getOption(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function normalizeUrl(raw) {
  return raw.replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
}

const url = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
}

const baseUrl = normalizeUrl(url);
const authHeaders = { Authorization: `Bearer ${key}`, apikey: key };

function objectUrl(bucket, path = "") {
  const encodedPath = path.split("/").map((part) => encodeURIComponent(part)).join("/");
  return `${baseUrl}/storage/v1/object/${encodeURIComponent(bucket)}${encodedPath ? `/${encodedPath}` : ""}`;
}

function publicObjectUrl(bucket, path, cacheBust = false) {
  const encodedPath = path.split("/").map((part) => encodeURIComponent(part)).join("/");
  const suffix = cacheBust ? `?compressRun=${Date.now()}` : "";
  return `${baseUrl}/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodedPath}${suffix}`;
}

function mimeFromPath(path) {
  const ext = path.split(".").pop()?.toLowerCase();
  return {
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    png: "image/png",
    webp: "image/webp",
    gif: "image/gif",
    svg: "image/svg+xml",
    bmp: "image/bmp",
    tiff: "image/tiff",
    tif: "image/tiff",
    heic: "image/heic",
    heif: "image/heif",
  }[ext] ?? "application/octet-stream";
}

function metadataMime(file, path) {
  const metadata = file.metadata ?? {};
  return String(
    metadata.mimetype ?? metadata.contentType ?? metadata["content-type"] ?? mimeFromPath(path),
  ).toLowerCase();
}

function isSupportedRaster(mime) {
  return new Set(["image/jpeg", "image/jpg", "image/png", "image/webp", "image/tiff"]).has(mime);
}

async function loadManifestObjects() {
  if (!manifestArgument) return new Map();
  const byBucket = new Map();
  for (const manifestPath of manifestArgument.split(",").map((value) => value.trim()).filter(Boolean)) {
    const manifest = JSON.parse(await (await import("node:fs/promises")).readFile(manifestPath, "utf8"));
    const bucket = manifest.bucket ?? "public-assets";
    const assets = Array.isArray(manifest.assets) ? manifest.assets : [];
    const entries = byBucket.get(bucket) ?? new Map();
    for (const asset of assets) {
      if (typeof asset.storagePath !== "string" || !asset.storagePath) continue;
      entries.set(asset.storagePath, {
        path: asset.storagePath,
        file: { metadata: { mimetype: asset.contentType ?? mimeFromPath(asset.storagePath) } },
      });
    }
    byBucket.set(bucket, entries);
  }
  return new Map([...byBucket].map(([bucket, entries]) => [bucket, [...entries.values()]]));
}

async function listObjects(bucket, prefix = "") {
  const objects = [];
  let offset = 0;

  while (true) {
    const response = await fetch(`${baseUrl}/storage/v1/object/list/${encodeURIComponent(bucket)}`, {
      method: "POST",
      headers: { ...authHeaders, "Content-Type": "application/json" },
      body: JSON.stringify({
        prefix,
        limit: PAGE_SIZE,
        offset,
        sortBy: { column: "name", order: "asc" },
      }),
    });
    if (!response.ok) {
      throw new Error(`List failed [${bucket}/${prefix}]: HTTP ${response.status} ${await response.text()}`);
    }
    const entries = await response.json();
    if (entries.length === 0) break;

    for (const entry of entries) {
      const childPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      // Supabase folders have no id; files have an id (including zero-like ids).
      if (entry.id) {
        objects.push({ path: childPath, file: entry });
      } else {
        objects.push(...await listObjects(bucket, childPath));
      }
    }

    if (entries.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return objects;
}

async function compressPreservingFormat(buffer, mime) {
  const image = sharp(buffer, { failOn: "none" }).rotate();
  const meta = await image.metadata();
  const resized = meta.width && meta.width > 1600
    ? image.resize({ width: 1600, withoutEnlargement: true })
    : image;

  if (mime === "image/jpeg" || mime === "image/jpg") {
    return { buffer: await resized.jpeg({ quality: 80, mozjpeg: true }).toBuffer(), contentType: "image/jpeg" };
  }
  if (mime === "image/png") {
    return { buffer: await resized.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer(), contentType: "image/png" };
  }
  if (mime === "image/webp") {
    return { buffer: await resized.webp({ quality: 80, effort: 4, smartSubsample: true }).toBuffer(), contentType: "image/webp" };
  }
  if (mime === "image/tiff") {
    return { buffer: await resized.tiff({ compression: "jpeg", quality: 80 }).toBuffer(), contentType: "image/tiff" };
  }
  return { buffer, contentType: mime };
}

const summary = {
  mode: APPLY ? "apply" : "dry-run",
  scanned: 0,
  candidates: 0,
  changed: 0,
  skipped: 0,
  unchanged: 0,
  missing: 0,
  bytesBefore: 0,
  bytesAfter: 0,
  errors: 0,
};

const manifestObjects = await loadManifestObjects();
console.log(`[compress] mode=${summary.mode}; buckets=${selectedBuckets.join(",")}`);

for (const bucket of selectedBuckets) {
  const objects = manifestObjects.has(bucket)
    ? manifestObjects.get(bucket)
    : MANIFEST_ONLY
      ? []
      : await listObjects(bucket);
  console.log(`[compress] ${bucket}: ${objects.length} objects found`);

  for (const { path, file } of objects) {
    summary.scanned++;
    const mime = metadataMime(file, path);
    if (!isSupportedRaster(mime)) {
      summary.skipped++;
      continue;
    }

    summary.candidates++;
    try {
      const downloadResponse = await fetch(
        bucket === "public-assets" ? publicObjectUrl(bucket, path) : objectUrl(bucket, path),
        bucket === "public-assets" ? undefined : { headers: authHeaders },
      );
      if (!downloadResponse.ok) {
        const errorBody = await downloadResponse.text();
        if (downloadResponse.status === 400 && errorBody.includes("NoSuchKey")) {
          summary.missing++;
          continue;
        }
        throw new Error(`download failed: HTTP ${downloadResponse.status} ${errorBody}`);
      }
      const original = Buffer.from(await downloadResponse.arrayBuffer());
      const prepared = await compressPreservingFormat(original, mime);
      summary.bytesBefore += original.length;

      if (prepared.buffer.length >= original.length) {
        summary.unchanged++;
        summary.bytesAfter += original.length;
        continue;
      }

      summary.bytesAfter += prepared.buffer.length;
      summary.changed++;
      const saved = original.length - prepared.buffer.length;
      console.log(`  ${bucket}/${path}: ${(original.length / 1024).toFixed(1)} KiB → ${(prepared.buffer.length / 1024).toFixed(1)} KiB (-${(saved / 1024).toFixed(1)} KiB)`);

      if (APPLY) {
        const uploadResponse = await fetch(objectUrl(bucket, path), {
          method: "POST",
          headers: {
            ...authHeaders,
            "Content-Type": prepared.contentType,
            "x-upsert": "true",
          },
          body: prepared.buffer,
        });
        if (!uploadResponse.ok) {
          throw new Error(`upload failed: HTTP ${uploadResponse.status} ${await uploadResponse.text()}`);
        }

        const verificationResponse = await fetch(publicObjectUrl(bucket, path, true), {
          headers: { "Cache-Control": "no-cache" },
        });
        if (!verificationResponse.ok) {
          throw new Error(`post-upload verification failed: HTTP ${verificationResponse.status}`);
        }
        const verified = Buffer.from(await verificationResponse.arrayBuffer());
        if (verified.length !== prepared.buffer.length) {
          throw new Error(
            `post-upload size mismatch: expected ${prepared.buffer.length}, got ${verified.length}`,
          );
        }
      }
    } catch (error) {
      summary.errors++;
      console.error(`  ERROR ${bucket}/${path}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

const savedBytes = summary.bytesBefore - summary.bytesAfter;
console.log(JSON.stringify({
  ...summary,
  savedBytes,
  savedPercent: summary.bytesBefore ? Number((savedBytes / summary.bytesBefore * 100).toFixed(2)) : 0,
}, null, 2));

if (summary.errors > 0) process.exitCode = 1;