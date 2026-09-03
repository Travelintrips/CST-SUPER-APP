/**
 * logisticOrderStatusService.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * SINGLE SOURCE OF TRUTH untuk perubahan logistic_orders.status.
 *
 * FASE 1 — Service layer tersedia. Route lama BELUM dimigrasikan.
 * FASE 2 — Route lama wajib call transitionLogisticOrderStatus() daripada
 *           update DB langsung.
 *
 * Aturan:
 *  - Semua transisi harus melewati LOGISTIC_ORDER_VALID_TRANSITIONS.
 *  - Idempotent: jika status sudah sama, return ok + alreadyAt: true.
 *  - Non-blocking: audit trail gagal tidak membatalkan transaksi.
 *  - Status dinormalisasi dari legacy values via normalizeStatus().
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { db } from "@workspace/db";
import { logisticOrdersTable, customerOrderLinksTable } from "@workspace/db";
import { and, eq, sql, desc } from "drizzle-orm";
import { normalizeStatus, CUSTOMER_WA_MESSAGES } from "../logisticStatusConstants.js";
import { logOrderStatusChange } from "../auditTrail.js";
import { logger } from "../logger.js";
import { writeAuditLog } from "../auditLog.js";
import { notifyCustomerPortal } from "../customerPortalNotificationService.js";

/** Status yang memicu notifikasi WA ke customer (In Progress sudah ditangani di confirm_fulfillment) */
export const CUSTOMER_NOTIFY_STATUS_SET = new Set([
  // Customer-facing lifecycle events. Keeping this list here makes the
  // transition service the only place that decides when customer WA is sent.
  "Order Received",
  "Admin Review",
  "Product RFQ Sent",
  "Product Quote Received",
  "Product Vendor Selected",
  "Customer Product Approval",
  "Shipment Selection Pending", // customer perlu pilih mode pengiriman
  "Ready for Pickup",           // produk siap dijemput
  "RFQ Sent",
  "Quote Received",
  "Customer Approval",
  "Vendor Confirmed",
  "In Progress",
  "Pickup", "In Transit", "Arrived", "Delivered", "POD Uploaded",
  "Invoice Issued", "Payment Received",
  "Completed", "Cancelled",
]);

// ── State Machine ─────────────────────────────────────────────────────────────
//
// Setiap key = status saat ini.
// Value = daftar status yang DIIZINKAN sebagai tujuan transisi.
//
// Prinsip:
//  - Maju (forward) mengikuti urutan STATUS_RANK.
//  - Mundur satu langkah diizinkan untuk koreksi operasional.
//  - "Cancelled" selalu bisa dicapai dari status manapun kecuali terminal.
//  - "Completed" dan "Cancelled" adalah terminal — tidak ada keluar.
//
// Edge tambahan (Phase 3K):
//  - "Admin Review" → "Vendor Confirmed":
//      Admin dapat langsung assign vendor tanpa melalui Customer Approval
//      (khusus alur trucking dan VMF order-based di mana harga sudah fix).
//  - "Vendor Confirmed" → "Admin Review":
//      Vendor menolak job order — order dikembalikan ke admin untuk
//      pilih vendor lain atau blast ulang. Tanpa edge ini order tersangkut.
//  - "RFQ Sent" → "Customer Approval":
//      Admin mendapat konfirmasi harga verbal dari vendor lalu langsung kirim
//      opsi ke customer tanpa harus marking "Quote Received" di sistem lebih dulu.
//
export const LOGISTIC_ORDER_VALID_TRANSITIONS: Record<string, string[]> = {
  "Order Received":    ["Admin Review", "Cancelled"],
  "Admin Review":      [
    "RFQ Sent", "Quote Received", "Customer Approval", "Vendor Confirmed",
    // Phase 2A: product-first path entry point
    "Product RFQ Sent",
    "Cancelled",
  ],
  // ── Phase 2A: Product-First transitions ───────────────────────────────────
  // These statuses are only used when orderType = "product_first".
  // The state machine itself is order-type-agnostic; enforcement of which
  // statuses apply to which order type is done at the endpoint level.
  "Product RFQ Sent":           ["Product Quote Received", "Admin Review", "Cancelled"],
  "Product Quote Received":     ["Product Vendor Selected", "Product RFQ Sent", "Admin Review", "Cancelled"],
  "Product Vendor Selected":    ["Customer Product Approval", "Product Quote Received", "Admin Review", "Cancelled"],
  "Customer Product Approval":  ["Shipment Selection Pending", "Product Vendor Selected", "Admin Review", "Cancelled"],
  "Shipment Selection Pending": ["RFQ Sent", "Ready for Pickup", "Customer Product Approval", "Admin Review", "Cancelled"],
  // Normal shipment flow must go through Pickup. Direct delivery from
  // Ready for Pickup is reserved for an explicit administrative force
  // transition with a recorded reason.
  "Ready for Pickup":           ["Pickup", "Cancelled"],
  // ─────────────────────────────────────────────────────────────────────────
  "RFQ Sent":          ["Quote Received", "Admin Review", "Customer Approval", "Cancelled"],
  "Quote Received":    ["Customer Approval", "RFQ Sent", "Admin Review", "Cancelled"],
  "Customer Approval": ["Vendor Confirmed", "Admin Review", "Cancelled"],
  "Vendor Confirmed":  ["In Progress", "Customer Approval", "Admin Review", "Cancelled"],
  "In Progress":       ["Pickup", "Vendor Confirmed", "Cancelled"],
  "Pickup":            ["In Transit", "In Progress", "Cancelled"],
  "In Transit":        ["Arrived", "Pickup", "Cancelled"],
  "Arrived":           ["Delivered", "In Transit", "Cancelled"],
  "Delivered":         ["POD Uploaded", "Arrived", "Cancelled"],
  "POD Uploaded":      ["Invoice Issued", "Delivered", "Cancelled"],
  "Invoice Issued":    ["Payment Received", "POD Uploaded", "Cancelled"],
  "Payment Received":  ["Completed", "Invoice Issued", "Cancelled"],
  "Completed":         [],
  "Cancelled":         [],
};

// ── Types ─────────────────────────────────────────────────────────────────────

export interface TransitionOptions {
  actorType?: string;
  actorId?: string | null;
  actorName?: string | null;
  ip?: string | null;
  source?: string;
  notes?: string | null;
  skipAudit?: boolean;
  /**
   * force=true bypassa LOGISTIC_ORDER_VALID_TRANSITIONS.
   * Hanya digunakan oleh admin super / script migrasi data.
   * Tidak boleh diekspos ke endpoint publik.
   * WAJIB disertai forceReason — dicatat ke audit trail.
   */
  force?: boolean;
  /** Alasan menggunakan force bypass. Wajib jika force=true. */
  forceReason?: string;
}

export interface TransitionResult {
  ok: boolean;
  orderId: number;
  orderNumber?: string | null;
  fromStatus?: string | null;
  toStatus?: string;
  /** true jika status sudah sama — operasi idempotent, tidak ada DB write */
  alreadyAt?: boolean;
  /** Daftar transisi valid dari status saat ini, untuk response API */
  allowedTransitions?: string[];
  error?: string;
}

// ── Core Function ─────────────────────────────────────────────────────────────

/**
 * Transisi status sebuah logistic order.
 *
 * @param orderId     - ID logistic_orders
 * @param rawNewStatus - Target status (boleh legacy value, akan dinormalisasi)
 * @param opts        - Actor info, source label, flags
 * @returns TransitionResult
 */
export async function transitionLogisticOrderStatus(
  orderId: number,
  rawNewStatus: string,
  opts: TransitionOptions = {},
): Promise<TransitionResult> {
  const newStatus = normalizeStatus(rawNewStatus);

  if (!(newStatus in LOGISTIC_ORDER_VALID_TRANSITIONS)) {
    return {
      ok: false,
      orderId,
      error: `Status "${rawNewStatus}" tidak dikenal atau belum didukung oleh state machine`,
    };
  }

  const [row] = await db
    .select({
      status: logisticOrdersTable.status,
      orderNumber: logisticOrdersTable.orderNumber,
      portalCustomerId: logisticOrdersTable.portalCustomerId,
    })
    .from(logisticOrdersTable)
    .where(eq(logisticOrdersTable.id, orderId));

  if (!row) {
    return { ok: false, orderId, error: `Order #${orderId} tidak ditemukan` };
  }

  const currentStatus = normalizeStatus(row.status);

  // Idempotency guard
  if (currentStatus === newStatus) {
    return {
      ok: true,
      orderId,
      orderNumber: row.orderNumber,
      fromStatus: currentStatus,
      toStatus: newStatus,
      alreadyAt: true,
    };
  }

  // State machine guard
  if (!opts.force) {
    const allowed = LOGISTIC_ORDER_VALID_TRANSITIONS[currentStatus] ?? [];
    if (!allowed.includes(newStatus)) {
      return {
        ok: false,
        orderId,
        orderNumber: row.orderNumber,
        fromStatus: currentStatus,
        toStatus: newStatus,
        allowedTransitions: allowed,
        error: `Transisi "${currentStatus}" → "${newStatus}" tidak diizinkan. Transisi valid: ${
          allowed.length > 0 ? allowed.join(", ") : "(status terminal)"
        }`,
      };
    }
  }

  // ── C3 FIX: forceReason WAJIB; log force bypass ke audit trail ──────────────
  if (opts.force) {
    if (!opts.forceReason) {
      logger.error(
        { orderId, from: row.status, to: newStatus, source: opts.source, actorType: opts.actorType },
        "[SECURITY] force=true tanpa forceReason — ditolak",
      );
      return {
        ok: false,
        orderId,
        fromStatus: row.status,
        toStatus: newStatus,
        allowedTransitions: [],
        error: "force=true membutuhkan forceReason yang tidak kosong",
      };
    }
    writeAuditLog({
      action: "force_status_transition",
      module: "logistic_order",
      referenceId: String(orderId),
      userId: opts.actorId ?? null,
      oldData: { status: row.status },
      newData: {
        status: newStatus,
        force: true,
        forceReason: opts.forceReason ?? "(tidak ada alasan)",
        actorType: opts.actorType ?? "system",
        source: opts.source ?? "logisticOrderStatusService",
        orderNumber: row.orderNumber,
      },
    });
  }
  // ─────────────────────────────────────────────────────────────────────────────

  // Update conditionally on the status that was read. This prevents two
  // concurrent requests from both committing the same logical transition and
  // both dispatching a customer notification.
  const updateResult = await db
    .update(logisticOrdersTable)
    .set({
      status: newStatus,
      updatedAt: new Date(),
      version: sql`${logisticOrdersTable.version} + 1`,
    } as any)
    .where(and(eq(logisticOrdersTable.id, orderId), eq(logisticOrdersTable.status, row.status)));

  if (updateResult.rowCount !== 1) {
    const [latest] = await db
      .select({ status: logisticOrdersTable.status })
      .from(logisticOrdersTable)
      .where(eq(logisticOrdersTable.id, orderId));
    if (latest && normalizeStatus(latest.status) === newStatus) {
      return {
        ok: true,
        orderId,
        orderNumber: row.orderNumber,
        fromStatus: newStatus,
        toStatus: newStatus,
        alreadyAt: true,
      };
    }
    return {
      ok: false,
      orderId,
      orderNumber: row.orderNumber,
      fromStatus: latest?.status ?? row.status,
      toStatus: newStatus,
      error: "Status order berubah bersamaan. Silakan ulangi dengan data terbaru.",
    };
  }

  // Audit trail — non-fatal
  if (!opts.skipAudit) {
    logOrderStatusChange({
      orderId,
      orderNumber: row.orderNumber,
      oldStatus: row.status,
      newStatus,
      changedByType: opts.actorType ?? "system",
      changedById: opts.actorId ?? null,
      changedByName: opts.actorName ?? null,
      changedByIp: opts.ip ?? null,
      notes: opts.notes ?? null,
      source: opts.source ?? "logisticOrderStatusService",
    }).catch((e: unknown) =>
      logger.warn({ e, orderId, newStatus }, "logOrderStatusChange failed — non-fatal"),
    );
  }

  logger.info(
    { orderId, orderNumber: row.orderNumber, from: row.status, to: newStatus, source: opts.source ?? "service" },
    "logisticOrder status transitioned",
  );

  await notifyCustomerPortal({
    portalCustomerId: row.portalCustomerId,
    eventKey: `logistic-order:${orderId}:status:${newStatus}`,
    type: "logistic_order_status_changed",
    title: "Status layanan diperbarui",
    message: `Order ${row.orderNumber} sekarang berstatus ${newStatus}.`,
    payload: {
      service: "custom-clearance",
      orderId,
      orderNumber: row.orderNumber,
      status: newStatus,
    },
  });

  // ── Customer WA notification (non-blocking) ───────────────────────────────
  if (CUSTOMER_NOTIFY_STATUS_SET.has(newStatus) && CUSTOMER_WA_MESSAGES[newStatus]) {
    sendCustomerStatusWa(orderId, row.orderNumber ?? "", newStatus).catch((e) =>
      logger.warn({ e, orderId, newStatus }, "sendCustomerStatusWa failed — non-fatal"),
    );
  }

  return {
    ok: true,
    orderId,
    orderNumber: row.orderNumber,
    fromStatus: row.status,
    toStatus: newStatus,
  };
}

// ── Customer WA helper ────────────────────────────────────────────────────────

async function sendCustomerStatusWa(orderId: number, orderNumber: string, newStatus: string) {
  // Ambil phone + nama customer
  const [order] = await db
    .select({
      phone:        logisticOrdersTable.phone,
      customerName: logisticOrdersTable.customerName,
    })
    .from(logisticOrdersTable)
    .where(eq(logisticOrdersTable.id, orderId));

  const customerPhone = (order?.phone ?? "").trim();
  const context = `customer-logistic-order:${newStatus}`;
  const refId = `${orderId}:${newStatus}`;
  if (!customerPhone) {
    const { logNotification } = await import("../notificationLog.js");
    await logNotification({
      channel: "wa",
      recipient: "(empty)",
      message: `Customer status ${newStatus} untuk order ${orderNumber}`,
      status: "skipped",
      errorMsg: "Nomor WhatsApp customer kosong",
      context,
      refType: "logistic_order",
      refId,
    });
    return;
  }

  const digits = customerPhone.replace(/[^\d+]/g, "").replace(/^\+/, "");
  if (digits.length < 8) {
    const { logNotification } = await import("../notificationLog.js");
    await logNotification({
      channel: "wa",
      recipient: "(invalid)",
      message: `Customer status ${newStatus} untuk order ${orderNumber}`,
      status: "skipped",
      errorMsg: "Nomor WhatsApp customer tidak valid",
      context,
      refType: "logistic_order",
      refId,
    });
    return;
  }

  // Ambil tracking token (jika ada)
  const { getRequiredPublicDomain } = await import("../domain.js");
  let domain: string | null = null;
  try {
    domain = getRequiredPublicDomain();
  } catch (error) {
    logger.warn({ error, orderId }, "Public tracking domain is not configured; sending notification without tracking link");
  }
  let trackingUrl: string | undefined;
  try {
    const [link] = await db
      .select({ token: customerOrderLinksTable.token })
      .from(customerOrderLinksTable)
      .where(eq(customerOrderLinksTable.orderId, orderId))
      .orderBy(desc(customerOrderLinksTable.createdAt))
      .limit(1);
    if (link?.token && domain) trackingUrl = `https://${domain}/order-track/${link.token}`;
  } catch {
    // Tidak fatal — kirim tanpa link
  }

  const msgFn = CUSTOMER_WA_MESSAGES[newStatus];
  if (!msgFn) return;

  const { sendViaService } = await import("../waTransport.js");
  await sendViaService(customerPhone, msgFn(orderNumber, trackingUrl), {
    context,
    refType: "logistic_order",
    refId,
  });
}

// ── Convenience Helpers ───────────────────────────────────────────────────────

/** Ambil allowed transitions dari status saat ini (setelah normalisasi). */
export function getAllowedTransitions(currentRawStatus: string): string[] {
  const normalized = normalizeStatus(currentRawStatus);
  return LOGISTIC_ORDER_VALID_TRANSITIONS[normalized] ?? [];
}

/** Cek apakah sebuah transisi valid tanpa melakukan DB query. */
export function isTransitionAllowed(fromRaw: string, toRaw: string): boolean {
  const from = normalizeStatus(fromRaw);
  const to = normalizeStatus(toRaw);
  return (LOGISTIC_ORDER_VALID_TRANSITIONS[from] ?? []).includes(to);
}

// ── Freight → Logistic Propagation ───────────────────────────────────────────
//
// Satu arah: freight_shipments.status berubah → logistic_orders.status ikut.
// Tidak ada propagasi balik (anti infinite-loop).
// "draft" tidak memiliki padanan → diabaikan.
//
const FREIGHT_TO_LOGISTIC_MAP: Record<string, string> = {
  rfq_sent:   "RFQ Sent",
  confirmed:  "Vendor Confirmed",
  pickup:     "Pickup",
  in_transit: "In Transit",
  arrived:    "Arrived",
  completed:  "Delivered",
  cancelled:  "Cancelled",
};

/**
 * Saat freight_shipments.status berubah, cari logistic_order yang terhubung
 * via logistic_order_rfqs.freight_shipment_id dan transisi statusnya.
 *
 * NON-FATAL : error di sini TIDAK membatalkan operasi freight.
 * ONE-WAY   : fungsi ini TIDAK mengupdate freight_shipments → anti-loop.
 * IDEMPOTENT: transitionLogisticOrderStatus() punya guard alreadyAt.
 */
export async function propagateFreightToLogistic(
  freightShipmentId: number,
  newFreightStatus: string,
  opts: { source?: string; actorType?: string; actorName?: string | null } = {},
): Promise<void> {
  const targetLogisticStatus = FREIGHT_TO_LOGISTIC_MAP[newFreightStatus];
  if (!targetLogisticStatus) return; // "draft" dan status tak dikenal → skip

  try {
    // freight_shipment_id adalah kolom migrasi — harus pakai raw SQL
    const result = await db.execute(sql`
      SELECT lo.id, lo.order_number AS "orderNumber", lo.status
      FROM logistic_orders lo
      JOIN logistic_order_rfqs lor ON lor.order_id = lo.id
      WHERE lor.freight_shipment_id = ${freightShipmentId}
      ORDER BY lor.created_at DESC
      LIMIT 1
    `);

    const row = result.rows[0] as
      | { id: number; orderNumber: string; status: string }
      | undefined;
    if (!row) return; // tidak ada logistic order terhubung → skip

    await transitionLogisticOrderStatus(row.id, targetLogisticStatus, {
      actorType: opts.actorType ?? "system",
      actorName: opts.actorName ?? null,
      source: opts.source ?? `freight:${newFreightStatus}`,
      force: false,    // ikuti state machine; jika status sudah lebih maju → idempotency guard
      skipAudit: false,
    });
  } catch (e) {
    logger.warn(
      { e, freightShipmentId, newFreightStatus },
      "propagateFreightToLogistic failed — non-fatal",
    );
  }
}
