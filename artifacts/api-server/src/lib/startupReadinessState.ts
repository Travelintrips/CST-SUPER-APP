export type StartupSubstepStatus = "running" | "completed" | "failed";
export type StartupStageStatus = "running" | "completed" | "failed";
export type StartupPhaseStatus = "running" | "completed" | "failed";
export type ModuleReadiness = "ready" | "not_ready" | "not_started";
export type StartupNamedSubstepStatus =
  | "pending"
  | StartupSubstepStatus;

export type StartupReadinessSnapshot = {
  current_stage: string | null;
  current_stage_started_at: string | null;
  current_stage_elapsed_ms: number | null;
  current_stage_status: StartupStageStatus | null;
  last_completed_stage: string | null;
  last_completed_substep: string | null;
  current_substep: string | null;
  current_substep_started_at: string | null;
  current_substep_elapsed_ms: number | null;
  current_substep_status: StartupSubstepStatus | null;
  failed_stage: string | null;
  failed_substep: string | null;
  failed_substep_error: {
    category: "timeout" | "database" | "unknown";
    error_name: string;
    error_code: string | null;
    operation: string;
  } | null;
  failed_substep_category: "timeout" | "database" | "unknown" | null;
  startup_registry_progress: {
    completed_stages: number;
    total_stages: number;
    current_stage_name: string | null;
  };
  seed_phase: {
    name: string | null;
    status: StartupPhaseStatus | null;
    elapsed_ms: number | null;
  };
  migration_finalize_status: StartupPhaseStatus | null;
  global_ready: boolean;
  customer_portal_ready: boolean;
  sport_center_ready: boolean;
  customer_portal_required_stages: {
    completed: string[];
    missing: string[];
  };
};

type MutableState = {
  currentStage: string | null;
  currentStageStartedAt: number | null;
  currentStageStatus: StartupStageStatus | null;
  lastCompletedStage: string | null;
  lastCompletedSubstep: string | null;
  currentSubstep: string | null;
  currentSubstepStartedAt: number | null;
  currentSubstepStatus: StartupSubstepStatus | null;
  currentSubstepElapsedMs: number | null;
  failedStage: string | null;
  failedSubstep: string | null;
  failedSubstepError: StartupReadinessSnapshot["failed_substep_error"];
  failedSubstepCategory: StartupReadinessSnapshot["failed_substep_category"];
  registryCompletedStages: number;
  registryTotalStages: number;
  registryCurrentStageName: string | null;
  seedPhaseName: string | null;
  seedPhaseStartedAt: number | null;
  seedPhaseStatus: StartupPhaseStatus | null;
  migrationFinalizeStatus: StartupPhaseStatus | null;
  completedStageNames: Set<string>;
  failedStageNames: Set<string>;
  coreDatabaseReady: boolean;
  namedSubstepStatuses: Map<string, StartupSubstepStatus>;
};

const state: MutableState = {
  currentStage: null,
  currentStageStartedAt: null,
  currentStageStatus: null,
  lastCompletedStage: null,
  lastCompletedSubstep: null,
  currentSubstep: null,
  currentSubstepStartedAt: null,
  currentSubstepStatus: null,
  currentSubstepElapsedMs: null,
  failedStage: null,
  failedSubstep: null,
  failedSubstepError: null,
  failedSubstepCategory: null,
  registryCompletedStages: 0,
  registryTotalStages: 0,
  registryCurrentStageName: null,
  seedPhaseName: null,
  seedPhaseStartedAt: null,
  seedPhaseStatus: null,
  migrationFinalizeStatus: null,
  completedStageNames: new Set(),
  failedStageNames: new Set(),
  coreDatabaseReady: false,
  namedSubstepStatuses: new Map(),
};

function elapsedSince(startedAt: number): number {
  return Math.max(0, Date.now() - startedAt);
}

function phaseElapsed(startedAt: number | null, status: StartupPhaseStatus | null): number | null {
  if (startedAt == null) return null;
  return status === "running" ? elapsedSince(startedAt) : Math.max(0, Date.now() - startedAt);
}

function errorCategory(
  error: unknown,
): NonNullable<StartupReadinessSnapshot["failed_substep_category"]> {
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

function safeErrorName(error: unknown): string {
  if (error instanceof Error && error.name && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error.name)) {
    return error.name;
  }
  return "Error";
}

function safeErrorCode(error: unknown): string | null {
  const code = error && typeof error === "object" && "code" in error
    ? (error as { code?: unknown }).code
    : null;
  return typeof code === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(code)
    ? code
    : null;
}

export function markStartupSubstepStarting(substep: string): void {
  state.namedSubstepStatuses.set(substep, "running");
  state.currentSubstep = substep;
  state.currentSubstepStartedAt = Date.now();
  state.currentSubstepStatus = "running";
  state.currentSubstepElapsedMs = 0;
  state.failedSubstep = null;
  state.failedSubstepError = null;
  state.failedSubstepCategory = null;
}

export function markStartupStageStarting(stage: string, stageName = stage): void {
  state.currentStage = stage;
  state.currentStageStartedAt = Date.now();
  state.currentStageStatus = "running";
  state.failedStage = null;
  state.failedStageNames.delete(stageName);
}

export function markStartupStageCompleted(stage: string, stageName = stage): void {
  state.lastCompletedStage = stage;
  state.currentStage = null;
  state.currentStageStartedAt = null;
  state.currentStageStatus = null;
  state.failedStage = null;
  state.completedStageNames.add(stageName);
  state.failedStageNames.delete(stageName);
}

export function markStartupStageFailed(stage: string, stageName = stage): void {
  state.currentStage = stage;
  state.currentStageStatus = "failed";
  state.failedStage = stage;
  state.failedStageNames.add(stageName);
}

export function markCoreDatabaseReady(): void {
  state.coreDatabaseReady = true;
}

const CUSTOMER_PORTAL_REQUIRED_STAGES = [
  "pre_start_schema",
  "sessions",
  "portal",
  "oauth_state",
] as const;

export function getModuleReadiness(globalReady: boolean): {
  global_ready: boolean;
  customer_portal_ready: boolean;
  sport_center_ready: boolean;
  customer_portal_required_stages: { completed: string[]; missing: string[] };
} {
  const completed = CUSTOMER_PORTAL_REQUIRED_STAGES.filter((stage) =>
    state.completedStageNames.has(stage),
  );
  const missing = CUSTOMER_PORTAL_REQUIRED_STAGES.filter((stage) =>
    !state.completedStageNames.has(stage),
  );
  return evaluateModuleReadiness(
    globalReady,
    state.coreDatabaseReady,
    completed,
    missing,
    state.completedStageNames.has("sport_center"),
  );
}

export function evaluateModuleReadiness(
  globalReady: boolean,
  coreDatabaseReady: boolean,
  completed: readonly string[],
  missing: readonly string[],
  sportCenterReady: boolean,
): {
  global_ready: boolean;
  customer_portal_ready: boolean;
  sport_center_ready: boolean;
  customer_portal_required_stages: { completed: string[]; missing: string[] };
} {
  return {
    global_ready: globalReady,
    customer_portal_ready: coreDatabaseReady && missing.length === 0,
    sport_center_ready: sportCenterReady,
    customer_portal_required_stages: {
      completed: [...completed],
      missing: [...missing],
    },
  };
}

export function setStartupRegistryProgress(
  completedStages: number,
  totalStages: number,
  currentStageName: string | null,
): void {
  state.registryCompletedStages = Math.max(0, completedStages);
  state.registryTotalStages = Math.max(0, totalStages);
  state.registryCurrentStageName = currentStageName;
}

export function markStartupSeedPhaseStarting(phase: string): void {
  state.seedPhaseName = phase;
  state.seedPhaseStartedAt = Date.now();
  state.seedPhaseStatus = "running";
}

export function markStartupSeedPhaseCompleted(phase: string): void {
  state.seedPhaseName = phase;
  state.seedPhaseStatus = "completed";
}

export function markStartupSeedPhaseFailed(phase: string): void {
  state.seedPhaseName = phase;
  state.seedPhaseStatus = "failed";
}

export function markMigrationFinalizeStarting(): void {
  state.migrationFinalizeStatus = "running";
}

export function markMigrationFinalizeCompleted(): void {
  state.migrationFinalizeStatus = "completed";
}

export function markMigrationFinalizeFailed(): void {
  state.migrationFinalizeStatus = "failed";
}

export function markStartupSubstepCompleted(substep: string): void {
  state.namedSubstepStatuses.set(substep, "completed");
  const startedAt = state.currentSubstep === substep ? state.currentSubstepStartedAt : null;
  state.lastCompletedSubstep = substep;
  state.currentSubstep = null;
  state.currentSubstepStartedAt = null;
  state.currentSubstepStatus = null;
  state.currentSubstepElapsedMs = null;
  state.failedSubstep = null;
  state.failedSubstepError = null;
  state.failedSubstepCategory = null;
}

export function markStartupSubstepFailed(substep: string, error: unknown): void {
  state.namedSubstepStatuses.set(substep, "failed");
  const startedAt = state.currentSubstep === substep ? state.currentSubstepStartedAt : null;
  state.currentSubstep = substep;
  state.currentSubstepStatus = "failed";
  state.currentSubstepElapsedMs = startedAt == null ? null : elapsedSince(startedAt);
  state.failedSubstep = substep;
  state.failedSubstepCategory = errorCategory(error);
  state.failedSubstepError = {
    category: state.failedSubstepCategory,
    error_name: safeErrorName(error),
    error_code: safeErrorCode(error),
    operation: substep,
  };
}

export function getStartupSubstepStatus(
  substep: string,
): StartupNamedSubstepStatus {
  return state.namedSubstepStatuses.get(substep) ?? "pending";
}

export function getStartupReadinessSnapshot(): StartupReadinessSnapshot {
  const currentElapsed = state.currentSubstepStartedAt == null
    ? state.currentSubstepElapsedMs
    : elapsedSince(state.currentSubstepStartedAt);
  return {
    current_stage: state.currentStage,
    current_stage_started_at: state.currentStageStartedAt == null
      ? null
      : new Date(state.currentStageStartedAt).toISOString(),
    current_stage_elapsed_ms: state.currentStageStartedAt == null
      ? null
      : elapsedSince(state.currentStageStartedAt),
    current_stage_status: state.currentStageStatus,
    last_completed_stage: state.lastCompletedStage,
    last_completed_substep: state.lastCompletedSubstep,
    current_substep: state.currentSubstep,
    current_substep_started_at: state.currentSubstepStartedAt == null
      ? null
      : new Date(state.currentSubstepStartedAt).toISOString(),
    current_substep_elapsed_ms: currentElapsed,
    current_substep_status: state.currentSubstepStatus,
    failed_stage: state.failedStage,
    failed_substep: state.failedSubstep,
    failed_substep_error: state.failedSubstepError,
    failed_substep_category: state.failedSubstepCategory,
    startup_registry_progress: {
      completed_stages: state.registryCompletedStages,
      total_stages: state.registryTotalStages,
      current_stage_name: state.registryCurrentStageName,
    },
    seed_phase: {
      name: state.seedPhaseName,
      status: state.seedPhaseStatus,
      elapsed_ms: phaseElapsed(state.seedPhaseStartedAt, state.seedPhaseStatus),
    },
    migration_finalize_status: state.migrationFinalizeStatus,
    ...getModuleReadiness(false),
  };
}
