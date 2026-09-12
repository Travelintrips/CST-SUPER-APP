import { Router, type Request, type Response } from "express";
import { eq, and, desc, sql } from "drizzle-orm";
import {
  db,
  logisticVendorFulfillmentsTable,
  logisticOrdersTable,
  logisticOrderItemsTable,
  suppliersTable,
  vendorCatalogItemsTable,
  purchaseDocumentsTable,
  purchaseDocumentLinesTable,
} from "@workspace/db";
import { requireClerkUser } from "../lib/requireAdmin.js";
import { logOrderAudit } from "../lib/auditTrail.js";
import { logger } from "../lib/logger.js";

export const logisticVendorFulfillmentAdminRouter = Router();

const VALID_STATUSES = new Set(["pending", "confirmed", "in_progress", "completed", "cancelled"]);

const TRANSITIONS: Record<string, string[]> = {
  pending:     ["confirmed", "cancelled"],
  confirmed:   ["in_progress", "cancelled"],
  in_progress: ["completed", "cancelled"],
  completed:   [],
  cancelled:   [],
};

// ── Idempotent migration: vendor_po_id column ─────────────────────────────────
db.execute(sql`
  ALTER TABLE logistic_vendor_fulfillments
    ADD COLUMN IF NOT EXISTS vendor_po_id INTEGER
`).catch((err) => {
  logger.warn({ err: String(err) }, "vendor_po_id migration non-fatal");
});

// ── Helper: generate PO doc number ────────────────────────────────────────────
async function nextVendorPoNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const pattern = `PO/${year}/%`;
  const [row] = await db
    .select({
      maxSeq: sql<number>`COALESCE(MAX(CAST(SPLIT_PART(doc_number, '/', 3) AS int)), 0)`,
    })
    .from(purchaseDocumentsTable)
    .where(sql`doc_number LIKE ${pattern}`);
  const seq = (Number(row?.maxSeq ?? 0) + 1).toString().padStart(5, "0");
  return `PO/${year}/${seq}`;
}

// ─── GET / (list) ─────────────────────────────────────────────────────────────
logisticVendorFulfillmentAdminRouter.get("/", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  try {
    const status   = (req.query.status as string) || null;
    const orderId  = req.query.orderId ? parseInt(req.query.orderId as string, 10) : null;
    const vendorId = req.query.vendorId ? parseInt(req.query.vendorId as string, 10) : null;
    const page     = Math.max(1, Number(req.query.page ?? 1));
    const limit    = Math.min(100, Math.max(1, Number(req.query.limit ?? 50)));
    const offset   = (page - 1) * limit;

    const conditions = and(
      status ? eq(logisticVendorFulfillmentsTable.status, status) : undefined,
      orderId && !isNaN(orderId) ? eq(logisticVendorFulfillmentsTable.orderId, orderId) : undefined,
      vendorId && !isNaN(vendorId) ? eq(logisticVendorFulfillmentsTable.vendorId, vendorId) : undefined,
    );

    const rows = await db
      .select({
        id:           logisticVendorFulfillmentsTable.id,
        orderId:      logisticVendorFulfillmentsTable.orderId,
        orderItemId:  logisticVendorFulfillmentsTable.orderItemId,
        vendorId:     logisticVendorFulfillmentsTable.vendorId,
        serviceType:  logisticVendorFulfillmentsTable.serviceType,
        status:       logisticVendorFulfillmentsTable.status,
        vendorPoId:   logisticVendorFulfillmentsTable.vendorPoId,
        adminNotes:   logisticVendorFulfillmentsTable.adminNotes,
        createdAt:    logisticVendorFulfillmentsTable.createdAt,
        updatedAt:    logisticVendorFulfillmentsTable.updatedAt,
        orderNumber:  logisticOrdersTable.orderNumber,
        customerName: logisticOrdersTable.customerName,
        orderStatus:  logisticOrdersTable.status,
        vendorName:   suppliersTable.name,
      })
      .from(logisticVendorFulfillmentsTable)
      .leftJoin(logisticOrdersTable, eq(logisticOrdersTable.id, logisticVendorFulfillmentsTable.orderId))
      .leftJoin(suppliersTable, eq(suppliersTable.id, logisticVendorFulfillmentsTable.vendorId))
      .where(conditions)
      .orderBy(desc(logisticVendorFulfillmentsTable.createdAt))
      .limit(limit)
      .offset(offset);

    return res.json({ data: rows, page, limit });
  } catch (err) {
    logger.error({ err }, "[fulfillment-admin] GET / error");
    return res.status(500).json({ message: "Gagal memuat data fulfillment" });
  }
});

// ─── GET /:id ─────────────────────────────────────────────────────────────────
logisticVendorFulfillmentAdminRouter.get("/:id", requireClerkUser, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id) ?? "", 10);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });

  const [vf] = await db
    .select({
      id:                 logisticVendorFulfillmentsTable.id,
      orderId:            logisticVendorFulfillmentsTable.orderId,
      orderItemId:        logisticVendorFulfillmentsTable.orderItemId,
      vendorCatalogItemId: logisticVendorFulfillmentsTable.vendorCatalogItemId,
      vendorId:           logisticVendorFulfillmentsTable.vendorId,
      serviceType:        logisticVendorFulfillmentsTable.serviceType,
      status:             logisticVendorFulfillmentsTable.status,
      vendorPoId:         logisticVendorFulfillmentsTable.vendorPoId,
      fulfillmentPayload: logisticVendorFulfillmentsTable.fulfillmentPayload,
      calculationInput:   logisticVendorFulfillmentsTable.calculationInput,
      templateSnapshot:   logisticVendorFulfillmentsTable.templateSnapshot,
      priceSnapshot:      logisticVendorFulfillmentsTable.priceSnapshot,
      adminNotes:         logisticVendorFulfillmentsTable.adminNotes,
      createdAt:          logisticVendorFulfillmentsTable.createdAt,
      updatedAt:          logisticVendorFulfillmentsTable.updatedAt,
      orderNumber:        logisticOrdersTable.orderNumber,
      customerName:       logisticOrdersTable.customerName,
      companyName:        logisticOrdersTable.companyName,
      orderStatus:        logisticOrdersTable.status,
      itemServiceName:    logisticOrderItemsTable.serviceName,
      itemCategory:       logisticOrderItemsTable.category,
      itemSubtotal:       logisticOrderItemsTable.subtotal,
      itemInputData:      logisticOrderItemsTable.inputData,
      itemSource:         logisticOrderItemsTable.itemSource,
      vendorName:         suppliersTable.name,
      vendorPhone:        suppliersTable.phone,
      vendorEmail:        suppliersTable.contactEmail,
    })
    .from(logisticVendorFulfillmentsTable)
    .leftJoin(logisticOrdersTable, eq(logisticOrdersTable.id, logisticVendorFulfillmentsTable.orderId))
    .leftJoin(logisticOrderItemsTable, eq(logisticOrderItemsTable.id, logisticVendorFulfillmentsTable.orderItemId))
    .leftJoin(suppliersTable, eq(suppliersTable.id, logisticVendorFulfillmentsTable.vendorId))
    .where(eq(logisticVendorFulfillmentsTable.id, id));

  if (!vf) return res.status(404).json({ message: "Fulfillment tidak ditemukan" });

  let catalogItem: {
    id: number; name: string; unit: string | null; kategori: string | null;
    description: string | null; priceBase: string; markupPct: string; priceSell: string | null;
  } | null = null;
  if (vf.vendorCatalogItemId) {
    const [ci] = await db
      .select({
        id:          vendorCatalogItemsTable.id,
        name:        vendorCatalogItemsTable.name,
        unit:        vendorCatalogItemsTable.unit,
        kategori:    vendorCatalogItemsTable.kategori,
        description: vendorCatalogItemsTable.description,
        priceBase:   vendorCatalogItemsTable.priceBase,
        markupPct:   vendorCatalogItemsTable.markupPct,
        priceSell:   vendorCatalogItemsTable.priceSell,
      })
      .from(vendorCatalogItemsTable)
      .where(eq(vendorCatalogItemsTable.id, vf.vendorCatalogItemId));
    catalogItem = ci ?? null;
  }

  // Ambil docNumber PO jika sudah ada
  let vendorPoNumber: string | null = null;
  if (vf.vendorPoId) {
    const [po] = await db
      .select({ docNumber: purchaseDocumentsTable.docNumber })
      .from(purchaseDocumentsTable)
      .where(eq(purchaseDocumentsTable.id, vf.vendorPoId));
    vendorPoNumber = po?.docNumber ?? null;
  }

  const auditRows = await db.execute<{
    id: number; actor_name: string | null; action: string;
    description: string | null; old_value: unknown; new_value: unknown; created_at: string;
  }>(sql`
    SELECT id, actor_name, action, description, old_value, new_value, created_at
    FROM order_audit_logs
    WHERE order_id = ${vf.orderId}
      AND action = 'vendor_fulfillment_status'
      AND (new_value->>'fulfillmentId')::int = ${id}
    ORDER BY created_at ASC
  `);

  const allowedTransitions = TRANSITIONS[vf.status] ?? [];

  return res.json({
    id:              vf.id,
    orderId:         vf.orderId,
    orderItemId:     vf.orderItemId,
    vendorCatalogItemId: vf.vendorCatalogItemId,
    vendorId:        vf.vendorId,
    serviceType:     vf.serviceType,
    status:          vf.status,
    vendorPoId:      vf.vendorPoId ?? null,
    vendorPoNumber:  vendorPoNumber,
    adminNotes:      vf.adminNotes,
    createdAt:       vf.createdAt?.toISOString() ?? "",
    updatedAt:       vf.updatedAt?.toISOString() ?? "",
    fulfillmentPayload: vf.fulfillmentPayload,
    calculationInput:   vf.calculationInput,
    templateSnapshot:   vf.templateSnapshot,
    priceSnapshot:      vf.priceSnapshot,
    allowedTransitions,
    order: {
      orderNumber:  vf.orderNumber ?? "",
      customerName: vf.customerName ?? "",
      companyName:  vf.companyName ?? "",
      status:       vf.orderStatus ?? "",
    },
    item: {
      serviceName: vf.itemServiceName ?? "",
      category:    vf.itemCategory ?? "",
      subtotal:    vf.itemSubtotal ? parseFloat(vf.itemSubtotal) : 0,
      inputData:   vf.itemInputData,
      itemSource:  vf.itemSource ?? "",
    },
    vendor: {
      id:    vf.vendorId,
      name:  vf.vendorName ?? "",
      phone: vf.vendorPhone ?? null,
      email: vf.vendorEmail ?? null,
    },
    catalogItem,
    auditHistory: (auditRows.rows ?? []).map((r) => ({
      id:          r.id,
      actorName:   r.actor_name,
      description: r.description,
      oldValue:    r.old_value,
      newValue:    r.new_value,
      createdAt:   r.created_at,
    })),
  });
});

// ─── POST /:id/create-vendor-po ───────────────────────────────────────────────
logisticVendorFulfillmentAdminRouter.post(
  "/:id/create-vendor-po",
  requireClerkUser,
  async (req: Request, res: Response) => {
    const id = parseInt(String(req.params.id) ?? "", 10);
    if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });

    // ── 1. Load fulfillment ──────────────────────────────────────────────────
    const [vf] = await db
      .select({
        id:                 logisticVendorFulfillmentsTable.id,
        orderId:            logisticVendorFulfillmentsTable.orderId,
        orderItemId:        logisticVendorFulfillmentsTable.orderItemId,
        vendorCatalogItemId: logisticVendorFulfillmentsTable.vendorCatalogItemId,
        vendorId:           logisticVendorFulfillmentsTable.vendorId,
        serviceType:        logisticVendorFulfillmentsTable.serviceType,
        status:             logisticVendorFulfillmentsTable.status,
        vendorPoId:         logisticVendorFulfillmentsTable.vendorPoId,
        templateSnapshot:   logisticVendorFulfillmentsTable.templateSnapshot,
        calculationInput:   logisticVendorFulfillmentsTable.calculationInput,
        priceSnapshot:      logisticVendorFulfillmentsTable.priceSnapshot,
        orderNumber:        logisticOrdersTable.orderNumber,
        companyId:          logisticOrdersTable.companyId,
        itemServiceName:    logisticOrderItemsTable.serviceName,
        itemSubtotal:       logisticOrderItemsTable.subtotal,
        vendorName:         suppliersTable.name,
        vendorAddress:      suppliersTable.address,
      })
      .from(logisticVendorFulfillmentsTable)
      .leftJoin(logisticOrdersTable, eq(logisticOrdersTable.id, logisticVendorFulfillmentsTable.orderId))
      .leftJoin(logisticOrderItemsTable, eq(logisticOrderItemsTable.id, logisticVendorFulfillmentsTable.orderItemId))
      .leftJoin(suppliersTable, eq(suppliersTable.id, logisticVendorFulfillmentsTable.vendorId))
      .where(eq(logisticVendorFulfillmentsTable.id, id));

    if (!vf) return res.status(404).json({ message: "Fulfillment tidak ditemukan" });

    // ── 2. Validasi status ────────────────────────────────────────────────────
    const ALLOWED_STATUSES = new Set(["pending", "confirmed", "in_progress"]);
    if (!ALLOWED_STATUSES.has(vf.status)) {
      return res.status(422).json({
        message: `Vendor PO hanya bisa dibuat dari status pending/confirmed/in_progress. Status saat ini: ${vf.status}`,
      });
    }

    // ── 3. Cek duplikat — return existing jika sudah ada ──────────────────────
    if (vf.vendorPoId) {
      const [existingPo] = await db
        .select({
          id:        purchaseDocumentsTable.id,
          docNumber: purchaseDocumentsTable.docNumber,
          status:    purchaseDocumentsTable.status,
          grandTotal: purchaseDocumentsTable.grandTotal,
        })
        .from(purchaseDocumentsTable)
        .where(eq(purchaseDocumentsTable.id, vf.vendorPoId));

      return res.json({
        ok: true,
        alreadyExists: true,
        po: existingPo ?? null,
        message: "Vendor PO sudah ada",
      });
    }

    // ── 4. Parse body override ─────────────────────────────────────────────────
    const body = req.body as {
      vendorCostOverride?: number | null;
      currency?: string;
      unit?: string;
      notes?: string;
    } | undefined;

    const vendorCostOverride =
      typeof body?.vendorCostOverride === "number" && body.vendorCostOverride > 0
        ? body.vendorCostOverride
        : null;
    const overrideCurrency = body?.currency?.trim() || "IDR";
    const overrideUnit     = body?.unit?.trim() || null;
    const overrideNotes    = body?.notes?.trim() || null;

    // ── 5. Ambil priceBase dari vendor_catalog_items ───────────────────────────
    let priceBase = 0;
    let catalogItemName = vf.itemServiceName ?? "Layanan Logistik";
    let catalogItemUnit: string | null = null;
    let costSource: string;

    if (vf.vendorCatalogItemId) {
      const [ci] = await db
        .select({
          priceBase: vendorCatalogItemsTable.priceBase,
          name:      vendorCatalogItemsTable.name,
          unit:      vendorCatalogItemsTable.unit,
        })
        .from(vendorCatalogItemsTable)
        .where(eq(vendorCatalogItemsTable.id, vf.vendorCatalogItemId));

      if (ci) {
        priceBase = parseFloat(ci.priceBase ?? "0") || 0;
        if (ci.name) catalogItemName = ci.name;
        catalogItemUnit = ci.unit ?? null;
      }
    }

    // ── 6. Tentukan vendor cost final & source ─────────────────────────────────
    let vendorCost: number;

    if (priceBase > 0) {
      // Pakai priceBase dari catalog
      vendorCost = priceBase;
      costSource = "vendor_catalog_items.priceBase";
    } else if (vendorCostOverride !== null) {
      // Pakai admin override
      vendorCost = vendorCostOverride;
      costSource = "admin_override";
    } else {
      // Tidak ada cost sama sekali → minta admin input
      return res.status(200).json({
        ok: false,
        needCostReview: true,
        po: null,
        message: "Harga dasar vendor tidak tersedia. Silakan input vendor cost secara manual.",
      });
    }

    // ── 7. Hitung margin snapshot ──────────────────────────────────────────────
    const customerPrice = vf.itemSubtotal ? parseFloat(vf.itemSubtotal) : 0;
    const marginAmount = vendorCost > 0 && customerPrice > 0
      ? customerPrice - vendorCost
      : null;
    const marginPct = marginAmount !== null && vendorCost > 0
      ? ((marginAmount / vendorCost) * 100).toFixed(2)
      : null;

    const vendorCostSnapshot = {
      source:    costSource,
      vendorCost,
      currency:  costSource === "admin_override" ? overrideCurrency : "IDR",
      unit:      costSource === "admin_override" ? (overrideUnit ?? catalogItemUnit) : catalogItemUnit,
      notes:     costSource === "admin_override" ? overrideNotes : null,
    };

    const poSnapshot = {
      fulfillmentId:        id,
      orderId:              vf.orderId,
      orderItemId:          vf.orderItemId,
      orderNumber:          vf.orderNumber ?? null,
      vendorCatalogItemId:  vf.vendorCatalogItemId,
      serviceType:          vf.serviceType ?? null,
      vendorCostSnapshot,
      customerPriceSnapshot: customerPrice > 0 ? customerPrice : null,
      marginSnapshot:        marginAmount,
      marginPctSnapshot:     marginPct ? parseFloat(marginPct) : null,
      templateSnapshot:      vf.templateSnapshot ?? null,
      calculationInput:      vf.calculationInput ?? null,
      priceSnapshot:         vf.priceSnapshot ?? null,
      createdFrom:           "vendor_fulfillment",
    };

    // ── 8. Generate PO number ─────────────────────────────────────────────────
    const docNumber = await nextVendorPoNumber();

    // ── 9. Notes PO ──────────────────────────────────────────────────────────
    const poNotes = [
      `Dibuat otomatis dari Vendor Fulfillment #${id} (Order: ${vf.orderNumber ?? vf.orderId})`,
      costSource === "admin_override" && overrideNotes
        ? `Catatan vendor cost: ${overrideNotes}`
        : null,
    ].filter(Boolean).join("\n");

    // ── 10. Insert purchase_documents ─────────────────────────────────────────
    const [po] = await db
      .insert(purchaseDocumentsTable)
      .values({
        companyId:       vf.companyId ?? null,
        docNumber,
        kind:            "order",
        status:          "draft",
        supplierId:      vf.vendorId,
        supplierName:    vf.vendorName ?? "—",
        supplierAddress: vf.vendorAddress ?? null,
        totalAmount:     String(vendorCost),
        taxAmount:       "0",
        grandTotal:      String(vendorCost),
        notes:           poNotes,
        templateSnapshot: poSnapshot as Record<string, unknown>,
        createdById:     ((req as any).clerkUser?.id ?? null) as string | null,
      })
      .returning();

    // ── 11. Insert purchase_document_lines ─────────────────────────────────────
    await db.insert(purchaseDocumentLinesTable).values({
      documentId:  po.id,
      name:        catalogItemName,
      description: `Layanan ${vf.serviceType ?? ""} — fulfillment #${id}`,
      quantity:    "1",
      unit:        (costSource === "admin_override" ? overrideUnit : null) ?? catalogItemUnit ?? "unit",
      unitCost:    String(vendorCost),
      subtotal:    String(vendorCost),
    });

    // ── 12. Update fulfillment.vendorPoId ─────────────────────────────────────
    await db
      .update(logisticVendorFulfillmentsTable)
      .set({ vendorPoId: po.id, updatedAt: new Date() })
      .where(eq(logisticVendorFulfillmentsTable.id, id));

    // ── 13. Audit log ─────────────────────────────────────────────────────────
    const actor = (req as any).clerkUser;
    await logOrderAudit({
      orderId:     vf.orderId,
      orderNumber: vf.orderNumber ?? null,
      actorType:   "admin",
      actorId:     actor?.id ?? null,
      actorName:   actor?.name ?? actor?.email ?? "Admin",
      action:      "vendor_po_created",
      description: `Vendor PO created from marketplace service fulfillment VF#${id}: ${docNumber} [cost source: ${costSource}]`,
      newValue:    { fulfillmentId: id, poId: po.id, docNumber, costSource, vendorCost },
      ipAddress:   req.ip ?? null,
    }).catch(() => {});

    logger.info({ fulfillmentId: id, poId: po.id, docNumber, costSource, vendorCost }, "vendor PO created from fulfillment");

    const needCostReview = false;
    return res.status(201).json({
      ok: true,
      alreadyExists: false,
      po: {
        id:        po.id,
        docNumber: po.docNumber,
        status:    po.status,
        grandTotal: po.grandTotal,
      },
      needCostReview,
      message: needCostReview
        ? `PO ${docNumber} dibuat — harap input vendor cost secara manual`
        : `PO ${docNumber} berhasil dibuat`,
    });
  }
);

// ─── PATCH /:id/status ────────────────────────────────────────────────────────
logisticVendorFulfillmentAdminRouter.patch("/:id/status", requireClerkUser, async (req: Request, res: Response) => {
  const id = parseInt(String(req.params.id) ?? "", 10);
  if (isNaN(id)) return res.status(400).json({ message: "ID tidak valid" });

  const { status: newStatus, notes } = req.body as { status?: string; notes?: string };
  if (!newStatus || !VALID_STATUSES.has(newStatus)) {
    return res.status(400).json({ message: `Status tidak valid. Pilih: ${[...VALID_STATUSES].join(", ")}` });
  }

  const [vf] = await db
    .select({
      id:          logisticVendorFulfillmentsTable.id,
      orderId:     logisticVendorFulfillmentsTable.orderId,
      status:      logisticVendorFulfillmentsTable.status,
      adminNotes:  logisticVendorFulfillmentsTable.adminNotes,
      orderNumber: logisticOrdersTable.orderNumber,
    })
    .from(logisticVendorFulfillmentsTable)
    .leftJoin(logisticOrdersTable, eq(logisticOrdersTable.id, logisticVendorFulfillmentsTable.orderId))
    .where(eq(logisticVendorFulfillmentsTable.id, id));

  if (!vf) return res.status(404).json({ message: "Fulfillment tidak ditemukan" });

  const allowed = TRANSITIONS[vf.status] ?? [];
  if (!allowed.includes(newStatus)) {
    return res.status(422).json({
      message: `Tidak bisa transisi dari "${vf.status}" ke "${newStatus}". Transisi yang diizinkan: ${allowed.join(", ") || "tidak ada"}`,
    });
  }

  const updateFields: Partial<typeof logisticVendorFulfillmentsTable.$inferInsert> = {
    status:    newStatus,
    updatedAt: new Date(),
  };
  if (notes !== undefined) updateFields.adminNotes = notes.trim() || null;

  const [updated] = await db
    .update(logisticVendorFulfillmentsTable)
    .set(updateFields)
    .where(eq(logisticVendorFulfillmentsTable.id, id))
    .returning();

  const actor = (req as any).clerkUser;
  await logOrderAudit({
    orderId:     vf.orderId,
    orderNumber: vf.orderNumber ?? null,
    actorType:   "admin",
    actorId:     actor?.id ?? null,
    actorName:   actor?.name ?? actor?.email ?? "Admin",
    action:      "vendor_fulfillment_status",
    description: `VF#${id}: ${vf.status} → ${newStatus}${notes?.trim() ? ` — ${notes.trim()}` : ""}`,
    oldValue:    { status: vf.status, fulfillmentId: id },
    newValue:    { status: newStatus, fulfillmentId: id, notes: notes?.trim() || null },
    ipAddress:   req.ip ?? null,
  });

  logger.info({ fulfillmentId: id, from: vf.status, to: newStatus }, "vendor fulfillment status updated");

  return res.json({ ok: true, fulfillment: updated });
});
