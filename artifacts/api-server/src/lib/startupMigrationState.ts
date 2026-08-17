import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { PoolClient } from "pg";
import { logger } from "./logger.js";

export type StartupMigrationStatus = "pending" | "running" | "completed" | "failed";

export interface StartupStageDefinition {
  name: string;
  version: number;
  critical: boolean;
  category: "schema" | "seed" | "backfill" | "repair" | "reconciliation" | "runtime";
}

export interface StartupStageResult<T> {
  status: "skipped" | "completed";
  value?: T;
}

const STARTUP_STATE_TABLE = "startup_migration_state";
const LOCK_WAIT_TIMEOUT_MS = 30_000;
const LOCK_POLL_MS = 250;
let storeReady: Promise<void> | null = null;

function versionText(version: string | number): string {
  return String(version);
}

function sanitizeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return raw
    .replace(/(postgres(?:ql)?:\/\/)([^@\s]+)@/gi, "$1[redacted]@")
    .replace(/(password|token|secret|api[_-]?key|authorization)\s*[=:]\s*\S+/gi, "$1=[redacted]")
    .replace(/\bBearer\s+\S+/gi, "Bearer [redacted]")
    .slice(0, 1_000);
}

async function ensureStartupStateStore(): Promise<void> {
  if (!storeReady) {
    storeReady = db.execute(sql`
      CREATE TABLE IF NOT EXISTS startup_migration_state (
        stage_name    TEXT PRIMARY KEY,
        stage_version TEXT NOT NULL,
        status        TEXT NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending', 'running', 'completed', 'failed')),
        started_at    TIMESTAMPTZ,
        completed_at  TIMESTAMPTZ,
        last_error    TEXT,
        updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
      )
    `).then(() => undefined).catch((error) => {
      storeReady = null;
      throw error;
    });
  }
  await storeReady;
}

async function readCompletedVersion(name: string): Promise<string | null> {
  const result = await db.execute(sql`
    SELECT stage_version
    FROM startup_migration_state
    WHERE stage_name = ${name}
      AND status = 'completed'
    LIMIT 1
  `);
  return String(
    (result.rows[0] as { stage_version?: unknown } | undefined)?.stage_version ?? "",
  ) || null;
}

async function updateState(
  name: string,
  version: string | number,
  status: StartupMigrationStatus,
  lastError: string | null = null,
): Promise<void> {
  await db.execute(sql`
    INSERT INTO startup_migration_state
      (stage_name, stage_version, status, started_at, completed_at, last_error, updated_at)
    VALUES (
      ${name},
      ${versionText(version)},
      ${status},
      CASE WHEN ${status} = 'running' THEN NOW() ELSE NULL END,
      CASE WHEN ${status} = 'completed' THEN NOW() ELSE NULL END,
      ${lastError},
      NOW()
    )
    ON CONFLICT (stage_name) DO UPDATE SET
      stage_version = EXCLUDED.stage_version,
      status = EXCLUDED.status,
      started_at = CASE
        WHEN EXCLUDED.status = 'running' THEN NOW()
        ELSE startup_migration_state.started_at
      END,
      completed_at = CASE
        WHEN EXCLUDED.status = 'completed' THEN NOW()
        ELSE NULL
      END,
      last_error = EXCLUDED.last_error,
      updated_at = NOW()
  `);
}

async function acquireStageLock(name: string): Promise<PoolClient> {
  const client = await pool.connect();
  const startedAt = performance.now();
  try {
    while (performance.now() - startedAt < LOCK_WAIT_TIMEOUT_MS) {
      const result = await client.query<{ locked: boolean }>(
        "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked",
        [`startup-migration:${name}`],
      );
      if (result.rows[0]?.locked) return client;
      await new Promise((resolve) => setTimeout(resolve, LOCK_POLL_MS));
    }
    throw new Error(`startup migration lock timeout for ${name}`);
  } catch (error) {
    client.release();
    throw error;
  }
}

async function releaseStageLock(client: PoolClient, name: string): Promise<void> {
  try {
    await client.query(
      "SELECT pg_advisory_unlock(hashtextextended($1, 0))",
      [`startup-migration:${name}`],
    );
  } finally {
    client.release();
  }
}

/**
 * Run one serial startup stage under a persistent version gate.
 *
 * The marker is only completed after `run` resolves. A process crash while
 * holding the advisory lock releases the lock; the next process sees the
 * non-completed marker and safely takes the stage over.
 */
export async function runStartupMigrationStage<T>(
  stage: StartupStageDefinition,
  run: () => Promise<T>,
): Promise<StartupStageResult<T>> {
  const lookupStartedAt = performance.now();
  await ensureStartupStateStore();
  const storedVersion = await readCompletedVersion(stage.name);
  const registryLookupMs = Math.max(0, Math.round(performance.now() - lookupStartedAt));

  logger.info(
    { name: stage.name, version: stage.version, registry_lookup_ms: registryLookupMs },
    `[startup-stage] CHECK name=${stage.name} version=${stage.version}`,
  );
  if (storedVersion === versionText(stage.version)) {
    logger.info(
      { name: stage.name, version: stage.version, registry_lookup_ms: registryLookupMs },
      `[startup-stage] SKIP name=${stage.name} version=${stage.version} reason=already_completed`,
    );
    return { status: "skipped" };
  }

  const lockStartedAt = performance.now();
  const lock = await acquireStageLock(stage.name);
  const lockWaitMs = Math.max(0, Math.round(performance.now() - lockStartedAt));
  try {
    // Mandatory TOCTOU re-check after acquiring the per-stage lock.
    const lockedStoredVersion = await readCompletedVersion(stage.name);
    if (lockedStoredVersion === versionText(stage.version)) {
      logger.info(
        { name: stage.name, version: stage.version, lock_wait_ms: lockWaitMs },
        `[startup-stage] SKIP name=${stage.name} version=${stage.version} reason=already_completed`,
      );
      return { status: "skipped" };
    }

    const metadataStartedAt = performance.now();
    await updateState(stage.name, stage.version, "running");
    const metadataWriteMs = Math.max(0, Math.round(performance.now() - metadataStartedAt));
    logger.info(
      {
        name: stage.name,
        version: stage.version,
        lock_wait_ms: lockWaitMs,
        metadata_write_ms: metadataWriteMs,
      },
      `[startup-stage] RUN name=${stage.name} version=${stage.version}`,
    );

    const executionStartedAt = performance.now();
    try {
      const value = await run();
      const executionMs = Math.max(0, Math.round(performance.now() - executionStartedAt));
      const completionStartedAt = performance.now();
      await updateState(stage.name, stage.version, "completed");
      const completionMetadataWriteMs = Math.max(
        0,
        Math.round(performance.now() - completionStartedAt),
      );
      logger.info(
        {
          name: stage.name,
          version: stage.version,
          duration_ms: executionMs,
          execution_ms: executionMs,
          metadata_write_ms: metadataWriteMs + completionMetadataWriteMs,
          lock_wait_ms: lockWaitMs,
        },
        `[startup-stage] DONE name=${stage.name} version=${stage.version} duration_ms=${executionMs}`,
      );
      return { status: "completed", value };
    } catch (error) {
      const executionMs = Math.max(0, Math.round(performance.now() - executionStartedAt));
      try {
        await updateState(stage.name, stage.version, "failed", sanitizeError(error));
      } catch (metadataError) {
        logger.error(
          { name: stage.name, version: stage.version, err: metadataError },
          "[startup-stage] Failed to persist failed state",
        );
      }
      logger.error(
        {
          name: stage.name,
          version: stage.version,
          duration_ms: executionMs,
          execution_ms: executionMs,
          err: sanitizeError(error),
        },
        `[startup-stage] FAIL name=${stage.name} version=${stage.version} duration_ms=${executionMs}`,
      );
      throw error;
    }
  } finally {
    await releaseStageLock(lock, stage.name);
  }
}

/**
 * Compatibility helpers for existing module-local fast paths. They use the
 * same dedicated state table but never create a completed marker before the
 * caller's operation has returned successfully.
 */
export async function isStartupMigrationComplete(
  name: string,
  version: string | number,
): Promise<boolean> {
  await ensureStartupStateStore();
  return (await readCompletedVersion(name)) === versionText(version);
}

export async function markStartupMigrationComplete(
  name: string,
  version: string | number,
  _description: string,
): Promise<boolean> {
  await ensureStartupStateStore();
  await updateState(name, version, "completed");
  logger.info({ name, version }, "Startup migration marker persisted");
  return true;
}