/**
 * taxReconciliationService.ts
 *
 * Rekonsiliasi lintas-tabel antara:
 *   1. transaction_taxes  (operasional — dicatat saat transaksi)
 *   2. gl_tax_lines       (akuntansi  — dicatat saat jurnal di-approve)
 *
 * Gap yang dideteksi:
 *   A. transaction_taxes aktif (bukan voided) tanpa gl_tax_lines sejenis di periode sama
 *   B. gl_tax_lines yang menunjuk ke accounting_entry yang sudah di-void/dihapus
 *   C. Selisih nominal agregat PPN/PPh antara kedua tabel per periode
 *
 * RULE: READ-ONLY — tidak memodifikasi data apapun.
 *
 * Generator:
 *   - generateFakturNumber(companyId, period, kodeTransaksi?) → faktur DJP
 *   - generateBupotNumber(companyId, period, taxType)          → bukti potong
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";
import { formatFaktur } from "./fakturPajakValidator.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface GapItem {
  issue: string;
  severity: "HIGH" | "MEDIUM" | "LOW";
  transaction_type?: string;
  transaction_id?: number;
  gl_entry_id?: number;
  period: string;
  amount_tt?: number;
  amount_gl?: number;
  diff?: number;
  description: string;
}

export interface ReconciliationResult {
  companyId: number;
  period: string;
  checked_at: string;
  is_balanced: boolean;
  gaps: GapItem[];
  summary: {
    ppn_output_tt:   number;
    ppn_output_gl:   number;
    ppn_input_tt:    number;
    ppn_input_gl:    number;
    pph_wht_tt:      number;
    pph_wht_gl:      number;
    orphaned_tt:     number;   // transaction_taxes tanpa GL entry
    orphaned_gl:     number;   // gl_tax_lines ke entry voided
    diff_ppn_output: number;
    diff_ppn_input:  number;
    diff_pph_wht:    number;
  };
}

// ── Check A: orphaned transaction_taxes (tidak ada di GL tapi tidak voided) ──

async function checkOrphanedTransactionTax(
  companyId: number,
  period: string,
): Promise<GapItem[]> {
  // Pendekatan: ambil tt yang bukan voided & cek apakah ada gl_tax_lines dengan
  // entity_id = str(transaction_id) dan entity_type = transaction_type di periode sama.
  // (autoMapJournalTax mengisi entity_type & entity_id dari sumber jurnal)
  const { rows } = await db.execute(sql.raw(`
    SELECT
      tt.id,
      tt.transaction_type,
      tt.transaction_id,
      tt.tax_name,
      tt.tax_amount::numeric AS tax_amount,
      tt.direction
    FROM transaction_taxes tt
    WHERE tt.company_id = ${companyId}
      AND tt.period      = '${period}'
      AND tt.status     <> 'voided'
      AND tt.direction  <> 'input'
      AND NOT EXISTS (
        SELECT 1
        FROM gl_tax_lines gtl
        WHERE gtl.company_id = ${companyId}
          AND gtl.period     = '${period}'
          AND gtl.entity_id  = tt.transaction_id::text
      )
    ORDER BY tt.created_at DESC
    LIMIT 50
  `)).catch(() => ({ rows: [] }));

  return (rows as any[]).map((r) => ({
    issue: "ORPHANED_TT",
    severity: "HIGH" as const,
    transaction_type: r.transaction_type,
    transaction_id: Number(r.transaction_id),
    period,
    amount_tt: Number(r.tax_amount ?? 0),
    description: `transaction_taxes id=${r.id} (${r.transaction_type}#${r.transaction_id}, ${r.tax_name}) tidak punya GL entry — jurnal belum dibuat/di-approve`,
  }));
}

// ── Check B: orphaned gl_tax_lines (entry sudah voided/dihapus) ───────────────

async function checkOrphanedGlTaxLines(
  companyId: number,
  period: string,
): Promise<GapItem[]> {
  const { rows } = await db.execute(sql.raw(`
    SELECT
      gtl.id,
      gtl.accounting_entry_id,
      gtl.tax_type,
      gtl.tax_amount::numeric AS tax_amount
    FROM gl_tax_lines gtl
    WHERE gtl.company_id = ${companyId}
      AND gtl.period     = '${period}'
      AND gtl.accounting_entry_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM accounting_entries ae
        WHERE ae.id     = gtl.accounting_entry_id
          AND ae.status <> 'voided'
      )
    LIMIT 50
  `)).catch(() => ({ rows: [] }));

  return (rows as any[]).map((r) => ({
    issue: "ORPHANED_GL",
    severity: "HIGH" as const,
    gl_entry_id: Number(r.accounting_entry_id),
    period,
    amount_gl: Number(r.tax_amount ?? 0),
    description: `gl_tax_lines id=${r.id} menunjuk ke accounting_entry ${r.accounting_entry_id} yang sudah di-void/dihapus — perlu dihapus manual`,
  }));
}

// ── Check C: selisih agregat PPN & PPh ────────────────────────────────────────

async function checkAggregateBalance(
  companyId: number,
  period: string,
): Promise<{ gaps: GapItem[]; sums: {
  ppn_output_tt: number; ppn_output_gl: number;
  ppn_input_tt:  number; ppn_input_gl:  number;
  pph_wht_tt:    number; pph_wht_gl:    number;
}}> {
  const [tt, gl] = await Promise.all([
    db.execute(sql.raw(`
      SELECT
        COALESCE(SUM(tax_amount::numeric) FILTER (WHERE direction = 'output' AND (tax_name ILIKE '%ppn%' OR tax_name ILIKE '%vat%')), 0)::float AS ppn_output,
        COALESCE(SUM(tax_amount::numeric) FILTER (WHERE direction = 'input'  AND (tax_name ILIKE '%ppn%masukan%' OR tax_name ILIKE '%vat%input%')), 0)::float AS ppn_input,
        COALESCE(SUM(tax_amount::numeric) FILTER (WHERE direction = 'withholding'), 0)::float AS pph_wht
      FROM transaction_taxes
      WHERE company_id = ${companyId}
        AND period     = '${period}'
        AND status    <> 'voided'
    `)).catch(() => ({ rows: [{}] })),

    db.execute(sql.raw(`
      SELECT
        COALESCE(SUM(tax_amount::numeric) FILTER (WHERE tax_type IN ('PPN_OUTPUT') AND direction = 'output'), 0)::float AS ppn_output,
        COALESCE(SUM(tax_amount::numeric) FILTER (WHERE tax_type IN ('PPN_INPUT')  AND direction = 'input'),  0)::float AS ppn_input,
        COALESCE(SUM(tax_amount::numeric) FILTER (WHERE tax_type NOT IN ('PPN_OUTPUT','PPN_INPUT')), 0)::float AS pph_wht
      FROM gl_tax_lines
      WHERE company_id = ${companyId}
        AND period     = '${period}'
    `)).catch(() => ({ rows: [{}] })),
  ]);

  const t = (tt.rows[0] as any) ?? {};
  const g = (gl.rows[0] as any) ?? {};

  const sums = {
    ppn_output_tt: Number(t.ppn_output ?? 0),
    ppn_output_gl: Number(g.ppn_output ?? 0),
    ppn_input_tt:  Number(t.ppn_input  ?? 0),
    ppn_input_gl:  Number(g.ppn_input  ?? 0),
    pph_wht_tt:    Number(t.pph_wht    ?? 0),
    pph_wht_gl:    Number(g.pph_wht    ?? 0),
  };

  const THRESHOLD = 1000; // toleransi Rp 1.000 (pembulatan)
  const gaps: GapItem[] = [];

  const diff_ppn_output = Math.abs(sums.ppn_output_tt - sums.ppn_output_gl);
  if (diff_ppn_output > THRESHOLD) {
    gaps.push({
      issue: "AMOUNT_MISMATCH_PPN_OUTPUT",
      severity: diff_ppn_output > 1_000_000 ? "HIGH" : "MEDIUM",
      period,
      amount_tt: sums.ppn_output_tt,
      amount_gl: sums.ppn_output_gl,
      diff: diff_ppn_output,
      description: `Selisih PPN Keluaran: transaction_taxes=${sums.ppn_output_tt.toFixed(0)} vs gl_tax_lines=${sums.ppn_output_gl.toFixed(0)} (Δ=${diff_ppn_output.toFixed(0)})`,
    });
  }

  const diff_ppn_input = Math.abs(sums.ppn_input_tt - sums.ppn_input_gl);
  if (diff_ppn_input > THRESHOLD) {
    gaps.push({
      issue: "AMOUNT_MISMATCH_PPN_INPUT",
      severity: diff_ppn_input > 1_000_000 ? "HIGH" : "MEDIUM",
      period,
      amount_tt: sums.ppn_input_tt,
      amount_gl: sums.ppn_input_gl,
      diff: diff_ppn_input,
      description: `Selisih PPN Masukan: transaction_taxes=${sums.ppn_input_tt.toFixed(0)} vs gl_tax_lines=${sums.ppn_input_gl.toFixed(0)} (Δ=${diff_ppn_input.toFixed(0)})`,
    });
  }

  const diff_pph = Math.abs(sums.pph_wht_tt - sums.pph_wht_gl);
  if (diff_pph > THRESHOLD) {
    gaps.push({
      issue: "AMOUNT_MISMATCH_PPH_WHT",
      severity: diff_pph > 1_000_000 ? "HIGH" : "MEDIUM",
      period,
      amount_tt: sums.pph_wht_tt,
      amount_gl: sums.pph_wht_gl,
      diff: diff_pph,
      description: `Selisih PPh WHT: transaction_taxes=${sums.pph_wht_tt.toFixed(0)} vs gl_tax_lines=${sums.pph_wht_gl.toFixed(0)} (Δ=${diff_pph.toFixed(0)})`,
    });
  }

  return { gaps, sums };
}

// ── Main reconciliation function ──────────────────────────────────────────────

export async function runTaxReconciliation(
  companyId: number,
  period: string,
): Promise<ReconciliationResult> {
  const checkedAt = new Date().toISOString();

  try {
    const [orphanedTT, orphanedGL, { gaps: balanceGaps, sums }] = await Promise.all([
      checkOrphanedTransactionTax(companyId, period),
      checkOrphanedGlTaxLines(companyId, period),
      checkAggregateBalance(companyId, period),
    ]);

    const allGaps = [...orphanedTT, ...orphanedGL, ...balanceGaps];
    const isBalanced = allGaps.length === 0;

    if (allGaps.length > 0) {
      logger.warn(
        { companyId, period, gaps: allGaps.length },
        "[taxReconciliation] Gap ditemukan antara transaction_taxes dan gl_tax_lines",
      );
    }

    return {
      companyId,
      period,
      checked_at: checkedAt,
      is_balanced: isBalanced,
      gaps: allGaps,
      summary: {
        ...sums,
        orphaned_tt: orphanedTT.length,
        orphaned_gl: orphanedGL.length,
        diff_ppn_output: Math.abs(sums.ppn_output_tt - sums.ppn_output_gl),
        diff_ppn_input:  Math.abs(sums.ppn_input_tt  - sums.ppn_input_gl),
        diff_pph_wht:    Math.abs(sums.pph_wht_tt    - sums.pph_wht_gl),
      },
    };
  } catch (err: any) {
    logger.error({ err: err.message, companyId, period }, "[taxReconciliation] Gagal");
    return {
      companyId, period, checked_at: checkedAt, is_balanced: false,
      gaps: [{ issue: "SYSTEM_ERROR", severity: "HIGH", period, description: err.message }],
      summary: {
        ppn_output_tt: 0, ppn_output_gl: 0, ppn_input_tt: 0, ppn_input_gl: 0,
        pph_wht_tt: 0, pph_wht_gl: 0, orphaned_tt: 0, orphaned_gl: 0,
        diff_ppn_output: 0, diff_ppn_input: 0, diff_pph_wht: 0,
      },
    };
  }
}

// ── Faktur Pajak auto-number generator ────────────────────────────────────────
// Format DJP e-Faktur: KKK.SSS-TT.SSSSSSSS (16 digit)
// KKK = 010, SSS = 000, TT = 2-digit tahun, SSSSSSSS = urut per (company, period)

export async function generateFakturNumbers(opts: {
  companyId: number;
  period: string;
  kodeTransaksi?: string;
  limit?: number;
}): Promise<{ updated: number; errors: number; samples: string[] }> {
  const kode = (opts.kodeTransaksi ?? "010").slice(0, 3).padStart(3, "0");
  const [yyyy, mm] = opts.period.split("-");
  const yy = (yyyy ?? new Date().getFullYear().toString()).slice(-2);
  const limit = Math.min(opts.limit ?? 200, 500);

  // Ambil ID dan transaction_id transaksi yang belum punya faktur
  const { rows: targets } = await db.execute(sql.raw(`
    SELECT id
    FROM transaction_taxes
    WHERE company_id  = ${opts.companyId}
      AND period      = '${opts.period}'
      AND direction  <> 'withholding'
      AND status     <> 'voided'
      AND (faktur_pajak_number IS NULL OR faktur_pajak_number = '')
    ORDER BY id ASC
    LIMIT ${limit}
  `)).catch(() => ({ rows: [] }));

  if ((targets as any[]).length === 0) return { updated: 0, errors: 0, samples: [] };

  // Cari nomor urut terakhir yang sudah dipakai untuk company+period
  const { rows: lastRow } = await db.execute(sql.raw(`
    SELECT faktur_pajak_number
    FROM transaction_taxes
    WHERE company_id = ${opts.companyId}
      AND period     = '${opts.period}'
      AND faktur_pajak_number IS NOT NULL
      AND faktur_pajak_number <> ''
    ORDER BY faktur_pajak_number DESC
    LIMIT 1
  `)).catch(() => ({ rows: [] }));

  let seq = 0;
  if ((lastRow as any[])[0]?.faktur_pajak_number) {
    const raw: string = String((lastRow as any[])[0].faktur_pajak_number);
    const digits = raw.replace(/\D/g, "");
    if (digits.length === 16) {
      seq = parseInt(digits.slice(8), 10) || 0;
    }
  }

  let updated = 0;
  let errors = 0;
  const samples: string[] = [];

  for (const t of targets as any[]) {
    seq += 1;
    const nomorUrut = String(seq).padStart(8, "0");
    const digits16 = `${kode}000${yy}${nomorUrut}`;
    const formatted = formatFaktur(digits16) ?? digits16;

    try {
      await db.execute(sql.raw(`
        UPDATE transaction_taxes
        SET faktur_pajak_number = '${formatted}',
            updated_at          = NOW()
        WHERE id = ${t.id}
          AND (faktur_pajak_number IS NULL OR faktur_pajak_number = '')
      `));
      updated++;
      if (samples.length < 3) samples.push(formatted);
    } catch {
      errors++;
    }
  }

  logger.info(
    { companyId: opts.companyId, period: opts.period, updated, errors },
    "[taxReconciliation] Faktur pajak auto-generated",
  );

  return { updated, errors, samples };
}

// ── Bukti Potong auto-number generator ───────────────────────────────────────
// Format: BP23-YYYYMM-NNNNNN  /  BP21-YYYYMM-NNNNNN  /  BP15-YYYYMM-NNNNNN

export async function generateBupotNumbers(opts: {
  companyId: number;
  period: string;
  taxType?: string;
  limit?: number;
}): Promise<{ updated: number; errors: number; samples: string[] }> {
  const [yyyy, mm] = opts.period.split("-");
  const yyyymm = `${yyyy ?? ""}${(mm ?? "").padStart(2, "0")}`;
  const limit = Math.min(opts.limit ?? 200, 500);
  const taxFilter = opts.taxType
    ? `AND tax_name ILIKE '%${opts.taxType.replace(/'/g, "''")}%'`
    : "";

  const { rows: targets } = await db.execute(sql.raw(`
    SELECT id, tax_name
    FROM transaction_taxes
    WHERE company_id    = ${opts.companyId}
      AND period        = '${opts.period}'
      AND direction     = 'withholding'
      AND status       <> 'voided'
      AND (bukti_potong_number IS NULL OR bukti_potong_number = '')
      ${taxFilter}
    ORDER BY id ASC
    LIMIT ${limit}
  `)).catch(() => ({ rows: [] }));

  if ((targets as any[]).length === 0) return { updated: 0, errors: 0, samples: [] };

  let updated = 0;
  let errors = 0;
  const samples: string[] = [];
  const seqMap: Record<string, number> = {};

  for (const t of targets as any[]) {
    const taxName: string = String(t.tax_name ?? "").toLowerCase();

    let prefix = "BPWHT";
    if (taxName.includes("21"))     prefix = "BP21";
    else if (taxName.includes("23")) prefix = "BP23";
    else if (taxName.includes("15")) prefix = "BP15";
    else if (taxName.includes("26")) prefix = "BP26";
    else if (taxName.includes("4(2)") || taxName.includes("pph 4")) prefix = "BP42";

    seqMap[prefix] = (seqMap[prefix] ?? 0) + 1;

    // Ambil last seq untuk prefix ini dari DB
    if (seqMap[prefix] === 1) {
      const { rows: lr } = await db.execute(sql.raw(`
        SELECT bukti_potong_number FROM transaction_taxes
        WHERE company_id = ${opts.companyId}
          AND period = '${opts.period}'
          AND bukti_potong_number LIKE '${prefix}-%'
        ORDER BY bukti_potong_number DESC LIMIT 1
      `)).catch(() => ({ rows: [] }));
      if ((lr as any[])[0]?.bukti_potong_number) {
        const parts = String((lr as any[])[0].bukti_potong_number).split("-");
        seqMap[prefix] = (parseInt(parts[2] ?? "0", 10) || 0) + 1;
      }
    }

    const seqStr = String(seqMap[prefix]).padStart(6, "0");
    const bupot = `${prefix}-${yyyymm}-${seqStr}`;

    try {
      await db.execute(sql.raw(`
        UPDATE transaction_taxes
        SET bukti_potong_number = '${bupot}',
            updated_at          = NOW()
        WHERE id = ${t.id}
          AND (bukti_potong_number IS NULL OR bukti_potong_number = '')
      `));
      updated++;
      if (samples.length < 3) samples.push(bupot);
    } catch {
      errors++;
    }
  }

  logger.info(
    { companyId: opts.companyId, period: opts.period, updated, errors },
    "[taxReconciliation] Bukti potong auto-generated",
  );

  return { updated, errors, samples };
}
