import { Router, type Request } from "express";
import { sql } from "drizzle-orm";
import { db, chartOfAccountsTable } from "@workspace/db";
import { requireAdmin } from "../lib/requireAdmin.js";
import { postEntry } from "../lib/accounting.js";
import { ensureAccountingSettings } from "../lib/accountingSeed.js";
import { resolveCompanyId } from "../lib/resolveCompany.js";
import { audit } from "../lib/unifiedAudit.js";
import { recalculateVendorDocPaymentStatus } from "../lib/vendorPaymentRecalc.js";

const router = Router();

// ─── DEPRECATED GUARD — before auth middleware ────────────────────────────────
// Phase 3: POST disabled. Returns 410 to all callers (authenticated or not)
// so external integrations know they must migrate to Bank Disbursement.
router.post("/", (_req, res) => {
  return res.status(410).json({
    error: "DEPRECATED",
    message: "Vendor Payments sudah deprecated. Gunakan Finance → Bank Disbursement.",
    redirectTo: "/accounting/bank-disbursements",
  });
});

router.use(async (req, res, next) => {
  if (!(await requireAdmin(req, res))) return;
  next();
});

// ─── Safety fallback migration (primary: runVendorPaymentsMigration in index.ts startup) ─────
// This singleton ensures the table exists even if startup migration ran before accounting_journals
// was seeded, or if the route is hit before the startup chain reaches this module.
let migrationPromise: Promise<void> | null = null;
function ensureTable(): Promise<void> {
  if (!migrationPromise) {
    migrationPromise = (async () => {
      await db.execute(sql.raw(
        `CREATE TABLE IF NOT EXISTS vendor_payments (
           id SERIAL PRIMARY KEY,
           company_id INTEGER,
           payment_number TEXT NOT NULL UNIQUE,
           supplier_id INTEGER,
           vendor_name TEXT NOT NULL,
           payment_date DATE NOT NULL,
           amount NUMERIC(14,2) NOT NULL,
           payment_method TEXT NOT NULL DEFAULT 'bank',
           reference TEXT,
           purchase_document_id INTEGER,
           bank_account_id INTEGER,
           status TEXT NOT NULL DEFAULT 'paid',
           journal_entry_id INTEGER,
           notes TEXT,
           created_by_id TEXT,
           created_at TIMESTAMPTZ DEFAULT NOW(),
           updated_at TIMESTAMPTZ DEFAULT NOW()
         )`
      ));
      // Idempotent additions — safe to swallow (column/index may already exist)
      await db.execute(sql.raw(`ALTER TABLE vendor_payments ADD COLUMN IF NOT EXISTS wht_amount NUMERIC(14,2) NOT NULL DEFAULT 0`)).catch(() => {});
      await db.execute(sql.raw(`ALTER TABLE vendor_payments ADD COLUMN IF NOT EXISTS wht_account_id INTEGER`)).catch(() => {});
      await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS vendor_payments_company_idx ON vendor_payments(company_id)`)).catch(() => {});
      await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS vendor_payments_supplier_idx ON vendor_payments(supplier_id)`)).catch(() => {});
    })().catch((err) => {
      migrationPromise = null; // allow retry on next call
      throw err;              // surface the error to the route handler → 500
    });
  }
  return migrationPromise;
}

async function nextPaymentNumber(companyId: number | null, offset = 0): Promise<string> {
  const prefix = "VPY";
  const year = new Date().getFullYear();
  const co = companyId ? String(companyId).padStart(2, "0") : "00";
  const pattern = `${prefix}/${year}/${co}/%`;
  const rows = await db.execute(sql.raw(
    `SELECT COALESCE(MAX(CAST(SPLIT_PART(payment_number, '/', 4) AS INTEGER)), 0) AS max_seq
     FROM vendor_payments WHERE payment_number LIKE '${pattern}'`
  ));
  const maxSeq = Number((rows.rows[0] as any)?.max_seq ?? 0);
  const seq = maxSeq + 1 + offset;
  return `${prefix}/${year}/${co}/${String(seq).padStart(5, "0")}`;
}

// ─── GET /api/vendor-payments ─────────────────────────────────────────────────
router.get("/", async (req: Request, res) => {
  await ensureTable();
  const companyId = await resolveCompanyId(req);
  const { supplierId, from, to } = req.query as Record<string, string>;

  let where = companyId ? `WHERE company_id = ${companyId}` : "WHERE TRUE";
  if (supplierId) where += ` AND supplier_id = ${parseInt(supplierId)}`;
  if (from) where += ` AND payment_date >= '${from}'`;
  if (to)   where += ` AND payment_date <= '${to}'`;

  const rows = await db.execute(sql.raw(
    `SELECT vp.*, s.name AS supplier_name_ref
     FROM vendor_payments vp
     LEFT JOIN suppliers s ON s.id = vp.supplier_id
     ${where} ORDER BY vp.id DESC LIMIT 500`
  ));
  return res.json(rows.rows);
});

// ─── GET /api/vendor-payments/summary ────────────────────────────────────────
router.get("/summary", async (req: Request, res) => {
  await ensureTable();
  const companyId = await resolveCompanyId(req);
  const where = `WHERE company_id = ${companyId}`;
  const rows = await db.execute(sql.raw(`
    SELECT
      COUNT(*) AS total_count,
      COALESCE(SUM(amount), 0) AS total_amount,
      COUNT(*) FILTER (WHERE payment_method = 'bank') AS bank_count,
      COUNT(*) FILTER (WHERE payment_method = 'cash') AS cash_count,
      COUNT(*) FILTER (WHERE payment_date >= DATE_TRUNC('month', NOW())) AS this_month_count,
      COALESCE(SUM(amount) FILTER (WHERE payment_date >= DATE_TRUNC('month', NOW())), 0) AS this_month_amount
    FROM vendor_payments ${where}
  `));
  return res.json(rows.rows[0] ?? {});
});

// ─── GET /api/vendor-payments/:id ────────────────────────────────────────────
router.get("/:id", async (req: Request, res) => {
  await ensureTable();
  const companyId = await resolveCompanyId(req);
  const id = parseInt(String(req.params.id));
  const result = await db.execute(sql.raw(`
    SELECT vp.*, s.name AS supplier_name_ref, s.contact_email AS supplier_email
    FROM vendor_payments vp
    LEFT JOIN suppliers s ON s.id = vp.supplier_id
    WHERE vp.id = ${id} AND vp.company_id = ${companyId}
  `));
  const row = result.rows[0];
  if (!row) return res.status(404).json({ message: "Pembayaran tidak ditemukan." });
  return res.json(row);
});

// ─── POST /api/vendor-payments ─── DEPRECATED (Phase 3) ─────────────────────
// Guard is registered at the top of the router, before auth middleware.

// ─── [Phase 3] POST /api/vendor-payments archived — see docs/deprecation/bank-disbursement-sole-executor.md
// Original: INSERT vendor_payments + postEntry DR Hutang / CR Bank. Now handled by Bank Disbursement (supplier_payment).

// ─── DELETE /api/vendor-payments/:id ─────────────────────────────────────────
router.delete("/:id", async (req: Request, res) => {
  await ensureTable();
  const companyId = await resolveCompanyId(req);
  const id = parseInt(String(req.params.id));
  const result = await db.execute(sql.raw(`SELECT * FROM vendor_payments WHERE id = ${id} AND company_id = ${companyId}`));
  if (!result.rows[0]) return res.status(404).json({ message: "Pembayaran tidak ditemukan." });
  const before = result.rows[0] as Record<string, unknown>;
  await db.execute(sql.raw(`DELETE FROM vendor_payments WHERE id = ${id} AND company_id = ${companyId}`));
  audit(req as Request, {
    action: "delete",
    module: "payment",
    resourceId: String((before.payment_number as string | undefined) ?? id),
    before,
  });

  // Re-recalculate setelah hapus — status mungkin kembali ke partial/unpaid
  const purchaseDocId = before.purchase_document_id as number | null | undefined;
  if (purchaseDocId) {
    void recalculateVendorDocPaymentStatus(purchaseDocId).catch(() => {});
  }

  return res.json({ ok: true });
});

export default router;
