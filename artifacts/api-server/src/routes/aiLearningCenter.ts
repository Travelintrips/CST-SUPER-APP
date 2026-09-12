/**
 * AI Learning & Recommendation Center — Phase 2
 * Read-only REST API Routes
 *
 * Prefix: /api/ai-review
 *
 * Exposes data from existing Phase 5/6/8/9/11 engines.
 * All endpoints are read-only — AI never auto-applies rules, mappings, or COA changes.
 * Human approval is required for every recommendation (Phase 9 enforcement).
 *
 * Endpoints:
 *   GET /api/ai-review/learning              — learning patterns
 *   GET /api/ai-review/learning/:id          — single pattern detail
 *   GET /api/ai-review/recommendations       — rule recommendation packages
 *   GET /api/ai-review/recommendations/:id   — single recommendation detail
 *   GET /api/ai-review/statistics            — aggregated statistics
 *   GET /api/ai-review/rules/suggestions     — rule suggestions from pending packages
 */

import { Router } from 'express';
import { db } from '@workspace/db';
import {
  aiLearningFeedbackTable,
  aiRuleRecommendationPackagesTable,
} from '@workspace/db';
import { eq, desc } from 'drizzle-orm';
import { resolveCompanyId } from '../lib/resolveCompany.js';
import { requireRole } from '../lib/requireAdmin.js';
import { aiRuleRecommendationRepo } from '../lib/ai/transaction-intelligence/aiReviewRepository.js';
import { toSafeErrorResponse } from '../lib/ai/transaction-intelligence/aiReviewErrors.js';
import { logger } from '../lib/logger.js';
import type { Request, Response } from 'express';

export const aiLearningCenterRouter = Router();

// ─── Auth helpers ─────────────────────────────────────────────────────────────

const FINANCE_ROLES = ['admin', 'finance', 'accounting', 'treasury', 'tax', 'payroll'];

async function requireFinanceRole(req: Request, res: Response): Promise<boolean> {
  return requireRole(req, res, FINANCE_ROLES);
}

// ─── Error handler ────────────────────────────────────────────────────────────

function handleError(res: Response, err: unknown): void {
  const { statusCode, body } = toSafeErrorResponse(err);
  logger.error({ err }, '[aiLearningCenter] route error');
  res.status(statusCode).json(body);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function patternId(intent: string | null, coa: string | null): string {
  const key = `${intent ?? 'UNKNOWN'}::${coa ?? 'UNKNOWN'}`;
  return Buffer.from(key).toString('base64').replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
}

function extractSuggestions(payload: Record<string, unknown>) {
  return (
    (payload['suggestions'] ??
      payload['ruleSuggestions'] ??
      payload['dictionarySuggestions'] ??
      []) as Array<Record<string, unknown>>
  );
}

function mapSuggestion(s: Record<string, unknown>, pkg: { id: number; packageType: string; riskLevel: string | null }, idx: number) {
  return {
    id: `${pkg.id}-${idx}`,
    packageId: pkg.id,
    ruleName: String(s['ruleName'] ?? s['type'] ?? s['suggestionType'] ?? `Rule from ${pkg.packageType}`),
    reason: String(s['reason'] ?? s['explanation'] ?? s['description'] ?? ''),
    occurrence: Number(s['occurrenceCount'] ?? s['occurrence'] ?? s['sampleCount'] ?? 0),
    confidence: Number(s['reliability'] ?? s['confidence'] ?? s['reliabilityScore'] ?? 0),
    affectedTransactions: Number(s['affectedTransactionCount'] ?? s['affectedTransactions'] ?? s['occurrence'] ?? 0),
    recommendedCoa: String(s['dominantCoaCode'] ?? s['recommendedCoa'] ?? s['coaCode'] ?? ''),
    expectedAccuracy: Number(s['changeRate'] ?? s['expectedAccuracy'] ?? s['approvalRate'] ?? 0),
    requiresHumanApproval: s['requiresHumanApproval'] !== false,
    packageType: pkg.packageType,
    riskLevel: pkg.riskLevel,
  };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

/**
 * GET /api/ai-review/learning
 * Returns learning patterns grouped by (intent + recommended COA).
 */
aiLearningCenterRouter.get('/learning', async (req, res) => {
  if (!(await requireFinanceRole(req, res))) return;
  try {
    const companyId = resolveCompanyId(req);
    const limit = Math.min(500, parseInt(String(req.query['limit'] ?? '200'), 10) || 200);

    const rows = await db
      .select()
      .from(aiLearningFeedbackTable)
      .where(eq(aiLearningFeedbackTable.companyId, companyId))
      .orderBy(desc(aiLearningFeedbackTable.createdAt))
      .limit(limit);

    // Group by (intent + aiRecommendedCoaCode)
    const groups = new Map<
      string,
      {
        id: string;
        intent: string | null;
        recommendedCoa: string | null;
        reviewerSelectedCoaCodes: Set<string>;
        occurrenceCount: number;
        agreedCount: number;
        lastSeen: Date | null;
        createdAt: Date | null;
        reviewCaseIds: (number | null)[];
      }
    >();

    for (const row of rows) {
      const pid = patternId(row.intent, row.aiRecommendedCoaCode);
      if (!groups.has(pid)) {
        groups.set(pid, {
          id: pid,
          intent: row.intent,
          recommendedCoa: row.aiRecommendedCoaCode,
          reviewerSelectedCoaCodes: new Set(),
          occurrenceCount: 0,
          agreedCount: 0,
          lastSeen: null,
          createdAt: row.createdAt,
          reviewCaseIds: [],
        });
      }
      const g = groups.get(pid)!;
      g.occurrenceCount += 1;
      if (row.agreement === true) g.agreedCount += 1;
      if (row.reviewerSelectedCoaCode) g.reviewerSelectedCoaCodes.add(row.reviewerSelectedCoaCode);
      if (!g.lastSeen || row.createdAt > g.lastSeen) g.lastSeen = row.createdAt;
      if (!g.createdAt || row.createdAt < g.createdAt) g.createdAt = row.createdAt;
      g.reviewCaseIds.push(row.reviewCaseId);
    }

    const patterns = Array.from(groups.values())
      .sort((a, b) => b.occurrenceCount - a.occurrenceCount)
      .map((g) => ({
        id: g.id,
        description: `${g.intent ?? 'Unknown intent'} → ${g.recommendedCoa ?? 'Unknown COA'}`,
        occurrenceCount: g.occurrenceCount,
        confidence: g.occurrenceCount > 0 ? Math.round((g.agreedCount / g.occurrenceCount) * 10000) / 10000 : 0,
        companyId,
        intent: g.intent,
        recommendedCoa: g.recommendedCoa,
        reviewerAgreement: g.occurrenceCount > 0 ? Math.round((g.agreedCount / g.occurrenceCount) * 10000) / 10000 : 0,
        requiresApproval: true,
        lastSeen: g.lastSeen?.toISOString() ?? null,
        createdAt: g.createdAt?.toISOString() ?? null,
        reviewerSelectedCoaCodes: Array.from(g.reviewerSelectedCoaCodes),
      }));

    res.json({ ok: true, data: { patterns, total: patterns.length } });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * GET /api/ai-review/learning/:id
 * Returns a single learning pattern with its feedback records.
 */
aiLearningCenterRouter.get('/learning/:id', async (req, res) => {
  if (!(await requireFinanceRole(req, res))) return;
  try {
    const companyId = resolveCompanyId(req);
    const targetId = req.params['id'];

    const rows = await db
      .select()
      .from(aiLearningFeedbackTable)
      .where(eq(aiLearningFeedbackTable.companyId, companyId))
      .orderBy(desc(aiLearningFeedbackTable.createdAt))
      .limit(500);

    // Find the pattern matching the id
    const matchingRows = rows.filter((row) => patternId(row.intent, row.aiRecommendedCoaCode) === targetId);

    if (matchingRows.length === 0) {
      res.status(404).json({ ok: false, error: 'Pattern not found' });
      return;
    }

    const first = matchingRows[0]!;
    const agreedCount = matchingRows.filter((r) => r.agreement === true).length;
    const total = matchingRows.length;

    res.json({
      ok: true,
      data: {
        id: targetId,
        description: `${first.intent ?? 'Unknown intent'} → ${first.aiRecommendedCoaCode ?? 'Unknown COA'}`,
        occurrenceCount: total,
        confidence: total > 0 ? Math.round((agreedCount / total) * 10000) / 10000 : 0,
        companyId,
        intent: first.intent,
        recommendedCoa: first.aiRecommendedCoaCode,
        reviewerAgreement: total > 0 ? Math.round((agreedCount / total) * 10000) / 10000 : 0,
        requiresApproval: true,
        lastSeen: matchingRows[0]?.createdAt.toISOString() ?? null,
        createdAt: matchingRows[matchingRows.length - 1]?.createdAt.toISOString() ?? null,
        feedbackRecords: matchingRows.map((r) => ({
          id: r.id,
          reviewCaseId: r.reviewCaseId,
          transactionId: r.transactionId,
          aiRecommendedCoaCode: r.aiRecommendedCoaCode,
          reviewerSelectedCoaCode: r.reviewerSelectedCoaCode,
          agreement: r.agreement,
          reasonCode: r.reasonCode,
          status: r.status,
          createdAt: r.createdAt.toISOString(),
          processedAt: r.processedAt?.toISOString() ?? null,
        })),
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * GET /api/ai-review/recommendations
 * Returns rule recommendation packages (all statuses, newest first).
 */
aiLearningCenterRouter.get('/recommendations', async (req, res) => {
  if (!(await requireFinanceRole(req, res))) return;
  try {
    const companyId = resolveCompanyId(req);

    const rows = await db
      .select()
      .from(aiRuleRecommendationPackagesTable)
      .where(eq(aiRuleRecommendationPackagesTable.companyId, companyId))
      .orderBy(desc(aiRuleRecommendationPackagesTable.createdAt))
      .limit(100);

    const recommendations = rows.map((r) => {
      const payload = (r.recommendationPayloadJson ?? {}) as Record<string, unknown>;
      const suggestions = extractSuggestions(payload);
      const first = suggestions[0] ?? {};
      return {
        id: String(r.id),
        packageType: r.packageType,
        status: r.status,
        riskLevel: r.riskLevel,
        priority: r.priority,
        requiresHumanApproval: r.requiresHumanApproval,
        ruleName: String(first['ruleName'] ?? first['type'] ?? first['suggestionType'] ?? r.packageType),
        reason: String(first['reason'] ?? first['explanation'] ?? first['description'] ?? ''),
        occurrence: Number(first['occurrenceCount'] ?? first['occurrence'] ?? first['sampleCount'] ?? 0),
        confidence: Number(first['reliability'] ?? first['confidence'] ?? first['reliabilityScore'] ?? 0),
        affectedTransactions: Number(first['affectedTransactionCount'] ?? first['affectedTransactions'] ?? 0),
        recommendedCoa: String(first['dominantCoaCode'] ?? first['recommendedCoa'] ?? first['coaCode'] ?? ''),
        expectedAccuracy: Number(first['changeRate'] ?? first['expectedAccuracy'] ?? first['approvalRate'] ?? 0),
        createdBy: r.createdBy,
        reviewedBy: r.reviewedBy,
        createdAt: r.createdAt.toISOString(),
        reviewedAt: r.reviewedAt?.toISOString() ?? null,
      };
    });

    res.json({ ok: true, data: { recommendations, total: recommendations.length } });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * GET /api/ai-review/recommendations/:id
 * Returns a single recommendation package with full payload.
 */
aiLearningCenterRouter.get('/recommendations/:id', async (req, res) => {
  if (!(await requireFinanceRole(req, res))) return;
  try {
    const companyId = resolveCompanyId(req);
    const id = parseInt(req.params['id'], 10);
    if (isNaN(id)) {
      res.status(400).json({ ok: false, error: 'Invalid recommendation ID' });
      return;
    }

    const pkg = await aiRuleRecommendationRepo.findById(id, companyId);
    if (!pkg) {
      res.status(404).json({ ok: false, error: 'Recommendation not found' });
      return;
    }

    const payload = (pkg.recommendationPayloadJson ?? {}) as Record<string, unknown>;
    const simulation = (pkg.simulationPayloadJson ?? {}) as Record<string, unknown>;
    const impact = (pkg.impactPayloadJson ?? {}) as Record<string, unknown>;
    const suggestions = extractSuggestions(payload);

    res.json({
      ok: true,
      data: {
        id: String(pkg.id),
        packageType: pkg.packageType,
        status: pkg.status,
        riskLevel: pkg.riskLevel,
        priority: pkg.priority,
        requiresHumanApproval: pkg.requiresHumanApproval,
        createdBy: pkg.createdBy,
        reviewedBy: pkg.reviewedBy,
        createdAt: pkg.createdAt.toISOString(),
        reviewedAt: pkg.reviewedAt?.toISOString() ?? null,
        recommendations: suggestions.map((s, i) => mapSuggestion(s, pkg, i)),
        simulation,
        impact,
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * GET /api/ai-review/statistics
 * Returns aggregated learning and rule statistics for the company.
 */
aiLearningCenterRouter.get('/statistics', async (req, res) => {
  if (!(await requireFinanceRole(req, res))) return;
  try {
    const companyId = resolveCompanyId(req);

    const [feedbackRows, rulePackages] = await Promise.all([
      db
        .select()
        .from(aiLearningFeedbackTable)
        .where(eq(aiLearningFeedbackTable.companyId, companyId))
        .limit(2000),
      db
        .select()
        .from(aiRuleRecommendationPackagesTable)
        .where(eq(aiRuleRecommendationPackagesTable.companyId, companyId))
        .limit(500),
    ]);

    const total = feedbackRows.length;
    const agreed = feedbackRows.filter((r) => r.agreement === true).length;
    const disagreed = feedbackRows.filter((r) => r.agreement === false).length;

    const accuracy = total > 0 ? Math.round((agreed / total) * 10000) / 100 : 0; // percent
    const falsePositive = total > 0 ? Math.round((disagreed / total) * 10000) / 100 : 0;

    const approvedRules = rulePackages.filter((p) => p.status === 'APPROVED').length;
    const pendingRules = rulePackages.filter((p) => p.status === 'PENDING_REVIEW' || p.status === 'DRAFT').length;
    const ignoredRules = rulePackages.filter((p) => p.status === 'REJECTED' || p.status === 'ARCHIVED').length;

    const patternSet = new Set(
      feedbackRows.map((r) => `${r.intent ?? ''}::${r.aiRecommendedCoaCode ?? ''}`),
    );
    const learningPatterns = patternSet.size;

    // Trend: last 30 days vs prior 30 days
    const now = Date.now();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    const recent = feedbackRows.filter((r) => now - r.createdAt.getTime() <= thirtyDays);
    const prior = feedbackRows.filter(
      (r) => now - r.createdAt.getTime() > thirtyDays && now - r.createdAt.getTime() <= 2 * thirtyDays,
    );
    const recentAccuracy = recent.length > 0
      ? Math.round((recent.filter((r) => r.agreement === true).length / recent.length) * 10000) / 100
      : null;
    const priorAccuracy = prior.length > 0
      ? Math.round((prior.filter((r) => r.agreement === true).length / prior.length) * 10000) / 100
      : null;

    res.json({
      ok: true,
      data: {
        accuracy,
        falsePositive,
        falseNegative: 0, // not directly computable from current schema
        manualCorrections: disagreed,
        approvedRules,
        pendingRules,
        ignoredRules,
        learningPatterns,
        averageConfidence: accuracy,
        totalFeedback: total,
        agreedFeedback: agreed,
        disagreedFeedback: disagreed,
        totalRulePackages: rulePackages.length,
        trend: {
          recentAccuracy,
          priorAccuracy,
          direction:
            recentAccuracy !== null && priorAccuracy !== null
              ? recentAccuracy >= priorAccuracy
                ? 'up'
                : 'down'
              : 'neutral',
        },
      },
    });
  } catch (err) {
    handleError(res, err);
  }
});

/**
 * GET /api/ai-review/rules/suggestions
 * Returns rule suggestions extracted from PENDING_REVIEW packages.
 */
aiLearningCenterRouter.get('/rules/suggestions', async (req, res) => {
  if (!(await requireFinanceRole(req, res))) return;
  try {
    const companyId = resolveCompanyId(req);
    const pendingPackages = await aiRuleRecommendationRepo.listPending(companyId);

    const suggestions = pendingPackages.flatMap((pkg) => {
      const payload = (pkg.recommendationPayloadJson ?? {}) as Record<string, unknown>;
      return extractSuggestions(payload).map((s, i) => mapSuggestion(s, pkg, i));
    });

    res.json({ ok: true, data: { suggestions, total: suggestions.length } });
  } catch (err) {
    handleError(res, err);
  }
});
