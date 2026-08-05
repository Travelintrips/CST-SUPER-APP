import {
  db, salesDocumentsTable, salesDocumentLinesTable,
  logisticOrderItemsTable, logisticVendorFulfillmentsTable,
} from "@workspace/db";
import { eq, sql, and, inArray } from "drizzle-orm";
import { buildInvoicePdfBuffer } from "./pdfInvoice.js";
import { ObjectStorageService } from "./objectStorage.js";
import { sendMediaViaService, sendViaService as sendWhatsApp } from "./waTransport.js";
import { getAdminGroupWa } from "./adminWa.js";
import { ensureAccountingSettings } from "./accountingSeed.js";
import { loadDocTemplate } from "./docTemplateLoader.js";
import { postLogisticSalesInvoice, normalizeShipmentServiceType, type LogisticInvoiceLine } from "./accounting.js";
import { logger } from "./logger.js";
import { writeAuditLog } from "./auditLog.js";
import type { LogisticOrderData } from "./orderNotification.js";

export type { LogisticOrderData };

const _pubObjStore = new ObjectStorageService();

// ── One-time column migrations ────────────────────────────────────────────────
db.execute(sql`
  ALTER TABLE sales_documents
  ADD COLUMN IF NOT EXISTS invoice_pdf_url text
`).catch(() => {});

db.execute(sql`
  ALTER TABLE sales_document_lines
  ADD COLUMN IF NOT EXISTS meta jsonb
`).catch(() => {});

function idrFmt(n: number): string {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

function nowWIB(): string {
  return new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta", hour12: false });
}

async function nextSoNumber(offset = 0): Promise<string> {
  const year = new Date().getFullYear();
  const pattern = `SO/${year}/%`;
  const [row] = await db
    .select({ maxSeq: sql<number>`COALESCE(MAX(CAST(SPLIT_PART(doc_number, '/', 3) AS int)), 0)` })
    .from(salesDocumentsTable)
    .where(sql`doc_number LIKE ${pattern} AND kind = 'order'`);
  const seq = (Number(row?.maxSeq ?? 0) + 1 + offset).toString().padStart(5, "0");
  return `SO/${year}/${seq}`;
}

// ── Helper: fetch vendor catalog order items as invoice lines ─────────────────
interface CatalogInvoiceLine {
  orderItemId: number;
  vendorCatalogItemId: number | null;
  vendorFulfillmentId: number | null;
  serviceType: string | null;
  name: string;
  description: string | null;
  quantity: string;
  unitPrice: string;
  subtotal: string;
  subtotalNum: number;
}

export async function fetchVendorCatalogLines(orderId: number): Promise<CatalogInvoiceLine[]> {
  const items = await db
    .select({
      id:                 logisticOrderItemsTable.id,
      serviceName:        logisticOrderItemsTable.serviceName,
      serviceType:        logisticOrderItemsTable.serviceType,
      vendorCatalogItemId: logisticOrderItemsTable.vendorCatalogItemId,
      priceSnapshot:      logisticOrderItemsTable.priceSnapshot,
      calculationInput:   logisticOrderItemsTable.calculationInput,
      subtotal:           logisticOrderItemsTable.subtotal,
    })
    .from(logisticOrderItemsTable)
    .where(
      and(
        eq(logisticOrderItemsTable.orderId, orderId),
        eq(logisticOrderItemsTable.itemSource, "vendor_catalog_item"),
      )
    );

  if (items.length === 0) return [];

  // Fetch fulfillment IDs for these items
  const itemIds = items.map((i) => i.id);
  const fulfillments = await db
    .select({
      id:          logisticVendorFulfillmentsTable.id,
      orderItemId: logisticVendorFulfillmentsTable.orderItemId,
    })
    .from(logisticVendorFulfillmentsTable)
    .where(inArray(logisticVendorFulfillmentsTable.orderItemId, itemIds));

  const fulfillmentByItemId = new Map(fulfillments.map((f) => [f.orderItemId, f.id]));

  return items.map((item) => {
    const ps  = item.priceSnapshot  as Record<string, unknown> | null;
    const ci  = item.calculationInput as Record<string, unknown> | null;

    // Unit price: prefer priceSell from snapshot
    const priceSell = ps?.priceSell  != null ? Number(ps.priceSell)  : 0;
    const subtotalNum = ps?.subtotal != null ? Number(ps.subtotal)   : Number(item.subtotal ?? 0);

    // Quantity: try multiple calculationInput keys
    const qty = Number(
      ci?.chargeableUnit ?? ci?.chargeableQty ?? ci?.quantity ?? ci?.qty ?? 1
    ) || 1;

    // Compute unit price if priceSell is not set
    const unitPrice = priceSell > 0 ? priceSell : (qty > 0 ? subtotalNum / qty : subtotalNum);

    const serviceType = (item.serviceType ?? "").trim();
    const lineName = serviceType
      ? `Jasa ${serviceType} - ${item.serviceName}`
      : item.serviceName;

    const meta: Record<string, unknown> = { orderItemId: item.id };
    if (item.vendorCatalogItemId) meta.vendorCatalogItemId = item.vendorCatalogItemId;
    const vfId = fulfillmentByItemId.get(item.id);
    if (vfId) meta.vendorFulfillmentId = vfId;

    return {
      orderItemId:         item.id,
      vendorCatalogItemId: item.vendorCatalogItemId ?? null,
      vendorFulfillmentId: vfId ?? null,
      serviceType:         serviceType || null,
      name:                lineName,
      description:         null,
      quantity:            String(qty),
      unitPrice:           String(unitPrice),
      subtotal:            String(subtotalNum),
      subtotalNum,
    };
  });
}

// ── Main: auto-create customer invoice from logistic order ────────────────────
export async function autoCreateLogisticInvoice(order: LogisticOrderData, companyId = 1): Promise<void> {
  try {
    const grandTotal = order.grandTotal ?? 0;
    const taxAmount  = order.tax ?? 0;
    const subtotal   = taxAmount > 0 ? grandTotal - taxAmount : grandTotal;

    let docId: number;
    let docNumber: string;
    let isNew = false;

    const [existingRow] = await db
      .select({ id: salesDocumentsTable.id, docNumber: salesDocumentsTable.docNumber })
      .from(salesDocumentsTable)
      .where(eq(salesDocumentsTable.logisticOrderId, order.id))
      .limit(1);

    if (existingRow) {
      docId = existingRow.id;
      docNumber = existingRow.docNumber;
      logger.info({ orderId: order.id, docId, docNumber }, "autoCreateLogisticInvoice: SO sudah ada, skip insert");
    } else {
      isNew = true;
      const noteLines = [
        "Dibuat otomatis saat POD diterima.",
        `Order Ref: ${order.orderNumber}`,
        `Rute: ${order.origin} → ${order.destination}`,
      ];
      if (order.commodity) noteLines.push(`Komoditas: ${order.commodity}`);

      let doc: typeof salesDocumentsTable.$inferSelect | undefined;
      for (let attempt = 0; attempt < 5; attempt++) {
        const candidate = await nextSoNumber(attempt);
        try {
          [doc] = await db
            .insert(salesDocumentsTable)
            .values({
              companyId,
              docNumber: candidate,
              kind:           "order",
              status:         "confirmed",
              invoiceStatus:  "to_invoice",
              deliveryStatus: "delivered",
              paymentStatus:  "unpaid",
              customerName:   order.customerName,
              totalAmount:    String(subtotal),
              taxAmount:      String(taxAmount),
              grandTotal:     String(grandTotal),
              notes:          noteLines.join("\n"),
              logisticOrderId: order.id,
              confirmedAt:    new Date(),
              origin:         order.origin,
              destination:    order.destination,
            })
            .returning();
          break;
        } catch (err: unknown) {
          const code = (err as any)?.cause?.code ?? (err as any)?.code;
          if (code === "23505" && attempt < 4) continue;
          throw err;
        }
      }
      if (!doc) throw new Error("Gagal membuat SO setelah 5 percobaan");
      docId    = doc.id;
      docNumber = doc.docNumber;

      // ── Fetch vendor catalog item lines ───────────────────────────────────
      const catalogLines = await fetchVendorCatalogLines(order.id);
      const catalogSubtotalSum = catalogLines.reduce((acc, l) => acc + l.subtotalNum, 0);

      // ── Freight line: order total minus catalog items ─────────────────────
      const freightSubtotal = Math.max(0, subtotal - catalogSubtotalSum);

      if (freightSubtotal > 0 || catalogLines.length === 0) {
        const freightAmount = catalogLines.length === 0 ? subtotal : freightSubtotal;
        await db.insert(salesDocumentLinesTable).values({
          documentId:  docId,
          productId:   null,
          name:        `Jasa Pengiriman ${order.shipmentType ?? ""}`.trim(),
          description: [
            `${order.origin} → ${order.destination}`,
            order.commodity         ? `Komoditas: ${order.commodity}` : null,
            order.cargoDescription  ?? null,
          ].filter(Boolean).join(" | ") || null,
          quantity:  "1",
          unitPrice: String(freightAmount),
          subtotal:  String(freightAmount),
        } as any);
      }

      // ── Vendor catalog item lines ─────────────────────────────────────────
      for (const line of catalogLines) {
        await db.insert(salesDocumentLinesTable).values({
          documentId:  docId,
          productId:   null,
          name:        line.name,
          description: line.description,
          quantity:    line.quantity,
          unitPrice:   line.unitPrice,
          subtotal:    line.subtotal,
          meta: {
            orderItemId:         line.orderItemId,
            vendorCatalogItemId: line.vendorCatalogItemId,
            vendorFulfillmentId: line.vendorFulfillmentId,
          },
        } as any);
      }

      // Audit: SO created
      writeAuditLog({
        companyId,
        action:       "invoice_created",
        module:       "logistic_invoice",
        referenceId:  String(order.id),
        newData: {
          docId, docNumber,
          orderId:      order.id,
          orderNumber:  order.orderNumber,
          customerName: order.customerName,
          grandTotal,
          catalogLineCount: catalogLines.length,
        },
      });

      // ── Build per-line data untuk jurnal akuntansi ────────────────────────
      // Revenue HARUS dari priceSnapshot (sudah dipakai di catalogLines.subtotalNum)
      // bukan priceBase. Freight line pakai freightSubtotal yang sudah dihitung.
      const accountingLines: LogisticInvoiceLine[] = [];

      if (freightSubtotal > 0 || catalogLines.length === 0) {
        const freightAmount = catalogLines.length === 0 ? subtotal : freightSubtotal;
        accountingLines.push({
          serviceType:        normalizeShipmentServiceType(order.shipmentType),
          subtotal:           freightAmount,
          orderItemId:        null,
          vendorCatalogItemId: null,
          lineName:           `Jasa Pengiriman ${order.shipmentType ?? ""}`.trim(),
        });
      }

      for (const line of catalogLines) {
        accountingLines.push({
          serviceType:         line.serviceType,
          subtotal:            line.subtotalNum,
          orderItemId:         line.orderItemId,
          vendorCatalogItemId: line.vendorCatalogItemId,
          lineName:            line.name,
        });
      }

      void postLogisticSalesInvoice({
        logisticOrderId: order.id,
        salesDocId:      docId,
        docNumber,
        customerName:    order.customerName,
        lines:           accountingLines,
        taxAmount,
        taxAccountId:    null,
        companyId,
      }).catch((err) => logger.error({ err, docId, docNumber }, "autoCreateLogisticInvoice: jurnal gagal"));
    }

    // ── Build PDF with all lines ──────────────────────────────────────────────
    const [acctSettings, template] = await Promise.all([
      ensureAccountingSettings(),
      loadDocTemplate("invoice"),
    ]);

    // Reload all lines from DB (so PDF stays consistent even if SO existed)
    const allDbLines = await db
      .select()
      .from(salesDocumentLinesTable)
      .where(eq(salesDocumentLinesTable.documentId, docId));

    const pdfLines = allDbLines.map((l) => ({
      name:        l.name,
      description: l.description ?? undefined,
      quantity:    Number(l.quantity),
      unitPrice:   Number(l.unitPrice),
      subtotal:    Number(l.subtotal),
    }));

    // Fallback: if no lines in DB (old SO), build from order data
    if (pdfLines.length === 0) {
      pdfLines.push({
        name:      `Jasa Pengiriman ${order.shipmentType ?? ""}`.trim(),
        description: [
          `${order.origin} → ${order.destination}`,
          order.commodity ? `Komoditas: ${order.commodity}` : null,
          order.cargoDescription ?? null,
        ].filter(Boolean).join(" | ") || undefined,
        quantity:  1,
        unitPrice: subtotal,
        subtotal,
      });
    }

    const pdfTotalAmount = pdfLines.reduce((acc, l) => acc + l.subtotal, 0);

    const pdfBuffer = await buildInvoicePdfBuffer({
      title:          "INVOICE",
      docNumber,
      status:         "Menunggu Pembayaran",
      kind:           "order",
      companyName:    acctSettings.companyName,
      companyAddress: acctSettings.companyAddress,
      companyNpwp:    acctSettings.companyNpwp,
      partyLabel:     "Pelanggan",
      partyName:      order.customerName,
      partyPhone:     order.phone,
      partyEmail:     order.email || null,
      createdAt:      new Date().toISOString(),
      notes:          order.notes ?? null,
      lines:          pdfLines,
      totalAmount:    pdfTotalAmount,
      taxAmount:      taxAmount > 0 ? taxAmount : null,
      grandTotal:     taxAmount > 0 ? grandTotal : null,
      taxRate:        taxAmount > 0 && subtotal > 0 ? Math.round((taxAmount / subtotal) * 100) : null,
      template,
    });

    const subPath = `invoices/logistic/${order.id}/${Date.now()}_${docNumber.replace(/[\\/]/g, "-")}.pdf`;
    let pdfPublicUrl = "";
    try {
      await _pubObjStore.uploadPublicRaw(subPath, pdfBuffer, "application/pdf");
      pdfPublicUrl = _pubObjStore.toSupabasePublicUrl(subPath);

      await db.execute(sql`
        UPDATE sales_documents
        SET invoice_pdf_url = ${pdfPublicUrl}
        WHERE id = ${docId}
      `);

      writeAuditLog({
        companyId,
        action:      "pdf_uploaded",
        module:      "logistic_invoice",
        referenceId: String(order.id),
        newData:     { docId, docNumber, pdfUrl: pdfPublicUrl },
      });
    } catch (e) {
      logger.warn({ e, subPath }, "autoCreateLogisticInvoice: upload PDF gagal — kirim WA tanpa attachment");
    }

    // ── WA Notifications ──────────────────────────────────────────────────────
    const adminWa = await getAdminGroupWa();
    if (adminWa) {
      const adminMsg = [
        `🧾 *Invoice Auto-Generated*`,
        ``,
        `No. SO    : *${docNumber}*`,
        `Pelanggan : ${order.customerName}`,
        `Rute      : ${order.origin} → ${order.destination}`,
        grandTotal > 0 ? `Total     : *${idrFmt(grandTotal)}*` : null,
        ``,
        `✅ POD diterima. Invoice telah dibuat & dikirim ke WhatsApp customer.`,
        `📋 BizPortal: https://${process.env.REPLIT_DEV_DOMAIN ?? "localhost:5000"}/sales/documents`,
        ``,
        `🕐 ${nowWIB()}`,
      ].filter((l) => l !== null).join("\n");

      const waAdminSent = pdfPublicUrl
        ? sendMediaViaService(adminWa, adminMsg, pdfPublicUrl, {
            context: "pod_invoice_admin", refType: "logistic_order", refId: String(order.id),
          }).then(() => true).catch((e) => { logger.warn({ e }, "WA admin media gagal"); return false; })
        : sendWhatsApp(adminWa, adminMsg, {
            context: "pod_invoice_admin", refType: "logistic_order", refId: String(order.id),
          }).then(() => true).catch((e) => { logger.warn({ e }, "WA admin teks gagal"); return false; });

      void waAdminSent.then((ok) => {
        if (ok) {
          writeAuditLog({
            companyId,
            action:      "wa_sent_admin",
            module:      "logistic_invoice",
            referenceId: String(order.id),
            newData:     { docNumber, adminWa, hasPdf: !!pdfPublicUrl },
          });
        }
      });
    }

    if (order.phone) {
      const custMsg = [
        `Yth. *${order.customerName}*,`,
        ``,
        `Terima kasih telah menggunakan layanan kami.`,
        `Pengiriman Anda telah selesai dan invoice telah kami siapkan.`,
        ``,
        `No. Invoice : *${docNumber}*`,
        `Rute        : ${order.origin} → ${order.destination}`,
        order.commodity ? `Komoditas   : ${order.commodity}` : null,
        grandTotal > 0  ? `Total       : *${idrFmt(grandTotal)}*` : null,
        ``,
        pdfPublicUrl
          ? `📄 File invoice terlampir. Mohon simpan sebagai bukti pembayaran.`
          : `Mohon konfirmasi penerimaan barang kepada kami.`,
        ``,
        `Hubungi kami jika ada pertanyaan. Terima kasih 🙏`,
      ].filter((l) => l !== null).join("\n");

      const waCustSent = pdfPublicUrl
        ? sendMediaViaService(order.phone, custMsg, pdfPublicUrl, {
            context: "pod_invoice_customer", refType: "logistic_order", refId: String(order.id),
          }).then(() => true).catch((e) => { logger.warn({ e, phone: order.phone }, "WA customer media gagal"); return false; })
        : sendWhatsApp(order.phone, custMsg, {
            context: "pod_invoice_customer", refType: "logistic_order", refId: String(order.id),
          }).then(() => true).catch((e) => { logger.warn({ e, phone: order.phone }, "WA customer teks gagal"); return false; });

      void waCustSent.then((ok) => {
        if (ok) {
          writeAuditLog({
            companyId,
            action:      "wa_sent_customer",
            module:      "logistic_invoice",
            referenceId: String(order.id),
            newData:     { docNumber, phone: order.phone, hasPdf: !!pdfPublicUrl },
          });
        }
      });
    }

    void isNew;
    logger.info({ orderId: order.id, docId, docNumber, hasPdf: !!pdfPublicUrl }, "autoCreateLogisticInvoice: selesai");
  } catch (err) {
    logger.warn({ err, orderId: order.id }, "autoCreateLogisticInvoice: non-fatal error");
  }
}
