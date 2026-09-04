/**
 * videoOptimizer.ts
 *
 * Video Optimization Engine — Vendor Media Pipeline
 *
 * Pipeline:
 *   Upload (mp4 / mov, max 100 MB)
 *     → Validate (MIME + extension + size)
 *     → Probe   (extract duration, resolution, codec)
 *     → Compress (H.264 CRF 28, scale ≤1280 px, AAC 128 k, mp4)
 *     → Thumbnail (JPEG 640×360, at 2 s or 10% of duration)
 *     → Upload  (videoUrl + thumbnailUrl → Supabase Storage)
 *     → Report  (VIDEO OPTIMIZATION REPORT)
 */

import { createRequire } from "node:module";
import sharp from "sharp";

// fluent-ffmpeg loaded lazily via CJS require — avoids ESM static link failure
// when binary is not installed (require resolves at call-time, not module link-time)
const _lazyRequire = createRequire(import.meta.url);
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _ffmpegModule: any = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function getFfmpeg(): any {
  if (!_ffmpegModule) {
    try {
      _ffmpegModule = _lazyRequire("fluent-ffmpeg");
    } catch {
      throw new Error("fluent-ffmpeg tidak tersedia. Install package fluent-ffmpeg untuk menggunakan fitur optimasi video.");
    }
  }
  return _ffmpegModule;
}
import { randomUUID } from "crypto";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import { uploadToSupabase } from "./supabaseStorage.js";

// ── Constants ─────────────────────────────────────────────────────────────────

export const VIDEO_MAX_BYTES = 100 * 1024 * 1024; // 100 MB

export const VIDEO_ALLOWED_MIME = new Set([
  "video/mp4",
  "video/quicktime", // .mov
]);

export const VIDEO_ALLOWED_EXT = new Set(["mp4", "mov"]);

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VideoProbeResult {
  durationSec: number;
  width: number;
  height: number;
  codec: string;
  bitrate: number;
}

export interface VideoOptimizationReport {
  ok: true;
  videoUrl: string;
  thumbnailUrl: string;
  videoStoragePath: string;
  thumbnailStoragePath: string;

  original: {
    fileSizeBytes: number;
    mime: string;
    ext: string;
  };
  compressed: {
    fileSizeBytes: number;
    durationSec: number;
    width: number;
    height: number;
    codec: string;
    bitrateKbps: number;
    compressionRatioPct: number;
    savedBytes: number;
  };
  thumbnail: {
    fileSizeBytes: number;
    timestampSec: number;
    width: number;
    height: number;
  };
  timingMs: {
    probe: number;
    compress: number;
    thumbnail: number;
    upload: number;
    total: number;
  };
}

// ── Validation ────────────────────────────────────────────────────────────────

export interface VideoValidationResult {
  ok: boolean;
  errorMessage?: string;
  status?: number;
  ext?: string;
}

export function validateVideo(
  buffer: Buffer,
  mimetype: string,
  originalname: string,
): VideoValidationResult {
  const mime = mimetype.toLowerCase().trim();
  const ext = (originalname.includes(".")
    ? originalname.split(".").pop()!
    : ""
  ).toLowerCase();

  if (!VIDEO_ALLOWED_MIME.has(mime)) {
    return {
      ok: false,
      status: 415,
      errorMessage: `Format video tidak didukung: '${mime}'. Gunakan MP4 atau MOV.`,
    };
  }

  if (ext && !VIDEO_ALLOWED_EXT.has(ext)) {
    return {
      ok: false,
      status: 415,
      errorMessage: `Ekstensi '${ext}' tidak didukung. Gunakan .mp4 atau .mov.`,
    };
  }

  if (buffer.byteLength > VIDEO_MAX_BYTES) {
    const mb = (buffer.byteLength / 1024 / 1024).toFixed(1);
    return {
      ok: false,
      status: 413,
      errorMessage: `Ukuran file ${mb} MB melebihi batas 100 MB.`,
    };
  }

  return { ok: true, ext: ext || "mp4" };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function tempFile(suffix: string): string {
  return path.join(os.tmpdir(), `vo_${randomUUID()}${suffix}`);
}

async function cleanupFiles(...files: string[]): Promise<void> {
  await Promise.allSettled(files.map((f) => fs.unlink(f).catch(() => {})));
}

// ── Probe ─────────────────────────────────────────────────────────────────────

function probeVideo(inputPath: string): Promise<VideoProbeResult> {
  return new Promise((resolve, reject) => {
    getFfmpeg().ffprobe(inputPath, (err: Error | null, meta: any) => {
      if (err) return reject(new Error(`ffprobe failed: ${err.message}`));

      const vs = meta.streams?.find((s: any) => s.codec_type === "video");
      if (!vs) return reject(new Error("Tidak ada video stream yang ditemukan"));

      const durationSec =
        parseFloat(String(meta.format?.duration ?? vs.duration ?? "0")) || 0;
      const width = vs.width ?? 0;
      const height = vs.height ?? 0;
      const codec = vs.codec_name ?? "unknown";
      const bitrate =
        parseInt(String(meta.format?.bit_rate ?? "0"), 10) || 0;

      resolve({ durationSec, width, height, codec, bitrate });
    });
  });
}

// ── Compress ──────────────────────────────────────────────────────────────────

function compressVideo(
  inputPath: string,
  outputPath: string,
  probe: VideoProbeResult,
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Scale: keep aspect ratio, max 1280 wide, must be divisible by 2
    const scaleFilter =
      probe.width > 1280
        ? "scale=1280:-2"
        : "scale=trunc(iw/2)*2:trunc(ih/2)*2";

    getFfmpeg()(inputPath)
      .videoCodec("libx264")
      .audioCodec("aac")
      .outputOptions([
        "-crf 28",
        "-preset fast",
        "-movflags +faststart",
        "-b:a 128k",
        `-vf ${scaleFilter}`,
        "-pix_fmt yuv420p",
      ])
      .output(outputPath)
      .on("error", (err: any) => reject(new Error(`ffmpeg compress: ${err.message}`)))
      .on("end", () => resolve())
      .run();
  });
}

// ── Thumbnail ─────────────────────────────────────────────────────────────────

function extractThumbnail(
  inputPath: string,
  outputPath: string,
  timestampSec: number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    getFfmpeg()(inputPath)
      .seekInput(timestampSec)
      .frames(1)
      .outputOptions(["-q:v 2"])
      .output(outputPath)
      .on("error", (err: Error) => reject(new Error(`ffmpeg thumbnail: ${err.message}`)))
      .on("end", () => resolve())
      .run();
  });
}

// ── Main pipeline ─────────────────────────────────────────────────────────────

export async function optimizeAndUploadVideo(
  buffer: Buffer,
  mimetype: string,
  folder = "product-media/videos",
): Promise<VideoOptimizationReport> {
  const totalStart = Date.now();

  const inputPath  = tempFile(".mp4");
  const outputPath = tempFile("_compressed.mp4");
  const thumbRaw   = tempFile("_thumb_raw.jpg");
  const thumbFinal = tempFile("_thumb.jpg");

  try {
    // Write input buffer to temp file
    await fs.writeFile(inputPath, buffer);

    // ── 1. Probe ───────────────────────────────────────────────────────────
    const probeStart = Date.now();
    const probe = await probeVideo(inputPath);
    const probeMs = Date.now() - probeStart;

    // ── 2. Compress ────────────────────────────────────────────────────────
    const compressStart = Date.now();
    await compressVideo(inputPath, outputPath, probe);
    const compressMs = Date.now() - compressStart;

    const compressedBuffer = await fs.readFile(outputPath);
    const compressedSizeBytes = compressedBuffer.byteLength;

    // Re-probe compressed for accurate metadata
    const compressedProbe = await probeVideo(outputPath).catch(() => probe);
    const finalWidth = compressedProbe.width || probe.width;
    const finalHeight = compressedProbe.height || probe.height;
    const finalDurationSec = compressedProbe.durationSec || probe.durationSec;
    const finalBitrate = compressedProbe.bitrate;

    // ── 3. Thumbnail ───────────────────────────────────────────────────────
    const thumbStart = Date.now();
    const thumbTimeSec = Math.min(2, finalDurationSec * 0.1);

    await extractThumbnail(outputPath, thumbRaw, thumbTimeSec);

    // Resize + compress thumbnail with sharp
    await sharp(thumbRaw)
      .resize(640, 360, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85, mozjpeg: true })
      .toFile(thumbFinal);

    const thumbBuffer = await fs.readFile(thumbFinal);
    const thumbSizeBytes = thumbBuffer.byteLength;
    const thumbMs = Date.now() - thumbStart;

    // ── 4. Upload ──────────────────────────────────────────────────────────
    const uploadStart = Date.now();
    const [videoUpload, thumbUpload] = await Promise.all([
      uploadToSupabase(compressedBuffer, "video/mp4", folder),
      uploadToSupabase(thumbBuffer, "image/jpeg", `${folder}/thumbnails`),
    ]);
    const uploadMs = Date.now() - uploadStart;

    const totalMs = Date.now() - totalStart;

    const originalSizeBytes = buffer.byteLength;
    const savedBytes = originalSizeBytes - compressedSizeBytes;
    const compressionRatioPct =
      originalSizeBytes > 0
        ? Math.round((savedBytes / originalSizeBytes) * 100)
        : 0;

    return {
      ok: true,
      videoUrl: videoUpload.publicUrl,
      thumbnailUrl: thumbUpload.publicUrl,
      videoStoragePath: videoUpload.storagePath,
      thumbnailStoragePath: thumbUpload.storagePath,

      original: {
        fileSizeBytes: originalSizeBytes,
        mime: mimetype,
        ext: mimetype === "video/quicktime" ? "mov" : "mp4",
      },
      compressed: {
        fileSizeBytes: compressedSizeBytes,
        durationSec: finalDurationSec,
        width: finalWidth,
        height: finalHeight,
        codec: "h264",
        bitrateKbps: Math.round(finalBitrate / 1000),
        compressionRatioPct,
        savedBytes,
      },
      thumbnail: {
        fileSizeBytes: thumbSizeBytes,
        timestampSec: thumbTimeSec,
        width: 640,
        height: 360,
      },
      timingMs: {
        probe: probeMs,
        compress: compressMs,
        thumbnail: thumbMs,
        upload: uploadMs,
        total: totalMs,
      },
    };
  } finally {
    await cleanupFiles(inputPath, outputPath, thumbRaw, thumbFinal);
  }
}
