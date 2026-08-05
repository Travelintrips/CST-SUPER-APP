import { useState, useCallback } from "react";
import type { UppyFile } from "@uppy/core";
import { compressImageFileWithPreview, type ImageCompressMode } from "./compressImage";

interface UploadMetadata {
  name: string;
  size: number;
  contentType: string;
}

interface UploadResponse {
  uploadURL: string;
  objectPath: string;
  metadata: UploadMetadata;
}

interface UseUploadOptions {
  /** Base path where object storage routes are mounted (default: "/api/storage") */
  basePath?: string;
  /**
   * Compression mode applied before upload.
   * "photo"   → WebP 80%, max 1600 px  (operational / cargo photos)
   * "ocr-doc" → JPEG 85%, max 2000 px  (documents for OCR / scanning)
   * Defaults to "photo".
   */
  mode?: ImageCompressMode;
  /**
   * Optional callback that returns a Bearer token for authenticating the
   * presigned-URL request against your API server.
   */
  getAuthToken?: () => Promise<string | null | undefined>;
  onSuccess?: (response: UploadResponse) => void;
  onError?: (error: Error) => void;
}

/**
 * React hook for handling file uploads with presigned URLs.
 *
 * Flow:
 * 1. Compress image client-side (WebP for photos, JPEG for OCR docs)
 * 2. Generate a local preview URL (revoke when done via clearPreview)
 * 3. Request a presigned PUT URL from the backend
 * 4. PUT the compressed file directly to storage
 *
 * @example
 * ```tsx
 * function FileUploader() {
 *   const { uploadFile, isUploading, preview, clearPreview, error } = useUpload({
 *     mode: "photo",
 *     onSuccess: ({ objectPath }) => saveToDb(objectPath),
 *   });
 *
 *   const handleChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
 *     const file = e.target.files?.[0];
 *     if (file) await uploadFile(file);
 *   };
 *
 *   return (
 *     <div>
 *       <input type="file" accept="image/*" onChange={handleChange} disabled={isUploading} />
 *       {preview && (
 *         <img src={preview} alt="Preview" onLoad={clearPreview} style={{ maxWidth: 320 }} />
 *       )}
 *       {isUploading && <p>Mengupload…</p>}
 *       {error && <p>Error: {error.message}</p>}
 *     </div>
 *   );
 * }
 * ```
 */
export function useUpload(options: UseUploadOptions = {}) {
  const basePath = options.basePath ?? "/api/storage";
  const mode = options.mode ?? "photo";

  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const [progress, setProgress] = useState(0);
  const [preview, setPreview] = useState<string | null>(null);

  const clearPreview = useCallback(() => {
    setPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  const buildAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
    if (!options.getAuthToken) return {};
    try {
      const token = await options.getAuthToken();
      if (token) return { Authorization: `Bearer ${token}` };
    } catch {
      // ignore — fall back to cookie-based auth
    }
    return {};
  }, [options]);

  const requestUploadUrl = useCallback(
    async (file: File): Promise<UploadResponse> => {
      const authHeaders = await buildAuthHeaders();
      const response = await fetch(`${basePath}/uploads/request-url`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          name: file.name,
          size: file.size,
          contentType: file.type || "application/octet-stream",
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to get upload URL");
      }

      return response.json();
    },
    [basePath, buildAuthHeaders],
  );

  const uploadToPresignedUrl = useCallback(async (file: File, uploadURL: string): Promise<void> => {
    const response = await fetch(uploadURL, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": file.type || "application/octet-stream" },
    });

    if (!response.ok) throw new Error("Failed to upload file to storage");
  }, []);

  const uploadFile = useCallback(
    async (file: File): Promise<UploadResponse | null> => {
      setIsUploading(true);
      setError(null);
      setProgress(0);

      // Clear previous preview
      setPreview((prev) => { if (prev) URL.revokeObjectURL(prev); return null; });

      try {
        setProgress(5);
        const { file: compressed, previewUrl } = await compressImageFileWithPreview(file, mode);

        setPreview(previewUrl);
        setProgress(10);

        const uploadResponse = await requestUploadUrl(compressed);
        setProgress(30);

        await uploadToPresignedUrl(compressed, uploadResponse.uploadURL);
        setProgress(100);

        options.onSuccess?.(uploadResponse);
        return uploadResponse;
      } catch (err) {
        const uploadError = err instanceof Error ? err : new Error("Upload failed");
        setError(uploadError);
        options.onError?.(uploadError);
        return null;
      } finally {
        setIsUploading(false);
      }
    },
    [requestUploadUrl, uploadToPresignedUrl, mode, options],
  );

  const getUploadParameters = useCallback(
    async (
      file: UppyFile<Record<string, unknown>, Record<string, unknown>>,
    ): Promise<{ method: "PUT"; url: string; headers?: Record<string, string> }> => {
      const authHeaders = await buildAuthHeaders();
      const response = await fetch(`${basePath}/uploads/request-url`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify({
          name: file.name,
          size: file.size,
          contentType: file.type || "application/octet-stream",
        }),
      });

      if (!response.ok) throw new Error("Failed to get upload URL");

      const data = await response.json();
      return {
        method: "PUT",
        url: data.uploadURL,
        headers: { "Content-Type": file.type || "application/octet-stream" },
      };
    },
    [basePath, buildAuthHeaders],
  );

  return {
    uploadFile,
    getUploadParameters,
    isUploading,
    error,
    progress,
    /** Blob URL of the compressed image ready for <img src>. Revoke via clearPreview(). */
    preview,
    /** Revoke the preview blob URL and reset to null. */
    clearPreview,
  };
}
