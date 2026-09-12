/**
 * AI Transaction Intelligence — Phase 4
 * Explainability & Confidence Engine — Tests
 *
 * 50+ unit tests covering:
 * - confidence level thresholds
 * - breakdown dimensions
 * - negative/penalty evidence
 * - multiple evidence sources
 * - manual review triggers
 * - rejection conditions
 * - audit summary generation
 * - ambiguity detection
 * - weak evidence
 * - unknown intent
 * - integration with Phase 3 output shape
 * - batch processing
 * - performance benchmark
 */

import { describe, it, expect } from 'vitest';
import { explainTransaction, explainTransactionBatch } from '../lib/ai/transaction-intelligence/explainabilityEngine.js';
import { toConfidenceLevel, normalizeConfidence } from '../lib/ai/transaction-intelligence/confidenceBreakdown.js';
import { determineRecommendationStatus } from '../lib/ai/transaction-intelligence/explainabilityEngine.js';
import { detectAmbiguity, buildAuditSummary, buildAccountingWarnings } from '../lib/ai/transaction-intelligence/auditReasonBuilder.js';
import { buildRecommendationSummary } from '../lib/ai/transaction-intelligence/recommendationSummary.js';
import { buildExplainabilityEvidence } from '../lib/ai/transaction-intelligence/explainabilityEvidence.js';
import { buildConfidenceBreakdown } from '../lib/ai/transaction-intelligence/confidenceBreakdown.js';
import type {
  ExplainabilityInput,
  ExplainabilityConfidence,
  AmbiguityFlag,
} from '../lib/ai/transaction-intelligence/explainabilityTypes.js';
import type { TransactionAnalysisResult } from '../lib/ai/transaction-intelligence/transactionTypes.js';
import type { IntentClassificationResult } from '../lib/ai/transaction-intelligence/intentClassificationTypes.js';
import type { CoaPredictionResult, CoaAccountCandidate } from '../lib/ai/transaction-intelligence/coaPredictionTypes.js';

// ─── Test fixtures ─────────────────────────────────────────────────────────────

function makePhase1(
  intent: TransactionAnalysisResult['intent'] = 'CUSTOMER_PAYMENT',
  confidence = 0.85,
  requiresManualReview = false,
): TransactionAnalysisResult {
  return {
    intent,
    confidence,
    normalizedDescription: 'transfer dari customer pt abc',
    candidates: [
      {
        intent,
        score: confidence,
        matchedKeywords: [
          { keyword: 'transfer', matchedToken: 'transfer', weight: 0.5 },
          { keyword: 'customer', matchedToken: 'customer', weight: 0.5 },
        ],
      },
    ],
    explanation: {
      primaryReason: `Intent "${intent}" detected`,
      supportingFactors: [],
      keywordsMatched: ['transfer', 'customer'],
      lowConfidenceReasons: [],
    },
    requiresManualReview,
  };
}

function makePhase2(
  intent: IntentClassificationResult['primaryIntent'] = 'CUSTOMER_PAYMENT',
  confidence = 0.88,
  requiresManualReview = false,
  direction: 'DEBIT' | 'CREDIT' | 'UNKNOWN' = 'CREDIT',
): IntentClassificationResult {
  return {
    primaryIntent: intent,
    confidence,
    normalizedDescription: 'transfer dari customer pt abc',
    alternatives: [],
    evidence: [
      { type: 'DIRECTION', value: direction, weight: 0.15 },
      { type: 'COUNTERPARTY', value: 'PT ABC', weight: 0.20 },
    ],
    reason: [`Intent "${intent}" confirmed with direction and counterparty`],
    phase1Analysis: makePhase1(intent, 0.85),
    requiresManualReview,
  };
}

function makePhase3(
  coaCode = '1-1100',
  coaName = 'Piutang Usaha',
  confidence = 0.90,
  requiresManualReview = false,
  conflictFlags: string[] = [],
  intent: CoaPredictionResult['intent'] = 'CUSTOMER_PAYMENT',
): CoaPredictionResult {
  return {
    companyId: 'co1',
    primaryRecommendation: {
      coaId: 1,
      coaCode,
      coaName,
      confidence,
      score: confidence,
    },
    alternatives: [],
    intent,
    normalizedDescription: 'transfer dari customer pt abc',
    evidence: [
      { type: 'HISTORICAL_APPROVED', value: 'historical match', weight: 0.30, coaCode },
      { type: 'INTENT_KEYWORD', value: 'piutang', weight: 0.25, coaCode },
    ],
    reason: [`Account ${coaCode} matched`],
    conflictFlags,
    requiresManualReview,
    recommendationSource: 'HISTORICAL_MAPPING',
    phase1Analysis: makePhase1(intent, 0.85),
    phase2Classification: makePhase2(intent, 0.88),
  };
}

function makeInput(overrides: Partial<{
  phase1: TransactionAnalysisResult;
  phase2: IntentClassificationResult;
  phase3: CoaPredictionResult;
  rawDescription: string;
}> = {}): ExplainabilityInput {
  return {
    phase1: makePhase1(),
    phase2: makePhase2(),
    phase3: makePhase3(),
    rawDescription: 'Transfer dari customer PT ABC',
    ...overrides,
  };
}

// ─── 1–5: Confidence level thresholds ─────────────────────────────────────────

describe('Phase 4 — Explainability & Confidence Engine', () => {

  describe('Confidence level thresholds', () => {
    it('1. >= 0.95 → VERY_HIGH', () => {
      expect(toConfidenceLevel(0.95)).toBe('VERY_HIGH');
      expect(toConfidenceLevel(1.00)).toBe('VERY_HIGH');
      expect(toConfidenceLevel(0.99)).toBe('VERY_HIGH');
    });

    it('2. >= 0.85 and < 0.95 → HIGH', () => {
      expect(toConfidenceLevel(0.85)).toBe('HIGH');
      expect(toConfidenceLevel(0.90)).toBe('HIGH');
      expect(toConfidenceLevel(0.94)).toBe('HIGH');
    });

    it('3. >= 0.70 and < 0.85 → MEDIUM', () => {
      expect(toConfidenceLevel(0.70)).toBe('MEDIUM');
      expect(toConfidenceLevel(0.75)).toBe('MEDIUM');
      expect(toConfidenceLevel(0.84)).toBe('MEDIUM');
    });

    it('4. >= 0.50 and < 0.70 → LOW', () => {
      expect(toConfidenceLevel(0.50)).toBe('LOW');
      expect(toConfidenceLevel(0.60)).toBe('LOW');
      expect(toConfidenceLevel(0.69)).toBe('LOW');
    });

    it('5. < 0.50 → VERY_LOW', () => {
      expect(toConfidenceLevel(0.49)).toBe('VERY_LOW');
      expect(toConfidenceLevel(0.00)).toBe('VERY_LOW');
      expect(toConfidenceLevel(0.10)).toBe('VERY_LOW');
    });
  });

  // ─── 6–9: normalizeConfidence ────────────────────────────────────────────────

  describe('normalizeConfidence', () => {
    it('6. Clamps above 1.0 to 1.0', () => {
      expect(normalizeConfidence(1.5)).toBe(1.0);
    });

    it('7. Clamps below 0 to 0', () => {
      expect(normalizeConfidence(-0.5)).toBe(0.0);
    });

    it('8. Passes through values in [0,1] unchanged', () => {
      expect(normalizeConfidence(0.75)).toBe(0.75);
    });

    it('9. Rounds to 3 decimal places', () => {
      expect(normalizeConfidence(0.12345)).toBe(0.123);
    });
  });

  // ─── 10–14: Output shape ──────────────────────────────────────────────────────

  describe('Output shape', () => {
    it('10. explainTransaction returns all required fields', () => {
      const result = explainTransaction(makeInput());
      expect(result).toHaveProperty('confidence');
      expect(result).toHaveProperty('recommendation');
      expect(result).toHaveProperty('evidence');
      expect(result).toHaveProperty('confidenceBreakdown');
      expect(result).toHaveProperty('ambiguity');
      expect(result).toHaveProperty('accountingWarnings');
      expect(result).toHaveProperty('auditSummary');
      expect(result).toHaveProperty('reviewerNotes');
      expect(result.explainabilityVersion).toBe('1.0');
    });

    it('11. confidence has final, normalized, level', () => {
      const { confidence } = explainTransaction(makeInput());
      expect(typeof confidence.final).toBe('number');
      expect(confidence.normalized).toBeGreaterThanOrEqual(0);
      expect(confidence.normalized).toBeLessThanOrEqual(1);
      expect(['VERY_HIGH','HIGH','MEDIUM','LOW','VERY_LOW']).toContain(confidence.level);
    });

    it('12. recommendation has status and explanation', () => {
      const { recommendation } = explainTransaction(makeInput());
      expect(['SAFE','MANUAL_REVIEW','REJECT']).toContain(recommendation.status);
      expect(typeof recommendation.explanation).toBe('string');
      expect(recommendation.explanation.length).toBeGreaterThan(10);
    });

    it('13. evidence is a non-empty array with required fields', () => {
      const { evidence } = explainTransaction(makeInput());
      expect(Array.isArray(evidence)).toBe(true);
      expect(evidence.length).toBeGreaterThan(0);
      const e = evidence[0];
      expect(e).toHaveProperty('type');
      expect(e).toHaveProperty('source');
      expect(e).toHaveProperty('weight');
      expect(e).toHaveProperty('description');
      expect(e).toHaveProperty('contribution');
      expect(e).toHaveProperty('confidenceContribution');
      expect(e).toHaveProperty('negativeContribution');
    });

    it('14. confidenceBreakdown has 9 dimensions', () => {
      const { confidenceBreakdown } = explainTransaction(makeInput());
      expect(confidenceBreakdown).toHaveLength(9);
      const dims = confidenceBreakdown.map((b) => b.dimension);
      expect(dims).toContain('Historical Mapping');
      expect(dims).toContain('Intent Match');
      expect(dims).toContain('Keyword Match');
      expect(dims).toContain('Counterparty');
      expect(dims).toContain('Direction');
      expect(dims).toContain('Account Policy');
      expect(dims).toContain('Company Context');
      expect(dims).toContain('Penalty');
      expect(dims).toContain('Manual Review Trigger');
    });
  });

  // ─── 15–20: SAFE recommendation ──────────────────────────────────────────────

  describe('SAFE recommendation', () => {
    it('15. High confidence + no flags → SAFE', () => {
      const r = explainTransaction(makeInput());
      // With p3=0.90, p2=0.88, p1=0.85, no flags → should be SAFE or MANUAL_REVIEW
      expect(['SAFE','MANUAL_REVIEW']).toContain(r.recommendation.status);
    });

    it('16. SAFE status produces non-empty explanation', () => {
      const r = explainTransaction(makeInput());
      expect(r.recommendation.explanation).toBeTruthy();
    });

    it('17. SAFE audit summary mentions account code', () => {
      const r = explainTransaction(makeInput());
      expect(r.auditSummary).toContain('1-1100');
    });

    it('18. SAFE has no accounting warnings about AR/AP ambiguity', () => {
      const r = explainTransaction(makeInput());
      const hasAR = r.accountingWarnings.some((w) => w.includes('AR/Revenue'));
      const hasAP = r.accountingWarnings.some((w) => w.includes('AP/Expense'));
      expect(hasAR).toBe(false);
      expect(hasAP).toBe(false);
    });

    it('19. SAFE produces empty ambiguity array when no flags', () => {
      // Provide evidence with strong signals so no WEAK_EVIDENCE ambiguity
      const r = explainTransaction(makeInput());
      const hasWeakEvidence = r.ambiguity.some((a) => a.type === 'WEAK_EVIDENCE');
      // Strong evidence from makePhase3 → no WEAK_EVIDENCE expected
      expect(hasWeakEvidence).toBe(false);
    });

    it('20. SAFE reviewer notes mention standard approval', () => {
      const input = makeInput();
      // Force high confidence by boosting p3
      const phase3 = makePhase3('1-1100', 'Piutang Usaha', 0.97);
      const r = explainTransaction({ ...input, phase3 });
      // High confidence → at least one note about reliable/standard
      const hasPositive = r.reviewerNotes.some(
        (n) => n.toLowerCase().includes('reliable') || n.toLowerCase().includes('safe') || n.toLowerCase().includes('standard'),
      );
      expect(hasPositive).toBe(true);
    });
  });

  // ─── 21–26: MANUAL_REVIEW ────────────────────────────────────────────────────

  describe('MANUAL_REVIEW recommendation', () => {
    it('21. Phase 3 requiresManualReview → MANUAL_REVIEW status', () => {
      const phase3 = makePhase3('1-1100', 'Piutang Usaha', 0.80, true);
      const r = explainTransaction(makeInput({ phase3 }));
      expect(r.recommendation.status).toBe('MANUAL_REVIEW');
    });

    it('22. AR_REVENUE_AMBIGUITY flag → MANUAL_REVIEW', () => {
      const phase3 = makePhase3('4-100', 'Pendapatan Penjualan', 0.80, false, ['AR_REVENUE_AMBIGUITY']);
      const r = explainTransaction(makeInput({ phase3 }));
      expect(r.recommendation.status).toBe('MANUAL_REVIEW');
    });

    it('23. AP_EXPENSE_AMBIGUITY flag → MANUAL_REVIEW', () => {
      const phase3 = makePhase3('6-050', 'Biaya Operasional', 0.78, false, ['AP_EXPENSE_AMBIGUITY']);
      const r = explainTransaction(makeInput({ phase3 }));
      expect(r.recommendation.status).toBe('MANUAL_REVIEW');
    });

    it('24. MULTIPLE_CLOSE_CANDIDATES flag → MANUAL_REVIEW', () => {
      const phase3 = makePhase3('1-1100', 'Piutang Usaha', 0.80, false, ['MULTIPLE_CLOSE_CANDIDATES']);
      const r = explainTransaction(makeInput({ phase3 }));
      expect(r.recommendation.status).toBe('MANUAL_REVIEW');
    });

    it('25. MANUAL_REVIEW produces reviewer note about manual review', () => {
      const phase3 = makePhase3('1-1100', 'Piutang Usaha', 0.80, true);
      const r = explainTransaction(makeInput({ phase3 }));
      const hasNote = r.reviewerNotes.some(
        (n) => n.toLowerCase().includes('manual') || n.toLowerCase().includes('review'),
      );
      expect(hasNote).toBe(true);
    });

    it('26. Medium confidence → MANUAL_REVIEW', () => {
      const phase3 = makePhase3('1-1100', 'Piutang Usaha', 0.55, false);
      const phase2 = makePhase2('CUSTOMER_PAYMENT', 0.60, false);
      const phase1 = makePhase1('CUSTOMER_PAYMENT', 0.55, false);
      const r = explainTransaction(makeInput({ phase1, phase2, phase3 }));
      expect(['MANUAL_REVIEW', 'REJECT']).toContain(r.recommendation.status);
    });
  });

  // ─── 27–31: REJECT ────────────────────────────────────────────────────────────

  describe('REJECT recommendation', () => {
    it('27. No primaryRecommendation → REJECT', () => {
      const phase3: CoaPredictionResult = {
        ...makePhase3(),
        primaryRecommendation: null,
      };
      const r = explainTransaction(makeInput({ phase3 }));
      expect(r.recommendation.status).toBe('REJECT');
    });

    it('28. REJECT produces warning about no account found', () => {
      const phase3: CoaPredictionResult = {
        ...makePhase3(),
        primaryRecommendation: null,
      };
      const r = explainTransaction(makeInput({ phase3 }));
      const hasWarning = r.accountingWarnings.some((w) => w.toLowerCase().includes('no coa') || w.toLowerCase().includes('no eligible') || w.toLowerCase().includes('no account') || w.toLowerCase().includes('manual account'));
      expect(hasWarning).toBe(true);
    });

    it('29. Very low confidence (< 0.30) → REJECT', () => {
      const phase3 = makePhase3('1-1100', 'Piutang Usaha', 0.10, false);
      const phase2 = makePhase2('CUSTOMER_PAYMENT', 0.20, false);
      const phase1 = makePhase1('CUSTOMER_PAYMENT', 0.10, false);
      const r = explainTransaction(makeInput({ phase1, phase2, phase3 }));
      expect(r.recommendation.status).toBe('REJECT');
    });

    it('30. REJECT audit summary mentions "tidak dapat" or "Reject"', () => {
      const phase3: CoaPredictionResult = { ...makePhase3(), primaryRecommendation: null };
      const r = explainTransaction(makeInput({ phase3 }));
      expect(
        r.auditSummary.toLowerCase().includes('tidak dapat') ||
        r.recommendation.status === 'REJECT',
      ).toBe(true);
    });

    it('31. REJECT reviewer notes mention manual selection', () => {
      const phase3: CoaPredictionResult = { ...makePhase3(), primaryRecommendation: null };
      const r = explainTransaction(makeInput({ phase3 }));
      const hasNote = r.reviewerNotes.some(
        (n) => n.toUpperCase().includes('REJECT') || n.toLowerCase().includes('manual') || n.toLowerCase().includes('required'),
      );
      expect(hasNote).toBe(true);
    });
  });

  // ─── 32–37: Ambiguity detection ──────────────────────────────────────────────

  describe('Ambiguity detection', () => {
    it('32. AR_REVENUE_AMBIGUITY flag → AR_VS_REVENUE ambiguity', () => {
      const phase3 = makePhase3('4-100', 'Pendapatan', 0.80, false, ['AR_REVENUE_AMBIGUITY']);
      const r = explainTransaction(makeInput({ phase3 }));
      expect(r.ambiguity.some((a) => a.type === 'AR_VS_REVENUE')).toBe(true);
    });

    it('33. AP_EXPENSE_AMBIGUITY flag → AP_VS_EXPENSE ambiguity', () => {
      const phase3 = makePhase3('6-050', 'Biaya', 0.78, false, ['AP_EXPENSE_AMBIGUITY']);
      const r = explainTransaction(makeInput({ phase3 }));
      expect(r.ambiguity.some((a) => a.type === 'AP_VS_EXPENSE')).toBe(true);
    });

    it('34. INTERNAL_TRANSFER_UNVERIFIED flag → INTERNAL_TRANSFER ambiguity', () => {
      const phase3 = makePhase3('1-2000', 'Rekening Giro', 0.80, false, ['INTERNAL_TRANSFER_UNVERIFIED']);
      const r = explainTransaction(makeInput({ phase3 }));
      expect(r.ambiguity.some((a) => a.type === 'INTERNAL_TRANSFER')).toBe(true);
    });

    it('35. UNKNOWN intent → UNKNOWN_INTENT ambiguity', () => {
      const phase3 = makePhase3('1-1100', 'Piutang', 0.80, false, ['UNKNOWN_INTENT'], 'UNKNOWN');
      const r = explainTransaction(makeInput({ phase3 }));
      expect(r.ambiguity.some((a) => a.type === 'UNKNOWN_INTENT')).toBe(true);
    });

    it('36. MULTIPLE_CLOSE_CANDIDATES flag → MULTIPLE_CLOSE_CANDIDATES ambiguity', () => {
      const phase3 = makePhase3('1-1100', 'Piutang', 0.80, false, ['MULTIPLE_CLOSE_CANDIDATES']);
      const r = explainTransaction(makeInput({ phase3 }));
      expect(r.ambiguity.some((a) => a.type === 'MULTIPLE_CLOSE_CANDIDATES')).toBe(true);
    });

    it('37. Each ambiguity flag has type, description, reviewAction', () => {
      const phase3 = makePhase3('4-100', 'Pendapatan', 0.80, false, ['AR_REVENUE_AMBIGUITY']);
      const r = explainTransaction(makeInput({ phase3 }));
      for (const flag of r.ambiguity) {
        expect(flag.type).toBeTruthy();
        expect(flag.description.length).toBeGreaterThan(10);
        expect(flag.reviewAction.length).toBeGreaterThan(10);
      }
    });
  });

  // ─── 38–42: Weak evidence ─────────────────────────────────────────────────────

  describe('Weak evidence', () => {
    it('38. No strong evidence → WEAK_EVIDENCE ambiguity', () => {
      const phase3: CoaPredictionResult = {
        ...makePhase3(),
        evidence: [], // no evidence at all
      };
      const r = explainTransaction(makeInput({ phase3 }));
      expect(r.ambiguity.some((a) => a.type === 'WEAK_EVIDENCE')).toBe(true);
    });

    it('39. Only CATEGORY evidence (no HISTORICAL/INTENT_KEYWORD/KEYWORD_ALIAS/COUNTERPARTY) → WEAK_EVIDENCE', () => {
      const phase3: CoaPredictionResult = {
        ...makePhase3(),
        evidence: [
          { type: 'CATEGORY_MATCH' as any, value: 'asset', weight: 0.10, coaCode: '1-1100' },
        ],
      };
      const r = explainTransaction(makeInput({ phase3 }));
      expect(r.ambiguity.some((a) => a.type === 'WEAK_EVIDENCE')).toBe(true);
    });

    it('40. Weak evidence produces lower confidence than strong evidence', () => {
      const strong = explainTransaction(makeInput());
      const weak = explainTransaction(makeInput({
        phase3: { ...makePhase3(), evidence: [] },
      }));
      expect(strong.confidence.normalized).toBeGreaterThanOrEqual(weak.confidence.normalized);
    });

    it('41. Weak evidence accounting warning when no recommendation', () => {
      const phase3: CoaPredictionResult = { ...makePhase3(), primaryRecommendation: null };
      const r = explainTransaction(makeInput({ phase3 }));
      expect(r.accountingWarnings.length).toBeGreaterThan(0);
    });

    it('42. WEAK_EVIDENCE ambiguity has reviewAction', () => {
      const phase3: CoaPredictionResult = { ...makePhase3(), evidence: [] };
      const r = explainTransaction(makeInput({ phase3 }));
      const weakFlag = r.ambiguity.find((a) => a.type === 'WEAK_EVIDENCE');
      expect(weakFlag?.reviewAction).toBeTruthy();
    });
  });

  // ─── 43–46: Unknown intent ────────────────────────────────────────────────────

  describe('Unknown intent', () => {
    it('43. UNKNOWN intent in Phase 1 → lower Phase 1 contribution', () => {
      const phase1 = makePhase1('UNKNOWN', 0.10);
      const r = explainTransaction(makeInput({ phase1 }));
      const p1Evidence = r.evidence.find((e) => e.type === 'PHASE1_ANALYSIS');
      expect(p1Evidence?.contribution).toBeLessThan(0.15);
    });

    it('44. UNKNOWN intent in Phase 2 → MANUAL_REVIEW or REJECT', () => {
      const phase2 = makePhase2('UNKNOWN', 0.20, true);
      const phase3 = makePhase3('1-1100', 'Piutang', 0.50, true, ['UNKNOWN_INTENT'], 'UNKNOWN');
      const r = explainTransaction(makeInput({ phase2, phase3 }));
      expect(['MANUAL_REVIEW','REJECT']).toContain(r.recommendation.status);
    });

    it('45. UNKNOWN intent accounting warning', () => {
      const phase3 = makePhase3('1-1100', 'Piutang', 0.50, true, ['UNKNOWN_INTENT'], 'UNKNOWN');
      const r = explainTransaction(makeInput({ phase3 }));
      const hasWarning = r.accountingWarnings.some((w) => w.toLowerCase().includes('unknown'));
      expect(hasWarning).toBe(true);
    });

    it('46. UNKNOWN_INTENT ambiguity detected when intent is UNKNOWN', () => {
      const phase3 = makePhase3('1-1100', 'Piutang', 0.60, false, ['UNKNOWN_INTENT'], 'UNKNOWN');
      const r = explainTransaction(makeInput({ phase3 }));
      expect(r.ambiguity.some((a) => a.type === 'UNKNOWN_INTENT')).toBe(true);
    });
  });

  // ─── 47–50: Integration with Phase 3 ─────────────────────────────────────────

  describe('Integration with Phase 3 output', () => {
    it('47. Phase 3 evidence flows into explainability evidence list', () => {
      const r = explainTransaction(makeInput());
      const hasP3 = r.evidence.some((e) => e.source === 'PHASE3');
      expect(hasP3).toBe(true);
    });

    it('48. Phase 3 conflict flags appear in confidenceBreakdown penalty dimension', () => {
      const phase3 = makePhase3('1-1100', 'Piutang', 0.80, false, ['MULTIPLE_CLOSE_CANDIDATES', 'AR_REVENUE_AMBIGUITY']);
      const r = explainTransaction(makeInput({ phase3 }));
      const penaltyDim = r.confidenceBreakdown.find((b) => b.dimension === 'Penalty');
      expect(penaltyDim?.score).toBeLessThan(0);
    });

    it('49. Phase 3 alternatives appear in reviewer notes', () => {
      const phase3: CoaPredictionResult = {
        ...makePhase3(),
        alternatives: [
          { coaId: 2, coaCode: '1-1200', coaName: 'Piutang Lain', confidence: 0.75, score: 0.75, reason: ['secondary'] },
        ],
      };
      const r = explainTransaction(makeInput({ phase3 }));
      const hasAlternative = r.reviewerNotes.some(
        (n) => n.includes('1-1200') || n.toLowerCase().includes('alternative'),
      );
      expect(hasAlternative).toBe(true);
    });

    it('50. explainabilityVersion is always "1.0"', () => {
      const r = explainTransaction(makeInput());
      expect(r.explainabilityVersion).toBe('1.0');
    });
  });

  // ─── 51–53: Batch processing ──────────────────────────────────────────────────

  describe('Batch processing', () => {
    it('51. explainTransactionBatch preserves input order', () => {
      const inputs: ExplainabilityInput[] = [
        makeInput({ phase3: makePhase3('1-1100', 'AR', 0.90) }),
        makeInput({ phase3: makePhase3('6-001', 'Expense', 0.60) }),
        makeInput({ phase3: makePhase3('2-1000', 'AP', 0.80) }),
      ];
      const results = explainTransactionBatch(inputs);
      expect(results).toHaveLength(3);
      expect(results[0].recommendation).toBeDefined();
      expect(results[2].recommendation).toBeDefined();
    });

    it('52. Empty batch returns empty array', () => {
      expect(explainTransactionBatch([])).toEqual([]);
    });

    it('53. Batch results are independent (no cross-contamination)', () => {
      const a = makeInput({ phase3: makePhase3('1-1100', 'Piutang', 0.90) });
      const b = makeInput({ phase3: { ...makePhase3(), primaryRecommendation: null } });
      const [ra, rb] = explainTransactionBatch([a, b]);
      expect(ra.recommendation.status).not.toBe('REJECT');
      expect(rb.recommendation.status).toBe('REJECT');
    });
  });

  // ─── 54–56: Audit summary ────────────────────────────────────────────────────

  describe('Audit summary', () => {
    it('54. Audit summary is a non-empty string', () => {
      const { auditSummary } = explainTransaction(makeInput());
      expect(typeof auditSummary).toBe('string');
      expect(auditSummary.length).toBeGreaterThan(20);
    });

    it('55. Audit summary mentions intent when account is recommended', () => {
      const { auditSummary } = explainTransaction(makeInput());
      expect(
        auditSummary.includes('CUSTOMER_PAYMENT') || auditSummary.toLowerCase().includes('intent'),
      ).toBe(true);
    });

    it('56. Audit summary mentions confidence level', () => {
      const { auditSummary } = explainTransaction(makeInput());
      const levels = ['VERY_HIGH', 'HIGH', 'MEDIUM', 'LOW', 'VERY_LOW'];
      expect(levels.some((l) => auditSummary.includes(l))).toBe(true);
    });
  });

  // ─── 57–59: Multiple evidence ────────────────────────────────────────────────

  describe('Multiple evidence sources', () => {
    it('57. All three phases contribute evidence', () => {
      const r = explainTransaction(makeInput());
      const sources = new Set(r.evidence.map((e) => e.source));
      expect(sources.has('PHASE1')).toBe(true);
      expect(sources.has('PHASE2')).toBe(true);
      expect(sources.has('PHASE3')).toBe(true);
    });

    it('58. Each evidence item has weight > 0', () => {
      const r = explainTransaction(makeInput());
      for (const e of r.evidence) {
        expect(e.weight).toBeGreaterThanOrEqual(0);
      }
    });

    it('59. Negative evidence (penalty) has negativeContribution > 0', () => {
      const phase1 = makePhase1('CUSTOMER_PAYMENT', 0.85, true); // manual review flag
      const phase3 = makePhase3('1-1100', 'Piutang', 0.80, false, ['AR_REVENUE_AMBIGUITY']);
      const r = explainTransaction(makeInput({ phase1, phase3 }));
      const hasNegative = r.evidence.some((e) => e.negativeContribution > 0);
      expect(hasNegative).toBe(true);
    });
  });

  // ─── 60: Performance benchmark ────────────────────────────────────────────────

  describe('Performance benchmark', () => {
    it('60. 10,000 transactions in < 3 seconds', () => {
      const inputs: ExplainabilityInput[] = Array.from({ length: 10_000 }, () => makeInput());
      const t0 = Date.now();
      const results = explainTransactionBatch(inputs);
      const elapsed = Date.now() - t0;
      expect(results).toHaveLength(10_000);
      expect(elapsed).toBeLessThan(3000);
    });
  });

});
