/**
 * Recon Decision Stack (Batch 2 enhanced)
 *
 * Orchestrates the full matching pipeline for a single bank mutation.
 * Unified Matching Engine remains the final orchestrator; this module
 * adds pre-processing layers without rewriting existing engines.
 *
 * Decision order:
 *  1. Eligibility guard (status check — compare-and-set safe)
 *  2. Manual Rule Engine (recon_rules — confidence 100 on match)
 *  3. Exact reference match (via existing ERP doc matcher)
 *  4. Expected Cash Flow candidates
 *  5. Existing ERP document matcher
 *  6. Historical matching engine
 *  7. Fallback: unknown
 *
 * Protected statuses (never modified):
 *  approved_pending_posting, approved, posted, void, reversed, rejected
 *
 * Batch 2 additions:
 *  - matchedRuleVersionId in result (audit matching stores version, not just rule)
 *  - getCachedActiveRules / setCachedActiveRules for rule loading
 *  - recordMatchingEvent for metrics
 *  - Full explainability: confidence_breakdown, candidate_rank, decision_source
 */

import { sql } from "drizzle-orm";
import { logger } from "../logger.js";

// Lazy DB loader — constants/types are available without triggering DB connection
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let _db: any;
async function getDb() {
  if (!_db) { _db = (await import("@workspace/db")).db; }
  return _db as typeof DrizzleDb;
}
import { evaluateReconRules, type ReconRule, type ReconRuleMutationInput } from "./reconRuleEngine.js";
import { findEcfCandidates, type EcfMatchCandidate, type EcfDirection } from "./expectedCashFlowService.js";
import {
  getCachedActiveRules,
  setCachedActiveRules,
  DEFAULT_RULE_TTL_MS,
} from "./reconCache.js";
import { recordMatchingEvent } from "./reconMetricsService.js";
import { findBestMultiInvoiceMatch, type MultiInvoiceCandidate, type MultiInvoiceMatchResult } from "./multiInvoiceMatchingEngine.js";
import { findSplitPaymentCandidates, type SplitPaymentCandidate } from "./splitPaymentEngine.js";
import type { db as DrizzleDb } from "@workspace/db";

// ─── Constants ─────────────────────────────────────────────────────────────────

export const ENGINE_VERSION = "recon-decision-stack-v2.0";

/** Batch 3 engine version marker */
export const ENGINE_VERSION_B3 = "recon-decision-stack-v3.0-batch3";

/** All decision sources including Batch 3 additions (for type-guard tests) */
export const DECISION_SOURCES_B3 = [
  "MANUAL_RULE",
  "EXACT_REFERENCE",
  "EXPECTED_CASH_FLOW",
  "ERP_DOCUMENT",
  "MULTI_INVOICE",
  "SPLIT_PAYMENT",
  "HISTORICAL",
  "FALLBACK_UNKNOWN",
  "BLOCKED_STATUS",
] as const;

/** Statuses that block matching — compare-and-set guard. */
export const BLOCKED_STATUSES = new Set([
  "approved_pending_posting",
  "approved",
  "posted",
  "void",
  "reversed",
  "rejected",
]);

/** Statuses allowed for matching. */
export const ALLOWED_STATUSES = new Set([
  "unmatched",
  "matched",
  "duplicate_need_review",
]);

// ─── Types ─────────────────────────────────────────────────────────────────────

export type DecisionSource =
  | "MANUAL_RULE"
  | "EXACT_REFERENCE"
  | "EXPECTED_CASH_FLOW"
  | "ERP_DOCUMENT"
  | "MULTI_INVOICE"
  | "SPLIT_PAYMENT"
  | "HISTORICAL"
  | "FALLBACK_UNKNOWN"
  | "BLOCKED_STATUS";

export interface ConfidenceReason {
  code: string;
  label: string;
  score: number;
}

export interface DecisionStackResult {
  mutationId: number;
  eligible: boolean;
  blockedReason?: string;
  decisionSource: DecisionSource;
  matchedRuleId: number | null;
  /** Batch 2: version id of the rule that matched — for immutable audit trail */
  matchedRuleVersionId: number | null;
  expectedCashFlowId: string | null;
  confidence: number;
  confidenceBreakdown: ConfidenceReason[];
  candidateCount: number;
  ecfCandidates: EcfMatchCandidate[];
  engineVersion: string;
  evaluatedAt: string;
  /** Batch 2: candidate rank (1 = top candidate) */
  candidateRank: number | null;
  /** Batch 3: multi-invoice match result when decisionSource = MULTI_INVOICE */
  multiInvoiceMatch?: MultiInvoiceMatchResult;
  /** Batch 3: split-payment candidates when decisionSource = SPLIT_PAYMENT */
  splitPaymentCandidates?: SplitPaymentCandidate[];
}

export interface MutationForDecisionStack {
  id: number;
  companyId: number;
  amount: number;
  direction: string;
  transactionDate: string;
  description: string;
  normalizedDescription?: string | null;
  reference?: string | null;
  providerOrderId?: string | null;
  bankAccountId?: number | null;
  counterpartyName?: string | null;
  counterpartyAccount?: string | null;
  status: string;
}

// ─── Rule Loader (with cache) ──────────────────────────────────────────────────

export async function loadReconRulesForCompany(companyId: number): Promise<ReconRule[]> {
  // Try cache first
  const cached = getCachedActiveRules(companyId);
  if (cached !== null) {
    recordMatchingEvent({ companyId, eventType: "cache_hit" }).catch(() => {});
    return cached;
  }

  recordMatchingEvent({ companyId, eventType: "cache_miss" }).catch(() => {});
  const db = await getDb();
  try {
    const rows = await db.execute(sql.raw(`
      SELECT
        id, company_id, name, description, priority, is_active,
        direction, bank_account_id, condition_type, condition_field,
        condition_operator, condition_value, target_type, target_id,
        target_coa_code, confidence_score, stop_processing,
        conditions_json, logic, specificity,
        match_count, last_matched_at, created_by, created_at, updated_at
      FROM recon_rules
      WHERE company_id = ${companyId} AND is_active = TRUE
      ORDER BY priority DESC, id ASC
    `));

    const rules = ((rows as any).rows ?? []).map((r: Record<string, unknown>) => ({
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
      conditionValue:   String(r.condition_value ?? ""),
      targetType:       String(r.target_type) as ReconRule["targetType"],
      targetId:         r.target_id != null ? Number(r.target_id) : null,
      targetCoaCode:    r.target_coa_code ? String(r.target_coa_code) : null,
      confidenceScore:  Number(r.confidence_score ?? 100),
      stopProcessing:   Boolean(r.stop_processing),
      matchCount:       Number(r.match_count ?? 0),
      lastMatchedAt:    r.last_matched_at ? String(r.last_matched_at) : null,
      createdBy:        r.created_by ? String(r.created_by) : null,
      createdAt:        String(r.created_at ?? ""),
       updatedAt:        String(r.updated_at ?? ""),
       conditions:       Array.isArray(r.conditions_json) ? r.conditions_json : undefined,
       logic:            r.logic === "OR" ? "OR" : "AND",
       specificity:      Number(r.specificity ?? 1),
    })) as ReconRule[];

    // Populate cache
    setCachedActiveRules(companyId, rules, DEFAULT_RULE_TTL_MS);

    return rules;
  } catch (e: any) {
    logger.warn({ err: e.message, companyId }, "[reconDecisionStack] failed to load recon rules");
    return [];
  }
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function runReconDecisionStack(
  mutation: MutationForDecisionStack,
): Promise<DecisionStackResult> {
  const evaluatedAt = new Date().toISOString();
  const tStart = Date.now();
  const db = await getDb();

  // ── 1. Eligibility guard ──────────────────────────────────────────────────────
  if (BLOCKED_STATUSES.has(mutation.status)) {
    logger.debug(
      { mutationId: mutation.id, status: mutation.status },
      "[reconDecisionStack] blocked status — skipping",
    );
    return {
      mutationId: mutation.id,
      eligible: false,
      blockedReason: `Status '${mutation.status}' tidak dapat diubah`,
      decisionSource: "BLOCKED_STATUS",
      matchedRuleId: null,
      matchedRuleVersionId: null,
      expectedCashFlowId: null,
      confidence: 0,
      confidenceBreakdown: [],
      candidateCount: 0,
      ecfCandidates: [],
      engineVersion: ENGINE_VERSION,
      evaluatedAt,
      candidateRank: null,
    };
  }

  // ── 2. Manual Rule Engine ─────────────────────────────────────────────────────
  const tRuleStart = Date.now();
  const rules = await loadReconRulesForCompany(mutation.companyId);

  if (rules.length > 0) {
    const mutInput: ReconRuleMutationInput = {
      description:       (mutation.normalizedDescription ?? mutation.description).toLowerCase(),
      reference:         mutation.reference ?? null,
      amount:            mutation.amount,
      direction:         mutation.direction.toUpperCase() as "IN" | "OUT",
      bankAccountId:     mutation.bankAccountId ?? null,
      counterpartyName:  mutation.counterpartyName ?? null,
      counterpartyAccount: mutation.counterpartyAccount ?? null,
      companyId:         mutation.companyId,
    };

    const ruleResult = evaluateReconRules(rules, mutInput);
    const ruleTimeMs = Date.now() - tRuleStart;

    if (ruleResult.matched && ruleResult.ruleId != null) {
      // Fetch current_version_id for the matched rule
      let matchedRuleVersionId: number | null = null;
      try {
        const versionRes = await db.execute(sql.raw(`
          SELECT current_version_id FROM recon_rules WHERE id = ${ruleResult.ruleId}
        `));
        const vRow = ((versionRes as any).rows ?? [])[0];
        matchedRuleVersionId = vRow?.current_version_id != null ? Number(vRow.current_version_id) : null;
      } catch {
        // non-fatal
      }

      // Update rule match stats (async, fire-and-forget)
      db.execute(sql.raw(`
        UPDATE recon_rules
        SET match_count = match_count + 1, last_matched_at = NOW()
        WHERE id = ${ruleResult.ruleId}
      `)).catch(() => {});

      // Record metrics
      recordMatchingEvent({
        companyId: mutation.companyId,
        bankAccountId: mutation.bankAccountId ?? null,
        eventType: "rule_match",
        ruleTimeMs,
        confidence: ruleResult.confidence ?? 100,
        ruleId: ruleResult.ruleId,
        ruleName: ruleResult.ruleName,
        matchingTimeMs: Date.now() - tStart,
      }).catch(() => {});

      logger.info(
        { mutationId: mutation.id, ruleId: ruleResult.ruleId, ruleName: ruleResult.ruleName, matchedRuleVersionId },
        "[reconDecisionStack] rule matched",
      );

      return {
        mutationId: mutation.id,
        eligible: true,
        decisionSource: "MANUAL_RULE",
        matchedRuleId: ruleResult.ruleId,
        matchedRuleVersionId,
        expectedCashFlowId: null,
        confidence: ruleResult.confidence ?? 100,
        confidenceBreakdown: ruleResult.reasons ?? [],
        candidateCount: 1,
        ecfCandidates: [],
        engineVersion: ENGINE_VERSION,
        evaluatedAt,
        candidateRank: 1,
      };
    }
  }

  // ── 3–4. Expected Cash Flow candidates ───────────────────────────────────────
  if (mutation.companyId) {
    const tEcfStart = Date.now();
    try {
      const ecfCandidates = await findEcfCandidates({
        companyId:        mutation.companyId,
        amount:           mutation.amount,
        direction:        mutation.direction.toUpperCase() as EcfDirection,
        description:      mutation.description ?? null,
        reference:        mutation.reference ?? null,
        transactionDate:  mutation.transactionDate,
        counterpartyName: mutation.counterpartyName ?? null,
      });
      const ecfTimeMs = Date.now() - tEcfStart;

      if (ecfCandidates.length > 0) {
        const best = ecfCandidates[0];
        const hasExactRef = best.reasons.some(r => r.code === "EXACT_REFERENCE");
        const decisionSource: DecisionSource = hasExactRef ? "EXACT_REFERENCE" : "EXPECTED_CASH_FLOW";

        recordMatchingEvent({
          companyId: mutation.companyId,
          bankAccountId: mutation.bankAccountId ?? null,
          eventType: "ecf_match",
          ecfTimeMs,
          confidence: best.confidence,
          matchingTimeMs: Date.now() - tStart,
        }).catch(() => {});

        logger.info(
          { mutationId: mutation.id, ecfId: best.ecfId, confidence: best.confidence, decisionSource },
          "[reconDecisionStack] ECF candidate found",
        );

        return {
          mutationId: mutation.id,
          eligible: true,
          decisionSource,
          matchedRuleId: null,
          matchedRuleVersionId: null,
          expectedCashFlowId: best.ecfId,
          confidence: best.confidence,
          confidenceBreakdown: best.reasons,
          candidateCount: ecfCandidates.length,
          ecfCandidates,
          engineVersion: ENGINE_VERSION,
          evaluatedAt,
          candidateRank: 1,
        };
      }
    } catch (e: any) {
      logger.warn({ err: e.message, mutationId: mutation.id }, "[reconDecisionStack] ECF candidates failed — falling through");
    }
  }

  // ── 5. Multi Invoice Matching ─────────────────────────────────────────────────
  // Try to find a combination of invoices that sums to this mutation's amount.
  // Runs only for direction=IN (money received) and only when companyId is set.
  if (mutation.companyId && mutation.direction.toUpperCase() === "IN") {
    try {
      const tMimStart = Date.now();
      // Fetch outstanding invoice candidates for this company (amount ≤ mutation.amount)
      const { rows: invRows } = await db.execute(sql.raw(`
        SELECT sd.id AS invoice_id, sd.doc_number AS invoice_ref,
               sd.total_amount AS amount, sd.due_date::text AS due_date,
               COALESCE(c.name, '') AS customer_name
        FROM sales_documents sd
        LEFT JOIN customers c ON c.id = sd.customer_id
        WHERE sd.doc_type = 'invoice'
          AND sd.company_id = ${mutation.companyId}
          AND sd.status NOT IN ('paid','cancelled','void')
          AND sd.total_amount <= ${mutation.amount} * 1.05
          AND sd.total_amount >= ${mutation.amount} * 0.01
          AND sd.issue_date >= '${mutation.transactionDate}'::date - 90
        ORDER BY sd.total_amount DESC
        LIMIT 100
      `)).catch(() => ({ rows: [] as unknown[] }));

      if ((invRows as unknown[]).length > 0) {
        const candidates = (invRows as any[]).map(r => ({
          invoiceId:    Number(r.invoice_id),
          invoiceRef:   String(r.invoice_ref ?? ""),
          amount:       Number(r.amount ?? 0),
          dueDate:      r.due_date ? String(r.due_date) : null,
          customerName: r.customer_name ? String(r.customer_name) : null,
          companyId:    mutation.companyId,
        }));

        const mimResult = findBestMultiInvoiceMatch(mutation.amount, candidates, {
          maxCandidates: 100,
          toleranceFraction: 0.001,
          allowPartial: false,
        });

        if (mimResult.matchType === "EXACT" && mimResult.invoices.length > 0) {
          const mimTimeMs = Date.now() - tMimStart;
          recordMatchingEvent({
            companyId:      mutation.companyId,
            bankAccountId:  mutation.bankAccountId ?? null,
            eventType:      "ecf_match",    // nearest existing event type
            ecfTimeMs:      mimTimeMs,
            confidence:     mimResult.confidence,
            matchingTimeMs: Date.now() - tStart,
          }).catch(() => {});

          logger.info(
            { mutationId: mutation.id, invoiceCount: mimResult.invoices.length, confidence: mimResult.confidence, algorithm: mimResult.algorithmUsed },
            "[reconDecisionStack] multi-invoice match found",
          );

          return {
            mutationId:          mutation.id,
            eligible:            true,
            decisionSource:      "MULTI_INVOICE",
            matchedRuleId:       null,
            matchedRuleVersionId:null,
            expectedCashFlowId:  null,
            confidence:          mimResult.confidence,
            confidenceBreakdown: mimResult.explanation,
            candidateCount:      mimResult.candidatesEvaluated,
            ecfCandidates:       [],
            engineVersion:       ENGINE_VERSION_B3,
            evaluatedAt,
            candidateRank:       1,
            multiInvoiceMatch:   mimResult,
          };
        }
      }
    } catch (e: any) {
      logger.warn({ err: e.message, mutationId: mutation.id }, "[reconDecisionStack] multi-invoice matching failed — falling through");
    }
  }

  // ── 6. Split Payment Detection ────────────────────────────────────────────────
  // Try to find an invoice that is partially paid and this mutation may continue.
  if (mutation.companyId && mutation.direction.toUpperCase() === "IN") {
    try {
      const tSpStart = Date.now();
      const splitCandidates = await findSplitPaymentCandidates(
        mutation.amount,
        mutation.companyId,
        mutation.transactionDate,
      );

      if (splitCandidates.length > 0) {
        const best = splitCandidates[0];
        const spTimeMs = Date.now() - tSpStart;

        recordMatchingEvent({
          companyId:      mutation.companyId,
          bankAccountId:  mutation.bankAccountId ?? null,
          eventType:      "ecf_match",
          ecfTimeMs:      spTimeMs,
          confidence:     best.confidence,
          matchingTimeMs: Date.now() - tStart,
        }).catch(() => {});

        logger.info(
          { mutationId: mutation.id, invoiceId: best.invoiceId, invoiceRef: best.invoiceRef, confidence: best.confidence },
          "[reconDecisionStack] split-payment candidate found",
        );

        return {
          mutationId:          mutation.id,
          eligible:            true,
          decisionSource:      "SPLIT_PAYMENT",
          matchedRuleId:       null,
          matchedRuleVersionId:null,
          expectedCashFlowId:  best.invoiceRef,
          confidence:          best.confidence,
          confidenceBreakdown: best.explanation,
          candidateCount:      splitCandidates.length,
          ecfCandidates:       [],
          engineVersion:       ENGINE_VERSION_B3,
          evaluatedAt,
          candidateRank:       1,
          splitPaymentCandidates: splitCandidates,
        };
      }
    } catch (e: any) {
      logger.warn({ err: e.message, mutationId: mutation.id }, "[reconDecisionStack] split-payment detection failed — falling through");
    }
  }

  // ── 7. Fall through to existing engines (ERP / Historical / Fallback) ─────────
  recordMatchingEvent({
    companyId: mutation.companyId,
    bankAccountId: mutation.bankAccountId ?? null,
    eventType: "fallback",
    matchingTimeMs: Date.now() - tStart,
  }).catch(() => {});

  logger.debug(
    { mutationId: mutation.id },
    "[reconDecisionStack] no pre-match — delegating to unified engine",
  );

  return {
    mutationId: mutation.id,
    eligible: true,
    decisionSource: "FALLBACK_UNKNOWN",
    matchedRuleId: null,
    matchedRuleVersionId: null,
    expectedCashFlowId: null,
    confidence: 0,
    confidenceBreakdown: [],
    candidateCount: 0,
    ecfCandidates: [],
    engineVersion: ENGINE_VERSION,
    evaluatedAt,
    candidateRank: null,
    multiInvoiceMatch: undefined,
    splitPaymentCandidates: undefined,
  };
}
