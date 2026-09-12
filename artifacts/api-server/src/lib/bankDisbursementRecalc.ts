/**
 * bankDisbursementRecalc.ts
 *
 * Recalculate purchase_documents.payment_status + amount_paid
 * berdasarkan sum bank_disbursement_items yang terhubung ke purchase_document_id
 * dan berasal dari disbursement dengan status = 'posted' (bukan voided).
 *
 * PENTING — Isolasi dari jalur lama:
 *   Fungsi ini HANYA menghitung dari bank_disbursements. Tidak menggabungkan
 *   dengan vendor_payments (jalur lama). Ini mencegah double-count selama
 *   masa transisi Phase 1 → Phase 3.
 *
 *   Jalur lama (vendor_payments) tetap memanggil recalculateVendorDocPaymentStatus()
 *   dari vendorPaymentRecalc.ts secara independen.
 *
 *   Jika kedua jalur dipakai untuk PO yang sama → terakhir yang menulis menang.
 *   Ini akan diselesaikan di Phase 3 saat vendor_payments dideprecate sepenuhnya.
 *
 * Dipanggil setelah:
 *   - Bank Disbursement di-POST (status = 'posted')
 *   - Bank Disbursement di-VOID (status = 'voided')
 *
 * Non-fatal: error ditulis ke logger saja, tidak melempar.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export interface DisbursementRecalcResult {
  ok: boolean;
  purchaseDocId: number;
  newStatus?: "unpaid" | "partial" | "paid";
  totalPaid?: number;
  grandTotal?: number;
  unchanged?: boolean;
  error?: string;
}

/**
 * Hitung ulang payment_status dan amount_paid di purchase_documents
 * berdasarkan HANYA sum dari bank_disbursement_items (status posted, bukan voided).
 *
 * @param purchaseDocId  ID purchase_documents
 */
export async function recalculateFromBankDisbursements(
  purchaseDocId: number,
): Promise<DisbursementRecalcResult> {
  try {
    // Sum amount dari bank_disbursement_items yang:
    //   - terhubung ke purchase_document_id ini
    //   - disbursement-nya berstatus 'posted' (bukan voided)
    //   - transaction_type = 'supplier_payment'
    // Catatan: amount di sini adalah gross amount (sebelum WHT).
    //   WHT sudah dikreditkan ke akun terpisah, jadi bank menerima net.
    //   Tapi hutang ke supplier dilunasi sebesar gross (DR AP = gross).
    //   Oleh karena itu payment_status dihitung berdasarkan gross amount.
    const sumResult = await db.execute(sql`
      SELECT COALESCE(SUM(bdi.amount), 0)::numeric AS total_paid
      FROM bank_disbursement_items bdi
      JOIN bank_disbursements bd ON bd.id = bdi.disbursement_id
      WHERE bdi.purchase_document_id = ${purchaseDocId}
        AND bdi.transaction_type = 'supplier_payment'
        AND bd.status = 'posted'
    `);

    const totalPaid = round2(Number((sumResult.rows[0] as any)?.total_paid ?? 0));

    // Ambil grand_total dari purchase_documents
    const docResult = await db.execute(sql`
      SELECT grand_total::numeric, total_amount::numeric, payment_status, amount_paid
      FROM purchase_documents
      WHERE id = ${purchaseDocId}
    `);
    const doc = docResult.rows[0] as any;
    if (!doc) {
      return {
        ok: false,
        purchaseDocId,
        error: `Purchase document #${purchaseDocId} tidak ditemukan`,
      };
    }

    const grandTotal = round2(Number(doc.grand_total ?? doc.total_amount ?? 0));
    const prevStatus = doc.payment_status as string;
    const prevPaid = round2(Number(doc.amount_paid ?? 0));

    let newStatus: "unpaid" | "partial" | "paid" = "unpaid";
    if (grandTotal > 0 && totalPaid >= grandTotal) newStatus = "paid";
    else if (totalPaid > 0) newStatus = "partial";

    if (newStatus === prevStatus && totalPaid === prevPaid) {
      return {
        ok: true,
        purchaseDocId,
        newStatus,
        totalPaid,
        grandTotal,
        unchanged: true,
      };
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
      "[bankDisbursementRecalc] purchase_documents payment_status updated",
    );

    return { ok: true, purchaseDocId, newStatus, totalPaid, grandTotal, unchanged: false };
  } catch (err) {
    logger.warn({ err, purchaseDocId }, "[bankDisbursementRecalc] failed (non-fatal)");
    return {
      ok: false,
      purchaseDocId,
      error: String((err as Error)?.message ?? err),
    };
  }
}

/**
 * Trigger recalculate untuk sekumpulan purchase_document_id sekaligus.
 * Biasanya dipanggil setelah POST atau VOID disbursement.
 *
 * @param purchaseDocIds  Array ID yang unik (duplikat diabaikan)
 * @returns               Array hasil recalculate (satu per docId)
 */
export async function recalculateBatchFromBankDisbursements(
  purchaseDocIds: number[],
): Promise<DisbursementRecalcResult[]> {
  const uniqueIds = [...new Set(purchaseDocIds.filter((id) => id > 0))];
  if (uniqueIds.length === 0) return [];

  const results = await Promise.allSettled(
    uniqueIds.map((id) => recalculateFromBankDisbursements(id)),
  );

  return results.map((r, i) =>
    r.status === "fulfilled"
      ? r.value
      : { ok: false, purchaseDocId: uniqueIds[i]!, error: String(r.reason) },
  );
}
