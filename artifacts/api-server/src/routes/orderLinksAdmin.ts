/**
 * Order Links Admin — ENTERPRISE DB PHASE 3C / 3D
 *
 * GET  /api/admin/order-links/dry-run  — preview candidate links (no writes)
 * POST /api/admin/order-links/backfill — controlled backfill (dryRun default true)
 *
 * Auth: enforced by the parent router.use("/admin/order-links") mount in routes/index.ts,
 * which calls requireAdmin(req,res)=>bool and only proceeds on true.
 * Do NOT add requireAdmin as route-level middleware here — it is a (req,res)=>bool
 * helper, not an Express (req,res,next) middleware, so it would silently block next().
 */

import { Router } from "express";
import type { Request, Response } from "express";
import { dryRunBackfillOrderLinks, backfillOrderLinks } from "../lib/services/orderLinkService.js";

export const orderLinksAdminRouter = Router();

// GET /api/admin/order-links/dry-run — preview candidates without writing
// Note: individual candidate queries run against Supabase pgBouncer. On slow/throttled
// connections the queries can hang; a 25-second wall-clock timeout guards the endpoint.
const DRY_RUN_TIMEOUT_MS = 25_000;

// Note: requireAdmin auth is enforced by the parent router.use("/admin/order-links") mount
// in routes/index.ts — do NOT add requireAdmin here again; it is a (req,res)=>bool helper,
// not an Express (req,res,next) middleware, so adding it as middleware causes the request to hang.
orderLinksAdminRouter.get("/dry-run", async (req: Request, res: Response) => {
  try {
    const limit = Math.min(Math.max(Number(req.query.limit ?? 5) || 5, 1), 50);
    const timeoutPromise = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error(`dry-run timed out after ${DRY_RUN_TIMEOUT_MS}ms — Supabase pool may be throttled`)), DRY_RUN_TIMEOUT_MS)
    );
    const report = await Promise.race([dryRunBackfillOrderLinks(limit), timeoutPromise]);
    return res.json(report);
  } catch (err) {
    const isTimeout = String(err).includes("timed out");
    return res.status(isTimeout ? 503 : 500).json({
      error: isTimeout ? "dry-run timed out — DB pool throttled, retry in a moment" : "Gagal membuat dry-run report order_links",
      detail: String(err),
    });
  }
});

// POST /api/admin/order-links/backfill
// Body: { dryRun?: boolean, limit?: number, linkTypes?: string[], companyId?: number }
//
// dryRun default true — always safe to call; pass dryRun=false for a real write.
// Returns BackfillResult: scanned / candidates / inserted / skippedExisting / errors / byLinkType
orderLinksAdminRouter.post("/backfill", async (req: Request, res: Response) => {
  try {
    const {
      dryRun    = true,
      limit     = 100,
      linkTypes,
      companyId,
    } = (req.body ?? {}) as {
      dryRun?:    boolean;
      limit?:     number;
      linkTypes?: string[];
      companyId?: number;
    };

    const timeoutPromise = new Promise<never>((_, rej) =>
      setTimeout(() => rej(new Error(`backfill timed out after ${DRY_RUN_TIMEOUT_MS}ms — Supabase pool may be throttled`)), DRY_RUN_TIMEOUT_MS)
    );
    const result = await Promise.race([
      backfillOrderLinks({
        dryRun:    Boolean(dryRun),
        limit:     Number(limit),
        linkTypes: Array.isArray(linkTypes) ? linkTypes : undefined,
        companyId: companyId != null ? Number(companyId) : undefined,
      }),
      timeoutPromise,
    ]);

    return res.json(result);
  } catch (err) {
    const isTimeout = String(err).includes("timed out");
    return res.status(isTimeout ? 503 : 500).json({
      error: isTimeout ? "backfill timed out — DB pool throttled, retry in a moment" : "Gagal menjalankan backfill order_links",
      detail: String(err),
    });
  }
});
