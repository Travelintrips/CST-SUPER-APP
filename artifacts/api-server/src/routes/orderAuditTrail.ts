import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { logisticOrdersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { requireClerkUser } from "../lib/requireAdmin.js";

export const orderAuditTrailRouter = Router();

// ── Normalized timeline event shape ──────────────────────────────────────────

type EventCategory =
  | "order"
  | "rfq"
  | "status"
  | "vendor"
  | "customer"
  | "wa"
  | "email"
  | "driver"
  | "pod"
  | "note"
  | "system";

interface TimelineEvent {
  id: string;
  ts: string;
  category: EventCategory;
  label: string;
  detail?: string | null;
  actor?: string | null;
}

// ── Label mappers ─────────────────────────────────────────────────────────────

function mapVendorQuoteLabel(eventType: string): string {
  const m: Record<string, string> = {
    rfq_created: "RFQ Dibuat",
    rfq_sent: "RFQ Dikirim ke Vendor",
    rfq_opened: "RFQ Dibuka Vendor",
    quote_submitted: "Vendor Submit Penawaran",
    quote_approved: "Penawaran Disetujui",
    quote_rejected: "Penawaran Ditolak",
    vendor_assigned: "Vendor Ditugaskan",
    vendor_selected: "Vendor Dipilih",
  };
  return m[eventType] ?? eventType;
}

function mapCustomerApprovalLabel(eventType: string): string {
  const m: Record<string, string> = {
    quote_sent: "Penawaran Dikirim ke Customer",
    customer_approved: "Customer Approve",
    customer_rejected: "Customer Tolak",
    customer_revision: "Customer Minta Revisi",
    so_created: "Sales Order Dibuat",
    approval_expired: "Approval Kadaluarsa",
  };
  return m[eventType] ?? eventType;
}

function mapStatusLabel(status: string): string {
  const m: Record<string, string> = {
    "New Order": "Order Baru Masuk",
    "Admin Review": "Admin Review",
    "RFQ Sent": "RFQ Terkirim",
    "Quote Received": "Penawaran Diterima",
    "Customer Approval": "Menunggu Approval Customer",
    "Vendor Assignment": "Vendor Ditugaskan",
    "In Transit": "Dalam Perjalanan",
    Arrived: "Tiba di Tujuan",
    Delivered: "Terkirim",
    "POD Uploaded": "POD Diupload",
    Completed: "Order Selesai",
    Cancelled: "Order Dibatalkan",
  };
  return m[status] ? `Status → ${m[status]}` : `Status → ${status}`;
}

function mapAuditLogLabel(action: string): string {
  const m: Record<string, string> = {
    order_created: "Order Dibuat",
    order_updated: "Order Diupdate",
    status_changed: "Status Berubah",
    rfq_created: "RFQ Dibuat",
    rfq_sent: "RFQ Dikirim",
    vendor_assigned: "Vendor Ditugaskan",
    customer_notified: "Customer Diberitahu",
    pod_submitted: "POD Submitted",
    invoice_created: "Invoice Dibuat",
    payment_confirmed: "Pembayaran Dikonfirmasi",
    vmf_link_created: "Link VMF Dibuat",
    vmf_submitted: "VMF Submitted",
    so_created: "SO Dibuat",
  };
  return m[action] ?? action;
}

function mapWaContext(context: string, subject?: string | null): string {
  if (subject) return `WA: ${subject}`;
  const m: Record<string, string> = {
    order_new: "WA Order Baru ke Admin",
    order_status_change: "WA Update Status",
    vendor_rfq: "WA RFQ ke Vendor",
    vendor_quote_approved: "WA Penawaran Disetujui",
    customer_quote: "WA Penawaran ke Customer",
    customer_approved: "WA Customer Approve",
    pod_submitted: "WA POD Submitted",
    order_completed: "WA Order Selesai",
    order_tracking: "WA Tracking Update",
    doc_missing_customer: "WA Dokumen Kurang (Customer)",
    doc_missing_vendor: "WA Dokumen Kurang (Vendor)",
  };
  for (const [key, val] of Object.entries(m)) {
    if (context.startsWith(key)) return val;
  }
  return `WA: ${context}`;
}

// ── Main endpoint ─────────────────────────────────────────────────────────────

// GET /api/logistic/orders/:orderId/audit-trail
orderAuditTrailRouter.get("/orders/:orderId/audit-trail", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;

  const orderId = Number(req.params["orderId"]);
  if (isNaN(orderId)) return res.status(400).json({ message: "orderId tidak valid" });

  const [order] = await db
    .select({
      id: logisticOrdersTable.id,
      orderNumber: logisticOrdersTable.orderNumber,
      createdAt: logisticOrdersTable.createdAt,
      customerName: logisticOrdersTable.customerName,
    })
    .from(logisticOrdersTable)
    .where(eq(logisticOrdersTable.id, orderId));

  if (!order) return res.status(404).json({ message: "Order tidak ditemukan" });

  const orderNumber = order.orderNumber;

  // Fetch all data sources concurrently
  const [
    rfqRows,
    statusRows,
    auditLogRows,
    vendorQuoteRows,
    customerApprovalRows,
    notifRows,
    driverJobRows,
    orderUpdateRows,
  ] = await Promise.all([
    // 1. RFQs dari logistic_order_rfqs
    db.execute(sql`
      SELECT id, rfq_number, status, created_at
      FROM logistic_order_rfqs
      WHERE logistic_order_id = ${orderId}
      ORDER BY created_at ASC
    `),
    // 2. Status history
    db.execute(sql`
      SELECT id, new_status, old_status, changed_by_name, changed_by_type, notes, created_at
      FROM order_status_history
      WHERE order_id = ${orderId}
      ORDER BY created_at ASC
    `),
    // 3. Activity / audit logs
    db.execute(sql`
      SELECT id, action, description, actor_name, actor_type, created_at
      FROM order_audit_logs
      WHERE order_id = ${orderId}
      ORDER BY created_at ASC
    `),
    // 4. Vendor quote events
    db.execute(sql`
      SELECT id, event_type, vendor_name, rfq_number, changed_by_name, notes, created_at
      FROM vendor_quote_history
      WHERE order_id = ${orderId}
      ORDER BY created_at ASC
    `),
    // 5. Customer approval events
    db.execute(sql`
      SELECT id, event_type, customer_name, actor_name, revision_notes, rejection_reason, created_at
      FROM customer_approval_history
      WHERE order_id = ${orderId}
      ORDER BY created_at ASC
    `),
    // 6. WA/email notifications linked to this order
    db.execute(sql`
      SELECT id, channel, recipient, subject, context, status, created_at
      FROM notification_logs
      WHERE ref_id = ${orderNumber}
      ORDER BY created_at ASC
      LIMIT 200
    `),
    // 7. Driver jobs (created + POD submitted)
    db.execute(sql`
      SELECT dj.id, dj.job_number, dj.status, dj.created_at, dj.pod_submitted_at,
             d.name AS driver_name
      FROM driver_jobs dj
      LEFT JOIN drivers d ON dj.driver_id = d.id
      WHERE dj.logistic_order_id = ${orderId}
      ORDER BY dj.created_at ASC
    `),
    // 8. Manual notes / order updates
    db.execute(sql`
      SELECT id, status, notes, actor_name, actor_type, is_public, created_at
      FROM order_updates
      WHERE order_id = ${orderId}
      ORDER BY created_at ASC
    `),
  ]);

  const events: TimelineEvent[] = [];

  // ── 0. Order created ──────────────────────────────────────────────────────
  events.push({
    id: `order-created-${orderId}`,
    ts: (order.createdAt as Date).toISOString(),
    category: "order",
    label: "Order Dibuat",
    detail: order.customerName ? `Customer: ${order.customerName}` : undefined,
  });

  // ── 1. RFQs ───────────────────────────────────────────────────────────────
  for (const r of rfqRows.rows as Record<string, unknown>[]) {
    events.push({
      id: `rfq-${r.id}`,
      ts: new Date(String(r.created_at)).toISOString(),
      category: "rfq",
      label: `RFQ Dibuat`,
      detail: r.rfq_number ? `#${r.rfq_number}` : undefined,
    });
  }

  // ── 2. Status history ─────────────────────────────────────────────────────
  for (const r of statusRows.rows as Record<string, unknown>[]) {
    events.push({
      id: `status-${r.id}`,
      ts: new Date(String(r.created_at)).toISOString(),
      category: "status",
      label: mapStatusLabel(String(r.new_status ?? "")),
      detail: r.notes ? String(r.notes) : undefined,
      actor: r.changed_by_name ? String(r.changed_by_name) : (r.changed_by_type ? String(r.changed_by_type) : undefined),
    });
  }

  // ── 3. Activity logs ──────────────────────────────────────────────────────
  for (const r of auditLogRows.rows as Record<string, unknown>[]) {
    events.push({
      id: `audit-${r.id}`,
      ts: new Date(String(r.created_at)).toISOString(),
      category: "system",
      label: mapAuditLogLabel(String(r.action ?? "")),
      detail: r.description ? String(r.description) : undefined,
      actor: r.actor_name ? String(r.actor_name) : (r.actor_type ? String(r.actor_type) : undefined),
    });
  }

  // ── 4. Vendor quote events ────────────────────────────────────────────────
  for (const r of vendorQuoteRows.rows as Record<string, unknown>[]) {
    events.push({
      id: `vq-${r.id}`,
      ts: new Date(String(r.created_at)).toISOString(),
      category: "vendor",
      label: mapVendorQuoteLabel(String(r.event_type ?? "")),
      detail: r.vendor_name
        ? String(r.vendor_name) + (r.rfq_number ? ` — ${r.rfq_number}` : "")
        : (r.rfq_number ? String(r.rfq_number) : undefined),
      actor: r.changed_by_name ? String(r.changed_by_name) : undefined,
    });
  }

  // ── 5. Customer approval events ───────────────────────────────────────────
  for (const r of customerApprovalRows.rows as Record<string, unknown>[]) {
    const detail = r.rejection_reason
      ? String(r.rejection_reason)
      : r.revision_notes
      ? String(r.revision_notes)
      : (r.customer_name ? String(r.customer_name) : undefined);
    events.push({
      id: `ca-${r.id}`,
      ts: new Date(String(r.created_at)).toISOString(),
      category: "customer",
      label: mapCustomerApprovalLabel(String(r.event_type ?? "")),
      detail,
      actor: r.actor_name ? String(r.actor_name) : (r.customer_name ? String(r.customer_name) : undefined),
    });
  }

  // ── 6. WA/email notifications ─────────────────────────────────────────────
  for (const r of notifRows.rows as Record<string, unknown>[]) {
    const channel = String(r.channel ?? "");
    const status = String(r.status ?? "");
    if (status === "deduped") continue; // skip deduplicated entries
    events.push({
      id: `notif-${r.id}`,
      ts: new Date(String(r.created_at)).toISOString(),
      category: channel === "email" ? "email" : "wa",
      label: mapWaContext(String(r.context ?? ""), r.subject ? String(r.subject) : null),
      detail: r.recipient ? `→ ${r.recipient}${status === "failed" ? " ✗ Gagal" : ""}` : (status === "failed" ? "✗ Gagal" : undefined),
    });
  }

  // ── 7. Driver jobs ────────────────────────────────────────────────────────
  for (const r of driverJobRows.rows as Record<string, unknown>[]) {
    events.push({
      id: `job-${r.id}`,
      ts: new Date(String(r.created_at)).toISOString(),
      category: "driver",
      label: "Job Driver Dibuat",
      detail: r.job_number ? `#${r.job_number}` : undefined,
      actor: r.driver_name ? String(r.driver_name) : undefined,
    });
    if (r.pod_submitted_at) {
      events.push({
        id: `pod-${r.id}`,
        ts: new Date(String(r.pod_submitted_at)).toISOString(),
        category: "pod",
        label: "POD Submitted",
        detail: r.job_number ? `#${r.job_number}` : undefined,
        actor: r.driver_name ? String(r.driver_name) : undefined,
      });
    }
  }

  // ── 8. Order updates (manual notes) ──────────────────────────────────────
  for (const r of orderUpdateRows.rows as Record<string, unknown>[]) {
    const isStatusEntry = !!r.status;
    events.push({
      id: `upd-${r.id}`,
      ts: new Date(String(r.created_at)).toISOString(),
      category: isStatusEntry ? "status" : "note",
      label: isStatusEntry ? mapStatusLabel(String(r.status)) : (r.notes ? String(r.notes).slice(0, 60) : "Catatan"),
      detail: isStatusEntry ? (r.notes ? String(r.notes) : undefined) : undefined,
      actor: r.actor_name ? String(r.actor_name) : (r.actor_type ? String(r.actor_type) : undefined),
    });
  }

  // ── Sort ascending, dedup by composite key ────────────────────────────────
  events.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

  // Dedup: remove status entries from order_updates that already exist in status_history
  // (same ts within 3s + same label)
  const dedupedEvents: TimelineEvent[] = [];
  for (const ev of events) {
    const isDup = dedupedEvents.some(
      (prev) =>
        prev.category === ev.category &&
        prev.label === ev.label &&
        Math.abs(new Date(prev.ts).getTime() - new Date(ev.ts).getTime()) < 3000
    );
    if (!isDup) dedupedEvents.push(ev);
  }

  return res.json({
    orderNumber,
    timeline: dedupedEvents,
  });
});

// ── Legacy sub-endpoints (kept for backward compat) ───────────────────────────

orderAuditTrailRouter.get("/orders/:orderId/status-history", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const orderId = Number(req.params["orderId"]);
  if (isNaN(orderId)) return res.status(400).json({ message: "orderId tidak valid" });
  const rows = await db.execute(sql`SELECT * FROM order_status_history WHERE order_id = ${orderId} ORDER BY created_at ASC`);
  return res.json({ data: rows.rows });
});

orderAuditTrailRouter.get("/orders/:orderId/vendor-quote-history", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const orderId = Number(req.params["orderId"]);
  if (isNaN(orderId)) return res.status(400).json({ message: "orderId tidak valid" });
  const rows = await db.execute(sql`SELECT * FROM vendor_quote_history WHERE order_id = ${orderId} ORDER BY created_at ASC`);
  return res.json({ data: rows.rows });
});

orderAuditTrailRouter.get("/orders/:orderId/customer-approval-history", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const orderId = Number(req.params["orderId"]);
  if (isNaN(orderId)) return res.status(400).json({ message: "orderId tidak valid" });
  const rows = await db.execute(sql`SELECT * FROM customer_approval_history WHERE order_id = ${orderId} ORDER BY created_at ASC`);
  return res.json({ data: rows.rows });
});

orderAuditTrailRouter.get("/orders/:orderId/order-audit-logs", async (req: Request, res: Response) => {
  if (!(await requireClerkUser(req, res))) return;
  const orderId = Number(req.params["orderId"]);
  if (isNaN(orderId)) return res.status(400).json({ message: "orderId tidak valid" });
  const rows = await db.execute(sql`SELECT * FROM order_audit_logs WHERE order_id = ${orderId} ORDER BY created_at ASC`);
  return res.json({ data: rows.rows });
});
