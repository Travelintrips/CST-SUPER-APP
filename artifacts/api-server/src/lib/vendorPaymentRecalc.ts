/**
 * vendorPaymentRecalc.ts
 *
 * Recalculate purchase_documents.payment_status + amount_paid
 * berdasarkan sum semua vendor_payments yang terhubung ke purchase_document_id.
 *
 * Dipanggil setelah vendor payment dibuat atau dihapus.
 * Non-fatal: error ditulis ke logger saja, tidak melempar.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface VendorDocPaymentResult {
  ok: boolean;
  purchaseDocId: number;
  newStatus?: "unpaid" | "partial" | "paid";
  totalPaid?: number;
  grandTotal?: number;
  unchanged?: boolean;
  error?: string;
}

export async function recalculateVendorDocPaymentStatus(
  purchaseDocId: number,
): Promise<VendorDocPaymentResult> {
  try {
    // Sum semua vendor_payments non-deleted untuk doc ini
    const paymentsResult = await db.execute(sql`
      SELECT COALESCE(SUM(amount), 0)::numeric AS total_paid
      FROM vendor_payments
      WHERE purchase_document_id = ${purchaseDocId}
    `);
    const totalPaid = round2(Number((paymentsResult.rows[0] as any)?.total_paid ?? 0));

    // Ambil grand_total dari purchase_documents
    const docResult = await db.execute(sql`
      SELECT grand_total::numeric, total_amount::numeric, payment_status, amount_paid
      FROM purchase_documents
      WHERE id = ${purchaseDocId}
    `);
    const doc = docResult.rows[0] as any;
    if (!doc) {
      return { ok: false, purchaseDocId, error: `Purchase document #${purchaseDocId} tidak ditemukan` };
    }

    const grandTotal = round2(Number(doc.grand_total ?? doc.total_amount ?? 0));
    const prevStatus = doc.payment_status as string;
    const prevPaid = round2(Number(doc.amount_paid ?? 0));

    let newStatus: "unpaid" | "partial" | "paid" = "unpaid";
    if (grandTotal > 0 && totalPaid >= grandTotal) newStatus = "paid";
    else if (totalPaid > 0) newStatus = "partial";

    if (newStatus === prevStatus && totalPaid === prevPaid) {
      return { ok: true, purchaseDocId, newStatus, totalPaid, grandTotal, unchanged: true };
    }

    await db.execute(sql`
      UPDATE purchase_documents
      SET payment_status = ${newStatus},
          amount_paid    = ${String(totalPaid)},
          updated_at     = NOW()
      WHERE id = ${purchaseDocId}
    `);

    logger.info(
      { purchaseDocId, from: prevStatus, to: newStatus, totalPaid, grandTotal },
      "vendorPaymentRecalc: purchase_documents payment_status updated",
    );

    return { ok: true, purchaseDocId, newStatus, totalPaid, grandTotal, unchanged: false };
  } catch (err) {
    logger.warn({ err, purchaseDocId }, "vendorPaymentRecalc: failed (non-fatal)");
    return { ok: false, purchaseDocId, error: String((err as Error)?.message ?? err) };
  }
}
