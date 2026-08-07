import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";
import { promises as fs } from "node:fs";
import path from "node:path";

const workspaceRoot = path.resolve(process.cwd(), "../..");
const publicRoots = [
  path.join(workspaceRoot, "artifacts"),
];
const rasterExtensions = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const imageExtensions = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg"]);
const bucket = "public-assets";
const storagePrefix = "portal-assets/static";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}

function normalizeSupabaseUrl(raw) {
  return raw.replace(/\/rest\/v1\/?$/, "").replace(/\/+$/, "");
}

async function walk(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.name === "node_modules" || entry.name === "dist") continue;
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...await walk(absolute));
    else if (imageExtensions.has(path.extname(entry.name).toLowerCase())) files.push(absolute);
  }
  return files;
}

function contentType(ext) {
  if (ext === ".svg") return "image/svg+xml";
  if (ext === ".gif") return "image/gif";
  return "image/webp";
}

function storageName(relativePath) {
  const normalized = relativePath.split(path.sep).join("/");
  const ext = path.extname(normalized).toLowerCase();
  const withoutExt = normalized.slice(0, -ext.length);
  return `${storagePrefix}/${withoutExt}${rasterExtensions.has(ext) ? ".webp" : ext}`;
}

async function optimize(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const input = await fs.readFile(filePath);
  if (ext === ".svg") {
    // Keep vector assets vector; remove comments and redundant inter-tag whitespace.
    return Buffer.from(
      input.toString("utf8")
        .replace(/<!--[\s\S]*?-->/g, "")
        .replace(/>\s+</g, "><")
        .trim(),
    );
  }
  if (!rasterExtensions.has(ext)) return input;
  return sharp(input, { failOn: "none" })
    .rotate()
    .resize({ width: 2400, withoutEnlargement: true })
    .webp({ quality: 82, effort: 5, smartSubsample: true })
    .toBuffer();
}

const rawKey = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const rawUrl = requireEnv("SUPABASE_URL");
const supabase = createClient(normalizeSupabaseUrl(rawUrl), rawKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const artifactDirs = (await fs.readdir(path.join(workspaceRoot, "artifacts"), { withFileTypes: true }))
  .filter((entry) => entry.isDirectory() && entry.name !== "mockup-sandbox" && entry.name !== "cst-driver")
  .map((entry) => path.join(workspaceRoot, "artifacts", entry.name));

const files = [];
for (const artifactDir of artifactDirs) {
  const publicDir = path.join(artifactDir, "public");
  try {
    files.push(...await walk(publicDir));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

const manifest = [];
let totalBefore = 0;
let totalAfter = 0;
for (const filePath of files.sort()) {
  const artifactDir = artifactDirs.find((dir) => filePath.startsWith(`${dir}${path.sep}`));
  if (!artifactDir) throw new Error(`Cannot determine artifact for ${filePath}`);
  const artifactName = path.basename(artifactDir);
  const publicRoot = path.join(artifactDir, "public");
  const relativePath = path.relative(publicRoot, filePath).split(path.sep).join("/");
  const optimized = await optimize(filePath);
  const objectPath = storageName(`${artifactName}/${relativePath}`);
  const { error } = await supabase.storage.from(bucket).upload(objectPath, optimized, {
    contentType: contentType(path.extname(filePath).toLowerCase()),
    cacheControl: "31536000",
    upsert: true,
  });
  if (error) throw new Error(`Upload failed for ${filePath}: ${error.message}`);
  totalBefore += (await fs.stat(filePath)).size;
  totalAfter += optimized.length;
  manifest.push({
    artifact: artifactName,
    localPath: `/${relativePath}`,
    sourceFile: path.relative(workspaceRoot, filePath).split(path.sep).join("/"),
    storagePath: objectPath,
    publicPath: `/api/storage/public-objects/${objectPath}`,
    originalBytes: (await fs.stat(filePath)).size,
    optimizedBytes: optimized.length,
  });
}

const manifestPath = path.join(workspaceRoot, "docs/static-assets-manifest.json");
await fs.writeFile(manifestPath, `${JSON.stringify({
  generatedAt: new Date().toISOString(),
  bucket,
  totalFiles: manifest.length,
  totalOriginalBytes: totalBefore,
  totalOptimizedBytes: totalAfter,
  assets: manifest,
}, null, 2)}\n`);

console.log(JSON.stringify({
  uploaded: manifest.length,
  totalOriginalBytes: totalBefore,
  totalOptimizedBytes: totalAfter,
  savedBytes: totalBefore - totalAfter,
  manifest: path.relative(workspaceRoot, manifestPath),
}, null, 2));