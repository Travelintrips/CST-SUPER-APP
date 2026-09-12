/**
 * useAiLearning.ts
 * React Query hooks for the AI Learning & Recommendation Center.
 * All hooks are read-only — no mutations.
 */

import { useQuery } from "@tanstack/react-query";
import { aiLearningApi } from "@/lib/ai-learning-api";

// ── Query key factory ─────────────────────────────────────────────────────────

export const aiLearningKeys = {
  all: ["ai-learning"] as const,
  patterns: (limit?: number) => ["ai-learning-patterns", limit] as const,
  pattern: (id: string) => ["ai-learning-pattern", id] as const,
  recommendations: () => ["ai-learning-recommendations"] as const,
  recommendation: (id: string) => ["ai-learning-recommendation", id] as const,
  statistics: () => ["ai-learning-statistics"] as const,
  ruleSuggestions: () => ["ai-learning-rule-suggestions"] as const,
} as const;

// ── Hooks ─────────────────────────────────────────────────────────────────────

/** All learning patterns for the current company. */
export function useLearningPatterns(limit = 200) {
  return useQuery({
    queryKey: aiLearningKeys.patterns(limit),
    queryFn: () => aiLearningApi.getPatterns(limit),
    staleTime: 60_000,
  });
}

/** Single learning pattern detail. */
export function useLearningPattern(id: string | undefined | null) {
  return useQuery({
    queryKey: aiLearningKeys.pattern(id ?? ""),
    queryFn: () => aiLearningApi.getPattern(id!),
    enabled: !!id,
    staleTime: 60_000,
  });
}

/** All recommendation packages. */
export function useRecommendations() {
  return useQuery({
    queryKey: aiLearningKeys.recommendations(),
    queryFn: () => aiLearningApi.getRecommendations(),
    staleTime: 60_000,
  });
}

/** Single recommendation package detail. */
export function useRecommendation(id: string | undefined | null) {
  return useQuery({
    queryKey: aiLearningKeys.recommendation(id ?? ""),
    queryFn: () => aiLearningApi.getRecommendation(id!),
    enabled: !!id,
    staleTime: 60_000,
  });
}

/** Aggregated learning statistics. */
export function useLearningStatistics() {
  return useQuery({
    queryKey: aiLearningKeys.statistics(),
    queryFn: () => aiLearningApi.getStatistics(),
    staleTime: 60_000,
  });
}

/** Rule suggestions from pending packages. */
export function useRuleSuggestions() {
  return useQuery({
    queryKey: aiLearningKeys.ruleSuggestions(),
    queryFn: () => aiLearningApi.getRuleSuggestions(),
    staleTime: 60_000,
  });
}

// ── Summary hook (for widgets) ────────────────────────────────────────────────

/**
 * Lightweight combined hook for the AI Center dashboard widget.
 * Fetches statistics only — minimal payload.
 */
export function useAiCenterSummary() {
  const stats = useLearningStatistics();
  const recs = useRecommendations();

  return {
    isLoading: stats.isLoading || recs.isLoading,
    isError: stats.isError || recs.isError,
    data: stats.data && recs.data
      ? {
          manualReview: stats.data.manualCorrections,
          ruleRecommendations: recs.data.recommendations.filter(
            (r) => r.status === "PENDING_REVIEW" || r.status === "DRAFT",
          ).length,
          coaProposals: 0, // sourced from coaProposals endpoint when available
          learningPatterns: stats.data.learningPatterns,
          averageConfidence: stats.data.averageConfidence,
          accuracy: stats.data.accuracy,
        }
      : null,
  };
}
