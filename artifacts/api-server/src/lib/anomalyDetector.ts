/**
 * Finance Governance — FASE 6
 * Fraud & Anomaly Detection Engine
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";
import { queueIntegrityError } from "./errorContainment.js";

export type AnomalySeverity = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

export interface AnomalyResult {
  triggered: boolean;
  rule: string;
  score: number;
  severity: AnomalySeverity;
  details: Record<string, unknown>;
}

function calcSeverity(score: number): AnomalySeverity {
  if (score >= 80) return "CRITICAL";
  if (score >= 60) return "HIGH";
  if (score >= 40) return "MEDIUM";
  return "LOW";
}

// Rule 1: Duplicate payment — same amount + same COA + same date within 1h
async function duplicatePaymentDetection(opts: {
  companyId: number;
  entryId: number;
  amount: number;
  date: string;
}): Promise<AnomalyResult> {
  try {
    const { rows } = await db.execute(sql.raw(`
      SELECT ae.id, ae.total_debit, ae.date, ae.created_at
      FROM accounting_entries ae
      WHERE ae.company_id = ${opts.companyId}
        AND ae.id <> ${opts.entryId}
        AND ae.date = '${opts.date}'
        AND ae.total_debit = ${opts.amount}
        AND ae.created_at >= NOW() - INTERVAL '1 hour'
        AND ae.status NOT IN ('rejected', 'draft')
      LIMIT 3
    `));
    if (rows.length > 0) {
      return {
        triggered: true,
        rule: "duplicatePaymentDetection",
        score: 75,
        severity: "HIGH",
        details: { duplicateCount: rows.length, duplicateIds: rows.map((r: any) => r.id), amount: opts.amount },
      };
    }
  } catch (err) {
    logger.warn({ err }, "[anomaly] duplicatePaymentDetection error");
  }
  return { triggered: false, rule: "duplicatePaymentDetection", score: 0, severity: "LOW", details: {} };
}

// Rule 2: Amount spike — entry amount > 3× rolling 30-day average for that journal
async function amountSpikeDetection(opts: {
  companyId: number;
  entryId: number;
  journalId: number;
  amount: number;
}): Promise<AnomalyResult> {
  try {
    const { rows } = await db.execute(sql.raw(`
      SELECT AVG(total_debit)::numeric AS avg_amount, COUNT(*) AS cnt
      FROM accounting_entries
      WHERE company_id = ${opts.companyId}
        AND journal_id = ${opts.journalId}
        AND id <> ${opts.entryId}
        AND created_at >= NOW() - INTERVAL '30 days'
        AND status = 'posted'
    `));
    const row = rows[0] as any;
    const avg = parseFloat(row?.avg_amount ?? "0");
    const cnt = parseInt(row?.cnt ?? "0", 10);
    if (cnt >= 5 && avg > 0 && opts.amount > avg * 3) {
      const ratio = Math.round(opts.amount / avg);
      const score = Math.min(95, 50 + ratio * 3);
      return {
        triggered: true,
        rule: "amountSpikeDetection",
        score,
        severity: calcSeverity(score),
        details: { amount: opts.amount, rollingAvg: avg, ratio, sampleCount: cnt },
      };
    }
  } catch (err) {
    logger.warn({ err }, "[anomaly] amountSpikeDetection error");
  }
  return { triggered: false, rule: "amountSpikeDetection", score: 0, severity: "LOW", details: {} };
}

// Rule 3: Rapid transactions — >5 entries from same user in 60 seconds
async function rapidTransactionDetection(opts: {
  companyId: number;
  actor: string;
}): Promise<AnomalyResult> {
  try {
    const { rows } = await db.execute(sql.raw(`
      SELECT COUNT(*)::int AS cnt
      FROM accounting_entries
      WHERE company_id = ${opts.companyId}
        AND created_by_id = '${opts.actor.replace(/'/g, "''")}'
        AND created_at >= NOW() - INTERVAL '60 seconds'
    `));
    const cnt = parseInt((rows[0] as any)?.cnt ?? "0", 10);
    if (cnt > 5) {
      const score = Math.min(90, 50 + (cnt - 5) * 8);
      return {
        triggered: true,
        rule: "rapidTransactionDetection",
        score,
        severity: calcSeverity(score),
        details: { transactionCount: cnt, actor: opts.actor, windowSeconds: 60 },
      };
    }
  } catch (err) {
    logger.warn({ err }, "[anomaly] rapidTransactionDetection error");
  }
  return { triggered: false, rule: "rapidTransactionDetection", score: 0, severity: "LOW", details: {} };
}

// Rule 4: Unmatched high-value entry with no approval chain
async function unmatchedHighValueDetection(opts: {
  companyId: number;
  entryId: number;
  amount: number;
  threshold?: number;
}): Promise<AnomalyResult> {
  const threshold = opts.threshold ?? 100_000_000;
  try {
    if (opts.amount >= threshold) {
      const { rows } = await db.execute(sql.raw(`
        SELECT COUNT(*)::int AS cnt
        FROM journal_approval_workflow
        WHERE entry_id = ${opts.entryId}
          AND status = 'approved'
      `));
      const approved = parseInt((rows[0] as any)?.cnt ?? "0", 10);
      if (approved === 0) {
        const score = Math.min(100, 60 + Math.floor(Math.log10(opts.amount / threshold) * 15));
        return {
          triggered: true,
          rule: "unmatchedHighValueDetection",
          score,
          severity: calcSeverity(score),
          details: { amount: opts.amount, threshold, hasApproval: false },
        };
      }
    }
  } catch (err) {
    logger.warn({ err }, "[anomaly] unmatchedHighValueDetection error");
  }
  return { triggered: false, rule: "unmatchedHighValueDetection", score: 0, severity: "LOW", details: {} };
}

// Rule 5: Intercompany mismatch — entry references a source document belonging to a different company
// This detects fraudulent intercompany entries where a journal in company A references a
// source document that belongs to company B without a proper intercompany routing entry.
async function intercompanyMismatchDetection(opts: {
  companyId: number;
  entryId: number;
}): Promise<AnomalyResult> {
  try {
    // Check if this entry's source document belongs to a different company
    const { rows: crossCompanyRows } = await db.execute(sql.raw(`
      SELECT ae.id, ae.company_id AS entry_company, src.company_id AS source_company
      FROM accounting_entries ae
      JOIN accounting_entries src ON src.id = ae.source_id
      WHERE ae.id = ${opts.entryId}
        AND ae.source_id IS NOT NULL
        AND src.company_id IS NOT NULL
        AND src.company_id <> ae.company_id
    `));

    if (crossCompanyRows.length > 0) {
      const row = crossCompanyRows[0] as any;
      return {
        triggered: true,
        rule: "intercompanyMismatchDetection",
        score: 85,
        severity: "CRITICAL",
        details: {
          entryId: opts.entryId,
          entryCompany: row.entry_company,
          sourceCompany: row.source_company,
          message: "Entry references source document from a different company without intercompany approval",
        },
      };
    }

    // Also check: debit and credit accounts used in entry belong to different companies
    // (detects direct cross-company COA misuse when COA has company_id scoping)
    const { rows: coaMismatchRows } = await db.execute(sql.raw(`
      SELECT COUNT(DISTINCT coa.company_id)::int AS company_count
      FROM accounting_entry_lines ael
      JOIN chart_of_accounts coa ON coa.id = ael.account_id
      WHERE ael.entry_id = ${opts.entryId}
        AND coa.company_id IS NOT NULL
        AND coa.company_id <> ${opts.companyId}
    `));

    const foreignAccounts = parseInt((coaMismatchRows[0] as any)?.company_count ?? "0", 10);
    if (foreignAccounts > 0) {
      return {
        triggered: true,
        rule: "intercompanyMismatchDetection",
        score: 90,
        severity: "CRITICAL",
        details: {
          entryId: opts.entryId,
          entryCompanyId: opts.companyId,
          foreignCompanyAccountCount: foreignAccounts,
          message: "Entry lines reference accounts belonging to a different company",
        },
      };
    }
  } catch (err) {
    logger.warn({ err }, "[anomaly] intercompanyMismatchDetection error");
  }
  return { triggered: false, rule: "intercompanyMismatchDetection", score: 0, severity: "LOW", details: {} };
}

// ── Main detector ─────────────────────────────────────────────────────────

export interface DetectorInput {
  companyId: number;
  entryId: number;
  journalId: number;
  amount: number;
  date: string;
  actor: string;
  highValueThreshold?: number;
}

export async function runAnomalyDetection(input: DetectorInput): Promise<AnomalyResult[]> {
  const results = await Promise.all([
    duplicatePaymentDetection({ companyId: input.companyId, entryId: input.entryId, amount: input.amount, date: input.date }),
    amountSpikeDetection({ companyId: input.companyId, entryId: input.entryId, journalId: input.journalId, amount: input.amount }),
    rapidTransactionDetection({ companyId: input.companyId, actor: input.actor }),
    unmatchedHighValueDetection({ companyId: input.companyId, entryId: input.entryId, amount: input.amount, threshold: input.highValueThreshold }),
    intercompanyMismatchDetection({ companyId: input.companyId, entryId: input.entryId }),
  ]);

  const triggered = results.filter((r) => r.triggered);

  for (const result of triggered) {
    try {
      await db.execute(sql.raw(`
        INSERT INTO finance_anomaly_log
          (company_id, rule_triggered, anomaly_score, severity, entry_id, details)
        VALUES (
          ${input.companyId},
          '${result.rule}',
          ${result.score},
          '${result.severity}',
          ${input.entryId},
          '${JSON.stringify(result.details).replace(/'/g, "''")}'::jsonb
        )
      `));

      if (result.severity === "HIGH" || result.severity === "CRITICAL") {
        await queueIntegrityError({
          companyId: input.companyId,
          classification: result.severity === "CRITICAL" ? "HIGH" : "MEDIUM",
          module: "finance_governance",
          errorCode: `ANOMALY_${result.rule.toUpperCase()}`,
          message: `Anomaly detected: ${result.rule} (score=${result.score}, severity=${result.severity})`,
          context: { entryId: input.entryId, ...result.details },
          entityType: "accounting_entry",
          entityId: String(input.entryId),
        });
      }
    } catch (err) {
      logger.warn({ err, rule: result.rule }, "[anomaly] Failed to log anomaly");
    }
  }

  return triggered;
}
