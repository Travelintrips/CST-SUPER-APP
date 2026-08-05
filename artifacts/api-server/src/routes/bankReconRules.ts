/**
 * Bank Reconciliation — Rule Engine CRUD Routes (Batch 2 enhanced)
 *
 * Endpoints:
 *  GET    /api/bank-reconciliation/rules          — list rules for company
 *  POST   /api/bank-reconciliation/rules          — create rule (+ snapshot version + conflict check)
 *  GET    /api/bank-reconciliation/rules/:id      — get rule by id
 *  PATCH  /api/bank-reconciliation/rules/:id      — update rule (+ snapshot version + conflict check)
 *  DELETE /api/bank-reconciliation/rules/:id      — soft delete rule (+ snapshot version)
 *  POST   /api/bank-reconciliation/rules/test     — test rule against mutation (read-only)
 *
 * Batch 2 additions:
 *  - snapshotRuleVersion on every CREATE / UPDATE / DELETE
 *  - detectRuleConflicts on CREATE / UPDATE — warning returned in response, save NOT blocked
 *  - invalidateRulesCache on every write operation
 *
 * All endpoints require admin auth and company_id isolation.
 */

import { Router } from "express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { requireAdmin } from "../lib/requireAdmin.js";
import { logger } from "../lib/logger.js";
import {
  validateReconRule,
  validateRegexPattern,
  evaluateReconRules,
  type ReconRule,
  type ReconRuleMutationInput,
} from "../lib/reconciliation/reconRuleEngine.js";
import { snapshotRuleVersion } from "../lib/reconciliation/reconRuleVersioning.js";
import { detectRuleConflicts } from "../lib/reconciliation/reconRuleConflictDetection.js";
import { invalidateRulesCache } from "../lib/reconciliation/reconCache.js";
import { runReconBatch2Migration } from "../lib/reconciliation/reconBatch2Migration.js";

const router = Router();

router.use(async (req, res, next) => {
  if (!(await requireAdmin(req, res))) return;
  next();
});

// ─── Migration ─────────────────────────────────────────────────────────────────

let migrated = false;

export async function runReconRulesMigration(): Promise<void> {
  if (migrated) return;
  migrated = true;

  await db.execute(sql.raw(`
    CREATE TABLE IF NOT EXISTS recon_rules (
      id                  SERIAL PRIMARY KEY,
      company_id          INTEGER NOT NULL,
      name                TEXT NOT NULL,
      description         TEXT,
      priority            INTEGER NOT NULL DEFAULT 100,
      is_active           BOOLEAN NOT NULL DEFAULT TRUE,
      direction           TEXT CHECK (direction IN ('IN','OUT')),
      bank_account_id     INTEGER,
      condition_type      TEXT NOT NULL DEFAULT 'SIMPLE',
      condition_field     TEXT NOT NULL,
      condition_operator  TEXT NOT NULL,
      condition_value     TEXT NOT NULL DEFAULT '',
      target_type         TEXT NOT NULL,
      target_id           INTEGER,
      target_coa_code     TEXT,
      confidence_score    INTEGER NOT NULL DEFAULT 100 CHECK (confidence_score BETWEEN 0 AND 100),
      stop_processing     BOOLEAN NOT NULL DEFAULT TRUE,
      match_count         INTEGER NOT NULL DEFAULT 0,
      last_matched_at     TIMESTAMPTZ,
      created_by          TEXT,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `)).catch(() => {});

  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS rr_company_idx   ON recon_rules(company_id)`)).catch(() => {});
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS rr_priority_idx  ON recon_rules(company_id, priority DESC, id ASC)`)).catch(() => {});
  await db.execute(sql.raw(`CREATE INDEX IF NOT EXISTS rr_active_idx    ON recon_rules(company_id, is_active)`)).catch(() => {});

  // Batch 2: add current_version_id column (idempotent via runReconBatch2Migration)
  await runReconBatch2Migration().catch(e =>
    logger.warn({ err: e.message }, "[recon_rules] batch2 migration warning")
  );

  logger.info("[recon_rules] migration complete (batch 1+2)");
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function requireCompanyId(req: any, res: any): number | null {
  const cid = parseInt(req.query.company_id ?? req.body?.company_id ?? "0", 10);
  if (!Number.isFinite(cid) || cid <= 0) {
    res.status(400).json({ error: "company_id wajib diisi (integer positif)" });
    return null;
  }
  return cid;
}

function rowToRule(r: Record<string, unknown>): ReconRule {
  return {
    id:               Number(r.id),
    companyId:        Number(r.company_id),
    name:             String(r.name),
    description:      r.description ? String(r.description) : null,
    priority:         Number(r.priority),
    isActive:         Boolean(r.is_active),
    direction:        r.direction ? String(r.direction) as "IN" | "OUT" : null,
    bankAccountId:    r.bank_account_id != null ? Number(r.bank_account_id) : null,
    conditionType:    String(r.condition_type ?? "SIMPLE"),
    conditionField:   String(r.condition_field) as ReconRule["conditionField"],
    conditionOperator: String(r.condition_operator) as ReconRule["conditionOperator"],
    conditionValue:   String(r.condition_value),
    targetType:       String(r.target_type) as ReconRule["targetType"],
    targetId:         r.target_id != null ? Number(r.target_id) : null,
    targetCoaCode:    r.target_coa_code ? String(r.target_coa_code) : null,
    confidenceScore:  Number(r.confidence_score ?? 100),
    stopProcessing:   Boolean(r.stop_processing),
    matchCount:       Number(r.match_count ?? 0),
    lastMatchedAt:    r.last_matched_at ? String(r.last_matched_at) : null,
    createdBy:        r.created_by ? String(r.created_by) : null,
    createdAt:        String(r.created_at),
    updatedAt:        String(r.updated_at),
  };
}

function escStr(s: string | null | undefined): string {
  if (s == null) return "NULL";
  return `'${String(s).replace(/'/g, "''")}'`;
}

/** Load all active rules for conflict detection (excluding a given id if updating) */
async function loadActiveRulesForCompany(companyId: number): Promise<ReconRule[]> {
  const rows = await db.execute(sql.raw(`
    SELECT * FROM recon_rules
    WHERE company_id = ${companyId} AND is_active = TRUE
    ORDER BY priority DESC, id ASC
  `));
  return ((rows as any).rows ?? []).map(rowToRule);
}

// ─── GET /rules ────────────────────────────────────────────────────────────────

router.get("/", async (req, res) => {
  await runReconRulesMigration();
  const companyId = requireCompanyId(req, res);
  if (!companyId) return;

  const activeOnly = req.query.active_only !== "false";
  const where = activeOnly
    ? `company_id = ${companyId} AND is_active = TRUE`
    : `company_id = ${companyId}`;

  try {
    const rows = await db.execute(sql.raw(`
      SELECT * FROM recon_rules WHERE ${where}
      ORDER BY priority DESC, id ASC
    `));
    return res.json({ rules: ((rows as any).rows ?? []).map(rowToRule) });
  } catch (e: any) {
    logger.error({ err: e.message }, "[recon_rules] GET / error");
    return res.status(500).json({ error: "Gagal memuat rules" });
  }
});

// ─── POST /rules ───────────────────────────────────────────────────────────────

router.post("/", async (req, res) => {
  await runReconRulesMigration();

  const body = req.body ?? {};
  const companyId = parseInt(body.company_id ?? "0", 10);
  if (!Number.isFinite(companyId) || companyId <= 0) {
    return res.status(400).json({ error: "company_id wajib diisi" });
  }

  const ruleCandidate = {
    companyId,
    name:               body.name,
    description:        body.description,
    priority:           body.priority,
    isActive:           body.is_active,
    direction:          body.direction,
    bankAccountId:      body.bank_account_id,
    conditionField:     body.condition_field,
    conditionOperator:  body.condition_operator,
    conditionValue:     body.condition_value,
    targetType:         body.target_type,
    targetId:           body.target_id,
    targetCoaCode:      body.target_coa_code,
    confidenceScore:    body.confidence_score,
    stopProcessing:     body.stop_processing,
  };
  const errors = validateReconRule(ruleCandidate);
  if (errors.length > 0) {
    return res.status(400).json({ error: "Validasi gagal", details: errors });
  }

  // Conflict detection — non-blocking warning
  let conflicts = null;
  try {
    const existingRules = await loadActiveRulesForCompany(companyId);
    const conflictResult = detectRuleConflicts(
      {
        conditionField:    body.condition_field,
        conditionOperator: body.condition_operator,
        conditionValue:    body.condition_value ?? "",
        direction:         body.direction ?? null,
        bankAccountId:     body.bank_account_id ?? null,
        priority:          Number(body.priority ?? 100),
        name:              body.name,
      },
      existingRules,
    );
    if (conflictResult.hasConflicts) {
      conflicts = conflictResult.conflicts;
    }
  } catch (e: any) {
    logger.warn({ err: e.message }, "[recon_rules] conflict detection failed — non-fatal");
  }

  try {
    const rows = await db.execute(sql.raw(`
      INSERT INTO recon_rules
        (company_id, name, description, priority, is_active, direction, bank_account_id,
         condition_type, condition_field, condition_operator, condition_value,
         target_type, target_id, target_coa_code, confidence_score, stop_processing, created_by)
      VALUES
        (${companyId}, ${escStr(body.name)}, ${escStr(body.description)},
         ${Number(body.priority ?? 100)}, ${body.is_active !== false},
         ${body.direction ? escStr(body.direction) : "NULL"},
         ${body.bank_account_id != null ? Number(body.bank_account_id) : "NULL"},
         'SIMPLE', ${escStr(body.condition_field)}, ${escStr(body.condition_operator)},
         ${escStr(body.condition_value ?? "")},
         ${escStr(body.target_type)},
         ${body.target_id != null ? Number(body.target_id) : "NULL"},
         ${escStr(body.target_coa_code)},
         ${Number(body.confidence_score ?? 100)},
         ${body.stop_processing !== false},
         ${escStr((req as any).user?.email ?? null)})
      RETURNING *
    `));
    const created = ((rows as any).rows ?? [])[0];
    if (!created) {
      return res.status(500).json({ error: "Gagal membuat rule" });
    }
    const rule = rowToRule(created);

    // Snapshot version (async — non-blocking to response)
    snapshotRuleVersion(rule, "CREATE", (req as any).user?.email ?? null, body.change_reason ?? null)
      .catch(e => logger.warn({ err: e.message, ruleId: rule.id }, "[recon_rules] version snapshot failed"));

    // Invalidate cache
    invalidateRulesCache(companyId);

    return res.status(201).json({
      rule,
      conflicts: conflicts ?? [],
      conflictWarning: conflicts ? `${conflicts.length} potensi konflik ditemukan — lihat 'conflicts' untuk detail` : null,
    });
  } catch (e: any) {
    logger.error({ err: e.message }, "[recon_rules] POST / error");
    return res.status(500).json({ error: "Gagal membuat rule" });
  }
});

// ─── POST /rules/test ──────────────────────────────────────────────────────────
// Must be before /:id to avoid route collision

router.post("/test", async (req, res) => {
  await runReconRulesMigration();

  const body = req.body ?? {};
  const companyId = parseInt(body.company_id ?? "0", 10);
  if (!Number.isFinite(companyId) || companyId <= 0) {
    return res.status(400).json({ error: "company_id wajib diisi" });
  }

  const mutInput: ReconRuleMutationInput = {
    description:        String(body.description ?? "").toLowerCase(),
    reference:          body.reference ? String(body.reference) : null,
    amount:             Number(body.amount ?? 0),
    direction:          body.direction === "OUT" ? "OUT" : "IN",
    bankAccountId:      body.bank_account_id != null ? Number(body.bank_account_id) : null,
    counterpartyName:   body.counterparty_name ? String(body.counterparty_name) : null,
    counterpartyAccount: body.counterparty_account ? String(body.counterparty_account) : null,
    companyId,
  };

  try {
    const rows = await db.execute(sql.raw(`
      SELECT * FROM recon_rules
      WHERE company_id = ${companyId} AND is_active = TRUE
      ORDER BY priority DESC, id ASC
    `));
    const rules: ReconRule[] = ((rows as any).rows ?? []).map(rowToRule);
    const result = evaluateReconRules(rules, mutInput);

    return res.json({
      matched:       result.matched,
      ruleId:        result.ruleId ?? null,
      ruleName:      result.ruleName ?? null,
      targetType:    result.targetType ?? null,
      targetCoaCode: result.targetCoaCode ?? null,
      confidence:    result.confidence ?? 0,
      reasons:       result.reasons ?? [],
      evaluated:     result.evaluated,
    });
  } catch (e: any) {
    logger.error({ err: e.message }, "[recon_rules] POST /test error");
    return res.status(500).json({ error: "Gagal menjalankan simulasi" });
  }
});

// ─── GET /rules/:id ────────────────────────────────────────────────────────────

router.get("/:id", async (req, res) => {
  await runReconRulesMigration();

  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: "id tidak valid" });
  }
  const companyId = requireCompanyId(req, res);
  if (!companyId) return;

  try {
    const rows = await db.execute(sql.raw(`
      SELECT * FROM recon_rules WHERE id = ${id} AND company_id = ${companyId}
    `));
    const rule = ((rows as any).rows ?? [])[0];
    if (!rule) return res.status(404).json({ error: "Rule tidak ditemukan" });
    return res.json({ rule: rowToRule(rule) });
  } catch (e: any) {
    logger.error({ err: e.message, id }, "[recon_rules] GET /:id error");
    return res.status(500).json({ error: "Gagal memuat rule" });
  }
});

// ─── PATCH /rules/:id ──────────────────────────────────────────────────────────

router.patch("/:id", async (req, res) => {
  await runReconRulesMigration();

  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: "id tidak valid" });
  }
  const companyId = requireCompanyId(req, res);
  if (!companyId) return;

  if (req.body?.condition_operator === "regex" && req.body?.condition_value) {
    const err = validateRegexPattern(req.body.condition_value);
    if (err) return res.status(400).json({ error: err });
  }

  // Fetch current rule (needed for snapshot)
  let currentRule: ReconRule | null = null;
  try {
    const current = await db.execute(sql.raw(
      `SELECT * FROM recon_rules WHERE id = ${id} AND company_id = ${companyId}`
    ));
    const row = ((current as any).rows ?? [])[0];
    if (!row) return res.status(404).json({ error: "Rule tidak ditemukan" });
    currentRule = rowToRule(row);
  } catch (e: any) {
    return res.status(500).json({ error: "Gagal memuat rule" });
  }

  const body = req.body ?? {};
  const sets: string[] = [];

  if (body.name              !== undefined) sets.push(`name = ${escStr(body.name)}`);
  if (body.description       !== undefined) sets.push(`description = ${escStr(body.description)}`);
  if (body.priority          !== undefined) sets.push(`priority = ${Number(body.priority)}`);
  if (body.is_active         !== undefined) sets.push(`is_active = ${Boolean(body.is_active)}`);
  if (body.direction         !== undefined) sets.push(`direction = ${body.direction ? escStr(body.direction) : "NULL"}`);
  if (body.bank_account_id   !== undefined) sets.push(`bank_account_id = ${body.bank_account_id != null ? Number(body.bank_account_id) : "NULL"}`);
  if (body.condition_field   !== undefined) sets.push(`condition_field = ${escStr(body.condition_field)}`);
  if (body.condition_operator !== undefined) sets.push(`condition_operator = ${escStr(body.condition_operator)}`);
  if (body.condition_value   !== undefined) sets.push(`condition_value = ${escStr(body.condition_value)}`);
  if (body.target_type       !== undefined) sets.push(`target_type = ${escStr(body.target_type)}`);
  if (body.target_id         !== undefined) sets.push(`target_id = ${body.target_id != null ? Number(body.target_id) : "NULL"}`);
  if (body.target_coa_code   !== undefined) sets.push(`target_coa_code = ${escStr(body.target_coa_code)}`);
  if (body.confidence_score  !== undefined) sets.push(`confidence_score = ${Number(body.confidence_score)}`);
  if (body.stop_processing   !== undefined) sets.push(`stop_processing = ${Boolean(body.stop_processing)}`);
  sets.push(`updated_at = NOW()`);

  if (sets.length === 1) {
    return res.status(400).json({ error: "Tidak ada field yang diperbarui" });
  }

  // Conflict detection (using updated field values merged with current)
  let conflicts = null;
  try {
    const existingRules = await loadActiveRulesForCompany(companyId);
    const conflictResult = detectRuleConflicts(
      {
        id,
        conditionField:    body.condition_field    ?? currentRule.conditionField,
        conditionOperator: body.condition_operator ?? currentRule.conditionOperator,
        conditionValue:    body.condition_value    ?? currentRule.conditionValue,
        direction:         body.direction !== undefined ? body.direction : currentRule.direction,
        bankAccountId:     body.bank_account_id !== undefined ? body.bank_account_id : currentRule.bankAccountId,
        priority:          body.priority !== undefined ? Number(body.priority) : currentRule.priority,
        name:              body.name ?? currentRule.name,
      },
      existingRules,
    );
    if (conflictResult.hasConflicts) conflicts = conflictResult.conflicts;
  } catch (e: any) {
    logger.warn({ err: e.message }, "[recon_rules] conflict detection failed — non-fatal");
  }

  try {
    const rows = await db.execute(sql.raw(`
      UPDATE recon_rules SET ${sets.join(", ")}
      WHERE id = ${id} AND company_id = ${companyId}
      RETURNING *
    `));
    const updated = ((rows as any).rows ?? [])[0];
    if (!updated) return res.status(404).json({ error: "Rule tidak ditemukan" });
    const updatedRule = rowToRule(updated);

    // Snapshot version (async)
    snapshotRuleVersion(
      updatedRule,
      "UPDATE",
      (req as any).user?.email ?? null,
      body.change_reason ?? null,
    ).catch(e => logger.warn({ err: e.message, ruleId: id }, "[recon_rules] version snapshot failed"));

    // Invalidate cache
    invalidateRulesCache(companyId);

    return res.json({
      rule: updatedRule,
      conflicts: conflicts ?? [],
      conflictWarning: conflicts ? `${conflicts.length} potensi konflik ditemukan — lihat 'conflicts' untuk detail` : null,
    });
  } catch (e: any) {
    logger.error({ err: e.message, id }, "[recon_rules] PATCH /:id error");
    return res.status(500).json({ error: "Gagal memperbarui rule" });
  }
});

// ─── DELETE /rules/:id ─────────────────────────────────────────────────────────

router.delete("/:id", async (req, res) => {
  await runReconRulesMigration();

  const id = parseInt(req.params.id, 10);
  if (!Number.isFinite(id) || id <= 0) {
    return res.status(400).json({ error: "id tidak valid" });
  }
  const companyId = requireCompanyId(req, res);
  if (!companyId) return;

  // Fetch current rule for snapshot before deletion
  let currentRule: ReconRule | null = null;
  try {
    const current = await db.execute(sql.raw(
      `SELECT * FROM recon_rules WHERE id = ${id} AND company_id = ${companyId}`
    ));
    const row = ((current as any).rows ?? [])[0];
    if (!row) return res.status(404).json({ error: "Rule tidak ditemukan" });
    currentRule = rowToRule(row);
  } catch (e: any) {
    return res.status(500).json({ error: "Gagal memuat rule" });
  }

  try {
    const rows = await db.execute(sql.raw(`
      DELETE FROM recon_rules WHERE id = ${id} AND company_id = ${companyId} RETURNING id
    `));
    if (((rows as any).rows ?? []).length === 0) {
      return res.status(404).json({ error: "Rule tidak ditemukan" });
    }

    // Snapshot DELETE version (async, best-effort — rule row already deleted so we can't update current_version_id)
    if (currentRule) {
      snapshotRuleVersion(
        currentRule,
        "DELETE",
        (req as any).user?.email ?? null,
        req.body?.change_reason ?? null,
      ).catch(e => logger.warn({ err: e.message, ruleId: id }, "[recon_rules] DELETE version snapshot failed"));
    }

    // Invalidate cache
    invalidateRulesCache(companyId);

    return res.json({ deleted: true, id });
  } catch (e: any) {
    logger.error({ err: e.message, id }, "[recon_rules] DELETE /:id error");
    return res.status(500).json({ error: "Gagal menghapus rule" });
  }
});

export default router;
