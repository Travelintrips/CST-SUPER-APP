export type StartupSubstepStatus = "running" | "completed" | "failed";

export type StartupReadinessSnapshot = {
  last_completed_substep: string | null;
  current_substep: string | null;
  current_substep_started_at: string | null;
  current_substep_elapsed_ms: number | null;
  current_substep_status: StartupSubstepStatus | null;
  failed_substep: string | null;
  failed_substep_category: "timeout" | "database" | "unknown" | null;
};

type MutableState = {
  lastCompletedSubstep: string | null;
  currentSubstep: string | null;
  currentSubstepStartedAt: number | null;
  currentSubstepStatus: StartupSubstepStatus | null;
  currentSubstepElapsedMs: number | null;
  failedSubstep: string | null;
  failedSubstepCategory: StartupReadinessSnapshot["failed_substep_category"];
};

const state: MutableState = {
  lastCompletedSubstep: null,
  currentSubstep: null,
  currentSubstepStartedAt: null,
  currentSubstepStatus: null,
  currentSubstepElapsedMs: null,
  failedSubstep: null,
  failedSubstepCategory: null,
};

function elapsedSince(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

function errorCategory(error: unknown): StartupReadinessSnapshot["failed_substep_category"] {
  const message = error instanceof Error ? error.message.toLowerCase() : String(error).toLowerCase();
  if (message.includes("timeout") || message.includes("timed out")) return "timeout";
  if (
    message.includes("database") ||
    message.includes("postgres") ||
    message.includes("postgresql") ||
    message.includes("connection") ||
    message.includes("lock")
  ) {
    return "database";
  }
  return "unknown";
}

export function markStartupSubstepStarting(substep: string): void {
  state.currentSubstep = substep;
  state.currentSubstepStartedAt = Date.now();
  state.currentSubstepStatus = "running";
  state.currentSubstepElapsedMs = 0;
  state.failedSubstep = null;
  state.failedSubstepCategory = null;
}

export function markStartupSubstepCompleted(substep: string): void {
  const startedAt = state.currentSubstep === substep ? state.currentSubstepStartedAt : null;
  state.lastCompletedSubstep = substep;
  state.currentSubstep = null;
  state.currentSubstepStartedAt = null;
  state.currentSubstepStatus = null;
  state.currentSubstepElapsedMs = null;
  state.failedSubstep = null;
  state.failedSubstepCategory = null;
}

export function markStartupSubstepFailed(substep: string, error: unknown): void {
  const startedAt = state.currentSubstep === substep ? state.currentSubstepStartedAt : null;
  state.currentSubstep = substep;
  state.currentSubstepStatus = "failed";
  state.currentSubstepElapsedMs = startedAt == null ? null : elapsedSince(startedAt);
  state.failedSubstep = substep;
  state.failedSubstepCategory = errorCategory(error);
}

export function getStartupReadinessSnapshot(): StartupReadinessSnapshot {
  const currentElapsed = state.currentSubstepStartedAt == null
    ? state.currentSubstepElapsedMs
    : elapsedSince(state.currentSubstepStartedAt);
  return {
    last_completed_substep: state.lastCompletedSubstep,
    current_substep: state.currentSubstep,
    current_substep_started_at: state.currentSubstepStartedAt == null
      ? null
      : new Date(state.currentSubstepStartedAt).toISOString(),
    current_substep_elapsed_ms: currentElapsed,
    current_substep_status: state.currentSubstepStatus,
    failed_substep: state.failedSubstep,
    failed_substep_category: state.failedSubstepCategory,
  };
}
