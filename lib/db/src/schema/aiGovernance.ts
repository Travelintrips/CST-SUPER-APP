import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  jsonb,
  numeric,
  index,
} from "drizzle-orm/pg-core";

/**
 * AI Governance — Execution Log
 *
 * Setiap tindakan yang dilakukan AI agent dicatat di sini:
 * reasoning, confidence, input/output, safety checks, dan hasil approval.
 * Ini adalah fondasi explainable AI dan compliance logging.
 */
export const aiAgentExecutionsTable = pgTable("ai_agent_executions", {
  id: serial("id").primaryKey(),

  // ── Identity ──────────────────────────────────────────────────────────────
  agentType: text("agent_type").notNull(),
  // customer | vendor | ops | customs | finance | intake | ocr | document

  action: text("action").notNull(),
  // create_draft_quote | send_reminder | classify_document | extract_data
  // assign_vendor | escalate_order | verify_pod | parse_vendor_reply | ...

  // ── Lifecycle ─────────────────────────────────────────────────────────────
  status: text("status").notNull().default("running"),
  // pending | running | completed | failed | skipped | awaiting_approval

  // ── AI Quality ────────────────────────────────────────────────────────────
  confidence: numeric("confidence", { precision: 5, scale: 4 }),
  // 0.0000 – 1.0000; NULL jika model tidak memberikan confidence score

  reasoning: text("reasoning"),
  // Ringkasan alasan AI membuat keputusan ini (max ~500 char)

  modelUsed: text("model_used"),
  // gpt-4o | gpt-4o-mini | gpt-4-vision-preview | ...

  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),

  // ── Context ───────────────────────────────────────────────────────────────
  inputSummary: text("input_summary"),
  // Deskripsi singkat input yang diproses AI
  outputSummary: text("output_summary"),
  // Deskripsi singkat output/keputusan AI

  inputData: jsonb("input_data"),
  // Full input (ditruncate jika terlalu besar)
  outputData: jsonb("output_data"),
  // Full structured output dari AI

  // ── References ────────────────────────────────────────────────────────────
  orderId: integer("order_id"),
  rfqId: integer("rfq_id"),
  companyId: integer("company_id"),

  // ── Trigger ───────────────────────────────────────────────────────────────
  triggeredBy: text("triggered_by").notNull().default("system"),
  // system | user | agent | webhook | scheduler
  triggeredById: text("triggered_by_id"),
  // user_id atau agent execution ID yang memicu

  reqId: text("req_id"),
  // Correlation ID dari X-Request-ID header

  // ── Safety & Governance ───────────────────────────────────────────────────
  safetyChecks: jsonb("safety_checks"),
  // Array of: { check: string, passed: boolean, value?: unknown }
  humanApprovalRequired: boolean("human_approval_required").notNull().default(false),
  approvalId: integer("approval_id"),
  // FK ke ai_approval_queue.id — diisi setelah approval record dibuat

  // ── Override ──────────────────────────────────────────────────────────────
  wasOverridden: boolean("was_overridden").notNull().default(false),
  overrideBy: text("override_by"),
  overrideReason: text("override_reason"),

  // ── Performance ──────────────────────────────────────────────────────────
  durationMs: integer("duration_ms"),
  errorMessage: text("error_message"),

  // ── Timestamps ────────────────────────────────────────────────────────────
  createdAt: timestamp("created_at").defaultNow().notNull(),
  completedAt: timestamp("completed_at"),
});

/**
 * AI Governance — Human Approval Queue
 *
 * Antrian persetujuan manusia untuk AI actions Level 3+.
 * AI tidak boleh execute action yang membutuhkan approval
 * sebelum ada record "approved" di tabel ini.
 */
export const aiApprovalQueueTable = pgTable("ai_approval_queue", {
  id: serial("id").primaryKey(),

  // ── Link ke execution ─────────────────────────────────────────────────────
  executionId: integer("execution_id"),
  // FK ke ai_agent_executions.id

  // ── Identity ──────────────────────────────────────────────────────────────
  agentType: text("agent_type").notNull(),
  action: text("action").notNull(),
  actionDescription: text("action_description").notNull(),
  // Deskripsi human-readable: "AI ingin assign vendor PT. Maju ke order #CST/2026/001234"

  // ── Context untuk reviewer ────────────────────────────────────────────────
  contextData: jsonb("context_data"),
  // Data relevan agar reviewer bisa membuat keputusan tanpa buka sistem

  priority: text("priority").notNull().default("medium"),
  // low | medium | high | critical

  amount: numeric("amount", { precision: 18, scale: 2 }),
  // Nilai moneter jika relevan (untuk threshold check)

  // ── References ────────────────────────────────────────────────────────────
  orderId: integer("order_id"),
  rfqId: integer("rfq_id"),
  companyId: integer("company_id"),
  requestedById: text("requested_by_id"),
  // user_id atau "system" yang meminta approval

  // ── Status ────────────────────────────────────────────────────────────────
  status: text("status").notNull().default("pending"),
  // pending | approved | rejected | expired | auto_approved

  // ── Expiry & Auto-approve ─────────────────────────────────────────────────
  expiresAt: timestamp("expires_at").notNull(),
  // Jika tidak ada keputusan sampai waktu ini → status = expired
  autoApproveAt: timestamp("auto_approve_at"),
  // Opsional: jika tidak ada respons, auto-approve pada waktu ini

  // ── Decision ──────────────────────────────────────────────────────────────
  decidedBy: text("decided_by"),
  // user_id reviewer atau "system" untuk auto-approve
  decidedAt: timestamp("decided_at"),
  decisionReason: text("decision_reason"),

  // ── Undo window ───────────────────────────────────────────────────────────
  undoDeadline: timestamp("undo_deadline"),
  // Approved actions bisa di-undo sampai timestamp ini (default: +30 menit)
  wasUndone: boolean("was_undone").notNull().default(false),
  undoneBy: text("undone_by"),
  undoneAt: timestamp("undone_at"),

  // ── Timestamps ────────────────────────────────────────────────────────────
  requestedAt: timestamp("requested_at").defaultNow().notNull(),
});

export type AiAgentExecution = typeof aiAgentExecutionsTable.$inferSelect;
export type InsertAiAgentExecution = typeof aiAgentExecutionsTable.$inferInsert;

export type AiApprovalQueue = typeof aiApprovalQueueTable.$inferSelect;
export type InsertAiApprovalQueue = typeof aiApprovalQueueTable.$inferInsert;

/**
 * AI Decision Memory Store
 *
 * Setiap keputusan AI (assign vendor, routing, pricing, dll.) beserta hasilnya
 * disimpan di sini. Digunakan sebagai "memori institusional" untuk memperkaya
 * context AI berikutnya: "AI pernah assign vendor X ke order serupa → on-time 94%".
 *
 * Lifecycle:
 *   1. Decision dicatat saat AI / admin membuat keputusan (outcome = null)
 *   2. Outcome diupdate saat order selesai / gagal
 *   3. Saat AI membuat keputusan baru, query memories yang relevan → inject ke prompt
 */
export const aiDecisionMemoryTable = pgTable("ai_decision_memory", {
  id: serial("id").primaryKey(),

  // ── Decision Type ──────────────────────────────────────────────────────────
  decisionType: text("decision_type").notNull(),
  // vendor_assignment | route_selection | pricing | escalation | classification

  // ── Context (fingerprint untuk similarity matching) ────────────────────────
  origin: text("origin"),
  destination: text("destination"),
  shipmentType: text("shipment_type"),
  transportMode: text("transport_mode"),
  commodity: text("commodity"),
  weightKg: numeric("weight_kg", { precision: 12, scale: 3 }),
  direction: text("direction"),
  // import | export | domestic | transit

  // ── Decision ──────────────────────────────────────────────────────────────
  chosenEntityType: text("chosen_entity_type").notNull(),
  // vendor | route | price_tier | escalation_level
  chosenEntityId: integer("chosen_entity_id"),
  // FK ke suppliers.id / dll (nullable untuk entity non-integer)
  chosenEntityName: text("chosen_entity_name").notNull(),
  // Nama human-readable: "PT. Maju Jaya Logistics"

  reasoning: text("reasoning"),
  // Ringkasan mengapa keputusan ini diambil (dari AI atau admin)
  confidence: numeric("confidence", { precision: 5, scale: 4 }),
  // 0.0000 – 1.0000

  decidedBy: text("decided_by").notNull().default("admin"),
  // admin | ai | system

  // ── References ────────────────────────────────────────────────────────────
  orderId: integer("order_id"),
  // FK ke logistic_orders.id
  orderNumber: text("order_number"),
  rfqId: integer("rfq_id"),
  quoteId: integer("quote_id"),
  companyId: integer("company_id"),
  executionId: integer("execution_id"),
  // FK ke ai_agent_executions.id (jika dipicu oleh AI)

  // ── Outcome (diisi setelah order selesai) ─────────────────────────────────
  outcome: text("outcome"),
  // success | failure | partial | cancelled | unknown
  onTimeDelivery: boolean("on_time_delivery"),
  // true = delivered on/before ETA | false = delayed | null = belum diketahui
  delayDays: integer("delay_days"),
  // Jumlah hari terlambat (positif = terlambat, negatif = lebih cepat)
  actualVendorPrice: numeric("actual_vendor_price", { precision: 14, scale: 2 }),
  quotedVendorPrice: numeric("quoted_vendor_price", { precision: 14, scale: 2 }),
  outcomeNotes: text("outcome_notes"),
  // Catatan tambahan: "Vendor minta reschedule H-1", "Dokumen incomplete"

  outcomeUpdatedAt: timestamp("outcome_updated_at"),

  // ── Extra context snapshot ─────────────────────────────────────────────────
  contextSnapshot: jsonb("context_snapshot"),
  // Snapshot lengkap context saat keputusan dibuat (untuk audit/replay)

  // ── Timestamps ────────────────────────────────────────────────────────────
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("ai_dm_decision_type_idx").on(t.decisionType),
  index("ai_dm_entity_idx").on(t.chosenEntityId, t.chosenEntityType),
  index("ai_dm_order_idx").on(t.orderId),
  index("ai_dm_route_idx").on(t.origin, t.destination),
  index("ai_dm_outcome_idx").on(t.outcome),
]);

export type AiDecisionMemory = typeof aiDecisionMemoryTable.$inferSelect;
export type InsertAiDecisionMemory = typeof aiDecisionMemoryTable.$inferInsert;
