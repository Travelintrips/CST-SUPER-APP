/**
 * Decision Memory Store — Library
 *
 * Fungsi-fungsi untuk mencatat keputusan AI/admin dan mengupdate hasilnya.
 * Digunakan dari route-route yang membuat keputusan penting (assign-vendor, dll.)
 * dan dari context-injection ke prompt AI.
 */

import { db } from "@workspace/db";
import { aiDecisionMemoryTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

export interface RecordDecisionInput {
  decisionType: "vendor_assignment" | "route_selection" | "pricing" | "escalation" | "classification";
  chosenEntityType: "vendor" | "route" | "price_tier" | "escalation_level";
  chosenEntityId?: number;
  chosenEntityName: string;
  reasoning?: string;
  confidence?: number;
  decidedBy?: "admin" | "ai" | "system";
  // Order context
  orderId?: number;
  orderNumber?: string;
  rfqId?: number;
  quoteId?: number;
  companyId?: number;
  executionId?: number;
  // Logistics context (untuk similarity matching)
  origin?: string;
  destination?: string;
  shipmentType?: string;
  transportMode?: string;
  commodity?: string;
  weightKg?: number;
  direction?: string;
  // Extra snapshot
  contextSnapshot?: Record<string, unknown>;
  // Vendor pricing context
  quotedVendorPrice?: number;
}

export interface UpdateOutcomeInput {
  orderId: number;
  outcome: "success" | "failure" | "partial" | "cancelled";
  onTimeDelivery?: boolean;
  delayDays?: number;
  actualVendorPrice?: number;
  outcomeNotes?: string;
}

export interface DecisionContextQuery {
  origin?: string;
  destination?: string;
  shipmentType?: string;
  vendorId?: number;
  decisionType?: string;
  limit?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Record Decision
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Catat keputusan baru. Dipanggil saat admin/AI assign vendor, dll.
 * Fire-and-forget aman — error tidak melempar exception ke caller.
 */
export async function recordDecision(input: RecordDecisionInput): Promise<number | null> {
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

    const result = await db.execute(sql`
      INSERT INTO ai_decision_memory (
        decision_type, origin, destination, shipment_type, transport_mode,
        commodity, weight_kg, direction,
        chosen_entity_type, chosen_entity_id, chosen_entity_name,
        reasoning, confidence, decided_by,
        order_id, order_number, rfq_id, quote_id, company_id, execution_id,
        quoted_vendor_price, context_snapshot
      ) VALUES (
        ${input.decisionType},
        ${input.origin ?? null},
        ${input.destination ?? null},
        ${input.shipmentType ?? null},
        ${input.transportMode ?? null},
        ${input.commodity ?? null},
        ${input.weightKg ?? null},
        ${input.direction ?? null},
        ${input.chosenEntityType},
        ${input.chosenEntityId ?? null},
        ${input.chosenEntityName},
        ${input.reasoning ?? null},
        ${input.confidence ?? null},
        ${input.decidedBy ?? "admin"},
        ${input.orderId ?? null},
        ${input.orderNumber ?? null},
        ${input.rfqId ?? null},
        ${input.quoteId ?? null},
        ${input.companyId ?? null},
        ${input.executionId ?? null},
        ${input.quotedVendorPrice ?? null},
        ${input.contextSnapshot ? JSON.stringify(input.contextSnapshot) : null}
      )
      RETURNING id
    `);

    const id = (result.rows[0] as { id: number })?.id ?? null;
    logger.info({ id, decisionType: input.decisionType, entity: input.chosenEntityName }, "Decision memory recorded");
    return id;
  } catch (err) {
    logger.warn({ err }, "Failed to record decision memory (non-fatal)");
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Update Outcome
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Update outcome keputusan berdasarkan orderId.
 * Dipanggil saat order complete-review.
 */
export async function updateDecisionOutcome(input: UpdateOutcomeInput): Promise<void> {
  try {
    await db.execute(sql`
      UPDATE ai_decision_memory
      SET
        outcome             = ${input.outcome},
        on_time_delivery    = ${input.onTimeDelivery ?? null},
        delay_days          = ${input.delayDays ?? null},
        actual_vendor_price = ${input.actualVendorPrice ?? null},
        outcome_notes       = ${input.outcomeNotes ?? null},
        outcome_updated_at  = NOW()
      WHERE order_id = ${input.orderId}
        AND outcome IS NULL
    `);
    logger.info({ orderId: input.orderId, outcome: input.outcome }, "Decision memory outcome updated");
  } catch (err) {
    logger.warn({ err }, "Failed to update decision memory outcome (non-fatal)");
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Context String — untuk inject ke AI prompt
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Bangun string context dari memories yang relevan untuk di-inject ke AI prompt.
 * Contoh output:
 *   "Vendor PT. Maju Jaya: 3 order serupa (Jakarta→Surabaya, trucking),
 *    on-time 66.7%, avg delay 0.5 hari."
 */
export async function getDecisionContextString(query: DecisionContextQuery): Promise<string> {
  try {
    const limit = query.limit ?? 20;

    const rows = await db.execute(sql`
      SELECT
        chosen_entity_name,
        chosen_entity_id,
        decision_type,
        origin,
        destination,
        shipment_type,
        outcome,
        on_time_delivery,
        delay_days,
        quoted_vendor_price,
        actual_vendor_price,
        reasoning,
        created_at
      FROM ai_decision_memory
      WHERE 1=1
        ${query.decisionType ? sql`AND decision_type = ${query.decisionType}` : sql``}
        ${query.vendorId ? sql`AND chosen_entity_id = ${query.vendorId}` : sql``}
        ${query.origin ? sql`AND (origin ILIKE ${"%" + query.origin + "%"} OR origin IS NULL)` : sql``}
        ${query.destination ? sql`AND (destination ILIKE ${"%" + query.destination + "%"} OR destination IS NULL)` : sql``}
        ${query.shipmentType ? sql`AND (shipment_type = ${query.shipmentType} OR shipment_type IS NULL)` : sql``}
        AND outcome IS NOT NULL
      ORDER BY created_at DESC
      LIMIT ${limit}
    `);

    if (!rows.rows.length) return "";

    // Group by vendor/entity name
    const byEntity: Record<string, {
      total: number;
      onTime: number;
      totalDelayDays: number;
      delayCount: number;
      routes: Set<string>;
    }> = {};

    for (const row of rows.rows as any[]) {
      const name = row.chosen_entity_name as string;
      if (!byEntity[name]) {
        byEntity[name] = { total: 0, onTime: 0, totalDelayDays: 0, delayCount: 0, routes: new Set() };
      }
      const e = byEntity[name];
      e.total++;
      if (row.on_time_delivery === true) e.onTime++;
      if (row.delay_days && row.delay_days > 0) {
        e.totalDelayDays += row.delay_days;
        e.delayCount++;
      }
      if (row.origin && row.destination) {
        e.routes.add(`${row.origin}→${row.destination}`);
      }
    }

    const lines: string[] = ["[Decision Memory — Data Historis AI B2B Marketplace and Logistic]"];
    for (const [name, stats] of Object.entries(byEntity)) {
      const onTimePct = stats.total > 0 ? Math.round((stats.onTime / stats.total) * 100) : 0;
      const avgDelay = stats.delayCount > 0 ? (stats.totalDelayDays / stats.delayCount).toFixed(1) : "0";
      const routeStr = stats.routes.size > 0
        ? Array.from(stats.routes).slice(0, 3).join(", ")
        : "berbagai rute";
      lines.push(
        `- ${name}: ${stats.total} order (${routeStr}), on-time ${onTimePct}%, rata-rata delay ${avgDelay} hari`
      );
    }

    return lines.join("\n");
  } catch (err) {
    logger.warn({ err }, "Failed to get decision context string");
    return "";
  }
}
