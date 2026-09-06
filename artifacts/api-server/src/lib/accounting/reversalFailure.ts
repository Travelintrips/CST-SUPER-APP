export const ORIGINAL_VOID_UPDATE_FAILED = "ORIGINAL_VOID_UPDATE_FAILED" as const;

export interface OriginalVoidUpdateFailureInput {
  entryId: number;
  voidEntryId: number;
  cause: unknown;
}

/**
 * A reversal entry can be committed before the original entry metadata is
 * updated. That state is not a successful void: callers must stop their
 * success/audit/cleanup path and surface the inconsistency for remediation.
 */
export function buildOriginalVoidUpdateFailureResult({
  entryId,
  voidEntryId,
  cause,
}: OriginalVoidUpdateFailureInput) {
  const detail = cause instanceof Error ? cause.message : String(cause);

  return {
    ok: false as const,
    voidEntryId,
    code: ORIGINAL_VOID_UPDATE_FAILED,
    error:
      `Reversal entry #${voidEntryId} berhasil dibuat, tetapi entry asal ` +
      `#${entryId} gagal ditandai voided: ${detail}. ` +
      "Cleanup dan pelaporan sukses dibatalkan; perlu rekonsiliasi manual.",
  };
}