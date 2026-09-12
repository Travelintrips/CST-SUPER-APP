/**
 * AI Decision Memory Store — Routes
 *
 * GET  /api/ai/decision-memory         → list dengan filter & pagination
 * GET  /api/ai/decision-memory/stats   → statistik agregat per vendor/entity
 * GET  /api/ai/decision-memory/context → context string untuk AI prompt injection
 * PATCH /api/ai/decision-memory/:id/outcome → update outcome manual
 */

import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../lib/requireAdmin.js";
import { logger } from "../lib/logger.js";
import { updateDecisionOutcome, getDecisionContextString } from "../lib/decisionMemory.js";

export const aiDecisionMemoryRouter = Router();

let migDone = false;
async function ensureTable() {
  if (migDone) return;
  try {
    await db.execute(sql`
      CREATE TABLE IF NOT EXISTS ai_decision_memory (
        id                  SERIAL PRIMARY KEY,
        decision_type       TEXT NOT NULL,
        origin              TEXT,
        destination         TEXT,
        shipment_type       TEXT,
        transport_mode      TEXT,
        commodity           TEXT,
        weight_kg           NUMERIC(12,3),
        direction           TEXT,
        chosen_entity_type  TEXT NOT NULL,
        chosen_entity_id    INTEGER,
        chosen_entity_name  TEXT NOT NULL,
        reasoning           TEXT,
        confidence          NUMERIC(5,4),
        decided_by          TEXT NOT NULL DEFAULT 'admin',
        order_id            INTEGER,
        order_number        TEXT,
        rfq_id              INTEGER,
        quote_id            INTEGER,
        company_id          INTEGER,
        execution_id        INTEGER,
        outcome             TEXT,
        on_time_delivery    BOOLEAN,
        delay_days          INTEGER,
        actual_vendor_price NUMERIC(14,2),
        quoted_vendor_price NUMERIC(14,2),
        outcome_notes       TEXT,
        outcome_updated_at  TIMESTAMPTZ,
        context_snapshot    JSONB,
        created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS ai_dm_decision_type_idx ON ai_decision_memory(decision_type);
      CREATE INDEX IF NOT EXISTS ai_dm_entity_idx        ON ai_decision_memory(chosen_entity_id, chosen_entity_type);
      CREATE INDEX IF NOT EXISTS ai_dm_order_idx         ON ai_decision_memory(order_id);
      CREATE INDEX IF NOT EXISTS ai_dm_route_idx         ON ai_decision_memory(origin, destination);
      CREATE INDEX IF NOT EXISTS ai_dm_outcome_idx       ON ai_decision_memory(outcome);
    `);
    migDone = true;
    logger.info("ai_decision_memory migration: ok");
  } catch (err) {
    logger.warn({ err }, "ai_decision_memory migration warn");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ai/decision-memory
// ─────────────────────────────────────────────────────────────────────────────

aiDecisionMemoryRouter.get("/", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  await ensureTable();

  const {
    page = "1",
    limit = "30",
    decisionType,
    outcome,
    vendorId,
    origin,
    destination,
    hasOutcome,
  } = req.query as Record<string, string>;

  const pageNum = Math.max(1, parseInt(page));
  const limitNum = Math.min(100, Math.max(1, parseInt(limit)));
  const offset = (pageNum - 1) * limitNum;

  try {
    const whereClause = sql`WHERE 1=1
      ${decisionType ? sql`AND decision_type = ${decisionType}` : sql``}
      ${outcome ? sql`AND outcome = ${outcome}` : sql``}
      ${vendorId ? sql`AND chosen_entity_id = ${parseInt(vendorId)}` : sql``}
      ${origin ? sql`AND origin ILIKE ${"%" + origin + "%"}` : sql``}
      ${destination ? sql`AND destination ILIKE ${"%" + destination + "%"}` : sql``}
      ${hasOutcome === "true" ? sql`AND outcome IS NOT NULL` : sql``}
      ${hasOutcome === "false" ? sql`AND outcome IS NULL` : sql``}
    `;

    const [dataResult, countResult] = await Promise.all([
      db.execute(sql`
        SELECT
          m.*,
          s.name AS supplier_name
        FROM ai_decision_memory m
        LEFT JOIN suppliers s ON s.id = m.chosen_entity_id AND m.chosen_entity_type = 'vendor'
        ${whereClause}
        ORDER BY m.created_at DESC
        LIMIT ${limitNum} OFFSET ${offset}
      `),
      db.execute(sql`
        SELECT COUNT(*) AS total FROM ai_decision_memory ${whereClause}
      `),
    ]);

    const total = parseInt((countResult.rows[0] as any)?.total ?? "0");

    return res.json({
      items: dataResult.rows,
      total,
      page: pageNum,
      limit: limitNum,
      pages: Math.ceil(total / limitNum),
    });
  } catch (err) {
    logger.error({ err }, "decision-memory list error");
    return res.status(500).json({ message: "Gagal mengambil data decision memory" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ai/decision-memory/stats
// ─────────────────────────────────────────────────────────────────────────────

aiDecisionMemoryRouter.get("/stats", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  await ensureTable();

  const { decisionType, vendorId } = req.query as Record<string, string>;

  try {
    // Statistik ringkasan global
    const [globalStats, vendorStats, recentDecisions, routeStats] = await Promise.all([
      db.execute(sql`
        SELECT
          COUNT(*) AS total_decisions,
          COUNT(*) FILTER (WHERE outcome IS NOT NULL)                AS with_outcome,
          COUNT(*) FILTER (WHERE outcome IS NULL)                    AS pending_outcome,
          COUNT(*) FILTER (WHERE outcome = 'success')               AS success_count,
          COUNT(*) FILTER (WHERE outcome = 'failure')               AS failure_count,
          COUNT(*) FILTER (WHERE on_time_delivery = true)           AS on_time_count,
          COUNT(*) FILTER (WHERE on_time_delivery = false)          AS late_count,
          ROUND(AVG(delay_days) FILTER (WHERE delay_days > 0), 1)   AS avg_delay_days,
          COUNT(DISTINCT chosen_entity_id) FILTER (WHERE chosen_entity_type = 'vendor') AS unique_vendors
        FROM ai_decision_memory
        ${decisionType ? sql`WHERE decision_type = ${decisionType}` : sql``}
      `),

      // Per-vendor stats
      db.execute(sql`
        SELECT
          m.chosen_entity_name                                          AS vendor_name,
          m.chosen_entity_id                                            AS vendor_id,
          COUNT(*)                                                      AS total_orders,
          COUNT(*) FILTER (WHERE m.outcome IS NOT NULL)                 AS completed_orders,
          COUNT(*) FILTER (WHERE m.on_time_delivery = true)            AS on_time,
          COUNT(*) FILTER (WHERE m.on_time_delivery = false)           AS late,
          ROUND(
            100.0 * COUNT(*) FILTER (WHERE m.on_time_delivery = true)
            / NULLIF(COUNT(*) FILTER (WHERE m.on_time_delivery IS NOT NULL), 0),
            1
          )                                                             AS on_time_pct,
          ROUND(AVG(m.delay_days) FILTER (WHERE m.delay_days > 0), 1) AS avg_delay_days,
          COUNT(*) FILTER (WHERE m.outcome = 'success')                AS success_count,
          COUNT(*) FILTER (WHERE m.outcome = 'failure')                AS failure_count,
          MAX(m.created_at)                                             AS last_used_at
        FROM ai_decision_memory m
        WHERE m.chosen_entity_type = 'vendor'
          ${vendorId ? sql`AND m.chosen_entity_id = ${parseInt(vendorId)}` : sql``}
          ${decisionType ? sql`AND m.decision_type = ${decisionType}` : sql``}
        GROUP BY m.chosen_entity_name, m.chosen_entity_id
        ORDER BY total_orders DESC
        LIMIT 20
      `),

      // 10 keputusan terbaru
      db.execute(sql`
        SELECT
          id, decision_type, chosen_entity_name, origin, destination,
          shipment_type, outcome, on_time_delivery, delay_days,
          decided_by, reasoning, order_number, created_at
        FROM ai_decision_memory
        ORDER BY created_at DESC
        LIMIT 10
      `),

      // Top routes
      db.execute(sql`
        SELECT
          origin,
          destination,
          shipment_type,
          COUNT(*) AS total_decisions,
          ROUND(
            100.0 * COUNT(*) FILTER (WHERE on_time_delivery = true)
            / NULLIF(COUNT(*) FILTER (WHERE on_time_delivery IS NOT NULL), 0),
            1
          ) AS on_time_pct
        FROM ai_decision_memory
        WHERE origin IS NOT NULL AND destination IS NOT NULL
        GROUP BY origin, destination, shipment_type
        ORDER BY total_decisions DESC
        LIMIT 10
      `),
    ]);

    return res.json({
      global: globalStats.rows[0] ?? {},
      byVendor: vendorStats.rows,
      recentDecisions: recentDecisions.rows,
      topRoutes: routeStats.rows,
    });
  } catch (err) {
    logger.error({ err }, "decision-memory stats error");
    return res.status(500).json({ message: "Gagal mengambil statistik decision memory" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ai/decision-memory/context
// Query relevant memories untuk di-inject ke AI prompt
// ─────────────────────────────────────────────────────────────────────────────

aiDecisionMemoryRouter.get("/context", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  await ensureTable();

  const { origin, destination, shipmentType, vendorId, decisionType, limit } = req.query as Record<string, string>;

  try {
    const contextStr = await getDecisionContextString({
      origin,
      destination,
      shipmentType,
      vendorId: vendorId ? parseInt(vendorId) : undefined,
      decisionType,
      limit: limit ? parseInt(limit) : 20,
    });

    return res.json({ context: contextStr });
  } catch (err) {
    logger.error({ err }, "decision-memory context error");
    return res.status(500).json({ message: "Gagal mengambil context" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PATCH /api/ai/decision-memory/:id/outcome
// Update outcome secara manual (admin)
// ─────────────────────────────────────────────────────────────────────────────

aiDecisionMemoryRouter.patch("/:id/outcome", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  await ensureTable();

  const id = parseInt(String(req.params["id"]));
  const { outcome, onTimeDelivery, delayDays, actualVendorPrice, outcomeNotes } = req.body as {
    outcome: "success" | "failure" | "partial" | "cancelled";
    onTimeDelivery?: boolean;
    delayDays?: number;
    actualVendorPrice?: number;
    outcomeNotes?: string;
  };

  if (!outcome) return res.status(400).json({ message: "outcome wajib diisi" });

  try {
    await db.execute(sql`
      UPDATE ai_decision_memory
      SET
        outcome             = ${outcome},
        on_time_delivery    = ${onTimeDelivery ?? null},
        delay_days          = ${delayDays ?? null},
        actual_vendor_price = ${actualVendorPrice ?? null},
        outcome_notes       = ${outcomeNotes ?? null},
        outcome_updated_at  = NOW()
      WHERE id = ${id}
    `);

    return res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "decision-memory outcome update error");
    return res.status(500).json({ message: "Gagal update outcome" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/ai/decision-memory/:id
// Detail satu memory record
// ─────────────────────────────────────────────────────────────────────────────

aiDecisionMemoryRouter.get("/:id", async (req: Request, res: Response) => {
  if (!(await requireAdmin(req, res))) return;
  await ensureTable();

  const id = parseInt(String(req.params["id"]));

  try {
    const result = await db.execute(sql`
      SELECT m.*, s.name AS supplier_name, s.phone AS supplier_phone
      FROM ai_decision_memory m
      LEFT JOIN suppliers s ON s.id = m.chosen_entity_id AND m.chosen_entity_type = 'vendor'
      WHERE m.id = ${id}
    `);

    if (!result.rows.length) return res.status(404).json({ message: "Record tidak ditemukan" });
    return res.json(result.rows[0]);
  } catch (err) {
    logger.error({ err }, "decision-memory detail error");
    return res.status(500).json({ message: "Gagal mengambil detail" });
  }
});
