import { Router, type Request, type Response } from "express";
import { pool } from "@workspace/db";
import { logger } from "../lib/logger";

const translationsRouter = Router();

// ── GET /api/translations/:app/:locale ───────────────────────────────────────
// Public endpoint — returns flat { key: value } map for the requested locale.
translationsRouter.get("/:app/:locale", async (req: Request, res: Response) => {
  const { app, locale } = req.params;
  try {
    const result = await pool.query<{ key: string; value: string }>(
      "SELECT key, value FROM app_translations WHERE app = $1 AND locale = $2",
      [app, locale]
    );
    const translations: Record<string, string> = {};
    for (const row of result.rows) {
      translations[row.key] = row.value;
    }
    // Cache for 5 minutes in CDN/proxies; private 1 hour for browsers
    res.setHeader("Cache-Control", "public, max-age=300, stale-while-revalidate=3600");
    res.json(translations);
  } catch (err) {
    logger.error({ err, app, locale }, "[translations] GET failed");
    res.status(500).json({ error: "Failed to fetch translations" });
  }
});

// ── PATCH /api/translations/:app/:locale ─────────────────────────────────────
// Bulk upsert — admin only (requires X-Admin-Key header).
// Body: flat { "nav.home": "Beranda", ... }
translationsRouter.patch("/:app/:locale", async (req: Request, res: Response) => {
  const adminKey = req.headers["x-admin-key"];
  if (!adminKey || adminKey !== process.env["PORTAL_ADMIN_KEY"]) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const { app, locale } = req.params;
  const translations: Record<string, string> = req.body;
  if (!translations || typeof translations !== "object" || Array.isArray(translations)) {
    res.status(400).json({ error: "Body must be a flat key-value object" });
    return;
  }
  const entries = Object.entries(translations);
  if (entries.length === 0) {
    res.json({ ok: true, count: 0 });
    return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const [key, value] of entries) {
      await client.query(
        `INSERT INTO app_translations(app, locale, key, value, updated_at)
         VALUES($1, $2, $3, $4, NOW())
         ON CONFLICT ON CONSTRAINT app_translations_unique
         DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
        [app, locale, key, String(value)]
      );
    }
    await client.query("COMMIT");
    logger.info({ app, locale, count: entries.length }, "[translations] bulk upsert OK");
    res.json({ ok: true, count: entries.length });
  } catch (err) {
    await client.query("ROLLBACK");
    logger.error({ err, app, locale }, "[translations] bulk upsert failed");
    res.status(500).json({ error: "Failed to upsert translations" });
  } finally {
    client.release();
  }
});

// ── PUT /api/translations/:app/:locale/* ─────────────────────────────────────
// Single key update — admin only. The translation key comes from the wildcard.
// ── PUT /api/translations/:app/:locale/:key ──────────────────────────────────
// Single key update — admin only. The translation key is dot-separated (no slashes).
translationsRouter.put("/:app/:locale/:key", async (req: Request, res: Response) => {
  const adminKey = req.headers["x-admin-key"];
  if (!adminKey || adminKey !== process.env["PORTAL_ADMIN_KEY"]) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  const { app, locale } = req.params;
  // In path-to-regexp v8 (used by Express router@2), a named wildcard like
  // *key returns an array of decoded path segments, not a flat string.
  // Join with "/" to reconstruct the original dotted/slashed translation key
  // (e.g., ["nav", "home"] → "nav/home").
  const rawKey = (req.params as Record<string, string | string[]>)["key"] ?? "";
  const key = Array.isArray(rawKey) ? rawKey.join("/") : rawKey;
  if (!key) {
    res.status(400).json({ error: "Translation key must not be empty" });
    return;
  }
  const { value } = req.body as { value?: string };
  if (typeof value !== "string") {
    res.status(400).json({ error: "value must be a string" });
    return;
  }
  try {
    await pool.query(
      `INSERT INTO app_translations(app, locale, key, value, updated_at)
       VALUES($1, $2, $3, $4, NOW())
       ON CONFLICT ON CONSTRAINT app_translations_unique
       DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [app, locale, key, value]
    );
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[translations] PUT failed");
    res.status(500).json({ error: "Failed to update translation" });
  }
});

export default translationsRouter;
