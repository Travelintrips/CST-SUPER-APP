import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requirePortalAdmin } from "../lib/supabaseAuth.js";
import { transitionLogisticOrderStatus } from "../lib/services/logisticOrderStatusService.js";
import { notifyCustomerPortal } from "../lib/customerPortalNotificationService.js";
import { isValidPortalPhone, normalizePortalPhone } from "../lib/phoneUtils.js";
import { sendViaService } from "../lib/waTransport.js";
import { logger } from "../lib/logger.js";

/**
 * Canonical read-only Customer Portal workload.
 *
 * Each physical source is projected into the same contract.  The projection
 * never writes lifecycle state and unknown statuses are visible but are not
 * counted as pending.  Marketplace RFQ and its latest PO intentionally share
 * one row so a single business request is not double-counted.
 */
const router = Router();
router.use(requirePortalAdmin);

type LifecycleAction = "approve" | "request_revision" | "reject";
type ActionTarget = { nextStatus: string; allowedFrom: string[] };

export const ACTION_TARGETS: Record<string, Record<LifecycleAction, ActionTarget>> = {
  "service-request": {
    approve: { nextStatus: "approved_for_rfq", allowedFrom: ["submitted", "need_review", "need_more_data"] },
    request_revision: { nextStatus: "need_more_data", allowedFrom: ["submitted", "need_review", "approved_for_rfq"] },
    reject: { nextStatus: "rejected", allowedFrom: ["submitted", "need_review", "need_more_data", "approved_for_rfq"] },
  },
  "logistic-order": {
    approve: { nextStatus: "RFQ Sent", allowedFrom: ["Admin Review"] },
    request_revision: { nextStatus: "Admin Review", allowedFrom: ["Order Received", "RFQ Sent", "Quote Received", "Customer Approval"] },
    reject: { nextStatus: "Cancelled", allowedFrom: ["Order Received", "Admin Review", "RFQ Sent", "Quote Received", "Customer Approval", "Vendor Confirmed", "In Progress"] },
  },
  ppjk: {
    approve: { nextStatus: "document_review", allowedFrom: ["waiting_documents", "document_review"] },
    request_revision: { nextStatus: "waiting_documents", allowedFrom: ["document_review", "quotation", "waiting_customer"] },
    reject: { nextStatus: "cancelled", allowedFrom: ["waiting_documents", "document_review", "quotation", "waiting_customer", "customer_approved"] },
  },
  "product-order": {
    approve: { nextStatus: "Product RFQ Sent", allowedFrom: ["Quote Request", "Admin Review"] },
    request_revision: { nextStatus: "Admin Review", allowedFrom: ["Quote Request", "Product Quote Received", "Product Vendor Selected", "Customer Product Approval"] },
    reject: { nextStatus: "Admin Review", allowedFrom: ["Quote Request", "Product Quote Received", "Product Vendor Selected", "Customer Product Approval"] },
  },
  "domestic-trucking": {
    approve: { nextStatus: "reviewing", allowedFrom: ["new", "submitted", "pending_review", "waiting_rate"] },
    request_revision: { nextStatus: "pending_review", allowedFrom: ["reviewing", "quoted", "approved"] },
    reject: { nextStatus: "rejected", allowedFrom: ["new", "submitted", "pending_review", "reviewing", "waiting_rate", "quoted"] },
  },
  "air-freight": {
    // air_freight_orders has a runtime CHECK constraint with the canonical
    // rate lifecycle, not the generic reviewing/pending_review labels.
    approve: { nextStatus: "waiting_rate", allowedFrom: ["draft", "inquiry", "new", "submitted", "pending_review", "waiting_rate"] },
    request_revision: { nextStatus: "waiting_rate", allowedFrom: ["quoted", "approved", "rate_received"] },
    reject: { nextStatus: "cancelled", allowedFrom: ["draft", "inquiry", "new", "submitted", "pending_review", "reviewing", "waiting_rate", "quoted", "rate_requested", "approved", "rate_received"] },
  },
  "ocean-freight": {
    approve: { nextStatus: "rate_requested", allowedFrom: ["waiting_rate", "new", "submitted", "pending_review"] },
    request_revision: { nextStatus: "waiting_rate", allowedFrom: ["reviewing", "quoted", "rate_received"] },
    reject: { nextStatus: "cancelled", allowedFrom: ["waiting_rate", "new", "submitted", "pending_review", "reviewing", "quoted", "rate_requested", "rate_received"] },
  },
  "quote-request": {
    approve: { nextStatus: "contacted", allowedFrom: ["new"] },
    request_revision: { nextStatus: "contacted", allowedFrom: ["new", "contacted", "quoted"] },
    reject: { nextStatus: "cancelled", allowedFrom: ["new", "contacted", "quoted"] },
  },
  marketplace: {
    approve: { nextStatus: "quoting", allowedFrom: ["submitted"] },
    request_revision: { nextStatus: "draft", allowedFrom: ["submitted", "quoting", "quoted"] },
    reject: { nextStatus: "cancelled", allowedFrom: ["submitted", "quoting", "quoted", "awarded"] },
  },
};

export function getActionTarget(service: string, action: LifecycleAction, status: string): ActionTarget | null {
  const target = ACTION_TARGETS[service]?.[action];
  return target && target.allowedFrom.includes(status) ? target : null;
}

export function availableActions(service: string, status: string): string[] {
  const actions = (["approve", "request_revision", "reject"] as LifecycleAction[])
    .filter((action) => getActionTarget(service, action, status))
    .map((action) => action as string)
  return DIRECT_SOURCES[service] || service === "marketplace-po"
    ? actions.concat("contact")
    : actions;
}

const sourceRows = sql`
  (
    SELECT
      CASE WHEN po.id IS NULL THEN 'marketplace' ELSE 'marketplace-po' END::text AS service_key,
      CASE WHEN po.id IS NULL THEN 'Marketplace / RFQ' ELSE 'Marketplace / Purchase Order' END::text AS service_label,
      CASE WHEN po.id IS NULL THEN r.id ELSE po.id END::int AS id,
      CASE WHEN po.id IS NULL THEN r.rfq_number ELSE po.po_number END::text AS reference,
      CASE WHEN po.id IS NULL THEN r.status::text ELSE po.status::text END AS status,
      r.buyer_name::text AS customer_name,
      COALESCE(r.buyer_company, '')::text AS customer_company,
      COALESCE(po.company_id, r.company_id)::int AS company_id,
       (to_jsonb(r)->>'portal_customer_id')::int AS portal_customer_id,
       COALESCE(pc.phone, r.buyer_phone)::text AS customer_phone,
      CASE WHEN po.id IS NULL
        THEN r.status::text IN ('submitted', 'customer_review', 'quoted', 'awarded')
        ELSE po.status::text IN ('pending', 'confirmed', 'in_progress', 'delivered', 'issued', 'vendor_accepted', 'revision_requested', 'vendor_rejected', 'production', 'ready_to_ship', 'in_transit', 'partially_delivered', 'rejected_goods')
      END AS is_pending,
      CASE WHEN po.id IS NULL
        THEN r.status::text IN ('draft', 'submitted', 'customer_review', 'quoted', 'awarded', 'closed', 'cancelled')
        ELSE po.status::text IN ('pending', 'confirmed', 'in_progress', 'delivered', 'completed', 'cancelled', 'issued', 'vendor_accepted', 'revision_requested', 'vendor_rejected', 'production', 'ready_to_ship', 'in_transit', 'partially_delivered', 'closed', 'rejected_goods')
      END AS status_known,
      r.created_at,
      COALESCE(po.updated_at, r.updated_at) AS updated_at,
      CASE WHEN po.id IS NULL
        THEN ('/bizportal/marketplace/rfqs/' || r.id)
        ELSE ('/bizportal/marketplace/purchase-orders/' || po.id)
      END::text AS management_path,
      CASE WHEN po.id IS NULL
        THEN COALESCE(r.notes, '')
        ELSE CONCAT('RFQ ', r.rfq_number, ' · ', COALESCE(po.vendor_name_snapshot, 'Vendor belum ditentukan'))
      END::text AS summary
     FROM mkt_rfqs r
     LEFT JOIN portal_customers pc ON pc.id = (to_jsonb(r)->>'portal_customer_id')::int
    LEFT JOIN LATERAL (
      SELECT p.*
      FROM mkt_purchase_orders p
      WHERE p.rfq_id = r.id
      ORDER BY p.created_at DESC, p.id DESC
      LIMIT 1
    ) po ON TRUE
    WHERE r.status::text <> 'draft'

    UNION ALL

    SELECT
      'logistic-order'::text,
      'Logistics / Customer Order'::text,
      r.id::int,
      r.order_number::text,
      r.status::text,
      r.customer_name::text,
      COALESCE(r.company_name, '')::text,
      r.company_id::int,
       (to_jsonb(r)->>'portal_customer_id')::int,
       r.phone::text AS customer_phone,
      r.status::text IN (
        'Order Received', 'Admin Review', 'Product RFQ Sent', 'Product Quote Received',
        'Product Vendor Selected', 'Customer Product Approval', 'Shipment Selection Pending',
        'Ready for Pickup', 'RFQ Sent', 'Quote Received', 'Customer Approval',
        'Vendor Confirmed', 'In Progress', 'Pickup', 'In Transit', 'Arrived',
        'Delivered', 'POD Uploaded', 'Invoice Issued', 'Payment Received'
      ),
      r.status::text IN (
        'Order Received', 'Admin Review', 'Product RFQ Sent', 'Product Quote Received',
        'Product Vendor Selected', 'Customer Product Approval', 'Shipment Selection Pending',
        'Ready for Pickup', 'RFQ Sent', 'Quote Received', 'Customer Approval',
        'Vendor Confirmed', 'In Progress', 'Pickup', 'In Transit', 'Arrived',
        'Delivered', 'POD Uploaded', 'Invoice Issued', 'Payment Received',
        'Completed', 'Cancelled'
      ),
      r.created_at,
      r.updated_at,
      ('/bizportal/logistics/orders/' || r.id)::text,
      CONCAT(COALESCE(r.origin, ''), ' → ', COALESCE(r.destination, ''))::text
    FROM logistic_orders r
    WHERE r.source IN ('customer_portal', 'portal')

    UNION ALL

    SELECT
      'ppjk'::text,
      'Pabean / PPJK'::text,
      r.id::int,
      r.order_number::text,
      r.status::text,
      r.customer_name::text,
      COALESCE(r.customer_company, '')::text,
      r.company_id::int,
      NULL::int,
       r.customer_phone::text AS customer_phone,
      r.status::text IN (
        'draft', 'waiting_documents', 'document_review', 'document_completed',
        'quotation', 'waiting_customer', 'customer_approved', 'preparing_pib',
        'preparing_peb', 'submitted_ceisa', 'inspection', 'red_lane',
        'yellow_lane', 'green_lane', 'hold', 'sppb', 'released'
      ),
      r.status::text IN (
        'draft', 'waiting_documents', 'document_review', 'document_completed',
        'quotation', 'waiting_customer', 'customer_approved', 'preparing_pib',
        'preparing_peb', 'submitted_ceisa', 'inspection', 'red_lane',
        'yellow_lane', 'green_lane', 'hold', 'sppb', 'released', 'completed', 'cancelled'
      ),
      r.created_at,
      r.updated_at,
      ('/bizportal/ppjk/orders/' || r.id)::text,
      CONCAT(COALESCE(r.origin, ''), ' → ', COALESCE(r.destination, ''))::text
    FROM ppjk_orders r
    WHERE r.portal_order_id IS NOT NULL OR r.created_by_id LIKE 'portal:%'

    UNION ALL

    SELECT
      'quote-request'::text,
      'Request a Quote'::text,
      r.id::int,
      ('QUOTE-' || r.id)::text,
      r.status::text,
      r.name::text,
      ''::text,
      NULL::int,
      NULL::int,
       r.whatsapp::text AS customer_phone,
      r.status::text IN ('new', 'contacted'),
      r.status::text IN ('new', 'contacted', 'quoted', 'completed', 'cancelled'),
      r.created_at,
      r.updated_at,
      '/bizportal/quote-requests'::text,
      CONCAT(COALESCE(r.service, ''), ' · ', COALESCE(r.origin, ''), ' → ', COALESCE(r.destination, ''))::text
    FROM quote_requests r

    UNION ALL

    SELECT
      'product-order'::text,
      'Marketplace / Product Order'::text,
      r.id::int,
      r.order_number::text,
      r.status::text,
      r.customer_name::text,
      ''::text,
      r.company_id::int,
      (to_jsonb(r)->>'portal_customer_id')::int,
       r.phone::text AS customer_phone,
      r.status::text IN (
        'Quote Request', 'Product RFQ Sent', 'Product Quote Received',
        'Product Vendor Selected', 'Customer Product Approval',
        'Shipment Selection Pending', 'Shipment RFQ Sent', 'Ready for Pickup',
        'Vendor Confirmed', 'In Progress', 'Delivered'
      ),
      r.status::text IN (
        'Quote Request', 'Product RFQ Sent', 'Product Quote Received',
        'Product Vendor Selected', 'Customer Product Approval',
        'Shipment Selection Pending', 'Shipment RFQ Sent', 'Ready for Pickup',
        'Vendor Confirmed', 'In Progress', 'Delivered', 'Completed', 'Cancelled'
      ),
      r.created_at,
      r.updated_at,
      ('/bizportal/marketplace/product-orders/' || r.id)::text,
      CONCAT(COALESCE(r.product_category, 'Product'), ' · ', COALESCE(r.shipping_method, 'shipping belum dipilih'))::text
    FROM portal_product_orders r

    UNION ALL

    SELECT
      'service-request'::text,
      'Pabean / Custom Clearance / Layanan'::text,
      r.id::int,
      r.request_number::text,
      r.status::text,
      r.customer_name::text,
      COALESCE(r.customer_company, '')::text,
      r.company_id::int,
      COALESCE((to_jsonb(r)->>'portal_customer_id')::int, r.customer_id)::int,
       r.customer_phone::text AS customer_phone,
      r.status::text IN (
        'submitted', 'pending_review', 'need_review', 'need_more_data',
        'waiting_rate', 'reviewing', 'quoted', 'approved_for_rfq'
      ),
      r.status::text IN (
        'draft', 'submitted', 'pending_review', 'need_review', 'need_more_data',
        'waiting_rate', 'reviewing', 'quoted', 'approved_for_rfq',
        'approved', 'booked', 'completed', 'rejected', 'cancelled', 'quote_declined'
      ),
      r.created_at,
      COALESCE(r.updated_at, r.created_at),
      ('/bizportal/logistics/service-requests/' || r.id)::text,
      COALESCE(r.notes, '')::text
    FROM customer_service_requests r
    WHERE r.status <> 'draft'

    UNION ALL

    SELECT
      'domestic-trucking'::text,
      'Domestic / Trucking'::text,
      r.id::int,
      r.booking_number::text,
      r.status::text,
      COALESCE(r.pic_pickup, 'Customer')::text,
      ''::text,
      r.company_id::int,
      COALESCE((to_jsonb(r)->>'portal_customer_id')::int, r.customer_id)::int,
       r.hp_pickup::text AS customer_phone,
      r.status::text IN ('new', 'submitted', 'pending_review', 'waiting_rate', 'quoted', 'approved', 'booked', 'in_progress'),
      r.status::text IN ('new', 'submitted', 'pending_review', 'waiting_rate', 'quoted', 'approved', 'booked', 'in_progress', 'delivered', 'completed', 'cancelled'),
      r.created_at,
      r.updated_at,
      '/bizportal/logistics/trucking-orders'::text,
      CONCAT(COALESCE(r.area_pickup, ''), ' → ', COALESCE(r.area_delivery, ''))::text
    FROM trucking_booking_requests r
    WHERE COALESCE(r.source, 'customer_portal') = 'customer_portal'

    UNION ALL

    SELECT
      'air-freight'::text,
      'Air Freight'::text,
      r.id::int,
      r.order_number::text,
      r.status::text,
      r.customer_name::text,
      ''::text,
      r.company_id::int,
      (to_jsonb(r)->>'portal_customer_id')::int,
       r.customer_phone::text AS customer_phone,
      r.status::text IN ('new', 'submitted', 'pending_review', 'waiting_rate', 'quoted', 'approved', 'booked', 'in_progress'),
      r.status::text IN ('new', 'submitted', 'pending_review', 'waiting_rate', 'quoted', 'approved', 'booked', 'in_progress', 'delivered', 'completed', 'cancelled'),
      r.created_at,
      r.updated_at,
      ('/bizportal/air-freight/orders/' || r.id)::text,
      CONCAT(COALESCE(r.origin_airport, ''), ' → ', COALESCE(r.destination_airport, ''))::text
    FROM air_freight_orders r
    WHERE COALESCE(r.source, 'customer_portal') = 'customer_portal'

    UNION ALL

    SELECT
      'ocean-freight'::text,
      'Ocean / Sea Freight'::text,
      r.id::int,
      r.order_number::text,
      r.status::text,
      r.customer_name::text,
      COALESCE(r.customer_company, '')::text,
      r.company_id::int,
      (to_jsonb(r)->>'portal_customer_id')::int,
       r.customer_phone::text AS customer_phone,
      r.status::text IN ('new', 'submitted', 'pending_review', 'waiting_rate', 'quoted', 'approved', 'booked', 'in_progress'),
      r.status::text IN ('new', 'submitted', 'pending_review', 'waiting_rate', 'quoted', 'approved', 'booked', 'in_progress', 'delivered', 'completed', 'cancelled'),
      r.created_at,
      r.updated_at,
      ('/bizportal/logistics/ocean-freight/' || r.id)::text,
      CONCAT(COALESCE(r.origin_port, ''), ' → ', COALESCE(r.destination_port, ''))::text
    FROM ocean_freight_orders r
    WHERE COALESCE(r.source, 'customer_portal') = 'customer_portal'

    UNION ALL

    SELECT
      CASE
        WHEN LOWER(COALESCE(d.category_key, '') || ' ' || COALESCE(lines.line_names, '')) LIKE '%custom%'
          OR LOWER(COALESCE(d.category_key, '') || ' ' || COALESCE(lines.line_names, '')) LIKE '%pabean%'
        THEN 'custom-clearance'
        ELSE 'freight-forwarding'
      END::text,
      CASE
        WHEN LOWER(COALESCE(d.category_key, '') || ' ' || COALESCE(lines.line_names, '')) LIKE '%custom%'
          OR LOWER(COALESCE(d.category_key, '') || ' ' || COALESCE(lines.line_names, '')) LIKE '%pabean%'
        THEN 'Pabean / Custom Clearance'
        ELSE 'Freight Forwarding'
      END::text,
      d.id::int,
      d.doc_number::text,
      d.status::text,
      d.customer_name::text,
      ''::text,
      d.company_id::int,
      NULL::int,
       NULL::text AS customer_phone,
      d.status::text IN ('draft', 'submitted', 'pending_review', 'approved', 'booked'),
      d.status::text IN ('draft', 'submitted', 'pending_review', 'approved', 'booked', 'completed', 'cancelled', 'paid'),
      d.created_at,
      d.updated_at,
      ('/bizportal/sales/documents/' || d.id)::text,
      COALESCE(d.notes, '')::text
    FROM sales_documents d
    LEFT JOIN LATERAL (
      SELECT string_agg(l.name, ' ') AS line_names
      FROM sales_document_lines l
      WHERE l.document_id = d.id
    ) lines ON TRUE
    WHERE d.created_by_id LIKE 'portal:%'
      AND d.kind::text = 'order'
  )
`;

function filters(req: Request) {
  const values: ReturnType<typeof sql>[] = [];
  const service = typeof req.query.service === "string" ? req.query.service.trim() : "";
  const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
  const search = typeof req.query.search === "string" ? req.query.search.trim() : "";

  if (service && service !== "all") values.push(sql`service_key = ${service}`);
  if (status && status !== "all") values.push(sql`status = ${status}`);
  if (search) {
    const pattern = `%${search}%`;
    values.push(sql`(
      reference ILIKE ${pattern}
      OR customer_name ILIKE ${pattern}
      OR customer_company ILIKE ${pattern}
      OR service_label ILIKE ${pattern}
      OR summary ILIKE ${pattern}
    )`);
  }
  return values.length ? sql`WHERE ${sql.join(values, sql` AND `)}` : sql``;
}

function pageParam(value: unknown, fallback: number, max: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(max, Math.max(0, Math.floor(parsed))) : fallback;
}

router.get("/", async (req: Request, res: Response) => {
  try {
    const limit = pageParam(req.query.limit, 25, 100) || 25;
    const offset = pageParam(req.query.offset, 0, 1_000_000);
    const where = filters(req);
    const from = sql`FROM ${sourceRows} ops ${where}`;

    const [rows, count, summary, unread] = await Promise.all([
      db.execute(sql`
        SELECT service_key, service_label, id, reference, status,
               customer_name, customer_company, customer_phone, company_id, portal_customer_id,
               created_at, updated_at, management_path, summary,
               is_pending, status_known
        ${from}
        ORDER BY created_at DESC, id DESC
        LIMIT ${limit} OFFSET ${offset}
      `),
      db.execute(sql`SELECT COUNT(*)::int AS total ${from}`),
      db.execute(sql`
        SELECT service_key, service_label, COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE is_pending)::int AS pending,
               COUNT(*) FILTER (WHERE NOT status_known)::int AS ambiguous
        ${from}
        GROUP BY service_key, service_label
        ORDER BY service_label
      `),
      db.execute(sql`SELECT COUNT(*)::int AS count FROM admin_notifications WHERE read_at IS NULL`),
    ]);

    return res.json({
      data: rows.rows.map((row) => ({
        ...row,
        available_actions: availableActions(String((row as any).service_key), String((row as any).status)),
      })),
      total: Number((count.rows[0] as { total: number }).total ?? 0),
      limit,
      offset,
      summary: summary.rows,
      unreadNotifications: Number((unread.rows[0] as { count: number }).count ?? 0),
    });
  } catch (error) {
    console.error("[portal-admin-service-ops] list failed", error);
    return res.status(500).json({ error: "Gagal memuat workload layanan Customer Portal" });
  }
});

router.get("/notifications", async (req: Request, res: Response) => {
  try {
    const limit = pageParam(req.query.limit, 8, 50) || 8;
    const result = await db.execute(sql`
      SELECT id, type, order_id, order_number, customer_name, company_name,
             title, body, payload, read_at, created_at
      FROM admin_notifications
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);
    return res.json({ data: result.rows });
  } catch (error) {
    console.error("[portal-admin-service-ops] notifications failed", error);
    return res.status(500).json({ error: "Gagal memuat notifikasi" });
  }
});

router.post("/notifications/mark-all-read", async (_req: Request, res: Response) => {
  await db.execute(sql`UPDATE admin_notifications SET read_at = NOW() WHERE read_at IS NULL`);
  return res.json({ ok: true });
});

router.post("/notifications/:id/read", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) return res.status(400).json({ error: "ID notifikasi tidak valid" });
  await db.execute(sql`UPDATE admin_notifications SET read_at = NOW() WHERE id = ${id}`);
  return res.json({ ok: true });
});

type DirectSource = {
  table: string;
  referenceColumn: string;
  phoneColumn: string;
  customerIdExpression: string;
};

const DIRECT_SOURCES: Record<string, DirectSource> = {
  marketplace: { table: "mkt_rfqs", referenceColumn: "rfq_number", phoneColumn: "buyer_phone", customerIdExpression: "(to_jsonb(r)->>'portal_customer_id')" },
  "logistic-order": { table: "logistic_orders", referenceColumn: "order_number", phoneColumn: "phone", customerIdExpression: "(to_jsonb(r)->>'portal_customer_id')" },
  ppjk: { table: "ppjk_orders", referenceColumn: "order_number", phoneColumn: "customer_phone", customerIdExpression: "NULL" },
  "quote-request": { table: "quote_requests", referenceColumn: "id", phoneColumn: "whatsapp", customerIdExpression: "NULL" },
  "product-order": { table: "portal_product_orders", referenceColumn: "order_number", phoneColumn: "phone", customerIdExpression: "(to_jsonb(r)->>'portal_customer_id')" },
  "service-request": { table: "customer_service_requests", referenceColumn: "request_number", phoneColumn: "customer_phone", customerIdExpression: "COALESCE((to_jsonb(r)->>'portal_customer_id')::int, r.customer_id)" },
  "domestic-trucking": { table: "trucking_booking_requests", referenceColumn: "booking_number", phoneColumn: "hp_pickup", customerIdExpression: "COALESCE((to_jsonb(r)->>'portal_customer_id')::int, r.customer_id)" },
  "air-freight": { table: "air_freight_orders", referenceColumn: "order_number", phoneColumn: "customer_phone", customerIdExpression: "(to_jsonb(r)->>'portal_customer_id')" },
  "ocean-freight": { table: "ocean_freight_orders", referenceColumn: "order_number", phoneColumn: "customer_phone", customerIdExpression: "(to_jsonb(r)->>'portal_customer_id')" },
};

async function loadDirectRecord(service: string, id: number) {
  if (service === "marketplace-po") {
    const result = await db.execute(sql`
      SELECT p.status::text AS status, r.buyer_phone::text AS customer_phone,
             (to_jsonb(r)->>'portal_customer_id')::int AS portal_customer_id, p.po_number::text AS reference
      FROM mkt_purchase_orders p
      JOIN mkt_rfqs r ON r.id = p.rfq_id
      WHERE p.id = ${id}
      LIMIT 1
    `);
    return result.rows[0] as {
      status: string;
      customer_phone: string | null;
      portal_customer_id: number | null;
      reference: string;
    } | undefined;
  }
  const source = DIRECT_SOURCES[service];
  if (!source) return null;
  const result = await db.execute(sql`
    SELECT r.status::text AS status,
           r.${sql.raw(source.phoneColumn)}::text AS customer_phone,
           ${sql.raw(source.customerIdExpression)}::int AS portal_customer_id,
           r.${sql.raw(source.referenceColumn)}::text AS reference
    FROM ${sql.raw(source.table)} r
    WHERE id = ${id}
    LIMIT 1
  `);
  return result.rows[0] as {
    status: string;
    customer_phone: string | null;
    portal_customer_id: number | null;
    reference: string;
  } | undefined;
}

async function resolveContactPhone(portalCustomerId: number | null, sourcePhone: string | null) {
  if (portalCustomerId) {
    const result = await db.execute(sql`
      SELECT phone FROM portal_customers WHERE id = ${portalCustomerId} LIMIT 1
    `);
    const profilePhone = String((result.rows[0] as { phone?: string | null } | undefined)?.phone ?? "").trim();
    if (profilePhone) return profilePhone;
  }
  return sourcePhone?.trim() || null;
}

async function sendLifecycleWhatsApp(
  service: string,
  id: number,
  reference: string | null,
  status: string,
  phone: string | null,
  reason: string | null,
) {
  if (!phone) return;
  const normalized = normalizePortalPhone(phone);
  if (!isValidPortalPhone(normalized)) return;
  const detail = reason ? `\nCatatan admin: ${reason}` : "";
  try {
    await sendViaService(
      normalized,
      `📋 Update layanan Customer Portal\nReferensi: ${reference ?? `${service} #${id}`}\nStatus: ${status}${detail}`,
      { context: `customer-portal-${service}-status`, refType: service, refId: `${id}:${status}` },
    );
  } catch (error) {
    // The canonical transition and durable in-app notification already
    // succeeded. Provider failure must not turn a successful admin action
    // into a retryable 500 or duplicate transition.
    logger.warn({ err: error, service, id, status }, "Customer lifecycle WhatsApp delivery failed");
  }
}

async function performDirectAction(
  service: string,
  id: number,
  action: LifecycleAction,
  reason: string | null,
  actorId: string,
) {
  const source = DIRECT_SOURCES[service];
  if (!source) {
    return { ok: false as const, code: "UNSUPPORTED", error: "Layanan ini memakai action di modul canonical masing-masing." };
  }
  const initial = await loadDirectRecord(service, id);
  if (!initial) return { ok: false as const, code: "NOT_FOUND", error: "Transaksi canonical tidak ditemukan." };
  const target = getActionTarget(service, action, initial.status);
  if (!target) {
    return { ok: false as const, code: "INVALID_TRANSITION", error: `Action ${action} tidak tersedia dari status ${initial.status}.` };
  }

  const result = await db.transaction(async (tx) => {
    const locked = await tx.execute(sql`
      SELECT status::text AS status
      FROM ${sql.raw(source.table)}
      WHERE id = ${id}
      FOR UPDATE
    `);
    const current = String((locked.rows[0] as { status?: string } | undefined)?.status ?? "");
    if (!current) return null;
    if (current === target.nextStatus) return { alreadyAt: true };
    if (current !== initial.status) throw new Error(`CONCURRENT_STATUS:${current}`);
    const changed = await tx.execute(sql`
      UPDATE ${sql.raw(source.table)}
      SET status = ${target.nextStatus}, updated_at = NOW()
      WHERE id = ${id} AND status::text = ${current}
      RETURNING status::text AS status
    `);
    if (changed.rows.length !== 1) throw new Error("CONCURRENT_STATUS");
    await tx.execute(sql`
      INSERT INTO erp_audit_logs (
        action, module, reference_id, user_id, old_data, new_data, created_at
      ) VALUES (
        ${action}, ${"portal_customer_lifecycle"}, ${`${service}:${id}`}, ${actorId},
        ${JSON.stringify({ service, id, status: current })}::jsonb,
        ${JSON.stringify({ service, id, status: target.nextStatus, reason })}::jsonb,
        NOW()
      )
    `);
    return { alreadyAt: false };
  });
  if (!result) return { ok: false as const, code: "NOT_FOUND", error: "Transaksi canonical tidak ditemukan." };
  if (result.alreadyAt) return { ok: true as const, alreadyAt: true, status: target.nextStatus };

  const latest = await loadDirectRecord(service, id);
  const customerPhone = await resolveContactPhone(latest?.portal_customer_id ?? null, latest?.customer_phone ?? null);
  if (latest?.portal_customer_id) {
    await notifyCustomerPortal({
      portalCustomerId: latest.portal_customer_id,
      eventKey: `portal-lifecycle:${service}:${id}:${action}:${target.nextStatus}`,
      type: "portal_service_status_changed",
      title: "Status layanan diperbarui",
      message: `${latest.reference ?? `${service} #${id}`} sekarang berstatus ${target.nextStatus}.`,
      payload: { service, id, reference: latest.reference ?? null, status: target.nextStatus, action, reason },
    });
  }
  await sendLifecycleWhatsApp(service, id, latest?.reference ?? null, target.nextStatus, customerPhone, reason);
  return { ok: true as const, alreadyAt: false, status: target.nextStatus };
}

router.post("/:service/:id/actions", async (req: Request, res: Response) => {
  const service = String(req.params.service);
  const id = Number(req.params.id);
  const action = String(req.body?.action ?? "") as LifecycleAction | "contact";
  const reason = typeof req.body?.reason === "string" ? req.body.reason.trim().slice(0, 1000) : "";
  if (!Number.isInteger(id) || id <= 0) return res.status(400).json({ error: "ID transaksi tidak valid" });
  if (!["approve", "request_revision", "reject", "contact"].includes(action)) {
    return res.status(400).json({ error: "Action tidak valid" });
  }
  if ((action === "reject" || action === "request_revision") && !reason) {
    return res.status(400).json({ error: "Alasan wajib diisi untuk revisi atau penolakan" });
  }

  try {
    if (action === "contact") {
      const record = await loadDirectRecord(service, id);
      if (!record) return res.status(404).json({ error: "Kontak transaksi tidak ditemukan" });
      const phone = await resolveContactPhone(record.portal_customer_id, record.customer_phone);
      const normalized = phone ? normalizePortalPhone(phone) : "";
      if (!normalized || !isValidPortalPhone(normalized)) {
        return res.status(422).json({ error: "Nomor kontak customer tidak tersedia atau tidak valid" });
      }
      return res.json({ ok: true, action, reference: record.reference, phone: normalized, contactUrl: `https://wa.me/${normalized}` });
    }

    const internalActor = (req as Request & { isInternalSession?: boolean; user?: { id?: string } }).isInternalSession
      ? (req.user as { id?: string } | undefined)?.id
      : undefined;
    const actorId = String(internalActor ?? (req as any).portalCustomerId ?? "portal-admin");
    if (service === "logistic-order") {
      const current = await loadDirectRecord(service, id);
      if (!current) return res.status(404).json({ error: "Order canonical tidak ditemukan" });
      const target = getActionTarget(service, action, current.status);
      if (!target) return res.status(409).json({ error: `Action ${action} tidak tersedia dari status ${current.status}` });
      const transition = await transitionLogisticOrderStatus(id, target.nextStatus, {
        actorType: "admin",
        actorId,
        actorName: actorId,
        source: "portal-admin-service-operations",
        notes: reason || null,
      });
      if (!transition.ok) {
        return res.status(409).json({ error: transition.error ?? "Transisi order ditolak", allowedTransitions: transition.allowedTransitions });
      }
      return res.json({ ok: true, action, alreadyAt: transition.alreadyAt ?? false, status: transition.toStatus, reference: transition.orderNumber });
    }

    const result = await performDirectAction(service, id, action, reason || null, actorId);
    if (!result.ok) {
      const statusCode = result.code === "NOT_FOUND" ? 404 : result.code === "INVALID_TRANSITION" ? 409 : 422;
      return res.status(statusCode).json({ error: result.error });
    }
    return res.json({ ...result, action });
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("CONCURRENT_STATUS:")) {
      return res.status(409).json({ error: "Status transaksi berubah bersamaan. Muat ulang lalu coba lagi." });
    }
    console.error("[portal-admin-service-ops] action failed", { service, id, action, error });
    return res.status(500).json({ error: "Gagal menjalankan action lifecycle" });
  }
});

router.get("/:service/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const service = String(req.params.service);
  const tableQueries: Record<string, ReturnType<typeof sql>> = {
    marketplace: sql`SELECT (to_jsonb(r) || jsonb_build_object('purchase_order', NULL)) AS record FROM mkt_rfqs r WHERE r.id = ${id} AND r.status::text <> 'draft'`,
    "marketplace-po": sql`
      SELECT (to_jsonb(r) || jsonb_build_object('purchase_order', to_jsonb(p))) AS record
      FROM mkt_purchase_orders p
      JOIN mkt_rfqs r ON r.id = p.rfq_id
      WHERE p.id = ${id}
    `,
    "logistic-order": sql`SELECT to_jsonb(r) AS record FROM logistic_orders r WHERE r.id = ${id} AND r.source IN ('customer_portal', 'portal')`,
    ppjk: sql`SELECT to_jsonb(r) AS record FROM ppjk_orders r WHERE r.id = ${id} AND (r.portal_order_id IS NOT NULL OR r.created_by_id LIKE 'portal:%')`,
    "quote-request": sql`SELECT to_jsonb(r) AS record FROM quote_requests r WHERE r.id = ${id}`,
    "product-order": sql`SELECT to_jsonb(r) AS record FROM portal_product_orders r WHERE r.id = ${id}`,
    "service-request": sql`SELECT to_jsonb(r) AS record FROM customer_service_requests r WHERE r.id = ${id}`,
    "domestic-trucking": sql`SELECT to_jsonb(r) AS record FROM trucking_booking_requests r WHERE r.id = ${id} AND COALESCE(r.source, 'customer_portal') = 'customer_portal'`,
    "air-freight": sql`SELECT to_jsonb(r) AS record FROM air_freight_orders r WHERE r.id = ${id} AND COALESCE(r.source, 'customer_portal') = 'customer_portal'`,
    "ocean-freight": sql`SELECT to_jsonb(r) AS record FROM ocean_freight_orders r WHERE r.id = ${id} AND COALESCE(r.source, 'customer_portal') = 'customer_portal'`,
    "freight-forwarding": sql`SELECT to_jsonb(r) AS record FROM sales_documents r WHERE r.id = ${id} AND r.created_by_id LIKE 'portal:%'`,
    "custom-clearance": sql`SELECT to_jsonb(r) AS record FROM sales_documents r WHERE r.id = ${id} AND r.created_by_id LIKE 'portal:%'`,
  };
  const query = tableQueries[service];
  if (!query || !Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ error: "Referensi layanan tidak valid" });
  }

  try {
    const result = await db.execute(query);
    const record = result.rows[0] as { record?: Record<string, unknown> } | undefined;
    if (!record) return res.status(404).json({ error: "Transaksi canonical tidak ditemukan" });

    let history: unknown[] = [];
    if (service === "marketplace" || service === "marketplace-po") {
      const value = record.record ?? {};
      const rfqId = service === "marketplace-po"
        ? Number(value.rfq_id)
        : id;
      const historyResult = await db.execute(sql`
        SELECT id, actor_type, actor_name, action, old_value, new_value,
               description, created_at
        FROM activity_logs
        WHERE mkt_rfq_id = ${rfqId} OR rfq_id = ${rfqId}
           OR mkt_purchase_order_id = ${service === "marketplace-po" ? id : -1}
        ORDER BY created_at ASC, id ASC
      `);
      history = historyResult.rows;
    } else {
      const value = record.record ?? {};
      history = [
        { action: "created", status: value.status ?? null, created_at: value.created_at ?? null },
        ...(value.updated_at && value.updated_at !== value.created_at
          ? [{ action: "updated", status: value.status ?? null, created_at: value.updated_at }]
          : []),
      ];
    }
    const lifecycleHistory = await db.execute(sql`
      SELECT id, action, old_data, new_data, created_at
      FROM erp_audit_logs
      WHERE module = 'portal_customer_lifecycle'
        AND reference_id = ${`${service}:${id}`}
      ORDER BY created_at ASC, id ASC
    `);
    history = [...history, ...lifecycleHistory.rows];
    return res.json({ service, id, record: record.record, history });
  } catch (error) {
    console.error("[portal-admin-service-ops] detail failed", { service, id, error });
    return res.status(500).json({ error: "Gagal memuat detail transaksi canonical" });
  }
});

export default router;