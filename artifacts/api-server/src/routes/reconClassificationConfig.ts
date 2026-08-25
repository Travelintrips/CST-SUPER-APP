/**
 * Bank Reconciliation Classification Configuration API
 *
 * Routes (all under /api/recon-classification):
 *
 * Configs (Business Txn / Routine Expense / Income Allocation):
 *   GET    /configs            — list configs (filter: category, include_inactive)
 *   POST   /configs            — create config
 *   PATCH  /configs/:id        — update config
 *   POST   /configs/:id/deactivate — soft-deactivate (blocked if usage_count > 0)
 *   POST   /configs/seed       — re-run seed migration
 *
 * AI Classification Rules:
 *   GET    /ai-rules           — list rules
 *   POST   /ai-rules           — create rule
 *   PATCH  /ai-rules/:id       — update rule
 *   DELETE /ai-rules/:id       — deactivate rule
 *
 * Keyword Dictionary:
 *   GET    /keywords           — list keywords
 *   POST   /keywords           — create keyword
 *   PATCH  /keywords/:id       — update keyword
 *   DELETE /keywords/:id       — delete keyword
 *
 * Approval Rules:
 *   GET    /approval-rules     — list approval rules
 *   POST   /approval-rules     — create approval rule
 *   PATCH  /approval-rules/:id — update approval rule
 *   DELETE /approval-rules/:id — delete approval rule
 *
 * Auth: requireAdmin on all routes.
 *
 * GUARDRAILS (do not violate):
 *   - Does NOT modify accounting engine
 *   - Does NOT modify Universal Journal Reuse Engine
 *   - Does NOT modify COA Governance
 *   - Only replaces hardcoded classification config with DB master data
 */

import { Router } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../lib/requireAdmin.js";
import { logger } from "../lib/logger.js";
import { evaluateReconRules, type ReconRule, type ReconRuleMutationInput } from "../lib/reconciliation/reconRuleEngine.js";
import {
  runReconClassificationMigration,
  syncOperationalReconRulesToClassification,
  resetMigrationFlag,
} from "../lib/reconClassificationMigration.js";
import { trackAiRuleFeedback } from "../lib/usageTrackingService.js";

export const reconClassificationRouter = Router();

// ─── Auth guard ────────────────────────────────────────────────────────────────
reconClassificationRouter.use(async (req, res, next) => {
  if (!(await requireAdmin(req, res))) return;
  next();
});

// ─── Lazy migration ────────────────────────────────────────────────────────────
let ensureMigrated = false;
async function ensureTables() {
  if (ensureMigrated) return;
  await runReconClassificationMigration();
  await syncOperationalReconRulesToClassification();
  ensureMigrated = true;
}

// ─── Validation schemas ────────────────────────────────────────────────────────

const ConfigUpsertSchema = z.object({
  category:             z.enum(["BUSINESS_TRANSACTION", "ROUTINE_EXPENSE", "INCOME_ALLOCATION"]),
  name:                 z.string().min(1).max(120),
  code:                 z.string().min(1).max(60).regex(/^[A-Z0-9_]+$/, "code must be UPPER_SNAKE_CASE"),
  type:                 z.string().optional().nullable(),
  flow:                 z.enum(["BUSINESS_MATCHING", "ROUTINE_EXPENSE_ALLOCATION", "INCOME_ALLOCATION", "MANUAL_REVIEW", "BLOCKED"]),
  default_coa_code:     z.string().optional().nullable(),
  default_vendor_id:    z.number().int().optional().nullable(),
  default_department:   z.string().optional().nullable(),
  default_cost_center:  z.string().optional().nullable(),
  need_upload:          z.enum(["none", "optional", "required"]).default("none"),
  upload_file_types:    z.array(z.enum(["PDF", "JPG", "PNG", "WEBP"])).default([]),
  upload_max_files:     z.coerce.number().int().min(1).max(20).default(5),
  upload_max_size_mb:   z.coerce.number().int().min(1).max(100).default(10),
  need_approval:        z.boolean().default(false),
  need_invoice_number:  z.boolean().default(false),
  need_reference_number: z.boolean().default(false),
  ai_learning_enabled:  z.boolean().default(true),
  confidence_threshold: z.coerce.number().min(0).max(1).default(0.75),
  keywords:             z.array(z.string()).default([]),
  regex_pattern:        z.string().optional().nullable(),
  priority:             z.coerce.number().int().min(1).max(999).default(50),
  company_id:           z.number().int().optional().nullable(),
});

const AiRuleSchema = z.object({
  name:                z.string().min(1).max(120),
  description:         z.string().optional().nullable(),
  config_id:           z.number().int().optional().nullable(),
  condition_field:     z.enum(["description", "amount", "direction", "intent", "normalized"]),
  condition_operator:  z.enum(["contains", "starts_with", "regex", "eq", "neq", "gte", "lte"]),
  condition_value:     z.string().min(1),
  conditions: z.array(z.object({
    field: z.enum(["description", "amount", "direction", "bank", "transaction_code", "normalized", "reference", "counterparty_name", "counterparty_account"]),
    operator: z.enum(["contains", "not_contains", "equals", "not_equals", "starts_with", "ends_with", "eq", "neq", "regex", "greater_than", "less_than", "gte", "lte", "between"]),
    value: z.string().min(1),
    negate: z.boolean().optional(),
  })).min(1).optional(),
  logic: z.enum(["AND", "OR"]).default("AND"),
  specificity: z.coerce.number().int().min(1).max(999).optional(),
  action_flow:         z.enum(["BUSINESS_MATCHING", "ROUTINE_EXPENSE_ALLOCATION", "INCOME_ALLOCATION", "MANUAL_REVIEW", "BLOCKED"]).optional().nullable(),
  action_coa_code:     z.string().optional().nullable(),
  action_config_code:  z.string().optional().nullable(),
  confidence:          z.coerce.number().min(0).max(1).default(0.8),
  priority:            z.coerce.number().int().min(1).max(999).default(50),
  source:              z.enum(["manual", "ai_generated"]).default("manual"),
  company_id:          z.number().int().optional().nullable(),
});

function normalizeRuleConditions(d: any) {
  const conditions = d.conditions?.length
    ? d.conditions
    : [{ field: d.condition_field, operator: d.condition_operator, value: d.condition_value }];
  return {
    conditions,
    logic: d.logic ?? "AND",
    specificity: d.specificity ?? conditions.length,
    condition: conditions[0],
  };
}

function aiRowToReconRule(row: any, fallbackCompanyId: number): ReconRule {
  const conditions = Array.isArray(row.conditions_json) && row.conditions_json.length
    ? row.conditions_json
    : [{ field: row.condition_field, operator: row.condition_operator, value: row.condition_value }];
  return {
    id: Number(row.id), companyId: row.company_id == null ? fallbackCompanyId : Number(row.company_id),
    name: String(row.name ?? ""), description: row.description ?? null,
    priority: Number(row.priority ?? 50), isActive: row.is_active !== false,
    direction: null, bankAccountId: null, conditionType: "AI",
    conditionField: conditions[0].field, conditionOperator: conditions[0].operator,
    conditionValue: String(conditions[0].value ?? ""), conditions,
    logic: row.logic === "OR" ? "OR" : "AND", specificity: Number(row.specificity ?? conditions.length),
    targetType: row.action_flow === "INCOME_ALLOCATION" ? "income" : "expense",
    targetId: null, targetCoaCode: row.action_coa_code ?? null,
    confidenceScore: Math.round(Number(row.confidence ?? 0) * 100), stopProcessing: true,
    matchCount: 0, lastMatchedAt: null, createdBy: row.created_by ?? null,
    createdAt: String(row.created_at ?? ""), updatedAt: String(row.updated_at ?? ""),
  };
}

const KeywordSchema = z.object({
  term:       z.string().min(1).max(200),
  weight:     z.coerce.number().min(0).max(1).default(0.8),
  config_id:  z.number().int().optional().nullable(),
  company_id: z.number().int().optional().nullable(),
});

const ApprovalRuleSchema = z.object({
  name:                   z.string().min(1).max(120),
  config_id:              z.number().int().optional().nullable(),
  min_amount:             z.number().optional().nullable(),
  max_amount:             z.number().optional().nullable(),
  required_approver_role: z.string().optional().nullable(),
  approval_level:         z.number().int().min(1).max(10).default(1),
  company_id:             z.number().int().optional().nullable(),
});

// ─── Helper ────────────────────────────────────────────────────────────────────

function parseCompanyId(val: unknown): number | null {
  if (val == null || val === "" || val === "null") return null;
  const n = Number(val);
  return isNaN(n) ? null : n;
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONFIGS
// ═══════════════════════════════════════════════════════════════════════════════

// GET /api/recon-classification/configs
reconClassificationRouter.get("/configs", async (req, res) => {
  try {
    await ensureTables();
    const companyId      = parseCompanyId(req.query["company_id"]);
    const category       = req.query["category"] as string | undefined;
    const includeInactive = req.query["include_inactive"] === "true";

    let whereClause = `WHERE 1=1`;
    if (!includeInactive) whereClause += ` AND is_active = TRUE`;
    if (category)         whereClause += ` AND category = '${category.replace(/'/g, "''")}'`;
    if (companyId != null) {
      whereClause += ` AND (company_id = ${companyId} OR company_id IS NULL)`;
    }

    const rows = await db.execute(sql.raw(
      `SELECT * FROM recon_classification_configs ${whereClause} ORDER BY category, priority, name`
    ));

    res.json({ data: rows.rows });
  } catch (err) {
    logger.error({ err }, "[ReconClassification] GET /configs error:");
    res.status(500).json({ error: "Gagal mengambil konfigurasi." });
  }
});

// POST /api/recon-classification/configs/seed  (must come before /:id)
reconClassificationRouter.post("/configs/seed", async (req, res) => {
  try {
    resetMigrationFlag();
    ensureMigrated = false;
    await ensureTables();
    res.json({ ok: true, message: "Seed berhasil dijalankan ulang." });
  } catch (err) {
    logger.error({ err }, "[ReconClassification] POST /configs/seed error:");
    res.status(500).json({ error: "Gagal menjalankan seed." });
  }
});

// POST /api/recon-classification/configs
reconClassificationRouter.post("/configs", async (req, res) => {
  try {
    await ensureTables();
    const parsed = ConfigUpsertSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validasi gagal.", details: parsed.error.issues });
    }
    const d = parsed.data;
    const userId = (req as any).user?.id ?? null;

    const result = await db.execute(sql.raw(`
      INSERT INTO recon_classification_configs
        (company_id, category, name, code, type, flow,
         default_coa_code, default_vendor_id, default_department, default_cost_center,
         need_upload, upload_file_types, upload_max_files, upload_max_size_mb,
         need_approval, need_invoice_number, need_reference_number,
         ai_learning_enabled, confidence_threshold,
         keywords, regex_pattern, priority, created_by)
      VALUES (
        ${d.company_id ?? "NULL"},
        '${d.category}',
        '${d.name.replace(/'/g, "''")}',
        '${d.code}',
        ${d.type ? `'${d.type.replace(/'/g, "''")}'` : "NULL"},
        '${d.flow}',
        ${d.default_coa_code ? `'${d.default_coa_code.replace(/'/g, "''")}'` : "NULL"},
        ${d.default_vendor_id ?? "NULL"},
        ${d.default_department ? `'${d.default_department.replace(/'/g, "''")}'` : "NULL"},
        ${d.default_cost_center ? `'${d.default_cost_center.replace(/'/g, "''")}'` : "NULL"},
        '${d.need_upload}',
        '${JSON.stringify(d.upload_file_types)}',
        ${d.upload_max_files},
        ${d.upload_max_size_mb},
        ${d.need_approval},
        ${d.need_invoice_number},
        ${d.need_reference_number},
        ${d.ai_learning_enabled},
        ${d.confidence_threshold},
        '${JSON.stringify(d.keywords)}',
        ${d.regex_pattern ? `'${d.regex_pattern.replace(/'/g, "''")}'` : "NULL"},
        ${d.priority},
        ${userId ? `'${userId}'` : "NULL"}
      )
      ON CONFLICT (code, COALESCE(company_id, 0)) DO NOTHING
      RETURNING *
    `));

    if (!result.rows[0]) {
      return res.status(409).json({ error: `Kode '${d.code}' sudah digunakan dalam scope yang sama.` });
    }
    res.status(201).json({ data: result.rows[0] });
  } catch (err) {
    logger.error({ err }, "[ReconClassification] POST /configs error:");
    res.status(500).json({ error: "Gagal membuat konfigurasi." });
  }
});

// PATCH /api/recon-classification/configs/:id
reconClassificationRouter.patch("/configs/:id", async (req, res) => {
  try {
    await ensureTables();
    const id = parseInt(req.params["id"] ?? "", 10);
    if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid." });

    const parsed = ConfigUpsertSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validasi gagal.", details: parsed.error.issues });
    }
    const d = parsed.data;
    const normalized = normalizeRuleConditions(d);
    const userId = (req as any).user?.id ?? null;

    const setClauses: string[] = [`updated_at = NOW()`, `updated_by = ${userId ? `'${userId}'` : "NULL"}`];
    if (d.name !== undefined)                setClauses.push(`name = '${d.name.replace(/'/g, "''")}'`);
    if (d.flow !== undefined)                setClauses.push(`flow = '${d.flow}'`);
    if (d.type !== undefined)                setClauses.push(`type = ${d.type ? `'${d.type.replace(/'/g, "''")}'` : "NULL"}`);
    if (d.default_coa_code !== undefined)    setClauses.push(`default_coa_code = ${d.default_coa_code ? `'${d.default_coa_code.replace(/'/g, "''")}'` : "NULL"}`);
    if (d.default_vendor_id !== undefined)   setClauses.push(`default_vendor_id = ${d.default_vendor_id ?? "NULL"}`);
    if (d.default_department !== undefined)  setClauses.push(`default_department = ${d.default_department ? `'${d.default_department.replace(/'/g, "''")}'` : "NULL"}`);
    if (d.default_cost_center !== undefined) setClauses.push(`default_cost_center = ${d.default_cost_center ? `'${d.default_cost_center.replace(/'/g, "''")}'` : "NULL"}`);
    if (d.need_upload !== undefined)         setClauses.push(`need_upload = '${d.need_upload}'`);
    if (d.upload_file_types !== undefined)   setClauses.push(`upload_file_types = '${JSON.stringify(d.upload_file_types)}'`);
    if (d.upload_max_files !== undefined)    setClauses.push(`upload_max_files = ${d.upload_max_files}`);
    if (d.upload_max_size_mb !== undefined)  setClauses.push(`upload_max_size_mb = ${d.upload_max_size_mb}`);
    if (d.need_approval !== undefined)       setClauses.push(`need_approval = ${d.need_approval}`);
    if (d.need_invoice_number !== undefined) setClauses.push(`need_invoice_number = ${d.need_invoice_number}`);
    if (d.need_reference_number !== undefined) setClauses.push(`need_reference_number = ${d.need_reference_number}`);
    if (d.ai_learning_enabled !== undefined) setClauses.push(`ai_learning_enabled = ${d.ai_learning_enabled}`);
    if (d.confidence_threshold !== undefined) setClauses.push(`confidence_threshold = ${d.confidence_threshold}`);
    if (d.keywords !== undefined)            setClauses.push(`keywords = '${JSON.stringify(d.keywords)}'`);
    if (d.regex_pattern !== undefined)       setClauses.push(`regex_pattern = ${d.regex_pattern ? `'${d.regex_pattern.replace(/'/g, "''")}'` : "NULL"}`);
    if (d.priority !== undefined)            setClauses.push(`priority = ${d.priority}`);

    const result = await db.execute(sql.raw(
      `UPDATE recon_classification_configs SET ${setClauses.join(", ")} WHERE id = ${id} RETURNING *`
    ));

    if (!result.rows[0]) return res.status(404).json({ error: "Konfigurasi tidak ditemukan." });
    res.json({ data: result.rows[0] });
  } catch (err) {
    logger.error({ err }, "[ReconClassification] PATCH /configs/:id error:");
    res.status(500).json({ error: "Gagal memperbarui konfigurasi." });
  }
});

// POST /api/recon-classification/configs/:id/deactivate
// Phase 14: allow deactivate with warning if usage_count > 0 (only hard DELETE is blocked)
reconClassificationRouter.post("/configs/:id/deactivate", async (req, res) => {
  try {
    await ensureTables();
    const id = parseInt(req.params["id"] ?? "", 10);
    if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid." });

    const existing = await db.execute(sql.raw(
      `SELECT usage_count, is_seed FROM recon_classification_configs WHERE id = ${id}`
    ));
    const row = existing.rows[0] as any;
    if (!row) return res.status(404).json({ error: "Konfigurasi tidak ditemukan." });

    await db.execute(sql.raw(
      `UPDATE recon_classification_configs SET is_active = FALSE, updated_at = NOW() WHERE id = ${id}`
    ));

    const usageCount = Number(row.usage_count ?? 0);
    res.json({
      ok: true,
      warning: usageCount > 0
        ? `Konfigurasi ini sudah pernah digunakan ${usageCount} kali dan tidak dapat dihapus. Anda tetap dapat menonaktifkannya untuk transaksi baru.`
        : null,
      usage_count: usageCount,
    });
  } catch (err) {
    logger.error({ err }, "[ReconClassification] POST /configs/:id/deactivate error:");
    res.status(500).json({ error: "Gagal menonaktifkan konfigurasi." });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// AI CLASSIFICATION RULES
// ═══════════════════════════════════════════════════════════════════════════════

reconClassificationRouter.get("/ai-rules", async (req, res) => {
  try {
    await ensureTables();
    const companyId = parseCompanyId(req.query["company_id"]);
    const includeInactive = req.query["include_inactive"] === "true";

    let where = `WHERE 1=1`;
    if (!includeInactive) where += ` AND r.is_active = TRUE`;
    if (companyId != null) where += ` AND (r.company_id = ${companyId} OR r.company_id IS NULL)`;

    const rows = await db.execute(sql.raw(`
      SELECT r.*, c.name AS config_name, c.category AS config_category
      FROM recon_ai_classification_rules r
      LEFT JOIN recon_classification_configs c ON c.id = r.config_id
      ${where}
      ORDER BY r.priority, r.id
    `));
    res.json({ data: rows.rows });
  } catch (err) {
    logger.error({ err }, "[ReconClassification] GET /ai-rules error:");
    res.status(500).json({ error: "Gagal mengambil AI rules." });
  }
});

reconClassificationRouter.post("/ai-rules", async (req, res) => {
  try {
    await ensureTables();
    const parsed = AiRuleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validasi gagal.", details: parsed.error.issues });
    const d = parsed.data;
    const normalized = normalizeRuleConditions(d);
    const userId = (req as any).user?.id ?? null;
    const normalized = normalizeRuleConditions(d);

    const result = await db.execute(sql.raw(`
      INSERT INTO recon_ai_classification_rules
        (company_id, config_id, name, description, condition_field, condition_operator, condition_value,
         conditions_json, logic, specificity,
         action_flow, action_coa_code, action_config_code, confidence, priority, source, created_by)
      VALUES (
        ${d.company_id ?? "NULL"},
        ${d.config_id ?? "NULL"},
        '${d.name.replace(/'/g, "''")}',
        ${d.description ? `'${d.description.replace(/'/g, "''")}'` : "NULL"},
        '${d.condition_field}',
        '${d.condition_operator}',
         '${String(normalized.condition.value).replace(/'/g, "''")}',
         '${JSON.stringify(normalized.conditions).replace(/'/g, "''")}'::jsonb,
         '${normalized.logic}', ${normalized.specificity},
        ${d.action_flow ? `'${d.action_flow}'` : "NULL"},
        ${d.action_coa_code ? `'${d.action_coa_code.replace(/'/g, "''")}'` : "NULL"},
        ${d.action_config_code ? `'${d.action_config_code.replace(/'/g, "''")}'` : "NULL"},
        ${d.confidence},
        ${d.priority},
        '${d.source}',
        ${userId ? `'${userId}'` : "NULL"}
      )
      RETURNING *
    `));
    res.status(201).json({ data: result.rows[0] });
  } catch (err) {
    logger.error({ err }, "[ReconClassification] POST /ai-rules error:");
    res.status(500).json({ error: "Gagal membuat AI rule." });
  }
});

// Read-only matcher preview. This deliberately returns classification data only;
// it never creates a reconciliation candidate, journal, settlement, or posting.
reconClassificationRouter.post("/ai-rules/preview", async (req, res) => {
  try {
    await ensureTables();
    const description = String(req.body?.description ?? "").trim();
    const companyId = parseCompanyId(req.body?.company_id);
    if (!description) return res.status(400).json({ error: "description wajib diisi." });

    const companyFilter = companyId == null
      ? "company_id IS NULL"
      : `(company_id = ${companyId} OR company_id IS NULL)`;
    const rows = await db.execute(sql.raw(`
      SELECT * FROM recon_ai_classification_rules
      WHERE is_active = TRUE AND ${companyFilter}
      ORDER BY priority DESC, specificity DESC, id ASC
    `));
    const mutation: ReconRuleMutationInput = {
      description,
      reference: req.body?.reference ? String(req.body.reference) : null,
      amount: Number(req.body?.amount ?? 0),
      direction: req.body?.direction === "OUT" ? "OUT" : "IN",
      bankAccountId: req.body?.bank_account_id != null ? Number(req.body.bank_account_id) : null,
      bank: req.body?.bank ? String(req.body.bank) : null,
      transactionCode: req.body?.transaction_code ? String(req.body.transaction_code) : null,
      counterpartyName: req.body?.counterparty_name ? String(req.body.counterparty_name) : null,
      counterpartyAccount: req.body?.counterparty_account ? String(req.body.counterparty_account) : null,
      companyId: companyId ?? 0,
    };
    const savedRules = (rows.rows as any[]).map((row: any) => aiRowToReconRule(row, companyId ?? 0));
    const draftConditions = Array.isArray(req.body?.conditions) ? req.body.conditions : null;
    const draftRule = draftConditions?.length ? aiRowToReconRule({
      id: -1, company_id: companyId ?? 0, name: "Draft rule",
      conditions_json: draftConditions, logic: req.body?.logic,
      specificity: req.body?.specificity ?? draftConditions.length,
      action_flow: req.body?.action_flow, action_coa_code: req.body?.action_coa_code,
      confidence: req.body?.confidence ?? 0.8,
    }, companyId ?? 0) : null;
    const result = evaluateReconRules(draftRule ? [draftRule, ...savedRules] : savedRules, mutation);
    return res.json({
      description, matched: result.matched, ambiguityCode: result.ambiguityCode ?? null,
      ambiguityReason: result.ambiguityReason ?? null, rule: result.matched ? {
        id: result.ruleId, name: result.ruleName, targetType: result.targetType,
        targetCoaCode: result.targetCoaCode, confidence: result.confidence,
      } : null,
      matchedConditions: result.reasons ?? [], evaluated: result.evaluated,
    });
  } catch (err) {
    logger.error({ err }, "[ReconClassification] AI rule preview failed");
    return res.status(500).json({ error: "Gagal menjalankan preview rule." });
  }
});

// ─── POST /api/recon-classification/ai-rules/feedback ────────────────────────
// Record explicit user feedback on an AI rule recommendation.
// Called by the frontend after the user accepts or rejects an AI suggestion.
// Best-effort: never fails the caller; errors are logged as warnings only.
//
// Body: { rule_id: number, mutation_id?: number, accepted: boolean }
// Auth: requireAdmin (same as all routes in this router)
reconClassificationRouter.post("/ai-rules/feedback", async (req, res) => {
  try {
    await ensureTables();
    const ruleId     = Number(req.body?.rule_id);
    const mutationId = req.body?.mutation_id != null ? Number(req.body.mutation_id) : undefined;
    const accepted   = Boolean(req.body?.accepted);
    const companyId: number | null = (req as any).user?.companyId ?? null;

    if (!ruleId || isNaN(ruleId)) {
      return res.status(400).json({ error: "rule_id wajib diisi dan harus angka." });
    }

    await trackAiRuleFeedback({ ruleId, accepted, mutationId, companyId });

    res.json({ ok: true });
  } catch (err) {
    // Non-fatal — log and return success so caller is unaffected
    logger.warn(
      { err: err instanceof Error ? err.message : String(err) },
      "[ReconClassification] POST /ai-rules/feedback failed — non-fatal",
    );
    res.json({ ok: true, warning: "Feedback recorded with errors (non-fatal)" });
  }
});

reconClassificationRouter.patch("/ai-rules/:id", async (req, res) => {
  try {
    await ensureTables();
    const id = parseInt(req.params["id"] ?? "", 10);
    if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid." });

    const parsed = AiRuleSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validasi gagal.", details: parsed.error.issues });
    const d = parsed.data;
    const normalized = normalizeRuleConditions({ ...d, condition_field: d.condition_field ?? "description", condition_operator: d.condition_operator ?? "contains", condition_value: d.condition_value ?? " " });

    const setClauses: string[] = [`updated_at = NOW()`];
    if (d.name !== undefined)               setClauses.push(`name = '${d.name.replace(/'/g, "''")}'`);
    if (d.description !== undefined)        setClauses.push(`description = ${d.description ? `'${d.description.replace(/'/g, "''")}'` : "NULL"}`);
    if (d.condition_field !== undefined)    setClauses.push(`condition_field = '${d.condition_field}'`);
    if (d.condition_operator !== undefined) setClauses.push(`condition_operator = '${d.condition_operator}'`);
    if (d.condition_value !== undefined)    setClauses.push(`condition_value = '${d.condition_value.replace(/'/g, "''")}'`);
    if (d.conditions !== undefined)         setClauses.push(`conditions_json = '${JSON.stringify(normalized.conditions).replace(/'/g, "''")}'::jsonb`);
    if (d.logic !== undefined)              setClauses.push(`logic = '${d.logic}'`);
    if (d.specificity !== undefined)        setClauses.push(`specificity = ${d.specificity}`);
    if (d.action_flow !== undefined)        setClauses.push(`action_flow = ${d.action_flow ? `'${d.action_flow}'` : "NULL"}`);
    if (d.action_coa_code !== undefined)    setClauses.push(`action_coa_code = ${d.action_coa_code ? `'${d.action_coa_code.replace(/'/g, "''")}'` : "NULL"}`);
    if (d.action_config_code !== undefined) setClauses.push(`action_config_code = ${d.action_config_code ? `'${d.action_config_code.replace(/'/g, "''")}'` : "NULL"}`);
    if (d.confidence !== undefined)         setClauses.push(`confidence = ${d.confidence}`);
    if (d.priority !== undefined)           setClauses.push(`priority = ${d.priority}`);

    const result = await db.execute(sql.raw(
      `UPDATE recon_ai_classification_rules SET ${setClauses.join(", ")} WHERE id = ${id} RETURNING *`
    ));
    if (!result.rows[0]) return res.status(404).json({ error: "Rule tidak ditemukan." });
    res.json({ data: result.rows[0] });
  } catch (err) {
    logger.error({ err }, "[ReconClassification] PATCH /ai-rules/:id error:");
    res.status(500).json({ error: "Gagal memperbarui AI rule." });
  }
});

reconClassificationRouter.delete("/ai-rules/:id", async (req, res) => {
  try {
    await ensureTables();
    const id = parseInt(req.params["id"] ?? "", 10);
    if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid." });
    await db.execute(sql.raw(`UPDATE recon_ai_classification_rules SET is_active = FALSE WHERE id = ${id}`));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[ReconClassification] DELETE /ai-rules/:id error:");
    res.status(500).json({ error: "Gagal menonaktifkan AI rule." });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// KEYWORD DICTIONARY
// ═══════════════════════════════════════════════════════════════════════════════

reconClassificationRouter.get("/keywords", async (req, res) => {
  try {
    await ensureTables();
    const companyId = parseCompanyId(req.query["company_id"]);
    const configId  = req.query["config_id"] ? parseInt(String(req.query["config_id"]), 10) : null;
    const includeInactive = req.query["include_inactive"] === "true";

    let where = `WHERE 1=1`;
    if (!includeInactive) where += ` AND k.is_active = TRUE`;
    if (companyId != null) where += ` AND (k.company_id = ${companyId} OR k.company_id IS NULL)`;
    if (configId)          where += ` AND k.config_id = ${configId}`;

    const rows = await db.execute(sql.raw(`
      SELECT k.*, c.name AS config_name
      FROM recon_keyword_dictionary k
      LEFT JOIN recon_classification_configs c ON c.id = k.config_id
      ${where}
      ORDER BY k.config_id NULLS LAST, k.term
    `));
    res.json({ data: rows.rows });
  } catch (err) {
    logger.error({ err }, "[ReconClassification] GET /keywords error:");
    res.status(500).json({ error: "Gagal mengambil keyword dictionary." });
  }
});

reconClassificationRouter.post("/keywords", async (req, res) => {
  try {
    await ensureTables();
    const parsed = KeywordSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validasi gagal.", details: parsed.error.issues });
    const d = parsed.data;
    const userId = (req as any).user?.id ?? null;

    const result = await db.execute(sql.raw(`
      INSERT INTO recon_keyword_dictionary (company_id, config_id, term, weight, created_by)
      VALUES (
        ${d.company_id ?? "NULL"},
        ${d.config_id ?? "NULL"},
        '${d.term.replace(/'/g, "''")}',
        ${d.weight},
        ${userId ? `'${userId}'` : "NULL"}
      )
      RETURNING *
    `));
    res.status(201).json({ data: result.rows[0] });
  } catch (err) {
    logger.error({ err }, "[ReconClassification] POST /keywords error:");
    res.status(500).json({ error: "Gagal membuat keyword." });
  }
});

reconClassificationRouter.patch("/keywords/:id", async (req, res) => {
  try {
    await ensureTables();
    const id = parseInt(req.params["id"] ?? "", 10);
    if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid." });

    const parsed = KeywordSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validasi gagal.", details: parsed.error.issues });
    const d = parsed.data;

    const setClauses: string[] = [];
    if (d.term !== undefined)      setClauses.push(`term = '${d.term.replace(/'/g, "''")}'`);
    if (d.weight !== undefined)    setClauses.push(`weight = ${d.weight}`);
    if (d.config_id !== undefined) setClauses.push(`config_id = ${d.config_id ?? "NULL"}`);
    if (setClauses.length === 0)   return res.status(400).json({ error: "Tidak ada field yang diubah." });

    const result = await db.execute(sql.raw(
      `UPDATE recon_keyword_dictionary SET ${setClauses.join(", ")} WHERE id = ${id} RETURNING *`
    ));
    if (!result.rows[0]) return res.status(404).json({ error: "Keyword tidak ditemukan." });
    res.json({ data: result.rows[0] });
  } catch (err) {
    logger.error({ err }, "[ReconClassification] PATCH /keywords/:id error:");
    res.status(500).json({ error: "Gagal memperbarui keyword." });
  }
});

reconClassificationRouter.delete("/keywords/:id", async (req, res) => {
  try {
    await ensureTables();
    const id = parseInt(req.params["id"] ?? "", 10);
    if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid." });
    await db.execute(sql.raw(`UPDATE recon_keyword_dictionary SET is_active = FALSE WHERE id = ${id}`));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[ReconClassification] DELETE /keywords/:id error:");
    res.status(500).json({ error: "Gagal menghapus keyword." });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// APPROVAL RULES
// ═══════════════════════════════════════════════════════════════════════════════

reconClassificationRouter.get("/approval-rules", async (req, res) => {
  try {
    await ensureTables();
    const companyId = parseCompanyId(req.query["company_id"]);
    const includeInactive = req.query["include_inactive"] === "true";

    let where = `WHERE 1=1`;
    if (!includeInactive) where += ` AND ar.is_active = TRUE`;
    if (companyId != null) where += ` AND (ar.company_id = ${companyId} OR ar.company_id IS NULL)`;

    const rows = await db.execute(sql.raw(`
      SELECT ar.*, c.name AS config_name, c.category AS config_category
      FROM recon_approval_rules_config ar
      LEFT JOIN recon_classification_configs c ON c.id = ar.config_id
      ${where}
      ORDER BY ar.approval_level, ar.id
    `));
    res.json({ data: rows.rows });
  } catch (err) {
    logger.error({ err }, "[ReconClassification] GET /approval-rules error:");
    res.status(500).json({ error: "Gagal mengambil approval rules." });
  }
});

reconClassificationRouter.post("/approval-rules", async (req, res) => {
  try {
    await ensureTables();
    const parsed = ApprovalRuleSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validasi gagal.", details: parsed.error.issues });
    const d = parsed.data;
    const userId = (req as any).user?.id ?? null;

    const result = await db.execute(sql.raw(`
      INSERT INTO recon_approval_rules_config
        (company_id, config_id, name, min_amount, max_amount, required_approver_role, approval_level, created_by)
      VALUES (
        ${d.company_id ?? "NULL"},
        ${d.config_id ?? "NULL"},
        '${d.name.replace(/'/g, "''")}',
        ${d.min_amount ?? "NULL"},
        ${d.max_amount ?? "NULL"},
        ${d.required_approver_role ? `'${d.required_approver_role.replace(/'/g, "''")}'` : "NULL"},
        ${d.approval_level},
        ${userId ? `'${userId}'` : "NULL"}
      )
      RETURNING *
    `));
    res.status(201).json({ data: result.rows[0] });
  } catch (err) {
    logger.error({ err }, "[ReconClassification] POST /approval-rules error:");
    res.status(500).json({ error: "Gagal membuat approval rule." });
  }
});

reconClassificationRouter.patch("/approval-rules/:id", async (req, res) => {
  try {
    await ensureTables();
    const id = parseInt(req.params["id"] ?? "", 10);
    if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid." });

    const parsed = ApprovalRuleSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: "Validasi gagal.", details: parsed.error.issues });
    const d = parsed.data;

    const setClauses: string[] = [`updated_at = NOW()`];
    if (d.name !== undefined)                   setClauses.push(`name = '${d.name.replace(/'/g, "''")}'`);
    if (d.min_amount !== undefined)             setClauses.push(`min_amount = ${d.min_amount ?? "NULL"}`);
    if (d.max_amount !== undefined)             setClauses.push(`max_amount = ${d.max_amount ?? "NULL"}`);
    if (d.required_approver_role !== undefined) setClauses.push(`required_approver_role = ${d.required_approver_role ? `'${d.required_approver_role.replace(/'/g, "''")}'` : "NULL"}`);
    if (d.approval_level !== undefined)         setClauses.push(`approval_level = ${d.approval_level}`);
    if (d.config_id !== undefined)              setClauses.push(`config_id = ${d.config_id ?? "NULL"}`);

    const result = await db.execute(sql.raw(
      `UPDATE recon_approval_rules_config SET ${setClauses.join(", ")} WHERE id = ${id} RETURNING *`
    ));
    if (!result.rows[0]) return res.status(404).json({ error: "Approval rule tidak ditemukan." });
    res.json({ data: result.rows[0] });
  } catch (err) {
    logger.error({ err }, "[ReconClassification] PATCH /approval-rules/:id error:");
    res.status(500).json({ error: "Gagal memperbarui approval rule." });
  }
});

reconClassificationRouter.delete("/approval-rules/:id", async (req, res) => {
  try {
    await ensureTables();
    const id = parseInt(req.params["id"] ?? "", 10);
    if (isNaN(id)) return res.status(400).json({ error: "ID tidak valid." });
    await db.execute(sql.raw(`UPDATE recon_approval_rules_config SET is_active = FALSE WHERE id = ${id}`));
    res.json({ ok: true });
  } catch (err) {
    logger.error({ err }, "[ReconClassification] DELETE /approval-rules/:id error:");
    res.status(500).json({ error: "Gagal menghapus approval rule." });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// USAGE STATISTICS DASHBOARD
// GET /api/recon-classification/usage-stats
//
// Returns aggregate usage data for the recon config dashboard.
// - company_scoped (optional company_id query param)
// - No unbounded queries — all use LIMIT
// - No N+1 — all aggregates from single queries
// ═══════════════════════════════════════════════════════════════════════════════

reconClassificationRouter.get("/usage-stats", async (req, res) => {
  try {
    await ensureTables();
    const companyId = parseCompanyId(req.query["company_id"]);
    const limit     = Math.min(parseInt(String(req.query["limit"] ?? "10"), 10) || 10, 100);

    const companyFilter = companyId != null
      ? `AND (company_id = ${companyId} OR company_id IS NULL)`
      : "";

    // ── Summary ───────────────────────────────────────────────────────────────
    const summaryRow = await db.execute(sql.raw(`
      SELECT
        COALESCE(SUM(usage_count), 0) AS total_usage,
        COUNT(*) FILTER (WHERE is_active = TRUE) AS active_categories,
        COUNT(*) FILTER (WHERE is_active = TRUE AND usage_count = 0) AS never_used_categories
      FROM recon_classification_configs
      WHERE 1=1 ${companyFilter}
    `));

    const todayFilter   = `AND DATE(e.used_at) = CURRENT_DATE`;
    const monthFilter   = `AND DATE_TRUNC('month', e.used_at) = DATE_TRUNC('month', NOW())`;

    const todayRow = await db.execute(sql.raw(`
      SELECT COUNT(*) AS cnt FROM recon_config_usage_events e
      WHERE e.usage_type = 'config' ${companyId != null ? `AND (e.company_id = ${companyId} OR e.company_id IS NULL)` : ""} ${todayFilter}
    `)).catch(() => ({ rows: [{ cnt: 0 }] }));

    const monthRow = await db.execute(sql.raw(`
      SELECT COUNT(*) AS cnt FROM recon_config_usage_events e
      WHERE e.usage_type = 'config' ${companyId != null ? `AND (e.company_id = ${companyId} OR e.company_id IS NULL)` : ""} ${monthFilter}
    `)).catch(() => ({ rows: [{ cnt: 0 }] }));

    const s = summaryRow.rows[0] as any;
    const summary = {
      totalUsage:          Number(s?.total_usage ?? 0),
      usageToday:          Number((todayRow.rows[0] as any)?.cnt ?? 0),
      usageThisMonth:      Number((monthRow.rows[0] as any)?.cnt ?? 0),
      activeCategories:    Number(s?.active_categories ?? 0),
      neverUsedCategories: Number(s?.never_used_categories ?? 0),
    };

    // ── Most used categories ──────────────────────────────────────────────────
    const mostUsed = await db.execute(sql.raw(`
      SELECT id, name, code, category, flow, usage_count, last_used_at, last_used_by
      FROM recon_classification_configs
      WHERE is_active = TRUE AND usage_count > 0 ${companyFilter}
      ORDER BY usage_count DESC, last_used_at DESC NULLS LAST
      LIMIT ${limit}
    `));

    // ── Least used (active, non-zero) ─────────────────────────────────────────
    const leastUsed = await db.execute(sql.raw(`
      SELECT id, name, code, category, flow, usage_count, last_used_at
      FROM recon_classification_configs
      WHERE is_active = TRUE AND usage_count > 0 ${companyFilter}
      ORDER BY usage_count ASC, last_used_at ASC NULLS FIRST
      LIMIT ${limit}
    `));

    // ── Never used ────────────────────────────────────────────────────────────
    const neverUsed = await db.execute(sql.raw(`
      SELECT id, name, code, category, flow
      FROM recon_classification_configs
      WHERE is_active = TRUE AND usage_count = 0 ${companyFilter}
      ORDER BY category, priority, name
      LIMIT ${limit}
    `));

    // ── Top AI rules ──────────────────────────────────────────────────────────
    const topRules = await db.execute(sql.raw(`
      SELECT id, name, condition_field, condition_operator, condition_value,
             usage_count, accepted_count, rejected_count, last_used_at
      FROM recon_ai_classification_rules
      WHERE is_active = TRUE AND usage_count > 0 ${companyFilter}
      ORDER BY usage_count DESC, accepted_count DESC
      LIMIT ${limit}
    `));

    // ── Top keywords ──────────────────────────────────────────────────────────
    const topKeywords = await db.execute(sql.raw(`
      SELECT k.id, k.term, k.weight, k.usage_count, k.last_used_at, c.name AS config_name
      FROM recon_keyword_dictionary k
      LEFT JOIN recon_classification_configs c ON c.id = k.config_id
      WHERE k.is_active = TRUE AND k.usage_count > 0 ${companyFilter.replace(/company_id/g, "k.company_id")}
      ORDER BY k.usage_count DESC, k.last_used_at DESC NULLS LAST
      LIMIT ${limit}
    `));

    // ── Recent usage events ───────────────────────────────────────────────────
    const recentUsage = await db.execute(sql.raw(`
      SELECT e.id, e.usage_type, e.target_id, e.mutation_id, e.event_type,
             e.actor_user_id, e.amount, e.used_at,
             c.name AS config_name, c.code AS config_code
      FROM recon_config_usage_events e
      LEFT JOIN recon_classification_configs c ON c.id = e.target_id AND e.usage_type = 'config'
      WHERE 1=1 ${companyId != null ? `AND (e.company_id = ${companyId} OR e.company_id IS NULL)` : ""}
      ORDER BY e.used_at DESC
      LIMIT ${limit}
    `)).catch(() => ({ rows: [] }));

    res.json({
      summary,
      mostUsedCategories: mostUsed.rows,
      leastUsedCategories: leastUsed.rows,
      neverUsedCategories: neverUsed.rows,
      topRules: topRules.rows,
      topKeywords: topKeywords.rows,
      recentUsage: recentUsage.rows,
    });
  } catch (err) {
    logger.error({ err }, "[ReconClassification] GET /usage-stats error:");
    res.status(500).json({ error: "Gagal mengambil statistik penggunaan." });
  }
});
