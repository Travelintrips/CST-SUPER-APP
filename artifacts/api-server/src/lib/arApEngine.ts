/**
 * AR/AP ENGINE — SAP-like Subledger System
 *
 * RULE:
 *  - Semua revenue WAJIB ada AR entry sebelum GL final posting
 *  - Semua expense/purchase WAJIB ada AP entry sebelum GL final posting
 *  - Subledger harus match GL (balance check)
 *
 * AR Status: OPEN → PARTIAL → CLOSED | OVERDUE | CANCELLED
 * AP Status: OPEN → PARTIAL → PAID   | OVERDUE | CANCELLED
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ArEntry {
  companyId: number;
  invoiceId?: number | null;
  customerId?: number | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  dueDate?: string | null;
  currency?: string;
  grossAmount: number;
  period?: string | null;
  glEntryId?: number | null;
  notes?: string | null;
}

export interface ApEntry {
  companyId: number;
  billId?: number | null;
  vendorId?: number | null;
  billNumber?: string | null;
  billDate?: string | null;
  dueDate?: string | null;
  currency?: string;
  payableAmount: number;
  period?: string | null;
  glEntryId?: number | null;
  notes?: string | null;
}

export interface SubledgerBalance {
  companyId: number;
  totalOpen: number;
  totalPartial: number;
  totalClosed: number;
  totalOverdue: number;
  count: number;
}

// ─── AR Engine ──────────────────────────────────────────────────────────────

export async function upsertArEntry(entry: ArEntry): Promise<number> {
  const period = entry.period ?? dateToPeriod(entry.invoiceDate ?? new Date().toISOString());

  if (entry.invoiceId) {
    const { rows } = await db.execute(sql.raw(`
      INSERT INTO ar_subledger
        (company_id, invoice_id, customer_id, invoice_number, invoice_date, due_date,
         currency, gross_amount, outstanding_amount, paid_amount, status, gl_entry_id, period, notes, updated_at)
      VALUES
        (${entry.companyId}, ${entry.invoiceId ?? "NULL"}, ${entry.customerId ?? "NULL"},
         ${sqlStr(entry.invoiceNumber)}, ${sqlDate(entry.invoiceDate)}, ${sqlDate(entry.dueDate)},
         '${(entry.currency ?? "IDR").replace(/'/g, "")}',
         ${entry.grossAmount}, ${entry.grossAmount}, 0, 'OPEN',
         ${entry.glEntryId ?? "NULL"}, ${sqlStr(period)}, ${sqlStr(entry.notes)}, NOW())
      ON CONFLICT (company_id, invoice_id)
      DO UPDATE SET
        gross_amount       = EXCLUDED.gross_amount,
        outstanding_amount = ar_subledger.outstanding_amount + (EXCLUDED.gross_amount - ar_subledger.gross_amount),
        gl_entry_id        = COALESCE(EXCLUDED.gl_entry_id, ar_subledger.gl_entry_id),
        notes              = COALESCE(EXCLUDED.notes, ar_subledger.notes),
        updated_at         = NOW()
      RETURNING id
    `));
    return Number((rows[0] as any).id);
  }

  const { rows } = await db.execute(sql.raw(`
    INSERT INTO ar_subledger
      (company_id, invoice_id, customer_id, invoice_number, invoice_date, due_date,
       currency, gross_amount, outstanding_amount, paid_amount, status, gl_entry_id, period, notes)
    VALUES
      (${entry.companyId}, NULL, ${entry.customerId ?? "NULL"},
       ${sqlStr(entry.invoiceNumber)}, ${sqlDate(entry.invoiceDate)}, ${sqlDate(entry.dueDate)},
       '${(entry.currency ?? "IDR").replace(/'/g, "")}',
       ${entry.grossAmount}, ${entry.grossAmount}, 0, 'OPEN',
       ${entry.glEntryId ?? "NULL"}, ${sqlStr(period)}, ${sqlStr(entry.notes)})
    RETURNING id
  `));
  return Number((rows[0] as any).id);
}

export async function applyArPayment(params: {
  companyId: number;
  invoiceId?: number | null;
  arId?: number | null;
  paidAmount: number;
  actor?: string;
}): Promise<{ newOutstanding: number; newStatus: string }> {
  const whereClause = params.arId
    ? `id = ${params.arId}`
    : `company_id = ${params.companyId} AND invoice_id = ${params.invoiceId}`;

  const { rows } = await db.execute(sql.raw(`
    UPDATE ar_subledger
    SET paid_amount        = paid_amount + ${params.paidAmount},
        outstanding_amount = GREATEST(0, outstanding_amount - ${params.paidAmount}),
        status             = CASE
          WHEN (outstanding_amount - ${params.paidAmount}) <= 0 THEN 'CLOSED'
          WHEN (outstanding_amount - ${params.paidAmount}) > 0 AND paid_amount > 0 THEN 'PARTIAL'
          ELSE status
        END,
        updated_at         = NOW()
    WHERE ${whereClause}
    RETURNING outstanding_amount, status
  `));

  if (!rows.length) throw new Error(`AR entry tidak ditemukan: ${JSON.stringify(params)}`);
  return {
    newOutstanding: Number((rows[0] as any).outstanding_amount),
    newStatus: String((rows[0] as any).status),
  };
}

export async function getArBalance(companyId: number, period?: string): Promise<SubledgerBalance> {
  const periodFilter = period ? `AND period = '${period.replace(/'/g, "")}'` : "";
  const { rows } = await db.execute(sql.raw(`
    SELECT
      COUNT(*)::int                                           AS count,
      COALESCE(SUM(CASE WHEN status='OPEN'    THEN outstanding_amount ELSE 0 END),0)::numeric AS total_open,
      COALESCE(SUM(CASE WHEN status='PARTIAL' THEN outstanding_amount ELSE 0 END),0)::numeric AS total_partial,
      COALESCE(SUM(CASE WHEN status='CLOSED'  THEN gross_amount       ELSE 0 END),0)::numeric AS total_closed,
      COALESCE(SUM(CASE WHEN status='OVERDUE' THEN outstanding_amount ELSE 0 END),0)::numeric AS total_overdue
    FROM ar_subledger
    WHERE company_id = ${companyId} ${periodFilter}
  `));
  const r = rows[0] as any;
  return {
    companyId,
    totalOpen:    Number(r?.total_open ?? 0),
    totalPartial: Number(r?.total_partial ?? 0),
    totalClosed:  Number(r?.total_closed ?? 0),
    totalOverdue: Number(r?.total_overdue ?? 0),
    count:        Number(r?.count ?? 0),
  };
}

export async function markOverdueAr(): Promise<number> {
  const { rows } = await db.execute(sql.raw(`
    UPDATE ar_subledger
    SET status = 'OVERDUE', updated_at = NOW()
    WHERE status IN ('OPEN', 'PARTIAL')
      AND due_date < CURRENT_DATE
    RETURNING id
  `));
  return rows.length;
}

// ─── AP Engine ──────────────────────────────────────────────────────────────

export async function upsertApEntry(entry: ApEntry): Promise<number> {
  const period = entry.period ?? dateToPeriod(entry.billDate ?? new Date().toISOString());

  if (entry.billId) {
    const { rows } = await db.execute(sql.raw(`
      INSERT INTO ap_subledger
        (company_id, bill_id, vendor_id, bill_number, bill_date, due_date,
         currency, payable_amount, paid_amount, status, gl_entry_id, period, notes, updated_at)
      VALUES
        (${entry.companyId}, ${entry.billId}, ${entry.vendorId ?? "NULL"},
         ${sqlStr(entry.billNumber)}, ${sqlDate(entry.billDate)}, ${sqlDate(entry.dueDate)},
         '${(entry.currency ?? "IDR").replace(/'/g, "")}',
         ${entry.payableAmount}, 0, 'OPEN',
         ${entry.glEntryId ?? "NULL"}, ${sqlStr(period)}, ${sqlStr(entry.notes)}, NOW())
      ON CONFLICT (company_id, bill_id)
      DO UPDATE SET
        payable_amount = EXCLUDED.payable_amount,
        gl_entry_id    = COALESCE(EXCLUDED.gl_entry_id, ap_subledger.gl_entry_id),
        notes          = COALESCE(EXCLUDED.notes, ap_subledger.notes),
        updated_at     = NOW()
      RETURNING id
    `));
    return Number((rows[0] as any).id);
  }

  const { rows } = await db.execute(sql.raw(`
    INSERT INTO ap_subledger
      (company_id, bill_id, vendor_id, bill_number, bill_date, due_date,
       currency, payable_amount, paid_amount, status, gl_entry_id, period, notes)
    VALUES
      (${entry.companyId}, NULL, ${entry.vendorId ?? "NULL"},
       ${sqlStr(entry.billNumber)}, ${sqlDate(entry.billDate)}, ${sqlDate(entry.dueDate)},
       '${(entry.currency ?? "IDR").replace(/'/g, "")}',
       ${entry.payableAmount}, 0, 'OPEN',
       ${entry.glEntryId ?? "NULL"}, ${sqlStr(period)}, ${sqlStr(entry.notes)})
    RETURNING id
  `));
  return Number((rows[0] as any).id);
}

export async function applyApPayment(params: {
  companyId: number;
  billId?: number | null;
  apId?: number | null;
  paidAmount: number;
}): Promise<{ newOutstanding: number; newStatus: string }> {
  const whereClause = params.apId
    ? `id = ${params.apId}`
    : `company_id = ${params.companyId} AND bill_id = ${params.billId}`;

  const { rows } = await db.execute(sql.raw(`
    UPDATE ap_subledger
    SET paid_amount  = paid_amount + ${params.paidAmount},
        status       = CASE
          WHEN (payable_amount - (paid_amount + ${params.paidAmount})) <= 0 THEN 'PAID'
          WHEN (payable_amount - (paid_amount + ${params.paidAmount})) > 0 AND (paid_amount + ${params.paidAmount}) > 0 THEN 'PARTIAL'
          ELSE status
        END,
        updated_at   = NOW()
    WHERE ${whereClause}
    RETURNING (payable_amount - paid_amount) AS outstanding_amount, status
  `));

  if (!rows.length) throw new Error(`AP entry tidak ditemukan: ${JSON.stringify(params)}`);
  return {
    newOutstanding: Math.max(0, Number((rows[0] as any).outstanding_amount)),
    newStatus: String((rows[0] as any).status),
  };
}

export async function getApBalance(companyId: number, period?: string): Promise<SubledgerBalance> {
  const periodFilter = period ? `AND period = '${period.replace(/'/g, "")}'` : "";
  const { rows } = await db.execute(sql.raw(`
    SELECT
      COUNT(*)::int                                                                 AS count,
      COALESCE(SUM(CASE WHEN status='OPEN'    THEN payable_amount - paid_amount ELSE 0 END),0)::numeric AS total_open,
      COALESCE(SUM(CASE WHEN status='PARTIAL' THEN payable_amount - paid_amount ELSE 0 END),0)::numeric AS total_partial,
      COALESCE(SUM(CASE WHEN status='PAID'    THEN payable_amount               ELSE 0 END),0)::numeric AS total_closed,
      COALESCE(SUM(CASE WHEN status='OVERDUE' THEN payable_amount - paid_amount ELSE 0 END),0)::numeric AS total_overdue
    FROM ap_subledger
    WHERE company_id = ${companyId} ${periodFilter}
  `));
  const r = rows[0] as any;
  return {
    companyId,
    totalOpen:    Number(r?.total_open ?? 0),
    totalPartial: Number(r?.total_partial ?? 0),
    totalClosed:  Number(r?.total_closed ?? 0),
    totalOverdue: Number(r?.total_overdue ?? 0),
    count:        Number(r?.count ?? 0),
  };
}

export async function markOverdueAp(): Promise<number> {
  const { rows } = await db.execute(sql.raw(`
    UPDATE ap_subledger
    SET status = 'OVERDUE', updated_at = NOW()
    WHERE status IN ('OPEN', 'PARTIAL')
      AND due_date < CURRENT_DATE
    RETURNING id
  `));
  return rows.length;
}

// ─── GL-Subledger Match Check ────────────────────────────────────────────────

export async function validateSubledgerGlMatch(companyId: number, period: string): Promise<{
  arGlMatch: boolean;
  apGlMatch: boolean;
  arGlDiff: number;
  apGlDiff: number;
  details: string[];
}> {
  const details: string[] = [];

  const { rows: arRows } = await db.execute(sql.raw(`
    SELECT COALESCE(SUM(outstanding_amount), 0)::numeric AS total
    FROM ar_subledger
    WHERE company_id = ${companyId} AND period = '${period.replace(/'/g, "")}' AND status NOT IN ('CLOSED','CANCELLED')
  `));
  const arSubTotal = Number((arRows[0] as any)?.total ?? 0);

  const { rows: apRows } = await db.execute(sql.raw(`
    SELECT COALESCE(SUM(payable_amount - paid_amount), 0)::numeric AS total
    FROM ap_subledger
    WHERE company_id = ${companyId} AND period = '${period.replace(/'/g, "")}' AND status NOT IN ('PAID','CANCELLED')
  `));
  const apSubTotal = Number((apRows[0] as any)?.total ?? 0);

  const { rows: glArRows } = await db.execute(sql.raw(`
    SELECT COALESCE(SUM(ael.debit_amount - ael.credit_amount), 0)::numeric AS total
    FROM accounting_entry_lines ael
    JOIN chart_of_accounts coa ON coa.id = ael.coa_id
    JOIN accounting_entries ae ON ae.id = ael.entry_id
    WHERE ae.company_id = ${companyId}
      AND TO_CHAR(ae.date, 'YYYY-MM') = '${period.replace(/'/g, "")}'
      AND coa.type = 'asset'
      AND coa.code ILIKE '%piutang%'
  `));
  const glArTotal = Number((glArRows[0] as any)?.total ?? 0);

  const { rows: glApRows } = await db.execute(sql.raw(`
    SELECT COALESCE(SUM(ael.credit_amount - ael.debit_amount), 0)::numeric AS total
    FROM accounting_entry_lines ael
    JOIN chart_of_accounts coa ON coa.id = ael.coa_id
    JOIN accounting_entries ae ON ae.id = ael.entry_id
    WHERE ae.company_id = ${companyId}
      AND TO_CHAR(ae.date, 'YYYY-MM') = '${period.replace(/'/g, "")}'
      AND coa.type = 'liability'
      AND coa.code ILIKE '%hutang%'
  `));
  const glApTotal = Number((glApRows[0] as any)?.total ?? 0);

  const arDiff = Math.abs(arSubTotal - glArTotal);
  const apDiff = Math.abs(apSubTotal - glApTotal);

  if (arDiff > 1) details.push(`AR mismatch: subledger=${arSubTotal}, GL=${glArTotal}, diff=${arDiff}`);
  if (apDiff > 1) details.push(`AP mismatch: subledger=${apSubTotal}, GL=${glApTotal}, diff=${apDiff}`);

  return {
    arGlMatch: arDiff <= 1,
    apGlMatch: apDiff <= 1,
    arGlDiff: arDiff,
    apGlDiff: apDiff,
    details,
  };
}

// ─── Sync from existing sales/purchase docs ──────────────────────────────────

export async function syncArFromSalesDocs(companyId: number, period: string): Promise<number> {
  const [year, month] = period.split("-").map(Number);
  const { rows } = await db.execute(sql.raw(`
    SELECT
      sd.id              AS invoice_id,
      sd.customer_id,
      sd.document_number AS invoice_number,
      sd.created_at::date AS invoice_date,
      (sd.created_at + INTERVAL '30 days')::date AS due_date,
      COALESCE(sd.grand_total, 0)::numeric AS gross_amount,
      COALESCE(sd.amount_paid, 0)::numeric AS paid_amount
    FROM sales_documents sd
    WHERE sd.company_id = ${companyId}
      AND sd.type IN ('invoice', 'INVOICE', 'sales_invoice')
      AND sd.status NOT IN ('DRAFT', 'CANCELLED')
      AND EXTRACT(YEAR  FROM sd.created_at) = ${year}
      AND EXTRACT(MONTH FROM sd.created_at) = ${month}
    LIMIT 500
  `));

  let synced = 0;
  for (const row of rows as any[]) {
    try {
      await upsertArEntry({
        companyId,
        invoiceId:      Number(row.invoice_id),
        customerId:     row.customer_id ? Number(row.customer_id) : null,
        invoiceNumber:  row.invoice_number,
        invoiceDate:    row.invoice_date,
        dueDate:        row.due_date,
        grossAmount:    Number(row.gross_amount),
        period,
      });
      if (Number(row.paid_amount) > 0) {
        await applyArPayment({
          companyId,
          invoiceId: Number(row.invoice_id),
          paidAmount: Number(row.paid_amount),
        }).catch(() => {});
      }
      synced++;
    } catch {
      // skip conflict / error per row
    }
  }
  return synced;
}

export async function syncApFromPurchaseDocs(companyId: number, period: string): Promise<number> {
  const [year, month] = period.split("-").map(Number);
  const { rows } = await db.execute(sql.raw(`
    SELECT
      pd.id              AS bill_id,
      pd.supplier_id     AS vendor_id,
      pd.document_number AS bill_number,
      pd.created_at::date AS bill_date,
      (pd.created_at + INTERVAL '30 days')::date AS due_date,
      COALESCE(pd.grand_total, 0)::numeric AS payable_amount
    FROM purchase_documents pd
    WHERE pd.company_id = ${companyId}
      AND pd.type IN ('bill', 'BILL', 'purchase_bill')
      AND pd.status NOT IN ('DRAFT', 'CANCELLED')
      AND EXTRACT(YEAR  FROM pd.created_at) = ${year}
      AND EXTRACT(MONTH FROM pd.created_at) = ${month}
    LIMIT 500
  `));

  let synced = 0;
  for (const row of rows as any[]) {
    try {
      await upsertApEntry({
        companyId,
        billId:       Number(row.bill_id),
        vendorId:     row.vendor_id ? Number(row.vendor_id) : null,
        billNumber:   row.bill_number,
        billDate:     row.bill_date,
        dueDate:      row.due_date,
        payableAmount: Number(row.payable_amount),
        period,
      });
      synced++;
    } catch {
      // skip
    }
  }
  return synced;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function dateToPeriod(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function sqlStr(val: string | null | undefined): string {
  if (val == null) return "NULL";
  return `'${val.replace(/'/g, "''")}'`;
}

function sqlDate(val: string | null | undefined): string {
  if (!val) return "NULL";
  const d = new Date(val);
  if (isNaN(d.getTime())) return "NULL";
  return `'${d.toISOString().slice(0, 10)}'`;
}
