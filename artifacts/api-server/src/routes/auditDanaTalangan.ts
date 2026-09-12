import { Router } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireAdmin } from "../lib/requireAdmin.js";
import { postEntryWithClient } from "../lib/accounting.js";
import { resolveIntercompanyAccounts } from "../lib/advance/AdvanceJournalService.js";

const router = Router();
router.use(async (req, res, next) => {
  if (!(await requireAdmin(req, res))) return;
  next();
});

// ── Validasi tanggal format YYYY-MM-DD ────────────────────────────────────────
function isValidDate(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
}

// ── Buat VIEW audit saat module pertama kali dimuat ──────────────────────────
async function ensureAuditView() {
  await db.execute(sql.raw(`
    CREATE OR REPLACE VIEW audit_dana_talangan_coa AS
    SELECT
      ca.id,
      ca.advance_number                         AS no_talangan,
      ca.date                                   AS tanggal,
      ca.company_id,
      CASE
        WHEN coa_bank.id IS NOT NULL
          THEN coa_bank.code || ' — ' || coa_bank.name
        WHEN ca.cash_bank_account_id IS NOT NULL
          THEN '(id=' || ca.cash_bank_account_id || ' tidak ada di COA)'
        ELSE NULL
      END                                       AS sumber_dana,
      ca.cash_bank_account_id                   AS sumber_dana_id,
      ca.receivable_account_id                  AS coa_id_transaksi,
      master_coa.id                             AS coa_id_master,
      master_coa.code                           AS coa_master_code,
      master_coa.name                           AS coa_master_name,
      coa_recv.code                             AS coa_transaksi_code,
      coa_recv.name                             AS coa_transaksi_name,
      ca.status,
      CASE
        WHEN ca.receivable_account_id IS NULL
          THEN 'Transaksi belum memiliki COA'
        WHEN ca.cash_bank_account_id IS NULL
          THEN 'Sumber Dana kosong'
        WHEN ca.cash_bank_account_id IS NOT NULL AND coa_bank.id IS NULL
          THEN 'Sumber Dana tidak ditemukan'
        WHEN ca.receivable_account_id IS NOT NULL AND coa_recv.id IS NULL
          THEN 'COA tidak ditemukan'
        WHEN master_coa.id IS NULL
          THEN 'Master Sumber Dana belum memiliki COA'
        WHEN ca.receivable_account_id <> master_coa.id
          THEN 'COA transaksi berbeda dengan Master'
        ELSE 'OK'
      END                                       AS masalah
    FROM cash_advances ca
    LEFT JOIN chart_of_accounts coa_bank
           ON ca.cash_bank_account_id = coa_bank.id
    LEFT JOIN chart_of_accounts coa_recv
           ON ca.receivable_account_id = coa_recv.id
    LEFT JOIN LATERAL (
      SELECT id, code, name
      FROM chart_of_accounts
      WHERE code LIKE '1-1033%'
        AND (company_id = ca.company_id OR company_id IS NULL)
      ORDER BY (company_id = ca.company_id) DESC NULLS LAST, id
      LIMIT 1
    ) master_coa ON true
    WHERE ca.type = 'talangan'
  `)).catch((e: unknown) => {
    console.error("[audit-dana-talangan] Gagal membuat view:", e);
  });
}
ensureAuditView();

// ── GET /api/audit/dana-talangan ──────────────────────────────────────────────
router.get("/", async (req, res) => {
  const { masalah, company, from, to, limit: limitQ, offset: offsetQ } = req.query as Record<string, string>;

  // Validate date inputs to prevent SQL injection
  const safeFrom = isValidDate(from) ? from : null;
  const safeTo   = isValidDate(to)   ? to   : null;

  // company filter — use parameterized binding
  const companyId = company ? parseInt(company) : null;
  const hasCompany = companyId != null && !isNaN(companyId) && companyId > 0;

  const lim = Math.min(parseInt(limitQ ?? "200") || 200, 500);
  const off = parseInt(offsetQ ?? "0") || 0;

  // Build parameterized WHERE for main query
  const conditions: string[] = ["1=1"];
  const summaryConditions: string[] = ["1=1"];

  if (masalah && masalah !== "all") {
    // masalah is always one of a fixed set of strings we define — no user content in raw SQL
    const allowed = [
      "OK",
      "Transaksi belum memiliki COA",
      "Sumber Dana kosong",
      "Sumber Dana tidak ditemukan",
      "Master Sumber Dana belum memiliki COA",
      "COA transaksi berbeda dengan Master",
      "COA tidak ditemukan",
    ];
    if (allowed.includes(masalah)) {
      // Safe to use parameterized binding
      conditions.push(`masalah = '${masalah.replace(/'/g, "''")}'`);
    }
  }

  const [rows, summary, totalRow] = await Promise.all([
    db.execute(sql`
      SELECT * FROM audit_dana_talangan_coa
      WHERE 1=1
        ${hasCompany    ? sql`AND company_id = ${companyId}`             : sql``}
        ${masalah && masalah !== "all" && [
            "OK","Transaksi belum memiliki COA","Sumber Dana kosong",
            "Sumber Dana tidak ditemukan","Master Sumber Dana belum memiliki COA",
            "COA transaksi berbeda dengan Master","COA tidak ditemukan",
          ].includes(masalah)
          ? sql`AND masalah = ${masalah}`
          : sql``}
        ${safeFrom ? sql`AND tanggal >= ${safeFrom}::date` : sql``}
        ${safeTo   ? sql`AND tanggal <= ${safeTo}::date`   : sql``}
      ORDER BY tanggal DESC, id DESC
      LIMIT ${lim} OFFSET ${off}
    `),
    db.execute(sql`
      SELECT masalah, COUNT(*) AS jumlah
      FROM audit_dana_talangan_coa
      WHERE 1=1
        ${hasCompany ? sql`AND company_id = ${companyId}` : sql``}
      GROUP BY masalah
      ORDER BY
        CASE masalah
          WHEN 'OK'                                   THEN 0
          WHEN 'Transaksi belum memiliki COA'          THEN 1
          WHEN 'Sumber Dana kosong'                    THEN 2
          WHEN 'Sumber Dana tidak ditemukan'           THEN 3
          WHEN 'Master Sumber Dana belum memiliki COA' THEN 4
          WHEN 'COA transaksi berbeda dengan Master'   THEN 5
          WHEN 'COA tidak ditemukan'                   THEN 6
          ELSE 7
        END
    `),
    db.execute(sql`
      SELECT COUNT(*) AS total FROM audit_dana_talangan_coa
      WHERE 1=1
        ${hasCompany ? sql`AND company_id = ${companyId}` : sql``}
        ${masalah && masalah !== "all" && [
            "OK","Transaksi belum memiliki COA","Sumber Dana kosong",
            "Sumber Dana tidak ditemukan","Master Sumber Dana belum memiliki COA",
            "COA transaksi berbeda dengan Master","COA tidak ditemukan",
          ].includes(masalah)
          ? sql`AND masalah = ${masalah}`
          : sql``}
        ${safeFrom ? sql`AND tanggal >= ${safeFrom}::date` : sql``}
        ${safeTo   ? sql`AND tanggal <= ${safeTo}::date`   : sql``}
    `),
  ]);

  return res.json({
    summary: summary.rows,
    total: Number((totalRow.rows[0] as any)?.total ?? 0),
    rows: rows.rows,
    limit: lim,
    offset: off,
  });
});

// ── POST /api/audit/dana-talangan/fix-bulk ────────────────────────────────────
// Perbaikan massal: salin coa_id_master ke receivable_account_id untuk transaksi
// yang BELUM memiliki jurnal (entry_id IS NULL) → aman diubah tanpa reversal.
// Transaksi yang sudah punya jurnal harus diperbaiki via void + re-post.
//
// KEAMANAN: company wajib diisi dan harus > 0. Mode konsolidasi (0 / null)
// DITOLAK untuk operasi tulis ini agar tidak mengenai semua perusahaan sekaligus.
router.post("/fix-bulk", async (req, res) => {
  const { company, dryRun } = req.body ?? {};
  const isDry = dryRun === true || dryRun === "true";

  const companyId = company != null ? parseInt(String(company)) : null;
  const hasCompany = companyId != null && !isNaN(companyId) && companyId > 0;

  // Tolak mode konsolidasi untuk operasi write
  if (!hasCompany) {
    return res.status(400).json({
      message: "Pilih perusahaan terlebih dahulu sebelum menjalankan perbaikan massal. Mode konsolidasi tidak diizinkan untuk operasi ini.",
    });
  }

  // Kandidat 1: COA berbeda dari master (entry_id IS NULL)
  const diffCandidates = await db.execute(sql`
    SELECT
      ca.id,
      ca.advance_number,
      ca.receivable_account_id  AS coa_lama,
      master_coa.id             AS coa_baru,
      master_coa.code           AS coa_baru_code,
      master_coa.name           AS coa_baru_name
    FROM cash_advances ca
    LEFT JOIN LATERAL (
      SELECT id, code, name
      FROM chart_of_accounts
      WHERE code LIKE '1-1033%'
        AND (company_id = ca.company_id OR company_id IS NULL)
      ORDER BY (company_id = ca.company_id) DESC NULLS LAST, id
      LIMIT 1
    ) master_coa ON true
    WHERE ca.type = 'talangan'
      AND ca.company_id = ${companyId}
      AND ca.entry_id IS NULL
      AND ca.receivable_account_id IS NOT NULL
      AND master_coa.id IS NOT NULL
      AND ca.receivable_account_id <> master_coa.id
    ORDER BY ca.id
  `);

  // Kandidat 2: COA null yang bisa diisi (entry_id IS NULL)
  const nullCandidates = await db.execute(sql`
    SELECT
      ca.id,
      ca.advance_number,
      NULL::integer             AS coa_lama,
      master_coa.id             AS coa_baru,
      master_coa.code           AS coa_baru_code,
      master_coa.name           AS coa_baru_name
    FROM cash_advances ca
    LEFT JOIN LATERAL (
      SELECT id, code, name
      FROM chart_of_accounts
      WHERE code LIKE '1-1033%'
        AND (company_id = ca.company_id OR company_id IS NULL)
      ORDER BY (company_id = ca.company_id) DESC NULLS LAST, id
      LIMIT 1
    ) master_coa ON true
    WHERE ca.type = 'talangan'
      AND ca.company_id = ${companyId}
      AND ca.entry_id IS NULL
      AND ca.receivable_account_id IS NULL
      AND master_coa.id IS NOT NULL
    ORDER BY ca.id
  `);

  const diffRows  = diffCandidates.rows  as any[];
  const nullRows  = nullCandidates.rows  as any[];
  const allFixable = [...diffRows, ...nullRows];

  if (isDry || allFixable.length === 0) {
    return res.json({
      dryRun: true,
      fixable: allFixable.length,
      breakdown: { coaBerbeda: diffRows.length, coaNull: nullRows.length },
      preview: allFixable.slice(0, 50),
      message: allFixable.length === 0
        ? "Tidak ada transaksi yang bisa diperbaiki secara otomatis."
        : `${allFixable.length} transaksi siap diperbaiki (dry run — belum dieksekusi).`,
    });
  }

  // Eksekusi dalam satu transaksi DB agar atomic
  // Grup berdasarkan coa_baru agar bisa UPDATE per-batch (satu query per nilai COA unik)
  const byCoaBaru = new Map<number, number[]>();
  for (const row of allFixable) {
    const existing = byCoaBaru.get(row.coa_baru) ?? [];
    existing.push(row.id);
    byCoaBaru.set(row.coa_baru, existing);
  }

  let updated = 0;
  await db.execute(sql`BEGIN`).catch(() => {});
  try {
    for (const [coaBaru, ids] of byCoaBaru) {
      const result = await db.execute(sql`
        UPDATE cash_advances
        SET receivable_account_id = ${coaBaru}, updated_at = NOW()
        WHERE id = ANY(${ids}::int[])
          AND entry_id IS NULL
          AND type = 'talangan'
          AND company_id = ${companyId}
      `);
      updated += Number(result.rowCount ?? 0);
    }
    await db.execute(sql`COMMIT`).catch(() => {});
  } catch (e: any) {
    await db.execute(sql`ROLLBACK`).catch(() => {});
    return res.status(500).json({ message: `Gagal melakukan perbaikan: ${e.message}` });
  }

  return res.json({
    dryRun: false,
    fixed: updated,
    ids: allFixable.map((r) => r.id),
    message: `${updated} transaksi Dana Talangan berhasil diperbaiki COA-nya.`,
  });
});

// ── GET /api/audit/dana-talangan/intercompany-missing-mirror ──────────────────
// Preview: advance intercompany yang punya funding_entry_id tapi TIDAK ada
// responsible_entry_id → jurnal expense di perusahaan penerima belum dibuat.
// Ini adalah advance yang dibuat sebelum fitur dual-book posting ada.
router.get("/intercompany-missing-mirror", async (_req, res) => {
  const rows = await db.execute<{
    id: number;
    advance_number: string;
    amount: string;
    date: string;
    category: string | null;
    purpose: string | null;
    party_name: string | null;
    funding_company_id: number;
    funding_company: string;
    responsible_company_id: number;
    responsible_company: string;
    intercompany_reference: string | null;
    funding_entry_id: number;
  }>(sql`
    SELECT
      ca.id,
      ca.advance_number,
      ca.amount::text            AS amount,
      ca.date::text              AS date,
      ca.category,
      ca.purpose,
      ca.party_name,
      ca.funding_company_id,
      fc.company_name            AS funding_company,
      ca.responsible_company_id,
      rc.company_name            AS responsible_company,
      ca.intercompany_reference,
      ca.funding_entry_id
    FROM cash_advances ca
    JOIN companies fc ON fc.id = ca.funding_company_id
    JOIN companies rc ON rc.id = ca.responsible_company_id
    WHERE ca.funding_entry_id IS NOT NULL
      AND ca.responsible_entry_id IS NULL
      AND ca.responsible_company_id IS NOT NULL
      AND ca.funding_company_id IS NOT NULL
      AND ca.funding_company_id <> ca.responsible_company_id
    ORDER BY ca.date DESC, ca.id DESC
  `);

  return res.json({
    total: rows.rows.length,
    rows: rows.rows,
    message:
      rows.rows.length === 0
        ? "Semua advance intercompany sudah memiliki jurnal di perusahaan penerima."
        : `${rows.rows.length} advance intercompany tidak memiliki jurnal expense di perusahaan penerima.`,
  });
});

// ── POST /api/audit/dana-talangan/intercompany-repair ─────────────────────────
// Backfill jurnal yang hilang:
//   DR Expense (5-xxxx sesuai category) / CR 2-2098 (Hutang Intercompany)
//   di buku perusahaan penerima, lalu set responsible_entry_id.
//
// KEAMANAN: hanya admin; dryRun=true hanya preview tanpa eksekusi.
router.post("/intercompany-repair", async (req, res) => {
  const { dryRun, advanceId } = req.body ?? {};
  const isDry = dryRun === true || dryRun === "true";

  // Build filter: jika advanceId diberikan, hanya perbaiki satu advance.
  const idFilter =
    advanceId != null && !isNaN(Number(advanceId))
      ? sql`AND ca.id = ${Number(advanceId)}`
      : sql``;

  const candidates = await db.execute<{
    id: number;
    advance_number: string;
    amount: string;
    date: string;
    category: string | null;
    purpose: string | null;
    party_name: string | null;
    funding_company_id: number;
    responsible_company_id: number;
    responsible_company: string;
    intercompany_reference: string | null;
    funding_entry_id: number;
  }>(sql`
    SELECT
      ca.id,
      ca.advance_number,
      ca.amount::text            AS amount,
      ca.date::text              AS date,
      ca.category,
      ca.purpose,
      ca.party_name,
      ca.funding_company_id,
      ca.responsible_company_id,
      rc.company_name            AS responsible_company,
      ca.intercompany_reference,
      ca.funding_entry_id
    FROM cash_advances ca
    JOIN companies rc ON rc.id = ca.responsible_company_id
    WHERE ca.funding_entry_id IS NOT NULL
      AND ca.responsible_entry_id IS NULL
      AND ca.responsible_company_id IS NOT NULL
      AND ca.funding_company_id IS NOT NULL
      AND ca.funding_company_id <> ca.responsible_company_id
      ${idFilter}
    ORDER BY ca.date ASC, ca.id ASC
  `);

  const rows = candidates.rows;

  if (isDry || rows.length === 0) {
    return res.json({
      dryRun: true,
      fixable: rows.length,
      preview: rows,
      message:
        rows.length === 0
          ? "Tidak ada advance yang perlu diperbaiki."
          : `${rows.length} advance siap diperbaiki (dry run — belum dieksekusi).`,
    });
  }

  // ── Eksekusi repair satu per satu dalam transaksi terpisah ──────────────────
  const results: Array<{
    advanceId: number;
    advanceNumber: string;
    responsibleCompany: string;
    responsibleEntryId: number;
    ok: boolean;
    error?: string;
  }> = [];

  for (const adv of rows) {
    try {
      // 1. Resolve akun: 2-2098 (hutang) dan expense COA di perusahaan penerima
      const accounts = await resolveIntercompanyAccounts({
        fundingCompanyId: adv.funding_company_id,
        responsibleCompanyId: adv.responsible_company_id,
        category: adv.category,
      });

      // 2. Resolve jurnal umum perusahaan penerima
      const [journal] = await db.execute<{ id: number; code: string }>(sql`
        SELECT id, code FROM accounting_journals
        WHERE company_id = ${adv.responsible_company_id}
          AND type = 'general'
        ORDER BY id LIMIT 1
      `).then((r) => r.rows);

      if (!journal) {
        throw new Error(
          `Jurnal umum tidak ditemukan untuk perusahaan ${adv.responsible_company} (id=${adv.responsible_company_id}).`,
        );
      }

      const ref = adv.intercompany_reference ?? `IC-ADV-${adv.advance_number}`;
      const amount = Number(adv.amount);
      const description = `${ref} — Hutang Intercompany (repair backfill)`;

      // 3. Cek apakah sudah ada entri dengan ref yang sama di perusahaan penerima
      //    (idempotency guard — hindari duplikat jika endpoint dipanggil dua kali)
      const existing = await db.execute<{ id: number }>(sql`
        SELECT id FROM accounting_entries
        WHERE company_id = ${adv.responsible_company_id}
          AND ref = ${ref}
          AND source_module = 'advance_intercompany_responsible'
          AND status = 'posted'
        LIMIT 1
      `).then((r) => r.rows[0] ?? null);

      let responsibleEntryId: number;

      if (existing) {
        // Sudah ada — cukup link ke advance
        responsibleEntryId = existing.id;
      } else {
        // 4. Post jurnal di perusahaan penerima
        const entry = await db.transaction(async (tx: any) => {
          return postEntryWithClient(
            tx,
            {
              journalId: journal.id,
              date: new Date(adv.date),
              ref,
              description,
              source: "kasbon",
              sourceModule: "advance_intercompany_responsible",
              companyId: adv.responsible_company_id,
              lines: [
                {
                  accountId: accounts.responsibleExpense.id,
                  debit: amount,
                  credit: 0,
                  description: `Beban/Aset ${adv.category ?? "Dana Talangan"}${adv.purpose ? ` — ${adv.purpose}` : ""}`,
                },
                {
                  accountId: accounts.responsiblePayable.id,
                  debit: 0,
                  credit: amount,
                  description: `Hutang Intercompany ke perusahaan pemberi dana (repair)`,
                },
              ],
            },
            journal.code,
          );
        });
        responsibleEntryId = entry.id;
      }

      // 5. Link responsible_entry_id ke cash_advance
      await db.execute(sql`
        UPDATE cash_advances
        SET responsible_entry_id = ${responsibleEntryId},
            updated_at            = NOW()
        WHERE id = ${adv.id}
          AND responsible_entry_id IS NULL
      `);

      results.push({
        advanceId: adv.id,
        advanceNumber: adv.advance_number,
        responsibleCompany: adv.responsible_company,
        responsibleEntryId,
        ok: true,
      });
    } catch (err: any) {
      results.push({
        advanceId: adv.id,
        advanceNumber: adv.advance_number,
        responsibleCompany: adv.responsible_company,
        responsibleEntryId: 0,
        ok: false,
        error: err?.message ?? String(err),
      });
    }
  }

  const succeeded = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => !r.ok).length;

  return res.json({
    dryRun: false,
    total: rows.length,
    succeeded,
    failed,
    results,
    message: `${succeeded} advance berhasil diperbaiki${failed > 0 ? `, ${failed} gagal` : ""}.`,
  });
});

export default router;
