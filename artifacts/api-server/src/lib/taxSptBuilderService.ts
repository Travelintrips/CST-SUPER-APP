/**
 * taxSptBuilderService.ts
 *
 * Membangun draft SPT Masa PPN & PPh dari data transaction_taxes.
 * READ-ONLY — tidak memodifikasi tabel manapun.
 *
 * Output utama:
 *   SptDraft  — ringkasan per periode/jenis pajak per company
 *   SptTransaction[] — detail transaksi dalam draft
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SptTransaction {
  id: number;
  transaction_type: string;
  transaction_id: number;
  transaction_ref: string | null;
  tax_name: string;
  tax_rate: number;
  base_amount: number;
  tax_amount: number;
  direction: string;
  status: string;
  faktur_pajak_number: string | null;
  bukti_potong_number: string | null;
  /** NPWP lawan transaksi (supplier/customer/karyawan) */
  npwp: string | null;
  /** Nama lawan transaksi */
  partner_name: string | null;
  created_at: string;
}

export interface SptPpnSummary {
  output_tax_total: number;
  input_tax_total: number;
  net_vat: number;
  tx_count: number;
}

export interface SptPphSummary {
  total_withholding: number;
  tx_count: number;
  by_type: Record<string, { total: number; count: number }>;
}

export interface SptDraft {
  company_id: number;
  period: string;
  built_at: string;
  ppn: SptPpnSummary;
  pph23: SptPphSummary;
  pph21: SptPphSummary;
  pph15: SptPphSummary;
  pph4: SptPphSummary;
  pph_other: SptPphSummary;
  all_pph: SptPphSummary;
  transactions: SptTransaction[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function emptyPph(): SptPphSummary {
  return { total_withholding: 0, tx_count: 0, by_type: {} };
}

function addToPph(acc: SptPphSummary, taxName: string, amount: number): void {
  acc.total_withholding += amount;
  acc.tx_count += 1;
  acc.by_type[taxName] = {
    total: (acc.by_type[taxName]?.total ?? 0) + amount,
    count: (acc.by_type[taxName]?.count ?? 0) + 1,
  };
}

function detectPphCategory(taxName: string): "pph21" | "pph23" | "pph15" | "pph4" | "pph_other" {
  const n = taxName.toLowerCase();
  if (n.includes("21")) return "pph21";
  if (n.includes("23")) return "pph23";
  if (n.includes("15")) return "pph15";
  if (n.includes("4(2)") || n.includes("4 (2)") || (n.includes("pph 4") && !n.includes("24"))) return "pph4";
  return "pph_other";
}

// ── Main builder ─────────────────────────────────────────────────────────────

export async function buildSptDraft(
  companyId: number,
  period: string,
): Promise<SptDraft> {
  const builtAt = new Date().toISOString();

  const { rows } = await db.execute(sql.raw(`
    SELECT
      tt.id,
      tt.transaction_type,
      tt.transaction_id,
      tt.transaction_ref,
      tt.tax_name,
      COALESCE(tt.tax_rate::numeric, 0)      AS tax_rate,
      COALESCE(tt.base_amount::numeric, 0)   AS base_amount,
      COALESCE(tt.tax_amount::numeric, 0)    AS tax_amount,
      tt.direction,
      tt.status,
      tt.faktur_pajak_number,
      tt.bukti_potong_number,
      tt.created_at,
      -- NPWP & nama lawan: ambil dari transaction_taxes dulu,
      -- NPWP lawan: tt.npwp → supplier via purchase_docs chain → customer via sales_docs chain
      COALESCE(
        NULLIF(tt.npwp, ''),
        pd_sup.supplier_npwp,
        sd_cust.customer_npwp
      ) AS npwp,
      -- Nama lawan: tt.partner_name → supplier name → customer name
      COALESCE(
        NULLIF(tt.partner_name, ''),
        pd_sup.supplier_name,
        sd_cust.customer_name
      ) AS partner_name
    FROM transaction_taxes tt
    -- Purchase transactions: transaction_id = purchase_documents.id → supplier
    LEFT JOIN (
      SELECT pd.id AS pd_id, s.tax_id AS supplier_npwp, s.name AS supplier_name
      FROM purchase_documents pd
      LEFT JOIN suppliers s ON s.id = pd.supplier_id
    ) pd_sup ON tt.transaction_type IN ('purchase_order', 'logistic_order', 'expense')
              AND tt.transaction_id = pd_sup.pd_id
    -- Sales transactions: transaction_id = sales_documents.id → customer
    LEFT JOIN (
      SELECT sd.id AS sd_id, c.tax_id AS customer_npwp, c.name AS customer_name
      FROM sales_documents sd
      LEFT JOIN customers c ON c.id = sd.customer_id
    ) sd_cust ON tt.transaction_type = 'sales_order'
              AND tt.transaction_id = sd_cust.sd_id
    WHERE tt.company_id = ${companyId}
      AND tt.period     = '${period}'
      AND tt.status    <> 'voided'
      AND (tt.spt_status IS NULL OR tt.spt_status <> 'EXCLUDED')
      AND (tt.include_in_spt IS NULL OR tt.include_in_spt = true)
    ORDER BY tt.created_at ASC
  `)).catch((e) => {
    logger.error({ err: e.message, companyId, period }, "[taxSptBuilder] Query gagal");
    return { rows: [] };
  });

  const transactions: SptTransaction[] = (rows as any[]).map((r) => ({
    id: Number(r.id),
    transaction_type: String(r.transaction_type ?? ""),
    transaction_id: Number(r.transaction_id ?? 0),
    transaction_ref: r.transaction_ref ?? null,
    tax_name: String(r.tax_name ?? ""),
    tax_rate: Number(r.tax_rate ?? 0),
    base_amount: Number(r.base_amount ?? 0),
    tax_amount: Number(r.tax_amount ?? 0),
    direction: String(r.direction ?? ""),
    status: String(r.status ?? ""),
    faktur_pajak_number: r.faktur_pajak_number ?? null,
    bukti_potong_number: r.bukti_potong_number ?? null,
    npwp: r.npwp ?? null,
    partner_name: r.partner_name ?? null,
    created_at: r.created_at ? new Date(r.created_at).toISOString() : "",
  }));

  // Build PPN summary
  const ppn: SptPpnSummary = {
    output_tax_total: 0,
    input_tax_total: 0,
    net_vat: 0,
    tx_count: 0,
  };

  const pph23 = emptyPph();
  const pph21 = emptyPph();
  const pph15 = emptyPph();
  const pph4  = emptyPph();
  const pph_other = emptyPph();
  const all_pph = emptyPph();

  for (const tx of transactions) {
    const name = tx.tax_name.toLowerCase();
    const isVat = name.includes("ppn") || name.includes("vat");
    const isWht = tx.direction === "withholding";

    if (isVat) {
      ppn.tx_count += 1;
      if (tx.direction === "output") {
        ppn.output_tax_total += tx.tax_amount;
      } else if (tx.direction === "input") {
        ppn.input_tax_total += tx.tax_amount;
      }
    } else if (isWht) {
      const cat = detectPphCategory(tx.tax_name);
      const target = { pph21, pph23, pph15, pph4, pph_other }[cat];
      addToPph(target, tx.tax_name, tx.tax_amount);
      addToPph(all_pph, tx.tax_name, tx.tax_amount);
    }
  }

  ppn.net_vat = ppn.output_tax_total - ppn.input_tax_total;

  return {
    company_id: companyId,
    period,
    built_at: builtAt,
    ppn,
    pph23,
    pph21,
    pph15,
    pph4,
    pph_other,
    all_pph,
    transactions,
  };
}

// ── Multi-period SPT summary (untuk list view) ─────────────────────────────

export interface SptPeriodSummary {
  period: string;
  ppn_output: number;
  ppn_input: number;
  net_ppn: number;
  pph_total: number;
  tx_count: number;
  has_faktur: number;
  missing_faktur: number;
  has_bupot: number;
  missing_bupot: number;
}

export async function listSptPeriods(
  companyId: number,
  year: string,
): Promise<SptPeriodSummary[]> {
  const { rows } = await db.execute(sql.raw(`
    SELECT
      period,
      COUNT(*)::int AS tx_count,
      COALESCE(SUM(tax_amount::numeric) FILTER (
        WHERE direction = 'output' AND (tax_name ILIKE '%ppn%' OR tax_name ILIKE '%vat%')
      ), 0)::float AS ppn_output,
      COALESCE(SUM(tax_amount::numeric) FILTER (
        WHERE direction = 'input' AND (tax_name ILIKE '%ppn%' OR tax_name ILIKE '%vat%')
      ), 0)::float AS ppn_input,
      COALESCE(SUM(tax_amount::numeric) FILTER (
        WHERE direction = 'withholding'
      ), 0)::float AS pph_total,
      COUNT(*) FILTER (WHERE direction <> 'withholding' AND faktur_pajak_number IS NOT NULL AND faktur_pajak_number <> '')::int AS has_faktur,
      COUNT(*) FILTER (WHERE direction <> 'withholding' AND (faktur_pajak_number IS NULL OR faktur_pajak_number = ''))::int AS missing_faktur,
      COUNT(*) FILTER (WHERE direction = 'withholding' AND bukti_potong_number IS NOT NULL AND bukti_potong_number <> '')::int AS has_bupot,
      COUNT(*) FILTER (WHERE direction = 'withholding' AND (bukti_potong_number IS NULL OR bukti_potong_number = ''))::int AS missing_bupot
    FROM transaction_taxes
    WHERE company_id = ${companyId}
      AND period LIKE '${year}-%'
      AND status <> 'voided'
    GROUP BY period
    ORDER BY period DESC
  `)).catch(() => ({ rows: [] }));

  return (rows as any[]).map((r) => ({
    period: String(r.period),
    ppn_output: Number(r.ppn_output ?? 0),
    ppn_input: Number(r.ppn_input ?? 0),
    net_ppn: Number(r.ppn_output ?? 0) - Number(r.ppn_input ?? 0),
    pph_total: Number(r.pph_total ?? 0),
    tx_count: Number(r.tx_count ?? 0),
    has_faktur: Number(r.has_faktur ?? 0),
    missing_faktur: Number(r.missing_faktur ?? 0),
    has_bupot: Number(r.has_bupot ?? 0),
    missing_bupot: Number(r.missing_bupot ?? 0),
  }));
}
