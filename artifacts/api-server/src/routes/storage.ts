import { Router, type IRouter, type Request, type Response } from "express";
import { Readable } from "stream";
import { extname } from "path";
import multer from "multer";
import {
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage.js";
import { ObjectPermission } from "../lib/objectAcl.js";
import { requireAdmin, requireClerkUser } from "../lib/requireAdmin.js";
import { logStorageEvent, getRequestIp, getActor } from "../lib/storageAuditLog.js";
import { createRateLimiter } from "../lib/userRateLimiter.js";
import { getSetting } from "../lib/appSecrets.js";

// ── C2 FIX: MIME allowlist for multipart server-side uploads (portal customers) ─
// Stricter than presigned (staff) allowlist — only images and PDF.
// Extension check is a second layer defense against spoofed MIME headers.
const MULTIPART_UPLOAD_ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "application/pdf",
]);

const MULTIPART_UPLOAD_ALLOWED_EXT = new Set([
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".pdf",
]);

// Allowed MIME types for presigned URL uploads (staff BizPortal).
// Excludes executables, scripts, and server-side code formats.
const PRESIGNED_ALLOWED_MIME_TYPES = new Set([
  // Images
  "image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif",
  "image/tiff", "image/bmp", "image/heic", "image/heif", "image/svg+xml",
  // Documents
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  // Text
  "text/plain", "text/csv",
  // Archives
  "application/zip", "application/x-zip-compressed",
]);

// Per-user rate limits — keyed by authenticated user ID (Clerk session)
// so they cannot be bypassed by rotating IPs or forging x-forwarded-for.
const uploadUrlLimiter = createRateLimiter({ windowMs: 60 * 60_000, limit: 50 }); // 50/hour
const uploadFileLimiter = createRateLimiter({ windowMs: 60 * 60_000, limit: 50 }); // 50/hour

function checkUploadUrlUserLimit(userId: string): boolean {
  return uploadUrlLimiter.check(userId);
}

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

/**
 * POST /storage/uploads/file
 *
 * Server-side file upload via multipart form.
 * Accepts a single file field named "file" and saves it to private object storage.
 * Sets ACL metadata recording the uploader as the owner so that the download
 * endpoint can enforce owner-based access without requiring admin rights.
 * Returns { objectPath, url } where url = /api/storage/objects/...
 */
router.post("/storage/uploads/file", upload.single("file"), async (req: Request, res: Response) => {
  if (!req.isAuthenticated()) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  // Per-user upload rate limit: 50 file uploads per hour
  const userId = (req.user as { id: string }).id;
  if (!uploadFileLimiter.check(userId)) {
    res.status(429).json({ error: "Terlalu banyak upload file. Batas: 50/jam per akun." });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "No file uploaded" });
    return;
  }

  // ── C2 FIX: Server-side MIME + extension validation ──────────────────────────
  const mimeType = (req.file.mimetype ?? "").toLowerCase();
  if (!MULTIPART_UPLOAD_ALLOWED_MIME.has(mimeType)) {
    res.status(400).json({
      error: "Tipe file tidak diizinkan. Hanya JPEG, PNG, WebP, dan PDF yang diterima.",
      receivedMime: mimeType,
    });
    return;
  }
  const fileExt = extname(req.file.originalname ?? "").toLowerCase();
  if (!MULTIPART_UPLOAD_ALLOWED_EXT.has(fileExt)) {
    res.status(400).json({
      error: "Ekstensi file tidak diizinkan.",
      receivedExtension: fileExt,
    });
    return;
  }
  // ── C2 FIX: reject empty file ────────────────────────────────────────────────
  if (req.file.size === 0) {
    res.status(400).json({ error: "File kosong tidak diizinkan." });
    return;
  }
  // ── C2 FIX: magic-byte signature checks ──────────────────────────────────────
  // JPEG: FF D8 FF
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") {
    if (req.file.buffer[0] !== 0xFF || req.file.buffer[1] !== 0xD8 || req.file.buffer[2] !== 0xFF) {
      res.status(400).json({ error: "File tidak valid: magic byte tidak sesuai JPEG." });
      return;
    }
  }
  // PNG: 89 50 4E 47
  if (mimeType === "image/png") {
    if (req.file.buffer[0] !== 0x89 || req.file.buffer[1] !== 0x50 || req.file.buffer[2] !== 0x4E || req.file.buffer[3] !== 0x47) {
      res.status(400).json({ error: "File tidak valid: magic byte tidak sesuai PNG." });
      return;
    }
  }
  // WebP: RIFF (52 49 46 46) at [0..3] + WEBP (57 45 42 50) at [8..11]
  if (mimeType === "image/webp") {
    if (
      req.file.buffer[0] !== 0x52 || req.file.buffer[1] !== 0x49 || req.file.buffer[2] !== 0x46 || req.file.buffer[3] !== 0x46 ||
      req.file.buffer[8] !== 0x57 || req.file.buffer[9] !== 0x45 || req.file.buffer[10] !== 0x42 || req.file.buffer[11] !== 0x50
    ) {
      res.status(400).json({ error: "File tidak valid: magic byte tidak sesuai WebP." });
      return;
    }
  }
  // PDF: %PDF (25 50 44 46)
  if (mimeType === "application/pdf") {
    if (req.file.buffer[0] !== 0x25 || req.file.buffer[1] !== 0x50 || req.file.buffer[2] !== 0x44 || req.file.buffer[3] !== 0x46) {
      res.status(400).json({ error: "File tidak valid: magic byte tidak sesuai PDF." });
      return;
    }
  }
  // ─────────────────────────────────────────────────────────────────────────────

  try {
    const objectPath = await objectStorageService.uploadPrivateEntity(req.file.buffer, req.file.mimetype);

    // Stamp ownership on the object immediately so downloads can enforce access
    // without falling back to admin-only.  Errors here are non-fatal: the upload
    // already succeeded, and the download endpoint falls back to requireAdmin.
    try {
      await objectStorageService.trySetObjectEntityAclPolicy(objectPath, {
        owner: req.user.id,
        visibility: "private",
      });
    } catch (aclErr) {
      req.log.warn({ err: aclErr }, "Could not set ACL on uploaded object; admin-only fallback applies");
    }

    const { actorId, actorType } = getActor(req);
    logStorageEvent({
      action: "upload",
      entityType: "presigned_upload",
      objectPath,
      fileName: req.file.originalname,
      contentType: req.file.mimetype,
      fileSizeBytes: req.file.size,
      actorId,
      actorType,
      ipAddress: getRequestIp(req),
      details: "server-side multipart upload",
    });

    res.json({ objectPath, url: `/api/storage${objectPath}` });
  } catch (error) {
    req.log.error({ err: error }, "Error uploading file");
    res.status(500).json({ error: "Failed to upload file" });
  }
});

// ── Presigned upload guard ────────────────────────────────────────────────────
// When a presigned PUT URL is issued we record the expected objectPath and a
// hard size cap (100 MB for internal staff).  A background interval fires after
// the URL has expired and automatically deletes any object that exceeds the cap,
// without relying on the client to call a separate endpoint.
//
// Enforcement timeline:
//   t=0        : URL issued, session recorded with checkAfter = t + ttl + 60s
//   t=15m      : presigned URL expires (GCS rejects any PUT after this)
//   t=16m      : background interval may fire and check the object
//   t≤16m+5min : background interval fires; oversized object deleted if present
//
// This gives a worst-case enforcement window of ~21 minutes for internal staff.
// For portal customers (self-registered) the upload is server-proxied with multer
// so enforcement is immediate at the byte level.

const PRESIGNED_MAX_BYTES = 100 * 1024 * 1024; // 100 MB hard cap for staff uploads
const PRESIGNED_URL_TTL_SEC = 900;              // must match signObjectURL ttlSec

interface UploadGuardSession {
  objectPath: string;
  userId: string;
  checkAfter: number; // ms — check once URL has expired + 60s grace
}
const pendingUploadGuards = new Map<string, UploadGuardSession>();

// Runs every 5 minutes; only processes sessions whose checkAfter has elapsed.
const _uploadGuardInterval = setInterval(async () => {
  const now = Date.now();
  for (const [key, session] of [...pendingUploadGuards.entries()]) {
    if (now < session.checkAfter) continue;
    pendingUploadGuards.delete(key);
    try {
      const objectFile = await objectStorageService.getObjectEntityFile(session.objectPath) as any;
      const [metadata] = await objectFile.getMetadata();
      const sizeBytes = Number(metadata.size ?? 0);
      if (sizeBytes > PRESIGNED_MAX_BYTES) {
        await objectFile.delete();
        console.warn(
          `[upload-guard] Deleted oversized presigned upload: ${session.objectPath}` +
          ` (${(sizeBytes / 1024 / 1024).toFixed(1)} MB, user: ${session.userId})`,
        );
      }
    } catch {
      // Object not found (URL unused or already deleted) — no action needed.
    }
  }
}, 5 * 60 * 1000);
// Allow Node.js to exit even if interval is still pending (dev/test convenience).
if (typeof _uploadGuardInterval.unref === "function") _uploadGuardInterval.unref();

/**
 * POST /storage/uploads/request-url
 *
 * Request a presigned GCS URL for file upload.
 * Restricted to internal BizPortal staff (Clerk/session auth).
 *
 * Size enforcement: every issued URL is registered with the upload-guard
 * background job.  After the URL's TTL expires the guard automatically checks
 * the uploaded object's size and deletes it if it exceeds PRESIGNED_MAX_BYTES
 * (100 MB).  This is a server-side, non-optional enforcement that does not
 * depend on the client calling a separate validate endpoint.
 *
 * ACL metadata: cannot be set here because the GCS object does not yet exist.
 * The business route that ultimately saves objectPath is responsible for calling
 * trySetObjectEntityAclPolicy.  Until then the download endpoint applies
 * admin-only fallback.
 */
router.post("/storage/uploads/request-url", async (req: Request, res: Response) => {
  // Restrict to internal BizPortal staff only (Clerk/session auth).
  // Supabase bearer tokens (customer portal / mobile) are rejected here even
  // though authMiddleware resolves req.user for them, because req.isInternalSession
  // is false for bearer requests.
  if (!await requireClerkUser(req, res)) return;

  // Rate-limit by authenticated user ID — cannot be spoofed via headers.
  const userId = (req.user as { id: string }).id;
  if (!checkUploadUrlUserLimit(userId)) {
    res.status(429).json({ error: "Terlalu banyak permintaan upload. Coba lagi dalam 1 jam." });
    return;
  }

  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  try {
    const { name, size, contentType } = parsed.data;

    // MIME type whitelist — reject executable/script types before issuing a presigned URL.
    if (contentType && !PRESIGNED_ALLOWED_MIME_TYPES.has(contentType.toLowerCase())) {
      res.status(415).json({ error: `Tipe file tidak didukung: ${contentType}. Hanya dokumen, gambar, dan arsip yang diperbolehkan.` });
      return;
    }

    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);

    // Register size-guard session: background job will delete this object after
    // the presigned URL expires if its size exceeds PRESIGNED_MAX_BYTES.
    pendingUploadGuards.set(objectPath, {
      objectPath,
      userId,
      checkAfter: Date.now() + (PRESIGNED_URL_TTL_SEC + 60) * 1000,
    });

    const { actorId, actorType } = getActor(req);
    logStorageEvent({
      action: "upload_presigned_issued",
      entityType: "presigned_upload",
      objectPath,
      fileName: name,
      contentType,
      fileSizeBytes: size ?? null,
      actorId,
      actorType,
      ipAddress: getRequestIp(req),
      details: "presigned PUT URL issued",
    });

    res.json(
      RequestUploadUrlResponse.parse({
        uploadURL,
        objectPath,
        metadata: { name, size, contentType },
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Error generating upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

/**
 * GET /storage/public-objects/*
 *
 * Serve public assets from PUBLIC_OBJECT_SEARCH_PATHS.
 * Unconditionally public — no auth checks.
 */
router.get("/storage/public-objects/{*filePath}", async (req: Request, res: Response) => {
  try {
    const rawParam = req.params.filePath as unknown;
    const requestedPath = Array.isArray(rawParam) ? rawParam.join("/") : String(rawParam);
    const filePath = requestedPath.replace(/^\/+/, "");
    if (
      filePath.split("/").some((segment) => !segment || segment === "." || segment === "..") ||
      filePath.includes("\\") ||
      filePath.includes("\0")
    ) {
      res.status(400).json({ error: "Invalid public object path" });
      return;
    }

    // All historical portal image URLs resolve to the one canonical storage
    // prefix. Redirect rather than maintaining duplicate storage trees.
    const legacyImagePath = filePath.startsWith("portal/images/")
      ? filePath.slice("portal/images/".length)
      : filePath.startsWith("images/")
        ? filePath.slice("images/".length)
        : null;
    if (legacyImagePath !== null) {
      const canonical = `portal-assets/static/customer-portal/images/${legacyImagePath}`;
      const encoded = canonical.split("/").map(encodeURIComponent).join("/");
      return res.redirect(308, `${req.baseUrl}/storage/public-objects/${encoded}`);
    }

    const file = await objectStorageService.searchPublicObject(filePath);
    if (!file) {
      if (filePath.startsWith("portal-assets/static/customer-portal/")) {
        console.warn("[storage] Customer Portal static asset not found", {
          environment: process.env.APP_ENV ?? "unknown",
          bucket: "public-assets",
          objectKey: filePath,
        });
      }
      // Fallback: try redirecting to PROD Supabase CDN so that content uploaded
      // before this environment was set up (pointing to the prod bucket) still works.
      try {
        const prodUrl = await getSetting("supabase_url", "");
        if (prodUrl) {
          const normalized = filePath.replace(/^\/+/, "");
          const cdnUrl = `${prodUrl.replace(/\/+$/, "")}/storage/v1/object/public/public-assets/${normalized}`;
          // Verify the file actually exists on PROD before redirecting (HEAD request)
          const check = await fetch(cdnUrl, { method: "HEAD" });
          if (check.ok) {
            res.redirect(302, cdnUrl);
            return;
          }
        }
      } catch {
        // PROD fallback failed — fall through to 404
      }
      res.status(404).json({ error: "File not found" });
      return;
    }

    const response = await objectStorageService.downloadObject(file) as any;
    res.status(response.status);
    response.headers.forEach((value: string, key: string) => res.setHeader(key, value));
    // Cache public assets in browser for 24 hours, CDN for 1 hour
    res.setHeader("Cache-Control", "public, max-age=86400, s-maxage=3600");

    if (response.body) {
      const nodeStream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    req.log.error({ err: error }, "Error serving public object");
    res.status(500).json({ error: "Failed to serve public object" });
  }
});

/**
 * GET /storage/objects/*
 *
 * Serve private object entities from PRIVATE_OBJECT_DIR.
 *
 * Authorization (two layers, evaluated in order):
 *
 * 1. Authentication gate — unauthenticated callers always receive 401.
 *    Private objects must never be downloadable without a valid session,
 *    regardless of whether the caller knows the path.
 *
 * 2. Owner / ACL / admin check —
 *    a) canAccessObjectEntity() is called first.  If the requesting user is
 *       the recorded owner of the object (set via ACL metadata at upload time)
 *       or is covered by an explicit ACL rule, access is granted immediately.
 *    b) If canAccessObjectEntity() returns false — either because the object
 *       has ACL metadata that does not cover this user, or because the object
 *       has no ACL metadata at all (legacy or presigned-URL uploads) — the
 *       caller must have admin role.  requireAdmin() handles the 403.  This
 *       ensures authorized admin/staff users are never locked out of
 *       business-critical documents regardless of who originally uploaded them.
 */
router.get("/storage/objects/{*path}", async (req: Request, res: Response) => {
  // Layer 1: authentication gate — unauthenticated callers always receive 401.
  if (!(await requireClerkUser(req, res))) return;

  try {
    const rawParam = req.params.path as unknown;
    const wildcardPath = Array.isArray(rawParam) ? rawParam.join("/") : String(rawParam);

    // Reject path traversal attempts before they reach the storage layer.
    if (wildcardPath.split("/").some((segment) => segment === ".." || segment === ".")) {
      res.status(400).json({ error: "Invalid object path" });
      return;
    }

    const objectPath = `/objects/${wildcardPath}`;
    const objectFile = await objectStorageService.getObjectEntityFile(objectPath);

    // Layer 2: ownership / ACL check — confirm the authenticated user is
    // permitted to read this specific object.
    // canAccessObjectEntity() returns false both when ACL metadata is absent
    // (legacy / presigned-URL objects) and when metadata exists but does not
    // cover the requesting user.  In either case fall back to admin override so
    // that authorized staff are never locked out of business-critical documents.
    const userId = req.user?.id;
    const aclAllowed = await objectStorageService.canAccessObjectEntity({
      userId,
      objectFile,
      requestedPermission: ObjectPermission.READ,
    });

    if (!aclAllowed) {
      // Not the ACL-designated owner — require admin role.
      // requireAdmin() sends its own 403 and returns false if denied.
      if (!(await requireAdmin(req, res))) return;
    }

    const response = await objectStorageService.downloadObject(objectFile) as any;
    res.status(response.status);
    response.headers.forEach((value: string, key: string) => res.setHeader(key, value));

    if ((response as any).body) {
      const nodeStream = Readable.fromWeb((response as any).body as ReadableStream<Uint8Array>);
      nodeStream.pipe(res);
    } else {
      res.end();
    }
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      req.log.warn({ err: error }, "Object not found");
      res.status(404).json({ error: "Object not found" });
      return;
    }
    req.log.error({ err: error }, "Error serving object");
    res.status(500).json({ error: "Failed to serve object" });
  }
});

export default router;
