/**
 * WhatsApp Daily Report Settings Routes
 * GET  /api/accounting/wa-report/settings
 * PUT  /api/accounting/wa-report/settings
 * POST /api/accounting/wa-report/send-now
 */
import { Router } from "express";
import { requireAdmin } from "../lib/requireAdmin.js";
import {
  getReportSettings,
  updateReportSettings,
  runDailyReport,
  previewDailyReport,
  ensureReportSettingsTable,
} from "../lib/dailyReportWorker.js";

const router = Router();

router.use(async (req, res, next) => {
  if (!(await requireAdmin(req, res))) return;
  next();
});

void ensureReportSettingsTable().catch(() => {});

router.get("/settings", async (_req, res) => {
  try {
    const settings = await getReportSettings();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.put("/settings", async (req, res) => {
  try {
    const { enabled, sendHourWib, recipients } = req.body as Record<string, unknown>;
    const patch: Parameters<typeof updateReportSettings>[0] = {};
    if (enabled !== undefined) patch.enabled = Boolean(enabled);
    if (sendHourWib !== undefined) patch.sendHourWib = Number(sendHourWib);
    if (Array.isArray(recipients)) patch.recipients = recipients.map(String).filter(Boolean);
    await updateReportSettings(patch);
    const updated = await getReportSettings();
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post("/preview", async (req, res) => {
  try {
    const forceDate = (req.body as Record<string, unknown>).date as string | undefined;
    const result = await previewDailyReport(forceDate);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

router.post("/send-now", async (req, res) => {
  try {
    const forceDate = (req.body as Record<string, unknown>).date as string | undefined;
    const result = await runDailyReport(forceDate);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: String(err) });
  }
});

export default router;
