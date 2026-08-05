/**
 * taxLedgerSyncService.ts
 * Sync pipeline: tax_transactions (event ledger) → transaction_taxes (SPT register)
 *
 * tax_transactions = diisi otomatis oleh payment/invoice processor (lightweight event log)
 * transaction_taxes = register lengkap untuk pelaporan SPT ke DJP (dipakai BizPortal Tax)
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

const LOG = "[taxLedgerSync]";

interface TaxLedgerRow {
  id: number;
  company_id: number;
  source_module: string;
  source_table: string;
  source_id: number;
  tax_type: string;       // ppn | pph | ppn_import | ...
  tax_rate: string;       // numeric string e.g. "0.11"
  taxable_amount: string;
  tax_amount: string;
  direction: string;      // out | in
  period: string;         // YYYY-MM
  status: string;         // posted | voided
  correlation_id: string | null;
  ref: string | null;
  description: string | null;
}

interface SyncResult {
  total: number;
  inserted: number;
  skipped: number;
  noTaxId: number;
  errors: number;
  details: string[];
}

/** Map tax_type + direction ke accounting_taxes.kind */
function resolveKind(taxType: string, direction: string): string {
  const t = taxType.toLowerCase();
  if (t.includes("pph") || t.includes("withholding") || t.includes("wht")) {
    return "withholding";
  }
  if (direction === "in") return "purchase";
  return "sale";
}

/** Derive human-readable tax name */
function deriveTaxName(taxType: string, taxRate: string): string {
  const rate = Math.round(Number(taxRate) * 100);
  const t = taxType.toLowerCase();
  if (t === "ppn" || t === "ppn_keluaran") return `PPN ${rate}%`;
  if (t === "ppn_masukan" || t === "ppn_import") return `PPN Masukan ${rate}%`;
  if (t.startsWith("pph23")) return `PPh 23 ${rate}%`;
  if (t.startsWith("pph21")) return `PPh 21 ${rate}%`;
  if (t.startsWith("pph4")) return `PPh 4(2) ${rate}%`;
  if (t.startsWith("pph")) return `PPh ${rate}%`;
  return `${taxType.toUpperCase()} ${rate}%`;
}

/** Map direction: out→output, in→input, else as-is */
function mapDirection(dir: string): string {
  if (dir === "out") return "output";
  if (dir === "in") return "input";
  return dir;
}

/** Resolve tax_id dari accounting_taxes berdasarkan kind + rate + company_id */
async function resolveTaxId(
  companyId: number,
  kind: string,
  taxRate: string,
): Promise<number | null> {
  const rate = Number(taxRate);

  // 1. Exact match: kind + rate + company
  const exact = await db.execute(sql.raw(`
    SELECT id FROM accounting_taxes
    WHERE company_id = ${companyId}
      AND kind = '${kind}'
      AND ABS(CAST(rate AS numeric) - ${rate}) < 0.001
      AND is_active = true
    ORDER BY id
    LIMIT 1
  `));
  if (exact.rows.length > 0) return (exact.rows[0] as any).id as number;

  // 2. Fallback: any active of same kind for this company
  const fallback = await db.execute(sql.raw(`
    SELECT id FROM accounting_taxes
    WHERE company_id = ${companyId}
      AND kind = '${kind}'
      AND is_active = true
    ORDER BY ABS(CAST(rate AS numeric) - ${rate})
    LIMIT 1
  `));
  if (fallback.rows.length > 0) return (fallback.rows[0] as any).id as number;

  // 3. Global fallback: any tax of kind (company_id=1)
  const global = await db.execute(sql.raw(`
    SELECT id FROM accounting_taxes
    WHERE kind = '${kind}'
      AND is_active = true
    ORDER BY id
    LIMIT 1
  `));
  if (global.rows.length > 0) return (global.rows[0] as any).id as number;

  return null;
}

/**
 * Sync semua baris dari tax_transactions yang belum ada di transaction_taxes.
 * Idempotent: unique constraint (transaction_type, transaction_id, tax_id) di transaction_taxes.
 */
export async function syncTaxLedgerToRegister(
  options: { companyId?: number; period?: string; limit?: number } = {},
): Promise<SyncResult> {
  const result: SyncResult = { total: 0, inserted: 0, skipped: 0, noTaxId: 0, errors: 0, details: [] };

  const whereParts: string[] = ["1=1", "status != 'voided'"];
  if (options.companyId) whereParts.push(`company_id = ${options.companyId}`);
  if (options.period) whereParts.push(`period = '${options.period}'`);

  const limitClause = options.limit ? `LIMIT ${options.limit}` : "LIMIT 500";

  // Ambil rows dari tax_transactions yang belum disync
  // (correlation_id belum ada di transaction_taxes.notes dengan prefix marker)
  const rows = await db.execute(sql.raw(`
    SELECT tt.*
    FROM public.tax_transactions tt
    WHERE ${whereParts.join(" AND ")}
      AND NOT EXISTS (
        SELECT 1 FROM public.transaction_taxes reg
        WHERE reg.transaction_type = tt.source_module
          AND reg.transaction_id = tt.source_id
          AND reg.notes LIKE '%[ledger:' || tt.id || ']%'
      )
    ORDER BY tt.created_at
    ${limitClause}
  `));

  result.total = rows.rows.length;

  const taxIdCache: Map<string, number | null> = new Map();

  for (const rawRow of rows.rows) {
    const row = rawRow as unknown as TaxLedgerRow;
    try {
      const kind = resolveKind(row.tax_type, row.direction);
      const cacheKey = `${row.company_id}:${kind}:${row.tax_rate}`;

      let taxId = taxIdCache.get(cacheKey);
      if (taxId === undefined) {
        taxId = await resolveTaxId(row.company_id, kind, row.tax_rate);
        taxIdCache.set(cacheKey, taxId);
      }

      if (!taxId) {
        result.noTaxId++;
        result.details.push(`[SKIP noTaxId] id=${row.id} type=${row.tax_type} kind=${kind} rate=${row.tax_rate}`);
        continue;
      }

      const direction = mapDirection(row.direction);
      const cutType = kind === "withholding" ? "withholding" : "self_borne";
      const taxName = deriveTaxName(row.tax_type, row.tax_rate);
      const notes = `[ledger:${row.id}] ${row.description ?? ""}`.trim();
      const transactionRef = row.ref ?? row.correlation_id ?? `ledger-${row.id}`;
      const period = row.period;
      const baseAmount = Number(row.taxable_amount);
      const taxAmount = Number(row.tax_amount);
      const taxRate = Number(row.tax_rate);
      const now = new Date().toISOString();

      // INSERT dengan ON CONFLICT DO NOTHING (unique key: transaction_type+transaction_id+tax_id)
      const ins = await db.execute(sql.raw(`
        INSERT INTO public.transaction_taxes (
          company_id, transaction_type, transaction_id, transaction_ref,
          tax_id, tax_name, tax_rate, cut_type,
          base_amount, tax_amount, period, status, direction,
          notes, created_at, updated_at
        ) VALUES (
          ${row.company_id},
          '${row.source_module.replace(/'/g, "''")}',
          ${row.source_id},
          '${transactionRef.replace(/'/g, "''")}',
          ${taxId},
          '${taxName.replace(/'/g, "''")}',
          ${taxRate},
          '${cutType}',
          ${baseAmount},
          ${taxAmount},
          '${period}',
          'pending',
          '${direction}',
          '${notes.replace(/'/g, "''")}',
          '${now}',
          '${now}'
        )
        ON CONFLICT (transaction_type, transaction_id, tax_id) DO NOTHING
        RETURNING id
      `));

      if (ins.rows.length > 0) {
        result.inserted++;
      } else {
        result.skipped++;
      }
    } catch (err: any) {
      result.errors++;
      result.details.push(`[ERROR] id=${row.id} ${err.message}`);
      logger.warn({ err: err.message, ledgerId: row.id }, `${LOG} Error syncing row`);
    }
  }

  logger.info(result, `${LOG} Sync selesai`);
  return result;
}

/** Worker periodik: sync setiap N menit */
export function startTaxLedgerSyncWorker(intervalMs = 5 * 60 * 1000): void {
  logger.info({ intervalMs }, `${LOG} Worker dimulai`);

  const run = async () => {
    try {
      const result = await syncTaxLedgerToRegister({ limit: 200 });
      if (result.inserted > 0 || result.errors > 0) {
        logger.info(result, `${LOG} Periodik sync`);
      }
    } catch (err: any) {
      logger.warn({ err: err.message }, `${LOG} Worker error`);
    }
  };

  run();
  setInterval(run, intervalMs);
}
