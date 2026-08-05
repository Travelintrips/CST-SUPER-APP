/**
 * mktVendorPo.ts — Phase 2G: Public vendor PO confirmation (token-based)
 *
 * No admin session required — access is gated purely by the opaque 64-hex
 * vendor token embedded in the URL. Rate-limited via publicTokenRateLimiter
 * (mounted in routes/index.ts alongside other public token surfaces) to
 * blunt brute-force enumeration attempts.
 *
 * Endpoints:
 *   GET  /api/mkt/vendor-po/:token                    — sanitized PO view
 *   POST /api/mkt/vendor-po/:token/accept              — vendor accepts
 *   POST /api/mkt/vendor-po/:token/reject              — vendor rejects (body: { reason? })
 *   POST /api/mkt/vendor-po/:token/request-revision    — vendor requests changes (body: { notes })
 *
 * Never expose commission/margin/target price/ranking — getVendorPoView()
 * in mktPoLifecycleService.ts uses an explicit allow-list.
 */

import { Router, type IRouter } from "express";
import {
  getVendorPoView,
  vendorAcceptPo,
  vendorRejectPo,
  vendorRequestRevision,
} from "../lib/services/mktPoLifecycleService.js";
import { logger } from "../lib/logger.js";

const router: IRouter = Router();

function mapTokenFailureStatus(code: string): number {
  switch (code) {
    case "MALFORMED":
      return 400;
    case "EXPIRED":
      return 410;
    case "NOT_FOUND":
      return 404;
    case "INVALID_TRANSITION":
      return 409;
    case "CONCURRENT_UPDATE":
      return 409;
    default:
      return 400;
  }
}

router.get("/:token", async (req, res) => {
  try {
    const result = await getVendorPoView(req.params.token);
    if (!result.ok) {
      return res.status(mapTokenFailureStatus(result.code)).json({ message: "Token tidak valid atau kadaluarsa", code: result.code });
    }
    res.json(result.view);
  } catch (err) {
    logger.warn({ err }, "[mktVendorPo] GET /:token error");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/:token/accept", async (req, res) => {
  try {
    const result = await vendorAcceptPo(req.params.token);
    if (!result.ok) {
      return res.status(mapTokenFailureStatus(result.code)).json({ message: "Aksi tidak dapat diproses", code: result.code, currentStatus: (result as any).currentStatus });
    }
    res.json({ ok: true, status: result.po.status, poNumber: result.po.poNumber });
  } catch (err) {
    logger.warn({ err }, "[mktVendorPo] POST /:token/accept error");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/:token/reject", async (req, res) => {
  try {
    const reason = typeof req.body?.reason === "string" ? req.body.reason.slice(0, 2000) : null;
    const result = await vendorRejectPo(req.params.token, reason);
    if (!result.ok) {
      return res.status(mapTokenFailureStatus(result.code)).json({ message: "Aksi tidak dapat diproses", code: result.code, currentStatus: (result as any).currentStatus });
    }
    res.json({ ok: true, status: result.po.status, poNumber: result.po.poNumber });
  } catch (err) {
    logger.warn({ err }, "[mktVendorPo] POST /:token/reject error");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/:token/request-revision", async (req, res) => {
  try {
    const notes = typeof req.body?.notes === "string" ? req.body.notes.trim() : "";
    if (!notes) {
      return res.status(400).json({ message: "notes wajib diisi untuk permintaan revisi" });
    }
    const result = await vendorRequestRevision(req.params.token, notes.slice(0, 4000));
    if (!result.ok) {
      return res.status(mapTokenFailureStatus(result.code)).json({ message: "Aksi tidak dapat diproses", code: result.code, currentStatus: (result as any).currentStatus });
    }
    res.json({ ok: true, status: result.po.status, poNumber: result.po.poNumber });
  } catch (err) {
    logger.warn({ err }, "[mktVendorPo] POST /:token/request-revision error");
    res.status(500).json({ message: "Internal server error" });
  }
});

export default router;
