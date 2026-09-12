/**
 * Reusable upload file validator.
 * Validates MIME type, file extension, size, AND magic-byte/content signature.
 * Always rejects executables, scripts, and HTML regardless of options.
 *
 * C2-REMEDIATION: magic-byte validation added.
 * `validateMagicBytes(buffer, declaredMime)` must be called AFTER multer stores the
 * file (req.file.buffer) to verify that actual content matches the declared MIME type.
 * The fileFilter in uploadMiddleware.ts runs at stream time and only checks metadata;
 * signature checking requires the full buffer.
 */

const ALWAYS_BLOCKED_MIME = new Set([
  "text/html",
  "application/javascript",
  "application/x-javascript",
  "text/javascript",
  "application/x-sh",
  "application/x-csh",
  "application/x-bat",
  "application/x-msdos-program",
  "application/x-msdownload",
  "application/x-executable",
  "application/x-elf",
  "application/vnd.microsoft.portable-executable",
  "application/x-php",
  "application/x-httpd-php",
  "text/x-php",
  "image/svg+xml",
]);

const ALWAYS_BLOCKED_EXT = new Set([
  "exe", "sh", "bat", "cmd", "com", "msi", "ps1", "psm1", "vbs", "vbe",
  "js", "mjs", "cjs", "ts", "php", "php3", "php4", "php5", "phtml",
  "asp", "aspx", "jsp", "cgi", "pl", "py", "rb", "html", "htm", "svg",
  "jar", "war", "class",
]);

export interface ValidateUploadOptions {
  allowedMime: ReadonlySet<string> | string[] | readonly string[];
  allowedExt?: ReadonlySet<string> | string[];
  maxSizeBytes?: number;
}

export interface ValidateUploadResult {
  ok: boolean;
  errorMessage?: string;
}

function toSet(input: ReadonlySet<string> | readonly string[]): Set<string> {
  return input instanceof Set ? input : new Set(input);
}

/**
 * Validates an uploaded file against MIME type, extension, size, and
 * a hardcoded blocklist of dangerous types (executables, scripts, SVG, HTML).
 *
 * @param file - multer file object (req.file)
 * @param options - validation options
 * @returns { ok: true } or { ok: false, errorMessage: string }
 */
export function validateUploadFile(
  file: Express.Multer.File,
  options: ValidateUploadOptions,
): ValidateUploadResult {
  const allowedMime = toSet(options.allowedMime);
  const allowedExt = options.allowedExt ? toSet(options.allowedExt) : null;
  const maxSize = options.maxSizeBytes;

  const mime = file.mimetype.toLowerCase().trim();
  const originalName = file.originalname ?? "";
  const ext = originalName.includes(".")
    ? originalName.split(".").pop()!.toLowerCase().trim()
    : "";

  // 1. Blocklist check (always enforced regardless of options)
  if (ALWAYS_BLOCKED_MIME.has(mime)) {
    return { ok: false, errorMessage: `Tipe file '${mime}' tidak diizinkan.` };
  }
  if (ext && ALWAYS_BLOCKED_EXT.has(ext)) {
    return { ok: false, errorMessage: `Ekstensi '.${ext}' tidak diizinkan.` };
  }

  // 2. MIME whitelist
  if (!allowedMime.has(mime)) {
    return {
      ok: false,
      errorMessage: `Tipe file tidak didukung. Diizinkan: ${[...allowedMime].join(", ")}.`,
    };
  }

  // 3. Extension whitelist (optional)
  if (allowedExt && ext && !allowedExt.has(ext)) {
    return {
      ok: false,
      errorMessage: `Ekstensi '.${ext}' tidak didukung. Diizinkan: ${[...allowedExt].map((e) => `.${e}`).join(", ")}.`,
    };
  }

  // 4. Size check
  if (maxSize !== undefined && file.size > maxSize) {
    const maxMb = (maxSize / 1024 / 1024).toFixed(0);
    return { ok: false, errorMessage: `Ukuran file melebihi batas ${maxMb} MB.` };
  }

  return { ok: true };
}

// ── Magic-byte (file signature) validation ────────────────────────────────────
//
// Maps declared MIME type to one or more known magic-byte signatures.
// Each entry is { offset, bytes } — bytes at position `offset` in the buffer.
// WebP requires an extra check at offset 8 ("WEBP" marker after RIFF header).
//
// C2-REMEDIATION: call validateMagicBytes(req.file.buffer, req.file.mimetype)
// in the route handler AFTER multer has buffered the file.
//
const MAGIC_SIGNATURES: Record<string, Array<{ offset: number; bytes: readonly number[] }>> = {
  "image/jpeg":   [{ offset: 0, bytes: [0xFF, 0xD8, 0xFF] }],
  "image/png":    [{ offset: 0, bytes: [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] }],
  "image/webp":   [{ offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] }], // verified further below
  "application/pdf": [{ offset: 0, bytes: [0x25, 0x50, 0x44, 0x46] }], // %PDF
  // ZIP-based formats (XLSX, DOCX) share the PK\x03\x04 signature
  "application/zip":                    [{ offset: 0, bytes: [0x50, 0x4B, 0x03, 0x04] }],
  "application/x-zip-compressed":       [{ offset: 0, bytes: [0x50, 0x4B, 0x03, 0x04] }],
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet":
    [{ offset: 0, bytes: [0x50, 0x4B, 0x03, 0x04] }],
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    [{ offset: 0, bytes: [0x50, 0x4B, 0x03, 0x04] }],
};

/**
 * Validate that a file's binary content matches the expected magic bytes for
 * its declared MIME type. Returns ok=true for MIME types without a known
 * signature (pass-through; the MIME allowlist already vetted those).
 *
 * MUST be called in the route handler after multer has stored req.file.buffer.
 * It CANNOT run inside fileFilter because the buffer is not yet complete there.
 *
 * @example
 *   const magicResult = validateMagicBytes(req.file.buffer, req.file.mimetype);
 *   if (!magicResult.ok) return res.status(400).json({ message: magicResult.errorMessage });
 */
export function validateMagicBytes(
  buffer: Buffer,
  declaredMime: string,
): ValidateUploadResult {
  const mime = (declaredMime ?? "").toLowerCase().trim();
  const sigs = MAGIC_SIGNATURES[mime];
  if (!sigs || sigs.length === 0) {
    // No registered signature — cannot verify; pass through.
    return { ok: true };
  }

  for (const { offset, bytes } of sigs) {
    if (buffer.length < offset + bytes.length) {
      return {
        ok: false,
        errorMessage: `File terlalu kecil atau rusak (MIME: ${mime}).`,
      };
    }
    const match = bytes.every((b, i) => buffer[offset + i] === b);
    if (!match) continue;

    // WebP: after RIFF header (offset 0-3), offset 8-11 must be "WEBP"
    if (mime === "image/webp") {
      if (buffer.length < 12) {
        return { ok: false, errorMessage: "File WebP tidak valid atau rusak." };
      }
      const webp = [0x57, 0x45, 0x42, 0x50]; // "WEBP"
      if (webp.every((b, i) => buffer[8 + i] === b)) return { ok: true };
      continue; // RIFF but not WebP
    }

    return { ok: true };
  }

  return {
    ok: false,
    errorMessage: `Konten file tidak cocok dengan tipe yang dideklarasikan (${mime}). File mungkin telah diubah ekstensinya.`,
  };
}

/**
 * SVG is intentionally not accepted by the generic document upload validator.
 * The portal CMS has a separate, explicit opt-in for SVG logos, and must
 * reject active/external markup before storing it in the public bucket.
 */
export function validateSvgImageAsset(buffer: Buffer): ValidateUploadResult {
  if (!buffer.length) return { ok: false, errorMessage: "File SVG kosong." };
  const source = buffer.toString("utf8").replace(/^\uFEFF/, "").trim();
  if (!source.toLowerCase().startsWith("<svg") && !/^<\?xml[\s\S]*<svg\b/i.test(source)) {
    return { ok: false, errorMessage: "Konten file bukan SVG yang valid." };
  }
  if (source.length > 5 * 1024 * 1024) {
    return { ok: false, errorMessage: "File SVG terlalu besar." };
  }

  // Keep public SVGs image-only: no scripts, event handlers, embedded
  // documents, javascript URLs, external resources, or entity declarations.
  const dangerous = [
    /<!DOCTYPE/i,
    /<\s*script\b/i,
    /<\s*(?:iframe|object|embed|foreignObject)\b/i,
    /\bon[a-z]+\s*=/i,
    /\b(?:javascript|vbscript):/i,
    /data\s*:\s*text\/html/i,
    /(?:href|xlink:href|src)\s*=\s*["']\s*(?:https?:|\/\/|data:)/i,
  ];
  if (dangerous.some((pattern) => pattern.test(source))) {
    return { ok: false, errorMessage: "SVG hanya boleh berisi markup gambar yang aman." };
  }
  return { ok: true };
}
