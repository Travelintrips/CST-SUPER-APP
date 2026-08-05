/**
 * useAiReview.ts
 * Reusable React Query hooks for the AI Transaction Review module.
 * All hooks enforce company isolation via backend — no companyId param needed.
 */

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/hooks/use-toast";
import {
  aiReviewApi,
  aiReviewSourceApi,
  AIReviewFilters,
  AIReviewDecisionPayload,
  AIReviewAssignPayload,
  AIReevaluatePayload,
  AICreateFromSourcePayload,
} from "@/lib/ai-review-api";

// ── Query key factory ────────────────────────────────────────────────────────

export const aiReviewKeys = {
  all: ["ai-review"] as const,
  cases: (filters: AIReviewFilters = {}) => ["ai-review-cases", filters] as const,
  detail: (id: string) => ["ai-review-detail", id] as const,
  snapshots: (id: string) => ["ai-review-snapshots", id] as const,
  audit: (id: string) => ["ai-review-audit", id] as const,
  observability: () => ["ai-review-observability"] as const,
  learningFeedback: () => ["ai-review-learning-feedback"] as const,
  rulePackages: () => ["ai-review-rule-packages"] as const,
  bySource: (source: string, sourceRecordId: string) => ["ai-review-by-source", source, sourceRecordId] as const,
} as const;

// ── Query hooks ──────────────────────────────────────────────────────────────

/**
 * List review cases with optional filters and pagination.
 * Auto-refreshes every 60 seconds.
 */
export function useAiReviewCases(filters: AIReviewFilters = {}) {
  return useQuery({
    queryKey: aiReviewKeys.cases(filters),
    queryFn: () => aiReviewApi.listCases(filters),
    refetchInterval: 60_000,
  });
}

/**
 * Fetch a single review case by ID (includes full AI analysis).
 */
export function useAiReviewDetail(id: string | undefined) {
  return useQuery({
    queryKey: aiReviewKeys.detail(id!),
    queryFn: () => aiReviewApi.getCase(id!),
    enabled: !!id,
  });
}

/**
 * Fetch snapshot history for a case.
 */
export function useAiReviewSnapshots(id: string | undefined) {
  return useQuery({
    queryKey: aiReviewKeys.snapshots(id!),
    queryFn: () => aiReviewApi.getSnapshots(id!),
    enabled: !!id,
  });
}

/**
 * Fetch append-only audit log for a case.
 */
export function useAiReviewAudit(id: string | undefined) {
  return useQuery({
    queryKey: aiReviewKeys.audit(id!),
    queryFn: () => aiReviewApi.getAudit(id!),
    enabled: !!id,
  });
}

/**
 * Fetch observability metrics. Auto-refreshes every 120 seconds.
 */
export function useAiReviewObservability() {
  return useQuery({
    queryKey: aiReviewKeys.observability(),
    queryFn: aiReviewApi.getObservability,
    refetchInterval: 120_000,
  });
}

/**
 * Fetch pending AI learning feedback (admin only).
 */
export function useAiLearningFeedback() {
  return useQuery({
    queryKey: aiReviewKeys.learningFeedback(),
    queryFn: aiReviewApi.getLearningFeedback,
  });
}

/**
 * Fetch rule packages.
 */
export function useAiRulePackages() {
  return useQuery({
    queryKey: aiReviewKeys.rulePackages(),
    queryFn: aiReviewApi.getRulePackages,
  });
}

// ── Mutation hooks ───────────────────────────────────────────────────────────

/** Helper to build a query invalidator for a specific case. */
function useInvalidateCase(id: string) {
  const qc = useQueryClient();
  return () => {
    qc.invalidateQueries({ queryKey: aiReviewKeys.detail(id) });
    qc.invalidateQueries({ queryKey: aiReviewKeys.snapshots(id) });
    qc.invalidateQueries({ queryKey: aiReviewKeys.audit(id) });
    qc.invalidateQueries({ queryKey: ["ai-review-cases"] });
  };
}

/**
 * Start reviewing a case (QUEUED/ASSIGNED → IN_REVIEW).
 * Idempotent — no payload needed.
 */
export function useStartReview(caseId: string) {
  const invalidate = useInvalidateCase(caseId);
  return useMutation({
    mutationFn: () => aiReviewApi.startReview(caseId),
    onSuccess: () => {
      toast({ title: "Review dimulai" });
      invalidate();
    },
    onError: (e) =>
      toast({ title: "Gagal memulai review", description: (e as Error).message, variant: "destructive" }),
  });
}

/**
 * Assign a reviewer to a case.
 */
export function useAssignReviewer(caseId: string) {
  const invalidate = useInvalidateCase(caseId);
  return useMutation({
    mutationFn: (payload: AIReviewAssignPayload) => aiReviewApi.assignCase(caseId, payload),
    onSuccess: () => {
      toast({ title: "Reviewer berhasil ditugaskan" });
      invalidate();
    },
    onError: (e) =>
      toast({ title: "Gagal menugaskan reviewer", description: (e as Error).message, variant: "destructive" }),
  });
}

/**
 * Submit a reviewer decision (approve / change COA / reject / request info / escalate).
 * Caller must supply an idempotency key generated via crypto.randomUUID().
 */
export function useSubmitDecision(caseId: string) {
  const invalidate = useInvalidateCase(caseId);
  return useMutation({
    mutationFn: (payload: AIReviewDecisionPayload) => aiReviewApi.submitDecision(caseId, payload),
    onSuccess: () => {
      toast({ title: "Keputusan berhasil disimpan" });
      invalidate();
    },
    onError: (e) =>
      toast({ title: "Gagal menyimpan keputusan", description: (e as Error).message, variant: "destructive" }),
  });
}

/**
 * Trigger re-evaluation of a case (admin / Finance Manager only).
 */
export function useReevaluateCase(caseId: string) {
  const invalidate = useInvalidateCase(caseId);
  return useMutation({
    mutationFn: (payload: AIReevaluatePayload) => aiReviewApi.reevaluateCase(caseId, payload),
    onSuccess: () => {
      toast({ title: "Evaluasi ulang berhasil dijadwalkan" });
      invalidate();
    },
    onError: (e) =>
      toast({ title: "Gagal menjadwalkan evaluasi ulang", description: (e as Error).message, variant: "destructive" }),
  });
}

// ── Phase 12: Source cross-link hooks ────────────────────────────────────────

/**
 * Fetch AI review case(s) linked to a specific source entity.
 * Only fires when both source and sourceRecordId are non-empty strings.
 * Cache key is scoped to source + sourceRecordId — no companyId param needed
 * (company context enforced on the backend via session).
 */
export function useAIReviewBySource(source: string | undefined | null, sourceRecordId: string | undefined | null) {
  const enabled = !!source && !!sourceRecordId;
  return useQuery({
    queryKey: aiReviewKeys.bySource(source ?? '', sourceRecordId ?? ''),
    queryFn: () => aiReviewSourceApi.getBySource(source!, sourceRecordId!),
    enabled,
    staleTime: 30_000,
  });
}

/**
 * Create an AI review case from a source entity.
 * Idempotent — backend returns existing case if already created.
 * Caller supplies idempotency through source + sourceRecordId (no random key needed).
 */
export function useCreateAIReviewFromSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: AICreateFromSourcePayload) => aiReviewSourceApi.createFromSource(payload),
    onSuccess: (result, variables) => {
      if (result.created) {
        toast({ title: "AI Review berhasil dibuat" });
      } else {
        toast({ title: "AI Review sudah ada", description: "Kasus sebelumnya ditemukan." });
      }
      // Invalidate by-source cache for this entity so badge updates
      qc.invalidateQueries({
        queryKey: aiReviewKeys.bySource(variables.source, variables.sourceRecordId),
      });
      qc.invalidateQueries({ queryKey: ["ai-review-cases"] });
    },
    onError: (e) =>
      toast({
        title: "Gagal membuat AI Review",
        description: (e as Error).message,
        variant: "destructive",
      }),
  });
}
