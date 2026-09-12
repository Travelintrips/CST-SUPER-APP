import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../logger.js";

export const DEFAULT_BANK_AMOUNT_TOLERANCE = 0;
export const MAX_BANK_AMOUNT_TOLERANCE = 1_000_000_000;

export interface BankReconciliationSettings {
  companyId: number | null;
  amountTolerance: number;
}

export function sanitizeBankAmountTolerance(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount < 0 || amount > MAX_BANK_AMOUNT_TOLERANCE) {
    return null;
  }
  return Math.round(amount * 100) / 100;
}

export async function getBankReconciliationSettings(
  companyId: number | null | undefined,
): Promise<BankReconciliationSettings> {
  const normalizedCompanyId = Number(companyId);
  if (!Number.isInteger(normalizedCompanyId) || normalizedCompanyId <= 0) {
    return { companyId: null, amountTolerance: DEFAULT_BANK_AMOUNT_TOLERANCE };
  }

  try {
    const { rows } = await db.execute(sql`
      SELECT amount_tolerance
      FROM bank_reconciliation_settings
      WHERE company_id = ${normalizedCompanyId}
      LIMIT 1
    `);
    const configured = sanitizeBankAmountTolerance((rows[0] as any)?.amount_tolerance);
    return {
      companyId: normalizedCompanyId,
      amountTolerance: configured ?? DEFAULT_BANK_AMOUNT_TOLERANCE,
    };
  } catch (error: any) {
    logger.warn(
      { err: error?.message ?? String(error), companyId: normalizedCompanyId },
      "[bankReconSettings] settings unavailable; using exact nominal matching",
    );
    return { companyId: normalizedCompanyId, amountTolerance: DEFAULT_BANK_AMOUNT_TOLERANCE };
  }
}