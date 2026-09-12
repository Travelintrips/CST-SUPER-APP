/**
 * Audit endpoint: Bank Disbursement ↔ Biaya Operasional
 *
 * READ-ONLY: tidak ada write, tidak ada DROP, tidak ada DELETE.
 * Semua query hanya SELECT untuk keperluan audit sebelum merge.
 */

import { Router, type Request } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireAdmin } from "../lib/requireAdmin.js";
import { auditFromReq } from "../lib/auditLog.js";

const router = Router();
router.use(async (req, res, next) => {
  if (!(await requireAdmin(req, res))) return;
  next();
});

function rows<T>(r: unknown): T[] {
  if (Array.isArray(r)) return r as T[];
  return ((r as any)?.rows ?? []) as T[];
}

// ── GET /api/audit/disbursement-expense ──────────────────────────────────────
router.get("/", async (req, res) => {
  const { company } = req.query as Record<string, string>;
  const companyId   = company ? parseInt(company) : null;
  const hasCompany  = companyId != null && !isNaN(companyId) && companyId > 0;
  const cWhere      = hasCompany ? sql`AND company_id = ${companyId}` : sql``;
  const eCWhere     = hasCompany ? sql`AND e.company_id = ${companyId}` : sql``;
  const bCWhere     = hasCompany ? sql`AND bd.company_id = ${companyId}` : sql``;

  const [
    // ── Metadata counts ──────────────────────────────────────────────────
    expenseCount,
    disbursementCount,
    // ── Kategori 1: Expense yang sudah dibayar via disbursement ─────────
    expensePaid,
    // ── Kategori 2: Expense yang BELUM punya disbursement & belum jurnal ─
    expenseUnpaidNoJournal,
    // ── Kategori 3: Expense yang sudah jurnal TAPI belum punya disbursement
    expenseJournaledNoPay,
    // ── Kategori 4: Disbursement standalone (tanpa expense asal) ─────────
    disbStandalone,
    // ── Kategori 5: Disbursement yang sudah jurnal ───────────────────────
    disbJournaled,
    // ── RISIKO: Double jurnal (expense + disb keduanya punya entry_id) ───
    doubleJournal,
    // ── RISIKO: Double bayar (expense punya >1 disbursement aktif) ───────
    doublePay,
    // ── Schema: kolom expenses vs bank_disbursements ─────────────────────
    expenseCols,
    disbCols,
  ] = await Promise.all([
    db.execute(sql`SELECT COUNT(*)::int AS total FROM expenses WHERE 1=1 ${cWhere}`),
    db.execute(sql`SELECT COUNT(*)::int AS total FROM bank_disbursements WHERE 1=1 ${cWhere}`),

    // Kategori 1: terbayar via bank_disbursement (source_module='expense')
    db.execute(sql`
      SELECT
        e.id               AS expense_id,
        e.expense_number,
        e.date             AS expense_date,
        e.total            AS expense_amount,
        e.status           AS expense_status,
        e.entry_id         AS expense_entry_id,
        bd.id              AS disbursement_id,
        bd.disbursement_number,
        bd.date            AS disb_date,
        bd.total_amount    AS disb_amount,
        bd.status          AS disb_status,
        bd.entry_id        AS disb_entry_id
      FROM expenses e
      JOIN bank_disbursements bd
        ON bd.source_module = 'expense'
       AND bd.source_id = e.id
       AND bd.status <> 'voided'
      WHERE 1=1 ${eCWhere}
      ORDER BY e.date DESC
      LIMIT 100
    `),

    // Kategori 2: Expense belum dibayar & belum terjurnal
    db.execute(sql`
      SELECT
        e.id, e.expense_number, e.date, e.total, e.status, e.expense_type,
        e.entry_id, e.vendor_employee
      FROM expenses e
      WHERE e.status NOT IN ('voided', 'cancelled')
        AND e.entry_id IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM bank_disbursements bd
          WHERE bd.source_module = 'expense'
            AND bd.source_id = e.id
            AND bd.status <> 'voided'
        )
      ${eCWhere}
      ORDER BY e.date DESC
      LIMIT 100
    `),

    // Kategori 3: Expense sudah punya jurnal tapi belum ada disbursement
    db.execute(sql`
      SELECT
        e.id, e.expense_number, e.date, e.total, e.status, e.expense_type, e.entry_id
      FROM expenses e
      WHERE e.entry_id IS NOT NULL
        AND e.status NOT IN ('voided', 'cancelled')
        AND NOT EXISTS (
          SELECT 1 FROM bank_disbursements bd
          WHERE bd.source_module = 'expense'
            AND bd.source_id = e.id
            AND bd.status <> 'voided'
        )
      ${eCWhere}
      ORDER BY e.date DESC
      LIMIT 100
    `),

    // Kategori 4: Disbursement standalone (tidak punya expense asal)
    db.execute(sql`
      SELECT
        bd.id, bd.disbursement_number, bd.date, bd.total_amount, bd.status,
        bd.source_module, bd.source_id, bd.source_number, bd.payment_type, bd.entry_id,
        bd.memo
      FROM bank_disbursements bd
      WHERE (bd.source_module IS NULL OR bd.source_module <> 'expense')
        AND bd.status <> 'voided'
      ${bCWhere}
      ORDER BY bd.date DESC
      LIMIT 100
    `),

    // Kategori 5: Disbursement yang sudah jurnal
    db.execute(sql`
      SELECT
        bd.id, bd.disbursement_number, bd.date, bd.total_amount, bd.status, bd.entry_id,
        bd.source_module, bd.source_number
      FROM bank_disbursements bd
      WHERE bd.entry_id IS NOT NULL
        AND bd.status <> 'voided'
      ${bCWhere}
      ORDER BY bd.date DESC
      LIMIT 100
    `),

    // RISIKO: Double Jurnal — expense + disbursement keduanya punya entry_id
    db.execute(sql`
      SELECT
        e.id              AS expense_id,
        e.expense_number,
        e.entry_id        AS expense_entry_id,
        e.total           AS expense_amount,
        bd.id             AS disb_id,
        bd.disbursement_number,
        bd.entry_id       AS disb_entry_id,
        bd.total_amount   AS disb_amount,
        bd.date           AS disb_date
      FROM expenses e
      JOIN bank_disbursements bd
        ON bd.source_module = 'expense'
       AND bd.source_id = e.id
       AND bd.status <> 'voided'
      WHERE e.entry_id IS NOT NULL
        AND bd.entry_id IS NOT NULL
      ${eCWhere}
      ORDER BY bd.date DESC
      LIMIT 100
    `),

    // RISIKO: Double Bayar — expense punya >1 disbursement aktif
    db.execute(sql`
      SELECT
        bd.source_id      AS expense_id,
        COUNT(*)::int     AS disb_count,
        SUM(bd.total_amount::numeric) AS total_paid,
        ARRAY_AGG(bd.disbursement_number ORDER BY bd.id) AS disb_numbers,
        ARRAY_AGG(bd.id ORDER BY bd.id) AS disb_ids
      FROM bank_disbursements bd
      WHERE bd.source_module = 'expense'
        AND bd.status <> 'voided'
      ${bCWhere}
      GROUP BY bd.source_id
      HAVING COUNT(*) > 1
      ORDER BY disb_count DESC
      LIMIT 50
    `),

    // Kolom tabel expenses dari information_schema
    db.execute(sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'expenses'
      ORDER BY ordinal_position
    `),

    // Kolom tabel bank_disbursements dari information_schema
    db.execute(sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'bank_disbursements'
      ORDER BY ordinal_position
    `),
  ]);

  // ── Bridge status counts ─────────────────────────────────────────────────
  const [bridgeLinked, bridgeUnlinked, bridgeConflict] = await Promise.all([
    // Linked: pasangan yang KEDUA kolom bridge sudah terisi dan konsisten
    db.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM bank_disbursements bd
      JOIN expenses e ON e.id = bd.expense_id
      WHERE bd.source_module = 'expense'
        AND bd.source_id = e.id
        AND bd.status <> 'voided'
        AND bd.expense_id IS NOT NULL
        AND e.disbursement_id IS NOT NULL
        ${bCWhere}
    `),
    // Unlinked: tertaut via source_module tapi SALAH SATU atau KEDUA kolom bridge masih NULL
    db.execute(sql`
      SELECT COUNT(*)::int AS total
      FROM bank_disbursements bd
      JOIN expenses e ON bd.source_id = e.id
      WHERE bd.source_module = 'expense'
        AND bd.status <> 'voided'
        AND (bd.expense_id IS NULL OR e.disbursement_id IS NULL)
        ${bCWhere}
    `),
    // Conflict: expense punya >1 disbursement aktif (double-pay risk)
    db.execute(sql`
      SELECT COUNT(DISTINCT bd.source_id)::int AS total
      FROM bank_disbursements bd
      WHERE bd.source_module = 'expense'
        AND bd.status <> 'voided'
        ${bCWhere}
      GROUP BY bd.source_id
      HAVING COUNT(*) > 1
    `),
  ]);

  const linkedCount   = Number((rows(bridgeLinked)[0] as any)?.total ?? 0);
  const unlinkedCount = Number((rows(bridgeUnlinked)[0] as any)?.total ?? 0);
  // conflict = jumlah expense yang punya >1 disbursement aktif
  const conflictCount = (rows(bridgeConflict) as any[]).length;

  const expenseTotal       = Number((rows(expenseCount)[0] as any)?.total ?? 0);
  const disbTotal          = Number((rows(disbursementCount)[0] as any)?.total ?? 0);
  const paidRows           = rows(expensePaid);
  const unpaidNoJrnRows    = rows(expenseUnpaidNoJournal);
  const jrnNoPay           = rows(expenseJournaledNoPay);
  const standaloneRows     = rows(disbStandalone);
  const jrnDisb            = rows(disbJournaled);
  const doubleJrnRows      = rows(doubleJournal);
  const doublePayRows      = rows(doublePay);
  const expenseColsList    = rows(expenseCols);
  const disbColsList       = rows(disbCols);

  // Hitung ringkasan disbursement per source_module
  const sourceModuleSummary = await db.execute(sql`
    SELECT
      COALESCE(source_module, '(null)') AS source_module,
      COUNT(*)::int AS jumlah,
      SUM(total_amount::numeric) AS total_nominal
    FROM bank_disbursements
    WHERE status <> 'voided'
    ${cWhere}
    GROUP BY source_module
    ORDER BY jumlah DESC
  `);

  // Ringkasan expense per status
  const expenseStatusSummary = await db.execute(sql`
    SELECT
      status,
      COUNT(*)::int AS jumlah,
      SUM(total::numeric) AS total_nominal,
      COUNT(CASE WHEN entry_id IS NOT NULL THEN 1 END)::int AS sudah_jurnal,
      COUNT(CASE WHEN entry_id IS NULL THEN 1 END)::int AS belum_jurnal
    FROM expenses
    WHERE 1=1 ${cWhere}
    GROUP BY status
    ORDER BY jumlah DESC
  `);

  return res.json({
    counts: {
      expenses: expenseTotal,
      disbursements: disbTotal,
    },
    bridge: {
      linked: linkedCount,
      unlinked: unlinkedCount,
      conflict: conflictCount,
      readyToMigrate: linkedCount > 0 && unlinkedCount === 0 && conflictCount === 0,
    },
    summary: {
      expenseByStatus: rows(expenseStatusSummary),
      disbBySourceModule: rows(sourceModuleSummary),
    },
    categories: {
      // Kategori 1
      expensePaidViaDisb: {
        count: paidRows.length,
        rows: paidRows,
        label: "Expense yang sudah dibayar via Bank Disbursement",
      },
      // Kategori 2
      expenseUnpaidNoJournal: {
        count: unpaidNoJrnRows.length,
        rows: unpaidNoJrnRows,
        label: "Expense belum dibayar & belum terjurnal",
      },
      // Kategori 3
      expenseJournaledNoPayment: {
        count: jrnNoPay.length,
        rows: jrnNoPay,
        label: "Expense sudah terjurnal tapi belum ada pembayaran bank",
      },
      // Kategori 4
      disbursementStandalone: {
        count: standaloneRows.length,
        rows: standaloneRows,
        label: "Disbursement standalone (tidak punya expense asal)",
      },
      // Kategori 5
      disbursementJournaled: {
        count: jrnDisb.length,
        rows: jrnDisb,
        label: "Disbursement yang sudah terjurnal",
      },
    },
    risks: {
      doubleJournal: {
        count: doubleJrnRows.length,
        rows: doubleJrnRows,
        label: "⚠ Risiko Double Jurnal: expense + disbursement keduanya punya entry_id",
        severity: doubleJrnRows.length > 0 ? "HIGH" : "NONE",
      },
      doublePayment: {
        count: doublePayRows.length,
        rows: doublePayRows,
        label: "⚠ Risiko Double Bayar: satu expense dibayar >1 kali via disbursement",
        severity: doublePayRows.length > 0 ? "HIGH" : "NONE",
      },
    },
    schema: {
      expenses: expenseColsList,
      bankDisbursements: disbColsList,
    },
  });
});

// ── Backfill: Expense ↔ Bank Disbursement bridge ─────────────────────────────
// Mengisi kolom bridge (expenses.disbursement_id / bank_disbursements.expense_id)
// untuk pasangan lama yang sudah tertaut lewat source_module='expense' +
// source_id, TAPI kolom bridge barunya masih NULL. Tidak pernah membuat baris
// baru, tidak menghapus apa pun — hanya UPDATE kolom bridge yang kosong.
async function findBackfillCandidates(companyId: number | null) {
  const cWhere = companyId ? sql`AND bd.company_id = ${companyId}` : sql``;
  const result = await db.execute(sql`
    SELECT
      e.id                AS expense_id,
      e.expense_number,
      e.disbursement_id   AS expense_current_disbursement_id,
      bd.id               AS disbursement_id,
      bd.disbursement_number,
      bd.expense_id        AS disb_current_expense_id,
      bd.total_amount,
      e.total              AS expense_total,
      bd.status
    FROM bank_disbursements bd
    JOIN expenses e
      ON bd.source_module = 'expense'
     AND bd.source_id = e.id
    WHERE bd.status <> 'voided'
      AND (bd.expense_id IS NULL OR e.disbursement_id IS NULL)
      ${cWhere}
    ORDER BY bd.id
    LIMIT 2000
  `);
  return rows<any>(result);
}

function classifyCandidates(candidates: any[]) {
  const applicable: any[] = [];
  const skippedConflict: any[] = [];
  const skippedAmountMismatch: any[] = [];
  const seenExpense = new Set<number>();

  for (const c of candidates) {
    const expId = Number(c.expense_id);
    const disbId = Number(c.disbursement_id);

    // Skip kalau expense sudah punya disbursement_id lain (bukan disbursement ini)
    if (c.expense_current_disbursement_id != null && Number(c.expense_current_disbursement_id) !== disbId) {
      skippedConflict.push({ ...c, reason: "Expense sudah tertaut ke disbursement lain" });
      continue;
    }
    // Skip kalau disbursement sudah punya expense_id lain (bukan expense ini)
    if (c.disb_current_expense_id != null && Number(c.disb_current_expense_id) !== expId) {
      skippedConflict.push({ ...c, reason: "Disbursement sudah tertaut ke expense lain" });
      continue;
    }
    // Skip kalau expense ini sudah "dipakai" oleh kandidat lain di batch ini (double-pay lama)
    if (seenExpense.has(expId)) {
      skippedConflict.push({ ...c, reason: "Expense sudah dipasangkan dengan disbursement lain di batch ini (indikasi double-pay lama)" });
      continue;
    }
    const amtDisb = Math.round(Number(c.total_amount) * 100);
    const amtExp = Math.round(Number(c.expense_total) * 100);
    if (amtDisb !== amtExp) {
      skippedAmountMismatch.push({ ...c, reason: `Nominal tidak sama persis (disbursement=${c.total_amount}, expense=${c.expense_total})` });
      continue;
    }
    seenExpense.add(expId);
    applicable.push(c);
  }
  return { applicable, skippedConflict, skippedAmountMismatch };
}

// GET /api/audit/disbursement-expense/backfill-preview — dry-run, tidak menulis apa pun.
router.get("/backfill-preview", async (req, res) => {
  const { company } = req.query as Record<string, string>;
  const companyId = company ? parseInt(company) : null;
  const candidates = await findBackfillCandidates(companyId != null && !isNaN(companyId) ? companyId : null);
  const { applicable, skippedConflict, skippedAmountMismatch } = classifyCandidates(candidates);
  return res.json({
    dryRun: true,
    totalCandidates: candidates.length,
    willApply: applicable.length,
    willSkip: skippedConflict.length + skippedAmountMismatch.length,
    applicable,
    skippedConflict,
    skippedAmountMismatch,
  });
});

// POST /api/audit/disbursement-expense/backfill-apply — WRITE. Hanya UPDATE
// kolom bridge yang masih NULL; skip semua konflik/mismatch; audit-logged.
router.post("/backfill-apply", async (req: Request, res) => {
  const { company } = (req.body ?? {}) as Record<string, unknown>;
  const companyId = company != null ? Number(company) : null;
  const candidates = await findBackfillCandidates(companyId != null && !isNaN(companyId) ? companyId : null);
  const { applicable, skippedConflict, skippedAmountMismatch } = classifyCandidates(candidates);

  const applied: any[] = [];
  const failed: any[] = [];

  for (const c of applicable) {
    const expId = Number(c.expense_id);
    const disbId = Number(c.disbursement_id);
    try {
      await db.transaction(async (tx) => {
        await tx.execute(sql`
          UPDATE bank_disbursements SET expense_id = ${expId}
          WHERE id = ${disbId} AND expense_id IS NULL
        `);
        await tx.execute(sql`
          UPDATE expenses SET disbursement_id = ${disbId}
          WHERE id = ${expId} AND disbursement_id IS NULL
        `);
      });
      applied.push({ expenseId: expId, disbursementId: disbId });
    } catch (e: any) {
      // Constraint unik (partial index) mencegah double-link — skip, jangan gagalkan batch.
      failed.push({ expenseId: expId, disbursementId: disbId, error: e.message });
    }
  }

  auditFromReq(req, {
    action: "BACKFILL_EXPENSE_DISBURSEMENT_BRIDGE",
    module: "expense",
    referenceId: companyId ? String(companyId) : "all-companies",
    newData: {
      totalCandidates: candidates.length,
      applied: applied.length,
      skippedConflict: skippedConflict.length,
      skippedAmountMismatch: skippedAmountMismatch.length,
      failed: failed.length,
      timestamp: new Date().toISOString(),
    },
  });

  return res.json({
    dryRun: false,
    totalCandidates: candidates.length,
    applied: applied.length,
    appliedRows: applied,
    skippedConflict: skippedConflict.length,
    skippedAmountMismatch: skippedAmountMismatch.length,
    failed: failed.length,
    failedRows: failed,
  });
});

export default router;
