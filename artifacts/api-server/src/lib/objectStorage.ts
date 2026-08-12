import { createClient } from "@supabase/supabase-js";
import { isSafeDevTestMode } from "./safeDev.js";
import WebSocket from "ws";
import { Readable } from "stream";
import { randomUUID } from "crypto";
import {
  ObjectAclPolicy,
  ObjectPermission,
  SupabaseFileHandle,
  canAccessObject,
} from "./objectAcl.js";

// ── Supabase Storage client ───────────────────────────────────────────────────
function normalizeSupabaseUrl(raw: string): string {
  if (!raw) return "";
  if (raw.startsWith("https://") || raw.startsWith("http://")) return raw;
  return `https://${raw}.supabase.co`;
}

const PUBLIC_BUCKET = "public-assets";
const PRIVATE_BUCKET = "private-uploads";

let _supabase: ReturnType<typeof createClient> | null = null;
function resolveStorageConfig(): { url: string; key: string } {
  const appEnv = process.env.APP_ENV;
  if (appEnv !== "development" && appEnv !== "production") {
    throw new Error(
      `Storage environment is ambiguous (APP_ENV="${appEnv ?? ""}"). ` +
      "Set APP_ENV=development or APP_ENV=production before using Supabase Storage.",
    );
  }

  // Development explicitly prefers the *_DEV pair. The secret loader also
  // exposes the development pair under canonical names for application code,
  // but never let a production process fall back to a DEV credential.
  const url = appEnv === "development"
    ? (process.env.SUPABASE_URL_DEV ?? process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "")
    : (process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "");
  const key = appEnv === "development"
    ? (process.env.SUPABASE_SERVICE_ROLE_KEY_DEV ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "")
    : (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "");

  if (!url || !key) {
    throw new Error(
      `Supabase Storage is not configured for APP_ENV=${appEnv}. ` +
      "Required environment-specific URL and service-role key are missing.",
    );
  }
  return { url: normalizeSupabaseUrl(url), key };
}

function getSupabase() {
  if (!_supabase) {
    const { url, key } = resolveStorageConfig();
    _supabase = createClient(url, key, {
      auth: { autoRefreshToken: false, persistSession: false },
      realtime: { transport: WebSocket as unknown as typeof globalThis.WebSocket },
    });
  }
  return _supabase;
}

// ── ACL metadata store (in-memory, non-persistent) ───────────────────────────
// For private files, we track ownership in memory. In production the DB row
// already records who uploaded the file, so this is a best-effort guard.
const aclStore = new Map<string, ObjectAclPolicy>();

// ── Exports kept for backward compat with objectAcl.ts consumers ─────────────
// objectStorageClient is no longer a GCS Storage instance; export a dummy
// so any rare direct import doesn't crash at module load.
export const objectStorageClient = {} as never;

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function extFromMime(mime: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg", "image/jpg": "jpg", "image/png": "png",
    "image/webp": "webp", "image/gif": "gif", "image/heic": "heic",
    "image/heif": "heic", "image/tiff": "tiff", "image/bmp": "bmp",
    "application/pdf": "pdf",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "video/mp4": "mp4", "video/quicktime": "mov", "video/webm": "webm",
    "video/x-msvideo": "avi", "video/mpeg": "mpeg", "video/ogg": "ogv",
  };
  return map[mime.toLowerCase()] ?? "bin";
}

function sniffPublicContentType(buffer: Buffer): string | null {
  if (buffer.length >= 8 &&
      buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "image/png";
  }
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }
  if (buffer.length >= 6 && (buffer.subarray(0, 6).toString("ascii") === "GIF87a" ||
      buffer.subarray(0, 6).toString("ascii") === "GIF89a")) {
    return "image/gif";
  }
  if (buffer.length >= 12 && buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
      buffer.subarray(8, 12).toString("ascii") === "WEBP") {
    return "image/webp";
  }
  if (buffer.length >= 2 && buffer[0] === 0x42 && buffer[1] === 0x4d) return "image/bmp";
  if (buffer.length >= 4 &&
      ((buffer[0] === 0x49 && buffer[1] === 0x49 && buffer[2] === 0x2a && buffer[3] === 0x00) ||
       (buffer[0] === 0x4d && buffer[1] === 0x4d && buffer[2] === 0x00 && buffer[3] === 0x2a))) {
    return "image/tiff";
  }
  if (buffer.subarray(0, 5).toString("ascii") === "%PDF-") return "application/pdf";

  const text = buffer.subarray(0, 4096).toString("utf8").replace(/^\uFEFF/, "").trimStart();
  if (/^(?:<\?xml[\s\S]*?)?<svg\b/i.test(text)) return "image/svg+xml";
  return null;
}

const SAFE_PUBLIC_METADATA_TYPES = new Set([
  "image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif",
  "image/tiff", "image/bmp", "image/heic", "image/heif", "image/svg+xml",
  "application/pdf",
]);

async function supabaseUpload(
  bucket: string,
  path: string,
  buffer: Buffer,
  contentType: string,
): Promise<void> {
  // E2E / SAFE_DEV guard: skip real storage upload in test modes
  if (isSafeDevTestMode() || process.env.E2E_TEST_MODE === "true") {
    return; // storage is test-only; no real write performed
  }
  const sb = getSupabase();
  const { error } = await sb.storage.from(bucket).upload(path, buffer, {
    contentType,
    upsert: true,
  });
  if (error) throw new Error(`Supabase upload error [${bucket}/${path}]: ${error.message}`);
}

async function supabaseDownload(bucket: string, path: string): Promise<Buffer> {
  const sb = getSupabase();
  const { data, error } = await sb.storage.from(bucket).download(path);
  if (error || !data) throw new ObjectNotFoundError();
  return Buffer.from(await data.arrayBuffer());
}

async function supabaseExists(bucket: string, path: string): Promise<boolean> {
  const sb = getSupabase();
  const dir = path.includes("/") ? path.substring(0, path.lastIndexOf("/")) : "";
  const filename = path.includes("/") ? path.substring(path.lastIndexOf("/") + 1) : path;
  const { data } = await sb.storage.from(bucket).list(dir, { search: filename });
  return !!data && data.some((f) => f.name === filename);
}

async function supabaseDelete(bucket: string, path: string): Promise<void> {
  const sb = getSupabase();
  await sb.storage.from(bucket).remove([path]);
}

// ── ObjectStorageService ──────────────────────────────────────────────────────
export class ObjectStorageService {
  // ── Public path helpers (kept for backward compat) ──────────────────────────
  getPublicObjectSearchPaths(): Array<string> {
    return [`/${PUBLIC_BUCKET}`];
  }

  getPrivateObjectDir(): string {
    return `/${PRIVATE_BUCKET}`;
  }

  // ── Public object search/download ────────────────────────────────────────────
  async searchPublicObject(filePath: string): Promise<SupabaseFileHandle | null> {
    const cleaned = filePath.replace(/^\/+/, "");
    const dir = cleaned.includes("/") ? cleaned.substring(0, cleaned.lastIndexOf("/")) : "";
    const filename = cleaned.includes("/") ? cleaned.substring(cleaned.lastIndexOf("/") + 1) : cleaned;
    const { data } = await getSupabase().storage.from(PUBLIC_BUCKET).list(dir, { search: filename });
    const match = data?.find((file) => file.name === filename);
    if (!match) return null;

    const metadata = (match.metadata ?? {}) as Record<string, unknown>;
    const contentType = metadata["mimetype"] ?? metadata["contentType"] ?? metadata["content-type"];
    return {
      bucket: PUBLIC_BUCKET,
      path: cleaned,
      metadata: typeof contentType === "string" ? { contentType } : undefined,
    };
  }

  async downloadObject(file: SupabaseFileHandle, _cacheTtlSec: number = 3600): Promise<{ arrayBuffer(): Promise<ArrayBuffer> }> {
    const buffer = await supabaseDownload(file.bucket, file.path);
    const ext = file.path.split(".").pop()?.toLowerCase() ?? "";
    const mimeMap: Record<string, string> = {
      jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp",
      gif: "image/gif", pdf: "application/pdf", heic: "image/heic",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xls: "application/vnd.ms-excel",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
      avi: "video/x-msvideo", mpeg: "video/mpeg", ogv: "video/ogg",
    };
    const metadataType = file.metadata?.contentType?.toLowerCase();
    const contentType =
      sniffPublicContentType(buffer) ??
      (metadataType && SAFE_PUBLIC_METADATA_TYPES.has(metadataType) ? metadataType : null) ??
      mimeMap[ext] ??
      "application/octet-stream";
    const webStream = Readable.toWeb(Readable.from(buffer)) as ReadableStream;
    return new Response(webStream, {
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(buffer.length),
        "Cache-Control": `public, max-age=${_cacheTtlSec}`,
      },
    });
  }

  // ── Presigned upload URL — fail-closed if storage not configured ─────────────
  // Previously returned a fake placeholder URL which could be persisted to DB.
  // Now throws explicitly so callers cannot silently proceed with a phantom path.
  async getObjectEntityUploadURL(): Promise<string> {
    // Validate that Supabase storage is reachable before issuing a path
    getSupabase(); // throws if SUPABASE_URL / SUPABASE_KEY missing
    const objectId = randomUUID();
    // Return a server-internal path (not a public URL) — actual bytes arrive via
    // the server-proxied upload endpoint, not a presigned URL.
    return `/objects/uploads/${objectId}`;
  }

  // ── Normalize object path from presigned URL ─────────────────────────────────
  normalizeObjectEntityPath(rawPath: string): string {
    if (rawPath.startsWith("https://storage.placeholder/")) {
      // Legacy paths that were stored before fail-closed was enforced.
      // Return as-is normalized; callers should treat these as broken references.
      return "/" + rawPath.replace("https://storage.placeholder/", "");
    }
    if (rawPath.startsWith("https://storage.googleapis.com/")) {
      const url = new URL(rawPath);
      const parts = url.pathname.split("/");
      const uploadsIdx = parts.indexOf("uploads");
      if (uploadsIdx >= 0) return `/objects/uploads/${parts.slice(uploadsIdx + 1).join("/")}`;
    }
    return rawPath;
  }

  // ── Private entity upload ────────────────────────────────────────────────────
  async uploadPrivateEntity(buffer: Buffer, contentType: string): Promise<string> {
    const objectId = randomUUID();
    const ext = extFromMime(contentType);
    const path = `uploads/${objectId}.${ext}`;
    await supabaseUpload(PRIVATE_BUCKET, path, buffer, contentType);
    return `/objects/uploads/${objectId}.${ext}`;
  }

  // ── Get private entity file handle ───────────────────────────────────────────
  async getObjectEntityFile(objectPath: string): Promise<SupabaseFileHandle> {
    if (!objectPath.startsWith("/objects/")) throw new ObjectNotFoundError();
    const entityId = objectPath.slice("/objects/".length);
    const exists = await supabaseExists(PRIVATE_BUCKET, entityId);
    if (!exists) throw new ObjectNotFoundError();
    const acl = aclStore.get(objectPath);
    return { bucket: PRIVATE_BUCKET, path: entityId, metadata: acl ? { acl_policy: JSON.stringify(acl) } : {} };
  }

  // ── ACL helpers ──────────────────────────────────────────────────────────────
  async trySetObjectEntityAclPolicy(rawPath: string, aclPolicy: ObjectAclPolicy): Promise<string> {
    const normalizedPath = this.normalizeObjectEntityPath(rawPath);
    if (normalizedPath.startsWith("/objects/")) {
      aclStore.set(normalizedPath, aclPolicy);
    }
    return normalizedPath;
  }

  async canAccessObjectEntity({
    userId,
    objectFile,
    requestedPermission,
  }: {
    userId?: string;
    objectFile: SupabaseFileHandle;
    requestedPermission?: ObjectPermission;
  }): Promise<boolean> {
    return canAccessObject({
      userId,
      objectFile,
      requestedPermission: requestedPermission ?? ObjectPermission.READ,
    });
  }

  // ── Public asset upload ──────────────────────────────────────────────────────
  async uploadPublicAsset(buffer: Buffer, objectKey: string, contentType: string): Promise<string> {
    const path = `portal-assets/${objectKey}`;
    await supabaseUpload(PUBLIC_BUCKET, path, buffer, contentType);
    return `/api/storage/public-objects/portal-assets/${objectKey}`;
  }

  // ── uploadPublicRaw: public bucket, arbitrary subPath ────────────────────────
  async uploadPublicRaw(subPath: string, buffer: Buffer, contentType: string): Promise<string> {
    await supabaseUpload(PUBLIC_BUCKET, subPath, buffer, contentType);
    return `/api/storage/public-objects/${subPath}`;
  }

  /**
   * Kembalikan URL langsung Supabase CDN untuk file di public bucket.
   * URL ini dapat diakses dari internet tanpa proxy API server — cocok untuk Fonnte/WA.
   * Format: ${SUPABASE_URL}/storage/v1/object/public/${PUBLIC_BUCKET}/${subPath}
   */
  toSupabasePublicUrl(subPath: string): string {
    const cleaned = subPath.replace(/^\/+/, "");
    const { url } = resolveStorageConfig();
    return `${url}/storage/v1/object/public/${PUBLIC_BUCKET}/${cleaned}`;
  }

  // ── Generic public upload ────────────────────────────────────────────────────
  async uploadFile(buffer: Buffer, storagePath: string, contentType: string): Promise<void> {
    const cleaned = storagePath.replace(/^\/+/, "");
    await supabaseUpload(PUBLIC_BUCKET, cleaned, buffer, contentType);
  }

  getPublicUrl(storagePath: string): string {
    const cleaned = storagePath.replace(/^\/+/, "");
    return `/api/storage/public-objects/${cleaned}`;
  }

  async uploadPublicFile(buffer: Buffer, storagePath: string, contentType: string): Promise<string> {
    await this.uploadFile(buffer, storagePath, contentType);
    return this.getPublicUrl(storagePath);
  }

  async uploadPublic(storagePath: string, buffer: Buffer, contentType: string): Promise<string> {
    await this.uploadFile(buffer, storagePath, contentType);
    return this.getPublicUrl(storagePath);
  }

  // ── Signed URL for private entity (5-min default) ───────────────────────────
  async getSignedUrl(privatePath: string, expiresInSec = 300): Promise<string> {
    const cleaned = privatePath.replace(/^\/objects\//, "");
    const sb = getSupabase();
    const { data, error } = await sb.storage.from(PRIVATE_BUCKET).createSignedUrl(cleaned, expiresInSec);
    if (error || !data?.signedUrl) {
      throw new Error(`Failed to create signed URL: ${error?.message ?? "unknown"}`);
    }
    return data.signedUrl;
  }

  // ── Delete helpers ───────────────────────────────────────────────────────────
  async tryDeletePrivateEntity(objectPath: string): Promise<void> {
    try {
      if (!objectPath.startsWith("/objects/")) return;
      const entityId = objectPath.slice("/objects/".length);
      await supabaseDelete(PRIVATE_BUCKET, entityId);
      aclStore.delete(objectPath);
    } catch { }
  }

  async tryDeletePublicFile(storagePath: string): Promise<void> {
    try {
      let resolved = storagePath;
      if (resolved.startsWith("/api/storage/public-objects/portal-assets/")) {
        resolved = resolved.replace("/api/storage/public-objects/portal-assets/", "");
        resolved = `portal-assets/${resolved}`;
      } else if (resolved.startsWith("/api/storage/public-objects/")) {
        resolved = resolved.replace("/api/storage/public-objects/", "");
      }
      await supabaseDelete(PUBLIC_BUCKET, resolved);
    } catch { }
  }
}
