import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

/**
 * ENTERPRISE DB PHASE 3B — Unified Read-Only Views for Orders & Quotes
 *
 * Creates two additive, read-only reporting views:
 *   - public.v_unified_orders
 *   - public.v_unified_quotes
 *
 * Rules enforced:
 *   - Additive only. No table is merged, dropped, renamed, or altered.
 *   - No write path, API route, or frontend behavior is touched.
 *   - CREATE OR REPLACE VIEW only — idempotent, safe to re-run.
 *   - Every selected column is explicitly cast; missing fields per source use
 *     NULL::<type> rather than being omitted, so column order/types are stable
 *     across all UNION ALL branches.
 *   - source_table + source_id are always included to disambiguate rows that
 *     originate from different physical tables.
 *   - No raw magic-link/guest/vendor tokens are exposed anywhere in either view
 *     (rfq_vendor_links.token/token_hash, mkt_rfqs.guest_token/guest_token_hash,
 *     mkt_vendor_quotes.token, mkt_purchase_orders.vendor_token,
 *     logistic_orders.*_token, portal_product_orders.product_approve_token —
 *     none of these columns are selected).
 *   - Internal marketplace commission fields (commission_rate, commission_tax_id,
 *     commission_amount, rank_score, rank_badges) on mkt_vendor_quotes are also
 *     excluded; only the net vendor-facing amount is surfaced.
 */
export async function runUnifiedViewsMigration(): Promise<void> {
  await db.execute(sql`
    CREATE OR REPLACE VIEW public.v_unified_orders AS
    SELECT
      'orders'::text                 AS source_table,
      o.id::integer                  AS source_id,
      NULL::text                     AS order_number,
      o.company_id::integer          AS company_id,
      NULL::integer                  AS customer_id,
      o.customer_name::text          AS customer_name,
      NULL::integer                  AS vendor_id,
      NULL::text                     AS vendor_name,
      'general'::text                AS domain,
      NULL::text                     AS order_type,
      o.status::text                 AS status,
      NULL::text                     AS payment_status,
      o.grand_total::numeric         AS total_amount,
      'IDR'::text                    AS currency,
      o.created_at::timestamp        AS created_at,
      NULL::timestamp                AS updated_at
    FROM orders o

    UNION ALL

    SELECT
      'logistic_orders'::text,
      lo.id::integer,
      lo.order_number::text,
      lo.company_id::integer,
      NULL::integer,
      lo.customer_name::text,
      lo.approved_vendor_id::integer,
      sv1.name::text,
      'logistics'::text,
      lo.order_type::text,
      lo.status::text,
      NULL::text,
      lo.grand_total::numeric,
      'IDR'::text,
      lo.created_at::timestamp,
      lo.updated_at::timestamp
    FROM logistic_orders lo
    LEFT JOIN suppliers sv1 ON sv1.id = lo.approved_vendor_id

    UNION ALL

    SELECT
      'mkt_purchase_orders'::text,
      po.id::integer,
      po.po_number::text,
      po.company_id::integer,
      r1.portal_customer_id::integer,
      r1.buyer_name::text,
      po.vendor_id::integer,
      po.vendor_name_snapshot::text,
      'marketplace'::text,
      'purchase_order'::text,
      po.status::text,
      NULL::text,
      po.grand_total::numeric,
      po.currency_snapshot::text,
      po.created_at::timestamp,
      po.updated_at::timestamp
    FROM mkt_purchase_orders po
    LEFT JOIN mkt_rfqs r1 ON r1.id = po.rfq_id

    UNION ALL

    SELECT
      'portal_product_orders'::text,
      ppo.id::integer,
      ppo.order_number::text,
      ppo.company_id::integer,
      NULL::integer,
      ppo.customer_name::text,
      NULL::integer,
      ppo.vendor_name_selected::text,
      'product'::text,
      ppo.order_type::text,
      ppo.status::text,
      ppo.payment_status::text,
      ppo.grand_total::numeric,
      'IDR'::text,
      ppo.created_at::timestamp,
      ppo.updated_at::timestamp
    FROM portal_product_orders ppo

    UNION ALL

    SELECT
      'ppjk_orders'::text,
      pk.id::integer,
      pk.order_number::text,
      pk.company_id::integer,
      NULL::integer,
      pk.customer_name::text,
      pk.vendor_id::integer,
      pk.vendor_name::text,
      'ppjk'::text,
      pk.trade_type::text,
      pk.status::text,
      NULL::text,
      pk.total_service_fee::numeric,
      'IDR'::text,
      pk.created_at::timestamp,
      pk.updated_at::timestamp
    FROM ppjk_orders pk
  `);
  logger.info("[UnifiedViewsMigration] v_unified_orders ready");

  await db.execute(sql`
    CREATE OR REPLACE VIEW public.v_unified_quotes AS
    SELECT
      'quote_requests'::text         AS source_table,
      qr.id::integer                 AS source_id,
      NULL::text                     AS quote_number,
      NULL::integer                  AS rfq_id,
      NULL::integer                  AS company_id,
      NULL::integer                  AS customer_id,
      qr.name::text                  AS customer_name,
      NULL::integer                  AS vendor_id,
      NULL::text                     AS vendor_name,
      'general'::text                AS domain,
      qr.service::text               AS quote_type,
      qr.status::text                AS status,
      qr.estimated_total::numeric    AS amount,
      'IDR'::text                    AS currency,
      NULL::timestamp                AS valid_until,
      qr.created_at::timestamp       AS created_at,
      qr.updated_at::timestamp       AS updated_at
    FROM quote_requests qr

    UNION ALL

    SELECT
      'portal_quick_quotes'::text,
      pq.id::integer,
      pq.quote_number::text,
      NULL::integer,
      NULL::integer,
      NULL::integer,
      pq.name::text,
      NULL::integer,
      NULL::text,
      'portal'::text,
      pq.service_category::text,
      pq.status::text,
      NULL::numeric,
      'IDR'::text,
      NULL::timestamp,
      pq.created_at::timestamp,
      pq.updated_at::timestamp
    FROM portal_quick_quotes pq

    UNION ALL

    SELECT
      'logistic_order_rfqs'::text,
      lr.id::integer,
      lr.rfq_number::text,
      lr.id::integer,
      lo1.company_id::integer,
      NULL::integer,
      lo1.customer_name::text,
      NULL::integer,
      NULL::text,
      'logistics'::text,
      COALESCE(lr.rfq_type, 'shipment')::text,
      lr.status::text,
      lr.quoted_price::numeric,
      'IDR'::text,
      lr.response_deadline::timestamp,
      lr.created_at::timestamp,
      NULL::timestamp
    FROM logistic_order_rfqs lr
    LEFT JOIN logistic_orders lo1 ON lo1.id = lr.order_id

    UNION ALL

    SELECT
      'mkt_rfqs'::text,
      r.id::integer,
      r.rfq_number::text,
      r.id::integer,
      r.company_id::integer,
      r.portal_customer_id::integer,
      r.buyer_name::text,
      r.catalog_vendor_id::integer,
      sv2.name::text,
      'marketplace'::text,
      'rfq'::text,
      r.status::text,
      NULL::numeric,
      NULL::text,
      NULL::timestamp,
      r.created_at::timestamp,
      r.updated_at::timestamp
    FROM mkt_rfqs r
    LEFT JOIN suppliers sv2 ON sv2.id = r.catalog_vendor_id

    UNION ALL

    SELECT
      'mkt_vendor_quotes'::text,
      vq.id::integer,
      vq.quotation_number::text,
      vq.rfq_id::integer,
      r2.company_id::integer,
      r2.portal_customer_id::integer,
      r2.buyer_name::text,
      vq.vendor_id::integer,
      sv3.name::text,
      'marketplace'::text,
      'vendor_quote'::text,
      vq.status::text,
      vq.net_vendor_amount::numeric,
      NULL::text,
      vq.valid_until::timestamp,
      vq.created_at::timestamp,
      vq.updated_at::timestamp
    FROM mkt_vendor_quotes vq
    LEFT JOIN mkt_rfqs r2 ON r2.id = vq.rfq_id
    LEFT JOIN suppliers sv3 ON sv3.id = vq.vendor_id

    UNION ALL

    SELECT
      'rfq_vendor_links'::text,
      rl.id::integer,
      NULL::text,
      rl.rfq_id::integer,
      lo2.company_id::integer,
      NULL::integer,
      lo2.customer_name::text,
      rl.vendor_id::integer,
      sv4.name::text,
      'logistics'::text,
      COALESCE(rl.rfq_type, 'vendor_offer')::text,
      rl.status::text,
      COALESCE(rl.offered_price, rl.basic_price)::numeric,
      'IDR'::text,
      rl.expired_at::timestamp,
      rl.created_at::timestamp,
      rl.last_updated_at::timestamp
    FROM rfq_vendor_links rl
    LEFT JOIN logistic_order_rfqs lr2 ON lr2.id = rl.rfq_id
    LEFT JOIN logistic_orders lo2 ON lo2.id = lr2.order_id
    LEFT JOIN suppliers sv4 ON sv4.id = rl.vendor_id
  `);
  logger.info("[UnifiedViewsMigration] v_unified_quotes ready");
}
