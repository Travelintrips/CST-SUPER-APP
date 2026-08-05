/**
 * Enterprise Workflow Templates
 *
 * Defines default WA message templates for all enterprise workflow categories:
 *   PROCUREMENT  — PR, Vendor Comparison, PO Release, GRN, Invoice Matching
 *   FINANCE      — Customer Invoice, Vendor Invoice, Payment Reminder/Confirmation, Outstanding Alert
 *   DOCUMENT     — Doc Missing/Approved, Customs Released, BL Released, COA Uploaded
 *   APPROVAL     — Waiting, Approved, Rejected, Revision Requested
 *   OPERATIONS   — Shipment Delayed, Truck Arrived, Driver Check-in, Warehouse Ready
 *   SYSTEM       — Template Updated, Required Field Missing, Required Doc Missing
 *
 * Each template supports:
 *  - {{variable}}           — substitution (line omitted if value is null/empty)
 *  - {{#if serviceType}}...{{/if}} — conditional blocks by service type
 *  - Role-based recipients  — admin_personal | admin_group | customer | vendor | finance | warehouse
 *  - Dynamic product template variables: {{items}}, {{priceBreakdown}}, {{productList}}
 *  - Mini-form & approval links: {{approvalLink}}, {{rejectLink}}, {{uploadLink}}, {{paymentLink}}
 */

import { db, waTemplateConfigsTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";
import { invalidateWaTemplateCache } from "./orderNotification.js";

// ─────────────────────────────────────────────────────────────────────────────
// DEFAULT ENTERPRISE TEMPLATES
// ─────────────────────────────────────────────────────────────────────────────

export const DEFAULT_ENTERPRISE_TPL = {

  // ══════════════════════════════════════════════════════════════════════════
  // PROCUREMENT
  // ══════════════════════════════════════════════════════════════════════════

  procurement_purchase_request: {
    admin_personal: [
      "📋 *PURCHASE REQUEST BARU*",
      "━━━━━━━━━━━━━━━━━━",
      "No. PR        : `{{prNumber}}`",
      "Tanggal       : {{tanggal}}",
      "Requestor     : {{requestedBy}}",
      "Departemen    : {{department}}",
      "Prioritas     : {{priority}}",
      "━━━━━━━━━━━━━━━━━━",
      "📦 *Item yang Diminta:*",
      "{{items}}",
      "━━━━━━━━━━━━━━━━━━",
      "💰 Total Estimasi : *Rp {{totalAmount}}*",
      "📝 Keterangan     : {{notes}}",
      "━━━━━━━━━━━━━━━━━━",
      "✅ Approve PR:",
      "{{approvalLink}}",
      "",
      "_Dikirim: {{timestamp}}_",
    ].join("\n"),

    admin_group: [
      "📋 *[PR BARU] {{prNumber}}*",
      "Requestor: *{{requestedBy}}* | Dept: {{department}}",
      "Total: *Rp {{totalAmount}}* | Prioritas: {{priority}}",
      "{{approvalLink}}",
      "_{{timestamp}}_",
    ].join("\n"),

    vendor: [
      "📦 *PERMINTAAN PENAWARAN (RFQ) — CST LOGISTICS*",
      "━━━━━━━━━━━━━━━━━━",
      "Kepada Yth. *{{vendorName}}*,",
      "",
      "Kami membutuhkan penawaran untuk kebutuhan berikut:",
      "",
      "No. PR        : {{prNumber}}",
      "Tanggal       : {{tanggal}}",
      "Target Tgl    : {{requiredDate}}",
      "━━━━━━━━━━━━━━━━━━",
      "📦 *Daftar Item:*",
      "{{items}}",
      "━━━━━━━━━━━━━━━━━━",
      "📝 Catatan    : {{notes}}",
      "",
      "🔗 *Submit Penawaran:*",
      "{{vendorFormUrl}}",
      "",
      "Batas penawaran: *{{quoteDeadline}}*",
      "",
      "Terima kasih 🙏",
      "_B2B Marketplace and Logistic_",
    ].join("\n"),
  },

  procurement_vendor_comparison: {
    admin_personal: [
      "📊 *PERBANDINGAN VENDOR — {{prNumber}}*",
      "━━━━━━━━━━━━━━━━━━",
      "No. PR        : {{prNumber}}",
      "Item          : {{itemDescription}}",
      "Qty           : {{quantity}} {{unit}}",
      "━━━━━━━━━━━━━━━━━━",
      "📋 *Ringkasan Penawaran:*",
      "{{vendorComparison}}",
      "━━━━━━━━━━━━━━━━━━",
      "🏆 Rekomendasi : *{{recommendedVendor}}*",
      "   Alasan       : {{recommendation}}",
      "━━━━━━━━━━━━━━━━━━",
      "🔗 Bandingkan & Pilih:",
      "{{compareLink}}",
      "_{{timestamp}}_",
    ].join("\n"),

    admin_group: [
      "📊 *[VENDOR COMPARISON] {{prNumber}}*",
      "{{vendorCount}} vendor mengajukan penawaran.",
      "Rekomendasi: *{{recommendedVendor}}*",
      "🔗 {{compareLink}}",
      "_{{timestamp}}_",
    ].join("\n"),
  },

  procurement_po_release: {
    admin_group: [
      "📄 *PURCHASE ORDER DITERBITKAN — {{poNumber}}*",
      "━━━━━━━━━━━━━━━━━━",
      "No. PO        : `{{poNumber}}`",
      "No. PR        : {{prNumber}}",
      "Vendor        : *{{vendorName}}*",
      "Tanggal PO    : {{tanggal}}",
      "Tgl Delivery  : {{deliveryDate}}",
      "━━━━━━━━━━━━━━━━━━",
      "📦 *Item:*",
      "{{items}}",
      "━━━━━━━━━━━━━━━━━━",
      "💰 Total PO    : *Rp {{totalAmount}}*",
      "📝 Term        : {{paymentTerms}}",
      "━━━━━━━━━━━━━━━━━━",
      "🔗 Lihat PO:",
      "{{poLink}}",
      "_{{timestamp}}_",
    ].join("\n"),

    vendor: [
      "📄 *PURCHASE ORDER — CST LOGISTICS*",
      "━━━━━━━━━━━━━━━━━━",
      "Kepada Yth. *{{vendorName}}*,",
      "",
      "Kami dengan ini menerbitkan Purchase Order kepada Anda:",
      "",
      "No. PO        : *{{poNumber}}*",
      "Tanggal PO    : {{tanggal}}",
      "Tgl Delivery  : *{{deliveryDate}}*",
      "━━━━━━━━━━━━━━━━━━",
      "📦 *Daftar Item:*",
      "{{items}}",
      "━━━━━━━━━━━━━━━━━━",
      "💰 Total       : *Rp {{totalAmount}}*",
      "📋 Term Bayar  : {{paymentTerms}}",
      "📍 Lokasi Kirim: {{deliveryAddress}}",
      "📝 Catatan     : {{notes}}",
      "━━━━━━━━━━━━━━━━━━",
      "✅ Konfirmasi penerimaan PO:",
      "{{poConfirmLink}}",
      "",
      "Terima kasih atas kerja sama Anda 🙏",
      "_B2B Marketplace and Logistic_",
    ].join("\n"),
  },

  procurement_goods_receipt: {
    admin_personal: [
      "📦 *GOODS RECEIPT NOTE (GRN)*",
      "━━━━━━━━━━━━━━━━━━",
      "No. GRN       : `{{grnNumber}}`",
      "No. PO        : {{poNumber}}",
      "Vendor        : *{{vendorName}}*",
      "Tgl Terima    : {{tanggal}}",
      "Diterima Oleh : {{receivedBy}}",
      "━━━━━━━━━━━━━━━━━━",
      "📋 *Rincian Penerimaan:*",
      "{{receiptItems}}",
      "━━━━━━━━━━━━━━━━━━",
      "✅ Diterima Lengkap : {{isComplete}}",
      "⚠️ Kekurangan       : {{shortage}}",
      "❌ Barang Reject    : {{rejected}}",
      "📝 Catatan          : {{notes}}",
      "━━━━━━━━━━━━━━━━━━",
      "🔗 Lihat GRN:",
      "{{grnLink}}",
      "_{{timestamp}}_",
    ].join("\n"),

    admin_group: [
      "📦 *[GRN] {{grnNumber}}*",
      "PO: {{poNumber}} | Vendor: *{{vendorName}}*",
      "Status: {{isComplete}} | Shortage: {{shortage}}",
      "_{{timestamp}}_",
    ].join("\n"),

    vendor: [
      "✅ *KONFIRMASI PENERIMAAN BARANG*",
      "━━━━━━━━━━━━━━━━━━",
      "Kepada Yth. *{{vendorName}}*,",
      "",
      "Barang dari PO *{{poNumber}}* telah kami terima.",
      "",
      "No. GRN       : {{grnNumber}}",
      "Tgl Terima    : {{tanggal}}",
      "Status        : {{receiptStatus}}",
      "Kekurangan    : {{shortage}}",
      "Barang Reject : {{rejected}}",
      "Catatan       : {{notes}}",
      "",
      "Mohon koordinasikan kekurangan/perbedaan jika ada.",
      "",
      "Terima kasih 🙏",
      "_B2B Marketplace and Logistic_",
    ].join("\n"),
  },

  procurement_invoice_matching: {
    admin_personal: [
      "🔍 *INVOICE MATCHING — {{invoiceNumber}}*",
      "━━━━━━━━━━━━━━━━━━",
      "No. Invoice   : `{{invoiceNumber}}`",
      "No. PO        : {{poNumber}}",
      "No. GRN       : {{grnNumber}}",
      "Vendor        : *{{vendorName}}*",
      "━━━━━━━━━━━━━━━━━━",
      "💰 Nilai Invoice : Rp {{invoiceAmount}}",
      "💰 Nilai PO      : Rp {{poAmount}}",
      "💰 Nilai GRN     : Rp {{grnAmount}}",
      "━━━━━━━━━━━━━━━━━━",
      "✅ Status Match  : {{matchStatus}}",
      "⚠️ Selisih        : Rp {{variance}}",
      "📝 Keterangan    : {{matchNotes}}",
      "━━━━━━━━━━━━━━━━━━",
      "{{#if match_ok}}",
      "✅ 3-Way Match OK — Siap bayar.",
      "{{approveLink}}",
      "{{/if}}",
      "{{#if match_fail}}",
      "❌ 3-Way Match GAGAL — Perlu review.",
      "{{reviewLink}}",
      "{{/if}}",
      "_{{timestamp}}_",
    ].join("\n"),

    admin_group: [
      "🔍 *[INVOICE MATCHING] {{invoiceNumber}}*",
      "Vendor: *{{vendorName}}* | PO: {{poNumber}}",
      "Status: *{{matchStatus}}* | Selisih: Rp {{variance}}",
      "_{{timestamp}}_",
    ].join("\n"),
  },

  // ══════════════════════════════════════════════════════════════════════════
  // FINANCE
  // ══════════════════════════════════════════════════════════════════════════

  finance_customer_invoice: {
    customer: [
      "🧾 *INVOICE — CST LOGISTICS*",
      "━━━━━━━━━━━━━━━━━━",
      "Halo *{{customerName}}*,",
      "",
      "Berikut tagihan layanan kami:",
      "",
      "No. Invoice   : *{{invoiceNumber}}*",
      "Tanggal       : {{tanggal}}",
      "No. Order     : {{orderNumber}}",
      "Jatuh Tempo   : *{{dueDate}}*",
      "━━━━━━━━━━━━━━━━━━",
      "📋 *Rincian Tagihan:*",
      "{{priceBreakdown}}",
      "━━━━━━━━━━━━━━━━━━",
      "💰 Subtotal    : Rp {{subtotalAmount}}",
      "🧾 PPN         : Rp {{taxAmount}}",
      "💵 *Total      : Rp {{totalAmount}}*",
      "━━━━━━━━━━━━━━━━━━",
      "🏦 Pembayaran ke:",
      "{{bankAccount}}",
      "",
      "🔗 Lihat & Bayar Invoice:",
      "{{paymentLink}}",
      "",
      "Terima kasih atas kepercayaan Anda 🙏",
      "_B2B Marketplace and Logistic_",
    ].join("\n"),

    admin_personal: [
      "🧾 *INVOICE DITERBITKAN — {{invoiceNumber}}*",
      "Customer: *{{customerName}}* | Order: {{orderNumber}}",
      "Total: *Rp {{totalAmount}}* | Jatuh Tempo: {{dueDate}}",
      "Status: {{invoiceStatus}}",
      "_{{timestamp}}_",
    ].join("\n"),
  },

  finance_vendor_invoice: {
    vendor: [
      "✅ *INVOICE ANDA DITERIMA*",
      "━━━━━━━━━━━━━━━━━━",
      "Kepada Yth. *{{vendorName}}*,",
      "",
      "Invoice Anda telah kami terima dan sedang diproses.",
      "",
      "No. Invoice Vendor : {{vendorInvoiceNumber}}",
      "No. PO             : {{poNumber}}",
      "Nilai Invoice      : *Rp {{invoiceAmount}}*",
      "Tgl Jatuh Tempo    : {{dueDate}}",
      "Status             : {{invoiceStatus}}",
      "",
      "Pembayaran akan diproses sesuai term yang telah disepakati.",
      "📝 Catatan: {{notes}}",
      "",
      "Terima kasih 🙏",
      "_B2B Marketplace and Logistic_",
    ].join("\n"),

    admin_personal: [
      "📥 *VENDOR INVOICE MASUK — {{vendorInvoiceNumber}}*",
      "━━━━━━━━━━━━━━━━━━",
      "Vendor      : *{{vendorName}}*",
      "No. Invoice : {{vendorInvoiceNumber}}",
      "No. PO      : {{poNumber}}",
      "Nilai       : *Rp {{invoiceAmount}}*",
      "Jatuh Tempo : {{dueDate}}",
      "Status      : {{invoiceStatus}}",
      "━━━━━━━━━━━━━━━━━━",
      "🔗 Review & Approve:",
      "{{approveLink}}",
      "_{{timestamp}}_",
    ].join("\n"),
  },

  finance_payment_reminder: {
    customer: [
      "⏰ *PENGINGAT PEMBAYARAN — CST LOGISTICS*",
      "━━━━━━━━━━━━━━━━━━",
      "Halo *{{customerName}}*,",
      "",
      "Kami mengingatkan bahwa tagihan berikut segera jatuh tempo:",
      "",
      "No. Invoice   : *{{invoiceNumber}}*",
      "Jatuh Tempo   : *{{dueDate}}*",
      "Total Tagihan : *Rp {{totalAmount}}*",
      "Sisa Hari     : {{daysUntilDue}} hari",
      "",
      "Mohon segera lakukan pembayaran untuk menghindari denda keterlambatan.",
      "",
      "🔗 Bayar Sekarang:",
      "{{paymentLink}}",
      "",
      "🏦 Transfer ke:",
      "{{bankAccount}}",
      "",
      "Terima kasih 🙏",
      "_B2B Marketplace and Logistic_",
    ].join("\n"),

    admin_personal: [
      "⏰ *REMINDER PEMBAYARAN DIKIRIM*",
      "Customer: *{{customerName}}*",
      "Invoice: {{invoiceNumber}} | Jatuh Tempo: {{dueDate}}",
      "Total: *Rp {{totalAmount}}* | Sisa: {{daysUntilDue}} hari",
      "_{{timestamp}}_",
    ].join("\n"),
  },

  finance_payment_confirmation: {
    customer: [
      "✅ *PEMBAYARAN DITERIMA — CST LOGISTICS*",
      "━━━━━━━━━━━━━━━━━━",
      "Halo *{{customerName}}*,",
      "",
      "Terima kasih! Pembayaran Anda telah kami terima.",
      "",
      "No. Order     : {{orderNumber}}",
      "No. Invoice   : {{invoiceNumber}}",
      "Ref. Bayar    : *{{paymentRef}}*",
      "Jumlah Bayar  : *Rp {{paidAmount}}*",
      "Tgl Bayar     : {{tanggal}}",
      "Metode        : {{paymentMethod}}",
      "Status        : {{paymentStatus}}",
      "Sisa Tagihan  : {{remainingBalance}}",
      "",
      "Terima kasih atas kepercayaan Anda 🙏",
      "_B2B Marketplace and Logistic_",
    ].join("\n"),

    vendor: [
      "💳 *PEMBAYARAN DIPROSES — CST LOGISTICS*",
      "━━━━━━━━━━━━━━━━━━",
      "Kepada Yth. *{{vendorName}}*,",
      "",
      "Pembayaran untuk invoice Anda sedang kami proses.",
      "",
      "No. Invoice   : {{vendorInvoiceNumber}}",
      "Jumlah Bayar  : *Rp {{paidAmount}}*",
      "Tgl Proses    : {{tanggal}}",
      "Ref. Transfer : {{paymentRef}}",
      "Metode        : {{paymentMethod}}",
      "",
      "Mohon konfirmasi setelah dana diterima.",
      "",
      "Terima kasih 🙏",
      "_B2B Marketplace and Logistic_",
    ].join("\n"),

    admin_personal: [
      "💳 *PAYMENT CONFIRMED — {{invoiceNumber}}*",
      "Customer: *{{payeeName}}*",
      "Order: {{orderNumber}}",
      "Bayar: *Rp {{paidAmount}}* | Ref: {{paymentRef}}",
      "Status: {{paymentStatus}}",
      "Sisa: {{remainingBalance}}",
      "_{{timestamp}}_",
    ].join("\n"),
  },

  finance_outstanding_alert: {
    admin_group: [
      "💸 *ALERT: PIUTANG JATUH TEMPO*",
      "━━━━━━━━━━━━━━━━━━",
      "Total Outstanding : *Rp {{totalOutstanding}}*",
      "Jml Invoice       : {{invoiceCount}} invoice",
      "Overdue           : {{overdueCount}} invoice (Rp {{overdueAmount}})",
      "━━━━━━━━━━━━━━━━━━",
      "📋 Detail teratas:",
      "{{outstandingList}}",
      "━━━━━━━━━━━━━━━━━━",
      "🔗 Laporan Piutang:",
      "{{reportLink}}",
      "_{{timestamp}}_",
    ].join("\n"),

    admin_personal: [
      "💸 *OUTSTANDING ALERT — {{customerName}}*",
      "Customer      : *{{customerName}}*",
      "Total Unpaid  : *Rp {{totalOutstanding}}*",
      "Overdue Sejak : {{oldestDueDate}}",
      "Jml Invoice   : {{invoiceCount}}",
      "📝 Tindakan   : {{notes}}",
      "_{{timestamp}}_",
    ].join("\n"),
  },

  // ══════════════════════════════════════════════════════════════════════════
  // DOCUMENT
  // ══════════════════════════════════════════════════════════════════════════

  doc_missing: {
    customer: [
      "📁 *DOKUMEN DIPERLUKAN — {{orderNumber}}*",
      "━━━━━━━━━━━━━━━━━━",
      "Halo *{{customerName}}*,",
      "",
      "Untuk memproses order *{{orderNumber}}*, kami membutuhkan dokumen berikut:",
      "",
      "{{missingDocs}}",
      "━━━━━━━━━━━━━━━━━━",
      "⏰ Batas Upload    : {{uploadDeadline}}",
      "📝 Catatan Admin   : {{notes}}",
      "",
      "🔗 Upload dokumen di sini:",
      "{{uploadLink}}",
      "",
      "Atau kirim langsung ke email kami: {{adminEmail}}",
      "",
      "Terima kasih 🙏",
      "_B2B Marketplace and Logistic_",
    ].join("\n"),

    vendor: [
      "📁 *DOKUMEN DIPERLUKAN — {{orderNumber}}*",
      "━━━━━━━━━━━━━━━━━━",
      "Kepada Yth. *{{vendorName}}*,",
      "",
      "Untuk kelancaran order *{{orderNumber}}*, mohon lengkapi dokumen berikut:",
      "",
      "{{missingDocs}}",
      "━━━━━━━━━━━━━━━━━━",
      "⏰ Batas Upload    : {{uploadDeadline}}",
      "📝 Catatan         : {{notes}}",
      "",
      "🔗 Upload dokumen:",
      "{{uploadLink}}",
      "",
      "Terima kasih 🙏",
      "_B2B Marketplace and Logistic_",
    ].join("\n"),

    admin_personal: [
      "📁 *DOC MISSING ALERT — {{orderNumber}}*",
      "Order: {{orderNumber}} | Customer/Vendor: *{{partyName}}*",
      "Dokumen Kurang:",
      "{{missingDocs}}",
      "Batas: {{uploadDeadline}}",
      "_{{timestamp}}_",
    ].join("\n"),
  },

  doc_approved: {
    customer: [
      "✅ *DOKUMEN DISETUJUI — {{orderNumber}}*",
      "━━━━━━━━━━━━━━━━━━",
      "Halo *{{customerName}}*,",
      "",
      "Dokumen untuk order *{{orderNumber}}* telah diverifikasi dan disetujui.",
      "",
      "📄 Dokumen   : {{documentName}}",
      "✅ Disetujui : {{approvedBy}}",
      "📅 Tgl       : {{tanggal}}",
      "📝 Catatan   : {{notes}}",
      "",
      "Proses order Anda akan dilanjutkan.",
      "",
      "Terima kasih 🙏",
      "_B2B Marketplace and Logistic_",
    ].join("\n"),

    vendor: [
      "✅ *DOKUMEN DISETUJUI — {{orderNumber}}*",
      "Kepada Yth. *{{vendorName}}*,",
      "",
      "Dokumen *{{documentName}}* untuk order *{{orderNumber}}* telah kami setujui.",
      "",
      "📅 Disetujui : {{tanggal}}",
      "📝 Catatan   : {{notes}}",
      "",
      "Terima kasih 🙏",
      "_B2B Marketplace and Logistic_",
    ].join("\n"),

    admin_personal: [
      "✅ *DOC APPROVED — {{orderNumber}}*",
      "Dokumen: {{documentName}} | Order: {{orderNumber}}",
      "Disetujui oleh: {{approvedBy}} | Tgl: {{tanggal}}",
      "_{{timestamp}}_",
    ].join("\n"),
  },

  doc_customs_released: {
    customer: [
      "🏛️ *CUSTOMS RELEASED — {{orderNumber}}*",
      "━━━━━━━━━━━━━━━━━━",
      "Halo *{{customerName}}*,",
      "",
      "Barang Anda telah *RELEASE dari Bea Cukai* 🎉",
      "",
      "No. Order     : *{{orderNumber}}*",
      "No. Aju       : {{ajuNumber}}",
      "SPPB No.      : *{{sppbNumber}}*",
      "BC Type       : {{bcType}}",
      "Tgl Release   : {{tanggal}}",
      "Tgl Estimasi Kirim: {{estimatedDelivery}}",
      "📝 Catatan    : {{notes}}",
      "",
      "Tim kami akan segera mengatur pengiriman ke lokasi Anda.",
      "",
      "Terima kasih 🙏",
      "_B2B Marketplace and Logistic_",
    ].join("\n"),

    admin_personal: [
      "🏛️ *CUSTOMS RELEASED — {{orderNumber}}*",
      "Customer: *{{customerName}}* | SPPB: {{sppbNumber}}",
      "Aju: {{ajuNumber}} | BC Type: {{bcType}}",
      "Tgl Release: {{tanggal}}",
      "_{{timestamp}}_",
    ].join("\n"),
  },

  doc_bl_released: {
    customer: [
      "📃 *BILL OF LADING DITERBITKAN — {{orderNumber}}*",
      "━━━━━━━━━━━━━━━━━━",
      "Halo *{{customerName}}*,",
      "",
      "Bill of Lading untuk order Anda telah diterbitkan.",
      "",
      "No. Order     : *{{orderNumber}}*",
      "BL Number     : *{{blNumber}}*",
      "Vessel        : {{vessel}}",
      "Voyage        : {{voyage}}",
      "Container     : {{containerNumber}}",
      "ETD           : {{etd}}",
      "ETA Dest.     : {{etaDestination}}",
      "━━━━━━━━━━━━━━━━━━",
      "📝 Catatan    : {{notes}}",
      "",
      "🔗 Dokumen BL:",
      "{{blDocumentLink}}",
      "",
      "Terima kasih 🙏",
      "_B2B Marketplace and Logistic_",
    ].join("\n"),

    admin_personal: [
      "📃 *BL RELEASED — {{orderNumber}}*",
      "Customer: *{{customerName}}* | BL: {{blNumber}}",
      "Vessel: {{vessel}} | Container: {{containerNumber}}",
      "ETA Dest: {{etaDestination}}",
      "_{{timestamp}}_",
    ].join("\n"),
  },

  doc_coa_uploaded: {
    customer: [
      "📋 *CERTIFICATE OF ANALYSIS (COA) TERSEDIA*",
      "━━━━━━━━━━━━━━━━━━",
      "Halo *{{customerName}}*,",
      "",
      "CoA untuk order Anda telah tersedia.",
      "",
      "No. Order     : *{{orderNumber}}*",
      "Ref. CoA      : *{{coaRef}}*",
      "Produk        : {{productName}}",
      "Batch/Lot     : {{batchNumber}}",
      "Tgl Upload    : {{tanggal}}",
      "",
      "🔗 Unduh CoA:",
      "{{coaDownloadLink}}",
      "",
      "Terima kasih 🙏",
      "_B2B Marketplace and Logistic_",
    ].join("\n"),

    admin_personal: [
      "📋 *COA UPLOADED — {{orderNumber}}*",
      "Customer: *{{customerName}}* | Ref: {{coaRef}}",
      "Produk: {{productName}} | Batch: {{batchNumber}}",
      "🔗 {{coaDownloadLink}}",
      "_{{timestamp}}_",
    ].join("\n"),
  },

  // ══════════════════════════════════════════════════════════════════════════
  // APPROVAL
  // ══════════════════════════════════════════════════════════════════════════

  approval_waiting: {
    admin_personal: [
      "⏳ *MENUNGGU PERSETUJUAN ANDA*",
      "━━━━━━━━━━━━━━━━━━",
      "Ref. Approval : `{{approvalRef}}`",
      "Jenis         : {{approvalType}}",
      "Diminta Oleh  : {{requestedBy}}",
      "Tanggal       : {{tanggal}}",
      "Prioritas     : {{priority}}",
      "━━━━━━━━━━━━━━━━━━",
      "📋 *Detail:*",
      "{{approvalDetail}}",
      "━━━━━━━━━━━━━━━━━━",
      "💰 Nilai      : Rp {{amount}}",
      "📝 Catatan    : {{notes}}",
      "━━━━━━━━━━━━━━━━━━",
      "✅ Setujui:",
      "{{approveLink}}",
      "",
      "❌ Tolak:",
      "{{rejectLink}}",
      "",
      "_Dikirim: {{timestamp}}_",
    ].join("\n"),

    admin_group: [
      "⏳ *[APPROVAL PENDING] {{approvalRef}}*",
      "Jenis: {{approvalType}} | By: {{requestedBy}}",
      "Nilai: *Rp {{amount}}* | Prioritas: {{priority}}",
      "✅ {{approveLink}}",
      "_{{timestamp}}_",
    ].join("\n"),
  },

  approval_approved: {
    admin_personal: [
      "✅ *DISETUJUI — {{approvalRef}}*",
      "Jenis: {{approvalType}}",
      "Disetujui oleh: *{{approvedBy}}*",
      "Tgl: {{tanggal}} | Nilai: Rp {{amount}}",
      "Catatan: {{notes}}",
      "_{{timestamp}}_",
    ].join("\n"),

    customer: [
      "✅ *PERMINTAAN ANDA DISETUJUI*",
      "━━━━━━━━━━━━━━━━━━",
      "Halo *{{customerName}}*,",
      "",
      "Permintaan Anda telah *DISETUJUI* ✅",
      "",
      "Ref.          : {{approvalRef}}",
      "Jenis         : {{approvalType}}",
      "Disetujui oleh: {{approvedBy}}",
      "Tgl           : {{tanggal}}",
      "Catatan       : {{notes}}",
      "",
      "Tim kami akan segera menindaklanjuti.",
      "",
      "Terima kasih 🙏",
      "_B2B Marketplace and Logistic_",
    ].join("\n"),

    vendor: [
      "✅ *PENAWARAN ANDA DISETUJUI*",
      "━━━━━━━━━━━━━━━━━━",
      "Kepada Yth. *{{vendorName}}*,",
      "",
      "Penawaran Anda untuk *{{approvalRef}}* telah *DISETUJUI* ✅",
      "",
      "Jenis     : {{approvalType}}",
      "Nilai     : Rp {{amount}}",
      "Tgl       : {{tanggal}}",
      "Catatan   : {{notes}}",
      "",
      "Tim kami akan segera menghubungi Anda untuk langkah berikutnya.",
      "",
      "Terima kasih 🙏",
      "_B2B Marketplace and Logistic_",
    ].join("\n"),
  },

  approval_rejected: {
    admin_personal: [
      "❌ *DITOLAK — {{approvalRef}}*",
      "Jenis: {{approvalType}}",
      "Ditolak oleh: *{{rejectedBy}}*",
      "Tgl: {{tanggal}} | Alasan: {{rejectionReason}}",
      "_{{timestamp}}_",
    ].join("\n"),

    customer: [
      "❌ *PERMINTAAN TIDAK DAPAT DIPROSES*",
      "━━━━━━━━━━━━━━━━━━",
      "Halo *{{customerName}}*,",
      "",
      "Mohon maaf, permintaan Anda *tidak dapat disetujui*.",
      "",
      "Ref.          : {{approvalRef}}",
      "Jenis         : {{approvalType}}",
      "Tgl           : {{tanggal}}",
      "Alasan        : {{rejectionReason}}",
      "Catatan       : {{notes}}",
      "",
      "Silakan hubungi kami untuk informasi lebih lanjut.",
      "",
      "Terima kasih 🙏",
      "_B2B Marketplace and Logistic_",
    ].join("\n"),

    vendor: [
      "❌ *PENAWARAN TIDAK DITERIMA*",
      "━━━━━━━━━━━━━━━━━━",
      "Kepada Yth. *{{vendorName}}*,",
      "",
      "Penawaran Anda untuk *{{approvalRef}}* tidak dapat kami terima.",
      "",
      "Alasan    : {{rejectionReason}}",
      "Catatan   : {{notes}}",
      "",
      "Terima kasih atas penawaran Anda.",
      "",
      "_B2B Marketplace and Logistic_",
    ].join("\n"),
  },

  approval_revision_requested: {
    admin_personal: [
      "🔄 *REVISI DIMINTA — {{approvalRef}}*",
      "Jenis: {{approvalType}} | By: *{{requestedBy}}*",
      "Catatan Revisi:",
      "{{revisionNotes}}",
      "🔗 {{revisionLink}}",
      "_{{timestamp}}_",
    ].join("\n"),

    customer: [
      "🔄 *REVISI DIPERLUKAN — {{approvalRef}}*",
      "━━━━━━━━━━━━━━━━━━",
      "Halo *{{customerName}}*,",
      "",
      "Permintaan Anda memerlukan *revisi* sebelum dapat diproses.",
      "",
      "Ref.          : {{approvalRef}}",
      "Jenis         : {{approvalType}}",
      "Catatan Revisi:",
      "{{revisionNotes}}",
      "━━━━━━━━━━━━━━━━━━",
      "🔗 Lakukan Revisi:",
      "{{revisionLink}}",
      "",
      "Terima kasih 🙏",
      "_B2B Marketplace and Logistic_",
    ].join("\n"),

    vendor: [
      "🔄 *REVISI PENAWARAN — {{approvalRef}}*",
      "━━━━━━━━━━━━━━━━━━",
      "Kepada Yth. *{{vendorName}}*,",
      "",
      "Penawaran Anda untuk *{{approvalRef}}* memerlukan revisi:",
      "",
      "{{revisionNotes}}",
      "━━━━━━━━━━━━━━━━━━",
      "🔗 Update Penawaran:",
      "{{revisionLink}}",
      "",
      "Terima kasih 🙏",
      "_B2B Marketplace and Logistic_",
    ].join("\n"),
  },

  // ══════════════════════════════════════════════════════════════════════════
  // OPERATIONS
  // ══════════════════════════════════════════════════════════════════════════

  ops_shipment_delayed: {
    customer: [
      "⚠️ *INFORMASI KETERLAMBATAN PENGIRIMAN*",
      "━━━━━━━━━━━━━━━━━━",
      "Halo *{{customerName}}*,",
      "",
      "Kami mohon maaf menginformasikan bahwa terdapat *keterlambatan* pada pengiriman Anda.",
      "",
      "No. Order     : *{{orderNumber}}*",
      "Rute          : {{route}}",
      "ETA Awal      : {{originalEta}}",
      "ETA Baru      : *{{newEta}}*",
      "Penyebab      : {{delayReason}}",
      "",
      "Tim kami sedang bekerja semaksimal mungkin untuk memastikan pengiriman segera.",
      "",
      "📞 Pertanyaan: {{contactNumber}}",
      "",
      "Terima kasih atas pengertian Anda 🙏",
      "_B2B Marketplace and Logistic_",
    ].join("\n"),

    admin_group: [
      "⚠️ *[DELAY] {{orderNumber}}*",
      "Customer: *{{customerName}}* | Rute: {{route}}",
      "ETA Baru: *{{newEta}}* | Alasan: {{delayReason}}",
      "Notifikasi customer: {{notifiedCustomer}}",
      "_{{timestamp}}_",
    ].join("\n"),

    admin_personal: [
      "⚠️ *SHIPMENT DELAYED — {{orderNumber}}*",
      "━━━━━━━━━━━━━━━━━━",
      "No. Order     : {{orderNumber}}",
      "Customer      : *{{customerName}}*",
      "Rute          : {{route}}",
      "ETA Awal      : {{originalEta}}",
      "ETA Baru      : *{{newEta}}*",
      "Keterlambatan : {{delayHours}} jam",
      "Alasan        : {{delayReason}}",
      "Vendor/Driver : {{vendorName}}",
      "━━━━━━━━━━━━━━━━━━",
      "📝 Tindakan   : {{actionTaken}}",
      "🔗 Update Order:",
      "{{orderLink}}",
      "_{{timestamp}}_",
    ].join("\n"),
  },

  ops_truck_arrived: {
    customer: [
      "🚛 *ARMADA SUDAH TIBA — {{orderNumber}}*",
      "━━━━━━━━━━━━━━━━━━",
      "Halo *{{customerName}}*,",
      "",
      "Armada untuk order Anda telah tiba di lokasi.",
      "",
      "No. Order     : *{{orderNumber}}*",
      "Tiba Pukul    : *{{arrivalTime}}*",
      "Lokasi        : {{location}}",
      "Driver        : {{driverName}}",
      "No. HP Driver : {{driverPhone}}",
      "No. Plat      : {{plateNumber}}",
      "Jenis Kend.   : {{vehicleType}}",
      "",
      "Mohon bersiap untuk proses muat/bongkar.",
      "",
      "Terima kasih 🙏",
      "_B2B Marketplace and Logistic_",
    ].join("\n"),

    admin_personal: [
      "🚛 *TRUCK ARRIVED — {{orderNumber}}*",
      "Customer: *{{customerName}}* | Lokasi: {{location}}",
      "Driver: {{driverName}} | Plat: {{plateNumber}}",
      "Tiba: {{arrivalTime}}",
      "_{{timestamp}}_",
    ].join("\n"),
  },

  ops_driver_checkin: {
    admin_personal: [
      "📍 *DRIVER CHECK-IN — {{orderNumber}}*",
      "━━━━━━━━━━━━━━━━━━",
      "No. Order     : {{orderNumber}}",
      "Driver        : *{{driverName}}*",
      "No. HP        : {{driverPhone}}",
      "No. Plat      : {{plateNumber}}",
      "Tgl Check-in  : {{tanggal}}",
      "Jam Check-in  : {{checkinTime}}",
      "Lokasi        : {{location}}",
      "Koordinat     : {{coordinates}}",
      "Status        : {{checkinStatus}}",
      "━━━━━━━━━━━━━━━━━━",
      "📝 Catatan Driver : {{driverNotes}}",
      "🔗 Lihat Order    : {{orderLink}}",
      "_{{timestamp}}_",
    ].join("\n"),

    admin_group: [
      "📍 *[CHECK-IN] {{driverName}}*",
      "Order: {{orderNumber}} | Plat: {{plateNumber}}",
      "Lokasi: {{location}} | Jam: {{checkinTime}}",
      "_{{timestamp}}_",
    ].join("\n"),
  },

  ops_warehouse_ready: {
    customer: [
      "🏭 *BARANG SIAP DI GUDANG — {{orderNumber}}*",
      "━━━━━━━━━━━━━━━━━━",
      "Halo *{{customerName}}*,",
      "",
      "Barang Anda telah siap di gudang kami.",
      "",
      "No. Order     : *{{orderNumber}}*",
      "Lokasi Gudang : *{{warehouseCode}}*",
      "Alamat        : {{warehouseAddress}}",
      "Siap Pukul    : {{readyTime}}",
      "Tgl           : {{tanggal}}",
      "📦 Keterangan : {{warehouseNotes}}",
      "",
      "Silakan koordinasikan waktu pengambilan/pengiriman.",
      "",
      "📞 Kontak Gudang: {{warehouseContact}}",
      "",
      "Terima kasih 🙏",
      "_B2B Marketplace and Logistic_",
    ].join("\n"),

    admin_personal: [
      "🏭 *WAREHOUSE READY — {{orderNumber}}*",
      "Customer: *{{customerName}}* | Gudang: {{warehouseCode}}",
      "Siap: {{readyTime}} | Tgl: {{tanggal}}",
      "{{warehouseNotes}}",
      "_{{timestamp}}_",
    ].join("\n"),
  },

  // ══════════════════════════════════════════════════════════════════════════
  // SYSTEM
  // ══════════════════════════════════════════════════════════════════════════

  sys_template_updated: {
    admin_personal: [
      "⚙️ *TEMPLATE WA DIPERBARUI*",
      "━━━━━━━━━━━━━━━━━━",
      "Template      : *{{templateName}}*",
      "Recipient     : {{recipientRole}}",
      "Workflow Key  : {{workflowKey}}",
      "Diubah oleh   : {{updatedBy}}",
      "Tgl           : {{tanggal}}",
      "━━━━━━━━━━━━━━━━━━",
      "Preview template baru:",
      "{{templatePreview}}",
      "",
      "🔗 Kelola Template:",
      "{{templateLink}}",
      "_{{timestamp}}_",
    ].join("\n"),
  },

  sys_required_field_missing: {
    admin_personal: [
      "⚠️ *FIELD WAJIB KOSONG — {{entityRef}}*",
      "Entity     : {{entityType}} | Ref: {{entityRef}}",
      "Field Kosong:",
      "{{missingFields}}",
      "Tindakan   : {{requiredAction}}",
      "🔗 {{editLink}}",
      "_{{timestamp}}_",
    ].join("\n"),

    admin_group: [
      "⚠️ *[FIELD MISSING] {{entityType}} {{entityRef}}*",
      "Field: {{missingFields}}",
      "🔗 {{editLink}}",
      "_{{timestamp}}_",
    ].join("\n"),
  },

  sys_required_doc_missing: {
    admin_personal: [
      "📁 *DOKUMEN WAJIB BELUM DILENGKAPI*",
      "Entity     : {{entityType}} | Ref: {{entityRef}}",
      "Customer   : {{customerName}}",
      "Dokumen Kurang:",
      "{{missingDocs}}",
      "Batas      : {{uploadDeadline}}",
      "🔗 Tindak Lanjut: {{actionLink}}",
      "_{{timestamp}}_",
    ].join("\n"),

    customer: [
      "📁 *DOKUMEN WAJIB BELUM LENGKAP*",
      "━━━━━━━━━━━━━━━━━━",
      "Halo *{{customerName}}*,",
      "",
      "Order *{{entityRef}}* Anda memerlukan dokumen berikut:",
      "",
      "{{missingDocs}}",
      "━━━━━━━━━━━━━━━━━━",
      "⏰ Batas Upload : {{uploadDeadline}}",
      "",
      "🔗 Upload dokumen:",
      "{{uploadLink}}",
      "",
      "Segera lengkapi agar proses order tidak terhambat 🙏",
      "_B2B Marketplace and Logistic_",
    ].join("\n"),
  },

} as const;

// ─────────────────────────────────────────────────────────────────────────────
// BUILD FLAT PAIR LIST
// ─────────────────────────────────────────────────────────────────────────────

type DeepRecord = Record<string, Record<string, string>>;

/** Flatten DEFAULT_ENTERPRISE_TPL into [recipient, workflow, body] tuples */
function buildEnterpriseTemplatePairs(): Array<{ recipient: string; workflow: string; body: string }> {
  const result: Array<{ recipient: string; workflow: string; body: string }> = [];
  const tpl = DEFAULT_ENTERPRISE_TPL as DeepRecord;
  for (const [workflowKey, recipientMap] of Object.entries(tpl)) {
    for (const [recipient, body] of Object.entries(recipientMap)) {
      result.push({ recipient, workflow: workflowKey, body });
    }
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// MIGRATION / SEEDER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Seeds all enterprise workflow templates into wa_template_configs.
 * - Inserts missing (recipient × workflow) pairs with their default body.
 * - Does NOT overwrite existing customised templates (only adds new ones).
 * - Safe to re-run on every boot (idempotent).
 */
export async function runEnterpriseWorkflowMigration(): Promise<void> {
  try {
    // Ensure base table exists (defensive — runWaTemplateMigration also creates it)
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS whatsapp_template_configs (
        id         SERIAL PRIMARY KEY,
        recipient  TEXT NOT NULL,
        workflow   TEXT NOT NULL,
        body       TEXT NOT NULL DEFAULT '',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_wa_tpl_cfg UNIQUE (recipient, workflow)
      )
    `);

    const pairs = buildEnterpriseTemplatePairs();

    // Load all existing rows once
    const existingRows = await db.select().from(waTemplateConfigsTable);
    const existingKeys = new Set(existingRows.map(r => `${r.recipient}__${r.workflow}`));

    let seeded = 0;
    let repaired = 0;
    for (const { recipient, workflow, body } of pairs) {
      const key = `${recipient}__${workflow}`;
      if (!existingKeys.has(key)) {
        await db.insert(waTemplateConfigsTable).values({ recipient, workflow, body });
        seeded++;
        logger.info({ recipient, workflow }, "Enterprise WA template: seeded");
      } else {
        // Repair existing rows that have empty body
        const existingRow = existingRows.find(r => r.recipient === recipient && r.workflow === workflow);
        if (existingRow && (!existingRow.body || existingRow.body.trim() === "")) {
          await db
            .update(waTemplateConfigsTable)
            .set({ body, updatedAt: new Date() })
            .where(
              and(
                eq(waTemplateConfigsTable.recipient, recipient),
                eq(waTemplateConfigsTable.workflow, workflow),
              )
            );
          repaired++;
          logger.info({ recipient, workflow }, "Enterprise WA template: repaired (was empty)");
        }
      }
    }

    invalidateWaTemplateCache();
    logger.info(
      { total: pairs.length, seeded, repaired, alreadyExisted: pairs.length - seeded },
      "Enterprise workflow migration: done"
    );
  } catch (err) {
    logger.warn({ err }, "Enterprise workflow migration failed (non-fatal)");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// HELPER — fetch a specific enterprise template (with fallback)
// ─────────────────────────────────────────────────────────────────────────────

/** Get the body for a given (recipient × workflow) enterprise template from DB,
 *  falling back to the hard-coded default. */
export async function getEnterpriseTemplate(
  recipient: string,
  workflow: keyof typeof DEFAULT_ENTERPRISE_TPL,
): Promise<string | null> {
  try {
    const tpl = DEFAULT_ENTERPRISE_TPL as DeepRecord;
    const defaultBody = tpl[workflow]?.[recipient] ?? null;

    const rows = await db
      .select()
      .from(waTemplateConfigsTable)
      .where(
        and(
          eq(waTemplateConfigsTable.recipient, recipient),
          eq(waTemplateConfigsTable.workflow, workflow as string),
        )
      )
      .limit(1);

    return rows[0]?.body ?? defaultBody;
  } catch {
    return null;
  }
}
