import { randomUUID } from "crypto";
import { ObjectStorageService } from "./objectStorage.js";
import { compressImageBuffer, isCompressibleImage } from "./imageCompress.js";

const objectStorage = new ObjectStorageService();

function extFromContentType(contentType: string): string {
  const map: Record<string, string> = {
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/png": "png",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/tiff": "tiff",
    "image/bmp": "bmp",
    "image/heic": "heic",
    "image/heif": "heif",
    "application/pdf": "pdf",
    "video/mp4": "mp4",
    "video/quicktime": "mp4",
    "video/webm": "webm",
  };
  return map[contentType.toLowerCase()] ?? "bin";
}

/**
 * Upload buffer ke Supabase Storage (public-assets bucket).
 * Returns absolute public URL path.
 */
export async function uploadToSupabase(
  buffer: Buffer,
  contentType: string,
  folder = "uploads",
): Promise<{ publicUrl: string; storagePath: string; contentType: string; sizeBytes: number }> {
  const prepared = isCompressibleImage(contentType)
    ? await compressImageBuffer(buffer, contentType, "photo")
    : { buffer, contentType };
  const ext = extFromContentType(prepared.contentType);
  const objectId = randomUUID();
  const fileName = `${objectId}.${ext}`;
  const objectKey = `${folder}/${fileName}`;

  const publicUrl = await objectStorage.uploadPublicAsset(
    prepared.buffer,
    objectKey,
    prepared.contentType,
    { skipImageCompression: true },
  );
  return {
    publicUrl,
    storagePath: objectKey,
    contentType: prepared.contentType,
    sizeBytes: prepared.buffer.byteLength,
  };
}

/**
 * Download file dari Supabase Storage.
 * Returns Buffer.
 */
export async function downloadFromSupabase(storagePath: string): Promise<Buffer> {
  const file = await objectStorage.searchPublicObject(storagePath);
  if (!file) throw new Error(`Object not found: ${storagePath}`);
  const response = await objectStorage.downloadObject(file);
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

/**
 * Delete file dari Supabase Storage (public-assets bucket).
 * Menerima storagePath (e.g. "uploads/uuid.jpg") atau serving URL
 * ("/api/storage/public-objects/portal-assets/uploads/uuid.jpg").
 * Non-fatal — diam jika objek tidak ditemukan.
 */
export async function deleteFromSupabase(storagePath: string): Promise<void> {
  try {
    // Normalise: strip serving-URL prefix
    let resolved = storagePath;
    if (resolved.startsWith("/api/storage/public-objects/portal-assets/")) {
      resolved = resolved.replace("/api/storage/public-objects/portal-assets/", "");
    } else if (resolved.startsWith("/api/storage/public-objects/")) {
      resolved = resolved.replace("/api/storage/public-objects/", "");
    }
    // Also strip "supabase:media/" virtual prefix (legacy objectPath format)
    if (resolved.startsWith("supabase:media/")) {
      resolved = resolved.replace("supabase:media/", "");
    }
    await objectStorage.tryDeletePublicFile(resolved);
  } catch {
    // Non-fatal
  }
}

/**
 * Check apakah URL adalah Supabase Storage URL.
 */
export function isSupabaseUrl(url: string): boolean {
  return url.includes("supabase.co/storage");
}
