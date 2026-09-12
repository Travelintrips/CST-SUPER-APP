import { registerHeartbeat, beat } from "./workerHeartbeat.js";

/**
 * Workflow Worker — Phase 1 L1 Reminders
 *
 * Polls every 5 minutes and executes time-based automation:
 *
 *  TASK 1 — Vendor RFQ no-response (T+warningHours):  WA digest to admin group
 *  TASK 2 — Vendor RFQ no-response (T+criticalHours): Escalate + create intelligence_alert (critical)
 *  TASK 3 — Customer quote reminder (T+3d):   WA reminder to customer
 *  TASK 4 — Customer quote expire  (T+7d or validUntil past): mark expired + alert admin
 *  TASK 5 — Late order (ETA breach): create intelligence_alert (critical)
 *  TASK 6 — Invoice overdue (dueDate passed, not paid): mark overdue, send WA+Email reminder
 *  TASK 7 — Purchase bill overdue (dueDate passed, not paid): mark overdue, send WA+Email reminder
 */

import {
  db,
  logisticOrderRfqsTable,
  logisticOrderQuotesTable,
  logisticOrdersTable,
  customerQuoteLinksTable,
  intelligenceAlertsTable,
  intelligenceAlertSettingsTable,
  salesDocumentsTable,
  purchaseDocumentsTable,
  vendorInvoicesTable,
  customersTable,
  suppliersTable,
} from "@workspace/db";
import { and, eq, lt, lte, notInArray, inArray, ne, isNull, isNotNull } from "drizzle-orm";
import { sendViaService as sendWhatsApp } from "./waTransport.js";
import { getAdminGroupWa } from "./adminWa.js";
import { wasRecentlyNotified } from "./notificationLog.js";
import { logger } from "./logger.js";
import { broadcastNewAlert } from "./alertsBroadcast.js";
import { sendMail, isSmtpConfigured } from "./mailer.js";
import { notifyPaymentReminder } from "./enterpriseWorkflowNotify.js";
import { markPaymentOverdue } from "./services/index.js";
import { createExceptionIdempotent } from "./services/exceptionService.js";
import { runInvoiceReminders, initInvoiceReminderTable } from "./invoiceReminderWorker.js";

const POLL_INTERVAL_MS = 5 * 60 * 1000;  // 5 minutes
const INITIAL_DELAY_MS = 3 * 60 * 1000;  // 3 min after boot

const DEDUP_23H = 23 * 60 * 60 * 1000;

// ── Settings cache (refresh every poll) ───────────────────────────────────────

interface AlertSettings {
  masterEnabled: boolean;
  rfqAlertEnabled: boolean;
  rfqWarningHours: number;
  rfqCriticalHours: number;
  marginAlertEnabled: boolean;
  marginMinPct: number;
  etaAlertEnabled: boolean;
  quoteExpiredAlertEnabled: boolean;
  invoiceReminderEnabled: boolean;
  alertWindowStart: string; // "HH:MM"
  alertWindowEnd: string;   // "HH:MM"
}

const DEFAULT_SETTINGS: AlertSettings = {
  masterEnabled: true,
  rfqAlertEnabled: true,
  rfqWarningHours: 24,
  rfqCriticalHours: 48,
  marginAlertEnabled: true,
  marginMinPct: 5,
  etaAlertEnabled: true,
  quoteExpiredAlertEnabled: true,
  invoiceReminderEnabled: true,
  alertWindowStart: "00:00",
  alertWindowEnd: "23:59",
};

async function loadSettings(): Promise<AlertSettings> {
  try {
    const rows = await db
      .select()
      .from(intelligenceAlertSettingsTable)
      .where(isNull(intelligenceAlertSettingsTable.companyId))
      .limit(1);

    if (rows.length === 0) return DEFAULT_SETTINGS;
    const r = rows[0]!;
    return {
      masterEnabled: r.masterEnabled,
      rfqAlertEnabled: r.rfqAlertEnabled,
      rfqWarningHours: r.rfqWarningHours,
      rfqCriticalHours: r.rfqCriticalHours,
      marginAlertEnabled: r.marginAlertEnabled,
      marginMinPct: parseFloat(String(r.marginMinPct ?? "5")),
      etaAlertEnabled: r.etaAlertEnabled,
      quoteExpiredAlertEnabled: r.quoteExpiredAlertEnabled,
      invoiceReminderEnabled: r.invoiceReminderEnabled ?? true,
      alertWindowStart: r.alertWindowStart,
      alertWindowEnd: r.alertWindowEnd,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/** Returns true if current WIB time is within the configured alert window */
function isWithinAlertWindow(settings: AlertSettings): boolean {
  const now = new Date();
  // Use server local time (assumes server is in WIB or UTC — compare HH:MM string)
  const hh = now.getHours().toString().padStart(2, "0");
  const mm = now.getMinutes().toString().padStart(2, "0");
  const current = `${hh}:${mm}`;
  return current >= settings.alertWindowStart && current <= settings.alertWindowEnd;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

async function waAlreadySent(context: string, refId: string): Promise<boolean> {
  return wasRecentlyNotified(context, refId, DEDUP_23H);
}

async function createAlert(data: {
  companyId?: number | null;
  alertType: string;
  entityType: string;
  entityId?: number | null;
  entityRef?: string;
  severity: "info" | "warning" | "critical";
  title: string;
  message: string;
  contextJson?: Record<string, unknown>;
}): Promise<void> {
  // Prevent duplicate open alerts for same type+entity
  const existing = await db
    .select({ id: intelligenceAlertsTable.id })
    .from(intelligenceAlertsTable)
    .where(
      and(
        eq(intelligenceAlertsTable.alertType, data.alertType),
        eq(intelligenceAlertsTable.entityType, data.entityType),
        data.entityId != null
          ? eq(intelligenceAlertsTable.entityId, data.entityId)
          : isNull(intelligenceAlertsTable.entityId),
        eq(intelligenceAlertsTable.status, "open"),
      )
    )
    .limit(1);

  if (existing.length > 0) return;

  const inserted = await db.insert(intelligenceAlertsTable).values({
    companyId: data.companyId ?? null,
    alertType: data.alertType,
    entityType: data.entityType,
    entityId: data.entityId ?? null,
    entityRef: data.entityRef,
    severity: data.severity,
    title: data.title,
    message: data.message,
    contextJson: data.contextJson ?? {},
  }).returning();

  if (inserted[0]) {
    broadcastNewAlert({
      id: inserted[0].id,
      alertType: inserted[0].alertType,
      entityType: inserted[0].entityType,
      entityId: inserted[0].entityId,
      entityRef: inserted[0].entityRef,
      severity: inserted[0].severity as "critical" | "warning" | "info",
      title: inserted[0].title,
      message: inserted[0].message,
      createdAt: (inserted[0].createdAt ?? new Date()).toISOString(),
    });
  }
}

// ── TASK 1 & 2: Vendor RFQ no-response ───────────────────────────────────────

async function checkVendorRfqNoResponse(settings: AlertSettings): Promise<void> {
  if (!settings.rfqAlertEnabled) return;

  const now = new Date();
  const hWarn = new Date(now.getTime() - settings.rfqWarningHours * 60 * 60 * 1000);
  const hCrit = new Date(now.getTime() - settings.rfqCriticalHours * 60 * 60 * 1000);

  // RFQs older than warning threshold that are still open
  const staleRfqs = await db
    .select({
      id: logisticOrderRfqsTable.id,
      rfqNumber: logisticOrderRfqsTable.rfqNumber,
      orderId: logisticOrderRfqsTable.orderId,
      createdAt: logisticOrderRfqsTable.createdAt,
      companyId: logisticOrdersTable.companyId,
      orderNumber: logisticOrdersTable.orderNumber,
    })
    .from(logisticOrderRfqsTable)
    .innerJoin(logisticOrdersTable, eq(logisticOrderRfqsTable.orderId, logisticOrdersTable.id))
    .where(
      and(
        lte(logisticOrderRfqsTable.createdAt, hWarn),
        notInArray(logisticOrderRfqsTable.status, ["closed", "completed", "cancelled"]),
      )
    );

  if (staleRfqs.length === 0) return;

  // Find which ones have zero vendor quotes
  const rfqIds = staleRfqs.map(r => r.id);
  const quotedRfqIds = (
    await db
      .selectDistinct({ rfqId: logisticOrderQuotesTable.rfqId })
      .from(logisticOrderQuotesTable)
      .where(
        and(
          inArray(logisticOrderQuotesTable.rfqId, rfqIds),
          ne(logisticOrderQuotesTable.quoteStatus, "cancelled"),
        )
      )
  ).map(r => r.rfqId);

  const noResponseRfqs = staleRfqs.filter(r => !quotedRfqIds.includes(r.id));
  if (noResponseRfqs.length === 0) return;

  const adminGroupWa = await getAdminGroupWa();

  for (const rfq of noResponseRfqs) {
    const isOverCritical = rfq.createdAt <= hCrit;
    const context = isOverCritical
      ? `rfq_no_response_${settings.rfqCriticalHours}h`
      : `rfq_no_response_${settings.rfqWarningHours}h`;
    const refId = rfq.rfqNumber;

    if (await waAlreadySent(context, refId)) continue;

    const hours = Math.floor((now.getTime() - rfq.createdAt.getTime()) / 3_600_000);

    if (isOverCritical) {
      // TASK 2: Escalation alert
      await createAlert({
        companyId: rfq.companyId,
        alertType: "rfq_no_response",
        entityType: "rfq",
        entityId: rfq.id,
        entityRef: rfq.rfqNumber,
        severity: "critical",
        title: `RFQ ${rfq.rfqNumber} — Tidak Ada Response Vendor (${hours}j)`,
        message: `Order ${rfq.orderNumber}: RFQ sudah ${hours} jam belum ada vendor yang submit quote. Perlu tindakan segera.`,
        contextJson: { rfqNumber: rfq.rfqNumber, orderNumber: rfq.orderNumber, hoursElapsed: hours },
      });

      if (adminGroupWa && isWithinAlertWindow(settings)) {
        const msg =
          `🚨 *ESKALASI RFQ — Tidak Ada Response*\n\n` +
          `RFQ: *${rfq.rfqNumber}*\n` +
          `Order: ${rfq.orderNumber}\n` +
          `Sudah: *${hours} jam* tanpa response vendor\n\n` +
          `Harap segera follow-up vendor atau blast ulang RFQ di BizPortal.`;
        await sendWhatsApp(adminGroupWa, msg, { context, refType: "rfq", refId });
      }
    } else {
      // TASK 1: Warning reminder to admin group
      if (adminGroupWa && isWithinAlertWindow(settings)) {
        const msg =
          `⏰ *Reminder RFQ — Belum Ada Response*\n\n` +
          `RFQ: *${rfq.rfqNumber}*\n` +
          `Order: ${rfq.orderNumber}\n` +
          `Sudah: ${hours} jam tanpa response vendor\n\n` +
          `Cek BizPortal › Logistik › RFQ untuk detail.`;
        await sendWhatsApp(adminGroupWa, msg, { context, refType: "rfq", refId });
      }
    }
  }
}

// ── TASK 3 & 4: Customer quote reminder & expiry ──────────────────────────────

async function checkCustomerQuoteReminders(settings: AlertSettings): Promise<void> {
  if (!settings.quoteExpiredAlertEnabled) return;

  const now = new Date();
  const d3 = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);
  const d7 = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const pendingQuotes = await db
    .select({
      id: customerQuoteLinksTable.id,
      token: customerQuoteLinksTable.token,
      sentAt: customerQuoteLinksTable.sentAt,
      validUntil: customerQuoteLinksTable.validUntil,
      orderId: customerQuoteLinksTable.orderId,
      orderNumber: logisticOrdersTable.orderNumber,
      customerName: logisticOrdersTable.customerName,
      phone: logisticOrdersTable.phone,
      companyId: logisticOrdersTable.companyId,
    })
    .from(customerQuoteLinksTable)
    .innerJoin(logisticOrdersTable, eq(customerQuoteLinksTable.orderId, logisticOrdersTable.id))
    .where(eq(customerQuoteLinksTable.status, "pending"));

  const adminGroupWa = await getAdminGroupWa();

  for (const q of pendingQuotes) {
    const sentAt = q.sentAt ? new Date(q.sentAt) : null;
    if (!sentAt) continue;

    const isExpiredByTime = sentAt <= d7;
    const isExpiredByDate = q.validUntil && new Date(q.validUntil) < now;
    const shouldExpire = isExpiredByTime || isExpiredByDate;
    const isOver3d = sentAt <= d3;

    if (shouldExpire) {
      // TASK 4: Mark expired
      await db
        .update(customerQuoteLinksTable)
        .set({ status: "expired" })
        .where(eq(customerQuoteLinksTable.id, q.id));

      await createAlert({
        companyId: q.companyId,
        alertType: "quote_expired",
        entityType: "customer_quote",
        entityId: q.id,
        entityRef: q.orderNumber,
        severity: "warning",
        title: `Quote Expired — ${q.orderNumber}`,
        message: `Quotation untuk order ${q.orderNumber} (${q.customerName}) telah expired tanpa konfirmasi customer. Perlu tindak lanjut.`,
        contextJson: { orderNumber: q.orderNumber, customerName: q.customerName, token: q.token },
      });

      if (adminGroupWa && isWithinAlertWindow(settings)) {
        const msg =
          `⚠️ *Quote Expired*\n\n` +
          `Order: *${q.orderNumber}*\n` +
          `Customer: ${q.customerName}\n` +
          `Status: Expired tanpa konfirmasi\n\n` +
          `Harap hubungi customer atau buat quotation baru.`;
        await sendWhatsApp(adminGroupWa, msg, {
          context: "quote_expired_admin",
          refType: "customer_quote",
          refId: q.token,
        });
      }

    } else if (isOver3d) {
      // TASK 3: T+3d reminder to customer
      const context = "quote_reminder_3d";
      const refId = q.token;
      if (await waAlreadySent(context, refId)) continue;

      const days = Math.floor((now.getTime() - sentAt.getTime()) / 86_400_000);

      if (q.phone && isWithinAlertWindow(settings)) {
        const msg =
          `Halo *${q.customerName}*,\n\n` +
          `Kami ingin mengingatkan bahwa *penawaran harga* untuk order Anda (${q.orderNumber}) masih menunggu konfirmasi Anda.\n\n` +
          `Penawaran telah dikirimkan ${days} hari yang lalu. Mohon segera konfirmasi agar proses dapat dilanjutkan.\n\n` +
          `Terima kasih 🙏`;
        await sendWhatsApp(q.phone, msg, { context, refType: "customer_quote", refId });
      }
    }
  }
}

// ── TASK 6: Sales invoice overdue detection ───────────────────────────────────

async function checkInvoiceOverdue(settings: AlertSettings): Promise<void> {
  const todayStr = new Date().toISOString().split("T")[0]!;

  const overdueInvoices = await db
    .select({
      id: salesDocumentsTable.id,
      docNumber: salesDocumentsTable.docNumber,
      invoiceNumber: salesDocumentsTable.invoiceNumber,
      customerName: salesDocumentsTable.customerName,
      customerId: salesDocumentsTable.customerId,
      grandTotal: salesDocumentsTable.grandTotal,
      totalAmount: salesDocumentsTable.totalAmount,
      dueDate: salesDocumentsTable.dueDate,
      paymentStatus: salesDocumentsTable.paymentStatus,
      companyId: salesDocumentsTable.companyId,
    })
    .from(salesDocumentsTable)
    .where(
      and(
        eq(salesDocumentsTable.invoiceStatus, "invoiced"),
        inArray(salesDocumentsTable.paymentStatus, ["unpaid", "partial", "overdue"]),
        ne(salesDocumentsTable.status, "cancelled"),
        isNotNull(salesDocumentsTable.dueDate),
        lt(salesDocumentsTable.dueDate, todayStr),
      )
    );

  if (overdueInvoices.length === 0) return;

  const adminGroupWa = await getAdminGroupWa();

  for (const doc of overdueInvoices) {
    const invoiceRef = doc.invoiceNumber ?? doc.docNumber;

    // Mark as overdue if not already
    await markPaymentOverdue(doc.id, "sales_order");

    const context = "invoice_overdue_reminder";
    if (await waAlreadySent(context, invoiceRef)) continue;

    const totalAmount = Number(doc.grandTotal ?? doc.totalAmount ?? 0);
    const dueDate = doc.dueDate ? new Date(doc.dueDate) : null;
    const today = new Date();
    const daysOverdue = dueDate ? Math.floor((today.getTime() - dueDate.getTime()) / 86_400_000) : 0;
    const dueDateStr = dueDate
      ? dueDate.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" })
      : "—";

    // Fetch customer contact
    let customerPhone: string | null = null;
    let customerEmail: string | null = null;
    if (doc.customerId != null) {
      const [cust] = await db
        .select({ phone: customersTable.phone, email: customersTable.email })
        .from(customersTable)
        .where(eq(customersTable.id, doc.customerId))
        .limit(1);
      customerPhone = cust?.phone ?? null;
      customerEmail = cust?.email ?? null;
    }

    // WA reminder to customer + admin
    if (isWithinAlertWindow(settings)) {
      // Cari payment link (customer invoice) jika ada
      let paymentLink: string | undefined;
      try {
        const { getPreferredDomain } = await import("./domain.js");
        const { customerInvoiceLinksTable } = await import("@workspace/db");
        const { gt } = await import("drizzle-orm");
        const [invLink] = await db
          .select({ token: customerInvoiceLinksTable.token })
          .from(customerInvoiceLinksTable)
          .where(
            and(
              eq(customerInvoiceLinksTable.salesDocId, doc.id),
              gt(customerInvoiceLinksTable.expiresAt, new Date()),
            ),
          )
          .limit(1);
        if (invLink?.token) {
          const domain = getPreferredDomain();
          paymentLink = domain
            ? `https://${domain}/customer-invoice/${invLink.token}`
            : undefined;
        }
      } catch { /* non-fatal */ }

      await notifyPaymentReminder({
        invoiceNumber: invoiceRef,
        customerName: doc.customerName,
        // Jika invoiceReminderEnabled, customer WA ditangani oleh invoiceReminderWorker
        customerPhone: settings.invoiceReminderEnabled ? undefined : (customerPhone ?? undefined),
        dueDate: dueDateStr,
        totalAmount,
        daysUntilDue: -daysOverdue,
        paymentLink,
      });
    }

    // Email reminder to customer
    if (customerEmail && isSmtpConfigured()) {
      const amountStr = `Rp ${Math.round(totalAmount).toLocaleString("id-ID")}`;
      sendMail({
        to: customerEmail,
        subject: `Pengingat Pembayaran — Invoice ${invoiceRef} (${daysOverdue} hari jatuh tempo)`,
        text: `Kepada Yth. ${doc.customerName},\n\nInvoice ${invoiceRef} telah melewati tanggal jatuh tempo ${daysOverdue} hari.\nJumlah: ${amountStr}\nJatuh Tempo: ${dueDateStr}\n\nMohon segera melakukan pembayaran. Hubungi kami untuk konfirmasi.\n\nTerima kasih,\nTim Finance`,
        html: `<p>Kepada Yth. <strong>${doc.customerName}</strong>,</p><p>Invoice <strong>${invoiceRef}</strong> telah melewati tanggal jatuh tempo <strong>${daysOverdue} hari</strong> yang lalu.</p><ul><li>Jumlah: <strong>${amountStr}</strong></li><li>Jatuh Tempo: ${dueDateStr}</li></ul><p>Mohon segera melakukan pembayaran. Hubungi kami untuk konfirmasi pembayaran.</p><p>Terima kasih,<br>Tim Finance</p>`,
        context: `${context}_email`,
        refType: "invoice",
        refId: invoiceRef,
      }).catch(() => {});
    }

    // Admin group WA alert
    if (adminGroupWa && isWithinAlertWindow(settings)) {
      const amountStr = `Rp ${Math.round(totalAmount).toLocaleString("id-ID")}`;
      const msg =
        `🔴 *Invoice Jatuh Tempo*\n\n` +
        `Invoice: *${invoiceRef}*\n` +
        `Customer: ${doc.customerName}\n` +
        `Jumlah: ${amountStr}\n` +
        `Jatuh Tempo: ${dueDateStr} (${daysOverdue} hari)\n\n` +
        `Reminder sudah dikirim ke customer.`;
      await sendWhatsApp(adminGroupWa, msg, { context: `${context}_admin`, refType: "invoice", refId: invoiceRef });
    }

    // Intelligence alert
    await createAlert({
      companyId: doc.companyId,
      alertType: "invoice_overdue",
      entityType: "sales_order",
      entityId: doc.id,
      entityRef: invoiceRef,
      severity: daysOverdue > 7 ? "critical" : "warning",
      title: `Invoice Jatuh Tempo — ${invoiceRef} (+${daysOverdue}h)`,
      message: `Invoice ${invoiceRef} untuk ${doc.customerName} melewati jatuh tempo ${daysOverdue} hari. Total: Rp ${Math.round(totalAmount).toLocaleString("id-ID")}.`,
      contextJson: { invoiceNumber: invoiceRef, customerName: doc.customerName, daysOverdue, totalAmount },
    });

    await createExceptionIdempotent({
      companyId: doc.companyId,
      exceptionType: "payment_overdue",
      severity: daysOverdue > 7 ? "critical" : "high",
      title: `Invoice Jatuh Tempo — ${invoiceRef} (+${daysOverdue} hari)`,
      description: `Invoice ${invoiceRef} untuk ${doc.customerName} melewati jatuh tempo ${daysOverdue} hari. Total: Rp ${Math.round(totalAmount).toLocaleString("id-ID")}.`,
      refType: "sales_order",
      refId: String(doc.id),
      refNumber: invoiceRef,
      customerName: doc.customerName,
      createdBy: "workflowWorker",
    });
  }
}

// ── TASK 7: Purchase bill overdue detection ───────────────────────────────────

async function checkBillOverdue(settings: AlertSettings): Promise<void> {
  const todayStr = new Date().toISOString().split("T")[0]!;

  const overdueBills = await db
    .select({
      id: purchaseDocumentsTable.id,
      docNumber: purchaseDocumentsTable.docNumber,
      billNumber: purchaseDocumentsTable.billNumber,
      supplierName: purchaseDocumentsTable.supplierName,
      supplierId: purchaseDocumentsTable.supplierId,
      grandTotal: purchaseDocumentsTable.grandTotal,
      totalAmount: purchaseDocumentsTable.totalAmount,
      dueDate: purchaseDocumentsTable.dueDate,
      paymentStatus: purchaseDocumentsTable.paymentStatus,
      companyId: purchaseDocumentsTable.companyId,
    })
    .from(purchaseDocumentsTable)
    .where(
      and(
        eq(purchaseDocumentsTable.billStatus, "billed"),
        inArray(purchaseDocumentsTable.paymentStatus, ["unpaid", "partial", "overdue"]),
        ne(purchaseDocumentsTable.status, "cancelled"),
        isNotNull(purchaseDocumentsTable.dueDate),
        lt(purchaseDocumentsTable.dueDate, todayStr),
      )
    );

  if (overdueBills.length === 0) return;

  const adminGroupWa = await getAdminGroupWa();

  for (const doc of overdueBills) {
    const billRef = doc.billNumber ?? doc.docNumber;

    await markPaymentOverdue(doc.id, "purchase_order");

    const context = "bill_overdue_reminder";
    if (await waAlreadySent(context, billRef)) continue;

    const totalAmount = Number(doc.grandTotal ?? doc.totalAmount ?? 0);
    const dueDate = doc.dueDate ? new Date(doc.dueDate) : null;
    const today = new Date();
    const daysOverdue = dueDate ? Math.floor((today.getTime() - dueDate.getTime()) / 86_400_000) : 0;
    const dueDateStr = dueDate
      ? dueDate.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" })
      : "—";

    // Fetch supplier contact
    let supplierEmail: string | null = null;
    let supplierPhone: string | null = null;
    if (doc.supplierId != null) {
      const [sup] = await db
        .select({ contactEmail: suppliersTable.contactEmail, phone: suppliersTable.phone })
        .from(suppliersTable)
        .where(eq(suppliersTable.id, doc.supplierId))
        .limit(1);
      supplierEmail = sup?.contactEmail ?? null;
      supplierPhone = sup?.phone ?? null;
    }

    // Admin group WA alert
    if (adminGroupWa && isWithinAlertWindow(settings)) {
      const amountStr = `Rp ${Math.round(totalAmount).toLocaleString("id-ID")}`;
      const msg =
        `🔴 *Vendor Bill Jatuh Tempo*\n\n` +
        `Bill: *${billRef}*\n` +
        `Supplier: ${doc.supplierName}\n` +
        `Jumlah: ${amountStr}\n` +
        `Jatuh Tempo: ${dueDateStr} (${daysOverdue} hari)\n\n` +
        `Segera proses pembayaran ke supplier.`;
      await sendWhatsApp(adminGroupWa, msg, { context: `${context}_admin`, refType: "purchase_bill", refId: billRef });
    }

    // WA to supplier phone if available
    if (supplierPhone && isWithinAlertWindow(settings)) {
      const amountStr = `Rp ${Math.round(totalAmount).toLocaleString("id-ID")}`;
      const msg =
        `Kepada Yth. *${doc.supplierName}*,\n\n` +
        `Kami menginformasikan bahwa *${billRef}* telah jatuh tempo.\n` +
        `Jumlah: ${amountStr}\n` +
        `Jatuh Tempo: ${dueDateStr}\n\n` +
        `Pembayaran sedang kami proses. Terima kasih atas kesabarannya. 🙏`;
      await sendWhatsApp(supplierPhone, msg, { context: `${context}_supplier`, refType: "purchase_bill", refId: billRef });
    }

    // Email to supplier
    if (supplierEmail && isSmtpConfigured()) {
      const amountStr = `Rp ${Math.round(totalAmount).toLocaleString("id-ID")}`;
      sendMail({
        to: supplierEmail,
        subject: `Informasi Pembayaran — Bill ${billRef} (${daysOverdue} hari jatuh tempo)`,
        text: `Kepada Yth. ${doc.supplierName},\n\nBill ${billRef} telah melewati tanggal jatuh tempo ${daysOverdue} hari.\nJumlah: ${amountStr}\nJatuh Tempo: ${dueDateStr}\n\nPembayaran sedang kami proses. Terima kasih atas kesabarannya.\n\nTerima kasih,\nTim Finance`,
        html: `<p>Kepada Yth. <strong>${doc.supplierName}</strong>,</p><p>Bill <strong>${billRef}</strong> telah melewati tanggal jatuh tempo <strong>${daysOverdue} hari</strong> yang lalu.</p><ul><li>Jumlah: <strong>${amountStr}</strong></li><li>Jatuh Tempo: ${dueDateStr}</li></ul><p>Pembayaran sedang kami proses. Kami akan menghubungi Anda segera.</p><p>Terima kasih,<br>Tim Finance</p>`,
        context: `${context}_email`,
        refType: "purchase_bill",
        refId: billRef,
      }).catch(() => {});
    }

    // Intelligence alert
    await createAlert({
      companyId: doc.companyId,
      alertType: "bill_overdue",
      entityType: "purchase_order",
      entityId: doc.id,
      entityRef: billRef,
      severity: daysOverdue > 7 ? "critical" : "warning",
      title: `Bill Jatuh Tempo — ${billRef} (+${daysOverdue}h)`,
      message: `Bill ${billRef} ke ${doc.supplierName} melewati jatuh tempo ${daysOverdue} hari. Total: Rp ${Math.round(totalAmount).toLocaleString("id-ID")}.`,
      contextJson: { billNumber: billRef, supplierName: doc.supplierName, daysOverdue, totalAmount },
    });

    await createExceptionIdempotent({
      companyId: doc.companyId,
      exceptionType: "payment_overdue",
      severity: daysOverdue > 7 ? "critical" : "high",
      title: `Bill Jatuh Tempo — ${billRef} (+${daysOverdue} hari)`,
      description: `Bill ${billRef} ke ${doc.supplierName} melewati jatuh tempo ${daysOverdue} hari. Total: Rp ${Math.round(totalAmount).toLocaleString("id-ID")}.`,
      refType: "purchase_order",
      refId: String(doc.id),
      refNumber: billRef,
      supplierName: doc.supplierName,
      createdBy: "workflowWorker",
    });
  }
}

// ── TASK 8 — Vendor invoice due/overdue reminder with OCR breakdown ───────────
function formatRp(value: unknown): string {
  if (value == null || value === "") return "Belum terbaca";
  const amount = Number(value);
  return Number.isFinite(amount)
    ? `Rp ${Math.round(amount).toLocaleString("id-ID")}`
    : "Belum terbaca";
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function buildVendorInvoiceBreakdownMessage(
  breakdownValue: unknown,
  fallbackPph: unknown,
): { lines: string[]; pph: string; payable: string } {
  const breakdown = asObject(breakdownValue);
  const totals = asObject(breakdown?.totals);
  const withholding = asObject(breakdown?.withholding_tax);
  const componentValues = Array.isArray(breakdown?.components) ? breakdown.components : [];
  const componentLines = componentValues
    .map((value) => asObject(value))
    .filter((value): value is Record<string, unknown> => Boolean(value))
    .map((component) => {
      const label = String(component.label ?? "Komponen invoice");
      const gross = component.gross != null ? formatRp(component.gross) : "—";
      const ppn = component.ppn != null ? formatRp(component.ppn) : "—";
      const pph = component.withholding_tax_amount != null
        ? formatRp(component.withholding_tax_amount)
        : "—";
      const payable = component.payable_amount != null
        ? formatRp(component.payable_amount)
        : "Belum terbaca";
      return `  • ${label}: gross ${gross} | PPN ${ppn} | PPh ${pph} | bayar ${payable}`;
    });

  const pphValue = withholding?.amount ?? totals?.withholding_tax_amount ?? fallbackPph;
  const payableValue = totals?.payable_amount;
  return {
    lines: componentLines,
    pph: formatRp(pphValue),
    payable: formatRp(payableValue),
  };
}

async function checkVendorInvoiceDue(settings: AlertSettings): Promise<void> {
  const today = new Date();
  const invoices = await db
    .select({
      id: vendorInvoicesTable.id,
      invoiceNumber: vendorInvoicesTable.invoiceNumber,
      vendorInvoiceRef: vendorInvoicesTable.vendorInvoiceRef,
      supplierName: vendorInvoicesTable.supplierName,
      supplierId: vendorInvoicesTable.supplierId,
      grandTotal: vendorInvoicesTable.grandTotal,
      taxAmount: vendorInvoicesTable.taxAmount,
      amountPaid: vendorInvoicesTable.amountPaid,
      withholdingTaxAmount: vendorInvoicesTable.withholdingTaxAmount,
      invoiceBreakdown: vendorInvoicesTable.invoiceBreakdown,
      dueDate: vendorInvoicesTable.dueDate,
    })
    .from(vendorInvoicesTable)
    .where(
      and(
        inArray(vendorInvoicesTable.status, ["posted", "matched", "ready_for_ap"]),
        ne(vendorInvoicesTable.status, "cancelled"),
        isNotNull(vendorInvoicesTable.dueDate),
        lte(vendorInvoicesTable.dueDate, today),
      )
    );

  if (invoices.length === 0) return;

  const adminGroupWa = await getAdminGroupWa();
  const alertWindow = isWithinAlertWindow(settings);

  for (const invoice of invoices) {
    const dueDate = invoice.dueDate ? new Date(invoice.dueDate) : null;
    if (!dueDate) continue;
    const daysOverdue = Math.max(
      0,
      Math.floor((today.getTime() - dueDate.getTime()) / 86_400_000),
    );
    const invoiceRef = invoice.vendorInvoiceRef || invoice.invoiceNumber;

    let supplierPhone: string | null = null;
    if (invoice.supplierId != null) {
      const [supplier] = await db
        .select({ phone: suppliersTable.phone })
        .from(suppliersTable)
        .where(eq(suppliersTable.id, invoice.supplierId))
        .limit(1);
      supplierPhone = supplier?.phone ?? null;
    }
    const adminContext = "vendor_invoice_due_reminder_admin";
    const supplierContext = "vendor_invoice_due_reminder_supplier";
    const [adminAlreadySent, supplierAlreadySent] = await Promise.all([
      adminGroupWa
        ? waAlreadySent(adminContext, invoiceRef)
        : Promise.resolve(true),
      supplierPhone
        ? waAlreadySent(supplierContext, invoiceRef)
        : Promise.resolve(true),
    ]);
    if (adminAlreadySent && supplierAlreadySent) continue;

    const gross = Number(invoice.grandTotal ?? 0);
    const paid = Number(invoice.amountPaid ?? 0);
    const remaining = Math.max(0, gross - paid);
    const breakdown = buildVendorInvoiceBreakdownMessage(
      invoice.invoiceBreakdown,
      invoice.withholdingTaxAmount,
    );
    const dueDateLabel = dueDate.toLocaleDateString("id-ID", {
      day: "2-digit",
      month: "long",
      year: "numeric",
    });
    const timing = daysOverdue === 0
      ? "jatuh tempo hari ini"
      : `terlambat ${daysOverdue} hari`;
    const messageLines = [
      `🟡 *Vendor Invoice ${timing}*`,
      ``,
      `Invoice: *${invoiceRef}*`,
      `Supplier: ${invoice.supplierName}`,
      `Jatuh tempo: *${dueDateLabel}*`,
      ``,
      `Total gross / kewajiban: *${formatRp(gross)}*`,
      `PPN: ${formatRp(invoice.taxAmount)}`,
      `Potongan PPh: ${breakdown.pph}`,
      `Bayar ke vendor: *${breakdown.payable}*`,
      `Sisa kewajiban: *${formatRp(remaining)}*`,
    ];
    if (breakdown.lines.length > 0) {
      messageLines.push(``, `*Rincian komponen:*`, ...breakdown.lines);
    }
    messageLines.push(``, `Segera proses review dan pembayaran vendor.`);
    const message = messageLines.join("\n");

    if (alertWindow && adminGroupWa && !adminAlreadySent) {
      await sendWhatsApp(adminGroupWa, message, {
        context: adminContext,
        refType: "vendor_invoice",
        refId: invoiceRef,
      });
    }
    if (alertWindow && supplierPhone && !supplierAlreadySent) {
      await sendWhatsApp(supplierPhone, message, {
        context: supplierContext,
        refType: "vendor_invoice",
        refId: invoiceRef,
      });
    }

    if ((adminGroupWa || supplierPhone) && alertWindow) {
      logger.info(
        { invoiceId: invoice.id, invoiceRef, daysOverdue, remaining },
        "WorkflowWorker: vendor invoice due reminder sent",
      );
    }
  }
}

// ── TASK 5: Late order ETA breach ────────────────────────────────────────────

async function checkLateOrders(settings: AlertSettings): Promise<void> {
  if (!settings.etaAlertEnabled) return;

  const now = new Date();

  const lateOrders = await db
    .select({
      id: logisticOrdersTable.id,
      orderNumber: logisticOrdersTable.orderNumber,
      status: logisticOrdersTable.status,
      eta: logisticOrdersTable.eta,
      companyId: logisticOrdersTable.companyId,
      customerName: logisticOrdersTable.customerName,
    })
    .from(logisticOrdersTable)
    .where(
      and(
        lt(logisticOrdersTable.eta, now),
        notInArray(logisticOrdersTable.status, ["Completed", "Cancelled", "Delivered", "Selesai"]),
        ne(logisticOrdersTable.status, "New Order"),
      )
    );

  for (const order of lateOrders) {
    if (!order.eta) continue;
    const hoursLate = Math.floor((now.getTime() - new Date(order.eta).getTime()) / 3_600_000);

    await createAlert({
      companyId: order.companyId,
      alertType: "order_eta_breach",
      entityType: "logistic_order",
      entityId: order.id,
      entityRef: order.orderNumber,
      severity: "critical",
      title: `ETA Terlewat — ${order.orderNumber} (${hoursLate}j)`,
      message: `Order ${order.orderNumber} (${order.customerName}) melebihi ETA ${hoursLate} jam. Status saat ini: ${order.status}.`,
      contextJson: { orderNumber: order.orderNumber, customerName: order.customerName, status: order.status, hoursLate },
    });

    await createExceptionIdempotent({
      companyId: order.companyId,
      exceptionType: "delivery_delayed",
      severity: "high",
      title: `ETA Terlewat — ${order.orderNumber} (${hoursLate}j)`,
      description: `Order ${order.orderNumber} (${order.customerName}) melebihi ETA ${hoursLate} jam. Status: ${order.status}.`,
      refType: "logistic_order",
      refId: String(order.id),
      refNumber: order.orderNumber,
      customerName: order.customerName,
      createdBy: "workflowWorker",
    });
  }
}

// ── Main worker run ───────────────────────────────────────────────────────────

async function runWorkflowWorker(): Promise<void> {
  try {
    const settings = await loadSettings();

    if (!settings.masterEnabled) {
      logger.debug("WorkflowWorker: master alert disabled, skipping all checks");
      return;
    }

    if (!isWithinAlertWindow(settings)) {
      logger.debug({ window: `${settings.alertWindowStart}–${settings.alertWindowEnd}` }, "WorkflowWorker: outside alert window, skipping WA notifications");
    }

    await Promise.allSettled([
      checkVendorRfqNoResponse(settings),
      checkCustomerQuoteReminders(settings),
      checkLateOrders(settings),
      checkInvoiceOverdue(settings),
      checkBillOverdue(settings),
      checkVendorInvoiceDue(settings),
      settings.invoiceReminderEnabled
        ? runInvoiceReminders({ isWithinAlertWindow: isWithinAlertWindow(settings) })
        : Promise.resolve(),
    ]);
  } catch (err) {
    logger.error({ err }, "WorkflowWorker: unexpected error");
  }
}

// ── Scheduler ────────────────────────────────────────────────────────────────

export function startWorkflowWorker(): void {
  initInvoiceReminderTable().catch(err =>
    logger.warn({ err }, "WorkflowWorker: gagal init invoice_reminder_logs table")
  );

  registerHeartbeat("workflow-worker", POLL_INTERVAL_MS);
  const run = () => {
    beat("workflow-worker");
    return runWorkflowWorker().catch(err =>
      logger.warn({ err }, "WorkflowWorker: uncaught error")
    );
  };

  setTimeout(() => {
    run();
    setInterval(run, POLL_INTERVAL_MS).unref();
  }, INITIAL_DELAY_MS).unref();

  logger.info(
    { intervalMin: POLL_INTERVAL_MS / 60_000, initialDelayMin: INITIAL_DELAY_MS / 60_000 },
    "WorkflowWorker started (L1 reminders: RFQ configurable threshold, quote T+3d/7d, ETA breach)"
  );
}
