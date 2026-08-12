#!/usr/bin/env node
/**
 * Customer Portal static-asset release contract.
 *
 * This file intentionally has no default write path:
 *   node .../customer-portal-assets.mjs manifest --write
 *   node .../customer-portal-assets.mjs verify --env development
 *   node .../customer-portal-assets.mjs promote --dry-run
 *   node .../customer-portal-assets.mjs promote --write --source development --destination production
 *
 * CMS uploads are not part of this manifest. They are verified separately from
 * portal_content references by the `verify` command.
 */

import { createClient } from "@supabase/supabase-js";
import WebSocket from "ws";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const BUCKET = "public-assets";
export const STORAGE_ROOT = "portal-assets/static/customer-portal";
export const PUBLIC_ROOT = `/api/storage/public-objects/${STORAGE_ROOT}`;
export const MANIFEST_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../docs/customer-portal-static-assets.json",
);
export const CUSTOMER_PORTAL_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../customer-portal",
);

const IMAGE_EXTENSIONS = /\.(?:png|jpe?g|webp|gif|svg)$/i;
const RASTER_EXTENSIONS = /\.(?:png|jpe?g)$/i;
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".html"]);
const MEDIA_KEY_PATTERN = /(?:^|[._-])(img|image|photo|favicon|banner|background|bg|logo)(?:[._\d-]|$)/i;

function normalizeSupabaseUrl(raw) {
  return String(raw ?? "").replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
}

export function normalizeStoragePath(rawPath) {
  let value = String(rawPath ?? "").trim().replace(/^\/+/, "");
  value = value.replace(/^api\/storage\/public-objects\/portal-assets\/static\/customer-portal\//, "");
  value = value.replace(/^portal-assets\/static\/customer-portal\//, "");
  value = value.replace(/^api\/storage\/public-objects\/portal\/images\//, "images/");
  value = value.replace(/^api\/storage\/public-objects\/images\//, "images/");
  value = value.replace(/^portal\/images\//, "images/");
  value = value.replace(/^images\//, "images/");
  if (!IMAGE_EXTENSIONS.test(value)) return null;
  return `${STORAGE_ROOT}/${value.replace(RASTER_EXTENSIONS, ".webp")}`;
}

function expectedMime(storagePath) {
  if (storagePath.endsWith(".svg")) return "image/svg+xml";
  if (storagePath.endsWith(".gif")) return "image/gif";
  return "image/webp";
}

function publicPath(storagePath) {
  return `/api/storage/public-objects/${storagePath}`;
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) files.push(absolute);
  }
  return files;
}

function addCandidate(candidates, rawPath, sourceFile) {
  const storagePath = normalizeStoragePath(rawPath);
  if (!storagePath) return;
  const current = candidates.get(storagePath) ?? new Set();
  current.add(path.relative(CUSTOMER_PORTAL_ROOT, sourceFile).split(path.sep).join("/"));
  candidates.set(storagePath, current);
}

function collectSourceCandidates(text, sourceFile, candidates) {
  const canonical = /\/api\/storage\/public-objects\/((?:portal-assets\/static\/customer-portal|portal\/images|images)\/[^"'`\s)}`]+?\.(?:png|jpe?g|webp|gif|svg))/gi;
  for (const match of text.matchAll(canonical)) addCandidate(candidates, match[1], sourceFile);

  // These helpers construct canonical URLs from a path argument.
  const helperCall = /((?:staticAsset|LOCAL|SVCIMG|image))\(\s*["'`]([^"'`]+\.(?:png|jpe?g|webp|gif|svg))["'`]\s*\)/gi;
  for (const match of text.matchAll(helperCall)) {
    const helper = match[1].toLowerCase();
    const rawPath = helper === "svcimg"
      ? `images/services/${match[2]}`
      : helper === "staticasset"
        ? match[2]
        : `images/${match[2]}`;
    addCandidate(candidates, rawPath, sourceFile);
  }

  // Vehicle photos use a directory constant followed by a filename.
  const vehiclePath = /\$\{_SBV\}\/([^`"' ]+\.(?:png|jpe?g|webp|gif|svg))/gi;
  for (const match of text.matchAll(vehiclePath)) addCandidate(candidates, `images/vehicles/${match[1]}`, sourceFile);
}

export async function discoverManifest() {
  const candidates = new Map();
  const files = await walk(CUSTOMER_PORTAL_ROOT);
  for (const sourceFile of files) {
    if (sourceFile.includes(`${path.sep}__tests__${path.sep}`)) continue;
    const text = await fs.readFile(sourceFile, "utf8");
    collectSourceCandidates(text, sourceFile, candidates);
  }

  const assets = [...candidates.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([storagePath, sources]) => ({
      storagePath,
      publicPath: publicPath(storagePath),
      contentType: expectedMime(storagePath),
      sourceFiles: [...sources].sort(),
    }));

  return {
    schemaVersion: 1,
    generatedFrom: [
      "artifacts/customer-portal/src",
      "artifacts/customer-portal/public",
      "artifacts/customer-portal/scripts",
    ],
    bucket: BUCKET,
    storageRoot: STORAGE_ROOT,
    generatedBy: "artifacts/api-server/scripts/customer-portal-assets.mjs",
    assets,
  };
}

export async function readManifest(manifestPath = MANIFEST_PATH) {
  const raw = JSON.parse(await fs.readFile(manifestPath, "utf8"));
  if (raw.bucket !== BUCKET || raw.storageRoot !== STORAGE_ROOT || !Array.isArray(raw.assets)) {
    throw new Error(`Invalid Customer Portal static asset manifest: ${manifestPath}`);
  }
  return raw;
}

export function resolveStorageCredentials(environment, env = process.env) {
  if (environment !== "development" && environment !== "production") {
    throw new Error(`Invalid storage environment "${environment}". Use development or production.`);
  }
  const url = environment === "development"
    ? (env.SUPABASE_URL_DEV ?? env.SUPABASE_URL ?? env.VITE_SUPABASE_URL)
    : (env.SUPABASE_URL ?? env.VITE_SUPABASE_URL);
  const key = environment === "development"
    ? (env.SUPABASE_SERVICE_ROLE_KEY_DEV ?? env.SUPABASE_SERVICE_ROLE_KEY)
    : env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      `Missing environment-specific Supabase Storage credentials for ${environment}. ` +
      "No credentials were printed or inferred from another environment.",
    );
  }
  return { url: normalizeSupabaseUrl(url), key };
}

function storageClient(environment, env = process.env) {
  const { url, key } = resolveStorageCredentials(environment, env);
  return {
    client: createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
      realtime: { transport: WebSocket },
    }),
    url,
  };
}

function bodyLooksLikeHtmlOrJson(body) {
  const head = body.subarray(0, 256).toString("utf8");
  return /^\s*(?:<!doctype html|<html\b|\{|\[)/i.test(head);
}

function sniffMime(body) {
  if (body.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (body.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) return "image/jpeg";
  if (body.subarray(0, 6).toString("ascii") === "GIF87a" || body.subarray(0, 6).toString("ascii") === "GIF89a") return "image/gif";
  if (body.subarray(0, 4).toString("ascii") === "RIFF" && body.subarray(8, 12).toString("ascii") === "WEBP") return "image/webp";
  if (/^(?:<\?xml[\s\S]*?)?<svg\b/i.test(body.subarray(0, 4096).toString("utf8").trimStart())) return "image/svg+xml";
  return null;
}

export async function verifyHttpAsset(url, expectedType, fetchImpl = fetch) {
  const response = await fetchImpl(url, { redirect: "manual" });
  const body = Buffer.from(await response.arrayBuffer());
  const contentType = (response.headers.get("content-type") ?? "").split(";")[0].toLowerCase();
  const ok = response.status === 200 &&
    (!expectedType || contentType === expectedType) &&
    contentType.startsWith("image/") &&
    body.length > 0 &&
    !bodyLooksLikeHtmlOrJson(body);
  return { ok, status: response.status, contentType, bytes: body.length, body };
}

export async function verifyStorageEnvironment(environment, manifest, env = process.env) {
  const { url } = storageClient(environment, env);
  const results = [];
  for (const asset of manifest.assets) {
    const result = await verifyHttpAsset(
      `${url}/storage/v1/object/public/${BUCKET}/${asset.storagePath}`,
      asset.contentType,
    );
    results.push({ environment, ...asset, ...result, body: undefined });
    const prefix = result.ok ? "PASS" : "FAIL";
    console.log(`${prefix} ${environment} ${result.status} ${result.contentType || "(missing MIME)"} ${result.bytes}B ${asset.storagePath}`);
  }
  const failures = results.filter((result) => !result.ok);
  if (failures.length) {
    throw new Error(
      `Missing or invalid production Customer Portal static assets: ${failures.map((f) => f.storagePath).join(", ")}`,
    );
  }
  return results;
}

function resolveCmsMediaUrl(raw, baseUrl) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const value = raw.trim();
  if (/^https?:\/\//i.test(value)) return value;
  const storagePath = normalizeStoragePath(value);
  if (storagePath) return new URL(publicPath(storagePath), baseUrl).toString();
  if (value.startsWith("/")) return new URL(value, baseUrl).toString();
  return null;
}

function isMediaValue(key, value) {
  return typeof value === "string" && Boolean(resolveCmsMediaUrl(value, "http://localhost")) &&
    (MEDIA_KEY_PATTERN.test(key) || /\.(?:png|jpe?g|webp|gif|svg)(?:$|\?)/i.test(value));
}

export async function verifyCmsReferences(baseUrl, fetchImpl = fetch) {
  const normalizedBase = baseUrl.replace(/\/+$/, "");
  const byLocale = {};
  for (const locale of ["id-ID", "en-US"]) {
    const response = await fetchImpl(`${normalizedBase}/api/portal/content?locale=${encodeURIComponent(locale)}`);
    if (!response.ok) throw new Error(`CMS content request failed for ${locale}: HTTP ${response.status}`);
    byLocale[locale] = await response.json();
  }

  const keys = new Set([...Object.keys(byLocale["id-ID"]), ...Object.keys(byLocale["en-US"])]);
  const checked = [];
  for (const key of keys) {
    for (const locale of ["id-ID", "en-US"]) {
      const value = byLocale[locale][key];
      if (!isMediaValue(key, value)) continue;
      const url = resolveCmsMediaUrl(value, normalizedBase);
      const result = await verifyHttpAsset(url, null, fetchImpl);
      checked.push({ key, locale, url, ...result, body: undefined });
      if (!result.ok || !result.contentType.startsWith("image/")) {
        console.error(`STALE STORAGE REFERENCE ${locale} ${key} → ${value}`);
        throw new Error(`STALE STORAGE REFERENCE: CMS ${locale}.${key} points to an invalid image`);
      }
      console.log(`PASS CMS ${locale}.${key} ${result.status} ${result.contentType} ${result.bytes}B`);
    }
  }
  return { byLocale, checked };
}

async function downloadObject(client, storagePath) {
  const { data, error } = await client.storage.from(BUCKET).download(storagePath);
  if (error || !data) return null;
  return Buffer.from(await data.arrayBuffer());
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export async function promoteStaticAssets({
  manifest,
  source = "development",
  destination = "production",
  write = false,
  env = process.env,
} = {}) {
  if (destination !== "production") throw new Error("Promotion destination must be production.");
  if (env.APP_ENV !== "production") {
    throw new Error(
      "Production promotion must run with APP_ENV=production. " +
      "This prevents a development secret bundle from being mistaken for production.",
    );
  }
  if (write && !process.env.CUSTOMER_PORTAL_ASSET_WRITE_ACK && !env.CUSTOMER_PORTAL_ASSET_WRITE_ACK) {
    throw new Error(
      "Production write blocked. Set CUSTOMER_PORTAL_ASSET_WRITE_ACK=I_UNDERSTAND and pass --write explicitly.",
    );
  }
  const sourceStorage = storageClient(source, env);
  const destinationStorage = storageClient(destination, env);
  const summary = { "would-copy": 0, "already-present": 0, "missing-source": 0, "invalid-mime": 0, copied: 0, failed: 0 };

  for (const asset of manifest.assets) {
    const sourceBody = await downloadObject(sourceStorage.client, asset.storagePath);
    if (!sourceBody || sourceBody.length === 0) {
      summary["missing-source"]++;
      console.log(`missing-source ${asset.storagePath}`);
      continue;
    }
    const sourceMime = sniffMime(sourceBody);
    if (sourceMime !== asset.contentType) {
      summary["invalid-mime"]++;
      console.log(`invalid-mime ${sourceMime ?? "(unknown)"} expected ${asset.contentType} ${asset.storagePath}`);
      continue;
    }

    const destinationBody = await downloadObject(destinationStorage.client, asset.storagePath);
    if (destinationBody && sha256(destinationBody) === sha256(sourceBody)) {
      summary["already-present"]++;
      console.log(`already-present ${asset.storagePath}`);
      continue;
    }

    summary["would-copy"]++;
    if (!write) {
      console.log(`would-copy ${asset.storagePath}`);
      continue;
    }
    const { error } = await destinationStorage.client.storage.from(BUCKET).upload(
      asset.storagePath,
      sourceBody,
      { contentType: asset.contentType, cacheControl: "31536000", upsert: true },
    );
    if (error) {
      summary.failed++;
      console.log(`failed ${asset.storagePath}: ${error.message}`);
      continue;
    }
    const verified = await downloadObject(destinationStorage.client, asset.storagePath);
    if (!verified || sha256(verified) !== sha256(sourceBody)) {
      summary.failed++;
      console.log(`failed-post-copy-verification ${asset.storagePath}`);
      continue;
    }
    summary.copied++;
    console.log(`copied ${asset.storagePath}`);
  }

  console.log(JSON.stringify({ mode: write ? "write" : "dry-run", source, destination, ...summary }, null, 2));
  if (summary.failed || summary["missing-source"] || summary["invalid-mime"]) {
    throw new Error("Customer Portal static asset promotion did not pass its source/integrity checks.");
  }
  return summary;
}

async function main() {
  const [command = "verify", ...args] = process.argv.slice(2);
  const arg = (name, fallback = undefined) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] ?? fallback : fallback;
  };
  const has = (name) => args.includes(name);

  if (command === "manifest") {
    const manifest = await discoverManifest();
    if (has("--write")) {
      await fs.mkdir(path.dirname(MANIFEST_PATH), { recursive: true });
      await fs.writeFile(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
      console.log(`Wrote ${MANIFEST_PATH} (${manifest.assets.length} assets).`);
    } else {
      console.log(JSON.stringify(manifest, null, 2));
    }
    return;
  }

  const manifest = await readManifest(arg("--manifest", MANIFEST_PATH));
  if (command === "verify") {
    const environment = arg("--env", process.env.APP_ENV);
    if (!environment) throw new Error("Verification requires --env development|production; no environment fallback.");
    if (environment !== "both" && process.env.APP_ENV !== environment) {
      throw new Error(
        `Verification environment mismatch: APP_ENV=${process.env.APP_ENV ?? "(missing)"} but --env=${environment}.`,
      );
    }
    if (environment === "both") {
      await verifyStorageEnvironment("development", manifest);
      await verifyStorageEnvironment("production", manifest);
    } else {
      await verifyStorageEnvironment(environment, manifest);
    }
    const baseUrl = arg("--base-url", process.env.CUSTOMER_PORTAL_BASE_URL);
    if (baseUrl) await verifyCmsReferences(baseUrl);
    else console.log("CMS reference verification skipped: CUSTOMER_PORTAL_BASE_URL/--base-url not set.");
    return;
  }

  if (command === "promote") {
    const write = has("--write");
    if (!write && !has("--dry-run")) console.log("No --write supplied; defaulting to --dry-run.");
    await promoteStaticAssets({
      manifest,
      source: arg("--source", "development"),
      destination: arg("--destination", "production"),
      write,
    });
    return;
  }

  throw new Error(`Unknown command "${command}". Use manifest, verify, or promote.`);
}

const isMain = process.argv[1]?.endsWith("customer-portal-assets.mjs");
if (isMain) {
  main().catch((error) => {
    console.error(`[customer-portal-assets] FAIL: ${error.message}`);
    process.exitCode = 1;
  });
}