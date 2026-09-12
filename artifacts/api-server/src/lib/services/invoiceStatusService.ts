/**
 * invoiceStatusService.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * SINGLE SOURCE OF TRUTH untuk perubahan:
 *   - sales_documents.invoice_status    (invoiceStatus)
 *   - purchase_documents.bill_status    (billStatus)
 *
 * FASE 1 — Service layer tersedia. Route lama BELUM dimigrasikan.
 * FASE 2 — routes/sales.ts (action=mark_invoiced) dan routes/payments.ts
 *           (Paylabs webhook) WAJIB memanggil markSalesInvoiced() agar:
 *           1. Idempotency terjaga (tidak ada double journal entry).
 *           2. Source perubahan tercatat (manual vs paylabs vs system).
 *
 * CRITICAL RULE:
 *   Pemanggil wajib memeriksa result.alreadySet sebelum membuat journal entry.
 *   Jika alreadySet=true → JANGAN buat journal entry baru.
 *
 * Sales invoiceStatus enum:  none | to_invoice | invoiced
 * Purchase billStatus enum:  none | to_bill    | billed
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { db } from "@workspace/db";
import { salesDocumentsTable, purchaseDocumentsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../logger.js";
import { writeAuditLog } from "../auditLog.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export type InvoiceMarkSource =
  | "manual"      // staff klik di BizPortal
  | "paylabs"     // Paylabs online payment webhook
  | "system"      // background worker / internal trigger
  | "webhook";    // webhook lainnya

export interface InvoiceMarkResult {
  ok: boolean;
  docId: number;
  /**
   * true  = status sudah 'invoiced'/'billed' sebelum call ini.
   *         Pemanggil TIDAK BOLEH membuat journal entry baru.
   * false = status baru saja diubah di DB.
   */
  alreadySet?: boolean;
  fromStatus?: string;
  toStatus?: string;
  source?: InvoiceMarkSource;
  error?: string;
}

// ── Sales Invoice ─────────────────────────────────────────────────────────────

/**
 * Set sales_documents.invoice_status = 'invoiced'.
 *
 * Idempotent — jika sudah 'invoiced', return ok + alreadySet=true.
 * Pemanggil WAJIB skip journal entry jika alreadySet=true.
 */
export async function markSalesInvoiced(
  docId: number,
  source: InvoiceMarkSource = "manual",
): Promise<InvoiceMarkResult> {
  const [row] = await db
    .select({
      invoiceStatus: salesDocumentsTable.invoiceStatus,
      status: salesDocumentsTable.status,
    })
    .from(salesDocumentsTable)
    .where(eq(salesDocumentsTable.id, docId));

  if (!row) {
    return { ok: false, docId, error: `Sales document #${docId} tidak ditemukan` };
  }

  // Idempotency guard — status sudah 'invoiced'
  if (row.invoiceStatus === "invoiced") {
    logger.debug({ docId, source }, "markSalesInvoiced: already invoiced, skip");
    return {
      ok: true,
      docId,
      alreadySet: true,
      fromStatus: "invoiced",
      toStatus: "invoiced",
      source,
    };
  }

  await db
    .update(salesDocumentsTable)
    .set({ invoiceStatus: "invoiced", updatedAt: new Date() })
    .where(eq(salesDocumentsTable.id, docId));

  logger.info({ docId, fromStatus: row.invoiceStatus, source }, "markSalesInvoiced: invoiceStatus set to invoiced");

  writeAuditLog({
    action: "status_transition",
    module: "invoice_status",
    referenceId: String(docId),
    oldData: { invoiceStatus: row.invoiceStatus },
    newData: { invoiceStatus: "invoiced", source, actorType: "system" },
  });

  return {
    ok: true,
    docId,
    alreadySet: false,
    fromStatus: row.invoiceStatus,
    toStatus: "invoiced",
    source,
  };
}

/**
 * Set sales_documents.invoice_status = 'to_invoice' (siap ditagih, belum invoiced).
 * Digunakan saat order di-confirm.
 * Idempotent.
 */
export async function markSalesReadyToInvoice(
  docId: number,
  source: InvoiceMarkSource = "system",
): Promise<InvoiceMarkResult> {
  const [row] = await db
    .select({ invoiceStatus: salesDocumentsTable.invoiceStatus })
    .from(salesDocumentsTable)
    .where(eq(salesDocumentsTable.id, docId));

  if (!row) {
    return { ok: false, docId, error: `Sales document #${docId} tidak ditemukan` };
  }

  if (row.invoiceStatus === "to_invoice" || row.invoiceStatus === "invoiced") {
    return { ok: true, docId, alreadySet: true, fromStatus: row.invoiceStatus, toStatus: row.invoiceStatus, source };
  }

  await db
    .update(salesDocumentsTable)
    .set({ invoiceStatus: "to_invoice", updatedAt: new Date() })
    .where(eq(salesDocumentsTable.id, docId));

  return { ok: true, docId, alreadySet: false, fromStatus: row.invoiceStatus, toStatus: "to_invoice", source };
}

// ── Purchase Bill ─────────────────────────────────────────────────────────────

/**
 * Set purchase_documents.bill_status = 'billed'.
 *
 * Idempotent — jika sudah 'billed', return ok + alreadySet=true.
 */
export async function markPurchaseBilled(
  docId: number,
  source: InvoiceMarkSource = "manual",
): Promise<InvoiceMarkResult> {
  const [row] = await db
    .select({ billStatus: purchaseDocumentsTable.billStatus })
    .from(purchaseDocumentsTable)
    .where(eq(purchaseDocumentsTable.id, docId));

  if (!row) {
    return { ok: false, docId, error: `Purchase document #${docId} tidak ditemukan` };
  }

  if (row.billStatus === "billed") {
    logger.debug({ docId, source }, "markPurchaseBilled: already billed, skip");
    return {
      ok: true,
      docId,
      alreadySet: true,
      fromStatus: "billed",
      toStatus: "billed",
      source,
    };
  }

  await db
    .update(purchaseDocumentsTable)
    .set({ billStatus: "billed", updatedAt: new Date() })
    .where(eq(purchaseDocumentsTable.id, docId));

  logger.info({ docId, fromStatus: row.billStatus, source }, "markPurchaseBilled: billStatus set to billed");

  writeAuditLog({
    action: "status_transition",
    module: "bill_status",
    referenceId: String(docId),
    oldData: { billStatus: row.billStatus },
    newData: { billStatus: "billed", source, actorType: "system" },
  });

  return {
    ok: true,
    docId,
    alreadySet: false,
    fromStatus: row.billStatus,
    toStatus: "billed",
    source,
  };
}

/**
 * Set purchase_documents.bill_status = 'to_bill'.
 * Digunakan saat PO di-confirm.
 * Idempotent.
 */
export async function markPurchaseReadyToBill(
  docId: number,
  source: InvoiceMarkSource = "system",
): Promise<InvoiceMarkResult> {
  const [row] = await db
    .select({ billStatus: purchaseDocumentsTable.billStatus })
    .from(purchaseDocumentsTable)
    .where(eq(purchaseDocumentsTable.id, docId));

  if (!row) {
    return { ok: false, docId, error: `Purchase document #${docId} tidak ditemukan` };
  }

  if (row.billStatus === "to_bill" || row.billStatus === "billed") {
    return { ok: true, docId, alreadySet: true, fromStatus: row.billStatus, toStatus: row.billStatus, source };
  }

  await db
    .update(purchaseDocumentsTable)
    .set({ billStatus: "to_bill", updatedAt: new Date() })
    .where(eq(purchaseDocumentsTable.id, docId));

  return { ok: true, docId, alreadySet: false, fromStatus: row.billStatus, toStatus: "to_bill", source };
}
