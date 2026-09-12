/**
 * paymentStatusService.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * SINGLE SOURCE OF TRUTH untuk perhitungan dan update:
 *   - sales_documents.payment_status + amount_paid
 *   - purchase_documents.payment_status + amount_paid
 *
 * FASE 1 — Service layer tersedia. Route lama BELUM dimigrasikan.
 * FASE 2 — routes/accounting.ts (create/void payment) dan routes/payments.ts
 *           (Paylabs webhook) WAJIB memanggil recalculatePaymentStatus() agar:
 *           1. Kedua tabel payment (accounting_payments + payments) di-sum bersama.
 *           2. Logic paymentStatus tidak duplikat di dua tempat berbeda.
 *
 * PERBEDAAN DENGAN ROUTE LAMA:
 *   Route accounting.ts saat ini HANYA membaca accounting_payments.
 *   Route payments.ts saat ini update langsung tanpa sum.
 *   Service ini menyatukan keduanya dalam satu recalculate().
 *   → Aktifkan penggabungan sumber payment di Fase 2.
 *
 * CATATAN ARSITEKTUR:
 *   Fase 1: recalculatePaymentStatus() hanya baca accounting_payments (sama seperti existing).
 *           Ini memastikan backward compatibility — tidak ada behavior change.
 *   Fase 2: tambahkan query ke tabel payments (Paylabs) lalu gabungkan totals.
 *           Flag INCLUDE_PAYLABS_IN_RECALC di bawah mengontrol ini.
 *
 * Sales paymentStatus enum:    unpaid | partial | paid | overdue
 * Purchase paymentStatus enum: unpaid | partial | paid | overdue
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { db } from "@workspace/db";
import {
  salesDocumentsTable,
  purchaseDocumentsTable,
  accountingPaymentsTable,
  paymentsTable,
} from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "../logger.js";
import { writeAuditLog } from "../auditLog.js";

// ── Feature Flag ──────────────────────────────────────────────────────────────
//
// Fase 2: true — sum KEDUA tabel: accounting_payments + payments (Paylabs)
//
const INCLUDE_PAYLABS_IN_RECALC = true;

// ── Types ─────────────────────────────────────────────────────────────────────

export type DocType = "sales_order" | "purchase_order";

export type PaymentStatusValue = "unpaid" | "partial" | "paid" | "overdue";

export interface PaymentStatusResult {
  ok: boolean;
  docId: number;
  docType: DocType;
  newStatus?: PaymentStatusValue;
  /** Total dari semua payment non-voided */
  totalPaid?: number;
  grandTotal?: number;
  /** true jika status tidak berubah dari sebelumnya */
  unchanged?: boolean;
  error?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function deriveStatus(totalPaid: number, grandTotal: number): "paid" | "partial" | "unpaid" {
  if (grandTotal > 0 && totalPaid >= grandTotal) return "paid";
  if (totalPaid > 0) return "partial";
  return "unpaid";
}

/** Sum semua accounting_payments non-voided untuk sebuah source doc. */
async function sumAccountingPayments(docId: number, docType: DocType): Promise<number> {
  const rows: Array<{ amount: string | null; status: string }> = await db
    .select({
      amount: accountingPaymentsTable.amount,
      status: accountingPaymentsTable.status,
    })
    .from(accountingPaymentsTable)
    .where(
      and(
        eq(accountingPaymentsTable.sourceType, docType),
        eq(accountingPaymentsTable.sourceDocId, docId),
      ),
    ) as Array<{ amount: string | null; status: string }>;

  return round2(
    rows
      .filter((row) => row.status !== "voided")
      .reduce((sum: number, row) => sum + Number(row.amount), 0),
  );
}

/** Sum semua payments (Paylabs/online) dengan status "paid" untuk sebuah source doc. */
async function sumPaylabsPayments(docId: number, docType: DocType): Promise<number> {
  const refKind = docType === "sales_order" ? "sales" : "purchase";
  const rows: Array<{ amount: string | null }> = await db
    .select({ amount: paymentsTable.amount })
    .from(paymentsTable)
    .where(
      and(
        eq(paymentsTable.refKind, refKind),
        eq(paymentsTable.refId, docId),
        eq(paymentsTable.status, "paid"),
      ),
    ) as Array<{ amount: string | null }>;

  return round2(rows.reduce((sum: number, row) => sum + Number(row.amount), 0));
}

// ── Core Function ─────────────────────────────────────────────────────────────

/**
 * Hitung ulang paymentStatus dari payment records dan update ke dokumen.
 *
 * Menentukan:  paid | partial | unpaid
 * TIDAK mengubah 'overdue' — gunakan markPaymentOverdue() untuk itu.
 *
 * @param docId   - ID sales_documents atau purchase_documents
 * @param docType - "sales_order" | "purchase_order"
 */
export async function recalculatePaymentStatus(
  docId: number,
  docType: DocType,
): Promise<PaymentStatusResult> {
  let totalPaid = await sumAccountingPayments(docId, docType);

  if (INCLUDE_PAYLABS_IN_RECALC) {
    const paylabsTotal = await sumPaylabsPayments(docId, docType);
    totalPaid = round2(totalPaid + paylabsTotal);
  }

  if (docType === "sales_order") {
    const [doc] = await db
      .select({
        grandTotal: salesDocumentsTable.grandTotal,
        paymentStatus: salesDocumentsTable.paymentStatus,
        amountPaid: salesDocumentsTable.amountPaid,
      })
      .from(salesDocumentsTable)
      .where(eq(salesDocumentsTable.id, docId));

    if (!doc) {
      return { ok: false, docId, docType, error: `Sales document #${docId} tidak ditemukan` };
    }

    const grandTotal = Number(doc.grandTotal ?? 0);
    const newStatus = deriveStatus(totalPaid, grandTotal);
    const unchanged =
      doc.paymentStatus === newStatus && Number(doc.amountPaid ?? 0) === totalPaid;

    if (!unchanged) {
      await db
        .update(salesDocumentsTable)
        .set({
          paymentStatus: newStatus,
          amountPaid: String(totalPaid),
          updatedAt: new Date(),
        })
        .where(eq(salesDocumentsTable.id, docId));

      logger.info(
        { docId, docType, from: doc.paymentStatus, to: newStatus, totalPaid, grandTotal },
        "paymentStatusService: recalculated",
      );

      writeAuditLog({
        action: "status_transition",
        module: "payment_status",
        referenceId: String(docId),
        oldData: { paymentStatus: doc.paymentStatus, amountPaid: doc.amountPaid },
        newData: { paymentStatus: newStatus, amountPaid: totalPaid, docType, actorType: "system", source: "recalculate" },
      });
    }

    return { ok: true, docId, docType, newStatus, totalPaid, grandTotal, unchanged };
  } else {
    const [doc] = await db
      .select({
        grandTotal: purchaseDocumentsTable.grandTotal,
        paymentStatus: purchaseDocumentsTable.paymentStatus,
        amountPaid: purchaseDocumentsTable.amountPaid,
      })
      .from(purchaseDocumentsTable)
      .where(eq(purchaseDocumentsTable.id, docId));

    if (!doc) {
      return { ok: false, docId, docType, error: `Purchase document #${docId} tidak ditemukan` };
    }

    const grandTotal = Number(doc.grandTotal ?? 0);
    const newStatus = deriveStatus(totalPaid, grandTotal);
    const unchanged =
      doc.paymentStatus === newStatus && Number(doc.amountPaid ?? 0) === totalPaid;

    if (!unchanged) {
      await db
        .update(purchaseDocumentsTable)
        .set({
          paymentStatus: newStatus,
          amountPaid: String(totalPaid),
          updatedAt: new Date(),
        })
        .where(eq(purchaseDocumentsTable.id, docId));

      logger.info(
        { docId, docType, from: doc.paymentStatus, to: newStatus, totalPaid, grandTotal },
        "paymentStatusService: recalculated",
      );

      writeAuditLog({
        action: "status_transition",
        module: "payment_status",
        referenceId: String(docId),
        oldData: { paymentStatus: doc.paymentStatus, amountPaid: doc.amountPaid },
        newData: { paymentStatus: newStatus, amountPaid: totalPaid, docType, actorType: "system", source: "recalculate" },
      });
    }

    return { ok: true, docId, docType, newStatus, totalPaid, grandTotal, unchanged };
  }
}

// ── Overdue ───────────────────────────────────────────────────────────────────

/**
 * Tandai dokumen sebagai 'overdue'.
 *
 * Guard: HANYA diaplikasikan jika currentPaymentStatus BUKAN 'paid'.
 * Satu-satunya caller yang sah: workflowWorker.ts
 *
 * TIDAK boleh dipanggil dari alur payment (accounting/paylabs) —
 * gunakan recalculatePaymentStatus() untuk itu.
 */
export async function markPaymentOverdue(
  docId: number,
  docType: DocType,
): Promise<PaymentStatusResult> {
  if (docType === "sales_order") {
    const [doc] = await db
      .select({ paymentStatus: salesDocumentsTable.paymentStatus })
      .from(salesDocumentsTable)
      .where(eq(salesDocumentsTable.id, docId));

    if (!doc) {
      return { ok: false, docId, docType, error: `Sales document #${docId} tidak ditemukan` };
    }

    // Guard: jika sudah paid, tidak perlu overdue
    if (doc.paymentStatus === "paid") {
      return { ok: true, docId, docType, newStatus: "paid", unchanged: true };
    }

    // Guard: jika sudah overdue, idempotent
    if (doc.paymentStatus === "overdue") {
      return { ok: true, docId, docType, newStatus: "overdue", unchanged: true };
    }

    await db
      .update(salesDocumentsTable)
      .set({ paymentStatus: "overdue", updatedAt: new Date() })
      .where(eq(salesDocumentsTable.id, docId));

    logger.info({ docId, docType, from: doc.paymentStatus }, "paymentStatusService: marked overdue");

    writeAuditLog({
      action: "status_transition",
      module: "payment_status",
      referenceId: String(docId),
      oldData: { paymentStatus: doc.paymentStatus },
      newData: { paymentStatus: "overdue", docType, actorType: "system", source: "workflowWorker:overdue" },
    });

    return { ok: true, docId, docType, newStatus: "overdue" };
  } else {
    const [doc] = await db
      .select({ paymentStatus: purchaseDocumentsTable.paymentStatus })
      .from(purchaseDocumentsTable)
      .where(eq(purchaseDocumentsTable.id, docId));

    if (!doc) {
      return { ok: false, docId, docType, error: `Purchase document #${docId} tidak ditemukan` };
    }

    if (doc.paymentStatus === "paid") {
      return { ok: true, docId, docType, newStatus: "paid", unchanged: true };
    }

    if (doc.paymentStatus === "overdue") {
      return { ok: true, docId, docType, newStatus: "overdue", unchanged: true };
    }

    await db
      .update(purchaseDocumentsTable)
      .set({ paymentStatus: "overdue", updatedAt: new Date() })
      .where(eq(purchaseDocumentsTable.id, docId));

    logger.info({ docId, docType, from: doc.paymentStatus }, "paymentStatusService: marked overdue");

    writeAuditLog({
      action: "status_transition",
      module: "payment_status",
      referenceId: String(docId),
      oldData: { paymentStatus: doc.paymentStatus },
      newData: { paymentStatus: "overdue", docType, actorType: "system", source: "workflowWorker:overdue" },
    });

    return { ok: true, docId, docType, newStatus: "overdue" };
  }
}

// ── Convenience Helpers ───────────────────────────────────────────────────────

/**
 * Hitung status dari angka — tanpa DB query.
 * Berguna untuk preview / validation sebelum commit.
 */
export function derivePaymentStatus(
  totalPaid: number,
  grandTotal: number,
): "paid" | "partial" | "unpaid" {
  return deriveStatus(totalPaid, grandTotal);
}
