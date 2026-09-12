import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requirePortalAdmin } from "../lib/supabaseAuth.js";
import { transitionLogisticOrderStatus } from "../lib/services/logisticOrderStatusService.js";
import { notifyCustomerPortal } from "../lib/customerPortalNotificationService.js";
import { isValidPortalPhone, normalizePortalPhone } from "../lib/phoneUtils.js";
import { sendViaService } from "../lib/waTransport.js";
import { logger } from "../lib/logger.js";
import { logActivity } from "../lib/activityLog.js";
import { setMarketplaceDealPrice } from "../lib/services/mktDealPriceService.js";
import { inviteVendorToRfq } from "../lib/services/vendorInvitationService.js";
import { ObjectStorageService } from "../lib/objectStorage.js";
import {
  listShipmentTimeline,
  listShipmentsForPo,
} from "../lib/services/mktPoShipmentService.js";
import { listGoodsReceiptsForShipment } from "../lib/services/mktPoGoodsReceiptService.js";

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

type AdminServiceProjection = {
  finance: {
    available: boolean;
    applicable: boolean;
    source: string | null;
    invoice: Record<string, unknown> | null;
    payment: Record<string, unknown> | null;
    paymentProof: Record<string, unknown> | null;
  };
  timeline: {
    source: string;
    currentStatus: string | null;
    events: unknown[];
  };
  operations: {
    fulfillment: {
      status: "available" | "not_applicable";
      links: number;
      submissions: number;
      latestSubmissionAt: string | null;
    };
    tracking: {
      status: "available" | "not_applicable";
      source: string | null;
      currentStatus: string | null;
      events: unknown[];
    };
    pod: {
      status: "available" | "not_applicable";
      available: boolean;
      items: unknown[];
    };
    receipts: {
      status: "available" | "not_applicable";
      count: number;
    };
  };
};

/**
 * Read-only projection of the existing invoice/payment/proof/timeline
 * contracts. The admin portal must not create a parallel lifecycle.
 */
async function loadAdminServiceProjection(
  service: string,
  id: number,
  record: Record<string, unknown>,
): Promise<AdminServiceProjection> {
  let salesDocument: Record<string, unknown> | null = null;
  let source: string | null = null;

  if (service === "logistic-order") {
    source = "logistic_order";
    const result = await db.execute(sql`
      SELECT id, doc_number, invoice_number, invoice_date, due_date,
             invoice_status, payment_status, grand_total, amount_paid,
             invoice_pdf_url, proof_url, proof_uploaded_at, proof_remarks
      FROM sales_documents
      WHERE logistic_order_id = ${id}
      ORDER BY id DESC LIMIT 1
    `);
    salesDocument = (result.rows[0] as Record<string, unknown> | undefined) ?? null;
  } else if (service === "product-order") {
    source = "product_order";
    const result = await db.execute(sql`
      SELECT sd.id, sd.doc_number, sd.invoice_number, sd.invoice_date, sd.due_date,
             sd.invoice_status, sd.payment_status, sd.grand_total, sd.amount_paid,
             sd.invoice_pdf_url, sd.proof_url, sd.proof_uploaded_at, sd.proof_remarks
      FROM portal_product_orders po
      LEFT JOIN sales_documents sd ON sd.id = po.sales_doc_id
      WHERE po.id = ${id}
      LIMIT 1
    `);
    salesDocument = (result.rows[0] as Record<string, unknown> | undefined) ?? null;
  } else if (service === "marketplace-po") {
    source = "marketplace_purchase_order";
    const result = await db.execute(sql`
      SELECT sd.id, sd.doc_number, sd.invoice_number, sd.invoice_date, sd.due_date,
             sd.invoice_status, sd.payment_status, sd.grand_total, sd.amount_paid,
             sd.invoice_pdf_url, sd.proof_url, sd.proof_uploaded_at, sd.proof_remarks
      FROM mkt_purchase_orders po
      LEFT JOIN sales_documents sd ON sd.id = po.sales_document_id
      WHERE po.id = ${id}
      LIMIT 1
    `);
    salesDocument = (result.rows[0] as Record<string, unknown> | undefined) ?? null;
  } else if (service === "freight-forwarding" || service === "custom-clearance") {
    source = "sales_document";
    const result = await db.execute(sql`
      SELECT id, doc_number, invoice_number, invoice_date, due_date,
             invoice_status, payment_status, grand_total, amount_paid,
             invoice_pdf_url, proof_url, proof_uploaded_at, proof_remarks
      FROM sales_documents WHERE id = ${id} LIMIT 1
    `);
    salesDocument = (result.rows[0] as Record<string, unknown> | undefined) ?? null;
  }

  const invoice = salesDocument
    ? {
        id: Number(salesDocument.id),
        number: salesDocument.invoice_number ?? salesDocument.doc_number ?? null,
        status: salesDocument.invoice_status ?? "none",
        paymentStatus: salesDocument.payment_status ?? "unpaid",
        total: Number(salesDocument.grand_total ?? 0),
        amountPaid: Number(salesDocument.amount_paid ?? 0),
        outstanding: Math.max(0, Number(salesDocument.grand_total ?? 0) - Number(salesDocument.amount_paid ?? 0)),
        dueDate: salesDocument.due_date ?? null,
        pdfAvailable: Boolean(salesDocument.invoice_pdf_url),
        downloadUrl: `/api/portal/admin/service-operations/invoices/${Number(salesDocument.id)}/download`,
      }
    : null;
  const paymentProof = salesDocument
    ? {
        status: salesDocument.proof_url ? "uploaded_pending_review" : "not_uploaded",
        uploadedAt: salesDocument.proof_uploaded_at ?? null,
        remarks: salesDocument.proof_remarks ?? null,
        fileUrl: salesDocument.proof_url ? `/api/payment-proof/file/${Number(salesDocument.id)}` : null,
      }
    : null;
  let payment: Record<string, unknown> | null = null;
  if (salesDocument) {
    payment = {
      status: salesDocument.payment_status ?? "unpaid",
      amountPaid: Number(salesDocument.amount_paid ?? 0),
      fulfillmentGate: salesDocument.payment_status === "paid" ? "payment_verified" : "payment_required",
    };
  } else if (service === "product-order") {
    payment = {
      status: record.payment_status ?? "unpaid",
      amountPaid: record.payment_status === "paid" ? Number(record.grand_total ?? 0) : 0,
      fulfillmentGate: record.payment_status === "paid" ? "payment_verified" : "payment_required",
    };
  }

  let timelineSource = "status_only";
  let events: unknown[] = [];
  if (service === "logistic-order") {
    timelineSource = "logistic_order_updates";
    const [updates, progress] = await Promise.all([
      db.execute(sql`
      SELECT id, status, notes, actor_type, actor_name, created_at
      FROM order_updates WHERE order_id = ${id}
      ORDER BY created_at ASC, id ASC LIMIT 100
      `),
      db.execute(sql`
        SELECT id, status, notes, updated_by AS actor_name, created_at
        FROM order_tracking_progress WHERE order_id = ${id}
        ORDER BY created_at ASC, id ASC LIMIT 100
      `),
    ]);
    events = [...updates.rows, ...progress.rows].sort(
      (a, b) => new Date(String((a as any).created_at ?? 0)).getTime()
        - new Date(String((b as any).created_at ?? 0)).getTime(),
    );
  } else if (service === "marketplace-po") {
    timelineSource = "marketplace_shipment_events";
    const result = await db.execute(sql`
      SELECT e.id, e.event_type, e.note, e.location, e.actor_type, e.created_at,
             s.shipment_number
      FROM mkt_po_shipment_events e
      JOIN mkt_po_shipments s ON s.id = e.shipment_id
      WHERE s.po_id = ${id}
      ORDER BY e.created_at ASC, e.id ASC LIMIT 100
    `);
    events = result.rows;
  } else if (service === "air-freight") {
    timelineSource = "air_freight_tracking_events";
    const result = await db.execute(sql`
      SELECT id, event_type, note, created_at
      FROM air_freight_tracking_events
      WHERE order_id = ${id}
      ORDER BY created_at ASC, id ASC LIMIT 100
    `);
    events = result.rows;
  } else if (service === "ppjk") {
    timelineSource = "ppjk_status_logs";
    const result = await db.execute(sql`
      SELECT id, old_status, new_status, changed_at AS created_at, changed_by
      FROM ppjk_status_logs WHERE ppjk_order_id = ${id}
      ORDER BY changed_at ASC, id ASC LIMIT 100
    `);
    events = result.rows;
  }

  const operations: AdminServiceProjection["operations"] = {
    fulfillment: {
      status: "not_applicable",
      links: 0,
      submissions: 0,
      latestSubmissionAt: null,
    },
    tracking: {
      status: "not_applicable",
      source: null,
      currentStatus: null,
      events: [],
    },
    pod: {
      status: "not_applicable",
      available: false,
      items: [],
    },
    receipts: {
      status: "not_applicable",
      count: 0,
    },
  };

  if (service === "logistic-order") {
    const [fulfillment, pods] = await Promise.all([
      db.execute(sql`
        SELECT
          (
            (SELECT COUNT(*) FROM order_fulfillment_links WHERE order_id = ${id})
            + (SELECT COUNT(*) FROM vendor_fulfillment_links WHERE order_id = ${id})
          )::int AS links,
          (
            (SELECT COUNT(*) FROM order_fulfillment_submissions WHERE order_id = ${id})
            + (SELECT COUNT(*) FROM vendor_fulfillment_links WHERE order_id = ${id} AND status = 'submitted')
          )::int AS submissions,
          GREATEST(
            (SELECT MAX(created_at) FROM order_fulfillment_submissions WHERE order_id = ${id}),
            (SELECT MAX(submitted_at) FROM vendor_fulfillment_links WHERE order_id = ${id} AND status = 'submitted')
          ) AS latest_submission_at
      `),
      db.execute(sql`
        SELECT id, receiver_name, photo_url, note, submitted_by, created_at
        FROM order_pod_submissions
        WHERE order_id = ${id}
        ORDER BY created_at DESC
        LIMIT 5
      `),
    ]);
    const fulfillmentRow = fulfillment.rows[0] as Record<string, unknown> | undefined;
    operations.fulfillment = {
      status: "available",
      links: Number(fulfillmentRow?.links ?? 0),
      submissions: Number(fulfillmentRow?.submissions ?? 0),
      latestSubmissionAt: fulfillmentRow?.latest_submission_at
        ? new Date(String(fulfillmentRow.latest_submission_at)).toISOString()
        : null,
    };
    operations.tracking = {
      status: "available",
      source: "order_updates + order_tracking_progress",
      currentStatus: String(record.status ?? "") || null,
      events,
    };
    operations.pod = {
      status: "available",
      available: pods.rows.length > 0,
      items: pods.rows,
    };
  } else if (service === "marketplace-po") {
    const shipments = await listShipmentsForPo(id);
    const shipmentViews = await Promise.all(shipments.map(async (shipment) => {
      const [timeline, receipts] = await Promise.all([
        listShipmentTimeline(shipment.id),
        listGoodsReceiptsForShipment(shipment.id),
      ]);
      const safeTimeline = timeline.map((event) => ({
        id: event.id,
        eventType: event.eventType,
        note: event.note,
        location: event.location,
        actorType: event.actorType,
        actorName: event.actorName,
        createdAt: event.createdAt,
        hasAttachment: Boolean(event.attachmentObjectPath),
      }));
      const podEvents = safeTimeline.filter((event) => event.eventType === "pod_uploaded");
      return {
        id: shipment.id,
        shipmentNumber: shipment.shipmentNumber,
        shipmentStatus: shipment.shipmentStatus,
        shipmentType: shipment.shipmentType,
        carrierName: shipment.carrierName,
        trackingNumber: shipment.trackingNumber,
        origin: shipment.origin,
        destination: shipment.destination,
        plannedDeparture: shipment.plannedDeparture,
        estimatedArrival: shipment.estimatedArrival,
        events: safeTimeline,
        podAvailable: podEvents.some((event) => event.hasAttachment),
        receipts: receipts.map((receipt) => ({
          id: receipt.id,
          receiptNumber: receipt.receiptNumber,
          receiptType: receipt.receiptType,
          inspectionStatus: receipt.inspectionStatus,
          receivedAt: receipt.receivedAt,
          receivedBy: receipt.receivedBy,
        })),
      };
    }));
    const shipmentEvents = shipmentViews.flatMap((shipment) => shipment.events);
    const podItems = shipmentViews
      .filter((shipment) => shipment.podAvailable)
      .map((shipment) => ({ shipmentId: shipment.id, shipmentNumber: shipment.shipmentNumber, available: true }));
    operations.fulfillment = {
      status: "available",
      links: shipmentViews.length,
      submissions: shipmentViews.filter((shipment) => shipment.shipmentStatus !== "planned").length,
      latestSubmissionAt: null,
    };
    operations.tracking = {
      status: "available",
      source: "mkt_po_shipments + mkt_po_shipment_events",
      currentStatus: String(record.status ?? "") || null,
      events: shipmentEvents,
    };
    operations.pod = {
      status: "available",
      available: podItems.length > 0,
      items: podItems,
    };
    operations.receipts = {
      status: "available",
      count: shipmentViews.reduce((sum, shipment) => sum + shipment.receipts.length, 0),
    };
    // Keep the richer shipment/receipt view separate from the generic timeline.
    events = shipmentViews;
    timelineSource = "mkt_po_shipments + mkt_po_shipment_events";
  } else if (service === "air-freight") {
    operations.tracking = {
      status: "available",
      source: "air_freight_tracking_events",
      currentStatus: String(record.tracking_status ?? record.status ?? "") || null,
      events,
    };
  } else if (service === "product-order") {
    const trackingAvailable = Boolean(record.tracking_token || record.tracking_number || record.tracking_status);
    operations.tracking = {
      status: trackingAvailable ? "available" : "not_applicable",
      source: trackingAvailable ? "portal_product_orders" : null,
      currentStatus: String(record.tracking_status ?? record.status ?? "") || null,
      events: [],
    };
  } else if (service === "ocean-freight") {
    const trackingAvailable = Boolean(record.tracking_status || record.tracking_notes || record.tracking_updated_at);
    operations.tracking = {
      status: trackingAvailable ? "available" : "not_applicable",
      source: trackingAvailable ? "ocean_freight_orders" : null,
      currentStatus: String(record.tracking_status ?? record.status ?? "") || null,
      events: [],
    };
  }

  const financeApplicable = ["logistic-order", "product-order", "marketplace-po", "freight-forwarding", "custom-clearance"].includes(service);
  return {
    finance: {
      available: Boolean(invoice || payment),
      applicable: financeApplicable,
      source: salesDocument ? source : null,
      invoice,
      payment,
      paymentProof,
    },
    timeline: {
      source: timelineSource,
      currentStatus: String(record.status ?? "") || null,
      events,
    },
    operations,
  };
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

router.get("/marketplace/:rfqId/vendor-routing", async (req: Request, res: Response) => {
  const rfqId = Number(req.params.rfqId);
  if (!Number.isInteger(rfqId) || rfqId <= 0) {
    return res.status(400).json({ ok: false, error: "RFQ tidak valid" });
  }

  try {
    const result = await db.execute(sql`
      SELECT
        COALESCE(r.catalog_vendor_id, catalog.vendor_id)::int AS vendor_id,
        s.name::text AS vendor_name,
        s.is_active::boolean AS vendor_active,
        q.id::int AS quote_id,
        q.status::text AS quote_status
      FROM mkt_rfqs r
      LEFT JOIN LATERAL (
        SELECT vci.vendor_id
        FROM mkt_rfq_lines line
        JOIN vendor_catalog_items vci ON vci.id = line.vendor_catalog_item_id
        WHERE line.rfq_id = r.id
        ORDER BY line.sort_order ASC, line.id ASC
        LIMIT 1
      ) catalog ON TRUE
      LEFT JOIN suppliers s ON s.id = COALESCE(r.catalog_vendor_id, catalog.vendor_id)
      LEFT JOIN LATERAL (
        SELECT id, status
        FROM mkt_vendor_quotes
        WHERE rfq_id = r.id
          AND vendor_id = COALESCE(r.catalog_vendor_id, catalog.vendor_id)
        ORDER BY id DESC
        LIMIT 1
      ) q ON TRUE
      WHERE r.id = ${rfqId}
      LIMIT 1
    `);
    const row = result.rows[0] as Record<string, unknown> | undefined;
    if (!row) return res.status(404).json({ ok: false, error: "RFQ tidak ditemukan" });
    return res.json({
      ok: true,
      data: {
        hasVendor: row.vendor_id != null,
        vendorId: row.vendor_id == null ? null : Number(row.vendor_id),
        vendorName: row.vendor_name == null ? null : String(row.vendor_name),
        vendorActive: row.vendor_active == null ? null : Boolean(row.vendor_active),
        quoteId: row.quote_id == null ? null : Number(row.quote_id),
        quoteStatus: row.quote_status == null ? null : String(row.quote_status),
      },
    });
  } catch (error) {
    logger.warn({ err: error, rfqId }, "[portal-admin-service-ops] vendor routing read failed");
    return res.status(500).json({ ok: false, error: "Gagal memuat vendor produk" });
  }
});

router.post("/marketplace/:rfqId/vendor-routing/invite", async (req: Request, res: Response) => {
  const rfqId = Number(req.params.rfqId);
  const requestedVendorId = Number(req.body?.vendorId);
  if (!Number.isInteger(rfqId) || rfqId <= 0) {
    return res.status(400).json({ ok: false, error: "RFQ tidak valid" });
  }

  try {
    const candidate = await db.execute(sql`
      SELECT COALESCE(r.catalog_vendor_id, catalog.vendor_id)::int AS vendor_id
      FROM mkt_rfqs r
      LEFT JOIN LATERAL (
        SELECT vci.vendor_id
        FROM mkt_rfq_lines line
        JOIN vendor_catalog_items vci ON vci.id = line.vendor_catalog_item_id
        WHERE line.rfq_id = r.id
        ORDER BY line.sort_order ASC, line.id ASC
        LIMIT 1
      ) catalog ON TRUE
      WHERE r.id = ${rfqId}
      LIMIT 1
    `);
    const catalogVendorId = Number((candidate.rows[0] as { vendor_id?: number | null } | undefined)?.vendor_id);
    if (!Number.isInteger(catalogVendorId) || catalogVendorId <= 0) {
      return res.status(422).json({ ok: false, error: "RFQ ini tidak memiliki vendor produk katalog" });
    }
    if (Number.isInteger(requestedVendorId) && requestedVendorId !== catalogVendorId) {
      return res.status(422).json({ ok: false, error: "Vendor harus merupakan pemilik produk pada RFQ ini" });
    }

    const portalAdmin = req as Request & { isInternalSession?: boolean; portalCustomerId?: number; user?: { id?: string; name?: string } };
    const result = await inviteVendorToRfq({
      rfqId,
      vendorId: catalogVendorId,
      adminId: portalAdmin.isInternalSession
        ? portalAdmin.user?.id ?? "internal-portal-admin"
        : `portal-admin:${portalAdmin.portalCustomerId ?? "unknown"}`,
      adminName: portalAdmin.user?.name ?? "Customer Portal Admin",
      ipAddress: req.ip ?? null,
    });
    if (!result.ok) {
      const status = result.code === "RFQ_NOT_FOUND" || result.code === "VENDOR_NOT_FOUND"
        ? 404
        : result.code === "DUPLICATE_INVITE" ? 409
          : result.code === "VENDOR_INACTIVE" ? 422 : 500;
      return res.status(status).json({ ok: false, error: result.message });
    }
    return res.status(201).json({
      ok: true,
      data: {
        quoteId: result.quoteId,
        vendorName: result.vendorName,
        status: result.status,
        validUntil: result.validUntil.toISOString(),
      },
    });
  } catch (error) {
    logger.warn({ err: error, rfqId }, "[portal-admin-service-ops] vendor routing invite failed");
    return res.status(500).json({ ok: false, error: "Gagal mengirim RFQ ke vendor produk" });
  }
});

router.get("/marketplace/:rfqId/deal-price", async (req: Request, res: Response) => {
  const rfqId = Number(req.params.rfqId);
  if (!Number.isInteger(rfqId) || rfqId <= 0) {
    return res.status(400).json({ ok: false, error: "RFQ tidak valid" });
  }

  try {
    const result = await db.execute(sql`
      SELECT
        vq.id AS quote_id,
        vq.status::text AS quote_status,
        vq.updated_at,
        s.name AS vendor_name,
        COALESCE(
          json_agg(
            json_build_object(
              'rfqLineId', vql.rfq_line_id,
              'itemName', rl.item_name,
              'unit', rl.item_unit,
              'offeredQty', vql.offered_qty,
              'vendorUnitPrice', vql.offered_unit_price,
              'vendorSubtotal', vql.subtotal,
              'dealUnitPrice', vql.negotiated_unit_price,
              'dealSubtotal', vql.negotiated_subtotal
            ) ORDER BY vql.rfq_line_id
          ) FILTER (WHERE vql.id IS NOT NULL),
          '[]'::json
        ) AS lines
      FROM mkt_vendor_quotes vq
      JOIN suppliers s ON s.id = vq.vendor_id
      LEFT JOIN mkt_vendor_quote_lines vql ON vql.quote_id = vq.id
      LEFT JOIN mkt_rfq_lines rl ON rl.id = vql.rfq_line_id
      WHERE vq.rfq_id = ${rfqId}
        AND vq.status::text IN ('submitted', 'selected')
      GROUP BY vq.id, vq.status, vq.updated_at, s.name
      ORDER BY vq.id
    `);

    const quotes = (result.rows as Array<Record<string, unknown>>).map((quote) => {
      const lines = Array.isArray(quote.lines) ? quote.lines : [];
      const dealTotal = lines.every((line) => {
        const value = (line as Record<string, unknown>).dealSubtotal;
        return value !== null && value !== undefined;
      })
        ? lines.reduce((sum, line) => sum + Number((line as Record<string, unknown>).dealSubtotal), 0)
        : null;
      return { ...quote, dealTotal };
    });

    return res.json({ ok: true, data: { rfqId, quotes } });
  } catch (error) {
    logger.warn({ err: error, rfqId }, "[portal-admin-service-ops] deal price read failed");
    return res.status(500).json({ ok: false, error: "Gagal memuat harga deal" });
  }
});

router.put("/marketplace/:rfqId/deal-price/:quoteId", async (req: Request, res: Response) => {
  const rfqId = Number(req.params.rfqId);
  const quoteId = Number(req.params.quoteId);
  if (!Number.isInteger(rfqId) || rfqId <= 0 || !Number.isInteger(quoteId) || quoteId <= 0) {
    return res.status(400).json({ ok: false, error: "RFQ atau quote tidak valid" });
  }

  const body = req.body as {
    expectedUpdatedAt?: unknown;
    dealNotes?: unknown;
    lines?: unknown;
  };
  if (!Array.isArray(body.lines) || body.lines.length === 0) {
    return res.status(422).json({ ok: false, error: "Semua harga deal wajib diisi" });
  }
  const lines = body.lines.map((line) => {
    const item = line as { rfqLineId?: unknown; dealUnitPrice?: unknown };
    return {
      rfqLineId: Number(item.rfqLineId),
      dealUnitPrice: Number(item.dealUnitPrice),
    };
  });
  if (lines.some((line) => !Number.isInteger(line.rfqLineId) || line.rfqLineId <= 0 || !Number.isFinite(line.dealUnitPrice) || line.dealUnitPrice <= 0)) {
    return res.status(422).json({ ok: false, error: "Harga deal harus berupa angka lebih besar dari nol" });
  }

  const portalAdmin = req as Request & { portalCustomerId?: number; isInternalSession?: boolean; user?: { id?: string; name?: string } };
  const actorId = portalAdmin.isInternalSession
    ? portalAdmin.user?.id ?? "internal-portal-admin"
    : `portal-admin:${portalAdmin.portalCustomerId ?? "unknown"}`;

  try {
    const result = await setMarketplaceDealPrice({
      rfqId,
      quoteId,
      actorId,
      lines,
      dealNotes: typeof body.dealNotes === "string" ? body.dealNotes : null,
      expectedUpdatedAt: typeof body.expectedUpdatedAt === "string" ? body.expectedUpdatedAt : null,
    });
    if (!result.ok) {
      const status = result.code === "QUOTE_NOT_FOUND" ? 404
        : ["DEAL_PRICE_LOCKED", "STALE_DEAL_PRICE"].includes(result.code) ? 409
          : 422;
      return res.status(status).json({ ok: false, error: result.code, message: result.message });
    }

    await logActivity({
      mktRfqId: rfqId,
      mktVendorQuoteId: quoteId,
      actorType: "admin",
      actorId,
      actorName: portalAdmin.user?.name ?? actorId,
      action: "mkt_deal_price_updated",
      description: `Harga deal quote ${quoteId} diperbarui dari Customer Portal Admin`,
      newValue: { quoteId, rfqId, lines: result.lines, dealTotal: result.dealTotal, notes: typeof body.dealNotes === "string" ? body.dealNotes : null },
    });
    return res.json({ ok: true, data: result });
  } catch (error) {
    logger.warn({ err: error, rfqId, quoteId }, "[portal-admin-service-ops] deal price update failed");
    return res.status(500).json({ ok: false, error: "Gagal menyimpan harga deal" });
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
    const projection = await loadAdminServiceProjection(service, id, record.record ?? {});
    return res.json({ service, id, record: record.record, history, projection });
  } catch (error) {
    console.error("[portal-admin-service-ops] detail failed", { service, id, error });
    return res.status(500).json({ error: "Gagal memuat detail transaksi canonical" });
  }
});

export default router;