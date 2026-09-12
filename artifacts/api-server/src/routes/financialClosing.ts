import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../lib/requireAdmin.js";
import { logger } from "../lib/logger.js";
import { closeFinancialPeriod, createLedgerSnapshot } from "../lib/accounting.js";

const router = Router();
router.use(requireAdmin);

// ── GET /api/accounting/closing — daftar semua closing ───────────────────────
router.get("/", async (req, res) => {
  try {
    const companyId = req.query["companyId"] ? Number(req.query["companyId"]) : null;
    const rows = await db.execute(sql`
      SELECT fc.*, fp.is_closed AS period_locked
      FROM financial_closings fc
      LEFT JOIN financial_periods fp
        ON fp.company_id = fc.company_id
        AND fp.year  = SPLIT_PART(fc.period, '-', 1)::int
        AND fp.month = SPLIT_PART(fc.period, '-', 2)::int
      WHERE (${companyId} IS NULL OR fc.company_id = ${companyId})
      ORDER BY fc.period DESC
      LIMIT 120
    `);
    const data = (rows as { rows: unknown[] }).rows ?? (rows as unknown as unknown[]);
    return res.json(data);
  } catch (err) {
    logger.error({ err }, "GET /accounting/closing failed");
    return res.status(500).json({ message: "Gagal memuat daftar closing" });
  }
});

// ── GET /api/accounting/closing/:period — status satu periode ────────────────
router.get("/:period", async (req, res) => {
  try {
    const { period } = req.params;
    const companyId  = Number(req.query["companyId"] ?? 0);
    if (!period.match(/^\d{4}-\d{2}$/)) return res.status(400).json({ message: "Format periode harus YYYY-MM" });

    const rows = await db.execute(sql`
      SELECT fc.*,
             fp.is_closed    AS period_locked,
             fp.override_allowed
      FROM financial_closings fc
      LEFT JOIN financial_periods fp
        ON fp.company_id = fc.company_id
        AND fp.year  = SPLIT_PART(fc.period, '-', 1)::int
        AND fp.month = SPLIT_PART(fc.period, '-', 2)::int
      WHERE fc.company_id = ${companyId} AND fc.period = ${period}
    `);
    const data = (rows as { rows: unknown[] }).rows ?? (rows as unknown as unknown[]);
    return res.json(data[0] ?? null);
  } catch (err) {
    logger.error({ err }, "GET /accounting/closing/:period failed");
    return res.status(500).json({ message: "Gagal memuat status closing" });
  }
});

// ── GET /api/accounting/closing/:period/snapshot — ledger snapshot ───────────
router.get("/:period/snapshot", async (req, res) => {
  try {
    const { period } = req.params;
    const companyId  = Number(req.query["companyId"] ?? 0);
    if (!period.match(/^\d{4}-\d{2}$/)) return res.status(400).json({ message: "Format periode harus YYYY-MM" });

    // Cek apakah snapshot sudah ada
    const snapRows = await db.execute(sql`
      SELECT ls.*
      FROM ledger_snapshots ls
      WHERE ls.company_id = ${companyId} AND ls.period = ${period}
      ORDER BY ls.account_code
    `);
    const stored = (snapRows as { rows: unknown[] }).rows ?? (snapRows as unknown as unknown[]);

    if (stored.length > 0) {
      return res.json({ source: "snapshot", period, data: stored });
    }

    // Belum ada snapshot → generate live (preview mode, tidak disimpan)
    const live = await createLedgerSnapshot({ companyId, period });
    return res.json({ source: "live", period, data: live });
  } catch (err) {
    logger.error({ err }, "GET /accounting/closing/:period/snapshot failed");
    return res.status(500).json({ message: "Gagal memuat snapshot" });
  }
});

// ── POST /api/accounting/closing/:period/preview — preview tanpa commit ───────
router.post("/:period/preview", async (req, res) => {
  try {
    const { period } = req.params;
    const companyId  = Number(req.body?.companyId ?? 0);
    if (!period.match(/^\d{4}-\d{2}$/)) return res.status(400).json({ message: "Format periode harus YYYY-MM" });
    if (!companyId) return res.status(400).json({ message: "companyId wajib diisi" });

    const rows = await createLedgerSnapshot({ companyId, period });

    // Hitung net income preview
    let totalRevenue = 0;
    let totalExpense = 0;
    for (const r of rows) {
      if (r.accountCode.startsWith("4")) totalRevenue += r.periodCredit - r.periodDebit;
      else if (r.accountCode.startsWith("5") || r.accountCode.startsWith("6")) totalExpense += r.periodDebit - r.periodCredit;
    }
    const netIncome = Math.round((totalRevenue - totalExpense) * 100) / 100;

    return res.json({ period, companyId, netIncome, totalRevenue, totalExpense, snapshotPreview: rows });
  } catch (err) {
    logger.error({ err }, "POST /accounting/closing/:period/preview failed");
    return res.status(500).json({ message: "Gagal membuat preview closing" });
  }
});

// ── POST /api/accounting/closing/:period/close — tutup periode ────────────────
router.post("/:period/close", async (req, res) => {
  try {
    const { period } = req.params;
    if (!period.match(/^\d{4}-\d{2}$/)) return res.status(400).json({ message: "Format periode harus YYYY-MM" });

    const {
      companyId,
      notes,
      retainedEarningsAccountId,
      closingJournalId,
    } = req.body as {
      companyId:                  number;
      notes?:                     string;
      retainedEarningsAccountId?: number;
      closingJournalId?:          number;
    };

    if (!companyId) return res.status(400).json({ message: "companyId wajib diisi" });

    const closedBy = (req as { user?: { email?: string; id?: string } }).user?.email
      ?? (req as { user?: { email?: string; id?: string } }).user?.id
      ?? "admin";

    const result = await closeFinancialPeriod({
      companyId,
      period,
      closedBy,
      notes,
      retainedEarningsAccountId,
      closingJournalId,
    });

    logger.info({ result }, "Period closed via API");
    return res.json({ success: true, ...result });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith("ALREADY_CLOSED")) return res.status(409).json({ message: msg });
    logger.error({ err }, "POST /accounting/closing/:period/close failed");
    return res.status(500).json({ message: "Gagal menutup periode", detail: msg });
  }
});

// ── POST /api/accounting/closing/:period/reopen — buka kembali periode ────────
router.post("/:period/reopen", async (req, res) => {
  try {
    const { period } = req.params;
    if (!period.match(/^\d{4}-\d{2}$/)) return res.status(400).json({ message: "Format periode harus YYYY-MM" });

    const { companyId, reason } = req.body as { companyId: number; reason?: string };
    if (!companyId) return res.status(400).json({ message: "companyId wajib diisi" });

    const reopenedBy = (req as { user?: { email?: string; id?: string } }).user?.email
      ?? (req as { user?: { email?: string; id?: string } }).user?.id
      ?? "admin";

    const [yearStr, monthStr] = period.split("-");
    const year  = Number(yearStr);
    const month = Number(monthStr);

    await db.transaction(async (tx) => {
      // Buka lock period
      await tx.execute(sql`
        UPDATE financial_periods
        SET is_closed = FALSE, override_allowed = FALSE
        WHERE company_id = ${companyId} AND month = ${month} AND year = ${year}
      `);
      // Update closing status
      await tx.execute(sql`
        UPDATE financial_closings
        SET status = 'REOPENED', reopened_at = NOW(), reopened_by = ${reopenedBy},
            notes = COALESCE(notes || ' | ', '') || ${'Reopened: ' + (reason ?? '')}
        WHERE company_id = ${companyId} AND period = ${period}
      `);
    });

    logger.info({ companyId, period, reopenedBy }, "Period reopened via API");
    return res.json({ success: true, period, status: "REOPENED" });
  } catch (err: unknown) {
    logger.error({ err }, "POST /accounting/closing/:period/reopen failed");
    return res.status(500).json({ message: "Gagal membuka kembali periode" });
  }
});

export default router;
