/**
 * invoiceReminderWorker.ts
 *
 * Mengirim WA reminder ke customer sesuai jadwal:
 *   H-7, H-3, H-1, Hari Jatuh Tempo, Overdue +1, Overdue +7
 *
 * Dedup: UNIQUE(sales_doc_id, reminder_type) di tabel invoice_reminder_logs.
 * Setiap jenis reminder hanya dikirim SEKALI per invoice, selamanya.
 */

import { db, salesDocumentsTable, customersTable, customerInvoiceLinksTable } from "@workspace/db";
import { and, eq, isNotNull, ne, inArray, gt, sql } from "drizzle-orm";
import { logger } from "./logger.js";
import { sendInvoiceReminderWa } from "./orderNotification.js";
import { getPreferredDomain } from "./domain.js";

const PREFIX = "[InvoiceReminderWorker]";

interface ReminderConfig {
  type: string;
  dayOffset: number;
  label: string;
}

const REMINDER_SCHEDULE: ReminderConfig[] = [
  { type: "h7",        dayOffset: -7, label: "H-7 (7 hari sebelum jatuh tempo)" },
  { type: "h3",        dayOffset: -3, label: "H-3 (3 hari sebelum jatuh tempo)" },
  { type: "h1",        dayOffset: -1, label: "H-1 (1 hari sebelum jatuh tempo)" },
  { type: "due_today", dayOffset:  0, label: "Hari H Jatuh Tempo" },
  { type: "overdue_1", dayOffset:  1, label: "Overdue +1 Hari" },
  { type: "overdue_7", dayOffset:  7, label: "Overdue +7 Hari" },
];

export async function initInvoiceReminderTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS invoice_reminder_logs (
      id              SERIAL PRIMARY KEY,
      sales_doc_id    INTEGER  NOT NULL,
      invoice_number  TEXT     NOT NULL,
      customer_id     INTEGER,
      reminder_type   TEXT     NOT NULL,
      sent_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      status          TEXT     NOT NULL DEFAULT 'sent',
      error_msg       TEXT,
      CONSTRAINT uq_invoice_reminder UNIQUE (sales_doc_id, reminder_type)
    )
  `);
  logger.info("Invoice reminder table: ok");
}

async function alreadySent(salesDocId: number, reminderType: string): Promise<boolean> {
  const result = await db.execute(sql`
    SELECT 1 FROM invoice_reminder_logs
    WHERE sales_doc_id = ${salesDocId} AND reminder_type = ${reminderType}
    LIMIT 1
  `);
  return (result.rows?.length ?? 0) > 0;
}

async function markLog(
  salesDocId: number,
  invoiceNumber: string,
  customerId: number | null,
  reminderType: string,
  status: "sent" | "skipped" | "error",
  errorMsg?: string,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO invoice_reminder_logs
      (sales_doc_id, invoice_number, customer_id, reminder_type, status, error_msg)
    VALUES
      (${salesDocId}, ${invoiceNumber}, ${customerId ?? null}, ${reminderType}, ${status}, ${errorMsg ?? null})
    ON CONFLICT (sales_doc_id, reminder_type) DO NOTHING
  `);
}

export async function runInvoiceReminders(opts: { isWithinAlertWindow: boolean }): Promise<void> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const invoices = await db
    .select({
      id: salesDocumentsTable.id,
      docNumber: salesDocumentsTable.docNumber,
      invoiceNumber: salesDocumentsTable.invoiceNumber,
      customerName: salesDocumentsTable.customerName,
      customerId: salesDocumentsTable.customerId,
      grandTotal: salesDocumentsTable.grandTotal,
      amountPaid: salesDocumentsTable.amountPaid,
      dueDate: salesDocumentsTable.dueDate,
    })
    .from(salesDocumentsTable)
    .where(
      and(
        eq(salesDocumentsTable.invoiceStatus, "invoiced"),
        inArray(salesDocumentsTable.paymentStatus, ["unpaid", "partial", "overdue"]),
        ne(salesDocumentsTable.status, "cancelled"),
        isNotNull(salesDocumentsTable.dueDate),
      )
    );

  if (invoices.length === 0) return;

  logger.debug({ total: invoices.length }, `${PREFIX} memeriksa ${invoices.length} invoice`);

  const domain = getPreferredDomain();

  for (const inv of invoices) {
    const dueDate = new Date(inv.dueDate!);
    dueDate.setHours(0, 0, 0, 0);
    const daysDiff = Math.round((dueDate.getTime() - today.getTime()) / 86_400_000);
    // daysDiff > 0 = hari sebelum jatuh tempo
    // daysDiff = 0 = hari jatuh tempo
    // daysDiff < 0 = hari setelah jatuh tempo (overdue)

    const config = REMINDER_SCHEDULE.find(r => r.dayOffset === -daysDiff);
    if (!config) continue;

    const invoiceRef = inv.invoiceNumber ?? inv.docNumber;

    if (await alreadySent(inv.id, config.type)) {
      logger.debug({ salesDocId: inv.id, reminderType: config.type }, `${PREFIX} sudah dikirim, skip`);
      continue;
    }

    let customerPhone: string | null = null;
    if (inv.customerId != null) {
      const [cust] = await db
        .select({ phone: customersTable.phone })
        .from(customersTable)
        .where(eq(customersTable.id, inv.customerId))
        .limit(1);
      customerPhone = cust?.phone ?? null;
    }

    if (!customerPhone) {
      await markLog(inv.id, invoiceRef, inv.customerId ?? null, config.type, "skipped", "no phone");
      logger.debug({ salesDocId: inv.id, invoiceNumber: invoiceRef }, `${PREFIX} skip: customer tidak punya nomor WA`);
      continue;
    }

    const grandTotal = Number(inv.grandTotal ?? 0);
    const amountPaid = Number(inv.amountPaid ?? 0);
    const outstanding = Math.max(0, grandTotal - amountPaid);
    const dueDateLabel = dueDate.toLocaleDateString("id-ID", { day: "2-digit", month: "long", year: "numeric" });
    const daysOverdue = daysDiff < 0 ? Math.abs(daysDiff) : 0;
    const orderNumber = inv.docNumber !== invoiceRef ? inv.docNumber : null;

    let invoiceUrl: string | null = null;
    if (domain) {
      try {
        const [invLink] = await db
          .select({ token: customerInvoiceLinksTable.token })
          .from(customerInvoiceLinksTable)
          .where(and(
            eq(customerInvoiceLinksTable.salesDocId, inv.id),
            gt(customerInvoiceLinksTable.expiresAt, new Date()),
          ))
          .limit(1);
        if (invLink?.token) {
          invoiceUrl = `https://${domain}/customer-invoice/${invLink.token}`;
        }
      } catch { /* non-fatal */ }
    }

    if (opts.isWithinAlertWindow) {
      try {
        await sendInvoiceReminderWa(customerPhone, config.type, {
          customerName: inv.customerName,
          invoiceNumber: invoiceRef,
          orderNumber,
          totalAmount: `Rp ${Math.round(grandTotal).toLocaleString("id-ID")}`,
          outstandingAmount: `Rp ${Math.round(outstanding).toLocaleString("id-ID")}`,
          dueDate: dueDateLabel,
          invoiceUrl,
          daysOverdue,
        });
        await markLog(inv.id, invoiceRef, inv.customerId ?? null, config.type, "sent");
        logger.info(
          { salesDocId: inv.id, invoiceNumber: invoiceRef, reminderType: config.type, daysDiff },
          `${PREFIX} ${config.label} → ${customerPhone}`,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        await markLog(inv.id, invoiceRef, inv.customerId ?? null, config.type, "error", msg);
        logger.error({ err, salesDocId: inv.id, reminderType: config.type }, `${PREFIX} gagal kirim`);
      }
    } else {
      logger.debug({ salesDocId: inv.id, reminderType: config.type }, `${PREFIX} di luar alert window, skip kirim WA`);
    }
  }
}
