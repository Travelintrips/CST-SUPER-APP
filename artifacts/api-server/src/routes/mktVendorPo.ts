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
import { z } from "zod/v4";
import {
  getVendorPoView,
  vendorAcceptPo,
  vendorRejectPo,
  vendorRequestRevision,
} from "../lib/services/mktPoLifecycleService.js";
import { logger } from "../lib/logger.js";
import { validateBody } from "../lib/middleware/validateBody.js";
import { tokenGetRateLimiter, tokenPostRateLimiter } from "../middlewares/securityRateLimiter.js";

const router: IRouter = Router();

const AcceptVendorPoSchema = z.object({}).strict();
const RejectVendorPoSchema = z.object({
  reason: z.string().trim().max(1000).optional().nullable(),
}).strict();

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

router.get("/:token", tokenGetRateLimiter, async (req, res) => {
  try {
    const token = typeof req.params.token === "string" ? req.params.token : "";
    const result = await getVendorPoView(token);
    if (!result.ok) {
      return res.status(mapTokenFailureStatus(result.code)).json({ message: "Token tidak valid atau kadaluarsa", code: result.code });
    }
    res.json(result.view);
  } catch (err) {
    logger.warn({ err }, "[mktVendorPo] GET /:token error");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/:token/accept", tokenPostRateLimiter, validateBody(AcceptVendorPoSchema), async (req, res) => {
  try {
    const token = typeof req.params.token === "string" ? req.params.token : "";
    const result = await vendorAcceptPo(token);
    if (!result.ok) {
      return res.status(mapTokenFailureStatus(result.code)).json({ message: "Aksi tidak dapat diproses", code: result.code, currentStatus: (result as any).currentStatus });
    }
    res.json({ ok: true, status: result.po.status, poNumber: result.po.poNumber, alreadyAccepted: result.alreadyAccepted === true });
  } catch (err) {
    logger.warn({ err }, "[mktVendorPo] POST /:token/accept error");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/:token/reject", tokenPostRateLimiter, validateBody(RejectVendorPoSchema), async (req, res) => {
  try {
    const token = typeof req.params.token === "string" ? req.params.token : "";
    const result = await vendorRejectPo(token, req.body.reason ?? null);
    if (!result.ok) {
      return res.status(mapTokenFailureStatus(result.code)).json({ message: "Aksi tidak dapat diproses", code: result.code, currentStatus: (result as any).currentStatus });
    }
    res.json({ ok: true, status: result.po.status, poNumber: result.po.poNumber, alreadyRejected: result.alreadyRejected === true });
  } catch (err) {
    logger.warn({ err }, "[mktVendorPo] POST /:token/reject error");
    res.status(500).json({ message: "Internal server error" });
  }
});

router.post("/:token/request-revision", tokenPostRateLimiter, async (req, res) => {
  try {
    const notes = typeof req.body?.notes === "string" ? req.body.notes.trim() : "";
    if (!notes) {
      return res.status(400).json({ message: "notes wajib diisi untuk permintaan revisi" });
    }
    const token = typeof req.params.token === "string" ? req.params.token : "";
    const result = await vendorRequestRevision(token, notes.slice(0, 4000));
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
