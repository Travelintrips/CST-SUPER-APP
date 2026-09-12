/**
 * TAX ENGINE CORE — SAP FASE 8
 * Indonesia-ready tax computation layer
 *
 * Tax Types:
 *  PPN_OUTPUT  — PPN Keluaran (11%)
 *  PPN_INPUT   — PPN Masukan (11%)
 *  PPH21       — PPh Pasal 21 (karyawan)
 *  PPH23       — PPh Pasal 23 (jasa vendor 2%/15%)
 *  WHT_DIVIDEN — Withholding Dividen (10%)
 *  WHT_BUNGA   — Withholding Bunga (15%)
 *  WHT_ROYALTY — Withholding Royalti (15%)
 *  WHT_SEWA    — Withholding Sewa (10%)
 *
 * RULE:
 *  - Semua journal bisa generate tax mapping otomatis
 *  - Tax lines disimpan di gl_tax_lines
 *  - Match ke transaction_taxes (existing) untuk reporting SPT
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export type TaxType =
  | "PPN_OUTPUT"
  | "PPN_INPUT"
  | "PPH21"
  | "PPH23"
  | "WHT_DIVIDEN"
  | "WHT_BUNGA"
  | "WHT_ROYALTY"
  | "WHT_SEWA"
  | "PPH4_2"
  | "BPHTB";

export const TAX_RATES: Record<TaxType, number> = {
  PPN_OUTPUT:  11,
  PPN_INPUT:   11,
  PPH21:        5, // Bracket terendah; kalkulasi lengkap via pph21Calculator
  PPH23:        2, // Jasa umum; 15% untuk dividen, bunga, royalti
  WHT_DIVIDEN: 10,
  WHT_BUNGA:   15,
  WHT_ROYALTY: 15,
  WHT_SEWA:    10,
  PPH4_2:       2.5, // Final PPh 4(2) sewa tanah/bangunan
  BPHTB:        5,
};

export interface TaxLineInput {
  companyId: number;
  accountingEntryId?: number | null;
  taxType: TaxType;
  baseAmount: number;
  direction: "output" | "input";
  period: string;
  entityType?: string | null;
  entityId?: string | null;
  taxpayerNpwp?: string | null;
  taxpayerName?: string | null;
  overrideRate?: number | null;
}

export interface TaxLineResult {
  id: number;
  taxType: TaxType;
  rate: number;
  baseAmount: number;
  taxAmount: number;
  direction: string;
}

export interface JournalTaxMapping {
  entryId: number;
  totalTaxAmount: number;
  lines: TaxLineResult[];
  warnings: string[];
}

// ─── Create Tax Line ─────────────────────────────────────────────────────────

export async function createTaxLine(input: TaxLineInput): Promise<TaxLineResult> {
  const rate = input.overrideRate ?? TAX_RATES[input.taxType] ?? 0;
  const taxAmount = Math.round((input.baseAmount * rate) / 100 * 100) / 100;

  const { rows } = await db.execute(sql.raw(`
    INSERT INTO gl_tax_lines
      (company_id, accounting_entry_id, tax_type, rate, base_amount, tax_amount, direction,
       period, entity_type, entity_id, taxpayer_npwp, taxpayer_name)
    VALUES
      (${input.companyId}, ${input.accountingEntryId ?? "NULL"},
       '${input.taxType}', ${rate}, ${input.baseAmount}, ${taxAmount},
       '${input.direction}',
       '${input.period.replace(/'/g, "")}',
       ${input.entityType ? `'${input.entityType.replace(/'/g, "''")}'` : "NULL"},
       ${input.entityId ? `'${input.entityId.replace(/'/g, "''")}'` : "NULL"},
       ${input.taxpayerNpwp ? `'${input.taxpayerNpwp.replace(/'/g, "''")}'` : "NULL"},
       ${input.taxpayerName ? `'${input.taxpayerName.replace(/'/g, "''")}'` : "NULL"})
    RETURNING id, tax_type, rate, base_amount, tax_amount, direction
  `));
  const r = rows[0] as any;
  return {
    id:         Number(r.id),
    taxType:    r.tax_type as TaxType,
    rate:       Number(r.rate),
    baseAmount: Number(r.base_amount),
    taxAmount:  Number(r.tax_amount),
    direction:  r.direction,
  };
}

// ─── Auto-map journal entry to tax lines ─────────────────────────────────────

export async function autoMapJournalTax(params: {
  companyId: number;
  accountingEntryId: number;
  period: string;
  source?: string | null;
}): Promise<JournalTaxMapping> {
  const { companyId, accountingEntryId, period, source } = params;
  const warnings: string[] = [];
  const lines: TaxLineResult[] = [];

  // Ambil jurnal lines
  const { rows: jLines } = await db.execute(sql.raw(`
    SELECT ael.*, coa.code AS coa_code, coa.name AS coa_name, coa.type AS coa_type,
           ael.debit_amount, ael.credit_amount
    FROM accounting_entry_lines ael
    JOIN chart_of_accounts coa ON coa.id = ael.coa_id
    WHERE ael.entry_id = ${accountingEntryId}
  `));

  for (const line of jLines as any[]) {
    const coaName = (line.coa_name ?? "").toLowerCase();
    const coaCode = (line.coa_code ?? "").toLowerCase();

    // PPN Output — akun PPN Keluaran
    if (coaName.includes("ppn keluaran") || coaCode.includes("ppn-out") || coaCode.includes("vat-out")) {
      const baseAmount = Math.abs(Number(line.credit_amount) - Number(line.debit_amount));
      if (baseAmount > 0) {
        const taxLine = await createTaxLine({
          companyId,
          accountingEntryId,
          taxType: "PPN_OUTPUT",
          baseAmount: baseAmount / (TAX_RATES.PPN_OUTPUT / 100),
          direction: "output",
          period,
          entityType: source ?? null,
          entityId: String(accountingEntryId),
        });
        lines.push(taxLine);
      }
    }

    // PPN Input — akun PPN Masukan
    if (coaName.includes("ppn masukan") || coaCode.includes("ppn-in") || coaCode.includes("vat-in")) {
      const baseAmount = Math.abs(Number(line.debit_amount) - Number(line.credit_amount));
      if (baseAmount > 0) {
        const taxLine = await createTaxLine({
          companyId,
          accountingEntryId,
          taxType: "PPN_INPUT",
          baseAmount: baseAmount / (TAX_RATES.PPN_INPUT / 100),
          direction: "input",
          period,
          entityType: source ?? null,
          entityId: String(accountingEntryId),
        });
        lines.push(taxLine);
      }
    }

    // PPh 23 — akun PPh 23 / withholding vendor
    if (
      coaName.includes("pph 23") || coaName.includes("pph23") ||
      coaName.includes("pph pasal 23") || coaName.includes("hutang pph 23") ||
      coaCode.includes("pph-23") || coaCode.includes("2-1032")
    ) {
      const baseAmount = Math.abs(Number(line.credit_amount) - Number(line.debit_amount));
      if (baseAmount > 0) {
        const taxLine = await createTaxLine({
          companyId,
          accountingEntryId,
          taxType: "PPH23",
          baseAmount: baseAmount / (TAX_RATES.PPH23 / 100),
          direction: "output",
          period,
          entityType: source ?? null,
          entityId: String(accountingEntryId),
        });
        lines.push(taxLine);
      }
    }

    // PPh 21 — akun hutang PPh 21 / withholding karyawan
    if (
      coaName.includes("pph 21") || coaName.includes("pph21") ||
      coaName.includes("pph pasal 21") || coaName.includes("hutang pph 21") ||
      coaCode.includes("pph-21") || coaCode.includes("2-1031")
    ) {
      const baseAmount = Math.abs(Number(line.credit_amount) - Number(line.debit_amount));
      if (baseAmount > 0) {
        const taxLine = await createTaxLine({
          companyId,
          accountingEntryId,
          taxType: "PPH21",
          baseAmount: baseAmount / (TAX_RATES.PPH21 / 100),
          direction: "output",
          period,
          entityType: source ?? null,
          entityId: String(accountingEntryId),
        });
        lines.push(taxLine);
      }
    }
  }

  const totalTaxAmount = lines.reduce((s, l) => s + l.taxAmount, 0);

  return { entryId: accountingEntryId, totalTaxAmount, lines, warnings };
}

// ─── PPh 23 Computation ──────────────────────────────────────────────────────

export interface Pph23Input {
  grossAmount: number;
  serviceCategory: "jasa" | "bunga" | "dividen" | "royalti" | "sewa" | "hadiah";
  hasNpwp: boolean;
  taxpayerName?: string;
  taxpayerNpwp?: string;
}

export interface Pph23Result {
  grossAmount: number;
  rate: number;
  taxAmount: number;
  netAmount: number;
  notes: string;
}

export function computePph23(input: Pph23Input): Pph23Result {
  let rate: number;
  let notes = "";

  switch (input.serviceCategory) {
    case "bunga":    rate = 15; break;
    case "dividen":  rate = 10; break;
    case "royalti":  rate = 15; break;
    case "sewa":     rate = 10; break;
    case "hadiah":   rate = 15; break;
    default:         rate = 2;  break; // jasa umum
  }

  if (!input.hasNpwp) {
    rate = rate * 2; // 200% jika tidak punya NPWP (UU PPh pasal 23 ayat 1a)
    notes = "Tarif 200% karena tidak memiliki NPWP";
  }

  const taxAmount = Math.round(input.grossAmount * (rate / 100) * 100) / 100;

  return {
    grossAmount: input.grossAmount,
    rate,
    taxAmount,
    netAmount: input.grossAmount - taxAmount,
    notes,
  };
}

// ─── Withholding Tax Tracker ─────────────────────────────────────────────────

export async function getWithholdingTaxSummary(companyId: number, period: string): Promise<{
  ppnOutput: number;
  ppnInput: number;
  ppnNet: number;
  pph23Total: number;
  pph21Total: number;
  whtDividen: number;
  whtBunga: number;
  whtRoyalti: number;
  whtSewa: number;
  totalTaxLiability: number;
  unreportedCount: number;
}> {
  const { rows } = await db.execute(sql.raw(`
    SELECT
      tax_type,
      direction,
      COALESCE(SUM(tax_amount), 0)::numeric AS total,
      COUNT(CASE WHEN is_reported = FALSE THEN 1 END)::int AS unreported
    FROM gl_tax_lines
    WHERE company_id = ${companyId}
      AND period = '${period.replace(/'/g, "")}'
    GROUP BY tax_type, direction
  `));

  const tax: Record<string, number> = {};
  let unreportedCount = 0;

  for (const r of rows as any[]) {
    const key = `${r.tax_type}_${r.direction}`;
    tax[key] = Number(r.total ?? 0);
    unreportedCount += Number(r.unreported ?? 0);
  }

  const ppnOutput = tax["PPN_OUTPUT_output"] ?? 0;
  const ppnInput  = tax["PPN_INPUT_input"] ?? 0;

  return {
    ppnOutput,
    ppnInput,
    ppnNet:           ppnOutput - ppnInput,
    pph23Total:       tax["PPH23_output"] ?? 0,
    pph21Total:       tax["PPH21_output"] ?? 0,
    whtDividen:       tax["WHT_DIVIDEN_output"] ?? 0,
    whtBunga:         tax["WHT_BUNGA_output"] ?? 0,
    whtRoyalti:       tax["WHT_ROYALTY_output"] ?? 0,
    whtSewa:          tax["WHT_SEWA_output"] ?? 0,
    totalTaxLiability: ppnOutput + (tax["PPH23_output"] ?? 0) + (tax["PPH21_output"] ?? 0),
    unreportedCount,
  };
}

export async function markTaxLinesReported(ids: number[]): Promise<void> {
  if (!ids.length) return;
  const idList = ids.join(",");
  await db.execute(sql.raw(`
    UPDATE gl_tax_lines
    SET is_reported = TRUE, reported_at = NOW()
    WHERE id IN (${idList})
  `));
}

export async function getTaxLinesForPeriod(companyId: number, period: string, taxType?: TaxType): Promise<any[]> {
  const typeFilter = taxType ? `AND tax_type = '${taxType}'` : "";
  const { rows } = await db.execute(sql.raw(`
    SELECT gtl.*, ae.entry_number, ae.description AS entry_description
    FROM gl_tax_lines gtl
    LEFT JOIN accounting_entries ae ON ae.id = gtl.accounting_entry_id
    WHERE gtl.company_id = ${companyId}
      AND gtl.period = '${period.replace(/'/g, "")}'
      ${typeFilter}
    ORDER BY gtl.created_at DESC
    LIMIT 1000
  `));
  return rows as any[];
}
