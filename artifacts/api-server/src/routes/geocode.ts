import { Router } from "express";
import { rateLimit, ipKeyGenerator } from "express-rate-limit";

const router = Router();

const GMAPS_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
const NOMINATIM_URL = "https://nominatim.openstreetmap.org/search";
const USER_AGENT = "CSTLogistics/1.0 (cstlogistic.co.id; contact@cstlogistic.co.id)";

// Rate limit: 30 req / 15 min per IP — public endpoint (used by customer portal)
// Prevents scraping / Nominatim quota abuse without breaking customer UX.
const geocodeRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Terlalu banyak permintaan geocode, coba lagi nanti." },
  keyGenerator: (req) => {
    const raw =
      (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ??
      req.socket.remoteAddress ??
      "unknown";
    return ipKeyGenerator(raw);
  },
});

router.get("/geocode", geocodeRateLimit, async (req, res) => {
  const { q, countrycodes } = req.query as Record<string, string>;
  if (!q || typeof q !== "string" || q.trim().length < 2) {
    return res.status(400).json({ error: "q required (min 2 chars)" });
  }

  const params = new URLSearchParams({
    q: q.trim(),
    format: "json",
    limit: "6",
    addressdetails: "1",
    "accept-language": "id,en",
  });
  if (countrycodes) params.set("countrycodes", countrycodes);

  try {
    const upstream = await fetch(`${NOMINATIM_URL}?${params.toString()}`, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept-Language": "id,en",
        "Referer": "https://cstlogistic.co.id",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!upstream.ok) {
      return res.status(502).json({ error: "Geocoding service unavailable" });
    }

    const data = await upstream.json();
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.json(data);
  } catch {
    return res.status(502).json({ error: "Geocoding request failed" });
  }
});

// Places Autocomplete proxy — keeps GOOGLE_MAPS_API_KEY server-side
const placesRateLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Terlalu banyak permintaan, coba lagi nanti." },
  keyGenerator: (req) => {
    const raw =
      (req.headers["x-forwarded-for"] as string | undefined)?.split(",")[0]?.trim() ??
      req.socket.remoteAddress ??
      "unknown";
    return ipKeyGenerator(raw);
  },
});

router.get("/places/autocomplete", placesRateLimit, async (req, res) => {
  const { input, country } = req.query as Record<string, string>;
  if (!input || input.trim().length < 2) {
    return res.status(400).json({ predictions: [] });
  }
  const gmapsKey = process.env.GOOGLE_MAPS_API_KEY ?? "";
  if (!gmapsKey) {
    return res.status(503).json({ error: "Google Maps API key not configured" });
  }

  const params = new URLSearchParams({
    input: input.trim(),
    key: gmapsKey,
    language: "id",
    types: "geocode|establishment",
  });
  if (country) params.set("components", `country:${country}`);

  try {
    const upstream = await fetch(
      `https://maps.googleapis.com/maps/api/place/autocomplete/json?${params.toString()}`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!upstream.ok) {
      return res.status(502).json({ predictions: [] });
    }
    const data = await upstream.json() as { predictions?: unknown[]; status?: string };
    res.setHeader("Cache-Control", "public, max-age=60");
    return res.json({ predictions: data.predictions ?? [] });
  } catch {
    return res.status(502).json({ predictions: [] });
  }
});

// Distance Matrix — return driving distance + duration between two addresses
router.get("/places/distance", placesRateLimit, async (req, res) => {
  const { origin, destination } = req.query as Record<string, string>;
  if (!origin || !destination) {
    return res.status(400).json({ error: "origin and destination required" });
  }
  if (!GMAPS_API_KEY) {
    return res.status(503).json({ error: "Google Maps API key not configured" });
  }
  const params = new URLSearchParams({
    origins: origin.trim(),
    destinations: destination.trim(),
    key: GMAPS_API_KEY,
    language: "id",
    units: "metric",
    mode: "driving",
  });
  try {
    const upstream = await fetch(
      `https://maps.googleapis.com/maps/api/distancematrix/json?${params.toString()}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!upstream.ok) return res.status(502).json({ error: "upstream error" });
    const data = await upstream.json() as {
      rows?: Array<{ elements?: Array<{ status: string; distance?: { value: number; text: string }; duration?: { text: string } }> }>;
    };
    const el = data.rows?.[0]?.elements?.[0];
    if (!el || el.status !== "OK") return res.json({ distanceKm: null, durationText: null });
    const distanceKm = Math.round((el.distance!.value / 1000) * 10) / 10;
    res.setHeader("Cache-Control", "public, max-age=3600");
    return res.json({ distanceKm, durationText: el.duration?.text ?? null });
  } catch {
    return res.status(502).json({ error: "request failed" });
  }
});

// Place Detail — resolve place_id to formatted_address
router.get("/places/detail", placesRateLimit, async (req, res) => {
  const { place_id } = req.query as Record<string, string>;
  if (!place_id || place_id.trim().length > 512) return res.status(400).json({ error: "place_id required" });
  const gmapsKey = process.env.GOOGLE_MAPS_API_KEY ?? "";
  if (!gmapsKey) return res.status(503).json({ error: "Google Maps API key not configured" });

  const params = new URLSearchParams({
    place_id: place_id.trim(),
    key: gmapsKey,
    fields: "place_id,formatted_address,name,geometry",
    language: "id",
  });

  try {
    const upstream = await fetch(
      `https://maps.googleapis.com/maps/api/place/details/json?${params.toString()}`,
      { signal: AbortSignal.timeout(6000) }
    );
    if (!upstream.ok) return res.status(502).json({ error: "upstream error" });
    const data = await upstream.json() as {
      status?: string;
      result?: {
        place_id?: string;
        formatted_address?: string;
        name?: string;
        geometry?: { location?: { lat?: number; lng?: number } };
      };
    };
    const address = data.result?.formatted_address || data.result?.name || "";
    const lat = data.result?.geometry?.location?.lat;
    const lng = data.result?.geometry?.location?.lng;
    if (data.status !== "OK" || data.result?.place_id !== place_id.trim() || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return res.status(404).json({ error: "Place tidak ditemukan" });
    }
    res.setHeader("Cache-Control", "public, max-age=300");
    return res.json({
      address,
      name: data.result?.name ?? address,
      placeId: data.result.place_id,
      lat,
      lng,
    });
  } catch {
    return res.status(502).json({ error: "request failed" });
  }
});

export default router;
