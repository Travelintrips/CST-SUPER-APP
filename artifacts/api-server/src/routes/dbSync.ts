import { Router, type Request, type Response } from "express";
import { requireAdmin } from "../lib/requireAdmin.js";

export const dbSyncRouter = Router();

/**
 * This endpoint used to copy data between the built-in Replit/Helium database
 * and Supabase. That creates an unsafe second source of truth, so the legacy
 * operation is intentionally unavailable.
 */
dbSyncRouter.get("/status", async (req: Request, res: Response) => {
  if (!await requireAdmin(req, res)) return;

  res.json({
    enabled: false,
    reason: "Supabase is the only application database; legacy Replit/Helium sync is disabled.",
    local: { configured: false, disabled: true },
    prod: { configured: !!process.env.SUPABASE_DATABASE_URL },
    dev: { configured: !!process.env.SUPABASE_DATABASE_URL_DEV },
    jobs: [],
  });
});

dbSyncRouter.post("/start", async (req: Request, res: Response) => {
  if (!await requireAdmin(req, res)) return;

  res.status(410).json({
    error: "Legacy Replit/Helium database synchronization is disabled.",
    guidance: "Use the explicit Supabase development or production migration/audit tools instead.",
  });
});

dbSyncRouter.get("/job/:jobId", async (req: Request, res: Response) => {
  if (!await requireAdmin(req, res)) return;
  res.status(410).json({ error: "Legacy database synchronization is disabled." });
});

dbSyncRouter.get("/stream/:jobId", async (req: Request, res: Response) => {
  if (!await requireAdmin(req, res)) return;
  res.status(410).json({ error: "Legacy database synchronization is disabled." });
});