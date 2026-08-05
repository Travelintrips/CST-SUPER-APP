/**
 * useStorageBg — hook untuk CSS background-image dari Supabase Storage.
 * Probe URL; jika gagal, fallback ke /images/ lokal.
 *
 * Usage:
 *   const bg = useStorageBg("/api/storage/public-objects/portal/images/warehouse.png");
 *   <div style={{ backgroundImage: bg }} />
 */
import { useEffect, useState } from "react";

function toLocalFallback(src: string): string {
  return src.replace(/^\/api\/storage\/public-objects\/portal\/images\//, "/images/");
}

export function useStorageBg(storageUrl: string): string {
  const fallback = toLocalFallback(storageUrl);
  const [url, setUrl] = useState(storageUrl);

  useEffect(() => {
    let cancelled = false;
    const img = new Image();
    img.onload  = () => { if (!cancelled) setUrl(storageUrl); };
    img.onerror = () => { if (!cancelled) setUrl(fallback); };
    img.src = storageUrl;
    return () => { cancelled = true; };
  }, [storageUrl, fallback]);

  return `url('${url}')`;
}
