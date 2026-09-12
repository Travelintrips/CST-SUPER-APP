import multer, { FileFilterCallback } from "multer";
import type { Request } from "express";
import path from "node:path";

export const DOCUMENT_ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  // KEPUTUSAN #13 (Phase 2D) — izinkan ZIP untuk attachment vendor quote
  "application/zip",
  "application/x-zip-compressed",
]);

export const IMAGE_ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export const IMAGE_OR_PDF_ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const BLOCKED_MIME = new Set([
  "text/html",
  "image/svg+xml",
  "application/javascript",
  "text/javascript",
  "application/x-msdownload",
  "application/x-sh",
  "application/x-shellscript",
  "application/x-bat",
  "application/x-msdos-program",
]);

const BLOCKED_EXTENSIONS = new Set([
  ".exe", ".bat", ".cmd", ".sh", ".php", ".html", ".htm",
  ".js", ".mjs", ".cjs", ".ts", ".py", ".rb", ".pl",
  ".svg", ".xml", ".aspx", ".jsp",
]);

export function makeFileFilter(
  allowedMime: Set<string>,
  opts: { allowOctetStream?: boolean } = {},
): (req: Request, file: Express.Multer.File, cb: FileFilterCallback) => void {
  return (_req, file, cb) => {
    const mime = (file.mimetype ?? "").toLowerCase().trim();
    const ext = path.extname(file.originalname ?? "").toLowerCase();

    if (BLOCKED_MIME.has(mime)) {
      return cb(new Error(`Tipe file tidak diizinkan: ${mime}`));
    }
    if (BLOCKED_EXTENSIONS.has(ext)) {
      return cb(new Error(`Ekstensi file tidak diizinkan: ${ext}`));
    }
    if (mime === "application/octet-stream" && !opts.allowOctetStream) {
      return cb(new Error("Tipe file tidak diizinkan: application/octet-stream"));
    }
    if (!allowedMime.has(mime)) {
      return cb(new Error(`Tipe file tidak didukung: ${mime}`));
    }
    cb(null, true);
  };
}

export function sanitizeFilename(original: string): string {
  return path
    .basename(original)
    .replace(/[^\w.\-]/g, "_")
    .replace(/\.{2,}/g, "_")
    .slice(0, 200);
}

export const documentUpload = (maxSizeMb = 10) =>
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxSizeMb * 1024 * 1024 },
    fileFilter: makeFileFilter(DOCUMENT_ALLOWED_MIME),
  });

export const imageUpload = (maxSizeMb = 10) =>
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxSizeMb * 1024 * 1024 },
    fileFilter: makeFileFilter(IMAGE_ALLOWED_MIME),
  });

export const imagePdfUpload = (maxSizeMb = 20) =>
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxSizeMb * 1024 * 1024 },
    fileFilter: makeFileFilter(IMAGE_OR_PDF_ALLOWED_MIME),
  });

const MEDIA_BROAD_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "video/mp4",
  "video/quicktime",
  "video/webm",
  "video/x-msvideo",
  "video/mpeg",
]);

export const mediaUpload = (maxSizeMb = 50) =>
  multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxSizeMb * 1024 * 1024 },
    fileFilter: makeFileFilter(MEDIA_BROAD_MIME),
  });
