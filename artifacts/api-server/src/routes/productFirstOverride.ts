/**
 * productFirstOverride.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Admin override endpoints untuk product-first orders.
 * SEMUA aksi override wajib masuk audit log (order_audit_logs).
 *
 * Mounted at: /api/logistic/orders  (via productFirstFlowRouter area)
 *
 * POST /:id/override/force-product-approve    — Force approve produk (skip customer)
 * POST /:id/override/change-shipment-mode     — Ubah mode pengiriman
 * POST /:id/override/reset-shipment-selection — Reset ke Shipment Selection Pending
 * POST /:id/override/resend-product-approval  — Kirim ulang link approval ke customer
 */

import { Router, type Request, type Response } from "express";
import { randomBytes } from "crypto";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireClerkUser } from "../lib/requireAdmin.js";
import { transitionLogisticOrderStatus } from "../lib/services/logisticOrderStatusService.js";
import { logOrderAudit, logOrderStatusChange } from "../lib/auditTrail.js";
import { sendViaService as sendWhatsApp } from "../lib/waTransport.js";
import { getPreferredDomain } from "../lib/domain.js";
import { logger } from "../lib/logger.js";

export const productFirstOverrideRouter = Router();

// ── Auth guard ────────────────────────────────────────────────────────────────
productFirstOverrideRouter.use(async (req: Request, res: Response, next) => {
  if (!(await requireClerkUser(req, res))) return;
  next();
});

// ── Inline migration (idempotent) ─────────────────────────────────────────────
db.execute(sql.raw(`
  ALTER TABLE order_audit_logs
    ADD COLUMN IF NOT EXISTS override_reason TEXT,
    ADD COLUMN IF NOT EXISTS override_by     TEXT
`)).catch(() => {});

// ── Helpers ───────────────────────────────────────────────────────────────────
function actorName(req: Request): string {
  const u = req.user as { email?: string; name?: string } | undefined;
  return (u as any)?.name ?? u?.email ?? "admin";
}

function actorId(req: Request): string | null {
  const u = req.user as { id?: string } | undefined;
  return u?.id ?? null;
}

async function getOrder(id: number): Promise<Record<string, unknown> | null> {
  const rows = await db.execute(sql`
    SELECT id, order_number AS "orderNumber", status, order_type AS "orderType",
           phone, customer_name AS "customerName",
           shipment_mode AS "shipmentMode",
           product_vendor_id AS "productVendorId",
           product_ready_date AS "productReadyDate",
           product_pickup_location AS "productPickupLocation",
           customer_product_approval_token AS "customerProductApprovalToken"
    FROM logistic_orders WHERE id = ${id}
  `);
  return (rows.rows[0] as Record<string, unknown>) ?? null;
}

async function writeOverrideAudit(opts: {
  orderId: number;
  orderNumber: string;
  action: string;
  reason: string;
  actorName: string;
  actorId: string | null;
  oldVal?: string;
  newVal?: string;
}) {
  await logOrderAudit({
    orderId: opts.orderId,
    actorType: "admin_override",
    actorId: opts.actorId ?? undefined,
    action: opts.action,
  });

  // Also insert a detailed override record directly into order_audit_logs
  await db.execute(sql.raw(`
    INSERT INTO order_audit_logs
      (order_id, actor_type, actor_id, action, old_data, new_data,
       override_reason, override_by, created_at)
    VALUES (
      ${opts.orderId},
      'admin_override',
      ${opts.actorId ? `'${opts.actorId.replace(/'/g, "''")}'` : "NULL"},
      '${opts.action.replace(/'/g, "''")}',
      ${opts.oldVal ? `'${JSON.stringify({ value: opts.oldVal }).replace(/'/g, "''")}'` : "NULL"},
      ${opts.newVal ? `'${JSON.stringify({ value: opts.newVal }).replace(/'/g, "''")}'` : "NULL"},
      '${opts.reason.replace(/'/g, "''")}',
      '${opts.actorName.replace(/'/g, "''")}',
      NOW()
    )
  `)).catch((e: unknown) => logger.warn({ e }, "writeOverrideAudit insert error — non-fatal"));
}

// ── POST /:id/override/force-product-approve ─────────────────────────────────
// Force approve produk — memindahkan order dari "Customer Product Approval"
// ke "Shipment Selection Pending" tanpa menunggu customer.
productFirstOverrideRouter.post("/:id/override/force-product-approve", async (req: Request, res: Response) => {
  const orderId = Number(String(req.params.id));
  if (isNaN(orderId)) return res.status(400).json({ error: "ID tidak valid" });

  const { reason } = req.body as { reason?: string };
  if (!reason?.trim()) return res.status(400).json({ error: "reason wajib diisi untuk override" });

  const order = await getOrder(orderId);
  if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });
  if (order.orderType !== "product_first") {
    return res.status(400).json({ error: "Hanya untuk product_first orders" });
  }

  const oldStatus = String(order.status);

  try {
    // Update approval token & timestamp
    await db.execute(sql`
      UPDATE logistic_orders
      SET customer_product_approved_at = NOW()
      WHERE id = ${orderId}
    `);

    // Force transition to Shipment Selection Pending
    const result = await transitionLogisticOrderStatus(
      orderId,
      "Shipment Selection Pending",
      {
        force: true,
        actorType: "admin_override",
        actorName: actorName(req),
        notes: `[OVERRIDE] Force product approve. Alasan: ${reason}`,
        source: "admin_override",
      },
    );

    if (!result.ok && (result as any).error !== "already_at_status") {
      return res.status(422).json({ error: (result as any).error });
    }

    await writeOverrideAudit({
      orderId,
      orderNumber: String(order.orderNumber),
      action: "override.force_product_approve",
      reason,
      actorName: actorName(req),
      actorId: actorId(req),
      oldVal: oldStatus,
      newVal: "Shipment Selection Pending",
    });

    logger.info({ orderId, actor: actorName(req), reason }, "override: force-product-approve");
    return res.json({ ok: true, newStatus: "Shipment Selection Pending" });
  } catch (err) {
    logger.error({ err, orderId }, "override: force-product-approve error");
    return res.status(500).json({ error: "Gagal melakukan override" });
  }
});

// ── POST /:id/override/change-shipment-mode ───────────────────────────────────
// Ubah mode pengiriman (shipment_mode) tanpa reset status.
productFirstOverrideRouter.post("/:id/override/change-shipment-mode", async (req: Request, res: Response) => {
  const orderId = Number(String(req.params.id));
  if (isNaN(orderId)) return res.status(400).json({ error: "ID tidak valid" });

  const { reason, shipmentMode } = req.body as { reason?: string; shipmentMode?: string };
  if (!reason?.trim()) return res.status(400).json({ error: "reason wajib diisi untuk override" });
  if (!shipmentMode || !["trucking", "pickup_self"].includes(shipmentMode)) {
    return res.status(400).json({ error: "shipmentMode harus 'trucking' atau 'pickup_self'" });
  }

  const order = await getOrder(orderId);
  if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });
  if (order.orderType !== "product_first") {
    return res.status(400).json({ error: "Hanya untuk product_first orders" });
  }

  const oldMode = String(order.shipmentMode ?? "null");

  try {
    await db.execute(sql`
      UPDATE logistic_orders
      SET shipment_mode = ${shipmentMode},
          shipment_mode_selected_at = NOW()
      WHERE id = ${orderId}
    `);

    await writeOverrideAudit({
      orderId,
      orderNumber: String(order.orderNumber),
      action: "override.change_shipment_mode",
      reason,
      actorName: actorName(req),
      actorId: actorId(req),
      oldVal: oldMode,
      newVal: shipmentMode,
    });

    logger.info({ orderId, oldMode, newMode: shipmentMode, actor: actorName(req) }, "override: change-shipment-mode");
    return res.json({ ok: true, shipmentMode });
  } catch (err) {
    logger.error({ err, orderId }, "override: change-shipment-mode error");
    return res.status(500).json({ error: "Gagal mengubah mode pengiriman" });
  }
});

// ── POST /:id/override/reset-shipment-selection ───────────────────────────────
// Reset order kembali ke "Shipment Selection Pending" dari status manapun.
productFirstOverrideRouter.post("/:id/override/reset-shipment-selection", async (req: Request, res: Response) => {
  const orderId = Number(String(req.params.id));
  if (isNaN(orderId)) return res.status(400).json({ error: "ID tidak valid" });

  const { reason } = req.body as { reason?: string };
  if (!reason?.trim()) return res.status(400).json({ error: "reason wajib diisi untuk override" });

  const order = await getOrder(orderId);
  if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });
  if (order.orderType !== "product_first") {
    return res.status(400).json({ error: "Hanya untuk product_first orders" });
  }

  const oldStatus = String(order.status);
  const oldMode = String(order.shipmentMode ?? "null");

  // Boleh reset dari status pengiriman saja (setelah customer product approval)
  const allowedFromStatuses = [
    "Shipment Selection Pending", "Ready for Pickup",
    "RFQ Sent", "Quote Received", "Customer Approval", "Vendor Confirmed",
    "In Progress", "Pickup",
  ];
  if (!allowedFromStatuses.includes(oldStatus)) {
    return res.status(422).json({
      error: `Tidak bisa reset dari status "${oldStatus}". Hanya bisa dari: ${allowedFromStatuses.join(", ")}`,
    });
  }

  try {
    // Clear shipment mode dan related fields
    await db.execute(sql`
      UPDATE logistic_orders
      SET shipment_mode = NULL,
          shipment_mode_selected_at = NULL,
          shipment_rfq_id = NULL
      WHERE id = ${orderId}
    `);

    // Force transition ke Shipment Selection Pending
    const result = await transitionLogisticOrderStatus(
      orderId,
      "Shipment Selection Pending",
      {
        force: true,
        actorType: "admin_override",
        actorName: actorName(req),
        notes: `[OVERRIDE] Reset shipment selection. Alasan: ${reason}`,
        source: "admin_override",
      },
    );

    if (!result.ok && (result as any).error !== "already_at_status") {
      return res.status(422).json({ error: (result as any).error });
    }

    await writeOverrideAudit({
      orderId,
      orderNumber: String(order.orderNumber),
      action: "override.reset_shipment_selection",
      reason,
      actorName: actorName(req),
      actorId: actorId(req),
      oldVal: `${oldStatus} / mode:${oldMode}`,
      newVal: "Shipment Selection Pending / mode:null",
    });

    logger.info({ orderId, oldStatus, actor: actorName(req), reason }, "override: reset-shipment-selection");
    return res.json({ ok: true, newStatus: "Shipment Selection Pending" });
  } catch (err) {
    logger.error({ err, orderId }, "override: reset-shipment-selection error");
    return res.status(500).json({ error: "Gagal mereset shipment selection" });
  }
});

// ── POST /:id/override/resend-product-approval ────────────────────────────────
// Kirim ulang (atau generate ulang) link approval produk ke customer via WA.
productFirstOverrideRouter.post("/:id/override/resend-product-approval", async (req: Request, res: Response) => {
  const orderId = Number(String(req.params.id));
  if (isNaN(orderId)) return res.status(400).json({ error: "ID tidak valid" });

  const { reason, regenerateToken } = req.body as {
    reason?: string;
    regenerateToken?: boolean;
  };
  if (!reason?.trim()) return res.status(400).json({ error: "reason wajib diisi untuk override" });

  const order = await getOrder(orderId);
  if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });
  if (order.orderType !== "product_first") {
    return res.status(400).json({ error: "Hanya untuk product_first orders" });
  }

  try {
    let token = String(order.customerProductApprovalToken ?? "");

    // Generate new token if requested or token doesn't exist
    if (regenerateToken || !token) {
      token = randomBytes(24).toString("hex");
      await db.execute(sql`
        UPDATE logistic_orders
        SET customer_product_approval_token = ${token}
        WHERE id = ${orderId}
      `);
    }

    const domain = getPreferredDomain() || "cstlogistic.co.id";
    const approvalUrl = `https://${domain}/product-approve/${token}`;
    const phone = String(order.phone ?? "");
    const customerName = String(order.customerName ?? "Customer");
    const orderNumber = String(order.orderNumber ?? "");

    // Send WA to customer
    if (phone) {
      const msg = [
        `📦 *Konfirmasi Produk — ${orderNumber}*`,
        `━━━━━━━━━━━━━━━━━━`,
        `Halo *${customerName}*,`,
        ``,
        `Tim B2B Marketplace and Logistic telah menyiapkan penawaran produk untuk pesanan Anda.`,
        `Silakan konfirmasi melalui link berikut:`,
        ``,
        `🔗 *${approvalUrl}*`,
        ``,
        `━━━━━━━━━━━━━━━━━━`,
        `_Dikirim ulang oleh admin. ${reason}_`,
      ].join("\n");

      await sendWhatsApp(phone, msg, {
        context: `override_resend_product_approval_${orderId}`,
        refId: String(orderId),
      } as any).catch((e: unknown) => logger.warn({ e }, "resend-product-approval WA send failed"));
    }

    await writeOverrideAudit({
      orderId,
      orderNumber,
      action: "override.resend_product_approval",
      reason,
      actorName: actorName(req),
      actorId: actorId(req),
      newVal: regenerateToken ? "token_regenerated" : "token_reused",
    });

    logger.info({ orderId, phone, actor: actorName(req) }, "override: resend-product-approval");
    return res.json({ ok: true, approvalUrl, tokenRegenerated: regenerateToken ?? false });
  } catch (err) {
    logger.error({ err, orderId }, "override: resend-product-approval error");
    return res.status(500).json({ error: "Gagal mengirim ulang approval link" });
  }
});

// ── Inline migration: kolom product_stock_unavailable_at ──────────────────────
db.execute(sql.raw(`
  ALTER TABLE logistic_orders
    ADD COLUMN IF NOT EXISTS product_stock_unavailable_at TIMESTAMPTZ
`)).catch(() => {});

// ── POST /:id/override/flag-stock-unavailable ─────────────────────────────────
// Tandai bahwa stok produk tidak tersedia. Transition ke "Product RFQ Sent" untuk
// memulai ulang pencarian vendor / stok.
productFirstOverrideRouter.post("/:id/override/flag-stock-unavailable", async (req: Request, res: Response) => {
  const orderId = Number(String(req.params.id));
  if (isNaN(orderId)) return res.status(400).json({ error: "ID tidak valid" });

  const { reason } = req.body as { reason?: string };
  if (!reason?.trim()) return res.status(400).json({ error: "reason wajib diisi untuk override" });

  const order = await getOrder(orderId);
  if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });
  if (order.orderType !== "product_first") {
    return res.status(400).json({ error: "Hanya untuk product_first orders" });
  }

  const oldStatus = String(order.status);

  try {
    // Tandai stok tidak tersedia + reset ke Product RFQ Sent agar admin bisa pilih vendor baru
    await db.execute(sql`
      UPDATE logistic_orders
      SET product_stock_unavailable_at = NOW(),
          product_vendor_id = NULL,
          product_vendor_confirmed_at = NULL,
          customer_product_approval_token = NULL,
          customer_product_approved_at = NULL,
          updated_at = NOW()
      WHERE id = ${orderId}
    `);

    const result = await transitionLogisticOrderStatus(orderId, "Product RFQ Sent", {
      force: true,
      actorType: "admin_override",
      actorName: actorName(req),
      notes: `[OVERRIDE] Stok produk tidak tersedia — reset ke Product RFQ Sent. Alasan: ${reason}`,
      source: "admin_override",
    });

    if (!result.ok && !result.alreadyAt) {
      return res.status(422).json({ error: result.error });
    }

    await writeOverrideAudit({
      orderId,
      orderNumber: String(order.orderNumber),
      action: "override.flag_stock_unavailable",
      reason,
      actorName: actorName(req),
      actorId: actorId(req),
      oldVal: oldStatus,
      newVal: "Product RFQ Sent (stock unavailable flagged)",
    });

    logger.info({ orderId, actor: actorName(req), reason }, "override: flag-stock-unavailable");
    return res.json({ ok: true, newStatus: "Product RFQ Sent", flagged: true });
  } catch (err) {
    logger.error({ err, orderId }, "override: flag-stock-unavailable error");
    return res.status(500).json({ error: "Gagal menandai stok tidak tersedia" });
  }
});

// ── POST /:id/override/clear-stock-unavailable ────────────────────────────────
// Hapus flag stok tidak tersedia (stok sudah tersedia kembali / vendor baru ditemukan).
productFirstOverrideRouter.post("/:id/override/clear-stock-unavailable", async (req: Request, res: Response) => {
  const orderId = Number(String(req.params.id));
  if (isNaN(orderId)) return res.status(400).json({ error: "ID tidak valid" });

  const { reason } = req.body as { reason?: string };
  if (!reason?.trim()) return res.status(400).json({ error: "reason wajib diisi untuk override" });

  const order = await getOrder(orderId);
  if (!order) return res.status(404).json({ error: "Order tidak ditemukan" });
  if (order.orderType !== "product_first") {
    return res.status(400).json({ error: "Hanya untuk product_first orders" });
  }

  try {
    await db.execute(sql`
      UPDATE logistic_orders
      SET product_stock_unavailable_at = NULL,
          updated_at = NOW()
      WHERE id = ${orderId}
    `);

    await writeOverrideAudit({
      orderId,
      orderNumber: String(order.orderNumber),
      action: "override.clear_stock_unavailable",
      reason,
      actorName: actorName(req),
      actorId: actorId(req),
      oldVal: "stock_unavailable",
      newVal: "stock_available",
    });

    logger.info({ orderId, actor: actorName(req), reason }, "override: clear-stock-unavailable");
    return res.json({ ok: true, flagCleared: true });
  } catch (err) {
    logger.error({ err, orderId }, "override: clear-stock-unavailable error");
    return res.status(500).json({ error: "Gagal menghapus flag stok" });
  }
});
