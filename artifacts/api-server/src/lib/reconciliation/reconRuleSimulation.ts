/**
 * Recon Rule Simulation Engine
 *
 * Runs a specific rule against historical bank_mutations in a date range.
 * READ-ONLY — no data is modified.
 *
 * Output includes:
 *  - total_mutations   : how many mutations were evaluated
 *  - matched           : how many the rule would match
 *  - not_matched       : how many it would not
 *  - false_positive_estimate : mutations already classified differently that rule also matches
 *  - false_negative_estimate : mutations classified as this rule's target_type by other means, but rule misses
 *  - top_examples      : up to 5 matched examples
 *  - confidence_distribution : histogram of confidence scores
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../logger.js";
import {
  evaluateCondition,
  type ReconRule,
  type ReconRuleMutationInput,
} from "./reconRuleEngine.js";

// ─── Types ─────────────────────────────────────────────────────────────────────

export interface SimulationInput {
  ruleId: number;
  companyId: number;
  dateFrom: string;          // ISO date e.g. "2026-01-01"
  dateTo: string;            // ISO date e.g. "2026-07-29"
  mutationIds?: number[];    // optional — run against specific mutations
  limit?: number;            // default 1000, max 10000
}

export interface SimulationExample {
  mutationId: number;
  description: string;
  reference: string | null;
  amount: number;
  direction: "IN" | "OUT";
  transactionDate: string;
  existingStatus: string;
  confidence: number;
}

export interface ConfidenceBucket {
  range: string;   // e.g. "90-100"
  count: number;
  pct: number;
}

export interface SimulationResult {
  ruleId: number;
  ruleName: string;
  companyId: number;
  dateFrom: string;
  dateTo: string;
  totalMutations: number;
  matched: number;
  notMatched: number;
  falsePositiveEstimate: number;
  falseNegativeEstimate: number;
  matchRate: number;          // matched / total * 100
  topExamples: SimulationExample[];
  confidenceDistribution: ConfidenceBucket[];
  simulatedAt: string;
  readOnly: true;
}

// ─── Engine ───────────────────────────────────────────────────────────────────

export async function simulateRule(input: SimulationInput): Promise<SimulationResult> {
  const limit = Math.min(input.limit ?? 1000, 10_000);

  // 1. Load the rule
  const ruleRes = await db.execute(sql.raw(`
    SELECT id, company_id, name, description, priority, is_active,
           direction, bank_account_id, condition_type, condition_field,
           condition_operator, condition_value, target_type, target_id,
           target_coa_code, confidence_score, stop_processing,
           match_count, last_matched_at, created_by, created_at, updated_at
    FROM recon_rules
    WHERE id = ${input.ruleId} AND company_id = ${input.companyId}
    LIMIT 1
  `));
  const ruleRow = ((ruleRes as any).rows ?? [])[0];
  if (!ruleRow) throw new Error(`Rule ${input.ruleId} not found for company ${input.companyId}`);

  const rule = rowToRule(ruleRow);

  // 2. Load mutations
  let mutationsSql: string;
  if (input.mutationIds && input.mutationIds.length > 0) {
    const ids = input.mutationIds.map(Number).filter(n => n > 0).join(",");
    mutationsSql = `
      SELECT id, company_id, description, reference, amount, direction,
             transaction_date, status, bank_account_id,
             COALESCE(counterparty_name,'') AS counterparty_name,
             COALESCE(counterparty_account,'') AS counterparty_account
      FROM bank_mutations
      WHERE company_id = ${input.companyId}
        AND id IN (${ids})
      ORDER BY transaction_date DESC
      LIMIT ${limit}
    `;
  } else {
    const dateFrom = input.dateFrom.replace(/'/g, "");
    const dateTo   = input.dateTo.replace(/'/g, "");
    mutationsSql = `
      SELECT id, company_id, description, reference, amount, direction,
             transaction_date, status, bank_account_id,
             COALESCE(counterparty_name,'') AS counterparty_name,
             COALESCE(counterparty_account,'') AS counterparty_account
      FROM bank_mutations
      WHERE company_id = ${input.companyId}
        AND transaction_date BETWEEN '${dateFrom}' AND '${dateTo}'
      ORDER BY transaction_date DESC
      LIMIT ${limit}
    `;
  }

  const mutRes = await db.execute(sql.raw(mutationsSql));
  const mutations = ((mutRes as any).rows ?? []) as Array<Record<string, unknown>>;

  // 3. Evaluate rule against each mutation
  let matched = 0;
  let falsePositiveEstimate = 0;
  let falseNegativeEstimate = 0;
  const topExamples: SimulationExample[] = [];
  const confidenceCounts = new Array(10).fill(0); // 0-9 → 0-9%, 10-19%, …, 90-100%

  for (const m of mutations) {
    const mutInput: ReconRuleMutationInput = {
      description:       String(m.description ?? ""),
      reference:         m.reference ? String(m.reference) : null,
      amount:            Number(m.amount ?? 0),
      direction:         (String(m.direction ?? "IN")).toUpperCase() as "IN" | "OUT",
      bankAccountId:     m.bank_account_id ? Number(m.bank_account_id) : null,
      counterpartyName:  m.counterparty_name ? String(m.counterparty_name) : null,
      counterpartyAccount: m.counterparty_account ? String(m.counterparty_account) : null,
      companyId:         Number(m.company_id),
    };

    const conditionPassed = evaluateCondition(
      mutInput,
      rule.conditionField,
      rule.conditionOperator,
      rule.conditionValue,
    );

    if (conditionPassed) {
      matched++;
      const bucketIdx = Math.min(Math.floor(rule.confidenceScore / 10), 9);
      confidenceCounts[bucketIdx]++;

      const existingStatus = String(m.status ?? "unmatched");
      // False positive estimate: rule matches but mutation is already approved/posted
      if (["approved", "posted", "approved_pending_posting"].includes(existingStatus)) {
        falsePositiveEstimate++;
      }

      if (topExamples.length < 5) {
        topExamples.push({
          mutationId:    Number(m.id),
          description:   String(m.description ?? ""),
          reference:     m.reference ? String(m.reference) : null,
          amount:        Number(m.amount ?? 0),
          direction:     mutInput.direction,
          transactionDate: String(m.transaction_date ?? ""),
          existingStatus,
          confidence:    rule.confidenceScore,
        });
      }
    } else {
      // False negative estimate: rule misses but mutation looks like it should match target_type
      // Heuristic: if description contains part of rule condition value but operator failed
      // (e.g., due to case or partial match)
      if (
        rule.conditionOperator === "contains" &&
        String(m.description ?? "").toLowerCase().includes(
          rule.conditionValue.toLowerCase().substring(0, 3)
        )
      ) {
        falseNegativeEstimate++;
      }
    }
  }

  const totalMutations = mutations.length;
  const notMatched = totalMutations - matched;
  const matchRate = totalMutations === 0 ? 0 : Math.round((matched / totalMutations) * 10000) / 100;

  // Build confidence distribution histogram
  const confidenceDistribution: ConfidenceBucket[] = confidenceCounts.map((count, i) => ({
    range: `${i * 10}–${i * 10 + 9}`,
    count,
    pct: matched === 0 ? 0 : Math.round((count / matched) * 10000) / 100,
  }));

  logger.info(
    { ruleId: input.ruleId, companyId: input.companyId, totalMutations, matched, matchRate },
    "[reconRuleSimulation] simulation complete",
  );

  return {
    ruleId:     rule.id,
    ruleName:   rule.name,
    companyId:  input.companyId,
    dateFrom:   input.dateFrom,
    dateTo:     input.dateTo,
    totalMutations,
    matched,
    notMatched,
    falsePositiveEstimate,
    falseNegativeEstimate,
    matchRate,
    topExamples,
    confidenceDistribution,
    simulatedAt: new Date().toISOString(),
    readOnly: true,
  };
}

// ─── Helper ───────────────────────────────────────────────────────────────────

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
    conditionField:   String(r.condition_field) as any,
    conditionOperator: String(r.condition_operator) as any,
    conditionValue:   String(r.condition_value ?? ""),
    targetType:       String(r.target_type) as any,
    targetId:         r.target_id != null ? Number(r.target_id) : null,
    targetCoaCode:    r.target_coa_code ? String(r.target_coa_code) : null,
    confidenceScore:  Number(r.confidence_score ?? 100),
    stopProcessing:   Boolean(r.stop_processing),
    matchCount:       Number(r.match_count ?? 0),
    lastMatchedAt:    r.last_matched_at ? String(r.last_matched_at) : null,
    createdBy:        r.created_by ? String(r.created_by) : null,
    createdAt:        String(r.created_at ?? ""),
    updatedAt:        String(r.updated_at ?? ""),
  };
}
