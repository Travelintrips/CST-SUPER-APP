/**
 * FASE 6E — Order Exception Management
 * Routes untuk mencatat dan mengelola masalah operasional per order.
 *
 * Mounted at:
 *   GET  /api/logistic/orders/:orderId/exceptions
 *   POST /api/logistic/orders/:orderId/exceptions
 *   PATCH /api/logistic/exceptions/:id/status
 */

import { Router } from "express";
import { db, exceptionsTable } from "@workspace/db";
import { eq, and, desc, sql } from "drizzle-orm";
import { requireAdmin } from "../lib/requireAdmin.js";
import { logOrderAudit } from "../lib/auditTrail.js";
import { getAdminGroupWa } from "../lib/adminWa.js";
import { sendWhatsApp } from "../lib/fonnte.js";
import { logger } from "../lib/logger.js";

export const orderExceptionsRouter = Router();

orderExceptionsRouter.use(async (req, res, next) => {
  if (!(await requireAdmin(req, res))) return;
  next();
});

// ── Helpers ───────────────────────────────────────────────────────────────────

const EXCEPTION_TYPE_LABEL: Record<string, string> = {
  vendor_no_response:  "Vendor Tidak Respon",
  customer_reject:     "Customer Menolak",
  damaged_goods:       "Barang Rusak",
  missing_goods:       "Barang Kurang",
  document_missing:    "Dokumen Kurang",
  delivery_failed:     "Gagal Antar",
  failed_delivery:     "Gagal Antar",
  payment_issue:       "Masalah Pembayaran",
  payment_overdue:     "Pembayaran Terlambat",
  pricing_dispute:     "Sengketa Harga",
  order_rejected:      "Order Ditolak",
  vendor_reject_rfq:   "Vendor Tolak RFQ",
  vendor_out_of_stock: "Stok Habis",
  price_changed:       "Harga Berubah",
  delivery_delayed:    "Pengiriman Terlambat",
  customer_complaint:  "Komplain Customer",
  vendor_rejected:     "Vendor Ditolak",
  pod_pending_review:  "POD Ditinjau",
};

const SEVERITY_EMOJI: Record<string, string> = {
  critical: "🔴",
  high:     "🟠",
  medium:   "🟡",
  low:      "🟢",
};

function getUserName(req: any): string {
  const user = req.user as { email?: string; name?: string } | undefined;
  return (user as any)?.name ?? user?.email ?? "admin";
}

// ── GET /orders/:orderId/exceptions ──────────────────────────────────────────

orderExceptionsRouter.get("/orders/:orderId/exceptions", async (req, res) => {
  const orderId = Number(req.params.orderId);
  if (isNaN(orderId)) { res.status(400).json({ error: "Invalid orderId" }); return; }

  const rows = await db
    .select()
    .from(exceptionsTable)
    .where(and(
      eq(exceptionsTable.refType, "logistic_order"),
      eq(exceptionsTable.refId, String(orderId)),
    ))
    .orderBy(
      sql`case ${exceptionsTable.status}
        when 'open' then 1 when 'investigating' then 2 when 'in_progress' then 2
        else 3 end`,
      sql`case ${exceptionsTable.severity}
        when 'critical' then 1 when 'high' then 2 when 'medium' then 3 else 4 end`,
      desc(exceptionsTable.createdAt),
    );

  res.json({ data: rows, total: rows.length });
});

// ── POST /orders/:orderId/exceptions ─────────────────────────────────────────

orderExceptionsRouter.post("/orders/:orderId/exceptions", async (req, res) => {
  const orderId = Number(req.params.orderId);
  if (isNaN(orderId)) { res.status(400).json({ error: "Invalid orderId" }); return; }

  const { exceptionType, severity, title, description } = req.body ?? {};
  if (!exceptionType || !title?.trim()) {
    res.status(400).json({ error: "exceptionType dan title wajib diisi" }); return;
  }

  const userName = getUserName(req);

  // Ambil data order untuk context
  const orderRows = await db.execute<{
    order_number: string; customer_name: string; company_id: number | null;
  }>(sql`
    SELECT order_number, customer_name, company_id
    FROM logistic_orders WHERE id = ${orderId} LIMIT 1
  `);
  const orderRow = orderRows.rows[0];
  if (!orderRow) { res.status(404).json({ error: "Order tidak ditemukan" }); return; }

  const [created] = await db.insert(exceptionsTable).values({
    companyId: orderRow.company_id ?? null,
    exceptionType: exceptionType as never,
    severity: (severity ?? "medium") as never,
    status: "open" as never,
    title: String(title).trim(),
    description: description ? String(description) : null,
    refType: "logistic_order",
    refId: String(orderId),
    refNumber: orderRow.order_number,
    customerName: orderRow.customer_name ?? null,
    createdBy: userName,
    reportedByType: "admin",
    reportedById: userName,
  } as never).returning();

  // Audit trail
  logOrderAudit({
    orderId,
    orderNumber: orderRow.order_number,
    actorType: "admin",
    actorName: userName,
    action: "exception_created",
    description: `Exception dilaporkan: [${EXCEPTION_TYPE_LABEL[exceptionType] ?? exceptionType}] ${String(title).trim()}`,
    newValue: { exceptionType, severity: severity ?? "medium", title: String(title).trim() },
  }).catch((e) => logger.warn({ e }, "logOrderAudit exception_created failed"));

  // WA ke admin group
  getAdminGroupWa()
    .then((adminTarget) => {
      if (!adminTarget) return;
      const sevEmoji = SEVERITY_EMOJI[severity ?? "medium"] ?? "🟡";
      const typeLabel = EXCEPTION_TYPE_LABEL[exceptionType] ?? exceptionType;
      const msg =
        `🚨 *Exception Order Dilaporkan*\n` +
        `━━━━━━━━━━━━━━━━\n` +
        `Order   : *${orderRow.order_number}*\n` +
        `Customer: ${orderRow.customer_name ?? "—"}\n` +
        `Tipe    : ${typeLabel}\n` +
        `Severity: ${sevEmoji} ${(severity ?? "medium").toUpperCase()}\n` +
        `Judul   : ${String(title).trim()}\n` +
        `Oleh    : ${userName}\n\n` +
        `Segera ditindaklanjuti.`;
      return sendWhatsApp(adminTarget, msg, {
        context: "exception_created",
        refType: "logistic_order",
        refId: String(orderId),
      });
    })
    .catch((e) => logger.warn({ e }, "WA exception notification failed"));

  res.status(201).json(created);
});

// ── PATCH /exceptions/:id/status ─────────────────────────────────────────────
// Shorthand update: hanya ubah status + resolutionNotes

orderExceptionsRouter.patch("/exceptions/:id/status", async (req, res) => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const { status, resolutionNotes } = req.body ?? {};
  if (!status) { res.status(400).json({ error: "status wajib diisi" }); return; }

  const userName = getUserName(req);
  const isResolved = status === "resolved" || status === "closed" || status === "rejected";

  const patch: Record<string, unknown> = {
    status,
    updatedAt: new Date(),
  };
  if (resolutionNotes !== undefined) patch.resolutionNotes = resolutionNotes;
  if (isResolved) {
    patch.resolvedAt = new Date();
    patch.resolvedBy = userName;
  }

  const [updated] = await db
    .update(exceptionsTable)
    .set(patch as never)
    .where(eq(exceptionsTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Tidak ditemukan" }); return; }
  res.json(updated);
});
