import { Router, type Request, type Response } from "express";
import { resolveShortLink, lookupShortLinkRow, generateShortLink } from "../lib/shortLink.js";
import { sendAdminLinkRefreshedNotification } from "../lib/orderNotification.js";
import { logger } from "../lib/logger.js";

export const shortLinkRedirectRouter: Router = Router();

shortLinkRedirectRouter.get("/q/:code", async (req: Request, res: Response) => {
  const code = String(req.params.code ?? "").trim();
  if (!code || !/^[A-Z0-9]{4,32}$/i.test(code)) {
    return res.status(400).json({ error: "Invalid short link" });
  }

  // Normalisasi URL: ekstrak path saja agar link tetap bekerja meski domain di DB sudah berubah/salah
  function normalizeToPath(url: string): string {
    try {
      const parsed = new URL(url);
      return parsed.pathname + parsed.search + parsed.hash;
    } catch {
      return url; // sudah relative
    }
  }

  // Happy path: link valid dan belum expired
  const target = await resolveShortLink(code);
  if (target) {
    const redirectPath = normalizeToPath(target);

    // Deteksi WhatsApp / social-media bot agar tidak membaca OG tags dari SPA
    const ua = req.headers["user-agent"] ?? "";
    const isBot = /whatsapp|facebookexternalhit|twitterbot|linkedinbot|slackbot|telegrambot|discordbot/i.test(ua);
    if (isBot) {
      // Sajikan halaman HTML minimal tanpa branding CST agar link preview bersih
      const safeTarget = redirectPath.replace(/"/g, "&quot;");
      return res
        .set("Content-Type", "text/html; charset=utf-8")
        .set("X-Robots-Tag", "noindex,nofollow")
        .send(
          `<!DOCTYPE html><html><head><meta charset="UTF-8">` +
          `<title>Form Penawaran Vendor</title>` +
          `<meta property="og:title" content="Form Penawaran Vendor">` +
          `<meta property="og:description" content="Klik link untuk mengisi penawaran harga.">` +
          `<meta name="robots" content="noindex,nofollow">` +
          `<meta http-equiv="refresh" content="0;url=${safeTarget}">` +
          `</head><body><p><a href="${safeTarget}">Klik untuk melanjutkan</a></p></body></html>`
        );
    }
    return res.redirect(302, redirectPath);
  }

  // Cek apakah kode ada di DB (expired vs tidak ada sama sekali)
  const row = await lookupShortLinkRow(code);
  if (!row) {
    return res.status(404).json({ error: "Link tidak ditemukan." });
  }

  const isExpired = row.expiresAt != null && row.expiresAt.getTime() < Date.now();

  // Auto-refresh untuk admin_action links yang expired
  if (isExpired && row.context === "admin_action" && row.refId) {
    try {
      const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000); // 72 jam dari sekarang
      const newShortUrl = await generateShortLink(row.targetUrl, {
        context: "admin_action",
        refType: row.refType ?? undefined,
        refId: row.refId,
        expiresAt,
      });

      // Kirim notifikasi WA ke admin (fire and forget)
      sendAdminLinkRefreshedNotification(row.refId, newShortUrl).catch((err: unknown) =>
        logger.warn({ err, code }, "shortLink: expired refresh WA notification failed")
      );

      logger.info(
        { oldCode: code, refId: row.refId, newShortUrl },
        "shortLink: expired admin_action link auto-refreshed"
      );

      // Redirect langsung ke path (tanpa extra hop ke short link baru)
      return res.redirect(302, normalizeToPath(row.targetUrl));
    } catch (err) {
      logger.warn({ err, code }, "shortLink: auto-refresh failed, returning expired error");
    }
  }

  return res.status(410).json({ error: "Link sudah kadaluarsa.", isExpired: true });
});

// Alias /s/:code → resolve langsung (backward compat untuk link lama)
shortLinkRedirectRouter.get("/s/:code", async (req: Request, res: Response) => {
  const code = String(req.params.code ?? "").trim();
  if (!code || !/^[A-Z0-9]{4,32}$/i.test(code)) {
    return res.status(400).json({ error: "Invalid short link" });
  }
  function normalizeToPath(url: string): string {
    try { const p = new URL(url); return p.pathname + p.search + p.hash; } catch { return url; }
  }
  const target = await resolveShortLink(code);
  if (target) {
    const ua = req.headers["user-agent"] ?? "";
    const isBot = /whatsapp|facebookexternalhit|twitterbot|linkedinbot|slackbot|telegrambot|discordbot/i.test(ua);
    if (isBot) {
      const safeTarget = normalizeToPath(target).replace(/"/g, "&quot;");
      return res.set("Content-Type", "text/html; charset=utf-8").set("X-Robots-Tag", "noindex,nofollow").send(
        `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Form</title><meta http-equiv="refresh" content="0;url=${safeTarget}"></head><body><a href="${safeTarget}">Klik untuk melanjutkan</a></body></html>`
      );
    }
    return res.redirect(302, normalizeToPath(target));
  }
  const row = await lookupShortLinkRow(code);
  if (!row) return res.status(404).json({ error: "Link tidak ditemukan." });
  const isExpired = row.expiresAt != null && row.expiresAt.getTime() < Date.now();
  if (isExpired) return res.status(410).json({ error: "Link sudah kadaluarsa.", isExpired: true });
  return res.status(404).json({ error: "Link tidak ditemukan." });
});
