import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requirePortalAdmin } from "../lib/supabaseAuth.js";
import { auditFromReq } from "../lib/auditLog.js";
import { getPreferredDomain } from "../lib/domain.js";
import { generateTokenPair } from "../lib/tokenUtils.js";

/**
 * Read model for the admin "Undang Vendor" workspace.
 *
 * This router deliberately keeps token-bearing records behind a separate,
 * authenticated action. The list and detail queries never select a token.
 */
export const adminVendorServiceRequestsRouter = Router();

const MAX_LIMIT = 100;
const SOURCE_TYPES = new Set([
  "portal_invitation",
  "logistic_rfq",
  "air_freight_rfq",
  "ocean_freight_rfq",
  "marketplace_quote",
]);

function publicOrigin(): string {
  const domain = getPreferredDomain();
  return domain ? `https://${domain}` : "";
}

function buildLink(sourceType: string, token: string): string {
  const origin = publicOrigin();
  if (!origin) throw new Error("Public URL belum dikonfigurasi");
  const encoded = encodeURIComponent(token);
  switch (sourceType) {
    case "portal_invitation":
      return `${origin}/vendor-register?token=${encoded}`;
    case "logistic_rfq":
      return `${origin}/vendor-form/${encoded}`;
    case "air_freight_rfq":
      return `${origin}/air-freight-form/${encoded}`;
    case "ocean_freight_rfq":
      return `${origin}/ocean-freight-vendor-form/${encoded}`;
    case "marketplace_quote":
      return `${origin}/mkt-vendor-quote/${encoded}`;
    default:
      throw new Error("Jenis link tidak didukung");
  }
}

function sourceId(value: unknown): number | null {
  const n = Number(value);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? String(value[0] ?? "") : String(value ?? "");
}

/**
 * All branches expose the same columns. `token_available` is only a boolean;
 * a raw token must never cross this read-model boundary.
 */
const unifiedCte = sql`
  WITH unified AS (
    SELECT
      'portal_invitation'::text AS source_type,
      p.id::text AS source_id,
      p.id::text AS invitation_id,
      ('INV-' || p.id::text)::text AS request_number,
      NULL::text AS customer_name,
      NULL::text AS customer_email,
      COALESCE(NULLIF(p.company_name, ''), NULL)::text AS customer_company,
      COALESCE(p.supplier_id, NULL)::int AS vendor_id,
      p.vendor_name::text AS vendor_name,
      p.phone::text AS vendor_phone,
      p.email::text AS vendor_email,
      COALESCE(NULLIF(p.service_type, ''), NULLIF(p.category_label, ''), 'Vendor onboarding')::text AS raw_service_type,
      CASE
        WHEN lower(COALESCE(p.service_type, '') || ' ' || COALESCE(p.category, '')) LIKE '%truck%'
          OR lower(COALESCE(p.service_type, '') || ' ' || COALESCE(p.category, '')) LIKE '%darat%' THEN 'trucking'
        WHEN lower(COALESCE(p.service_type, '') || ' ' || COALESCE(p.category, '')) LIKE '%sea%'
          OR lower(COALESCE(p.service_type, '') || ' ' || COALESCE(p.category, '')) LIKE '%ocean%'
          OR lower(COALESCE(p.service_type, '') || ' ' || COALESCE(p.category, '')) LIKE '%laut%' THEN 'sea_freight'
        WHEN lower(COALESCE(p.service_type, '') || ' ' || COALESCE(p.category, '')) LIKE '%air%' THEN 'air_freight'
        WHEN lower(COALESCE(p.service_type, '') || ' ' || COALESCE(p.category, '')) LIKE '%custom%'
          OR lower(COALESCE(p.service_type, '') || ' ' || COALESCE(p.category, '')) LIKE '%pabean%'
          OR lower(COALESCE(p.service_type, '') || ' ' || COALESCE(p.category, '')) LIKE '%ppjk%' THEN 'customs'
        ELSE 'other'
      END::text AS service_key,
      p.status::text AS request_status,
      NULL::text AS quote_status,
      p.status::text AS raw_status,
      NULL::text AS quotation_number,
      NULL::numeric AS quote_amount,
      NULL::text AS quote_notes,
      p.notes::text AS request_notes,
      p.created_at::timestamptz AS created_at,
      p.created_at::timestamptz AS invited_at,
      NULL::timestamptz AS opened_at,
      p.accepted_at::timestamptz AS submitted_at,
      p.valid_until::timestamptz AS expires_at,
      (p.token IS NOT NULL AND p.token <> '')::boolean AS token_available
    FROM portal_vendor_invitations p

    UNION ALL

    SELECT
      'logistic_rfq'::text,
      l.id::text,
      l.id::text,
      r.rfq_number::text,
      o.customer_name::text,
      o.email::text,
      o.company_name::text,
      v.id::int,
      v.name::text,
      v.phone::text,
      v.contact_email::text,
      COALESCE(NULLIF(o.service_category, ''), NULLIF(o.transport_mode, ''), NULLIF(o.shipment_type, ''), NULLIF(o.shipment_mode, ''), r.rfq_type, 'Logistics')::text,
      CASE
        WHEN lower(COALESCE(o.service_category, '') || ' ' || COALESCE(o.transport_mode, '') || ' ' || COALESCE(o.shipment_type, '') || ' ' || COALESCE(o.shipment_mode, '') || ' ' || COALESCE(r.rfq_type, '') || ' ' || COALESCE(l.rfq_type, '')) LIKE '%air%' THEN 'air_freight'
        WHEN lower(COALESCE(o.service_category, '') || ' ' || COALESCE(o.transport_mode, '') || ' ' || COALESCE(o.shipment_type, '') || ' ' || COALESCE(o.shipment_mode, '') || ' ' || COALESCE(r.rfq_type, '') || ' ' || COALESCE(l.rfq_type, '')) LIKE '%sea%'
          OR lower(COALESCE(o.service_category, '') || ' ' || COALESCE(o.transport_mode, '') || ' ' || COALESCE(o.shipment_type, '') || ' ' || COALESCE(o.shipment_mode, '') || ' ' || COALESCE(r.rfq_type, '') || ' ' || COALESCE(l.rfq_type, '')) LIKE '%ocean%'
          OR lower(COALESCE(o.service_category, '') || ' ' || COALESCE(o.transport_mode, '') || ' ' || COALESCE(o.shipment_type, '') || ' ' || COALESCE(o.shipment_mode, '') || ' ' || COALESCE(r.rfq_type, '') || ' ' || COALESCE(l.rfq_type, '')) LIKE '%laut%' THEN 'sea_freight'
        WHEN lower(COALESCE(o.service_category, '') || ' ' || COALESCE(o.transport_mode, '') || ' ' || COALESCE(o.shipment_type, '') || ' ' || COALESCE(o.shipment_mode, '') || ' ' || COALESCE(r.rfq_type, '') || ' ' || COALESCE(l.rfq_type, '')) LIKE '%custom%'
          OR lower(COALESCE(o.service_category, '') || ' ' || COALESCE(o.transport_mode, '') || ' ' || COALESCE(o.shipment_type, '') || ' ' || COALESCE(o.shipment_mode, '') || ' ' || COALESCE(r.rfq_type, '') || ' ' || COALESCE(l.rfq_type, '')) LIKE '%pabean%'
          OR lower(COALESCE(o.service_category, '') || ' ' || COALESCE(o.transport_mode, '') || ' ' || COALESCE(o.shipment_type, '') || ' ' || COALESCE(o.shipment_mode, '') || ' ' || COALESCE(r.rfq_type, '') || ' ' || COALESCE(l.rfq_type, '')) LIKE '%ppjk%' THEN 'customs'
        WHEN lower(COALESCE(o.service_category, '') || ' ' || COALESCE(o.transport_mode, '') || ' ' || COALESCE(o.shipment_type, '') || ' ' || COALESCE(o.shipment_mode, '') || ' ' || COALESCE(r.rfq_type, '') || ' ' || COALESCE(l.rfq_type, '')) LIKE '%domestic%'
          OR lower(COALESCE(o.service_category, '') || ' ' || COALESCE(o.transport_mode, '') || ' ' || COALESCE(o.shipment_type, '') || ' ' || COALESCE(o.shipment_mode, '') || ' ' || COALESCE(r.rfq_type, '') || ' ' || COALESCE(l.rfq_type, '')) LIKE '%domestik%' THEN 'domestic'
        WHEN lower(COALESCE(o.service_category, '') || ' ' || COALESCE(o.transport_mode, '') || ' ' || COALESCE(o.shipment_type, '') || ' ' || COALESCE(o.shipment_mode, '') || ' ' || COALESCE(r.rfq_type, '') || ' ' || COALESCE(l.rfq_type, '')) LIKE '%truck%'
          OR lower(COALESCE(o.service_category, '') || ' ' || COALESCE(o.transport_mode, '') || ' ' || COALESCE(o.shipment_type, '') || ' ' || COALESCE(o.shipment_mode, '') || ' ' || COALESCE(r.rfq_type, '') || ' ' || COALESCE(l.rfq_type, '')) LIKE '%darat%' THEN 'trucking'
        ELSE 'other'
      END::text,
      COALESCE(r.status, 'unknown')::text,
      l.status::text,
      l.status::text,
      NULL::text,
      l.offered_price::numeric,
      l.notes::text,
      o.notes::text,
      l.created_at::timestamptz,
      l.created_at::timestamptz,
      l.opened_at::timestamptz,
      l.submitted_at::timestamptz,
      COALESCE(l.expired_at, r.response_deadline)::timestamptz,
      (l.token IS NOT NULL AND l.token <> '')::boolean
    FROM rfq_vendor_links l
    JOIN logistic_order_rfqs r ON r.id = l.rfq_id
    JOIN logistic_orders o ON o.id = r.order_id
    LEFT JOIN suppliers v ON v.id = l.vendor_id

    UNION ALL

    SELECT
      'air_freight_rfq'::text,
      s.id::text,
      s.id::text,
      r.rfq_number::text,
      o.customer_name::text,
      o.customer_email::text,
      NULL::text,
      v.id::int,
      COALESCE(v.name, s.vendor_name)::text,
      v.phone::text,
      v.contact_email::text,
      'Air Freight'::text,
      'air_freight'::text,
      COALESCE(r.status, 'unknown')::text,
      s.status::text,
      s.status::text,
      NULL::text,
      s.total_idr::numeric,
      s.notes::text,
      NULL::text,
      s.created_at::timestamptz,
      s.created_at::timestamptz,
      s.form_opened_at::timestamptz,
      s.submitted_at::timestamptz,
      r.response_deadline::timestamptz,
      (s.token IS NOT NULL AND s.token <> '')::boolean
    FROM air_freight_rate_submissions s
    JOIN air_freight_rfqs r ON r.id = s.rfq_id
    JOIN air_freight_orders o ON o.id = s.order_id
    LEFT JOIN suppliers v ON v.id = s.vendor_id

    UNION ALL

    SELECT
      'ocean_freight_rfq'::text,
      s.id::text,
      s.id::text,
      r.rfq_number::text,
      o.customer_name::text,
      o.customer_email::text,
      o.customer_company::text,
      v.id::int,
      COALESCE(v.name, s.vendor_name)::text,
      v.phone::text,
      v.contact_email::text,
      'Sea Freight / Ocean Freight'::text,
      'sea_freight'::text,
      COALESCE(r.status, 'unknown')::text,
      s.status::text,
      s.status::text,
      NULL::text,
      COALESCE(s.total_amount_idr, s.total_amount)::numeric,
      s.notes::text,
      o.customer_notes::text,
      s.created_at::timestamptz,
      s.created_at::timestamptz,
      s.form_opened_at::timestamptz,
      s.submitted_at::timestamptz,
      r.response_deadline::timestamptz,
      (s.token IS NOT NULL AND s.token <> '')::boolean
    FROM ocean_freight_rate_submissions s
    JOIN ocean_freight_rfqs r ON r.id = s.rfq_id
    JOIN ocean_freight_orders o ON o.id = s.order_id
    LEFT JOIN suppliers v ON v.id = s.vendor_id

    UNION ALL

    SELECT
      'marketplace_quote'::text,
      q.id::text,
      q.id::text,
      r.rfq_number::text,
      r.buyer_name::text,
      r.buyer_email::text,
      r.buyer_company::text,
      v.id::int,
      v.name::text,
      v.phone::text,
      v.contact_email::text,
      COALESCE(
        NULLIF(catalog.service_type, ''),
        NULLIF(catalog.category_key, ''),
        NULLIF(line.item_name, ''),
        'Marketplace / Produk'
      )::text,
      CASE
        WHEN lower(COALESCE(catalog.service_type, '') || ' ' || COALESCE(catalog.category_key, '') || ' ' || COALESCE(line.item_name, '')) LIKE '%truck%'
          OR lower(COALESCE(catalog.service_type, '') || ' ' || COALESCE(catalog.category_key, '') || ' ' || COALESCE(line.item_name, '')) LIKE '%darat%' THEN 'trucking'
        WHEN lower(COALESCE(catalog.service_type, '') || ' ' || COALESCE(catalog.category_key, '') || ' ' || COALESCE(line.item_name, '')) LIKE '%sea%'
          OR lower(COALESCE(catalog.service_type, '') || ' ' || COALESCE(catalog.category_key, '') || ' ' || COALESCE(line.item_name, '')) LIKE '%ocean%'
          OR lower(COALESCE(catalog.service_type, '') || ' ' || COALESCE(catalog.category_key, '') || ' ' || COALESCE(line.item_name, '')) LIKE '%laut%' THEN 'sea_freight'
        WHEN lower(COALESCE(catalog.service_type, '') || ' ' || COALESCE(catalog.category_key, '') || ' ' || COALESCE(line.item_name, '')) LIKE '%air%' THEN 'air_freight'
        WHEN lower(COALESCE(catalog.service_type, '') || ' ' || COALESCE(catalog.category_key, '') || ' ' || COALESCE(line.item_name, '')) LIKE '%custom%'
          OR lower(COALESCE(catalog.service_type, '') || ' ' || COALESCE(catalog.category_key, '') || ' ' || COALESCE(line.item_name, '')) LIKE '%pabean%'
          OR lower(COALESCE(catalog.service_type, '') || ' ' || COALESCE(catalog.category_key, '') || ' ' || COALESCE(line.item_name, '')) LIKE '%ppjk%' THEN 'customs'
        ELSE 'marketplace'
      END::text,
      r.status::text,
      q.status::text,
      q.status::text,
      q.quotation_number::text,
      NULL::numeric,
      q.notes::text,
      r.notes::text,
      q.created_at::timestamptz,
      q.created_at::timestamptz,
      q.opened_at::timestamptz,
      q.submitted_at::timestamptz,
      q.valid_until::timestamptz,
      (q.token IS NOT NULL AND q.token <> '')::boolean
    FROM mkt_vendor_quotes q
    JOIN mkt_rfqs r ON r.id = q.rfq_id
    JOIN suppliers v ON v.id = q.vendor_id
    LEFT JOIN LATERAL (
      SELECT item_name, vendor_catalog_item_id
      FROM mkt_rfq_lines
      WHERE rfq_id = r.id
      ORDER BY sort_order ASC, id ASC
      LIMIT 1
    ) line ON TRUE
    LEFT JOIN vendor_catalog_items catalog ON catalog.id = line.vendor_catalog_item_id
  )
`;

function filters(req: Request) {
  const clauses: ReturnType<typeof sql>[] = [];
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const service = typeof req.query.service === "string" ? req.query.service.trim() : "";
  const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
  const vendorId = sourceId(req.query.vendorId);
  const linkStatus = typeof req.query.linkStatus === "string" ? req.query.linkStatus : "";

  if (q) {
    const pattern = `%${q}%`;
    clauses.push(sql`(
      request_number ILIKE ${pattern} OR
      COALESCE(customer_name, '') ILIKE ${pattern} OR
      COALESCE(vendor_name, '') ILIKE ${pattern} OR
      COALESCE(raw_service_type, '') ILIKE ${pattern} OR
      COALESCE(source_type, '') ILIKE ${pattern}
    )`);
  }
  if (service && service !== "all") clauses.push(sql`service_key = ${service}`);
  if (status && status !== "all") clauses.push(sql`raw_status = ${status}`);
  if (vendorId != null) clauses.push(sql`vendor_id = ${vendorId}`);
  if (linkStatus === "missing") clauses.push(sql`token_available = false`);
  if (linkStatus === "active") clauses.push(sql`token_available = true AND (expires_at IS NULL OR expires_at >= NOW())`);
  if (linkStatus === "expired") clauses.push(sql`expires_at IS NOT NULL AND expires_at < NOW()`);
  return clauses.length ? sql`WHERE ${sql.join(clauses, sql` AND `)}` : sql``;
}

adminVendorServiceRequestsRouter.get("/", requirePortalAdmin, async (req, res) => {
  try {
    const page = Math.max(1, Number(req.query.page ?? 1) || 1);
    const limit = Math.min(MAX_LIMIT, Math.max(1, Number(req.query.limit ?? 25) || 25));
    const offset = (page - 1) * limit;
    const where = filters(req);
    const [data, count] = await Promise.all([
      db.execute(sql`${unifiedCte}
        SELECT source_type, source_id, invitation_id, request_number,
               customer_name, customer_email, customer_company,
               vendor_id, vendor_name, vendor_phone, vendor_email,
               raw_service_type, service_key, request_status, quote_status,
               raw_status, quotation_number, quote_amount, quote_notes,
               request_notes, created_at, invited_at, opened_at, submitted_at,
               expires_at, token_available,
               (expires_at IS NOT NULL AND expires_at < NOW())::boolean AS is_expired
        FROM unified
        ${where}
        ORDER BY created_at DESC
        LIMIT ${limit} OFFSET ${offset}
      `),
      db.execute(sql`${unifiedCte} SELECT COUNT(*)::int AS total FROM unified ${where}`),
    ]);
    return res.json({
      items: data.rows,
      total: Number((count.rows[0] as { total?: number })?.total ?? 0),
      page,
      limit,
    });
  } catch (error) {
    console.error("[admin-vendor-service-requests] list failed", error);
    return res.status(500).json({ error: "Gagal memuat request vendor" });
  }
});

adminVendorServiceRequestsRouter.get("/:sourceType/:id", requirePortalAdmin, async (req, res) => {
  const id = sourceId(req.params.id);
  const sourceType = routeParam(req.params.sourceType);
  if (!id || !SOURCE_TYPES.has(sourceType)) {
    return res.status(400).json({ error: "Identitas request tidak valid" });
  }
  try {
    const where = sql`WHERE source_type = ${sourceType} AND source_id = ${String(id)}`;
    const result = await db.execute(sql`${unifiedCte}
      SELECT source_type, source_id, invitation_id, request_number,
             customer_name, customer_email, customer_company,
             vendor_id, vendor_name, vendor_phone, vendor_email,
             raw_service_type, service_key, request_status, quote_status,
             raw_status, quotation_number, quote_amount, quote_notes,
             request_notes, created_at, invited_at, opened_at, submitted_at,
             expires_at, token_available,
             (expires_at IS NOT NULL AND expires_at < NOW())::boolean AS is_expired
      FROM unified ${where} LIMIT 1
    `);
    const row = result.rows[0];
    if (!row) return res.status(404).json({ error: "Request tidak ditemukan" });
    return res.json(row);
  } catch (error) {
    console.error("[admin-vendor-service-requests] detail failed", error);
    return res.status(500).json({ error: "Gagal memuat detail request" });
  }
});

async function readToken(sourceType: string, id: number): Promise<{ token: string | null; expiresAt: string | null; status: string | null }> {
  switch (sourceType) {
    case "portal_invitation": {
      const r = await db.execute(sql`SELECT token, valid_until AS expires_at, status FROM portal_vendor_invitations WHERE id = ${id} LIMIT 1`);
      const row = r.rows[0] as any;
      return { token: row?.token ?? null, expiresAt: row?.expires_at ?? null, status: row?.status ?? null };
    }
    case "logistic_rfq": {
      const r = await db.execute(sql`SELECT token, expired_at AS expires_at, status FROM rfq_vendor_links WHERE id = ${id} LIMIT 1`);
      const row = r.rows[0] as any;
      return { token: row?.token ?? null, expiresAt: row?.expires_at ?? null, status: row?.status ?? null };
    }
    case "air_freight_rfq": {
      const r = await db.execute(sql`
        SELECT s.token, r.response_deadline AS expires_at, s.status
        FROM air_freight_rate_submissions s
        JOIN air_freight_rfqs r ON r.id = s.rfq_id
        WHERE s.id = ${id} LIMIT 1
      `);
      const row = r.rows[0] as any;
      return { token: row?.token ?? null, expiresAt: row?.expires_at ?? null, status: row?.status ?? null };
    }
    case "ocean_freight_rfq": {
      const r = await db.execute(sql`
        SELECT s.token, r.response_deadline AS expires_at, s.status
        FROM ocean_freight_rate_submissions s
        JOIN ocean_freight_rfqs r ON r.id = s.rfq_id
        WHERE s.id = ${id} LIMIT 1
      `);
      const row = r.rows[0] as any;
      return { token: row?.token ?? null, expiresAt: row?.expires_at ?? null, status: row?.status ?? null };
    }
    case "marketplace_quote": {
      const r = await db.execute(sql`SELECT token, valid_until AS expires_at, status FROM mkt_vendor_quotes WHERE id = ${id} LIMIT 1`);
      const row = r.rows[0] as any;
      return { token: row?.token ?? null, expiresAt: row?.expires_at ?? null, status: row?.status ?? null };
    }
    default:
      return { token: null, expiresAt: null, status: null };
  }
}

adminVendorServiceRequestsRouter.post("/:sourceType/:id/access-link", requirePortalAdmin, async (req: Request, res: Response) => {
  const id = sourceId(req.params.id);
  const sourceType = routeParam(req.params.sourceType);
  if (!id || !SOURCE_TYPES.has(sourceType)) return res.status(400).json({ error: "Identitas request tidak valid" });
  try {
    const current = await readToken(sourceType, id);
    if (!current.token) {
      return res.status(409).json({ code: "TOKEN_UNAVAILABLE", error: "Link tidak tersedia — buat ulang" });
    }
    const url = buildLink(sourceType, current.token);
    auditFromReq(req, {
      action: "view_vendor_access_link",
      module: "vendor_invitation",
      referenceId: `${sourceType}:${id}`,
      newData: { sourceType, sourceId: id, tokenReturned: true },
    });
    return res.json({ sourceType, sourceId: id, url, expiresAt: current.expiresAt, status: current.status });
  } catch (error) {
    console.error("[admin-vendor-service-requests] access link failed", error);
    return res.status(500).json({ error: "Gagal membuat link akses" });
  }
});

adminVendorServiceRequestsRouter.post("/:sourceType/:id/regenerate", requirePortalAdmin, async (req: Request, res: Response) => {
  const id = sourceId(req.params.id);
  const sourceType = routeParam(req.params.sourceType);
  if (!id || !SOURCE_TYPES.has(sourceType)) return res.status(400).json({ error: "Identitas request tidak valid" });
  try {
    const current = await readToken(sourceType, id);
    if (current.status === "accepted" || current.status === "selected" || current.status === "submitted") {
      return res.status(409).json({ error: "Link tidak dapat dibuat ulang setelah vendor mengirim atau dipilih" });
    }

    const tokenPair = generateTokenPair();
    const newExpiry = new Date(Date.now() + 48 * 60 * 60 * 1000);
    switch (sourceType) {
      case "portal_invitation":
        await db.execute(sql`UPDATE portal_vendor_invitations SET token = ${tokenPair.raw}, valid_until = ${newExpiry}, status = 'pending' WHERE id = ${id}`);
        break;
      case "logistic_rfq":
        await db.execute(sql`UPDATE rfq_vendor_links SET token = ${tokenPair.raw}, token_hash = ${tokenPair.hash}, expired_at = ${newExpiry}, status = 'waiting_response', opened_at = NULL, submitted_at = NULL WHERE id = ${id}`);
        break;
      case "air_freight_rfq":
        await db.execute(sql`UPDATE air_freight_rate_submissions SET token = ${tokenPair.raw}, status = 'pending', is_active = true, form_opened_at = NULL, submitted_at = NULL, updated_at = NOW() WHERE id = ${id}`);
        break;
      case "ocean_freight_rfq":
        await db.execute(sql`UPDATE ocean_freight_rate_submissions SET token = ${tokenPair.raw}, status = 'pending', is_active = true, form_opened_at = NULL, submitted_at = NULL, updated_at = NOW() WHERE id = ${id}`);
        break;
      case "marketplace_quote":
        await db.execute(sql`UPDATE mkt_vendor_quotes SET token = ${tokenPair.raw}, status = 'invited', opened_at = NULL, submitted_at = NULL, updated_at = NOW() WHERE id = ${id}`);
        break;
    }
    const after = await readToken(sourceType, id);
    if (!after.token) return res.status(500).json({ error: "Token baru gagal disimpan" });
    auditFromReq(req, {
      action: "regenerate_vendor_access_link",
      module: "vendor_invitation",
      referenceId: `${sourceType}:${id}`,
      newData: { sourceType, sourceId: id, invalidatedPrevious: true, expiresAt: after.expiresAt },
    });
    return res.json({ sourceType, sourceId: id, url: buildLink(sourceType, after.token), expiresAt: after.expiresAt, status: after.status });
  } catch (error) {
    console.error("[admin-vendor-service-requests] regenerate failed", error);
    return res.status(500).json({ error: "Gagal membuat ulang link akses" });
  }
});

export default adminVendorServiceRequestsRouter;