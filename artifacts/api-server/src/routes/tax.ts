import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../lib/requireAdmin.js";
import { seedDefaultTaxRules } from "../lib/taxRulesMigration.js";
import { logger } from "../lib/logger.js";
import { audit } from "../lib/unifiedAudit.js";
import { writeAuditLog, extractRequestMeta } from "../lib/auditLog.js";
import { validateNpwp, formatNpwp, stripNpwp } from "../lib/npwpValidator.js";
import { validateFakturPajak, formatFaktur } from "../lib/fakturPajakValidator.js";
import { calculatePph21, calculatePph21NonPegawai, PTKP_OPTIONS, type PtkpStatus } from "../lib/pph21Calculator.js";
import { assertCompanyAccess } from "../lib/assertCompanyAccess.js";
import { resolveCompanyId } from "../lib/resolveCompany.js";
import {
  runTaxReconciliation,
  generateFakturNumbers,
  generateBupotNumbers,
} from "../lib/taxReconciliationService.js";
import sptBuilderRouter from "./taxSpt.js";
import {
  exportPpnCsv,
  exportPph23Csv,
  exportPph21Csv,
} from "../lib/taxCoretaxFormatter.js";
import { buildSptDraft } from "../lib/taxSptBuilderService.js";
import { guardTaxPeriodFromRequest } from "../lib/taxPeriodGuard.js";
import {
  bootMigrateSptDrafts,
  ensureUniqueConstraint,
  saveSptDraft,
  listSptDrafts,
  updateSptDraftStatus,
} from "../lib/taxSptDraftRepository.js";

const router = Router();

router.use(async (req, res, next) => {
  const ok = await requireAdmin(req, res);
  if (ok) next();
});

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ── GET /api/tax/dashboard ───────────────────────────────────────────────────
router.get("/dashboard", async (req, res) => {
  const companyId = resolveCompanyId(req);
  const period = (req.query.period as string) || currentPeriod();

  await seedDefaultTaxRules(companyId);

  const [ppnOut, ppnIn, pphRows, pendingCount, noNpwpCount, noInvoiceCount] = await Promise.all([
    db.execute(sql`
      SELECT COALESCE(SUM(tax_amount), 0)::numeric AS total
      FROM transaction_taxes
      WHERE company_id = ${companyId} AND period = ${period}
        AND (tax_name ILIKE '%ppn%' OR tax_name ILIKE '%vat%')
        AND (direction = 'output' OR direction IS NULL)
    `),
    db.execute(sql`
      SELECT COALESCE(SUM(tax_amount), 0)::numeric AS total
      FROM transaction_taxes
      WHERE company_id = ${companyId} AND period = ${period}
        AND (tax_name ILIKE '%ppn%masukan%' OR tax_name ILIKE '%vat%input%')
        AND direction = 'input'
    `),
    db.execute(sql`
      SELECT tax_name, COALESCE(SUM(tax_amount),0)::numeric AS total, COUNT(*)::int AS cnt
      FROM transaction_taxes
      WHERE company_id = ${companyId} AND period = ${period}
        AND tax_name NOT ILIKE '%ppn%'
      GROUP BY tax_name
      ORDER BY total DESC
    `),
    db.execute(sql`
      SELECT COUNT(*)::int AS cnt
      FROM transaction_taxes
      WHERE company_id = ${companyId} AND period = ${period} AND status = 'pending'
    `),
    db.execute(sql`
      SELECT COUNT(*)::int AS cnt
      FROM transaction_taxes
      WHERE company_id = ${companyId} AND period = ${period} AND npwp IS NULL
    `),
    db.execute(sql`
      SELECT COUNT(*)::int AS cnt
      FROM transaction_taxes
      WHERE company_id = ${companyId} AND period = ${period}
        AND (tax_name ILIKE '%ppn%') AND tax_invoice_number IS NULL
    `),
  ]);

  const ppnKeluaran = Number((ppnOut.rows[0] as any).total);
  const ppnMasukan = Number((ppnIn.rows[0] as any).total);
  const ppnKurangBayar = ppnKeluaran - ppnMasukan;

  return res.json({
    period,
    ppnKeluaran,
    ppnMasukan,
    ppnKurangBayar,
    pphRows: pphRows.rows.map((r: any) => ({
      taxName: r.tax_name,
      total: Number(r.total),
      count: Number(r.cnt),
    })),
    pendingCount: Number((pendingCount.rows[0] as any).cnt),
    noNpwpCount: Number((noNpwpCount.rows[0] as any).cnt),
    noInvoiceCount: Number((noInvoiceCount.rows[0] as any).cnt),
  });
});

// ── GET /api/tax/rules ───────────────────────────────────────────────────────
router.get("/rules", async (req, res) => {
  const companyId = resolveCompanyId(req);
  await seedDefaultTaxRules(companyId);
  const rows = await db.execute(sql`
    SELECT * FROM tax_rules WHERE company_id = ${companyId} ORDER BY is_active DESC, transaction_type, name
  `);
  return res.json({ data: rows.rows });
});

// ── POST /api/tax/rules ──────────────────────────────────────────────────────
router.post("/rules", async (req, res) => {
  const companyId = resolveCompanyId(req);
  const { name, transaction_type, module_source, tax_type, tax_rate, tax_base_type, direction, is_active, effective_from, effective_to, notes } = req.body;
  if (!name || !transaction_type || !tax_type) {
    return res.status(400).json({ message: "name, transaction_type, tax_type wajib diisi" });
  }
  const [row] = (await db.execute(sql`
    INSERT INTO tax_rules (company_id, name, transaction_type, module_source, tax_type, tax_rate, tax_base_type, direction, is_active, effective_from, effective_to, notes)
    VALUES (
      ${companyId}, ${name}, ${transaction_type}, ${module_source ?? "all"}, ${tax_type},
      ${Number(tax_rate ?? 0)}, ${tax_base_type ?? "dpp"}, ${direction ?? "output"},
      ${is_active !== false}, ${effective_from ?? null}, ${effective_to ?? null}, ${notes ?? null}
    )
    RETURNING *
  `)).rows;
  audit(req, { action: "create", module: "tax", resourceId: String((row as any)?.id ?? "?"), after: row as Record<string, unknown>, companyId });
  return res.json({ ok: true, data: row });
});

// ── PUT /api/tax/rules/:id ────────────────────────────────────────────────────
router.put("/rules/:id", async (req, res) => {
  const id = Number(req.params.id);
  const { name, transaction_type, module_source, tax_type, tax_rate, tax_base_type, direction, is_active, effective_from, effective_to, notes } = req.body;
  const [before] = (await db.execute(sql`SELECT * FROM tax_rules WHERE id = ${id}`)).rows;
  if (!before) return res.status(404).json({ message: "Rule tidak ditemukan" });
  const cid = resolveCompanyId(req);
  if (!await assertCompanyAccess((before as any).company_id, cid, req, res, { resourceType: "tax_rule", resourceId: id })) return;
  const [row] = (await db.execute(sql`
    UPDATE tax_rules SET
      name = COALESCE(${name ?? null}, name),
      transaction_type = COALESCE(${transaction_type ?? null}, transaction_type),
      module_source = COALESCE(${module_source ?? null}, module_source),
      tax_type = COALESCE(${tax_type ?? null}, tax_type),
      tax_rate = COALESCE(${tax_rate != null ? Number(tax_rate) : null}, tax_rate),
      tax_base_type = COALESCE(${tax_base_type ?? null}, tax_base_type),
      direction = COALESCE(${direction ?? null}, direction),
      is_active = COALESCE(${is_active}, is_active),
      effective_from = ${effective_from ?? null},
      effective_to = ${effective_to ?? null},
      notes = ${notes ?? null},
      updated_at = NOW()
    WHERE id = ${id}
    RETURNING *
  `)).rows;
  if (!row) return res.status(404).json({ message: "Rule tidak ditemukan" });
  audit(req, { action: "update", module: "tax", resourceId: String(id), before: before as Record<string, unknown>, after: row as Record<string, unknown> });
  return res.json({ ok: true, data: row });
});

// ── DELETE /api/tax/rules/:id ─────────────────────────────────────────────────
router.delete("/rules/:id", async (req, res) => {
  const id = Number(req.params.id);
  const [before] = (await db.execute(sql`SELECT * FROM tax_rules WHERE id = ${id}`)).rows;
  if (!before) return res.status(404).json({ message: "Rule tidak ditemukan" });
  const cid = resolveCompanyId(req);
  if (!await assertCompanyAccess((before as any).company_id, cid, req, res, { resourceType: "tax_rule", resourceId: id })) return;
  await db.execute(sql`DELETE FROM tax_rules WHERE id = ${id}`);
  audit(req, { action: "delete", module: "tax", resourceId: String(id), before: before as Record<string, unknown> });
  return res.json({ ok: true });
});

// ── GET /api/tax/transactions ─────────────────────────────────────────────────
router.get("/transactions", async (req, res) => {
  const companyId = resolveCompanyId(req);
  const { period, status, tax_type, search, sptStatus, page = "1", limit = "50" } = req.query as Record<string, string>;
  const pageN = Math.max(1, parseInt(page) || 1);
  const limitN = Math.min(200, parseInt(limit) || 50);
  const offset = (pageN - 1) * limitN;

  const whereParts = [`company_id = ${companyId}`];
  if (period) whereParts.push(`period = '${period.replace(/'/g, "''")}'`);
  if (status) whereParts.push(`status = '${status.replace(/'/g, "''")}'`);
  if (tax_type) whereParts.push(`tax_name ILIKE '%${tax_type.replace(/'/g, "''")}%'`);
  if (search) whereParts.push(`(transaction_ref ILIKE '%${search.replace(/'/g, "''")}%' OR partner_name ILIKE '%${search.replace(/'/g, "''")}%')`);
  if (sptStatus) {
    const validSptStatuses = ["INCLUDED", "EXCLUDED", "PENDING"];
    if (validSptStatuses.includes(sptStatus.toUpperCase())) {
      if (sptStatus.toUpperCase() === "PENDING") {
        whereParts.push(`(spt_status IS NULL OR spt_status = 'PENDING')`);
      } else {
        whereParts.push(`spt_status = '${sptStatus.toUpperCase()}'`);
      }
    }
  }
  const where = whereParts.join(" AND ");

  const [rows, countRow] = await Promise.all([
    db.execute(sql.raw(`
      SELECT * FROM transaction_taxes WHERE ${where}
      ORDER BY created_at DESC LIMIT ${limitN} OFFSET ${offset}
    `)),
    db.execute(sql.raw(`SELECT COUNT(*)::int AS cnt FROM transaction_taxes WHERE ${where}`)),
  ]);

  return res.json({
    data: rows.rows.map((r: any) => ({
      ...r,
      baseAmount: Number(r.base_amount),
      taxAmount: Number(r.tax_amount),
      taxRate: Number(r.tax_rate),
    })),
    total: Number((countRow.rows[0] as any).cnt),
    page: pageN,
    limit: limitN,
  });
});

// ── GET /api/tax/ppn ──────────────────────────────────────────────────────────
router.get("/ppn", async (req, res) => {
  const companyId = resolveCompanyId(req);
  const { period_from, period_to, period } = req.query as Record<string, string>;

  const periodCond = period
    ? `AND period = '${period}'`
    : period_from && period_to
    ? `AND period >= '${period_from}' AND period <= '${period_to}'`
    : "";

  const [keluaran, masukan] = await Promise.all([
    db.execute(sql.raw(`
      SELECT period, transaction_type, transaction_ref, partner_name, npwp, tax_invoice_number,
             base_amount::numeric, tax_amount::numeric, tax_rate::numeric, status, created_at
      FROM transaction_taxes
      WHERE company_id = ${companyId}
        AND (tax_name ILIKE '%ppn%' OR tax_name ILIKE '%vat%')
        AND (direction = 'output' OR direction IS NULL)
        ${periodCond}
      ORDER BY period DESC, created_at DESC
      LIMIT 500
    `)),
    db.execute(sql.raw(`
      SELECT period, transaction_type, transaction_ref, partner_name, npwp, tax_invoice_number,
             base_amount::numeric, tax_amount::numeric, tax_rate::numeric, status, created_at
      FROM transaction_taxes
      WHERE company_id = ${companyId}
        AND tax_name ILIKE '%masukan%'
        AND direction = 'input'
        ${periodCond}
      ORDER BY period DESC, created_at DESC
      LIMIT 500
    `)),
  ]);

  return res.json({ keluaran: keluaran.rows, masukan: masukan.rows });
});

// ── GET /api/tax/pph ──────────────────────────────────────────────────────────
router.get("/pph", async (req, res) => {
  const companyId = resolveCompanyId(req);
  const { period } = req.query as Record<string, string>;
  const periodCond = period ? `AND period = '${period}'` : "";

  const rows = await db.execute(sql.raw(`
    SELECT period, tax_name, transaction_type, transaction_ref, partner_name, npwp,
           base_amount::numeric, tax_amount::numeric, tax_rate::numeric,
           direction, status, created_at
    FROM transaction_taxes
    WHERE company_id = ${companyId}
      AND tax_name NOT ILIKE '%ppn%'
      AND direction = 'withholding'
      ${periodCond}
    ORDER BY period DESC, tax_name, created_at DESC
    LIMIT 1000
  `));

  const grouped: Record<string, any> = {};
  for (const r of rows.rows as any[]) {
    const key = r.tax_name;
    if (!grouped[key]) grouped[key] = { taxName: key, rows: [], total: 0, count: 0 };
    grouped[key].rows.push(r);
    grouped[key].total += Number(r.tax_amount);
    grouped[key].count += 1;
  }
  return res.json({ groups: Object.values(grouped) });
});

// ── GET /api/tax/spt ──────────────────────────────────────────────────────────
router.get("/spt", async (req, res) => {
  const companyId = resolveCompanyId(req);
  const { year } = req.query as Record<string, string>;
  const y = year ?? new Date().getFullYear().toString();

  const rows = await db.execute(sql.raw(`
    SELECT
      period,
      tax_name,
      direction,
      COUNT(*)::int AS cnt,
      COALESCE(SUM(base_amount),0)::numeric AS total_base,
      COALESCE(SUM(tax_amount),0)::numeric AS total_tax,
      SUM(CASE WHEN status = 'paid' THEN tax_amount ELSE 0 END)::numeric AS paid,
      SUM(CASE WHEN status = 'reported' THEN tax_amount ELSE 0 END)::numeric AS reported,
      SUM(CASE WHEN status = 'pending' THEN tax_amount ELSE 0 END)::numeric AS pending
    FROM transaction_taxes
    WHERE company_id = ${companyId} AND period LIKE '${y}%'
    GROUP BY period, tax_name, direction
    ORDER BY period, tax_name
  `));

  return res.json({ year: y, data: rows.rows });
});

// ── GET /api/tax/export ───────────────────────────────────────────────────────
router.get("/export", async (req, res) => {
  const companyId = resolveCompanyId(req);
  const { period, period_from, period_to, type } = req.query as Record<string, string>;

  const whereParts = [`company_id = ${companyId}`];
  if (period) whereParts.push(`period = '${period}'`);
  if (period_from) whereParts.push(`period >= '${period_from}'`);
  if (period_to) whereParts.push(`period <= '${period_to}'`);
  if (type) whereParts.push(`tax_name ILIKE '%${type.replace(/'/g, "''")}%'`);
  const where = whereParts.join(" AND ");

  const rows = await db.execute(sql.raw(`
    SELECT * FROM transaction_taxes WHERE ${where} ORDER BY period, created_at
  `));

  const header = "Periode,Jenis Transaksi,Referensi,Partner,NPWP,No. Faktur Pajak,Nama Pajak,Tarif (%),DPP,Pajak,Arah,Status,Tanggal";
  const lines = (rows.rows as any[]).map((r) =>
    [
      r.period, r.transaction_type, r.transaction_ref ?? "", r.partner_name ?? "",
      r.npwp ?? "", r.tax_invoice_number ?? "", r.tax_name,
      Number(r.tax_rate).toFixed(3), Number(r.base_amount).toFixed(2),
      Number(r.tax_amount).toFixed(2), r.direction ?? "output", r.status,
      new Date(r.created_at).toISOString().slice(0, 10),
    ].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(","),
  );

  const csv = [header, ...lines].join("\n");
  const filename = `tax-export-${period ?? period_from ?? "all"}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.send("\uFEFF" + csv);
});

// ── GET /api/tax/reconciliation ───────────────────────────────────────────────
router.get("/reconciliation", async (req, res) => {
  const companyId = resolveCompanyId(req);
  const { year } = req.query as Record<string, string>;
  const y = year ?? new Date().getFullYear().toString();

  const [summary, gaps, byPeriod] = await Promise.all([
    // Summary tahunan per jenis pajak
    db.execute(sql.raw(`
      SELECT
        tax_name,
        direction,
        COUNT(*)::int                                              AS total_tx,
        COALESCE(SUM(base_amount),0)::numeric                     AS total_dpp,
        COALESCE(SUM(tax_amount),0)::numeric                      AS total_tax,
        SUM(CASE WHEN status='paid'     THEN tax_amount ELSE 0 END)::numeric AS paid,
        SUM(CASE WHEN status='reported' THEN tax_amount ELSE 0 END)::numeric AS reported,
        SUM(CASE WHEN status='pending'  THEN tax_amount ELSE 0 END)::numeric AS pending,
        SUM(CASE WHEN npwp IS NULL OR npwp='' THEN 1 ELSE 0 END)::int       AS missing_npwp,
        SUM(CASE WHEN tax_invoice_number IS NULL OR tax_invoice_number='' THEN 1 ELSE 0 END)::int AS missing_faktur
      FROM transaction_taxes
      WHERE company_id = ${companyId} AND period LIKE '${y}%'
      GROUP BY tax_name, direction
      ORDER BY tax_name, direction
    `)),
    // Baris yang belum lengkap (missing NPWP atau faktur, masih pending)
    db.execute(sql.raw(`
      SELECT id, period, tax_name, direction, transaction_type, transaction_ref,
             partner_name, npwp, tax_invoice_number,
             base_amount::numeric, tax_amount::numeric, status, created_at
      FROM transaction_taxes
      WHERE company_id = ${companyId} AND period LIKE '${y}%'
        AND status = 'pending'
        AND (npwp IS NULL OR npwp = '' OR tax_invoice_number IS NULL OR tax_invoice_number = '')
      ORDER BY period DESC, tax_name, created_at DESC
      LIMIT 200
    `)),
    // Monthly breakdown per jenis pajak
    db.execute(sql.raw(`
      SELECT
        period,
        tax_name,
        direction,
        COUNT(*)::int                                              AS total_tx,
        COALESCE(SUM(tax_amount),0)::numeric                      AS total_tax,
        SUM(CASE WHEN status='paid'     THEN tax_amount ELSE 0 END)::numeric AS paid,
        SUM(CASE WHEN status='reported' THEN tax_amount ELSE 0 END)::numeric AS reported,
        SUM(CASE WHEN status='pending'  THEN tax_amount ELSE 0 END)::numeric AS pending,
        SUM(CASE WHEN npwp IS NULL OR npwp='' THEN 1 ELSE 0 END)::int       AS missing_npwp,
        SUM(CASE WHEN tax_invoice_number IS NULL OR tax_invoice_number='' THEN 1 ELSE 0 END)::int AS missing_faktur
      FROM transaction_taxes
      WHERE company_id = ${companyId} AND period LIKE '${y}%'
      GROUP BY period, tax_name, direction
      ORDER BY period DESC, tax_name
    `)),
  ]);

  return res.json({
    year: y,
    summary: summary.rows,
    gaps: gaps.rows,
    byPeriod: byPeriod.rows,
  });
});

// ── PATCH /api/tax/reconciliation/bulk-status ──────────────────────────────────
// Protected by router-level requireAdmin middleware (lines 14-17).
// Explicit guard added for defence-in-depth.
router.patch("/reconciliation/bulk-status", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;

  const meta = extractRequestMeta(req);
  const companyId = resolveCompanyId(req);
  const { period, taxName, status, oldStatus } = req.body as {
    period?: string;
    taxName?: string;
    status: "pending" | "paid" | "reported";
    oldStatus?: string;
  };

  if (!["pending", "paid", "reported"].includes(status)) {
    return res.status(400).json({ message: "status harus pending / paid / reported" });
  }

  // ── FASE 4 C4: Period lock guard ──────────────────────────────────────────
  if (period) {
    if (!(await guardTaxPeriodFromRequest(companyId, period, res))) return;
  }

  const conds = [`company_id = ${companyId}`];
  if (period) conds.push(`period = '${period.replace(/'/g, "''")}'`);
  if (taxName) conds.push(`tax_name ILIKE '${taxName.replace(/'/g, "''")}%'`);

  const paidAtSet = status === "paid"     ? `, paid_at = NOW()`     : status === "reported" ? `, reported_at = NOW()` : "";
  const result = await db.execute(sql.raw(`
    UPDATE transaction_taxes
    SET status = '${status}', updated_at = NOW()${paidAtSet}
    WHERE ${conds.join(" AND ")}
    RETURNING id
  `));

  const recordCount = result.rows.length;
  logger.info({ companyId, period, taxName, status, count: recordCount }, "[tax] bulk-status updated");

  writeAuditLog({
    ...meta,
    companyId,
    action: "TAX_BULK_STATUS_UPDATE",
    module: "accounting",
    referenceId: `tax-bulk-status:${companyId}`,
    newData: {
      userId: meta.userId,
      companyId,
      affectedRecords: recordCount,
      oldStatus: oldStatus ?? null,
      newStatus: status,
      period: period ?? null,
      taxName: taxName ?? null,
      timestamp: new Date().toISOString(),
    },
  });

  return res.json({ ok: true, updated: recordCount });
});

// ── PATCH /api/tax/transactions/:id/npwp ──────────────────────────────────────
router.patch("/transactions/:id/npwp", async (req, res) => {
  const id = Number(req.params.id);
  const { npwp, taxInvoiceNumber, partnerName } = req.body;

  // Validasi format NPWP jika diisi
  if (npwp && npwp.trim()) {
    const npwpResult = validateNpwp(npwp);
    if (!npwpResult.valid) {
      return res.status(400).json({
        message: `NPWP tidak valid: ${npwpResult.error}`,
        field: "npwp",
        validation: npwpResult,
      });
    }
    // Normalisasi ke format standar XX.XXX.XXX.X-XXX.XXX
    req.body.npwp = npwpResult.formatted;
  }

  // Validasi format nomor faktur pajak jika diisi
  if (taxInvoiceNumber && taxInvoiceNumber.trim()) {
    const fakturResult = validateFakturPajak(taxInvoiceNumber);
    if (!fakturResult.valid) {
      return res.status(400).json({
        message: `Nomor faktur tidak valid: ${fakturResult.error}`,
        field: "taxInvoiceNumber",
        validation: fakturResult,
      });
    }
    // Normalisasi ke format standar KKK.SSS-TT.SSSSSSSS
    req.body.taxInvoiceNumber = fakturResult.formatted;
  }

  const normalizedNpwp = req.body.npwp ?? null;
  const normalizedFaktur = req.body.taxInvoiceNumber ?? null;

  const [before] = (await db.execute(sql`SELECT npwp, tax_invoice_number, partner_name, company_id, period FROM transaction_taxes WHERE id = ${id}`)).rows;
  if (!before) return res.status(404).json({ message: "Transaksi pajak tidak ditemukan" });
  const cid = resolveCompanyId(req);
  if (!await assertCompanyAccess((before as any).company_id, cid, req, res, { resourceType: "transaction_tax", resourceId: id })) return;

  // ── FASE 4 C4: Period lock guard ──────────────────────────────────────────
  if (!(await guardTaxPeriodFromRequest((before as any).company_id, (before as any).period, res))) return;

  await db.execute(sql`
    UPDATE transaction_taxes SET
      npwp = ${normalizedNpwp},
      tax_invoice_number = ${normalizedFaktur},
      partner_name = ${partnerName ?? null},
      updated_at = NOW()
    WHERE id = ${id}
  `);
  audit(req, {
    action: "update",
    module: "tax",
    resourceId: String(id),
    before: before as Record<string, unknown>,
    after: { npwp: normalizedNpwp, taxInvoiceNumber: normalizedFaktur, partnerName: partnerName ?? null },
  });
  return res.json({ ok: true, npwp: normalizedNpwp, taxInvoiceNumber: normalizedFaktur });
});

// ── POST /api/tax/validate/npwp ───────────────────────────────────────────────
router.post("/validate/npwp", (req, res) => {
  const { npwp, loose = false } = req.body;
  if (!npwp) return res.status(400).json({ message: "npwp wajib diisi" });

  const result = loose
    ? (() => {
        const digits = stripNpwp(String(npwp));
        if (digits.length !== 15)
          return { valid: false, formatted: null, normalized: digits.length > 0 ? digits : null, error: `NPWP harus 15 digit (ditemukan ${digits.length} digit)` };
        return { valid: true, formatted: formatNpwp(digits), normalized: digits };
      })()
    : validateNpwp(String(npwp));

  return res.json(result);
});

// ── POST /api/tax/validate/faktur ─────────────────────────────────────────────
router.post("/validate/faktur", (req, res) => {
  const { faktur } = req.body;
  if (!faktur) return res.status(400).json({ message: "faktur wajib diisi" });
  const result = validateFakturPajak(String(faktur));
  return res.json(result);
});

// ── POST /api/tax/pph21/calculate ─────────────────────────────────────────────
router.post("/pph21/calculate", (req, res) => {
  const {
    grossMonthly, ptkpStatus = "TK/0", useTer = false, nonPegawai = false,
    grossAmount, hasNpwp,
  } = req.body;

  if (nonPegawai) {
    if (!grossAmount) return res.status(400).json({ message: "grossAmount wajib untuk non-pegawai" });
    return res.json(calculatePph21NonPegawai({ grossAmount: Number(grossAmount), hasNpwp: hasNpwp !== false }));
  }

  if (grossMonthly == null) return res.status(400).json({ message: "grossMonthly wajib diisi" });
  const result = calculatePph21({
    grossMonthly: Number(grossMonthly),
    ptkpStatus: ptkpStatus as PtkpStatus,
    useTer: Boolean(useTer),
  });
  return res.json(result);
});

// ── GET /api/tax/pph21/ptkp-options ──────────────────────────────────────────
router.get("/pph21/ptkp-options", (_req, res) => {
  return res.json({ data: PTKP_OPTIONS });
});

// ── GET /api/tax/reconciliation/unmatched ─────────────────────────────────────
router.get("/reconciliation/unmatched", async (req, res) => {
  const companyId = resolveCompanyId(req);
  const { year, period } = req.query as Record<string, string>;
  const y = year ?? new Date().getFullYear().toString();
  const periodFilter = period ? `AND tt.period = '${period}'` : `AND tt.period LIKE '${y}%'`;

  const [orphaned, staleOpen, unmatchedEntries] = await Promise.all([

    // 1. transaction_taxes yang module_source-nya bukan 'manual'
    //    tetapi source_id tidak ada di tabel asal (orphaned)
    db.execute(sql.raw(`
      SELECT tt.id, tt.period, tt.tax_name, tt.direction,
             tt.transaction_type, tt.transaction_ref, tt.partner_name,
             tt.base_amount::numeric, tt.tax_amount::numeric, tt.status,
             tt.created_at,
             'orphaned' AS issue_type,
             'Transaksi sumber tidak ditemukan' AS issue_desc
      FROM transaction_taxes tt
      WHERE tt.company_id = ${companyId}
        ${periodFilter}
        AND tt.status = 'pending'
        AND tt.transaction_type = 'expense'
        AND NOT EXISTS (
          SELECT 1 FROM expenses e WHERE e.id = tt.source_id
        )
        AND tt.source_id IS NOT NULL
      LIMIT 100
    `)),

    // 2. transaction_taxes pending lebih dari 60 hari tanpa update
    db.execute(sql.raw(`
      SELECT tt.id, tt.period, tt.tax_name, tt.direction,
             tt.transaction_type, tt.transaction_ref, tt.partner_name,
             tt.base_amount::numeric, tt.tax_amount::numeric, tt.status,
             tt.created_at,
             'stale_pending' AS issue_type,
             'Pending > 60 hari tanpa update' AS issue_desc
      FROM transaction_taxes tt
      WHERE tt.company_id = ${companyId}
        ${periodFilter}
        AND tt.status = 'pending'
        AND tt.created_at < NOW() - INTERVAL '60 days'
      ORDER BY tt.created_at ASC
      LIMIT 200
    `)),

    // 3. accounting entry lines ke akun PPN/PPh (COA code 2-10xx atau 1-13xx)
    //    yang tidak punya transaction_taxes record dengan matching ref
    db.execute(sql.raw(`
      SELECT
        ae.id AS entry_id,
        ae.entry_number,
        ae.date::date,
        ae.description,
        ae.ref,
        ae.source,
        COALESCE(SUM(CASE WHEN ael.debit  > 0 THEN ael.debit  ELSE 0 END), 0)::numeric AS debit_total,
        COALESCE(SUM(CASE WHEN ael.credit > 0 THEN ael.credit ELSE 0 END), 0)::numeric AS credit_total,
        'unmatched_entry' AS issue_type,
        'Jurnal ke akun pajak tanpa transaction_taxes record' AS issue_desc
      FROM accounting_entries ae
      JOIN accounting_entry_lines ael ON ael.entry_id = ae.id
      JOIN chart_of_accounts coa ON coa.id = ael.account_id
      WHERE ae.company_id = ${companyId}
        AND ae.date >= '${y}-01-01'
        AND ae.date <  '${parseInt(y) + 1}-01-01'
        AND ae.status != 'voided'
        AND (coa.code LIKE '2-1030%' OR coa.code LIKE '2-1040%')
        AND NOT EXISTS (
          SELECT 1 FROM transaction_taxes tt
          WHERE tt.company_id = ${companyId}
            AND tt.transaction_ref = ae.ref
            AND tt.period LIKE '${y}%'
        )
      GROUP BY ae.id, ae.entry_number, ae.date, ae.description, ae.ref, ae.source
      ORDER BY ae.date DESC
      LIMIT 100
    `)),
  ]);

  const totalIssues =
    (orphaned.rows as unknown[]).length +
    (staleOpen.rows as unknown[]).length +
    (unmatchedEntries.rows as unknown[]).length;

  return res.json({
    year: y,
    totalIssues,
    orphaned: orphaned.rows,
    stalePending: staleOpen.rows,
    unmatchedEntries: unmatchedEntries.rows,
  });
});

// ── POST /api/tax/transactions/calculate ──────────────────────────────────────
router.post("/transactions/calculate", async (req, res) => {
  const companyId = resolveCompanyId(req);
  const { transactionType, baseAmount, moduleSource } = req.body;
  if (!transactionType || !baseAmount) {
    return res.status(400).json({ message: "transactionType dan baseAmount wajib diisi" });
  }

  const rules = await db.execute(sql.raw(`
    SELECT * FROM tax_rules
    WHERE company_id = ${companyId}
      AND is_active = true
      AND transaction_type = '${String(transactionType).replace(/'/g, "''")}'
    ORDER BY id
  `));

  const results = (rules.rows as any[]).map((rule) => ({
    ruleName: rule.name,
    taxType: rule.tax_type,
    taxRate: Number(rule.tax_rate),
    direction: rule.direction,
    taxBase: Number(baseAmount),
    taxAmount: Math.round(Number(baseAmount) * Number(rule.tax_rate)) / 100,
  }));

  return res.json({ results, totalTax: results.reduce((s, r) => s + r.taxAmount, 0) });
});


// ─────────────────────────────────────────────────────────────────────────────
// COMPLIANCE ENDPOINTS — laporan kepatuhan pajak
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/tax/npwp-missing?companyId=N&period=YYYY-MM&limit=200
router.get("/npwp-missing", async (req, res) => {
  const companyId = resolveCompanyId(req);
  const { period, limit: limitQ, direction } = req.query as Record<string, string>;
  const limit = Math.min(parseInt(limitQ ?? "200", 10), 500);

  try {
    const rows = await db.execute(sql`
      SELECT
        tt.id,
        tt.transaction_type,
        tt.transaction_id,
        tt.transaction_ref,
        tt.tax_name,
        tt.tax_amount::float,
        tt.base_amount::float,
        tt.direction,
        tt.partner_name,
        tt.npwp,
        tt.period,
        tt.status,
        tt.created_at
      FROM transaction_taxes tt
      WHERE tt.company_id = ${companyId}
        AND (tt.npwp IS NULL OR tt.npwp = '')
        ${period ? sql`AND tt.period = ${period}` : sql``}
        ${direction ? sql`AND tt.direction = ${direction}` : sql``}
      ORDER BY tt.created_at DESC
      LIMIT ${limit}
    `);
    return res.json({ total: rows.rows.length, items: rows.rows });
  } catch (err) {
    logger.error({ err }, "tax/npwp-missing: query failed");
    return res.status(500).json({ message: "Gagal memuat transaksi tanpa NPWP" });
  }
});

// GET /api/tax/faktur-missing?companyId=N&period=YYYY-MM&limit=200
// Cek PPN output tanpa faktur pajak, PPh withholding tanpa bukti potong
router.get("/faktur-missing", async (req, res) => {
  const companyId = resolveCompanyId(req);
  const { period, limit: limitQ } = req.query as Record<string, string>;
  const limit = Math.min(parseInt(limitQ ?? "200", 10), 500);

  try {
    const [ppnRows, pphRows] = await Promise.all([
      // PPN output tanpa faktur pajak
      db.execute(sql`
        SELECT
          tt.id,
          tt.transaction_type,
          tt.transaction_id,
          tt.transaction_ref,
          tt.tax_name,
          tt.tax_amount::float,
          tt.base_amount::float,
          tt.direction,
          tt.partner_name,
          tt.npwp,
          tt.faktur_pajak_number,
          tt.period,
          tt.status,
          tt.created_at,
          'ppn_output' AS issue_type
        FROM transaction_taxes tt
        WHERE tt.company_id = ${companyId}
          AND tt.direction = 'output'
          AND (tt.faktur_pajak_number IS NULL OR tt.faktur_pajak_number = '')
          ${period ? sql`AND tt.period = ${period}` : sql``}
        ORDER BY tt.created_at DESC
        LIMIT ${limit}
      `),
      // PPh withholding tanpa bukti potong
      db.execute(sql`
        SELECT
          tt.id,
          tt.transaction_type,
          tt.transaction_id,
          tt.transaction_ref,
          tt.tax_name,
          tt.tax_amount::float,
          tt.base_amount::float,
          tt.direction,
          tt.partner_name,
          tt.npwp,
          tt.bukti_potong_number,
          tt.period,
          tt.status,
          tt.created_at,
          'pph_no_bukti_potong' AS issue_type
        FROM transaction_taxes tt
        WHERE tt.company_id = ${companyId}
          AND tt.direction = 'withholding'
          AND (tt.bukti_potong_number IS NULL OR tt.bukti_potong_number = '')
          ${period ? sql`AND tt.period = ${period}` : sql``}
        ORDER BY tt.created_at DESC
        LIMIT ${limit}
      `),
    ]);

    return res.json({
      total: ppnRows.rows.length + pphRows.rows.length,
      ppnOutputMissingFaktur:     ppnRows.rows,
      pphWithholdingMissingBukti: pphRows.rows,
    });
  } catch (err) {
    logger.error({ err }, "tax/faktur-missing: query failed");
    return res.status(500).json({ message: "Gagal memuat transaksi tanpa faktur/bukti potong" });
  }
});

// GET /api/tax/unpaid?companyId=N&period=YYYY-MM&direction=output|withholding&limit=200
router.get("/unpaid", async (req, res) => {
  const companyId = resolveCompanyId(req);
  const { period, direction, limit: limitQ } = req.query as Record<string, string>;
  const limit = Math.min(parseInt(limitQ ?? "200", 10), 500);

  try {
    const rows = await db.execute(sql`
      SELECT
        tt.id,
        tt.transaction_type,
        tt.transaction_id,
        tt.transaction_ref,
        tt.tax_name,
        tt.tax_amount::float,
        tt.base_amount::float,
        tt.direction,
        tt.partner_name,
        tt.npwp,
        tt.period,
        tt.status,
        tt.created_at
      FROM transaction_taxes tt
      WHERE tt.company_id = ${companyId}
        AND tt.status NOT IN ('paid')
        AND tt.paid_at IS NULL
        ${period ? sql`AND tt.period = ${period}` : sql``}
        ${direction ? sql`AND tt.direction = ${direction}` : sql``}
      ORDER BY tt.period DESC, tt.tax_amount DESC
      LIMIT ${limit}
    `);
    return res.json({ total: rows.rows.length, items: rows.rows });
  } catch (err) {
    logger.error({ err }, "tax/unpaid: query failed");
    return res.status(500).json({ message: "Gagal memuat pajak belum dibayar" });
  }
});

// GET /api/tax/compliance-summary?companyId=N&period=YYYY-MM
router.get("/compliance-summary", async (req, res) => {
  const companyId = resolveCompanyIdAudit(req);
  const { period } = req.query as Record<string, string>;
  const periodFilter = period ? sql`AND period = ${period}` : sql``;

  try {
    const [npwpMissing, fakturMissing, buktiMissing, unpaid] = await Promise.all([
      db.execute(sql`
        SELECT COUNT(*)::int AS cnt FROM transaction_taxes
        WHERE company_id = ${companyId} AND (npwp IS NULL OR npwp = '') ${periodFilter}
      `),
      db.execute(sql`
        SELECT COUNT(*)::int AS cnt FROM transaction_taxes
        WHERE company_id = ${companyId} AND direction = 'output'
          AND (faktur_pajak_number IS NULL OR faktur_pajak_number = '') ${periodFilter}
      `),
      db.execute(sql`
        SELECT COUNT(*)::int AS cnt FROM transaction_taxes
        WHERE company_id = ${companyId} AND direction = 'withholding'
          AND (bukti_potong_number IS NULL OR bukti_potong_number = '') ${periodFilter}
      `),
      db.execute(sql`
        SELECT COUNT(*)::int AS cnt, COALESCE(SUM(tax_amount::numeric),0)::float AS total
        FROM transaction_taxes
        WHERE company_id = ${companyId} AND status != 'paid' AND paid_at IS NULL ${periodFilter}
      `),
    ]);

    const unpaidRow = unpaid.rows[0] as { cnt: number; total: number };
    return res.json({
      companyId,
      period: period ?? "all",
      npwpMissing:          (npwpMissing.rows[0] as { cnt: number }).cnt,
      fakturPajakMissing:   (fakturMissing.rows[0] as { cnt: number }).cnt,
      buktiPotongMissing:   (buktiMissing.rows[0] as { cnt: number }).cnt,
      unpaidCount:          unpaidRow.cnt,
      unpaidTotalAmount:    unpaidRow.total,
    });
  } catch (err) {
    logger.error({ err }, "tax/compliance-summary: query failed");
    return res.status(500).json({ message: "Gagal memuat ringkasan kepatuhan pajak" });
  }
});

// PATCH /api/tax/transactions/:id — update faktur/bukti potong/npwp inline
router.patch("/transactions/:id", async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (Number.isNaN(id)) return res.status(400).json({ message: "Invalid id" });

  const { npwp, fakturPajakNumber, buktiPotongNumber, status, notes } = req.body ?? {};
  const patch: Record<string, unknown> = { updatedAt: new Date() };
  if (npwp !== undefined) patch.npwp = npwp;
  if (fakturPajakNumber !== undefined) patch.fakturPajakNumber = fakturPajakNumber;
  if (buktiPotongNumber !== undefined) patch.buktiPotongNumber = buktiPotongNumber;
  if (status !== undefined) patch.status = status;
  if (notes !== undefined) patch.notes = notes;
  if (status === "paid") patch.paidAt = new Date();
  if (status === "reported") patch.reportedAt = new Date();
  if (status === "posted") patch.postedAt = new Date();

  if (Object.keys(patch).length === 1) {
    return res.status(400).json({ message: "Tidak ada field yang diupdate" });
  }

  try {
    const { transactionTaxesTable } = await import("@workspace/db");
    const { eq } = await import("drizzle-orm");
    await db.update(transactionTaxesTable).set(patch as never).where(eq(transactionTaxesTable.id, id));
    return res.json({ message: "Updated", id });
  } catch (err) {
    logger.error({ err }, "tax/transactions PATCH: failed");
    return res.status(500).json({ message: "Gagal update transaksi pajak" });
  }
});


// ═══════════════════════════════════════════════════════════════════════════
// DJP EXPORT — e-Faktur / e-Bupot
// ═══════════════════════════════════════════════════════════════════════════

// ── GET /api/tax/export/issues ────────────────────────────────────────────────
// Ambil baris transaction_taxes yang bermasalah (NPWP/faktur/bukpot kosong atau format salah)
// Query: period, companyId, type (npwp|faktur|bukpot|all), limit
router.get("/export/issues", async (req, res) => {
  const companyId = resolveCompanyId(req);
  const { period, type = "all", txType, limit: limitQ } = req.query as Record<string, string>;
  if (!period) return res.status(400).json({ message: "period (YYYY-MM) wajib diisi" });
  const limit = Math.min(parseInt(limitQ ?? "200", 10), 500);

  const conditions: string[] = [`company_id = ${companyId}`, `period = '${period}'`];
  if (txType && txType !== "all") {
    conditions.push(`transaction_type = '${String(txType).replace(/'/g, "''")}'`);
  }

  // Aturan NPWP:
  // - Keluaran (output/null): NPWP kosong = VALID → diisi 000... saat export. Tidak dianggap issue.
  // - Masukan (input) & Withholding: NPWP kosong = tetap bermasalah.
  // - NPWP ada tapi format salah (≠15 digit): selalu bermasalah untuk semua arah.
  if (type === "npwp") {
    conditions.push(`(
      (direction IN ('input','withholding') AND (npwp IS NULL OR npwp = ''))
      OR (npwp IS NOT NULL AND npwp != '' AND LENGTH(REGEXP_REPLACE(npwp,'[^0-9]','','g')) != 15)
    )`);
  } else if (type === "faktur") {
    conditions.push(`direction != 'withholding'`);
    conditions.push(`((tax_invoice_number IS NULL OR tax_invoice_number = '') AND (faktur_pajak_number IS NULL OR faktur_pajak_number = '') OR (LENGTH(REGEXP_REPLACE(COALESCE(NULLIF(tax_invoice_number,''),faktur_pajak_number,''),'[^0-9]','','g')) != 16 AND COALESCE(NULLIF(tax_invoice_number,''),faktur_pajak_number,'') != ''))`);
  } else if (type === "bukpot") {
    conditions.push(`direction = 'withholding'`);
    conditions.push(`(bukti_potong_number IS NULL OR bukti_potong_number = '' OR LENGTH(bukti_potong_number) < 8)`);
  } else {
    // all issues
    conditions.push(`(
      ((direction IN ('input','withholding')) AND (npwp IS NULL OR npwp = ''))
      OR (npwp IS NOT NULL AND npwp != '' AND LENGTH(REGEXP_REPLACE(npwp,'[^0-9]','','g')) != 15)
      OR (direction != 'withholding' AND ((tax_invoice_number IS NULL OR tax_invoice_number = '') AND (faktur_pajak_number IS NULL OR faktur_pajak_number = '')))
      OR (direction = 'withholding' AND (bukti_potong_number IS NULL OR bukti_potong_number = ''))
    )`);
  }

  try {
    const rows = await db.execute(sql.raw(`
      SELECT
        id,
        period,
        direction,
        transaction_type,
        tax_name,
        transaction_ref,
        partner_name,
        COALESCE(NULLIF(npwp,''), '') AS npwp,
        COALESCE(NULLIF(tax_invoice_number,''), NULLIF(faktur_pajak_number,''), '') AS faktur_number,
        COALESCE(NULLIF(bukti_potong_number,''), '') AS bukpot_number,
        base_amount::float,
        tax_amount::float,
        tax_rate::float,
        status,
        created_at,
        CASE
          WHEN direction IN ('input','withholding') AND (npwp IS NULL OR npwp = '') THEN true
          WHEN npwp IS NOT NULL AND npwp != '' AND LENGTH(REGEXP_REPLACE(npwp,'[^0-9]','','g')) != 15 THEN true
          ELSE false
        END AS npwp_issue,
        CASE
          WHEN direction != 'withholding' AND ((tax_invoice_number IS NULL OR tax_invoice_number = '') AND (faktur_pajak_number IS NULL OR faktur_pajak_number = '')) THEN true
          WHEN direction != 'withholding' AND COALESCE(NULLIF(tax_invoice_number,''),faktur_pajak_number,'') != '' AND LENGTH(REGEXP_REPLACE(COALESCE(NULLIF(tax_invoice_number,''),faktur_pajak_number,''),'[^0-9]','','g')) != 16 THEN true
          ELSE false
        END AS faktur_issue,
        CASE
          WHEN direction = 'withholding' AND (bukti_potong_number IS NULL OR bukti_potong_number = '') THEN true
          WHEN direction = 'withholding' AND bukti_potong_number IS NOT NULL AND LENGTH(bukti_potong_number) < 8 THEN true
          ELSE false
        END AS bukpot_issue
      FROM transaction_taxes
      WHERE ${conditions.join(" AND ")}
      ORDER BY direction DESC, created_at
      LIMIT ${limit}
    `));
    return res.json({ period, total: rows.rows.length, items: rows.rows });
  } catch (err) {
    logger.error({ err }, "tax/export/issues: query failed");
    return res.status(500).json({ message: "Gagal memuat baris bermasalah" });
  }
});

// ── GET /api/tax/export/lookup-npwp ──────────────────────────────────────────
// Cari NPWP dari master suppliers/customers berdasarkan nama mitra
// Query: partnerName (wajib), companyId
router.get("/export/lookup-npwp", async (req, res) => {
  const companyId = resolveCompanyId(req);
  const { partnerName } = req.query as Record<string, string>;
  if (!partnerName || partnerName.trim().length < 2) {
    return res.status(400).json({ message: "partnerName minimal 2 karakter" });
  }

  const escaped = partnerName.replace(/'/g, "''");

  try {
    const rows = await db.execute(sql.raw(`
      WITH combined AS (
        SELECT id, name, tax_id AS npwp, 'supplier' AS source, contact_email AS email, phone
        FROM suppliers
        WHERE company_id = ${companyId}
          AND tax_id IS NOT NULL AND tax_id != ''
          AND (name ILIKE '%${escaped}%' OR SIMILARITY(name, '${escaped}') > 0.25)
        UNION ALL
        SELECT id, name, tax_id AS npwp, 'customer' AS source, email, phone
        FROM customers
        WHERE company_id = ${companyId}
          AND tax_id IS NOT NULL AND tax_id != ''
          AND (name ILIKE '%${escaped}%' OR SIMILARITY(name, '${escaped}') > 0.25)
      )
      SELECT *, SIMILARITY(name, '${escaped}') AS score
      FROM combined
      ORDER BY score DESC, name
      LIMIT 5
    `));
    return res.json({ items: rows.rows });
  } catch (err) {
    logger.error({ err }, "tax/export/lookup-npwp: query failed");
    return res.status(500).json({ message: "Gagal mencari NPWP" });
  }
});

// ── POST /api/tax/export/autofill-npwp ────────────────────────────────────────
// Batch isi NPWP di transaction_taxes dari master suppliers/customers by nama exact/fuzzy
// Query: period, companyId — update hanya baris yang NPWP kosong/invalid
router.post("/export/autofill-npwp", async (req, res) => {
  const companyId = resolveCompanyId(req);
  const { period } = req.query as Record<string, string>;
  if (!period) return res.status(400).json({ message: "period (YYYY-MM) wajib diisi" });

  try {
    const result = await db.execute(sql.raw(`
      WITH master AS (
        SELECT LOWER(TRIM(name)) AS name_key, tax_id AS npwp
        FROM suppliers
        WHERE company_id = ${companyId}
          AND tax_id IS NOT NULL AND tax_id != ''
          AND LENGTH(REGEXP_REPLACE(tax_id,'[^0-9]','','g')) = 15
        UNION ALL
        SELECT LOWER(TRIM(name)) AS name_key, tax_id AS npwp
        FROM customers
        WHERE company_id = ${companyId}
          AND tax_id IS NOT NULL AND tax_id != ''
          AND LENGTH(REGEXP_REPLACE(tax_id,'[^0-9]','','g')) = 15
      ),
      matched AS (
        SELECT DISTINCT ON (tt.id) tt.id, m.npwp
        FROM transaction_taxes tt
        JOIN master m ON LOWER(TRIM(tt.partner_name)) = m.name_key
        WHERE tt.company_id = ${companyId}
          AND tt.period = '${period}'
          AND (tt.npwp IS NULL OR tt.npwp = ''
               OR LENGTH(REGEXP_REPLACE(tt.npwp,'[^0-9]','','g')) != 15)
          AND tt.partner_name IS NOT NULL AND tt.partner_name != ''
      )
      UPDATE transaction_taxes tt
      SET npwp = matched.npwp, updated_at = NOW()
      FROM matched
      WHERE tt.id = matched.id
      RETURNING tt.id
    `));

    const updated = result.rows.length;
    logger.info({ companyId, period, updated }, "[tax] autofill-npwp completed");
    return res.json({
      message: `${updated} baris NPWP berhasil diisi dari master vendor/customer`,
      updated,
    });
  } catch (err) {
    logger.error({ err }, "tax/export/autofill-npwp: query failed");
    return res.status(500).json({ message: "Gagal auto-isi NPWP" });
  }
});

// ── POST /api/tax/export/autofill-faktur ──────────────────────────────────────
// Batch isi tax_invoice_number di transaction_taxes dari sales_documents.invoice_number
// Hanya untuk transaction_type = 'sales_order' yang invoice_number-nya belum terisi
router.post("/export/autofill-faktur", async (req, res) => {
  const companyId = resolveCompanyId(req);
  const { period } = req.query as Record<string, string>;
  if (!period) return res.status(400).json({ message: "period (YYYY-MM) wajib diisi" });

  try {
    const result = await db.execute(sql.raw(`
      WITH matched AS (
        SELECT DISTINCT ON (tt.id) tt.id, sd.invoice_number AS new_faktur
        FROM transaction_taxes tt
        JOIN sales_documents sd ON sd.id = tt.transaction_id
        WHERE tt.company_id = ${companyId}
          AND tt.period = '${period}'
          AND tt.transaction_type = 'sales_order'
          AND sd.invoice_number IS NOT NULL AND sd.invoice_number != ''
          AND (tt.tax_invoice_number IS NULL OR tt.tax_invoice_number = '')
          AND (tt.faktur_pajak_number IS NULL OR tt.faktur_pajak_number = '')
      )
      UPDATE transaction_taxes tt
      SET tax_invoice_number = matched.new_faktur, updated_at = NOW()
      FROM matched
      WHERE tt.id = matched.id
      RETURNING tt.id
    `));

    const updated = result.rows.length;
    logger.info({ companyId, period, updated }, "[tax] autofill-faktur completed");
    return res.json({
      message: `${updated} baris No. Faktur berhasil diisi dari invoice penjualan`,
      updated,
    });
  } catch (err) {
    logger.error({ err }, "tax/export/autofill-faktur: query failed");
    return res.status(500).json({ message: "Gagal auto-isi No. Faktur" });
  }
});

// ── POST /api/tax/export/autofill-partner ─────────────────────────────────────
// Batch isi partner_name di transaction_taxes dari sales_documents.customer_name
// Hanya untuk transaction_type = 'sales_order' yang partner_name-nya masih kosong
router.post("/export/autofill-partner", async (req, res) => {
  const companyId = resolveCompanyId(req);
  const { period } = req.query as Record<string, string>;
  if (!period) return res.status(400).json({ message: "period (YYYY-MM) wajib diisi" });

  try {
    const result = await db.execute(sql.raw(`
      WITH matched AS (
        SELECT DISTINCT ON (tt.id) tt.id, sd.customer_name AS new_partner
        FROM transaction_taxes tt
        JOIN sales_documents sd ON sd.id = tt.transaction_id
        WHERE tt.company_id = ${companyId}
          AND tt.period = '${period}'
          AND tt.transaction_type = 'sales_order'
          AND sd.customer_name IS NOT NULL AND sd.customer_name != ''
          AND (tt.partner_name IS NULL OR tt.partner_name = '')
      )
      UPDATE transaction_taxes tt
      SET partner_name = matched.new_partner, updated_at = NOW()
      FROM matched
      WHERE tt.id = matched.id
      RETURNING tt.id
    `));

    const updated = result.rows.length;
    logger.info({ companyId, period, updated }, "[tax] autofill-partner completed");
    return res.json({
      message: `${updated} baris Nama Mitra berhasil diisi dari invoice penjualan`,
      updated,
    });
  } catch (err) {
    logger.error({ err }, "tax/export/autofill-partner: query failed");
    return res.status(500).json({ message: "Gagal auto-isi Nama Mitra" });
  }
});

// ── POST /api/tax/export/autofill-npwp-by-txn ─────────────────────────────────
// Batch isi NPWP dari chain transaction_id → purchase_documents.supplier_id → suppliers.tax_id
// Lebih akurat dari autofill-npwp (nama-matching) karena pakai relasi langsung.
// Juga update partner_name jika kosong.
router.post("/export/autofill-npwp-by-txn", async (req, res) => {
  const companyId = resolveCompanyId(req);
  const { period } = req.query as Record<string, string>;
  if (!period) return res.status(400).json({ message: "period (YYYY-MM) wajib diisi" });

  try {
    // Step 1: Update WHT/purchase via purchase_documents → supplier chain
    const purchaseResult = await db.execute(sql.raw(`
      WITH supplier_chain AS (
        SELECT
          tt.id                                     AS tt_id,
          COALESCE(NULLIF(s.tax_id, ''), NULL)      AS npwp,
          COALESCE(NULLIF(s.name, ''), NULL)        AS supplier_name
        FROM transaction_taxes tt
        JOIN purchase_documents pd ON pd.id = tt.transaction_id
        LEFT JOIN suppliers s ON s.id = pd.supplier_id
        WHERE tt.company_id = ${companyId}
          AND tt.period = '${period}'
          AND tt.transaction_type IN ('purchase_order', 'expense', 'logistic_order')
          AND (tt.npwp IS NULL OR tt.npwp = ''
               OR LENGTH(REGEXP_REPLACE(tt.npwp, '[^0-9]', '', 'g')) != 15)
          AND s.tax_id IS NOT NULL AND s.tax_id != ''
          AND LENGTH(REGEXP_REPLACE(s.tax_id, '[^0-9]', '', 'g')) = 15
      )
      UPDATE transaction_taxes tt
      SET
        npwp         = sc.npwp,
        partner_name = COALESCE(NULLIF(tt.partner_name, ''), sc.supplier_name),
        updated_at   = NOW()
      FROM supplier_chain sc
      WHERE tt.id = sc.tt_id
      RETURNING tt.id
    `)).catch(() => ({ rows: [] }));

    // Step 2: Update PPN Masukan (sales_order juga bisa punya customer tax_id)
    const salesResult = await db.execute(sql.raw(`
      WITH customer_chain AS (
        SELECT
          tt.id                                     AS tt_id,
          COALESCE(NULLIF(c.tax_id, ''), NULL)      AS npwp,
          COALESCE(NULLIF(c.name, ''), NULL)        AS customer_name
        FROM transaction_taxes tt
        JOIN sales_documents sd ON sd.id = tt.transaction_id
        LEFT JOIN customers c ON c.id = sd.customer_id
        WHERE tt.company_id = ${companyId}
          AND tt.period = '${period}'
          AND tt.transaction_type = 'sales_order'
          AND (tt.npwp IS NULL OR tt.npwp = ''
               OR LENGTH(REGEXP_REPLACE(tt.npwp, '[^0-9]', '', 'g')) != 15)
          AND c.tax_id IS NOT NULL AND c.tax_id != ''
          AND LENGTH(REGEXP_REPLACE(c.tax_id, '[^0-9]', '', 'g')) = 15
      )
      UPDATE transaction_taxes tt
      SET
        npwp         = cc.npwp,
        partner_name = COALESCE(NULLIF(tt.partner_name, ''), cc.customer_name),
        updated_at   = NOW()
      FROM customer_chain cc
      WHERE tt.id = cc.tt_id
      RETURNING tt.id
    `)).catch(() => ({ rows: [] }));

    const updated = purchaseResult.rows.length + salesResult.rows.length;
    logger.info({ companyId, period, updated, purchase: purchaseResult.rows.length, sales: salesResult.rows.length }, "[tax] autofill-npwp-by-txn completed");
    return res.json({
      message: updated > 0
        ? `${updated} baris NPWP berhasil diisi via relasi langsung (${purchaseResult.rows.length} pembelian, ${salesResult.rows.length} penjualan)`
        : "Tidak ada NPWP yang bisa diisi — master supplier/customer mungkin belum memiliki NPWP 15 digit",
      updated,
      by_type: {
        purchase: purchaseResult.rows.length,
        sales: salesResult.rows.length,
      },
    });
  } catch (err) {
    logger.error({ err }, "tax/export/autofill-npwp-by-txn: query failed");
    return res.status(500).json({ message: "Gagal auto-isi NPWP via relasi transaksi" });
  }
});

// ── POST /api/tax/export/autofill-purchase-partner ────────────────────────────
// Batch isi partner_name di transaction_taxes dari purchase_documents.supplier_name
// Hanya untuk transaction_type = 'purchase_order' yang partner_name-nya masih kosong
router.post("/export/autofill-purchase-partner", async (req, res) => {
  const companyId = resolveCompanyId(req);
  const { period } = req.query as Record<string, string>;
  if (!period) return res.status(400).json({ message: "period (YYYY-MM) wajib diisi" });

  try {
    const result = await db.execute(sql.raw(`
      WITH matched AS (
        SELECT DISTINCT ON (tt.id) tt.id, pd.supplier_name AS new_partner
        FROM transaction_taxes tt
        JOIN purchase_documents pd ON pd.id = tt.transaction_id
        WHERE tt.company_id = ${companyId}
          AND tt.period = '${period}'
          AND tt.transaction_type = 'purchase_order'
          AND pd.supplier_name IS NOT NULL AND pd.supplier_name != ''
          AND (tt.partner_name IS NULL OR tt.partner_name = '')
      )
      UPDATE transaction_taxes tt
      SET partner_name = matched.new_partner, updated_at = NOW()
      FROM matched
      WHERE tt.id = matched.id
      RETURNING tt.id
    `));

    const updated = result.rows.length;
    logger.info({ companyId, period, updated }, "[tax] autofill-purchase-partner completed");
    return res.json({
      message: `${updated} baris Nama Mitra (pembelian) berhasil diisi dari purchase order`,
      updated,
    });
  } catch (err) {
    logger.error({ err }, "tax/export/autofill-purchase-partner: query failed");
    return res.status(500).json({ message: "Gagal auto-isi Nama Mitra pembelian" });
  }
});

// ── POST /api/tax/export/autofill-purchase-faktur ─────────────────────────────
// Batch isi tax_invoice_number di transaction_taxes dari purchase_documents.bill_number
// Hanya untuk transaction_type = 'purchase_order' yang tax_invoice_number-nya masih kosong
router.post("/export/autofill-purchase-faktur", async (req, res) => {
  const companyId = resolveCompanyId(req);
  const { period } = req.query as Record<string, string>;
  if (!period) return res.status(400).json({ message: "period (YYYY-MM) wajib diisi" });

  try {
    const result = await db.execute(sql.raw(`
      WITH matched AS (
        SELECT DISTINCT ON (tt.id) tt.id, pd.bill_number AS new_faktur
        FROM transaction_taxes tt
        JOIN purchase_documents pd ON pd.id = tt.transaction_id
        WHERE tt.company_id = ${companyId}
          AND tt.period = '${period}'
          AND tt.transaction_type = 'purchase_order'
          AND pd.bill_number IS NOT NULL AND pd.bill_number != ''
          AND (tt.tax_invoice_number IS NULL OR tt.tax_invoice_number = '')
          AND (tt.faktur_pajak_number IS NULL OR tt.faktur_pajak_number = '')
      )
      UPDATE transaction_taxes tt
      SET tax_invoice_number = matched.new_faktur, updated_at = NOW()
      FROM matched
      WHERE tt.id = matched.id
      RETURNING tt.id
    `));

    const updated = result.rows.length;
    logger.info({ companyId, period, updated }, "[tax] autofill-purchase-faktur completed");
    return res.json({
      message: `${updated} baris No. Faktur (pembelian) berhasil diisi dari nomor bill purchase order`,
      updated,
    });
  } catch (err) {
    logger.error({ err }, "tax/export/autofill-purchase-faktur: query failed");
    return res.status(500).json({ message: "Gagal auto-isi No. Faktur pembelian" });
  }
});

// ── GET /api/tax/export/validate ─────────────────────────────────────────────
// Pre-flight: hitung baris siap export, bermasalah NPWP, bermasalah faktur
router.get("/export/validate", async (req, res) => {
  const companyId = resolveCompanyId(req);
  const { period } = req.query as Record<string, string>;
  if (!period) return res.status(400).json({ message: "period (YYYY-MM) wajib diisi" });

  const [ppnOut, ppnIn, pph, npwpBad, fakturBad, bukpotBad] = await Promise.all([
    // PPN Keluaran
    db.execute(sql.raw(`
      SELECT
        COUNT(*)::int AS total,
        SUM(CASE WHEN npwp IS NULL OR npwp = '' THEN 1 ELSE 0 END)::int AS npwp_missing,
        SUM(CASE WHEN (tax_invoice_number IS NULL OR tax_invoice_number = '')
                    AND (faktur_pajak_number IS NULL OR faktur_pajak_number = '') THEN 1 ELSE 0 END)::int AS faktur_missing
      FROM transaction_taxes
      WHERE company_id = ${companyId} AND period = '${period}'
        AND (tax_name ILIKE '%ppn%' OR tax_name ILIKE '%vat%')
        AND (direction = 'output' OR direction IS NULL)
    `)),
    // PPN Masukan
    db.execute(sql.raw(`
      SELECT
        COUNT(*)::int AS total,
        SUM(CASE WHEN npwp IS NULL OR npwp = '' THEN 1 ELSE 0 END)::int AS npwp_missing,
        SUM(CASE WHEN (tax_invoice_number IS NULL OR tax_invoice_number = '')
                    AND (faktur_pajak_number IS NULL OR faktur_pajak_number = '') THEN 1 ELSE 0 END)::int AS faktur_missing
      FROM transaction_taxes
      WHERE company_id = ${companyId} AND period = '${period}'
        AND (tax_name ILIKE '%masukan%' OR tax_name ILIKE '%vat%input%')
        AND direction = 'input'
    `)),
    // PPh withholding
    db.execute(sql.raw(`
      SELECT
        COUNT(*)::int AS total,
        SUM(CASE WHEN npwp IS NULL OR npwp = '' THEN 1 ELSE 0 END)::int AS npwp_missing,
        SUM(CASE WHEN (bukti_potong_number IS NULL OR bukti_potong_number = '') THEN 1 ELSE 0 END)::int AS bukpot_missing,
        tax_name
      FROM transaction_taxes
      WHERE company_id = ${companyId} AND period = '${period}'
        AND direction = 'withholding'
      GROUP BY tax_name
    `)),
    // NPWP format invalid (ada tapi 15 digit salah)
    db.execute(sql.raw(`
      SELECT COUNT(*)::int AS cnt
      FROM transaction_taxes
      WHERE company_id = ${companyId} AND period = '${period}'
        AND npwp IS NOT NULL AND npwp != ''
        AND LENGTH(REGEXP_REPLACE(npwp, '[^0-9]', '', 'g')) != 15
    `)),
    // Faktur format invalid (ada tapi bukan 16 digit)
    db.execute(sql.raw(`
      SELECT COUNT(*)::int AS cnt
      FROM transaction_taxes
      WHERE company_id = ${companyId} AND period = '${period}'
        AND (tax_invoice_number IS NOT NULL AND tax_invoice_number != ''
             OR faktur_pajak_number IS NOT NULL AND faktur_pajak_number != '')
        AND LENGTH(REGEXP_REPLACE(
              COALESCE(NULLIF(tax_invoice_number,''), faktur_pajak_number, ''),
              '[^0-9]', '', 'g')) != 16
    `)),
    // Bukti potong format invalid (ada tapi format tidak sesuai)
    db.execute(sql.raw(`
      SELECT COUNT(*)::int AS cnt
      FROM transaction_taxes
      WHERE company_id = ${companyId} AND period = '${period}'
        AND direction = 'withholding'
        AND bukti_potong_number IS NOT NULL AND bukti_potong_number != ''
        AND LENGTH(bukti_potong_number) < 8
    `)),
  ]);

  const ppnOutRow  = ppnOut.rows[0]  as any;
  const ppnInRow   = ppnIn.rows[0]   as any;
  const pphRows    = pph.rows        as any[];
  const totalPph   = pphRows.reduce((s, r) => s + Number(r.total), 0);
  const npwpBadN   = Number((npwpBad.rows[0] as any).cnt);
  const fakturBadN = Number((fakturBad.rows[0] as any).cnt);
  const bukpotBadN = Number((bukpotBad.rows[0] as any).cnt);

  // NPWP kosong pada Faktur Keluaran = VALID (konsumen akhir non-PKP).
  // Saat export e-Faktur, NPWP kosong otomatis diisi 000000000000000 (sesuai ketentuan DJP).
  // Hanya NPWP yang ADA tapi formatnya salah (bukan 15 digit) yang dihitung sebagai issue.
  const ppnIssues =
    Number(ppnInRow.npwp_missing) +   // masukan: NPWP penjual tetap wajib
    Number(ppnOutRow.faktur_missing) + Number(ppnInRow.faktur_missing) +
    npwpBadN + fakturBadN;

  const pphNpwpMissing  = pphRows.reduce((s, r) => s + Number(r.npwp_missing), 0);
  const pphBukpotMissing = pphRows.reduce((s, r) => s + Number(r.bukpot_missing ?? 0), 0);
  const pphIssues = pphNpwpMissing + pphBukpotMissing + bukpotBadN;

  return res.json({
    period,
    efaktur: {
      keluaran: {
        total:         Number(ppnOutRow.total),
        npwpMissing:   0, // kosong = valid (auto-fill 000... saat export)
        fakturMissing: Number(ppnOutRow.faktur_missing),
      },
      masukan: {
        total:         Number(ppnInRow.total),
        npwpMissing:   Number(ppnInRow.npwp_missing),
        fakturMissing: Number(ppnInRow.faktur_missing),
      },
      npwpFormatInvalid:   npwpBadN,
      fakturFormatInvalid: fakturBadN,
      readyToExport: ppnIssues === 0,
      issues: ppnIssues,
    },
    ebupot: {
      total: totalPph,
      byType: pphRows.map((r) => ({
        taxName:       r.tax_name,
        total:         Number(r.total),
        npwpMissing:   Number(r.npwp_missing),
        bukpotMissing: Number(r.bukpot_missing ?? 0),
      })),
      npwpMissing:        pphNpwpMissing,
      bukpotMissing:      pphBukpotMissing,
      bukpotFormatInvalid: bukpotBadN,
      readyToExport: pphIssues === 0,
      issues: pphIssues,
    },
  });
});

// ── GET /api/tax/export/efaktur ───────────────────────────────────────────────
// Export SPT Masa PPN dalam format e-Faktur DJP (pipe-delimited, siap upload)
// Format: FK|KD_JENIS|FG_PENGGANTI|NOMOR_FAKTUR|MASA_PAJAK|TAHUN_PAJAK|TGL_FAKTUR|NPWP|NAMA|ALAMAT|DPP|PPN|PPNBM|DAPAT_DIKREDITKAN
router.get("/export/efaktur", async (req, res) => {
  const companyId = resolveCompanyId(req);
  const { period, direction = "all" } = req.query as Record<string, string>;
  if (!period) return res.status(400).json({ message: "period (YYYY-MM) wajib diisi" });

  const [yr, mo] = period.split("-");
  const masaPajak = parseInt(mo ?? "1", 10);
  const tahunPajak = yr ?? "2024";

  const dirCond =
    direction === "keluaran"
      ? `AND (direction = 'output' OR direction IS NULL)`
      : direction === "masukan"
      ? `AND direction = 'input'`
      : `AND (direction = 'output' OR direction = 'input' OR direction IS NULL)`;

  const rows = await db.execute(sql.raw(`
    SELECT
      direction,
      COALESCE(NULLIF(tax_invoice_number,''), NULLIF(faktur_pajak_number,'')) AS nomor_faktur_raw,
      REGEXP_REPLACE(
        COALESCE(NULLIF(npwp,''), '000000000000000'),
        '[^0-9]', '', 'g'
      ) AS npwp_digits,
      COALESCE(partner_name, '') AS nama_lawan,
      COALESCE(base_amount::numeric, 0) AS dpp,
      COALESCE(tax_amount::numeric, 0) AS ppn,
      transaction_ref,
      created_at,
      period,
      status
    FROM transaction_taxes
    WHERE company_id = ${companyId}
      AND period = '${period}'
      AND (tax_name ILIKE '%ppn%' OR tax_name ILIKE '%vat%')
      ${dirCond}
    ORDER BY direction DESC, created_at
    LIMIT 5000
  `));

  const lines: string[] = [];
  let no = 0;
  for (const r of rows.rows as any[]) {
    no++;
    const isKeluaran = r.direction !== "input";
    const rowType = isKeluaran ? "FK" : "FAPR";

    // Normalisasi nomor faktur ke 16 digit
    const fakturDigits = String(r.nomor_faktur_raw ?? "").replace(/\D/g, "");
    const nomorFaktur = fakturDigits.length === 16
      ? fakturDigits
      : "0000000000000000"; // placeholder jika kosong

    // Format tanggal dari created_at → DD/MM/YYYY
    const tgl = new Date(r.created_at);
    const tanggal = `${String(tgl.getDate()).padStart(2, "0")}/${String(tgl.getMonth() + 1).padStart(2, "0")}/${tgl.getFullYear()}`;

    const npwpDigits = String(r.npwp_digits ?? "000000000000000").padEnd(15, "0").slice(0, 15);
    const dpp = Math.round(Number(r.dpp));
    const ppn = Math.round(Number(r.ppn));

    // KD_JENIS_TRANSAKSI: 01 = penyerahan ke non-pemungut (default)
    // FG_PENGGANTI: 0 = normal, 1 = pengganti
    const kdJenis = "01";
    const fgPengganti = "0";
    const dapatDikreditkan = "1";

    // FK row (header faktur)
    lines.push([
      rowType, kdJenis, fgPengganti, nomorFaktur,
      masaPajak, tahunPajak, tanggal,
      npwpDigits, r.nama_lawan || "-", "-",
      dpp, ppn, 0, dapatDikreditkan,
    ].join("|"));

    // OF row (detail barang/jasa — wajib ada minimal 1)
    lines.push([
      "OF", kdJenis, fgPengganti, nomorFaktur,
      masaPajak, tahunPajak, tanggal,
      npwpDigits, r.nama_lawan || "-", "-",
      dpp, ppn, 0, dapatDikreditkan,
    ].join("|"));
  }

  const filename = `efaktur-${direction}-${period}.txt`;
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.send(lines.join("\r\n") + "\r\n");
});

// ── GET /api/tax/export/ebupot ─────────────────────────────────────────────
// Export SPT Masa PPh (e-Bupot) dalam format CSV siap upload ke DJP
// Mendukung PPh 23 dan PPh 4(2)
router.get("/export/ebupot", async (req, res) => {
  const companyId = resolveCompanyId(req);
  const { period, jenisPph = "pph23" } = req.query as Record<string, string>;
  if (!period) return res.status(400).json({ message: "period (YYYY-MM) wajib diisi" });

  const [yr, mo] = period.split("-");
  const masaPajak = parseInt(mo ?? "1", 10);
  const tahunPajak = yr ?? new Date().getFullYear().toString();

  // Mapping jenis PPh ke pola pencarian tax_name
  const taxNameFilter =
    jenisPph === "pph4a2"
      ? `tax_name ILIKE '%pph 4%' OR tax_name ILIKE '%pasal 4%' OR tax_name ILIKE '%final%'`
      : jenisPph === "pph21"
      ? `tax_name ILIKE '%pph 21%' OR tax_name ILIKE '%pasal 21%'`
      : `tax_name ILIKE '%pph 23%' OR tax_name ILIKE '%pasal 23%' OR tax_name ILIKE '%pph23%'`;

  const rows = await db.execute(sql.raw(`
    SELECT
      tax_name,
      REGEXP_REPLACE(COALESCE(NULLIF(npwp,''), '000000000000000'), '[^0-9]', '', 'g') AS npwp_digits,
      COALESCE(partner_name, '') AS nama_wp,
      COALESCE(base_amount::numeric, 0) AS bruto,
      COALESCE(tax_rate::numeric, 0) AS tarif,
      COALESCE(tax_amount::numeric, 0) AS pph_dipotong,
      COALESCE(NULLIF(bukti_potong_number,''), '') AS nomor_bukpot,
      transaction_ref,
      created_at,
      status,
      direction
    FROM transaction_taxes
    WHERE company_id = ${companyId}
      AND period = '${period}'
      AND direction = 'withholding'
      AND (${taxNameFilter})
    ORDER BY created_at
    LIMIT 5000
  `));

  // Header CSV untuk e-Bupot 23/26 (format DJP)
  const isPph4a2 = jenisPph === "pph4a2";
  const isPph21  = jenisPph === "pph21";

  const header = isPph21
    ? "NO,NPWP_WP,NAMA_WP,MASA_PAJAK,TAHUN_PAJAK,JUMLAH_PENGHASILAN_BRUTO,TARIF,PPH_DIPOTONG,NOMOR_BUKTI_PEMOTONGAN,TANGGAL_BUKTI_PEMOTONGAN,STATUS"
    : isPph4a2
    ? "NO,NPWP_WP,NAMA_WP,KODE_JENIS_PENGHASILAN,MASA_PAJAK,TAHUN_PAJAK,JUMLAH_PENGHASILAN_BRUTO,TARIF,PPH_DIPOTONG,NOMOR_BUKTI_PEMOTONGAN,TANGGAL_BUKTI_PEMOTONGAN,STATUS"
    : "NO,NPWP_WP,NAMA_WP,KODE_OBJEK_PAJAK,MASA_PAJAK,TAHUN_PAJAK,JUMLAH_PENGHASILAN_BRUTO,TARIF_PERSEN,PPH_DIPOTONG,NOMOR_BUKTI_PEMOTONGAN,TANGGAL_BUKTI_PEMOTONGAN,STATUS";

  function csvEscape(v: string | number) {
    const s = String(v);
    if (s.includes(",") || s.includes('"') || s.includes("\n")) {
      return `"${s.replace(/"/g, '""')}"`;
    }
    return s;
  }

  // Kode objek pajak default per jenis PPh
  function deriveKodeObjek(taxName: string): string {
    const n = taxName.toLowerCase();
    if (n.includes("jasa teknik") || n.includes("konsultasi")) return "23-100-01";
    if (n.includes("sewa") && n.includes("tanah")) return "4(2)-02-01";
    if (n.includes("sewa")) return "23-100-05";
    if (n.includes("royalti")) return "23-100-03";
    if (n.includes("bunga")) return "23-100-02";
    if (n.includes("dividen")) return "23-100-06";
    return isPph4a2 ? "4(2)-01-01" : "23-100-99";
  }

  const dataLines: string[] = [];
  let no = 0;
  for (const r of rows.rows as any[]) {
    no++;
    const npwpDigits = String(r.npwp_digits ?? "000000000000000").padEnd(15, "0").slice(0, 15);
    const bruto = Math.round(Number(r.bruto));
    const pphDipotong = Math.round(Number(r.pph_dipotong));
    const tarifPct = Number(r.tarif);
    const tgl = new Date(r.created_at);
    const tanggal = `${String(tgl.getDate()).padStart(2, "0")}/${String(tgl.getMonth() + 1).padStart(2, "0")}/${tgl.getFullYear()}`;
    const nomorBukpot = r.nomor_bukpot || `BP/${tahunPajak}/${String(masaPajak).padStart(2, "0")}/${String(no).padStart(6, "0")}`;

    if (isPph21) {
      dataLines.push([
        no, csvEscape(npwpDigits), csvEscape(r.nama_wp),
        masaPajak, tahunPajak,
        bruto, tarifPct.toFixed(2), pphDipotong,
        csvEscape(nomorBukpot), tanggal,
        r.status ?? "pending",
      ].join(","));
    } else if (isPph4a2) {
      dataLines.push([
        no, csvEscape(npwpDigits), csvEscape(r.nama_wp),
        csvEscape(deriveKodeObjek(r.tax_name)),
        masaPajak, tahunPajak,
        bruto, tarifPct.toFixed(2), pphDipotong,
        csvEscape(nomorBukpot), tanggal,
        r.status ?? "pending",
      ].join(","));
    } else {
      // PPh 23
      dataLines.push([
        no, csvEscape(npwpDigits), csvEscape(r.nama_wp),
        csvEscape(deriveKodeObjek(r.tax_name)),
        masaPajak, tahunPajak,
        bruto, tarifPct.toFixed(2), pphDipotong,
        csvEscape(nomorBukpot), tanggal,
        r.status ?? "pending",
      ].join(","));
    }
  }

  const csv = [header, ...dataLines].join("\n");
  const filename = `ebupot-${jenisPph}-${period}.csv`;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  return res.send("\uFEFF" + csv);
});

// ═══════════════════════════════════════════════════════════════════════════
// TAX COVERAGE AUDIT — audit cakupan & kesiapan SPT per tahun
// GET /api/tax/coverage-audit?year=2025&companyId=...
// ═══════════════════════════════════════════════════════════════════════════
router.get("/coverage-audit", async (req, res) => {
  const companyId = resolveCompanyId(req);
  const { year } = req.query as Record<string, string>;
  const selectedYear = year ?? String(new Date().getFullYear());

  try {
    // 1. Cakupan per transaction_type per bulan
    const coverageRows = await db.execute(sql.raw(`
      SELECT
        transaction_type,
        direction,
        period,
        COUNT(*)::int                                                                     AS lines,
        COUNT(DISTINCT transaction_id)::int                                               AS tx_count,
        COALESCE(SUM(base_amount::numeric), 0)::float                                     AS dpp,
        COALESCE(SUM(tax_amount::numeric), 0)::float                                      AS pajak,
        COUNT(CASE WHEN status = 'paid'                               THEN 1 END)::int    AS paid,
        COUNT(CASE WHEN status = 'reported'                           THEN 1 END)::int    AS reported,
        COUNT(CASE WHEN status NOT IN ('paid','reported')             THEN 1 END)::int    AS pending,
        COUNT(CASE WHEN npwp IS NULL OR npwp = ''                     THEN 1 END)::int    AS npwp_missing,
        COUNT(CASE WHEN direction = 'output'
                    AND (COALESCE(NULLIF(tax_invoice_number,''), faktur_pajak_number, '') = '')
                                                                      THEN 1 END)::int    AS faktur_missing,
        COUNT(CASE WHEN direction = 'withholding'
                    AND (bukti_potong_number IS NULL OR bukti_potong_number = '')
                                                                      THEN 1 END)::int    AS bukpot_missing
      FROM transaction_taxes
      WHERE company_id = ${companyId}
        AND period LIKE '${selectedYear}-%'
      GROUP BY transaction_type, direction, period
      ORDER BY period DESC, transaction_type
    `));

    // 2. Ringkasan per bulan (untuk matrix kesiapan SPT)
    const monthlyRows = await db.execute(sql.raw(`
      SELECT
        period,
        COUNT(*)::int                                                                     AS total_lines,
        COUNT(DISTINCT transaction_id)::int                                               AS tx_count,
        COALESCE(SUM(tax_amount::numeric), 0)::float                                      AS total_pajak,
        COUNT(CASE WHEN status = 'paid'                               THEN 1 END)::int    AS paid,
        COUNT(CASE WHEN status = 'reported'                           THEN 1 END)::int    AS reported,
        COUNT(CASE WHEN status NOT IN ('paid','reported')             THEN 1 END)::int    AS pending,
        COUNT(CASE WHEN npwp IS NULL OR npwp = ''                     THEN 1 END)::int    AS npwp_missing,
        COUNT(CASE WHEN direction = 'output'
                    AND (COALESCE(NULLIF(tax_invoice_number,''), faktur_pajak_number, '') = '')
                                                                      THEN 1 END)::int    AS faktur_missing,
        COUNT(CASE WHEN direction = 'withholding'
                    AND (bukti_potong_number IS NULL OR bukti_potong_number = '')
                                                                      THEN 1 END)::int    AS bukpot_missing,
        COALESCE(SUM(CASE WHEN direction = 'output'  THEN tax_amount::numeric ELSE 0 END), 0)::float  AS ppn_keluaran,
        COALESCE(SUM(CASE WHEN direction = 'input'   THEN tax_amount::numeric ELSE 0 END), 0)::float  AS ppn_masukan,
        COALESCE(SUM(CASE WHEN direction = 'withholding' THEN tax_amount::numeric ELSE 0 END), 0)::float AS pph_total
      FROM transaction_taxes
      WHERE company_id = ${companyId}
        AND period LIKE '${selectedYear}-%'
      GROUP BY period
      ORDER BY period ASC
    `));

    // 3. Ringkasan per transaction_type (tanpa filter bulan) untuk kartu cakupan
    const typeRows = await db.execute(sql.raw(`
      SELECT
        transaction_type,
        COUNT(*)::int                                                                     AS lines,
        COUNT(DISTINCT transaction_id)::int                                               AS tx_count,
        COALESCE(SUM(base_amount::numeric), 0)::float                                     AS dpp,
        COALESCE(SUM(tax_amount::numeric), 0)::float                                      AS pajak,
        COUNT(CASE WHEN status NOT IN ('paid','reported')             THEN 1 END)::int    AS pending,
        COUNT(CASE WHEN npwp IS NULL OR npwp = ''                     THEN 1 END)::int    AS npwp_missing,
        COUNT(CASE WHEN direction = 'output'
                    AND (COALESCE(NULLIF(tax_invoice_number,''), faktur_pajak_number, '') = '')
                                                                      THEN 1 END)::int    AS faktur_missing,
        COUNT(CASE WHEN direction = 'withholding'
                    AND (bukti_potong_number IS NULL OR bukti_potong_number = '')
                                                                      THEN 1 END)::int    AS bukpot_missing
      FROM transaction_taxes
      WHERE company_id = ${companyId}
        AND period LIKE '${selectedYear}-%'
      GROUP BY transaction_type
      ORDER BY pajak DESC
    `));

    // 4. Grand total tahun ini
    const totalRow = await db.execute(sql.raw(`
      SELECT
        COUNT(*)::int                                                                     AS total_lines,
        COUNT(DISTINCT transaction_id)::int                                               AS tx_count,
        COALESCE(SUM(base_amount::numeric), 0)::float                                     AS total_dpp,
        COALESCE(SUM(tax_amount::numeric), 0)::float                                      AS total_pajak,
        COUNT(CASE WHEN status = 'paid'                               THEN 1 END)::int    AS paid,
        COUNT(CASE WHEN status = 'reported'                           THEN 1 END)::int    AS reported,
        COUNT(CASE WHEN status NOT IN ('paid','reported')             THEN 1 END)::int    AS pending,
        COUNT(CASE WHEN npwp IS NULL OR npwp = ''                     THEN 1 END)::int    AS npwp_missing,
        COUNT(CASE WHEN direction = 'output'
                    AND (COALESCE(NULLIF(tax_invoice_number,''), faktur_pajak_number, '') = '')
                                                                      THEN 1 END)::int    AS faktur_missing,
        COUNT(CASE WHEN direction = 'withholding'
                    AND (bukti_potong_number IS NULL OR bukti_potong_number = '')
                                                                      THEN 1 END)::int    AS bukpot_missing
      FROM transaction_taxes
      WHERE company_id = ${companyId}
        AND period LIKE '${selectedYear}-%'
    `));

    const grand = (totalRow.rows[0] as any) ?? {};
    const totalIssues =
      Number(grand.npwp_missing ?? 0) +
      Number(grand.faktur_missing ?? 0) +
      Number(grand.bukpot_missing ?? 0);

    return res.json({
      year: selectedYear,
      companyId,
      grand: {
        totalLines:    Number(grand.total_lines ?? 0),
        txCount:       Number(grand.tx_count ?? 0),
        totalDpp:      Number(grand.total_dpp ?? 0),
        totalPajak:    Number(grand.total_pajak ?? 0),
        paid:          Number(grand.paid ?? 0),
        reported:      Number(grand.reported ?? 0),
        pending:       Number(grand.pending ?? 0),
        npwpMissing:   Number(grand.npwp_missing ?? 0),
        fakturMissing: Number(grand.faktur_missing ?? 0),
        bukpotMissing: Number(grand.bukpot_missing ?? 0),
        totalIssues,
        readyToReport: totalIssues === 0 && Number(grand.pending ?? 0) === 0,
      },
      byType:  typeRows.rows,
      monthly: monthlyRows.rows,
      detail:  coverageRows.rows,
    });
  } catch (err: any) {
    logger.error({ err: err.message }, "tax/coverage-audit: query failed");
    return res.status(500).json({ message: "Gagal memuat audit pajak" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GL RECONCILIATION — cross-check transaction_taxes ↔ gl_tax_lines
// ══════════════════════════════════════════════════════════════════════════════

// GET /api/tax/gl-reconcile?companyId=N&period=YYYY-MM
router.get("/gl-reconcile", async (req, res) => {
  const companyId = resolveCompanyId(req);
  const period = (req.query.period as string) || currentPeriod();

  try {
    const result = await runTaxReconciliation(companyId, period);
    const httpStatus = result.gaps.some((g) => g.severity === "HIGH") ? 207 : 200;
    return res.status(httpStatus).json(result);
  } catch (err: any) {
    logger.error({ err: err.message }, "tax/gl-reconcile: gagal");
    return res.status(500).json({ message: "Rekonsiliasi GL gagal" });
  }
});

// POST /api/tax/gl-reconcile/run — jalankan rekonsiliasi beberapa periode sekaligus
router.post("/gl-reconcile/run", async (req, res) => {
  const { periods } = req.body ?? {};
  const companyId = resolveCompanyId(req);
  const periodList: string[] = Array.isArray(periods) && periods.length > 0
    ? (periods as string[]).slice(0, 12)
    : [currentPeriod()];

  try {
    const results = await Promise.all(
      periodList.map((p) => runTaxReconciliation(companyId, p)),
    );
    const totalGaps  = results.reduce((s, r) => s + r.gaps.length, 0);
    const highGaps   = results.reduce((s, r) => s + r.gaps.filter((g) => g.severity === "HIGH").length, 0);
    return res.json({ results, totalGaps, highGaps });
  } catch (err: any) {
    logger.error({ err: err.message }, "tax/gl-reconcile/run: gagal");
    return res.status(500).json({ message: "Batch rekonsiliasi GL gagal" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// FAKTUR PAJAK AUTO-GENERATE
// ══════════════════════════════════════════════════════════════════════════════

// POST /api/tax/faktur/auto-generate
// Body: { companyId, period, kodeTransaksi?, limit? }
router.post("/faktur/auto-generate", async (req, res) => {
  const { period, kodeTransaksi, limit } = req.body ?? {};
  const companyId = resolveCompanyId(req);
  if (!period) {
    return res.status(400).json({ message: "period (YYYY-MM) wajib diisi" });
  }

  try {
    const result = await generateFakturNumbers({
      companyId,
      period: String(period),
      kodeTransaksi: kodeTransaksi ? String(kodeTransaksi) : undefined,
      limit: limit ? Number(limit) : undefined,
    });

    audit(req, {
      action: "create",
      module: "tax",
      resourceId: `faktur-auto-${period}`,
      after: { ...result, period, companyId } as Record<string, unknown>,
      companyId,
    });

    return res.json({
      ok: true,
      message: `${result.updated} nomor faktur pajak berhasil di-generate`,
      ...result,
    });
  } catch (err: any) {
    logger.error({ err: err.message }, "tax/faktur/auto-generate: gagal");
    return res.status(500).json({ message: "Generate faktur gagal" });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// BUKTI POTONG AUTO-GENERATE
// ══════════════════════════════════════════════════════════════════════════════

// POST /api/tax/bupot/auto-generate
// Body: { companyId, period, taxType?, limit? }
router.post("/bupot/auto-generate", async (req, res) => {
  const { companyId: cidBody, period, taxType, limit } = req.body ?? {};
  const companyId = Number(cidBody ?? 1) || 1;
  if (!period) {
    return res.status(400).json({ message: "period (YYYY-MM) wajib diisi" });
  }

  try {
    const result = await generateBupotNumbers({
      companyId,
      period: String(period),
      taxType: taxType ? String(taxType) : undefined,
      limit: limit ? Number(limit) : undefined,
    });

    audit(req, {
      action: "create",
      module: "tax",
      resourceId: `bupot-auto-${period}`,
      after: { ...result, period, companyId } as Record<string, unknown>,
      companyId,
    });

    return res.json({
      ok: true,
      message: `${result.updated} nomor bukti potong berhasil di-generate`,
      ...result,
    });
  } catch (err: any) {
    logger.error({ err: err.message }, "tax/bupot/auto-generate: gagal");
    return res.status(500).json({ message: "Generate bukti potong gagal" });
  }
});

// ════════════════════════════════════════════════════════════════════════════
// /api/tax/spt/* — SPT Builder V2 (simplified endpoints for new UI)
// ════════════════════════════════════════════════════════════════════════════

let sptV2Migrated = false;
async function ensureSptV2() {
  if (!sptV2Migrated) {
    await bootMigrateSptDrafts();
    await ensureUniqueConstraint();
    sptV2Migrated = true;
  }
}

function parseSptParams(req: any): { companyId: number; period: string } | null {
  const companyId = Number(req.query.companyId ?? req.body?.companyId ?? 0);
  const period    = String(req.query.period    ?? req.body?.period    ?? "");
  if (!companyId || !period.match(/^\d{4}-\d{2}$/)) return null;
  return { companyId, period };
}

// ── GET /api/tax/spt/draft — build draft dari transaksi bulan berjalan ────────
router.get("/spt/draft", async (req, res) => {
  const p = parseSptParams(req);
  if (!p) return res.status(400).json({ error: "companyId dan period (YYYY-MM) diperlukan" });

  try {
    const draft = await buildSptDraft(p.companyId, p.period);
    return res.json({ ok: true, ...draft });
  } catch (err: any) {
    logger.error({ err: err.message }, "[tax/spt/draft] gagal");
    return res.status(500).json({ error: "Gagal build draft SPT" });
  }
});

// ── POST /api/tax/spt/validate — validasi + rekonsiliasi, return error list ───
router.post("/spt/validate", async (req, res) => {
  const p = parseSptParams(req);
  if (!p) return res.status(400).json({ error: "companyId dan period (YYYY-MM) diperlukan" });

  try {
    const [draft, recon] = await Promise.all([
      buildSptDraft(p.companyId, p.period),
      runTaxReconciliation(p.companyId, p.period),
    ]);

    const errors: Array<{ code: string; severity: string; message: string; detail?: any }> = [];

    // A. Missing GL entries
    recon.gaps.filter(g => g.issue === "ORPHANED_TT").forEach(g => {
      errors.push({
        code: "MISSING_GL_ENTRY",
        severity: "HIGH",
        message: `Transaksi pajak (${g.transaction_type} #${g.transaction_id}) belum ada jurnal GL`,
        detail: { transaction_type: g.transaction_type, transaction_id: g.transaction_id, amount: g.amount_tt },
      });
    });

    // B. Amount mismatches GL vs TX
    recon.gaps.filter(g => g.issue.startsWith("AMOUNT_MISMATCH")).forEach(g => {
      errors.push({
        code: "AMOUNT_MISMATCH",
        severity: "MEDIUM",
        message: `Selisih nominal ${g.issue}: TT=${g.amount_tt} vs GL=${g.amount_gl} (diff ${g.diff})`,
        detail: g,
      });
    });

    // C. Duplicate transaction_tax_id (per faktur number)
    const fakturNums = draft.transactions
      .map(t => t.faktur_pajak_number)
      .filter(Boolean);
    const fakturDups = fakturNums.filter((v, i) => fakturNums.indexOf(v) !== i);
    Array.from(new Set(fakturDups)).forEach(num => {
      errors.push({
        code: "DUPLICATE_FAKTUR",
        severity: "HIGH",
        message: `Nomor faktur duplikat: ${num}`,
        detail: { faktur_pajak_number: num },
      });
    });

    // D. Invalid NPWP format (check transaction_taxes.npwp)
    const { rows: npwpRows } = await db.execute(sql`
      SELECT id, npwp, tax_name, transaction_type
      FROM transaction_taxes
      WHERE company_id = ${p.companyId} AND period = ${p.period}
        AND npwp IS NOT NULL AND npwp != ''
        AND LENGTH(REPLACE(REPLACE(npwp,'.',''),'-','')) NOT IN (15,16)
    `).catch(() => ({ rows: [] }));

    (npwpRows as any[]).forEach(r => {
      errors.push({
        code: "INVALID_NPWP",
        severity: "MEDIUM",
        message: `NPWP tidak valid: "${r.npwp}" pada ${r.tax_name} (${r.transaction_type} #${r.id})`,
        detail: { id: r.id, npwp: r.npwp },
      });
    });

    // E. Unposted journals (accounting_entries status = draft/pending)
    const { rows: unposted } = await db.execute(sql`
      SELECT COUNT(*)::int AS cnt
      FROM gl_tax_lines gtl
      JOIN accounting_entries ae ON ae.id = gtl.entry_id
      WHERE gtl.period = ${p.period}
        AND ae.company_id = ${p.companyId}
        AND ae.status NOT IN ('posted','approved','confirmed')
    `).catch(() => ({ rows: [{ cnt: 0 }] }));

    const unpostedCount = Number((unposted as any[])[0]?.cnt ?? 0);
    if (unpostedCount > 0) {
      errors.push({
        code: "UNPOSTED_JOURNAL",
        severity: "LOW",
        message: `${unpostedCount} jurnal pajak belum diposting — bisa mempengaruhi rekonsiliasi`,
        detail: { count: unpostedCount },
      });
    }

    // F. Missing company_id
    const { rows: noCo } = await db.execute(sql`
      SELECT COUNT(*)::int AS cnt
      FROM transaction_taxes
      WHERE company_id = ${p.companyId} AND period = ${p.period}
        AND company_id IS NULL
    `).catch(() => ({ rows: [{ cnt: 0 }] }));

    if (Number((noCo as any[])[0]?.cnt ?? 0) > 0) {
      errors.push({
        code: "MISSING_COMPANY",
        severity: "HIGH",
        message: "Ada transaksi pajak tanpa company_id — tidak akan masuk ekspor",
      });
    }

    // ── FASE 4 T010: G. NPWP kosong untuk transaksi yang wajib ──────────────
    const { rows: missingNpwpRows } = await db.execute(sql`
      SELECT COUNT(*)::int AS cnt
      FROM transaction_taxes
      WHERE company_id = ${p.companyId} AND period = ${p.period}
        AND direction IN ('input', 'output', 'withholding')
        AND status != 'voided'
        AND (npwp IS NULL OR npwp = '')
    `).catch(() => ({ rows: [{ cnt: 0 }] }));

    const missingNpwpCnt = Number((missingNpwpRows as any[])[0]?.cnt ?? 0);
    if (missingNpwpCnt > 0) {
      errors.push({
        code: "MISSING_NPWP",
        severity: "HIGH",
        message: `${missingNpwpCnt} transaksi pajak tidak memiliki NPWP lawan — wajib diisi sebelum pelaporan Coretax`,
        detail: { count: missingNpwpCnt },
      });
    }

    // ── FASE 4 T010: H. Duplikat nomor faktur lintas periode ────────────────
    const fakturNumsInPeriod = draft.transactions
      .map(t => t.faktur_pajak_number)
      .filter(Boolean) as string[];

    if (fakturNumsInPeriod.length > 0) {
      const { rows: crossPeriodDups } = await db.execute(sql.raw(`
        SELECT faktur_pajak_number, period, COUNT(*) AS cnt
        FROM transaction_taxes
        WHERE company_id = ${p.companyId}
          AND period != '${p.period}'
          AND status != 'voided'
          AND faktur_pajak_number IN (${fakturNumsInPeriod.map(n => `'${n.replace(/'/g, "''")}'`).join(",")})
        GROUP BY faktur_pajak_number, period
      `)).catch(() => ({ rows: [] }));

      (crossPeriodDups as any[]).forEach(r => {
        errors.push({
          code: "CROSS_PERIOD_DUPLICATE_FAKTUR",
          severity: "HIGH",
          message: `Nomor faktur ${r.faktur_pajak_number} sudah digunakan di periode ${r.period} — tidak boleh dilaporkan ulang di ${p.period}`,
          detail: { faktur_pajak_number: r.faktur_pajak_number, other_period: r.period },
        });
      });
    }

    const isValid = !errors.some(e => e.severity === "HIGH");

    // Jika valid, update saved draft ke "validated"
    if (isValid) {
      try {
        await ensureSptV2();
        const drafts = await listSptDrafts(p.companyId, p.period.slice(0, 4));
        const match = drafts.find(d => d.period === p.period);
        if (match && match.status === "draft") {
          await updateSptDraftStatus(match.id, p.companyId, "validated");
        }
      } catch (_) {}
    }

    return res.json({
      ok: isValid,
      period: p.period,
      is_valid: isValid,
      error_count: errors.filter(e => e.severity === "HIGH").length,
      warning_count: errors.filter(e => e.severity !== "HIGH").length,
      errors,
      summary: recon.summary,
    });
  } catch (err: any) {
    logger.error({ err: err.message }, "[tax/spt/validate] gagal");
    return res.status(500).json({ error: "Gagal validasi SPT" });
  }
});

// ── POST /api/tax/spt/export — generate CSV DJP, return base64 files ──────────
router.post("/spt/export", async (req, res) => {
  const p = parseSptParams(req);
  if (!p) return res.status(400).json({ error: "companyId dan period (YYYY-MM) diperlukan" });

  const { taxTypes = ["PPN", "PPH23", "PPH21"], npwp = "", nama = "" } = req.body ?? {};
  const opts = { npwpPerusahaan: npwp || undefined, namaPerusahaan: nama || undefined };

  try {
    const draft = await buildSptDraft(p.companyId, p.period);
    const files: Array<{ filename: string; content_b64: string; type: string; row_count: number; total_dpp: number; total_pajak: number }> = [];

    const types = Array.isArray(taxTypes) ? taxTypes : [taxTypes];

    for (const t of types) {
      const type = String(t).toUpperCase();
      let result;

      if (type === "PPH23" || type === "PPH_23") {
        result = exportPph23Csv(draft, opts);
        files.push({
          filename: `PPh23_${p.period}.csv`,
          content_b64: Buffer.from(result.csv, "utf8").toString("base64"),
          type: "PPH23",
          row_count: result.row_count,
          total_dpp: result.total_dpp,
          total_pajak: result.total_pajak,
        });
      } else if (type === "PPH21" || type === "PPH_21") {
        result = exportPph21Csv(draft, opts);
        files.push({
          filename: `PPh21_${p.period}.csv`,
          content_b64: Buffer.from(result.csv, "utf8").toString("base64"),
          type: "PPH21",
          row_count: result.row_count,
          total_dpp: result.total_dpp,
          total_pajak: result.total_pajak,
        });
      } else {
        result = exportPpnCsv(draft, opts);
        files.push({
          filename: `PPN_Masa_${p.period}.csv`,
          content_b64: Buffer.from(result.csv, "utf8").toString("base64"),
          type: "PPN",
          row_count: result.row_count,
          total_dpp: result.total_dpp,
          total_pajak: result.total_pajak,
        });
      }
    }

    // Update saved draft ke exported
    try {
      await ensureSptV2();
      const drafts = await listSptDrafts(p.companyId, p.period.slice(0, 4));
      const match = drafts.find(d => d.period === p.period);
      if (match && ["draft","validated"].includes(match.status)) {
        await updateSptDraftStatus(match.id, p.companyId, "exported");
      }
    } catch (_) {}

    return res.json({
      ok: true,
      period: p.period,
      files,
      exported_at: new Date().toISOString(),
    });
  } catch (err: any) {
    logger.error({ err: err.message }, "[tax/spt/export] gagal");
    return res.status(500).json({ error: "Gagal export CSV SPT" });
  }
});

// ── PATCH /api/tax/spt/submit — tandai submitted (manual upload ke Coretax) ───
router.patch("/spt/submit", async (req, res) => {
  const p = parseSptParams(req);
  if (!p) return res.status(400).json({ error: "companyId dan period (YYYY-MM) diperlukan" });

  const { notes } = req.body ?? {};

  try {
    await ensureSptV2();

    // Cek periode sudah submitted belum
    const drafts = await listSptDrafts(p.companyId, p.period.slice(0, 4));
    let match = drafts.find(d => d.period === p.period);

    if (match?.status === "submitted") {
      return res.status(409).json({
        error: "Periode ini sudah submitted — tidak bisa diubah",
        submitted_at: match.updated_at,
      });
    }

    if (!match) {
      // Buat draft baru kalau belum ada
      const draft = await buildSptDraft(p.companyId, p.period);
      const id = await saveSptDraft({ companyId: p.companyId, period: p.period, type: "ALL", draft, notes: notes ?? "Manual submit via SPT Builder" });
      match = { id, company_id: p.companyId, period: p.period, type: "ALL", status: "draft", payload_json: draft, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    }

    await updateSptDraftStatus(match.id, p.companyId, "submitted");

    logger.info({ companyId: p.companyId, period: p.period }, "[tax/spt/submit] SPT submitted");

    return res.json({
      ok: true,
      period: p.period,
      status: "submitted",
      submitted_at: new Date().toISOString(),
      message: `SPT Masa ${p.period} berhasil ditandai sebagai submitted`,
    });
  } catch (err: any) {
    logger.error({ err: err.message }, "[tax/spt/submit] gagal");
    return res.status(500).json({ error: "Gagal submit SPT" });
  }
});

// ── GET /api/tax/spt/status — get current status for a period ─────────────────
router.get("/spt/status", async (req, res) => {
  const p = parseSptParams(req);
  if (!p) return res.status(400).json({ error: "companyId dan period (YYYY-MM) diperlukan" });

  try {
    await ensureSptV2();
    const drafts = await listSptDrafts(p.companyId, p.period.slice(0, 4));
    const match = drafts.find(d => d.period === p.period);
    return res.json({
      period: p.period,
      status: match?.status ?? "draft",
      draft_id: match?.id ?? null,
      updated_at: match?.updated_at ?? null,
    });
  } catch (err: any) {
    return res.json({ period: p.period, status: "draft", draft_id: null });
  }
});

router.use("/spt-builder", sptBuilderRouter);

// ── POST /api/tax/sync-from-ledger ────────────────────────────────────────────
// Sync pipeline: tax_transactions (event ledger) → transaction_taxes (SPT register)
router.post("/sync-from-ledger", async (req, res) => {
  const companyId = resolveCompanyId(req) ?? undefined;
  const { period, limit } = req.query as Record<string, string>;
  try {
    const { syncTaxLedgerToRegister } = await import("../lib/taxLedgerSyncService.js");
    const result = await syncTaxLedgerToRegister({
      companyId,
      period: period || undefined,
      limit: limit ? Math.min(500, parseInt(limit)) : 200,
    });
    return res.json({ ok: true, ...result });
  } catch (err: any) {
    logger.error({ err: err.message }, "[tax/sync-from-ledger] gagal");
    return res.status(500).json({ error: "Sync gagal", detail: err.message });
  }
});

export default router;

