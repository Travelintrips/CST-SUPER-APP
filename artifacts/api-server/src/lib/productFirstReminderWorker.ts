/**
 * productFirstReminderWorker.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Mengirim WA reminder untuk product-first logistic orders yang perlu tindakan:
 *
 *   1. customer_product_pending   — customer belum approve/reject produk > 6h
 *   2. customer_shipment_pending  — customer belum pilih shipment mode > 6h
 *   3. vendor_product_no_quote    — vendor produk belum submit quote > 12h
 *   4. shipper_no_quote           — shipper belum submit quote RFQ > 12h
 *
 * Dedup: 1 reminder per order per type per hari (tabel product_first_reminder_logs).
 * Worker non-fatal — error tidak menghentikan server.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";
import { getAdminGroupWa } from "./adminWa.js";
import { sendWhatsApp } from "./fonnte.js";

const PREFIX = "[ProductFirstReminderWorker]";
const INTERVAL_MS = 4 * 60 * 60 * 1000; // setiap 4 jam
const INITIAL_DELAY_MS = 15 * 60 * 1000; // 15 menit setelah boot

// ── Ensure reminder log table ─────────────────────────────────────────────────
async function ensureTable() {
  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS product_first_reminder_logs (
      id            SERIAL PRIMARY KEY,
      order_id      INTEGER NOT NULL,
      reminder_type TEXT NOT NULL,
      sent_date     DATE NOT NULL DEFAULT CURRENT_DATE,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `));
  await db.execute(sql.raw(`
    CREATE UNIQUE INDEX IF NOT EXISTS pf_reminder_daily_uniq
      ON product_first_reminder_logs(order_id, reminder_type, sent_date)
  `));
}

let tableMigrated = false;
async function ensureOnce() {
  if (!tableMigrated) { await ensureTable(); tableMigrated = true; }
}

// ── Check if already sent today ───────────────────────────────────────────────
async function alreadySentToday(orderId: number, reminderType: string): Promise<boolean> {
  const r = await db.execute(sql.raw(`
    SELECT 1 FROM product_first_reminder_logs
    WHERE order_id = ${orderId}
      AND reminder_type = '${reminderType}'
      AND sent_date = CURRENT_DATE
    LIMIT 1
  `));
  return (r.rows as any[]).length > 0;
}

// ── Mark as sent ──────────────────────────────────────────────────────────────
async function markSent(orderId: number, reminderType: string) {
  await db.execute(sql.raw(`
    INSERT INTO product_first_reminder_logs (order_id, reminder_type, sent_date)
    VALUES (${orderId}, '${reminderType}', CURRENT_DATE)
    ON CONFLICT (order_id, reminder_type, sent_date) DO NOTHING
  `)).catch(() => {});
}

// ── Send WA to admin (fire-and-forget) ───────────────────────────────────────
async function notifyAdminWa(msg: string, context: string, refId: number) {
  try {
    const group = await getAdminGroupWa();
    if (!group) return;
    await sendWhatsApp(group, msg, { context, refId: String(refId) });
  } catch { /* non-fatal */ }
}

// ── 1. Customer belum approve produk > 6 jam ─────────────────────────────────
async function checkCustomerProductPending() {
  const TYPE = "customer_product_pending";
  const rows = await db.execute<{
    id: number; order_number: string; customer_name: string; phone: string; hours_stuck: number;
  }>(sql.raw(`
    SELECT lo.id, lo.order_number, lo.customer_name, lo.phone,
           EXTRACT(EPOCH FROM (NOW() - lo.updated_at)) / 3600 AS hours_stuck
    FROM logistic_orders lo
    WHERE lo.order_type = 'product_first'
      AND lo.status = 'Customer Product Approval'
      AND lo.updated_at < NOW() - INTERVAL '6 hours'
  `));

  for (const r of rows.rows as any[]) {
    if (await alreadySentToday(r.id, TYPE)) continue;
    const msg = [
      `🔔 *[REMINDER] Customer Belum Approve Produk*`,
      `━━━━━━━━━━━━━━━━━━`,
      `No. Order   : \`${r.order_number}\``,
      `Customer    : *${r.customer_name}*`,
      `HP          : ${r.phone || "-"}`,
      `Menunggu    : ${Math.round(r.hours_stuck)} jam`,
      `━━━━━━━━━━━━━━━━━━`,
      `⚡ Segera follow-up customer untuk approval produk.`,
    ].join("\n");
    await notifyAdminWa(msg, `pf_reminder_${TYPE}_${r.id}`, r.id);
    await markSent(r.id, TYPE);
  }
}

// ── 2. Customer belum pilih shipment mode > 6 jam ────────────────────────────
async function checkCustomerShipmentPending() {
  const TYPE = "customer_shipment_pending";
  const rows = await db.execute<{
    id: number; order_number: string; customer_name: string; phone: string; hours_stuck: number;
  }>(sql.raw(`
    SELECT lo.id, lo.order_number, lo.customer_name, lo.phone,
           EXTRACT(EPOCH FROM (NOW() - lo.updated_at)) / 3600 AS hours_stuck
    FROM logistic_orders lo
    WHERE lo.order_type = 'product_first'
      AND lo.status = 'Shipment Selection Pending'
      AND lo.shipment_mode IS NULL
      AND lo.updated_at < NOW() - INTERVAL '6 hours'
  `));

  for (const r of rows.rows as any[]) {
    if (await alreadySentToday(r.id, TYPE)) continue;
    const msg = [
      `🔔 *[REMINDER] Customer Belum Pilih Mode Pengiriman*`,
      `━━━━━━━━━━━━━━━━━━`,
      `No. Order   : \`${r.order_number}\``,
      `Customer    : *${r.customer_name}*`,
      `HP          : ${r.phone || "-"}`,
      `Menunggu    : ${Math.round(r.hours_stuck)} jam`,
      `━━━━━━━━━━━━━━━━━━`,
      `⚡ Customer perlu memilih: pickup mandiri atau trucking.`,
    ].join("\n");
    await notifyAdminWa(msg, `pf_reminder_${TYPE}_${r.id}`, r.id);
    await markSent(r.id, TYPE);
  }
}

// ── 3. Vendor produk belum submit quote > 12 jam ─────────────────────────────
async function checkVendorProductNoQuote() {
  const TYPE = "vendor_product_no_quote";
  const rows = await db.execute<{
    id: number; order_number: string; customer_name: string;
    vendor_name: string; hours_stuck: number;
  }>(sql.raw(`
    SELECT lo.id, lo.order_number, lo.customer_name,
           COALESCE(s.name, 'Unknown Vendor') AS vendor_name,
           EXTRACT(EPOCH FROM (NOW() - lo.updated_at)) / 3600 AS hours_stuck
    FROM logistic_orders lo
    LEFT JOIN suppliers s ON s.id = lo.product_vendor_id
    WHERE lo.order_type = 'product_first'
      AND lo.status = 'Product RFQ Sent'
      AND lo.updated_at < NOW() - INTERVAL '12 hours'
  `));

  for (const r of rows.rows as any[]) {
    if (await alreadySentToday(r.id, TYPE)) continue;
    const msg = [
      `🔔 *[REMINDER] Vendor Produk Belum Submit Quote*`,
      `━━━━━━━━━━━━━━━━━━`,
      `No. Order   : \`${r.order_number}\``,
      `Customer    : ${r.customer_name}`,
      `Vendor      : *${r.vendor_name}*`,
      `Menunggu    : ${Math.round(r.hours_stuck)} jam`,
      `━━━━━━━━━━━━━━━━━━`,
      `⚡ Follow-up vendor untuk segera submit penawaran produk.`,
    ].join("\n");
    await notifyAdminWa(msg, `pf_reminder_${TYPE}_${r.id}`, r.id);
    await markSent(r.id, TYPE);
  }
}

// ── 4. Shipper belum submit quote RFQ > 12 jam ───────────────────────────────
async function checkShipperNoQuote() {
  const TYPE = "shipper_no_quote";
  const rows = await db.execute<{
    id: number; order_number: string; customer_name: string; hours_stuck: number;
  }>(sql.raw(`
    SELECT lo.id, lo.order_number, lo.customer_name,
           EXTRACT(EPOCH FROM (NOW() - lo.updated_at)) / 3600 AS hours_stuck
    FROM logistic_orders lo
    WHERE lo.order_type = 'product_first'
      AND lo.status = 'RFQ Sent'
      AND lo.updated_at < NOW() - INTERVAL '12 hours'
  `));

  for (const r of rows.rows as any[]) {
    if (await alreadySentToday(r.id, TYPE)) continue;
    const msg = [
      `🔔 *[REMINDER] Shipper Belum Submit Quote RFQ*`,
      `━━━━━━━━━━━━━━━━━━`,
      `No. Order   : \`${r.order_number}\``,
      `Customer    : ${r.customer_name}`,
      `Menunggu    : ${Math.round(r.hours_stuck)} jam`,
      `━━━━━━━━━━━━━━━━━━`,
      `⚡ Segera follow-up shipper/vendor pengiriman untuk submit penawaran.`,
    ].join("\n");
    await notifyAdminWa(msg, `pf_reminder_${TYPE}_${r.id}`, r.id);
    await markSent(r.id, TYPE);
  }
}

// ── Main run ──────────────────────────────────────────────────────────────────
async function run() {
  await ensureOnce();
  logger.info(`${PREFIX} starting reminder scan`);
  await Promise.allSettled([
    checkCustomerProductPending(),
    checkCustomerShipmentPending(),
    checkVendorProductNoQuote(),
    checkShipperNoQuote(),
  ]);
  logger.info(`${PREFIX} reminder scan done`);
}

// ── Export ────────────────────────────────────────────────────────────────────
export function startProductFirstReminderWorker() {
  setTimeout(() => {
    run().catch((e: unknown) => logger.warn({ e }, `${PREFIX} run error (non-fatal)`));
    setInterval(() => {
      run().catch((e: unknown) => logger.warn({ e }, `${PREFIX} run error (non-fatal)`));
    }, INTERVAL_MS).unref();
  }, INITIAL_DELAY_MS).unref();

  logger.info(`${PREFIX} worker scheduled (interval=${INTERVAL_MS / 3600000}h, initial_delay=${INITIAL_DELAY_MS / 60000}min)`);
}
