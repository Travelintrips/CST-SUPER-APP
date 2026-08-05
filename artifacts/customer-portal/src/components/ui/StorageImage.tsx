/**
 * StorageImage — drop-in <img> yang auto-fallback ke /images/ lokal
 * jika Supabase Storage belum terkoneksi (404 / network error).
 *
 * Pattern:
 *   /api/storage/public-objects/portal/images/X  →  /images/X
 *
 * Storage tetap di Supabase; fallback hanya tampil saat storage tidak tersedia.
 */
import React from "react";

function toLocalFallback(src: string): string {
  return src.replace(/^\/api\/storage\/public-objects\/portal\/images\//, "/images/");
}

interface StorageImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string;
}

export function StorageImage({ src, onError, ...props }: StorageImageProps) {
  const fallback = toLocalFallback(src);

  const handleError: React.ReactEventHandler<HTMLImageElement> = (e) => {
    const el = e.currentTarget;
    if (el.src !== fallback && fallback !== el.src) {
      el.src = fallback;
    }
    onError?.(e);
  };

  return <img src={src} onError={handleError} {...props} />;
}
