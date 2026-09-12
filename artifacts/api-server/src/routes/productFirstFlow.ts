/**
 * productFirstFlow.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 2A: Product-First Shipment Flow — backend endpoints.
 *
 * Semua endpoint ini HANYA berlaku untuk orderType = "product_first".
 * Flow lama (orderType = "shipment") tidak tersentuh sama sekali.
 *
 * Endpoints:
 *   POST /:id/product-rfq             — Admin blast RFQ ke vendor produk
 *   POST /:id/select-product-vendor   — Admin pilih vendor produk
 *   POST /:id/send-product-approval   — Admin kirim approval ke customer
 *   POST /:token/customer-product-approve — PUBLIC: customer approve/reject
 *   POST /:id/select-shipment-mode    — Pilih mode pengiriman setelah produk confirmed
 *   POST /:id/shipment-rfq            — Admin blast RFQ ke shipper (dengan 422 guard)
 *
 * ATURAN:
 *  - Semua perubahan status WAJIB melalui transitionLogisticOrderStatus().
 *  - Tidak ada direct db.update pada field status.
 *  - JANGAN gunakan db.execute(sql`...${param}...`) — gunakan Drizzle fluent API
 *    agar kompatibel dengan Supabase PgBouncer transaction-mode pooler.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { Router, type Request, type Response } from "express";
import { randomBytes } from "crypto";
import { eq, sql, and, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  logisticOrdersTable,
  logisticOrderRfqsTable,
  rfqVendorLinksTable,
  suppliersTable,
  vendorMiniFormLinksTable,
  customerOrderLinksTable,
} from "@workspace/db";
import { requireClerkUser } from "../lib/requireAdmin.js";
import { transitionLogisticOrderStatus } from "../lib/services/logisticOrderStatusService.js";
import { sendViaService as sendWhatsApp } from "../lib/waTransport.js";
import {
  sendProductRfqVendorWa,
  sendShipmentSelectionCustomerWa,
  sendShipmentModeSelectedAdminWa,
  sendShipmentRfqVendorWa,
  sendReadyForPickupCustomerWa,
} from "../lib/orderNotification.js";
import { getPreferredDomain } from "../lib/domain.js";
import { logger } from "../lib/logger.js";

export const productFirstFlowRouter = Router();

// ── Helpers ────────────────────────────────────────────────────────────────────

function generateToken(): string {
  // P0.2 — 256-bit secure token (upgraded from 128-bit)
  const { randomBytes: rb } = require("crypto") as typeof import("crypto");
  return rb(32).toString("hex");
}

function generateRfqNumber(): string {
  const ts = Date.now().toString(36).toUpperCase();
  const rnd = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `PRFQ-${ts}-${rnd}`;
}

/** Guard: hanya untuk product_first orders. Menggunakan Drizzle fluent API. */
async function requireProductFirstOrder(id: number): Promise<
  | { ok: true; order: typeof logisticOrdersTable.$inferSelect }
  | { ok: false; status: number; error: string }
> {
  const [order] = await db
    .select()
    .from(logisticOrdersTable)
    .where(eq(logisticOrdersTable.id, id))
    .limit(1);

  if (!order) return { ok: false, status: 404, error: "Order tidak ditemukan" };
  if (order.orderType !== "product_first") {
    return {
      ok: false,
      status: 400,
      error: `Endpoint ini hanya untuk orderType="product_first". Order ini adalah "${order.orderType}".`,
    };
  }
  return { ok: true, order };
}

// ── 1. POST /:id/product-rfq ─────────────────────────────────────────────────
// Admin blast RFQ produk ke vendor-vendor produk.
// Membuat record logistic_order_rfqs (rfqType=product) + rfq_vendor_links (rfqType=product_rfq)
// + VMF links (mode=product_vendor) per vendor.
// Transisi ke "Product RFQ Sent".
productFirstFlowRouter.post("/:id/product-rfq", requireClerkUser, async (req: Request, res: Response) => {
  const orderId = parseInt(String(req.params.id), 10);
  if (isNaN(orderId)) return res.status(400).json({ error: "ID tidak valid" });

  const { vendorIds, notes, responseDeadline, expiresInDays } = req.body as {
    vendorIds?: number[];
    notes?: string;
    responseDeadline?: string;
    expiresInDays?: number;
  };

  if (!Array.isArray(vendorIds) || vendorIds.length === 0) {
    return res.status(400).json({ error: "vendorIds wajib diisi (min 1 vendor)" });
  }

  const guard = await requireProductFirstOrder(orderId);
  if (!guard.ok) return res.status(guard.status).json({ error: guard.error });
  const order = guard.order;

  const deadlineDate = responseDeadline ? new Date(responseDeadline) : null;
  const expireDate = expiresInDays
    ? new Date(Date.now() + expiresInDays * 86_400_000)
    : deadlineDate;

  const rfqNumber = generateRfqNumber();
  const domain = getPreferredDomain() || "cstlogistic.co.id";

  // ── Step 2 (parallel): INSERT rfqs + SELECT suppliers ─────────────────────
  const [rfqResult, vendors] = await Promise.all([
    db
      .insert(logisticOrderRfqsTable)
      .values({
        orderId,
        rfqNumber,
        vendorIds: [],
        notes: notes ?? null,
        status: "open",
        rfqType: "product",
        phase: "product_phase",
        responseDeadline: deadlineDate ?? null,
      })
      .returning({ id: logisticOrderRfqsTable.id }),
    db
      .select({
        id: suppliersTable.id,
        name: suppliersTable.name,
        phone: suppliersTable.phone,
        contactPerson: suppliersTable.contactPerson,
      })
      .from(suppliersTable)
      .where(inArray(suppliersTable.id, vendorIds)),
  ]);

  const rfqId = rfqResult[0].id;

  // Pre-generate tokens so we can run all INSERTs in parallel
  const vendorPayloads = vendors.map((vendor) => {
    const linkToken = generateToken();
    return { vendor, linkToken, formUrl: `https://${domain}/vendor-form/${linkToken}` };
  });

  // ── Step 3 (parallel): UPDATE product_rfq_id + all per-vendor INSERTs ─────
  await Promise.all([
    db
      .update(logisticOrdersTable)
      .set({ productRfqId: rfqId, updatedAt: new Date() })
      .where(eq(logisticOrdersTable.id, orderId)),
    ...vendorPayloads.map(({ vendor, linkToken, formUrl }) =>
      Promise.all([
        db.insert(rfqVendorLinksTable).values({
          rfqId,
          vendorId: vendor.id,
          token: linkToken,
          status: "waiting_response",
          rfqType: "product_rfq",
          expiredAt: expireDate ?? null,
        }),
        db.insert(vendorMiniFormLinksTable).values({
          token: linkToken,
          supplierId: vendor.id,
          serviceType: "product_vendor",
          mode: "product_vendor",
          orderId,
          orderNumber: order.orderNumber ?? "",
          vendorName: vendor.name,
          isActive: true,
          formTarget: "vendor",
          phase: "quotation",
          adminNotes: notes ?? null,
          expiresAt: expireDate ?? null,
        }),
      ])
    ),
  ]);

  const vmfLinks = vendorPayloads.map(({ vendor, linkToken, formUrl }) => {
    // Fire-and-forget WA notifications (refId per-vendor agar tidak dedup)
    if (vendor.phone) {
      sendProductRfqVendorWa({
        vendorPhone: vendor.phone,
        vendorId: vendor.id,
        orderId,
        orderNumber: order.orderNumber ?? "",
        rfqNumber,
        commodity: order.commodity ?? null,
        origin: order.origin ?? null,
        destination: order.destination ?? null,
        formUrl,
        notes: notes ?? null,
      });
    }
    return { vendorId: vendor.id, token: linkToken, formUrl };
  });

  const tr = await transitionLogisticOrderStatus(orderId, "Product RFQ Sent", {
    actorType: "admin",
    actorId: (req as any).user?.id ?? null,
    actorName: (req as any).user?.name ?? null,
    source: "productFirstFlow:product-rfq",
    notes: `Product RFQ ${rfqNumber} dikirim ke ${vendors.length} vendor`,
  });

  if (!tr.ok) {
    return res.status(422).json({
      error: `Gagal transisi status: ${tr.error}`,
      allowedTransitions: tr.allowedTransitions,
    });
  }

  return res.status(201).json({
    rfqId,
    rfqNumber,
    vendorCount: vendors.length,
    vmfLinks,
    status: tr.toStatus,
  });
});

// ── 2. POST /:id/select-product-vendor ───────────────────────────────────────
// Admin memilih vendor produk dari penawaran yang masuk.
// Menyimpan productVendorId, productReadyDate, productPickupLocation, dll.
// Transisi ke "Product Vendor Selected".
productFirstFlowRouter.post("/:id/select-product-vendor", requireClerkUser, async (req: Request, res: Response) => {
  const orderId = parseInt(String(req.params.id), 10);
  if (isNaN(orderId)) return res.status(400).json({ error: "ID tidak valid" });

  const { vendorId, price, readyDate, pickupLocation, qtyConfirmed, notes } = req.body as {
    vendorId?: number;
    price?: number;
    readyDate?: string;
    pickupLocation?: string;
    qtyConfirmed?: number;
    notes?: string;
  };

  if (!vendorId) return res.status(400).json({ error: "vendorId wajib diisi" });

  const guard = await requireProductFirstOrder(orderId);
  if (!guard.ok) return res.status(guard.status).json({ error: guard.error });

  const [vendor] = await db
    .select({ id: suppliersTable.id, name: suppliersTable.name })
    .from(suppliersTable)
    .where(eq(suppliersTable.id, vendorId));
  if (!vendor) return res.status(404).json({ error: "Vendor tidak ditemukan" });

  // UPDATE logistic_orders — fluent API
  await db
    .update(logisticOrdersTable)
    .set({
      productVendorId: vendorId,
      productVendorConfirmedAt: new Date(),
      productReadyDate: readyDate ?? null,
      productPickupLocation: pickupLocation ?? null,
      productQtyConfirmed: qtyConfirmed ? String(qtyConfirmed) : null,
      productPrice: price ? String(price) : null,
      updatedAt: new Date(),
    })
    .where(eq(logisticOrdersTable.id, orderId));

  const tr = await transitionLogisticOrderStatus(orderId, "Product Vendor Selected", {
    actorType: "admin",
    actorId: (req as any).user?.id ?? null,
    actorName: (req as any).user?.name ?? null,
    source: "productFirstFlow:select-product-vendor",
    notes: `Vendor produk dipilih: ${vendor.name} (ID ${vendorId})${notes ? ` — ${notes}` : ""}`,
  });

  if (!tr.ok) {
    return res.status(422).json({
      error: `Gagal transisi status: ${tr.error}`,
      allowedTransitions: tr.allowedTransitions,
    });
  }

  return res.json({
    vendorId,
    vendorName: vendor.name,
    productReadyDate: readyDate ?? null,
    productPickupLocation: pickupLocation ?? null,
    status: tr.toStatus,
  });
});

// ── 3. POST /:id/send-product-approval ───────────────────────────────────────
// Admin mengirim link approval harga produk ke customer.
// Menggenerate customerProductApprovalToken dan mengirim WA ke customer.
// Transisi ke "Customer Product Approval".
productFirstFlowRouter.post("/:id/send-product-approval", requireClerkUser, async (req: Request, res: Response) => {
  const orderId = parseInt(String(req.params.id), 10);
  if (isNaN(orderId)) return res.status(400).json({ error: "ID tidak valid" });

  const guard = await requireProductFirstOrder(orderId);
  if (!guard.ok) return res.status(guard.status).json({ error: guard.error });
  const order = guard.order;

  // Generate token (idempotent: reuse existing jika ada)
  const existingToken = order.customerProductApprovalToken;
  const approvalToken = existingToken ?? generateToken();

  if (!existingToken) {
    await db
      .update(logisticOrdersTable)
      .set({ customerProductApprovalToken: approvalToken, updatedAt: new Date() })
      .where(eq(logisticOrdersTable.id, orderId));
  }

  const domain = getPreferredDomain() || "cstlogistic.co.id";
  const approvalUrl = `https://${domain}/product-approve/${approvalToken}`;

  // WA ke customer
  const customerPhone = (order.phone ?? "").trim();
  if (customerPhone) {
    const price = req.body?.sellingPrice;
    const msg =
      `✅ *Penawaran Harga Produk*\n` +
      `━━━━━━━━━━━━━━━━\n` +
      `No Order : *${order.orderNumber ?? ""}*\n` +
      `Produk   : ${order.commodity ?? "-"}\n` +
      (price ? `Harga    : Rp ${Number(price).toLocaleString("id-ID")}\n` : "") +
      (order.productReadyDate ? `Siap     : ${order.productReadyDate}\n` : "") +
      (order.productPickupLocation ? `Lokasi   : ${order.productPickupLocation}\n` : "") +
      `\nSilakan klik link berikut untuk menyetujui atau menolak harga produk:\n` +
      `🔗 ${approvalUrl}\n\n` +
      `Link ini berlaku selama 48 jam. Terima kasih!`;

    sendWhatsApp(customerPhone, msg, {
      context: "product-approval-send",
      refType: "logistic_order",
      refId: String(orderId),
    }).catch(() => {});
  }

  const tr = await transitionLogisticOrderStatus(orderId, "Customer Product Approval", {
    actorType: "admin",
    actorId: (req as any).user?.id ?? null,
    actorName: (req as any).user?.name ?? null,
    source: "productFirstFlow:send-product-approval",
    notes: "Link approval harga produk dikirim ke customer",
  });

  if (!tr.ok) {
    return res.status(422).json({
      error: `Gagal transisi status: ${tr.error}`,
      allowedTransitions: tr.allowedTransitions,
    });
  }

  return res.json({
    approvalToken,
    approvalUrl,
    customerPhone: customerPhone || null,
    status: tr.toStatus,
  });
});

// ── 4. POST /:token/customer-product-approve (PUBLIC) ─────────────────────────
// Customer menyetujui atau menolak harga produk via token.
// Tidak perlu auth — menggunakan token sebagai credential.
// approve → "Shipment Selection Pending"
// reject  → "Product Vendor Selected" (admin harus pilih vendor lain atau negosiasi)
productFirstFlowRouter.post("/:token/customer-product-approve", async (req: Request, res: Response) => {
  const { token } = req.params as { token: string };
  const { action, notes } = req.body as { action?: string; notes?: string };

  if (!action || !["approve", "reject"].includes(action)) {
    return res.status(400).json({ error: 'action wajib: "approve" atau "reject"' });
  }

  // Lookup by token — Drizzle fluent API
  const [order] = await db
    .select()
    .from(logisticOrdersTable)
    .where(eq(logisticOrdersTable.customerProductApprovalToken, token))
    .limit(1);

  if (!order) return res.status(404).json({ error: "Link tidak valid atau sudah kadaluarsa" });
  if (order.orderType !== "product_first") {
    return res.status(400).json({ error: "Link ini bukan untuk product-first order" });
  }

  if (action === "approve") {
    if (order.customerProductApprovedAt) {
      return res.json({ alreadyApproved: true, status: order.status });
    }

    await db
      .update(logisticOrdersTable)
      .set({ customerProductApprovedAt: new Date(), updatedAt: new Date() })
      .where(eq(logisticOrdersTable.id, order.id));

    const tr = await transitionLogisticOrderStatus(order.id, "Shipment Selection Pending", {
      actorType: "customer",
      source: "productFirstFlow:customer-product-approve",
      notes: `Customer menyetujui harga produk${notes ? `: ${notes}` : ""}`,
    });

    if (!tr.ok) {
      return res.status(422).json({ error: `Gagal transisi status: ${tr.error}` });
    }

    // WA ke customer — notifikasi produk disetujui + link pilih pengiriman
    const customerPhone = (order.phone ?? "").trim();
    const approvalTokenStr = order.customerProductApprovalToken ?? "";
    if (customerPhone && approvalTokenStr) {
      const domain = getPreferredDomain() || "cstlogistic.co.id";
      const selectionUrl = `https://${domain}/shipment-selection/${approvalTokenStr}`;
      sendShipmentSelectionCustomerWa({
        customerPhone,
        customerName: order.customerName ?? "",
        orderId: order.id,
        orderNumber: order.orderNumber ?? "",
        selectionUrl,
      });
    }

    return res.json({
      approved: true,
      orderNumber: order.orderNumber,
      status: tr.toStatus,
    });
  } else {
    // reject: kembalikan ke Product Vendor Selected
    const tr = await transitionLogisticOrderStatus(order.id, "Product Vendor Selected", {
      actorType: "customer",
      source: "productFirstFlow:customer-product-reject",
      notes: `Customer menolak harga produk${notes ? `: ${notes}` : ""}`,
    });

    if (!tr.ok) {
      return res.status(422).json({ error: `Gagal transisi status: ${tr.error}` });
    }

    return res.json({
      approved: false,
      orderNumber: order.orderNumber,
      status: tr.toStatus,
    });
  }
});

// ── 5. POST /:id/select-shipment-mode ────────────────────────────────────────
// Admin atau operator memilih mode pengiriman setelah harga produk diapprove.
// mode = "pickup_self" → transisi ke "Ready for Pickup"
// mode lainnya (trucking, air_freight, sea_freight, door_to_door)
//   → simpan shipmentMode, tetap di "Shipment Selection Pending" (admin blast shipment RFQ)
productFirstFlowRouter.post("/:id/select-shipment-mode", requireClerkUser, async (req: Request, res: Response) => {
  const orderId = parseInt(String(req.params.id), 10);
  if (isNaN(orderId)) return res.status(400).json({ error: "ID tidak valid" });

  const { mode, notes } = req.body as {
    mode?: string;
    notes?: string;
  };

  const VALID_MODES = ["pickup_self", "trucking", "air_freight", "sea_freight", "door_to_door"];
  if (!mode || !VALID_MODES.includes(mode)) {
    return res.status(400).json({
      error: "mode tidak valid",
      validModes: VALID_MODES,
    });
  }

  const guard = await requireProductFirstOrder(orderId);
  if (!guard.ok) return res.status(guard.status).json({ error: guard.error });

  // UPDATE logistic_orders.shipment_mode — fluent API
  await db
    .update(logisticOrdersTable)
    .set({
      shipmentMode: mode,
      shipmentModeSelectedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(logisticOrdersTable.id, orderId));

  if (mode === "pickup_self") {
    const tr = await transitionLogisticOrderStatus(orderId, "Ready for Pickup", {
      actorType: "admin",
      actorId: (req as any).user?.id ?? null,
      actorName: (req as any).user?.name ?? null,
      source: "productFirstFlow:select-shipment-mode",
      notes: `Mode pengiriman dipilih: pickup_self${notes ? ` — ${notes}` : ""}`,
    });

    if (!tr.ok) {
      return res.status(422).json({
        error: `Gagal transisi status: ${tr.error}`,
        allowedTransitions: tr.allowedTransitions,
      });
    }

    // WA ke customer — produk siap diambil
    const customerPhone = (guard.order.phone ?? "").trim();
    if (customerPhone) {
      sendReadyForPickupCustomerWa({
        customerPhone,
        customerName: guard.order.customerName ?? "",
        orderId,
        orderNumber: guard.order.orderNumber ?? "",
        pickupLocation: guard.order.productPickupLocation ?? null,
        readyDate: guard.order.productReadyDate ?? null,
      });
    }

    return res.json({ shipmentMode: mode, status: tr.toStatus, readyForPickup: true });
  }

  // WA ke admin — customer memilih mode pengiriman non-pickup
  sendShipmentModeSelectedAdminWa({
    orderId,
    orderNumber: guard.order.orderNumber ?? "",
    customerName: guard.order.customerName ?? "",
    shipmentMode: mode,
  });

  return res.json({
    shipmentMode: mode,
    status: guard.order.status,
    message: `Mode "${mode}" disimpan. Jalankan POST /:id/shipment-rfq untuk blast RFQ ke shipper.`,
    readyForPickup: false,
  });
});

// ── 6. POST /:id/shipment-rfq ─────────────────────────────────────────────────
// Admin blast RFQ ke shipper/trucking setelah product phase selesai.
//
// GUARD (422): shipment RFQ TIDAK boleh dibuat jika:
//   - product_vendor_id belum ada
//   - customer_product_approved_at belum ada
//   - product_ready_date belum ada
//   - product_pickup_location belum ada
//
// Membuat logistic_order_rfqs (rfqType=shipment) + rfq_vendor_links + VMF links.
// Transisi ke "RFQ Sent".
productFirstFlowRouter.post("/:id/shipment-rfq", requireClerkUser, async (req: Request, res: Response) => {
  const orderId = parseInt(String(req.params.id), 10);
  if (isNaN(orderId)) return res.status(400).json({ error: "ID tidak valid" });

  const { vendorIds, notes, responseDeadline } = req.body as {
    vendorIds?: number[];
    notes?: string;
    responseDeadline?: string;
  };

  if (!Array.isArray(vendorIds) || vendorIds.length === 0) {
    return res.status(400).json({ error: "vendorIds wajib diisi (min 1 vendor)" });
  }

  const guard = await requireProductFirstOrder(orderId);
  if (!guard.ok) return res.status(guard.status).json({ error: guard.error });
  const order = guard.order;

  // ── 422 Guard: product phase wajib lengkap ─────────────────────────────────
  const missingFields: string[] = [];
  if (!order.productVendorId) missingFields.push("product_vendor_id (vendor produk belum dipilih)");
  if (!order.customerProductApprovedAt) missingFields.push("customer_product_approved_at (customer belum approve harga produk)");
  if (!order.productReadyDate) missingFields.push("product_ready_date (tanggal siap produk belum diisi)");
  if (!order.productPickupLocation) missingFields.push("product_pickup_location (lokasi pickup produk belum diisi)");

  if (missingFields.length > 0) {
    return res.status(422).json({
      error: "Shipment RFQ tidak dapat dibuat — product phase belum lengkap",
      missingFields,
      hint: "Selesaikan product RFQ → select-product-vendor → send-product-approval → customer-product-approve terlebih dahulu",
    });
  }

  const deadlineDate = responseDeadline ? new Date(responseDeadline) : null;

  const rfqNumber = generateRfqNumber().replace("PRFQ", "SRFQ");

  // INSERT logistic_order_rfqs — fluent API
  const [rfqRow] = await db
    .insert(logisticOrderRfqsTable)
    .values({
      orderId,
      rfqNumber,
      vendorIds: [],
      notes: notes ?? null,
      status: "open",
      rfqType: "shipment",
      phase: "shipment_phase",
      responseDeadline: deadlineDate ?? null,
    })
    .returning({ id: logisticOrderRfqsTable.id });

  const rfqId = rfqRow.id;

  // UPDATE logistic_orders.shipment_rfq_id — fluent API
  await db
    .update(logisticOrdersTable)
    .set({ shipmentRfqId: rfqId, updatedAt: new Date() })
    .where(eq(logisticOrdersTable.id, orderId));

  const vendors = await db
    .select({
      id: suppliersTable.id,
      name: suppliersTable.name,
      phone: suppliersTable.phone,
    })
    .from(suppliersTable)
    .where(inArray(suppliersTable.id, vendorIds));

  const domain = getPreferredDomain() || "cstlogistic.co.id";
  const vmfLinks: { vendorId: number; token: string; formUrl: string }[] = [];

  for (const vendor of vendors) {
    const linkToken = generateToken();
    const formUrl = `https://${domain}/vendor-form/${linkToken}`;

    // INSERT rfq_vendor_links — fluent API
    await db.insert(rfqVendorLinksTable).values({
      rfqId,
      vendorId: vendor.id,
      token: linkToken,
      status: "waiting_response",
      rfqType: "shipment_rfq",
      expiredAt: deadlineDate ?? null,
    });

    // INSERT vendor_mini_form_links — fluent API
    await db.insert(vendorMiniFormLinksTable).values({
      token: linkToken,
      supplierId: vendor.id,
      serviceType: order.shipmentMode ?? "trucking",
      mode: "order_based",
      orderId,
      orderNumber: order.orderNumber ?? "",
      vendorName: vendor.name,
      isActive: true,
      formTarget: "vendor",
      phase: "quotation",
      adminNotes: notes ?? null,
      expiresAt: deadlineDate ?? null,
    });

    vmfLinks.push({ vendorId: vendor.id, token: linkToken, formUrl });

    // WA ke vendor shipper (refId per-vendor agar tidak dedup antar vendor)
    if (vendor.phone) {
      sendShipmentRfqVendorWa({
        vendorPhone: vendor.phone,
        vendorId: vendor.id,
        orderId,
        orderNumber: order.orderNumber ?? "",
        rfqNumber,
        commodity: order.commodity ?? null,
        pickupLocation: order.productPickupLocation ?? null,
        destination: order.destination ?? null,
        readyDate: order.productReadyDate ?? null,
        formUrl,
        notes: notes ?? null,
      });
    }
  }

  const tr = await transitionLogisticOrderStatus(orderId, "RFQ Sent", {
    actorType: "admin",
    actorId: (req as any).user?.id ?? null,
    actorName: (req as any).user?.name ?? null,
    source: "productFirstFlow:shipment-rfq",
    notes: `Shipment RFQ ${rfqNumber} dikirim ke ${vendors.length} vendor`,
  });

  if (!tr.ok) {
    return res.status(422).json({
      error: `Gagal transisi status: ${tr.error}`,
      allowedTransitions: tr.allowedTransitions,
    });
  }

  return res.status(201).json({
    rfqId,
    rfqNumber,
    vendorCount: vendors.length,
    vmfLinks,
    status: tr.toStatus,
  });
});

// ── GET /:id/product-phase — ringkasan product phase untuk admin ──────────────
productFirstFlowRouter.get("/:id/product-phase", requireClerkUser, async (req: Request, res: Response) => {
  const orderId = parseInt(String(req.params.id), 10);
  if (isNaN(orderId)) return res.status(400).json({ error: "ID tidak valid" });

  // SELECT dengan JOIN — gunakan sql.raw dengan orderId integer (aman karena sudah parseInt)
  const rows = await db.execute(
    sql.raw(`
      SELECT
        lo.id, lo.order_number AS "orderNumber", lo.status, lo.order_type AS "orderType",
        lo.product_rfq_id AS "productRfqId",
        lo.product_vendor_id AS "productVendorId",
        lo.product_vendor_confirmed_at AS "productVendorConfirmedAt",
        lo.product_ready_date AS "productReadyDate",
        lo.product_pickup_location AS "productPickupLocation",
        lo.product_qty_confirmed AS "productQtyConfirmed",
        lo.product_price AS "productPrice",
        lo.shipment_rfq_id AS "shipmentRfqId",
        lo.shipment_mode AS "shipmentMode",
        lo.shipment_mode_selected_at AS "shipmentModeSelectedAt",
        lo.customer_product_approval_token AS "customerProductApprovalToken",
        lo.customer_product_approved_at AS "customerProductApprovedAt",
        s.name AS "productVendorName"
      FROM logistic_orders lo
      LEFT JOIN suppliers s ON s.id = lo.product_vendor_id
      WHERE lo.id = ${orderId}
    `),
  );

  const row = rows.rows[0] as Record<string, unknown> | undefined;
  if (!row) return res.status(404).json({ error: "Order tidak ditemukan" });

  const domain = getPreferredDomain() || "cstlogistic.co.id";
  const approvalUrl = row.customerProductApprovalToken
    ? `https://${domain}/product-approve/${row.customerProductApprovalToken}`
    : null;

  const guardFields = {
    hasProductVendor: !!row.productVendorId,
    hasCustomerApproval: !!row.customerProductApprovedAt,
    hasProductReadyDate: !!row.productReadyDate,
    hasProductPickupLocation: !!row.productPickupLocation,
  };
  const shipmentRfqReady = Object.values(guardFields).every(Boolean);

  return res.json({
    ...row,
    approvalUrl,
    shipmentRfqReady,
    guardFields,
  });
});
