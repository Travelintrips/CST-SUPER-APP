/**
 * Phase 3 — Expense Rule Engine: CRUD + Simulate API
 *
 * Routes (all under /api/expense-rules):
 *   GET    /             — list active rules (company-scoped + global)
 *   GET    /built-in     — list built-in seed rules (read-only)
 *   POST   /             — create a new rule
 *   PUT    /:id          — update an existing rule
 *   DELETE /:id          — soft-delete (set is_active = false)
 *   POST   /simulate     — evaluate rules against a description (no DB write)
 *
 * Auth: requireAdmin
 * Mutation endpoints do NOT post journals or create expenses.
 */

import { Router } from "express";
import { z } from "zod/v4";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../lib/requireAdmin.js";
import { logger } from "../lib/logger.js";
import { runExpenseRuleMigration } from "../lib/expenseRuleMigration.js";
import { BUILT_IN_RULES, runRuleEngine, mergeRules, validateRule } from "../lib/expenseRuleEngine.js";
import { normalizeDescription } from "../lib/bankDescriptionNormalizer.js";
import type { ExpenseRule } from "../lib/expenseRuleEngine.js";

export const expenseRulesRouter = Router();

// ─── Auth ─────────────────────────────────────────────────────────────────────
expenseRulesRouter.use(async (req, res, next) => {
  if (!(await requireAdmin(req, res))) return;
  next();
});

// ─── Lazy migration ────────────────────────────────────────────────────────────
// NOTE: ensureMigrated is set only AFTER the migration succeeds so that a
// transient DB failure allows the next request to retry (rather than silently
// serving a broken state forever).
let ensureMigrated = false;
async function ensureTable() {
  if (ensureMigrated) return;
  await runExpenseRuleMigration(); // throws on real failure → caller sees 500
  ensureMigrated = true;           // only reached if migration succeeded
}

// ─── Input schemas ─────────────────────────────────────────────────────────────

const ConditionSchema = z.object({
  field:    z.string(),
  operator: z.string(),
  value:    z.string(),
});

const ActionSchema = z.object({
  suggestedCategory:      z.string().optional(),
  suggestedAccountType:   z.string().optional(),
  suggestedAccountSubtype: z.string().optional(),
  isInternalTransfer:     z.boolean().optional(),
  metadata:               z.record(z.string(), z.string()).optional(),
  notes:                  z.string().optional(),
  confidence:             z.number().min(0).max(100).optional(),
});

const UpsertRuleSchema = z.object({
  name:       z.string().min(1).max(120),
  priority:   z.number().int().min(1).max(999).default(50),
  conditions: z.array(ConditionSchema).min(1),
  action:     ActionSchema,
  companyId:  z.number().int().optional().nullable(),
  isActive:   z.boolean().optional().default(true),
});

const SimulateSchema = z.object({
  description: z.string().min(1, "description wajib diisi"),
  amount:      z.number().optional(),
  direction:   z.enum(["IN", "OUT"]).optional(),
  companyId:   z.number().int().optional().nullable(),
});

// ─── Row mapper ────────────────────────────────────────────────────────────────

function rowToRule(r: Record<string, unknown>): ExpenseRule {
  return {
    id:         Number(r["id"]),
    companyId:  r["company_id"] != null ? Number(r["company_id"]) : null,
    name:       String(r["name"] ?? ""),
    priority:   Number(r["priority"] ?? 50),
    conditions: Array.isArray(r["conditions"]) ? r["conditions"] : JSON.parse(String(r["conditions"] ?? "[]")),
    action:     typeof r["action"] === "object" && r["action"] !== null ? r["action"] as ExpenseRule["action"] : JSON.parse(String(r["action"] ?? "{}")),
    isActive:   Boolean(r["is_active"]),
    createdAt:  r["created_at"] ? String(r["created_at"]) : undefined,
    updatedAt:  r["updated_at"] ? String(r["updated_at"]) : undefined,
  };
}

// ─── GET /api/expense-rules ────────────────────────────────────────────────────
/**
 * List expense rules visible to the given company.
 * Query params: company_id (int | "global"), include_inactive (bool)
 *
 * Response:
 *   { rules: ExpenseRule[], total: number }
 */
expenseRulesRouter.get("/", async (req, res) => {
  await ensureTable();
  try {
    const companyId      = req.query["company_id"] ? Number(req.query["company_id"]) : null;
    const includeInactive = req.query["include_inactive"] === "true";

    const activeFilter  = includeInactive ? "" : "AND er.is_active = TRUE";
    const companyFilter = companyId
      ? `AND (er.company_id IS NULL OR er.company_id = ${companyId})`
      : "AND er.company_id IS NULL";

    const { rows } = await db.execute(sql.raw(`
      SELECT er.*
      FROM expense_rules er
      WHERE 1=1
        ${activeFilter}
        ${companyFilter}
      ORDER BY er.priority ASC, er.id ASC
    `));

    const rules = (rows as Record<string, unknown>[]).map(rowToRule);
    return res.json({ rules, total: rules.length });
  } catch (err) {
    logger.error({ err }, "[GET /expense-rules] failed");
    return res.status(500).json({ error: "Gagal memuat daftar rule" });
  }
});

// ─── GET /api/expense-rules/built-in ─────────────────────────────────────────
/**
 * Return built-in seed rules (read-only, no DB needed).
 *
 * Response:
 *   { rules: ExpenseRule[], total: number }
 */
expenseRulesRouter.get("/built-in", (_req, res) => {
  return res.json({ rules: BUILT_IN_RULES, total: BUILT_IN_RULES.length });
});

// ─── POST /api/expense-rules/simulate ─────────────────────────────────────────
/**
 * Evaluate rules against a description without any DB write.
 *
 * Request body:
 *   { description, amount?, direction?, companyId? }
 *
 * Response:
 *   {
 *     input: { description, amount, direction },
 *     normalization: NormalizationResult,
 *     ruleMatch: { matched, matchedRule?, action? } | null,
 *     evaluated: RuleEvalDetail[]
 *   }
 */
expenseRulesRouter.post("/simulate", async (req, res) => {
  await ensureTable();
  try {
    const parsed = SimulateSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Input tidak valid",
        details: parsed.error.issues.map(i => ({ field: i.path.join("."), message: i.message })),
      });
    }

    const { description, amount, direction, companyId } = parsed.data;

    // 1. Normalize description
    const normalization = normalizeDescription(description);

    // 2. Fetch DB rules for this company
    let dbRules: ExpenseRule[] = [];
    try {
      const companyFilter = companyId
        ? `AND (er.company_id IS NULL OR er.company_id = ${companyId})`
        : "AND er.company_id IS NULL";

      const { rows } = await db.execute(sql.raw(`
        SELECT er.*
        FROM expense_rules er
        WHERE er.is_active = TRUE ${companyFilter}
        ORDER BY er.priority ASC, er.id ASC
      `));
      dbRules = (rows as Record<string, unknown>[]).map(rowToRule);
    } catch {
      // DB not available — fall through to built-ins only
    }

    // 3. Merge DB + built-in rules
    const merged = mergeRules(dbRules, companyId ?? null);

    // 4. Run engine
    const engineResult = runRuleEngine(merged, normalization, { direction });

    return res.json({
      input:         { description, amount, direction, companyId },
      normalization,
      ruleMatch:     engineResult.matched
        ? { matched: true, matchedRule: engineResult.matchedRule, action: engineResult.action }
        : { matched: false },
      evaluated:     engineResult.evaluated,
    });
  } catch (err) {
    logger.error({ err }, "[POST /expense-rules/simulate] failed");
    return res.status(500).json({ error: "Gagal menjalankan simulasi rule" });
  }
});

// ─── POST /api/expense-rules ──────────────────────────────────────────────────
/**
 * Create a new expense rule.
 *
 * Request body: UpsertRuleSchema
 * Response: { rule: ExpenseRule }
 */
expenseRulesRouter.post("/", async (req, res) => {
  await ensureTable();
  try {
    const parsed = UpsertRuleSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Input tidak valid",
        details: parsed.error.issues.map(i => ({ field: i.path.join("."), message: i.message })),
      });
    }

    const { name, priority, conditions, action, companyId, isActive } = parsed.data;

    // Extra semantic validation
    const validationErrors = validateRule({ name, priority, conditions, action });
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: "Validasi rule gagal", details: validationErrors });
    }

    const actor          = (req as any).user?.email ?? "system";
    const conditionsJson = JSON.stringify(conditions).replace(/'/g, "''");
    const actionJson     = JSON.stringify(action).replace(/'/g, "''");
    const nameSafe       = name.replace(/'/g, "''");
    const actorSafe      = actor.replace(/'/g, "''");

    // Check for duplicate name in same company scope
    const companyScope   = companyId != null ? String(companyId) : "NULL";
    const companyCheck   = companyId != null
      ? `company_id = ${companyId}`
      : `company_id IS NULL`;

    const { rows: existing } = await db.execute(sql.raw(`
      SELECT id FROM expense_rules
      WHERE LOWER(name) = LOWER('${nameSafe}') AND ${companyCheck}
      LIMIT 1
    `));

    if (existing.length > 0) {
      return res.status(409).json({ error: `Rule dengan nama "${name}" sudah ada dalam scope yang sama` });
    }

    const { rows: inserted } = await db.execute(sql.raw(`
      INSERT INTO expense_rules
        (company_id, name, priority, conditions, action, is_active, created_by, updated_by)
      VALUES
        (${companyId != null ? companyId : "NULL"},
         '${nameSafe}', ${priority},
         '${conditionsJson}'::jsonb,
         '${actionJson}'::jsonb,
         ${isActive}, '${actorSafe}', '${actorSafe}')
      RETURNING *
    `));

    if (!inserted.length) {
      return res.status(500).json({ error: "Gagal menyimpan rule" });
    }

    const rule = rowToRule(inserted[0] as Record<string, unknown>);
    logger.info({ ruleId: rule.id, name: rule.name, actor }, "[expense-rules] rule created");
    return res.status(201).json({ rule });
  } catch (err) {
    logger.error({ err }, "[POST /expense-rules] failed");
    return res.status(500).json({ error: "Gagal membuat rule" });
  }
});

// ─── PUT /api/expense-rules/:id ───────────────────────────────────────────────
/**
 * Update an existing expense rule.
 *
 * Request body: UpsertRuleSchema (partial OK)
 * Response: { rule: ExpenseRule }
 */
expenseRulesRouter.put("/:id", async (req, res) => {
  await ensureTable();
  try {
    const id = Number(req.params["id"]);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "ID tidak valid" });
    }

    // Fetch existing
    const { rows: existing } = await db.execute(sql.raw(
      `SELECT * FROM expense_rules WHERE id = ${id} LIMIT 1`,
    ));
    if (!existing.length) {
      return res.status(404).json({ error: `Rule id=${id} tidak ditemukan` });
    }

    const current = rowToRule(existing[0] as Record<string, unknown>);

    const parsed = UpsertRuleSchema.partial().safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({
        error: "Input tidak valid",
        details: parsed.error.issues.map(i => ({ field: i.path.join("."), message: i.message })),
      });
    }

    const updates = parsed.data;
    const merged = {
      name:       updates.name       ?? current.name,
      priority:   updates.priority   ?? current.priority,
      conditions: updates.conditions ?? current.conditions,
      action:     updates.action     ?? current.action,
      isActive:   updates.isActive   ?? current.isActive,
    };

    const validationErrors = validateRule(merged);
    if (validationErrors.length > 0) {
      return res.status(400).json({ error: "Validasi rule gagal", details: validationErrors });
    }

    const actor          = (req as any).user?.email ?? "system";
    const conditionsJson = JSON.stringify(merged.conditions).replace(/'/g, "''");
    const actionJson     = JSON.stringify(merged.action).replace(/'/g, "''");
    const nameSafe       = merged.name.replace(/'/g, "''");
    const actorSafe      = actor.replace(/'/g, "''");

    const { rows: updated } = await db.execute(sql.raw(`
      UPDATE expense_rules
      SET name       = '${nameSafe}',
          priority   = ${merged.priority},
          conditions = '${conditionsJson}'::jsonb,
          action     = '${actionJson}'::jsonb,
          is_active  = ${merged.isActive},
          updated_by = '${actorSafe}',
          updated_at = NOW()
      WHERE id = ${id}
      RETURNING *
    `));

    const rule = rowToRule(updated[0] as Record<string, unknown>);
    logger.info({ ruleId: rule.id, name: rule.name, actor }, "[expense-rules] rule updated");
    return res.json({ rule });
  } catch (err) {
    logger.error({ err }, "[PUT /expense-rules/:id] failed");
    return res.status(500).json({ error: "Gagal mengupdate rule" });
  }
});

// ─── DELETE /api/expense-rules/:id ───────────────────────────────────────────
/**
 * Soft-delete a rule (sets is_active = false).
 * Built-in rules (negative id) cannot be deleted via API.
 *
 * Response: { ok: true, id: number }
 */
expenseRulesRouter.delete("/:id", async (req, res) => {
  await ensureTable();
  try {
    const id = Number(req.params["id"]);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ error: "ID tidak valid" });
    }

    const actor     = (req as any).user?.email ?? "system";
    const actorSafe = actor.replace(/'/g, "''");

    const { rows } = await db.execute(sql.raw(`
      UPDATE expense_rules
      SET is_active = FALSE, updated_by = '${actorSafe}', updated_at = NOW()
      WHERE id = ${id}
      RETURNING id
    `));

    if (!rows.length) {
      return res.status(404).json({ error: `Rule id=${id} tidak ditemukan` });
    }

    logger.info({ ruleId: id, actor }, "[expense-rules] rule soft-deleted");
    return res.json({ ok: true, id });
  } catch (err) {
    logger.error({ err }, "[DELETE /expense-rules/:id] failed");
    return res.status(500).json({ error: "Gagal menonaktifkan rule" });
  }
});
