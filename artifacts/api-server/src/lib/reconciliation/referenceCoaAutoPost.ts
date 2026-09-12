export type ReferenceCoaAutoPostPlan =
  | {
      shouldAttempt: true;
      code: null;
      reason: null;
    }
  | {
      shouldAttempt: false;
      code: "REFERENCE_COA_MISSING" | "REFERENCE_COA_CONFIDENCE_INSUFFICIENT";
      reason: string;
    };

/**
 * A saved Referensi COA is only eligible to create a draft automatically when
 * it explicitly names a COA and both the persisted rule and its live decision
 * have full confidence. Everything else remains reviewable with a clear reason.
 */
export function planReferenceCoaAutoPost(input: {
  targetCoaCode: string | null | undefined;
  ruleConfidence: number | null | undefined;
  decisionConfidence: number | null | undefined;
}): ReferenceCoaAutoPostPlan {
  const targetCoaCode = String(input.targetCoaCode ?? "").trim();
  if (!targetCoaCode) {
    return {
      shouldAttempt: false,
      code: "REFERENCE_COA_MISSING",
      reason: "Referensi COA cocok, tetapi belum memiliki akun COA tujuan.",
    };
  }

  if (Number(input.ruleConfidence ?? 0) < 100 || Number(input.decisionConfidence ?? 0) < 100) {
    return {
      shouldAttempt: false,
      code: "REFERENCE_COA_CONFIDENCE_INSUFFICIENT",
      reason: "Referensi COA belum memenuhi confidence 100%, sehingga draft jurnal tidak dibuat otomatis.",
    };
  }

  return { shouldAttempt: true, code: null, reason: null };
}

export const LEGACY_REFERENCE_COA_ATTEMPT_NOT_RECORDED =
  "REFERENCE_COA_ATTEMPT_NOT_RECORDED";

/**
 * Only the historical fallback state may be retried automatically. A mutation
 * with a real AUTO_POST_BLOCKED result must keep its human-review safeguard.
 */
export function isLegacyReferenceCoaRetryable(input: {
  status: string | null | undefined;
  reviewCode: string | null | undefined;
}): boolean {
  return input.status === "manual_review"
    && input.reviewCode === LEGACY_REFERENCE_COA_ATTEMPT_NOT_RECORDED;
}

export function legacyReferenceCoaReviewReason(): string {
  return "Referensi COA ditemukan, tetapi belum ada percobaan draft jurnal yang tercatat. Pilih COA & Buat Draft untuk meninjau transaksi ini.";
}