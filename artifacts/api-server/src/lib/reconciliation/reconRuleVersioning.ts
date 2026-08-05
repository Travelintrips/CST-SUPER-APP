/**
 * Recon Rule Versioning
 *
 * Every CREATE / UPDATE / DELETE on a recon_rule produces an immutable snapshot
 * row in recon_rule_versions. The rule's `current_version_id` column is updated
 * to point to the latest version.
 *
 * Audit matching stores `rule_version_id` (not just rule_id) so historical
 * transactions remain explainable even after the rule is modified.
 *
 * Rule: never overwrite existing version rows.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../logger.js";
import type { ReconRule } from "./reconRuleEngine.js";

// ─── Types ─────────────────────────────────────────────────────────────────────

export type RuleChangeType = "CREATE" | "UPDATE" | "DELETE";

export interface RuleVersion {
  id: number;
  ruleId: number;
  companyId: number;
  versionNumber: number;
  snapshotJson: ReconRule;
  changeType: RuleChangeType;
  changedBy: string | null;
  changeReason: string | null;
  createdAt: string;
}

export interface RuleHistoryEntry {
  version: number;
  actor: string | null;
  timestamp: string;
  reason: string | null;
  changeType: RuleChangeType;
  diff: Array<{
    field: string;
    oldValue: unknown;
    newValue: unknown;
  }>;
  snapshot: ReconRule;
}

// ─── Snapshot ─────────────────────────────────────────────────────────────────

/**
 * Persist a new version snapshot and update the rule's current_version_id.
 * Returns the created version row id.
 */
export async function snapshotRuleVersion(
  rule: ReconRule,
  changeType: RuleChangeType,
  changedBy: string | null,
  changeReason: string | null,
): Promise<number> {
  // Get next version number for this rule
  const countRes = await db.execute(sql.raw(`
    SELECT COALESCE(MAX(version_number), 0) AS max_ver
    FROM recon_rule_versions
    WHERE rule_id = ${rule.id}
  `));
  const maxVer = Number(((countRes as any).rows ?? [])[0]?.max_ver ?? 0);
  const nextVer = maxVer + 1;

  const snapshotEscaped = JSON.stringify(rule).replace(/'/g, "''");
  const changedByEscaped = changedBy ? `'${changedBy.replace(/'/g, "''")}'` : "NULL";
  const reasonEscaped = changeReason ? `'${changeReason.replace(/'/g, "''")}'` : "NULL";

  const insertRes = await db.execute(sql.raw(`
    INSERT INTO recon_rule_versions
      (rule_id, company_id, version_number, snapshot_json, change_type, changed_by, change_reason)
    VALUES
      (${rule.id}, ${rule.companyId}, ${nextVer}, '${snapshotEscaped}'::jsonb, '${changeType}', ${changedByEscaped}, ${reasonEscaped})
    RETURNING id
  `));
  const versionId = Number(((insertRes as any).rows ?? [])[0]?.id);

  // Update rule's current_version_id (only for non-DELETE, but we still track it)
  await db.execute(sql.raw(`
    UPDATE recon_rules
    SET current_version_id = ${versionId}, updated_at = NOW()
    WHERE id = ${rule.id} AND company_id = ${rule.companyId}
  `)).catch(() => {}); // Best-effort; DELETE may have already removed the row

  logger.info(
    { ruleId: rule.id, versionId, versionNumber: nextVer, changeType },
    "[reconRuleVersioning] version snapshot created",
  );

  return versionId;
}

// ─── History retrieval ────────────────────────────────────────────────────────

/**
 * Return chronological version history for a rule.
 * Computes field-level diff between consecutive versions.
 */
export async function getRuleVersionHistory(
  ruleId: number,
  companyId: number,
): Promise<RuleHistoryEntry[]> {
  const res = await db.execute(sql.raw(`
    SELECT id, rule_id, company_id, version_number, snapshot_json,
           change_type, changed_by, change_reason, created_at
    FROM recon_rule_versions
    WHERE rule_id = ${ruleId} AND company_id = ${companyId}
    ORDER BY version_number ASC
  `));

  const rows = ((res as any).rows ?? []) as Array<Record<string, unknown>>;

  const entries: RuleHistoryEntry[] = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const snapshot = (
      typeof row.snapshot_json === "string"
        ? JSON.parse(row.snapshot_json)
        : row.snapshot_json
    ) as ReconRule;

    // Diff against previous version
    const diff: RuleHistoryEntry["diff"] = [];
    if (i > 0) {
      const prev = (
        typeof rows[i - 1].snapshot_json === "string"
          ? JSON.parse(rows[i - 1].snapshot_json as string)
          : rows[i - 1].snapshot_json
      ) as Record<string, unknown>;

      const curr = snapshot as unknown as Record<string, unknown>;
      const diffFields = new Set([...Object.keys(prev), ...Object.keys(curr)]);
      for (const field of diffFields) {
        if (JSON.stringify(prev[field]) !== JSON.stringify(curr[field])) {
          diff.push({ field, oldValue: prev[field], newValue: curr[field] });
        }
      }
    }

    entries.push({
      version: Number(row.version_number),
      actor: row.changed_by ? String(row.changed_by) : null,
      timestamp: String(row.created_at),
      reason: row.change_reason ? String(row.change_reason) : null,
      changeType: String(row.change_type) as RuleChangeType,
      diff,
      snapshot,
    });
  }

  return entries;
}

/**
 * Fetch a specific version by its version row id.
 */
export async function getRuleVersionById(
  versionId: number,
  companyId: number,
): Promise<RuleVersion | null> {
  const res = await db.execute(sql.raw(`
    SELECT id, rule_id, company_id, version_number, snapshot_json,
           change_type, changed_by, change_reason, created_at
    FROM recon_rule_versions
    WHERE id = ${versionId} AND company_id = ${companyId}
  `));
  const row = ((res as any).rows ?? [])[0];
  if (!row) return null;
  return rowToVersion(row);
}

// ─── Helper ───────────────────────────────────────────────────────────────────

function rowToVersion(r: Record<string, unknown>): RuleVersion {
  return {
    id:            Number(r.id),
    ruleId:        Number(r.rule_id),
    companyId:     Number(r.company_id),
    versionNumber: Number(r.version_number),
    snapshotJson:  typeof r.snapshot_json === "string"
                     ? JSON.parse(r.snapshot_json)
                     : r.snapshot_json as ReconRule,
    changeType:    String(r.change_type) as RuleChangeType,
    changedBy:     r.changed_by ? String(r.changed_by) : null,
    changeReason:  r.change_reason ? String(r.change_reason) : null,
    createdAt:     String(r.created_at),
  };
}
