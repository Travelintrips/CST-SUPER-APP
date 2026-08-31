import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requirePortalAdmin } from "../lib/supabaseAuth.js";

/**
 * One read model for work created from Customer Portal.
 *
 * This intentionally projects existing canonical tables only.  It is not a
 * transaction table and must never become a second source of truth.
 */
const router = Router();
router.use(requirePortalAdmin);

const sourceRows = sql`
  (
    SELECT
      'marketplace'::text AS service_key,
      'Marketplace / RFQ'::text AS service_label,
      r.id::int AS id,
      r.rfq_number::text AS reference,
      r.status::text AS status,
      r.buyer_name::text AS customer_name,
      COALESCE(r.buyer_company, '')::text AS customer_company,
      r.company_id::int AS company_id,
      r.portal_customer_id::int AS portal_customer_id,
      r.created_at AS created_at,
      r.updated_at AS updated_at,
      ('/bizportal/marketplace/rfqs/' || r.id)::text AS management_path,
      COALESCE(r.notes, '')::text AS summary
    FROM mkt_rfqs r
    WHERE r.status::text <> 'draft'

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
      COALESCE(r.portal_customer_id, r.customer_id)::int,
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
      COALESCE(NULLIF(r.pic_pickup, ''), 'Customer')::text,
      ''::text,
      r.company_id::int,
      COALESCE(r.portal_customer_id, r.customer_id)::int,
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
      COALESCE(r.customer_company, '')::text,
      r.company_id::int,
      r.portal_customer_id::int,
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
      r.portal_customer_id::int,
      r.created_at,
      r.updated_at,
      ('/bizportal/logistics/ocean-freight/' || r.id)::text,
      CONCAT(COALESCE(r.origin_port, ''), ' → ', COALESCE(r.destination_port, ''))::text
    FROM ocean_freight_orders r
    WHERE COALESCE(r.source, 'customer_portal') = 'customer_portal'

    UNION ALL

    SELECT
      CASE
        WHEN LOWER(COALESCE(d.category_key, '') || ' ' || COALESCE(d.product_scope, '') ||
          ' ' || COALESCE(lines.line_names, '')) LIKE '%custom%'
          OR LOWER(COALESCE(d.category_key, '') || ' ' || COALESCE(d.product_scope, '') ||
          ' ' || COALESCE(lines.line_names, '')) LIKE '%pabean%'
        THEN 'custom-clearance'
        ELSE 'freight-forwarding'
      END::text AS service_key,
      CASE
        WHEN LOWER(COALESCE(d.category_key, '') || ' ' || COALESCE(d.product_scope, '') ||
          ' ' || COALESCE(lines.line_names, '')) LIKE '%custom%'
          OR LOWER(COALESCE(d.category_key, '') || ' ' || COALESCE(d.product_scope, '') ||
          ' ' || COALESCE(lines.line_names, '')) LIKE '%pabean%'
        THEN 'Pabean / Custom Clearance'
        ELSE 'Freight Forwarding'
      END::text AS service_label,
      d.id::int,
      d.doc_number::text,
      d.status::text,
      d.customer_name::text,
      ''::text,
      d.company_id::int,
      NULL::int AS portal_customer_id,
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
               customer_name, customer_company, company_id, portal_customer_id,
               created_at, updated_at, management_path, summary
        ${from}
        ORDER BY created_at DESC, id DESC
        LIMIT ${limit} OFFSET ${offset}
      `),
      db.execute(sql`SELECT COUNT(*)::int AS total ${from}`),
      db.execute(sql`
        SELECT service_key, service_label, COUNT(*)::int AS total,
               COUNT(*) FILTER (WHERE status IN ('submitted', 'pending_review', 'waiting_rate', 'draft', 'reviewing', 'quoted'))::int AS pending
        ${from}
        GROUP BY service_key, service_label
        ORDER BY service_label
      `),
      db.execute(sql`SELECT COUNT(*)::int AS count FROM admin_notifications WHERE read_at IS NULL`),
    ]);

    return res.json({
      data: rows.rows,
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

router.get("/:service/:id", async (req: Request, res: Response) => {
  const id = Number(req.params.id);
  const service = String(req.params.service);
  const tableQueries: Record<string, ReturnType<typeof sql>> = {
    marketplace: sql`SELECT to_jsonb(r) AS record FROM mkt_rfqs r WHERE r.id = ${id}`,
    "service-request": sql`SELECT to_jsonb(r) AS record FROM customer_service_requests r WHERE r.id = ${id}`,
    "domestic-trucking": sql`SELECT to_jsonb(r) AS record FROM trucking_booking_requests r WHERE r.id = ${id}`,
    "air-freight": sql`SELECT to_jsonb(r) AS record FROM air_freight_orders r WHERE r.id = ${id}`,
    "ocean-freight": sql`SELECT to_jsonb(r) AS record FROM ocean_freight_orders r WHERE r.id = ${id}`,
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
    if (service === "marketplace") {
      const historyResult = await db.execute(sql`
        SELECT id, actor_type, actor_name, action, old_value, new_value,
               description, created_at
        FROM activity_logs
        WHERE mkt_rfq_id = ${id} OR rfq_id = ${id}
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
    return res.json({ service, id, record: record.record, history });
  } catch (error) {
    console.error("[portal-admin-service-ops] detail failed", { service, id, error });
    return res.status(500).json({ error: "Gagal memuat detail transaksi canonical" });
  }
});

export default router;