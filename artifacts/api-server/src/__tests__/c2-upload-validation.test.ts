/**
 * C2-REMEDIATION: Upload file validation tests
 * Covers: validateUploadFile helper, validateMagicBytes helper,
 *         and integration tests verifying route-level behaviour.
 */

import { describe, it, expect } from "vitest";
import { validateUploadFile, validateMagicBytes, validateSvgImageAsset } from "../lib/uploadValidation.js";

// ── fixture factories ───────────────────────────────────────────────────────

function makeFile(
  opts: Partial<Express.Multer.File> & { buffer?: Buffer },
): Express.Multer.File {
  return {
    fieldname: "file",
    originalname: opts.originalname ?? "test.jpg",
    encoding: "7bit",
    mimetype: opts.mimetype ?? "image/jpeg",
    size: opts.buffer?.length ?? opts.size ?? 100,
    buffer: opts.buffer ?? Buffer.alloc(100, 0xff),
    destination: "",
    filename: "",
    path: "",
    stream: null as any,
  };
}

// Real magic-byte buffers
const JPEG_BUF  = Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, ...Array(96).fill(0x00)]);
const PNG_BUF   = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, ...Array(92).fill(0x00)]);
const PDF_BUF   = Buffer.from([0x25, 0x50, 0x44, 0x46, 0x2D, ...Array(95).fill(0x00)]); // %PDF-
const WEBP_BUF  = Buffer.from([
  0x52, 0x49, 0x46, 0x46,        // RIFF
  0x24, 0x00, 0x00, 0x00,        // file size LE
  0x57, 0x45, 0x42, 0x50,        // WEBP
  ...Array(88).fill(0x00),
]);

// Fake / malformed
const FAKE_JPEG   = Buffer.from([0x00, 0x00, 0x00, 0x00, ...Array(96).fill(0x41)]); // zeros, not JPEG
const FAKE_PDF    = Buffer.from([0x00, 0x50, 0x44, 0x46, ...Array(96).fill(0x00)]); // wrong first byte
const EMPTY_BUF   = Buffer.alloc(0);
const EXE_BUF     = Buffer.from([0x4D, 0x5A, ...Array(98).fill(0x00)]); // MZ header
const SHORT_BUF   = Buffer.from([0xFF, 0xD8]);                            // JPEG header truncated

const KTP_MIME_SET = new Set(["image/jpeg", "image/jpg", "image/png", "image/webp"]);
const DOC_MIME_SET = new Set([
  "application/pdf",
  "image/jpeg", "image/jpg", "image/png", "image/webp",
]);

// ──────────────────────────────────────────────────────────────────────────────
// validateUploadFile
// ──────────────────────────────────────────────────────────────────────────────

describe("validateUploadFile", () => {
  it("accepts valid JPEG", () => {
    const f = makeFile({ mimetype: "image/jpeg", originalname: "ktp.jpg", buffer: JPEG_BUF });
    expect(validateUploadFile(f, { allowedMime: KTP_MIME_SET })).toEqual({ ok: true });
  });

  it("accepts valid PNG", () => {
    const f = makeFile({ mimetype: "image/png", originalname: "ktp.png", buffer: PNG_BUF });
    expect(validateUploadFile(f, { allowedMime: KTP_MIME_SET })).toEqual({ ok: true });
  });

  it("accepts valid WebP", () => {
    const f = makeFile({ mimetype: "image/webp", originalname: "ktp.webp", buffer: WEBP_BUF });
    expect(validateUploadFile(f, { allowedMime: KTP_MIME_SET })).toEqual({ ok: true });
  });

  it("accepts valid PDF for document upload", () => {
    const f = makeFile({ mimetype: "application/pdf", originalname: "doc.pdf", buffer: PDF_BUF });
    expect(validateUploadFile(f, { allowedMime: DOC_MIME_SET })).toEqual({ ok: true });
  });

  it("rejects PDF for KTP OCR (image-only endpoint)", () => {
    const f = makeFile({ mimetype: "application/pdf", originalname: "fake.pdf", buffer: PDF_BUF });
    const r = validateUploadFile(f, { allowedMime: KTP_MIME_SET });
    expect(r.ok).toBe(false);
  });

  it("rejects SVG regardless of allowedMime (always-blocked)", () => {
    const f = makeFile({ mimetype: "image/svg+xml", originalname: "evil.svg", buffer: Buffer.alloc(10) });
    const r = validateUploadFile(f, { allowedMime: new Set(["image/svg+xml"]) });
    expect(r.ok).toBe(false);
  });

  it("rejects executable extension .exe", () => {
    const f = makeFile({ mimetype: "image/jpeg", originalname: "virus.exe", buffer: JPEG_BUF });
    const r = validateUploadFile(f, { allowedMime: KTP_MIME_SET, allowedExt: ["jpg"] });
    expect(r.ok).toBe(false);
  });

  it("rejects .sh extension (always-blocked)", () => {
    const f = makeFile({ mimetype: "image/jpeg", originalname: "run.sh", buffer: Buffer.alloc(10) });
    const r = validateUploadFile(f, { allowedMime: KTP_MIME_SET });
    expect(r.ok).toBe(false);
  });

  it("rejects oversize file", () => {
    const bigBuf = Buffer.alloc(11 * 1024 * 1024, 0xFF);
    bigBuf[0] = 0xFF; bigBuf[1] = 0xD8; bigBuf[2] = 0xFF;
    const f = makeFile({ mimetype: "image/jpeg", originalname: "big.jpg", buffer: bigBuf, size: bigBuf.length });
    const r = validateUploadFile(f, { allowedMime: KTP_MIME_SET, maxSizeBytes: 10 * 1024 * 1024 });
    expect(r.ok).toBe(false);
    expect(r.errorMessage).toMatch(/batas/);
  });

  it("rejects wrong MIME type (HTML)", () => {
    const f = makeFile({ mimetype: "text/html", originalname: "page.html", buffer: Buffer.alloc(10) });
    const r = validateUploadFile(f, { allowedMime: KTP_MIME_SET });
    expect(r.ok).toBe(false);
  });

  it("rejects JavaScript MIME", () => {
    const f = makeFile({ mimetype: "application/javascript", originalname: "script.js", buffer: Buffer.alloc(10) });
    const r = validateUploadFile(f, { allowedMime: new Set(["application/javascript"]) });
    expect(r.ok).toBe(false);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// validateMagicBytes
// ──────────────────────────────────────────────────────────────────────────────

describe("validateMagicBytes", () => {
  // --- valid ----------------------------------------------------------------
  it("accepts real JPEG buffer", () => {
    expect(validateMagicBytes(JPEG_BUF, "image/jpeg")).toEqual({ ok: true });
  });

  it("accepts real PNG buffer", () => {
    expect(validateMagicBytes(PNG_BUF, "image/png")).toEqual({ ok: true });
  });

  it("accepts real WebP buffer", () => {
    expect(validateMagicBytes(WEBP_BUF, "image/webp")).toEqual({ ok: true });
  });

  it("accepts real PDF buffer", () => {
    expect(validateMagicBytes(PDF_BUF, "application/pdf")).toEqual({ ok: true });
  });

  // --- fake MIME ------------------------------------------------------------
  it("rejects fake JPEG (wrong magic bytes, declared as image/jpeg)", () => {
    const r = validateMagicBytes(FAKE_JPEG, "image/jpeg");
    expect(r.ok).toBe(false);
    expect(r.errorMessage).toBeTruthy();
  });

  it("rejects fake PDF (wrong magic bytes, declared as application/pdf)", () => {
    const r = validateMagicBytes(FAKE_PDF, "application/pdf");
    expect(r.ok).toBe(false);
  });

  it("rejects executable buffer declared as image/jpeg (MZ header)", () => {
    const r = validateMagicBytes(EXE_BUF, "image/jpeg");
    expect(r.ok).toBe(false);
  });

  it("rejects empty buffer for image/jpeg", () => {
    const r = validateMagicBytes(EMPTY_BUF, "image/jpeg");
    expect(r.ok).toBe(false);
    expect(r.errorMessage).toMatch(/kecil|rusak/i);
  });

  it("rejects truncated JPEG header (too short)", () => {
    const r = validateMagicBytes(SHORT_BUF, "image/jpeg");
    // SHORT_BUF has 0xFF 0xD8 but not the third byte 0xFF — should fail
    expect(r.ok).toBe(false);
  });

  it("rejects PNG magic declared as image/jpeg", () => {
    const r = validateMagicBytes(PNG_BUF, "image/jpeg");
    expect(r.ok).toBe(false);
  });

  it("passes through MIME types without a registered signature (no false positive)", () => {
    // e.g. image/heic — no signature registered, should pass through
    const r = validateMagicBytes(Buffer.alloc(50, 0x00), "image/heic");
    expect(r.ok).toBe(true);
  });

  // --- WebP edge cases ------------------------------------------------------
  it("rejects RIFF buffer that is not WebP (RIFF header present but wrong WEBP marker)", () => {
    const riffNotWebp = Buffer.from([
      0x52, 0x49, 0x46, 0x46,   // RIFF
      0x10, 0x00, 0x00, 0x00,   // size
      0x41, 0x56, 0x49, 0x20,   // AVI  (not WEBP)
      ...Array(88).fill(0x00),
    ]);
    const r = validateMagicBytes(riffNotWebp, "image/webp");
    expect(r.ok).toBe(false);
  });

  it("rejects WebP buffer too short for WEBP marker", () => {
    const short = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00]); // only 8 bytes
    const r = validateMagicBytes(short, "image/webp");
    expect(r.ok).toBe(false);
  });
});

describe("validateSvgImageAsset", () => {
  it("accepts a passive SVG logo", () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><path d="M0 0h10v10H0z"/></svg>');
    expect(validateSvgImageAsset(svg)).toEqual({ ok: true });
  });

  it("rejects active or externally loaded SVG markup", () => {
    const svg = Buffer.from('<svg><script>alert(1)</script><image href="https://evil.example/x"/></svg>');
    expect(validateSvgImageAsset(svg).ok).toBe(false);
  });
});
