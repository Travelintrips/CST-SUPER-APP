/**
 * AI Learning & Recommendation Center — API Client
 *
 * Typed API functions for /api/ai-review/* endpoints.
 * All calls are read-only — no mutations.
 */

import { api } from "@/lib/api";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface LearningPattern {
  id: string;
  description: string;
  occurrenceCount: number;
  confidence: number;
  companyId: number;
  intent: string | null;
  recommendedCoa: string | null;
  reviewerAgreement: number;
  requiresApproval: boolean;
  lastSeen: string | null;
  createdAt: string | null;
  reviewerSelectedCoaCodes?: string[];
}

export interface LearningPatternDetail extends LearningPattern {
  feedbackRecords: Array<{
    id: number;
    reviewCaseId: number | null;
    transactionId: string | null;
    aiRecommendedCoaCode: string | null;
    reviewerSelectedCoaCode: string | null;
    agreement: boolean | null;
    reasonCode: string | null;
    status: string;
    createdAt: string;
    processedAt: string | null;
  }>;
}

export interface RecommendationItem {
  id: string;
  packageType: string;
  status: string;
  riskLevel: string | null;
  priority: number;
  requiresHumanApproval: boolean;
  ruleName: string;
  reason: string;
  occurrence: number;
  confidence: number;
  affectedTransactions: number;
  recommendedCoa: string;
  expectedAccuracy: number;
  createdBy: string | null;
  reviewedBy: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

export interface RecommendationDetail {
  id: string;
  packageType: string;
  status: string;
  riskLevel: string | null;
  priority: number;
  requiresHumanApproval: boolean;
  createdBy: string | null;
  reviewedBy: string | null;
  createdAt: string;
  reviewedAt: string | null;
  recommendations: Array<{
    ruleName: string;
    reason: string;
    occurrence: number;
    confidence: number;
    affectedTransactions: number;
    recommendedCoa: string;
    expectedAccuracy: number;
    requiresHumanApproval: boolean;
    packageType: string;
    riskLevel: string | null;
  }>;
  simulation: Record<string, unknown>;
  impact: Record<string, unknown>;
}

export interface LearningStatistics {
  accuracy: number;
  falsePositive: number;
  falseNegative: number;
  manualCorrections: number;
  approvedRules: number;
  pendingRules: number;
  ignoredRules: number;
  learningPatterns: number;
  averageConfidence: number;
  totalFeedback: number;
  agreedFeedback: number;
  disagreedFeedback: number;
  totalRulePackages: number;
  trend: {
    recentAccuracy: number | null;
    priorAccuracy: number | null;
    direction: "up" | "down" | "neutral";
  };
}

export interface RuleSuggestion {
  id: string;
  packageId: number;
  ruleName: string;
  reason: string;
  occurrence: number;
  confidence: number;
  affectedTransactions: number;
  recommendedCoa: string;
  expectedAccuracy: number;
  requiresHumanApproval: boolean;
  packageType: string;
  riskLevel: string | null;
}

// ── API ────────────────────────────────────────────────────────────────────────

export const aiLearningApi = {
  /** Fetch all learning patterns for the current company. */
  getPatterns: async (limit = 200): Promise<{ patterns: LearningPattern[]; total: number }> => {
    const { data } = await api.get<{ ok: true; data: { patterns: LearningPattern[]; total: number } }>(
      `/api/ai-review/learning?limit=${limit}`,
    );
    return data.data;
  },

  /** Fetch a single learning pattern by id. */
  getPattern: async (id: string): Promise<LearningPatternDetail> => {
    const { data } = await api.get<{ ok: true; data: LearningPatternDetail }>(
      `/api/ai-review/learning/${encodeURIComponent(id)}`,
    );
    return data.data;
  },

  /** Fetch all recommendation packages. */
  getRecommendations: async (): Promise<{ recommendations: RecommendationItem[]; total: number }> => {
    const { data } = await api.get<{ ok: true; data: { recommendations: RecommendationItem[]; total: number } }>(
      `/api/ai-review/recommendations`,
    );
    return data.data;
  },

  /** Fetch a single recommendation package by id. */
  getRecommendation: async (id: string): Promise<RecommendationDetail> => {
    const { data } = await api.get<{ ok: true; data: RecommendationDetail }>(
      `/api/ai-review/recommendations/${encodeURIComponent(id)}`,
    );
    return data.data;
  },

  /** Fetch aggregated learning statistics. */
  getStatistics: async (): Promise<LearningStatistics> => {
    const { data } = await api.get<{ ok: true; data: LearningStatistics }>(
      `/api/ai-review/statistics`,
    );
    return data.data;
  },

  /** Fetch rule suggestions from pending packages. */
  getRuleSuggestions: async (): Promise<{ suggestions: RuleSuggestion[]; total: number }> => {
    const { data } = await api.get<{ ok: true; data: { suggestions: RuleSuggestion[]; total: number } }>(
      `/api/ai-review/rules/suggestions`,
    );
    return data.data;
  },
};
