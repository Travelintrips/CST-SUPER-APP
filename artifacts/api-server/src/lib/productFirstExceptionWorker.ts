/**
 * productFirstExceptionWorker.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Auto-detects time-based exceptions for product_first logistic orders:
 *   - shipment_not_selected   : Shipment Selection Pending > 24 jam
 *   - shipment_rfq_no_response: RFQ Sent (shipment phase) > 48 jam
 *   - pickup_self_overdue     : Ready for Pickup melewati product_ready_date
 *   - product_ready_date_delayed: order sudah melewati product_ready_date tapi belum Invoice
 *
 * Exception di-insert ke tabel "exceptions" (dedup: 1 open exception per
 * order per type — tidak duplikat selama masih open/in_progress).
 *
 * Worker ini non-fatal: error tidak menghentikan server.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";
import { getAdminGroupWa } from "./adminWa.js";
import { sendWhatsApp } from "./fonnte.js";

const PREFIX = "[ProductFirstExceptionWorker]";
const INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 jam
const INITIAL_DELAY_MS = 10 * 60 * 1000; // 10 menit setelah boot

// ── Idempotent boot migration ─────────────────────────────────────────────────
async function ensureExceptionTypes() {
  const newTypes = [
    "product_vendor_rejected",
    "product_stock_not_available",
    "product_ready_date_delayed",
    "shipment_not_selected",
    "shipment_rfq_no_response",
    "pickup_self_overdue",
  ];
  for (const t of newTypes) {
    await db.execute(sql.raw(
      `DO $$ BEGIN ALTER TYPE exception_type ADD VALUE IF NOT EXISTS '${t}'; EXCEPTION WHEN others THEN NULL; END $$;`
    )).catch(() => {});
  }
}

let migrated = false;
async function ensureOnce() {
  if (!migrated) { await ensureExceptionTypes(); migrated = true; }
}

// ── Upsert exception (skip if already open/in_progress for same order+type) ──
async function upsertException(opts: {
  orderId: number;
  orderNumber: string;
  customerName?: string;
  exceptionType: string;
  severity: "low" | "medium" | "high" | "critical";
  title: string;
  description: string;
}) {
  const existing = await db.execute(sql.raw(`
    SELECT id FROM exceptions
    WHERE ref_type = 'logistic_order'
      AND ref_id = '${opts.orderId}'
      AND exception_type::text = '${opts.exceptionType}'
      AND status IN ('open','in_progress')
    LIMIT 1
  `));
  if ((existing.rows as any[]).length > 0) return; // sudah ada yang open

  await db.execute(sql.raw(`
    INSERT INTO exceptions
      (exception_type, severity, status, title, description,
       ref_type, ref_id, ref_number, customer_name,
       reported_by_type, created_by, created_at, updated_at)
    VALUES (
      '${opts.exceptionType}',
      '${opts.severity}',
      'open',
      '${opts.title.replace(/'/g, "''")}',
      '${opts.description.replace(/'/g, "''")}',
      'logistic_order',
      '${opts.orderId}',
      '${opts.orderNumber.replace(/'/g, "''")}',
      ${opts.customerName ? `'${opts.customerName.replace(/'/g, "''")}'` : "NULL"},
      'system',
      'auto-detector',
      NOW(),
      NOW()
    )
  `)).catch((e: unknown) => logger.warn({ e, opts }, `${PREFIX} insert exception failed`));
}

// ── Notify WA admin (non-fatal) ───────────────────────────────────────────────
async function notifyAdmin(message: string, context: string) {
  try {
    const group = await getAdminGroupWa();
    if (!group) return;
    await sendWhatsApp(group, message, { context });
  } catch { /* non-fatal */ }
}

// ── Check: Shipment Not Selected (> 24 jam di "Shipment Selection Pending") ───
async function checkShipmentNotSelected() {
  const rows = await db.execute<{
    id: number; order_number: string; customer_name: string; hours_stuck: number;
  }>(sql.raw(`
    SELECT lo.id, lo.order_number, lo.customer_name,
           EXTRACT(EPOCH FROM (NOW() - lo.updated_at)) / 3600 AS hours_stuck
    FROM logistic_orders lo
    WHERE lo.order_type = 'product_first'
      AND lo.status = 'Shipment Selection Pending'
      AND lo.shipment_mode IS NULL
      AND lo.updated_at < NOW() - INTERVAL '24 hours'
  `));

  for (const r of rows.rows as any[]) {
    await upsertException({
      orderId: r.id,
      orderNumber: r.order_number,
      customerName: r.customer_name,
      exceptionType: "shipment_not_selected",
      severity: r.hours_stuck > 48 ? "high" : "medium",
      title: `Shipment Belum Dipilih — ${r.order_number}`,
      description: `Customer ${r.customer_name} belum memilih mode pengiriman selama ${Math.round(r.hours_stuck)} jam setelah produk disetujui.`,
    });
  }
  if ((rows.rows as any[]).length > 0) {
    await notifyAdmin(
      `⚠️ *[EXCEPTION] Shipment Belum Dipilih*\n${(rows.rows as any[]).map((r: any) => `• ${r.order_number} — ${r.customer_name} (${Math.round(r.hours_stuck)} jam)`).join("\n")}`,
      "exception_shipment_not_selected",
    );
  }
}

// ── Check: Shipment RFQ No Response (> 48 jam di "RFQ Sent") ─────────────────
async function checkShipmentRfqNoResponse() {
  const rows = await db.execute<{
    id: number; order_number: string; customer_name: string; hours_stuck: number;
  }>(sql.raw(`
    SELECT lo.id, lo.order_number, lo.customer_name,
           EXTRACT(EPOCH FROM (NOW() - lo.updated_at)) / 3600 AS hours_stuck
    FROM logistic_orders lo
    WHERE lo.order_type = 'product_first'
      AND lo.status = 'RFQ Sent'
      AND lo.updated_at < NOW() - INTERVAL '48 hours'
  `));

  for (const r of rows.rows as any[]) {
    await upsertException({
      orderId: r.id,
      orderNumber: r.order_number,
      customerName: r.customer_name,
      exceptionType: "shipment_rfq_no_response",
      severity: r.hours_stuck > 72 ? "high" : "medium",
      title: `Shipper Tidak Respon RFQ — ${r.order_number}`,
      description: `Tidak ada respon dari shipper selama ${Math.round(r.hours_stuck)} jam sejak RFQ pengiriman dikirim untuk order ${r.order_number}.`,
    });
  }
}

// ── Check: Pickup Self Overdue (status "Ready for Pickup", ready_date sudah lewat) ──
async function checkPickupSelfOverdue() {
  const rows = await db.execute<{
    id: number; order_number: string; customer_name: string; product_ready_date: string; days_overdue: number;
  }>(sql.raw(`
    SELECT lo.id, lo.order_number, lo.customer_name, lo.product_ready_date,
           EXTRACT(EPOCH FROM (NOW() - lo.product_ready_date::date)) / 86400 AS days_overdue
    FROM logistic_orders lo
    WHERE lo.order_type = 'product_first'
      AND lo.status = 'Ready for Pickup'
      AND lo.product_ready_date IS NOT NULL
      AND lo.product_ready_date::date < CURRENT_DATE
  `));

  for (const r of rows.rows as any[]) {
    await upsertException({
      orderId: r.id,
      orderNumber: r.order_number,
      customerName: r.customer_name,
      exceptionType: "pickup_self_overdue",
      severity: r.days_overdue > 3 ? "critical" : "high",
      title: `Pickup Mandiri Terlambat — ${r.order_number}`,
      description: `Customer ${r.customer_name} belum mengambil barang, sudah ${Math.round(r.days_overdue)} hari melewati tanggal ready ${r.product_ready_date}.`,
    });
  }
}

// ── Check: Product Vendor Rejected (stuck di "Product Vendor Selected" setelah customer reject) ──
async function checkProductVendorRejected() {
  // Deteksi: approval sudah dikirim (token ada), customer tidak menyetujui (approvedAt null),
  // dan order masih di "Product Vendor Selected" > 8 jam → kemungkinan customer reject.
  const rows = await db.execute<{
    id: number; order_number: string; customer_name: string; hours_stuck: number;
  }>(sql.raw(`
    SELECT lo.id, lo.order_number, lo.customer_name,
           EXTRACT(EPOCH FROM (NOW() - lo.updated_at)) / 3600 AS hours_stuck
    FROM logistic_orders lo
    WHERE lo.order_type = 'product_first'
      AND lo.status = 'Product Vendor Selected'
      AND lo.customer_product_approval_token IS NOT NULL
      AND lo.customer_product_approved_at IS NULL
      AND lo.updated_at < NOW() - INTERVAL '8 hours'
  `));

  for (const r of rows.rows as any[]) {
    await upsertException({
      orderId: r.id,
      orderNumber: r.order_number,
      customerName: r.customer_name,
      exceptionType: "product_vendor_rejected",
      severity: r.hours_stuck > 24 ? "high" : "medium",
      title: `Produk Ditolak Customer — ${r.order_number}`,
      description: `Customer ${r.customer_name} menolak penawaran produk atau link approval expired. Order stuck di Product Vendor Selected selama ${Math.round(r.hours_stuck)} jam. Admin perlu negosiasi ulang atau pilih vendor lain.`,
    });
  }
  if ((rows.rows as any[]).length > 0) {
    await notifyAdmin(
      `🚫 *[EXCEPTION] Produk Ditolak Customer*\n${(rows.rows as any[]).map((r: any) => `• ${r.order_number} — ${r.customer_name} (${Math.round(r.hours_stuck)} jam)`).join("\n")}`,
      "exception_product_vendor_rejected",
    );
  }
}

// ── Check: Product Stock Not Available (admin telah menandai stok tidak tersedia) ──
async function checkProductStockNotAvailable() {
  // Pastikan kolom ada dulu (idempotent)
  await db.execute(sql.raw(`
    ALTER TABLE logistic_orders
      ADD COLUMN IF NOT EXISTS product_stock_unavailable_at TIMESTAMPTZ
  `)).catch(() => {});

  const rows = await db.execute<{
    id: number; order_number: string; customer_name: string; flagged_at: string;
  }>(sql.raw(`
    SELECT lo.id, lo.order_number, lo.customer_name,
           lo.product_stock_unavailable_at::text AS flagged_at
    FROM logistic_orders lo
    WHERE lo.order_type = 'product_first'
      AND lo.product_stock_unavailable_at IS NOT NULL
      AND lo.status NOT IN ('Completed', 'Cancelled')
  `));

  for (const r of rows.rows as any[]) {
    await upsertException({
      orderId: r.id,
      orderNumber: r.order_number,
      customerName: r.customer_name,
      exceptionType: "product_stock_not_available",
      severity: "high",
      title: `Stok Produk Tidak Tersedia — ${r.order_number}`,
      description: `Admin menandai stok produk tidak tersedia untuk order ${r.order_number} (${r.customer_name}) sejak ${r.flagged_at?.slice(0, 10)}. Perlu tindakan: cari vendor alternatif atau informasikan customer.`,
    });
  }
}

// ── Check: Product Ready Date Delayed (ready_date lewat, belum Invoice) ───────
async function checkReadyDateDelayed() {
  const rows = await db.execute<{
    id: number; order_number: string; customer_name: string; product_ready_date: string;
  }>(sql.raw(`
    SELECT lo.id, lo.order_number, lo.customer_name, lo.product_ready_date
    FROM logistic_orders lo
    WHERE lo.order_type = 'product_first'
      AND lo.product_ready_date IS NOT NULL
      AND lo.product_ready_date::date < CURRENT_DATE
      AND lo.status NOT IN (
        'Invoice Issued', 'Payment Received', 'Completed', 'Cancelled'
      )
      AND lo.status NOT IN ('Ready for Pickup') -- handled by pickup_self_overdue
  `));

  for (const r of rows.rows as any[]) {
    await upsertException({
      orderId: r.id,
      orderNumber: r.order_number,
      customerName: r.customer_name,
      exceptionType: "product_ready_date_delayed",
      severity: "medium",
      title: `Tanggal Ready Terlewat — ${r.order_number}`,
      description: `Product ready date (${r.product_ready_date}) sudah terlewat untuk order ${r.order_number} (${r.customer_name}), namun order belum sampai tahap Invoice.`,
    });
  }
}

// ── Main scan ─────────────────────────────────────────────────────────────────
async function runScan() {
  await ensureOnce();
  logger.info(`${PREFIX} starting exception scan`);
  await Promise.allSettled([
    checkProductVendorRejected(),
    checkProductStockNotAvailable(),
    checkShipmentNotSelected(),
    checkShipmentRfqNoResponse(),
    checkPickupSelfOverdue(),
    checkReadyDateDelayed(),
  ]);
  logger.info(`${PREFIX} exception scan done`);
}

// ── Exports ───────────────────────────────────────────────────────────────────
export function startProductFirstExceptionWorker() {
  setTimeout(() => {
    runScan().catch((e: unknown) => logger.warn({ e }, `${PREFIX} scan error (non-fatal)`));
    setInterval(() => {
      runScan().catch((e: unknown) => logger.warn({ e }, `${PREFIX} scan error (non-fatal)`));
    }, INTERVAL_MS).unref();
  }, INITIAL_DELAY_MS).unref();

  logger.info(`${PREFIX} worker scheduled (interval=${INTERVAL_MS / 3600000}h, initial_delay=${INITIAL_DELAY_MS / 60000}min)`);
}
