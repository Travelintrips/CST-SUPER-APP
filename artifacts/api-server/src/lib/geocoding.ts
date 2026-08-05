const cache = new Map<string, { lat: number; lng: number } | null>();
const PENDING = new Map<string, Promise<{ lat: number; lng: number } | null>>();

export async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  const key = address.trim().toLowerCase();
  if (cache.has(key)) return cache.get(key)!;
  if (PENDING.has(key)) return PENDING.get(key)!;

  const promise = (async () => {
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(address)}&limit=1`;
      const res = await fetch(url, {
        headers: { "User-Agent": "CST-Logistics-BizPortal/1.0 (admin@cst.co.id)" },
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) { cache.set(key, null); return null; }
      const data = (await res.json()) as Array<{ lat: string; lon: string }>;
      if (!data.length) { cache.set(key, null); return null; }
      const result = { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon) };
      cache.set(key, result);
      return result;
    } catch {
      cache.set(key, null);
      return null;
    } finally {
      PENDING.delete(key);
    }
  })();

  PENDING.set(key, promise);
  return promise;
}
