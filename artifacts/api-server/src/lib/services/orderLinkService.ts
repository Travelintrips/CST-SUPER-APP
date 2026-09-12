/**
 * orderLinkService — ENTERPRISE DB PHASE 3C / 3D
 *
 * Cross-reference service for the additive `order_links` table. Links two
 * rows across domains (marketplace RFQ, logistic order, portal product
 * order, sales document, invoice/payment, purchase order, fulfillment,
 * ppjk order, accounting document, etc) without merging, altering, or
 * foreign-keying any existing order table.
 *
 * Design contract:
 * - Purely additive. No existing write path is touched — callers opt in
 *   explicitly by invoking createOrderLink() alongside their existing logic.
 * - source_table/target_table are free-text identifiers (polymorphic
 *   reference) — no DB-level FK enforcement is possible or attempted.
 * - dryRunBackfillOrderLinks() NEVER writes; it only reports candidate
 *   links so an operator can review before any real backfill is built.
 */

import { db, orderLinksTable } from "@workspace/db";
import type { InsertOrderLink, OrderLink } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";
import { logger } from "../logger.js";

export interface CreateOrderLinkInput {
  companyId?: number | null;
  sourceTable: string;
  sourceId: number;
  targetTable: string;
  targetId: number;
  linkType: string;
  relationStatus?: string;
  metadata?: Record<string, unknown> | null;
  createdBy?: string | null;
}

/**
 * Create a new order_links row. Additive — does not check/mutate any
 * source or target table.
 */
export async function createOrderLink(input: CreateOrderLinkInput): Promise<OrderLink> {
  const values: InsertOrderLink = {
    companyId: input.companyId ?? null,
    sourceTable: input.sourceTable,
    sourceId: input.sourceId,
    targetTable: input.targetTable,
    targetId: input.targetId,
    linkType: input.linkType,
    relationStatus: input.relationStatus ?? "active",
    metadata: input.metadata ?? null,
    createdBy: input.createdBy ?? null,
  };
  const [row] = await db.insert(orderLinksTable).values(values).returning();
  return row;
}

/**
 * List all links where the given (table, id) is the SOURCE side.
 */
export async function listOrderLinksBySource(
  sourceTable: string,
  sourceId: number,
  opts: { relationStatus?: string } = {}
): Promise<OrderLink[]> {
  const conditions = [eq(orderLinksTable.sourceTable, sourceTable), eq(orderLinksTable.sourceId, sourceId)];
  if (opts.relationStatus) conditions.push(eq(orderLinksTable.relationStatus, opts.relationStatus));
  return db.select().from(orderLinksTable).where(and(...conditions));
}

/**
 * List all links where the given (table, id) is the TARGET side.
 */
export async function listOrderLinksByTarget(
  targetTable: string,
  targetId: number,
  opts: { relationStatus?: string } = {}
): Promise<OrderLink[]> {
  const conditions = [eq(orderLinksTable.targetTable, targetTable), eq(orderLinksTable.targetId, targetId)];
  if (opts.relationStatus) conditions.push(eq(orderLinksTable.relationStatus, opts.relationStatus));
  return db.select().from(orderLinksTable).where(and(...conditions));
}

/**
 * Find a specific link by its full identity (source + target + link_type).
 * Useful for idempotent upserts by callers ("does this link already exist?").
 */
export async function findOrderLink(params: {
  sourceTable: string;
  sourceId: number;
  targetTable: string;
  targetId: number;
  linkType: string;
}): Promise<OrderLink | undefined> {
  const rows = await db
    .select()
    .from(orderLinksTable)
    .where(
      and(
        eq(orderLinksTable.sourceTable, params.sourceTable),
        eq(orderLinksTable.sourceId, params.sourceId),
        eq(orderLinksTable.targetTable, params.targetTable),
        eq(orderLinksTable.targetId, params.targetId),
        eq(orderLinksTable.linkType, params.linkType)
      )
    )
    .limit(1);
  return rows[0];
}

export interface DryRunCandidate {
  linkType: string;
  sourceTable: string;
  targetTable: string;
  candidateCount: number;
  sampleRows: Array<Record<string, unknown>>;
  note: string;
}

export interface DryRunBackfillReport {
  generatedAt: string;
  totalCandidateLinks: number;
  candidates: DryRunCandidate[];
  written: false; // dry-run never writes
}

/**
 * Dry-run backfill report — NEVER writes to order_links.
 *
 * Surfaces candidate cross-domain relationships that already exist as
 * implicit FKs in current tables (e.g. mkt_purchase_orders.rfq_id,
 * logistic_orders referenced by rfq_vendor_links, portal_product_orders
 * with a matching sales document number) so an operator can review counts
 * and samples before any real backfill migration is built.
 */
export async function dryRunBackfillOrderLinks(limit = 5): Promise<DryRunBackfillReport> {
  const candidates: DryRunCandidate[] = [];

  // 1) marketplace RFQ → purchase order (mkt_purchase_orders.rfq_id)
  await pushCandidate(candidates, {
    linkType: "rfq_to_purchase_order",
    sourceTable: "mkt_rfqs",
    targetTable: "mkt_purchase_orders",
    countSql: sql`SELECT COUNT(*)::int AS c FROM mkt_purchase_orders WHERE rfq_id IS NOT NULL`,
    sampleSql: sql`
      SELECT rfq_id AS source_id, id AS target_id, po_number, created_at
      FROM mkt_purchase_orders
      WHERE rfq_id IS NOT NULL
      ORDER BY created_at DESC
      LIMIT ${limit}
    `,
    note: "mkt_purchase_orders.rfq_id already references mkt_rfqs.id",
  }).catch(() => {
    candidates.push({ linkType: "rfq_to_purchase_order", sourceTable: "mkt_rfqs", targetTable: "mkt_purchase_orders", candidateCount: 0, sampleRows: [], note: "Skipped — table not found or query failed" });
  });

  // 2) logistic order RFQ → vendor offer link (rfq_vendor_links.rfq_id → logistic_order_rfqs.id)
  await pushCandidate(candidates, {
    linkType: "logistic_rfq_to_vendor_link",
    sourceTable: "logistic_order_rfqs",
    targetTable: "rfq_vendor_links",
    countSql: sql`SELECT COUNT(*)::int AS c FROM rfq_vendor_links WHERE rfq_id IS NOT NULL`,
    sampleSql: sql`
      SELECT rfq_id AS source_id, id AS target_id, status, created_at
      FROM rfq_vendor_links
      WHERE rfq_id IS NOT NULL
      ORDER BY created_at DESC
      LIMIT ${limit}
    `,
    note: "rfq_vendor_links.rfq_id already references logistic_order_rfqs.id",
  }).catch(() => {
    candidates.push({ linkType: "logistic_rfq_to_vendor_link", sourceTable: "logistic_order_rfqs", targetTable: "rfq_vendor_links", candidateCount: 0, sampleRows: [], note: "Skipped — table not found or query failed" });
  });

  // 3) marketplace vendor quote → RFQ (mkt_vendor_quotes.rfq_id)
  await pushCandidate(candidates, {
    linkType: "rfq_to_vendor_quote",
    sourceTable: "mkt_rfqs",
    targetTable: "mkt_vendor_quotes",
    countSql: sql`SELECT COUNT(*)::int AS c FROM mkt_vendor_quotes WHERE rfq_id IS NOT NULL`,
    sampleSql: sql`
      SELECT rfq_id AS source_id, id AS target_id, quotation_number, created_at
      FROM mkt_vendor_quotes
      WHERE rfq_id IS NOT NULL
      ORDER BY created_at DESC
      LIMIT ${limit}
    `,
    note: "mkt_vendor_quotes.rfq_id already references mkt_rfqs.id",
  }).catch(() => {
    candidates.push({ linkType: "rfq_to_vendor_quote", sourceTable: "mkt_rfqs", targetTable: "mkt_vendor_quotes", candidateCount: 0, sampleRows: [], note: "Skipped — table not found or query failed" });
  });

  // 4) portal product order → sales document, matched by order_number heuristic
  await pushCandidate(candidates, {
    linkType: "product_order_to_sales_document",
    sourceTable: "portal_product_orders",
    targetTable: "sales_documents",
    countSql: sql`
      SELECT COUNT(*)::int AS c
      FROM portal_product_orders ppo
      JOIN sales_documents sd ON sd.reference_number = ppo.order_number
    `,
    sampleSql: sql`
      SELECT ppo.id AS source_id, sd.id AS target_id, ppo.order_number, sd.doc_number, ppo.created_at
      FROM portal_product_orders ppo
      JOIN sales_documents sd ON sd.reference_number = ppo.order_number
      ORDER BY ppo.created_at DESC
      LIMIT ${limit}
    `,
    note: "Heuristic match on sales_documents.reference_number = portal_product_orders.order_number (verify before real backfill)",
  }).catch(() => {
    candidates.push({
      linkType: "product_order_to_sales_document",
      sourceTable: "portal_product_orders",
      targetTable: "sales_documents",
      candidateCount: 0,
      sampleRows: [],
      note: "Skipped — sales_documents.reference_number column not found or table missing in this environment",
    });
  });

  // 5) logistic order → invoice/payment (payments.reference_number heuristic)
  await pushCandidate(candidates, {
    linkType: "logistic_order_to_payment",
    sourceTable: "logistic_orders",
    targetTable: "payments",
    countSql: sql`
      SELECT COUNT(*)::int AS c
      FROM logistic_orders lo
      JOIN payments p ON p.reference_number = lo.order_number
    `,
    sampleSql: sql`
      SELECT lo.id AS source_id, p.id AS target_id, lo.order_number, p.reference_number, lo.created_at
      FROM logistic_orders lo
      JOIN payments p ON p.reference_number = lo.order_number
      ORDER BY lo.created_at DESC
      LIMIT ${limit}
    `,
    note: "Heuristic match on payments.reference_number = logistic_orders.order_number (verify before real backfill)",
  }).catch(() => {
    candidates.push({
      linkType: "logistic_order_to_payment",
      sourceTable: "logistic_orders",
      targetTable: "payments",
      candidateCount: 0,
      sampleRows: [],
      note: "Skipped — payments.reference_number column not found or table missing in this environment",
    });
  });

  const totalCandidateLinks = candidates.reduce((sum, c) => sum + c.candidateCount, 0);

  return {
    generatedAt: new Date().toISOString(),
    totalCandidateLinks,
    candidates,
    written: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PHASE 3D — Controlled Backfill
// ─────────────────────────────────────────────────────────────────────────────

export interface BackfillOptions {
  /** When true (default), only report — no writes to order_links. */
  dryRun?: boolean;
  /** Max rows to process per link type. Default 100. */
  limit?: number;
  /** Restrict to these link types. Default: all 6 supported types. */
  linkTypes?: string[];
  /** If provided, filter candidates by company_id where supported. */
  companyId?: number;
}

export interface BackfillLinkTypeStat {
  scanned: number;
  inserted: number;
  skipped: number;
  errors: number;
}

export interface BackfillResult {
  dryRun: boolean;
  scanned: number;
  candidates: number;
  inserted: number;
  skippedExisting: number;
  errors: number;
  byLinkType: Record<string, BackfillLinkTypeStat>;
  errorDetails: Array<{ linkType: string; sourceId: number; targetId: number; error: string }>;
  generatedAt: string;
}

const ALL_LINK_TYPES = [
  "rfq_to_purchase_order",
  "rfq_to_vendor_quote",
  "logistic_rfq_to_vendor_link",
  "logistic_order_to_fulfillment_link",
  "sales_document_to_payment",
  "logistic_order_to_payment",
] as const;

type SupportedLinkType = typeof ALL_LINK_TYPES[number];

interface LinkTypeConfig {
  sourceTable: string;
  targetTable: string;
  /** Returns rows of { source_id, target_id, company_id? } */
  fetchCandidates: (limit: number, companyId?: number) => Promise<Array<{ source_id: number; target_id: number; company_id?: number | null }>>;
}

const LINK_TYPE_CONFIGS: Record<SupportedLinkType, LinkTypeConfig> = {
  rfq_to_purchase_order: {
    sourceTable: "mkt_rfqs",
    targetTable: "mkt_purchase_orders",
    fetchCandidates: async (limit, companyId) => {
      const rows = await db.execute(
        companyId != null
          ? sql`SELECT rfq_id AS source_id, id AS target_id, company_id FROM mkt_purchase_orders WHERE rfq_id IS NOT NULL AND company_id = ${companyId} ORDER BY id LIMIT ${limit}`
          : sql`SELECT rfq_id AS source_id, id AS target_id, company_id FROM mkt_purchase_orders WHERE rfq_id IS NOT NULL ORDER BY id LIMIT ${limit}`
      );
      return (rows.rows as Array<{ source_id: number; target_id: number; company_id?: number | null }>);
    },
  },
  rfq_to_vendor_quote: {
    sourceTable: "mkt_rfqs",
    targetTable: "mkt_vendor_quotes",
    fetchCandidates: async (limit) => {
      const rows = await db.execute(
        sql`SELECT rfq_id AS source_id, id AS target_id FROM mkt_vendor_quotes WHERE rfq_id IS NOT NULL ORDER BY id LIMIT ${limit}`
      );
      return (rows.rows as Array<{ source_id: number; target_id: number }>);
    },
  },
  logistic_rfq_to_vendor_link: {
    sourceTable: "logistic_order_rfqs",
    targetTable: "rfq_vendor_links",
    fetchCandidates: async (limit) => {
      const rows = await db.execute(
        sql`SELECT rfq_id AS source_id, id AS target_id FROM rfq_vendor_links WHERE rfq_id IS NOT NULL ORDER BY id LIMIT ${limit}`
      );
      return (rows.rows as Array<{ source_id: number; target_id: number }>);
    },
  },
  logistic_order_to_fulfillment_link: {
    sourceTable: "logistic_orders",
    targetTable: "vendor_fulfillment_links",
    fetchCandidates: async (limit) => {
      const rows = await db.execute(
        sql`SELECT order_id AS source_id, id AS target_id FROM vendor_fulfillment_links WHERE order_id IS NOT NULL ORDER BY id LIMIT ${limit}`
      );
      return (rows.rows as Array<{ source_id: number; target_id: number }>);
    },
  },
  sales_document_to_payment: {
    sourceTable: "sales_documents",
    targetTable: "payments",
    fetchCandidates: async (limit) => {
      const rows = await db.execute(
        // Use ::text cast to avoid enum validation errors on DBs missing the migration
        sql`SELECT ref_id AS source_id, id AS target_id FROM payments WHERE ref_kind::text = 'sales' ORDER BY id LIMIT ${limit}`
      );
      return (rows.rows as Array<{ source_id: number; target_id: number }>);
    },
  },
  logistic_order_to_payment: {
    sourceTable: "logistic_orders",
    targetTable: "payments",
    fetchCandidates: async (limit) => {
      const rows = await db.execute(
        // Use ::text cast — 'logistic' enum value may not exist on older dev DBs
        sql`SELECT ref_id AS source_id, id AS target_id FROM payments WHERE ref_kind::text = 'logistic' ORDER BY id LIMIT ${limit}`
      );
      return (rows.rows as Array<{ source_id: number; target_id: number }>);
    },
  },
};

/**
 * Controlled backfill of order_links from implicit cross-domain relationships.
 *
 * - dryRun=true (default): reports candidates without writing anything.
 * - dryRun=false: idempotent upsert — find-before-insert prevents duplicates.
 * - All operations are wrapped per link-type so one failure does not abort others.
 */
export async function backfillOrderLinks(opts: BackfillOptions = {}): Promise<BackfillResult> {
  const dryRun  = opts.dryRun  !== false; // default true
  const limit   = Math.min(Math.max(Number(opts.limit ?? 100), 1), 1000);
  const types   = (opts.linkTypes?.length
    ? opts.linkTypes.filter((t) => ALL_LINK_TYPES.includes(t as SupportedLinkType))
    : [...ALL_LINK_TYPES]) as SupportedLinkType[];

  const byLinkType: Record<string, BackfillLinkTypeStat> = {};
  const errorDetails: Array<{ linkType: string; sourceId: number; targetId: number; error: string }> = [];

  let totalScanned      = 0;
  let totalCandidates   = 0;
  let totalInserted     = 0;
  let totalSkipped      = 0;
  let totalErrors       = 0;

  for (const linkType of types) {
    const config = LINK_TYPE_CONFIGS[linkType];
    const stat: BackfillLinkTypeStat = { scanned: 0, inserted: 0, skipped: 0, errors: 0 };
    byLinkType[linkType] = stat;

    let rows: Array<{ source_id: number; target_id: number; company_id?: number | null }> = [];
    try {
      rows = await config.fetchCandidates(limit, opts.companyId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ err, linkType }, "[backfillOrderLinks] fetchCandidates failed — skipping type");
      stat.errors++;
      totalErrors++;
      errorDetails.push({ linkType, sourceId: 0, targetId: 0, error: `fetchCandidates: ${msg}` });
      continue;
    }

    stat.scanned = rows.length;
    totalScanned += rows.length;
    totalCandidates += rows.length;

    if (dryRun) {
      logger.info({ linkType, candidateCount: rows.length, dryRun: true }, "[backfillOrderLinks] dry-run candidate count");
      continue;
    }

    for (const row of rows) {
      const sourceId = Number(row.source_id);
      const targetId = Number(row.target_id);
      const companyId = row.company_id != null ? Number(row.company_id) : (opts.companyId ?? null);

      try {
        // Idempotency: check before insert
        const existing = await findOrderLink({
          sourceTable: config.sourceTable,
          sourceId,
          targetTable: config.targetTable,
          targetId,
          linkType,
        });

        if (existing) {
          stat.skipped++;
          totalSkipped++;
          continue;
        }

        await createOrderLink({
          companyId,
          sourceTable: config.sourceTable,
          sourceId,
          targetTable: config.targetTable,
          targetId,
          linkType,
          createdBy: "backfill:phase3d",
        });

        stat.inserted++;
        totalInserted++;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        stat.errors++;
        totalErrors++;
        errorDetails.push({ linkType, sourceId, targetId, error: msg });
        logger.warn({ err, linkType, sourceId, targetId }, "[backfillOrderLinks] insert failed");
      }
    }

    logger.info({ linkType, ...stat }, "[backfillOrderLinks] link type complete");
  }

  return {
    dryRun,
    scanned:         totalScanned,
    candidates:      totalCandidates,
    inserted:        totalInserted,
    skippedExisting: totalSkipped,
    errors:          totalErrors,
    byLinkType,
    errorDetails:    errorDetails.slice(0, 50), // cap to prevent huge responses
    generatedAt:     new Date().toISOString(),
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// (internal dry-run helper — kept for the legacy GET /dry-run endpoint)
// ─────────────────────────────────────────────────────────────────────────────

async function pushCandidate(
  candidates: DryRunCandidate[],
  opts: {
    linkType: string;
    sourceTable: string;
    targetTable: string;
    countSql: ReturnType<typeof sql>;
    sampleSql: ReturnType<typeof sql>;
    note: string;
  }
): Promise<void> {
  const countResult = await db.execute(opts.countSql);
  const countRows = (countResult.rows ?? countResult) as Array<{ c: number }>;
  const candidateCount = Number(countRows?.[0]?.c ?? 0);

  const sampleResult = await db.execute(opts.sampleSql);
  const sampleRows = (sampleResult.rows ?? sampleResult) as Array<Record<string, unknown>>;

  candidates.push({
    linkType: opts.linkType,
    sourceTable: opts.sourceTable,
    targetTable: opts.targetTable,
    candidateCount,
    sampleRows,
    note: opts.note,
  });
}
