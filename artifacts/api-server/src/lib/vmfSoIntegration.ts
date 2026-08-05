/**
 * VMF → Sales Order Integration
 *
 * Membuat Sales Order nyata di tabel sales_documents saat customer
 * menyetujui penawaran dari Vendor Mini Form (customer-approval).
 *
 * SO ini akan muncul di modul Sales/Accounting BizPortal dan bisa di-invoice.
 */

import { db, salesDocumentsTable, salesDocumentLinesTable, customerApprovalsTable, vmfActivityLogTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { postSalesInvoice } from "./accounting.js";
import { logger } from "./logger.js";

type Approval = typeof customerApprovalsTable.$inferSelect;

async function nextSoNumber(offset = 0): Promise<string> {
  const year = new Date().getFullYear();
  const pattern = `SO/${year}/%`;
  const [row] = await db
    .select({
      maxSeq: sql<number>`COALESCE(MAX(CAST(SPLIT_PART(doc_number, '/', 3) AS int)), 0)`,
    })
    .from(salesDocumentsTable)
    .where(sql`doc_number LIKE ${pattern} AND kind = 'order'`);
  const seq = (Number(row?.maxSeq ?? 0) + 1 + offset).toString().padStart(5, "0");
  return `SO/${year}/${seq}`;
}

export type VmfSoResult =
  | { ok: true; docId: number; docNumber: string }
  | { ok: false; reason: "already_exists"; docId: number; docNumber: string }
  | { ok: false; reason: "error"; message: string };

/**
 * Membuat SO di sales_documents dari data approval VMF.
 * Idempoten: jika orderId sudah punya SO, return existing.
 *
 * @param approval  Row dari customer_approvals
 * @param companyId Default 1 (perusahaan utama)
 */
export async function createSalesOrderFromVmfApproval(
  approval: Approval,
  companyId = 1,
): Promise<VmfSoResult> {
  try {
    // ── Idempotency check via logisticOrderId ─────────────────────────────
    if (approval.orderId != null) {
      const [existing] = await db
        .select({ id: salesDocumentsTable.id, docNumber: salesDocumentsTable.docNumber })
        .from(salesDocumentsTable)
        .where(eq(salesDocumentsTable.logisticOrderId, approval.orderId))
        .limit(1);
      if (existing) {
        return { ok: false, reason: "already_exists", docId: existing.id, docNumber: existing.docNumber };
      }
    }

    // ── Hitung amount dari sellingPrice ───────────────────────────────────
    const grandTotal = approval.sellingPrice ? Number(approval.sellingPrice) : 0;

    // ── Build notes ───────────────────────────────────────────────────────
    const noteLines: string[] = ["Dibuat otomatis dari persetujuan customer VMF."];
    if (approval.orderNumber) noteLines.push(`Order Ref: ${approval.orderNumber}`);
    noteLines.push(`Ref VMF Token: ${approval.token}`);
    if (approval.termsNotes) noteLines.unshift(approval.termsNotes);

    // ── Generate doc number dengan retry untuk unique constraint ──────────
    let doc: typeof salesDocumentsTable.$inferSelect | undefined;
    let docNumber = "";

    for (let attempt = 0; attempt < 5; attempt++) {
      docNumber = await nextSoNumber(attempt);
      try {
        [doc] = await db
          .insert(salesDocumentsTable)
          .values({
            companyId,
            docNumber,
            kind: "order",
            status: "confirmed",
            invoiceStatus: "to_invoice",
            deliveryStatus: "none",
            paymentStatus: "unpaid",
            customerName: approval.customerName ?? "Customer",
            totalAmount: String(grandTotal),
            taxAmount: "0",
            grandTotal: String(grandTotal),
            notes: noteLines.join("\n"),
            logisticOrderId: approval.orderId ?? null,
            confirmedAt: new Date(),
            categoryKey: (approval as any).categoryKey ?? null,
            templateId: (approval as any).templateId ?? null,
            templateVersion: (approval as any).templateVersion ?? null,
            templateSnapshot: approval.templateSnapshot ?? null,
          })
          .returning();
        break;
      } catch (err: unknown) {
        const code =
          (err as { cause?: { code?: string }; code?: string })?.cause?.code ??
          (err as { code?: string })?.code;
        if (code === "23505" && attempt < 4) continue;
        throw err;
      }
    }
    if (!doc) throw new Error("Gagal membuat SO setelah 5 percobaan");

    // ── Insert satu line item untuk jasa logistik ─────────────────────────
    const offerSummary = approval.offerSummary as Record<string, unknown> | null;
    const serviceType = (offerSummary?.["serviceType"] as string | undefined) ?? "Jasa Logistik";
    const originDest =
      offerSummary?.["origin"] && offerSummary?.["destination"]
        ? ` (${offerSummary["origin"]} → ${offerSummary["destination"]})`
        : "";
    const lineName = `${serviceType}${originDest}`;

    await db.insert(salesDocumentLinesTable).values({
      documentId: doc.id,
      productId: null,
      name: lineName,
      description: approval.orderNumber ? `Order Ref: ${approval.orderNumber}` : null,
      quantity: "1",
      unitPrice: String(grandTotal),
      subtotal: String(grandTotal),
    });

    // ── Auto-post journal entry: Debit AR / Credit Revenue ────────────────
    // Fire-and-forget agar response tidak lambat; kegagalan dicatat di activity log
    // sehingga admin bisa melihat dan memicu ulang dari BizPortal.
    void postSalesInvoice({
      salesDocId: doc.id,
      docNumber,
      customerName: approval.customerName ?? "Customer",
      netAmount: grandTotal,
      taxAmount: 0,
      taxAccountId: null,
      companyId,
    }).catch((err) => {
      logger.error({ err, soId: doc!.id, docNumber }, "VMF SO: gagal auto-post jurnal penjualan");
      // Catat kegagalan ke vmf_activity_log agar terlihat di admin UI
      db.insert(vmfActivityLogTable).values({
        entityType: "customer_approval",
        entityId: approval.id,
        action: "accounting_failed",
        actor: "system",
        note: `Jurnal akuntansi gagal dibuat untuk SO ${docNumber}. Error: ${err instanceof Error ? err.message : String(err)}`,
        data: { soId: doc!.id, docNumber, error: String(err) },
      }).catch((logErr) => {
        logger.error({ logErr }, "VMF SO: gagal mencatat accounting_failed ke activity log");
      });
    });

    return { ok: true, docId: doc.id, docNumber };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, reason: "error", message: msg };
  }
}
