/**
 * taxPeriodGuard.ts
 * Fase 3 — Period Lock Guard
 *
 * Fungsi reusable untuk memvalidasi apakah masa pajak tertentu masih
 * bisa diedit. Digunakan di semua route yang melakukan mutasi pajak.
 *
 * Status period:
 *   open       → boleh edit bebas
 *   validating → boleh validate, mutasi hati-hati (allowed)
 *   locked     → TIDAK boleh edit langsung → wajib adjustment
 *   exported   → TIDAK boleh edit langsung → wajib adjustment
 *   revised    → boleh edit (period sudah dibuka ulang)
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

export type PeriodStatus = "open" | "validating" | "locked" | "exported" | "revised";

export interface PeriodGuardResult {
  editable: boolean;
  status: PeriodStatus | "not_found";
  reason?: string;
}

/**
 * Cek apakah masa pajak (tax_period) untuk company ini masih bisa diedit.
 * taxType default "ALL" → match ke record dengan tax_type='ALL' atau specific.
 * Jika tidak ada record → dianggap 'open' (bisa edit).
 */
export async function assertTaxPeriodEditable(
  companyId: number,
  taxPeriod: string,
  taxType: string = "ALL",
): Promise<PeriodGuardResult> {
  try {
    // Cari period record — coba exact match dulu, fallback ke ALL
    const { rows } = await db.execute(sql`
      SELECT status FROM tax_periods
      WHERE company_id = ${companyId}
        AND tax_period = ${taxPeriod}
        AND tax_type IN (${taxType}, 'ALL')
      ORDER BY
        CASE WHEN tax_type = ${taxType} THEN 0 ELSE 1 END
      LIMIT 1
    `);

    if (!rows || rows.length === 0) {
      // Tidak ada record → period belum dikunci → boleh edit
      return { editable: true, status: "not_found" };
    }

    const status = (rows[0] as { status: string }).status as PeriodStatus;

    if (status === "locked" || status === "exported") {
      return {
        editable: false,
        status,
        reason: status === "locked"
          ? `Masa pajak ${taxPeriod} sudah dikunci. Gunakan fitur Tax Adjustment untuk koreksi.`
          : `Masa pajak ${taxPeriod} sudah diekspor ke Coretax. Gunakan fitur Tax Adjustment / Reversal.`,
      };
    }

    return { editable: true, status };
  } catch (err) {
    // Jika tabel belum ada (migrasi belum jalan), izinkan edit
    logger.warn({ err, companyId, taxPeriod }, "[taxPeriodGuard] Error saat cek period — defaulting to editable");
    return { editable: true, status: "not_found" };
  }
}

/**
 * Throw-style guard. Melempar Error jika period tidak bisa diedit.
 * Gunakan ini di dalam route handler untuk early-return otomatis.
 */
export async function requireTaxPeriodEditable(
  companyId: number,
  taxPeriod: string,
  taxType: string = "ALL",
): Promise<void> {
  const result = await assertTaxPeriodEditable(companyId, taxPeriod, taxType);
  if (!result.editable) {
    const err = new Error(result.reason ?? `Masa pajak ${taxPeriod} tidak dapat diedit (status: ${result.status})`);
    (err as NodeJS.ErrnoException).code = "TAX_PERIOD_LOCKED";
    throw err;
  }
}

/**
 * Middleware-style: ambil companyId + period dari request dan block jika locked.
 * Return true jika editable, false + kirim 409 jika tidak.
 */
export async function guardTaxPeriodFromRequest(
  companyId: number | null,
  taxPeriod: string | null | undefined,
  res: { status: (code: number) => { json: (body: unknown) => void } },
  taxType: string = "ALL",
): Promise<boolean> {
  if (!companyId || !taxPeriod) return true;

  const result = await assertTaxPeriodEditable(companyId, taxPeriod, taxType);
  if (!result.editable) {
    res.status(409).json({
      error: result.reason,
      periodStatus: result.status,
      code: "TAX_PERIOD_LOCKED",
    });
    return false;
  }
  return true;
}
