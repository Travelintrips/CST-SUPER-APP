import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { PoolClient, QueryResult } from "pg";
import { AsyncLocalStorage } from "node:async_hooks";
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

export type StartupMigrationGateMetrics = {
  store_initialization_roundtrips: number;
  store_initialization_ms: number | null;
  store_initialization_pool_acquire_ms: number | null;
  store_initialization_query_ms: number | null;
  bulk_registry_reads: number;
  bulk_registry_pool_acquire_ms: number | null;
  bulk_registry_query_ms: number | null;
  bulk_registry_rows: number | null;
  bulk_registry_processing_ms: number | null;
  bulk_registry_connection_reused: boolean;
  pool_connection_acquisitions: number;
  marker_reads: number;
  lock_attempts: number;
  lock_acquisitions: number;
  lock_releases: number;
  metadata_writes: number;
  registry_snapshot_load_ms: number | null;
};

type PersistentStageState = {
  stageVersion: string;
  status: StartupMigrationStatus;
};

const STARTUP_STATE_TABLE = "startup_migration_state";
const LOCK_WAIT_TIMEOUT_MS = 30_000;
const LOCK_POLL_MS = 250;
let storeReady: Promise<void> | null = null;
let registrySnapshot: Map<string, PersistentStageState> | null = null;
let registrySnapshotLoadPromise: Promise<void> | null = null;
const stageLockContext = new AsyncLocalStorage<{ name: string; client: PoolClient }>();
const gateMetrics: StartupMigrationGateMetrics = {
  store_initialization_roundtrips: 0,
  store_initialization_ms: null,
  store_initialization_pool_acquire_ms: null,
  store_initialization_query_ms: null,
  bulk_registry_reads: 0,
  bulk_registry_pool_acquire_ms: null,
  bulk_registry_query_ms: null,
  bulk_registry_rows: null,
  bulk_registry_processing_ms: null,
  bulk_registry_connection_reused: false,
  pool_connection_acquisitions: 0,
  marker_reads: 0,
  lock_attempts: 0,
  lock_acquisitions: 0,
  lock_releases: 0,
  metadata_writes: 0,
  registry_snapshot_load_ms: null,
};

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

async function executeMeasuredQuery(
  text: string,
  values: readonly unknown[] = [],
  existingClient?: PoolClient,
): Promise<{
  result: QueryResult;
  poolAcquireMs: number;
  queryMs: number;
}> {
  let client = existingClient;
  let ownsClient = false;
  let poolAcquireMs = 0;
  if (!client) {
    const acquireStartedAt = performance.now();
    client = await pool.connect();
    poolAcquireMs = Math.max(0, Math.round(performance.now() - acquireStartedAt));
    gateMetrics.pool_connection_acquisitions++;
    ownsClient = true;
  }
  try {
    const queryStartedAt = performance.now();
    const result = await client.query(text, [...values]);
    return {
      result,
      poolAcquireMs,
      queryMs: Math.max(0, Math.round(performance.now() - queryStartedAt)),
    };
  } finally {
    if (ownsClient) client.release();
  }
}

async function ensureStartupStateStore(
  existingClient?: PoolClient,
  existingPoolAcquireMs?: number,
  operationStartedAt = performance.now(),
): Promise<void> {
  if (!storeReady) {
    gateMetrics.store_initialization_roundtrips++;
    storeReady = executeMeasuredQuery(`
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
    `, [], existingClient).then(({ poolAcquireMs, queryMs }) => {
      gateMetrics.store_initialization_pool_acquire_ms =
        existingPoolAcquireMs ?? poolAcquireMs;
      gateMetrics.store_initialization_query_ms = queryMs;
      gateMetrics.store_initialization_ms = Math.max(
        0,
        Math.round(performance.now() - operationStartedAt),
      );
    }).catch((error) => {
      storeReady = null;
      throw error;
    });
  }
  await storeReady;
}

async function readCompletedVersion(
  name: string,
  existingClient?: PoolClient,
): Promise<string | null> {
  gateMetrics.marker_reads++;
  const queryText = `
    SELECT stage_version
    FROM startup_migration_state
    WHERE stage_name = $1
      AND status = 'completed'
    LIMIT 1
  `;
  const result = existingClient
    ? await existingClient.query(queryText, [name])
    : await db.execute(sql`SELECT stage_version
      FROM startup_migration_state
      WHERE stage_name = ${name}
        AND status = 'completed'
      LIMIT 1`);
  return String(
    (result.rows[0] as { stage_version?: unknown } | undefined)?.stage_version ?? "",
  ) || null;
}

async function updateState(
  name: string,
  version: string | number,
  status: StartupMigrationStatus,
  lastError: string | null = null,
  existingClient?: PoolClient,
): Promise<void> {
  gateMetrics.metadata_writes++;
  const queryText = `
    INSERT INTO startup_migration_state
      (stage_name, stage_version, status, started_at, completed_at, last_error, updated_at)
    VALUES (
      $1,
      $2,
      $3,
      CASE WHEN $3 = 'running' THEN NOW() ELSE NULL END,
      CASE WHEN $3 = 'completed' THEN NOW() ELSE NULL END,
      $4,
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
  `;
  if (existingClient) {
    await existingClient.query(queryText, [
      name,
      versionText(version),
      status,
      lastError,
    ]);
  } else {
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
      gateMetrics.lock_attempts++;
      if (result.rows[0]?.locked) {
        gateMetrics.lock_acquisitions++;
        return client;
      }
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
    gateMetrics.lock_releases++;
  } finally {
    client.release();
  }
}

/**
 * Load the startup registry once for the process. The snapshot is only used
 * for a completed + version-matching skip. Any other state still takes the
 * authoritative read, then the existing lock/re-check/execute path.
 */
export async function primeStartupMigrationRegistry(
  stages: readonly StartupStageDefinition[],
): Promise<void> {
  if (registrySnapshotLoadPromise) {
    await registrySnapshotLoadPromise;
    return;
  }

  registrySnapshotLoadPromise = (async () => {
    let sharedClient: PoolClient | null = null;
    const storeStartedAt = performance.now();
    let sharedPoolAcquireMs: number | undefined;
    if (!storeReady) {
      const acquireStartedAt = performance.now();
      sharedClient = await pool.connect();
      gateMetrics.pool_connection_acquisitions++;
      sharedPoolAcquireMs = Math.max(0, Math.round(performance.now() - acquireStartedAt));
    }

    try {
      await ensureStartupStateStore(
        sharedClient ?? undefined,
        sharedPoolAcquireMs,
        storeStartedAt,
      );
      const startedAt = performance.now();
      const { result, poolAcquireMs, queryMs } = await executeMeasuredQuery(`
        SELECT stage_name, stage_version, status
        FROM startup_migration_state
      `, [], sharedClient ?? undefined);
      gateMetrics.bulk_registry_reads++;
      gateMetrics.bulk_registry_pool_acquire_ms = poolAcquireMs;
      gateMetrics.bulk_registry_query_ms = queryMs;
      gateMetrics.bulk_registry_rows = result.rows.length;
      gateMetrics.bulk_registry_connection_reused = sharedClient !== null;

      const knownNames = new Set(stages.map((stage) => stage.name));
      const snapshot = new Map<string, PersistentStageState>();
      for (const row of result.rows as Array<{
        stage_name?: unknown;
        stage_version?: unknown;
        status?: unknown;
      }>) {
        const name = String(row.stage_name ?? "");
        const status = String(row.status ?? "") as StartupMigrationStatus;
        if (
          knownNames.has(name) &&
          (status === "pending" ||
            status === "running" ||
            status === "completed" ||
            status === "failed")
        ) {
          snapshot.set(name, {
            stageVersion: String(row.stage_version ?? ""),
            status,
          });
        }
      }
      registrySnapshot = snapshot;
      gateMetrics.bulk_registry_processing_ms = Math.max(
        0,
        Math.round(performance.now() - startedAt - queryMs),
      );
      gateMetrics.registry_snapshot_load_ms = Math.max(
        0,
        Math.round(performance.now() - startedAt),
      );
    } finally {
      sharedClient?.release();
    }
  })().catch((error) => {
    registrySnapshotLoadPromise = null;
    throw error;
  });

  await registrySnapshotLoadPromise;
}

export function getStartupMigrationGateMetrics(): StartupMigrationGateMetrics {
  return { ...gateMetrics };
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
  try {
    await ensureStartupStateStore();
  } catch (error) {
    logger.error(
      { name: stage.name, version: stage.version, err: sanitizeError(error) },
      `[startup-stage] metadata store unavailable name=${stage.name} version=${stage.version}`,
    );
    throw error;
  }

  let storedVersion: string | null = null;
  let lookupSource: "bulk_snapshot" | "database" = "database";
  const snapshotState = registrySnapshot?.get(stage.name);
  if (
    snapshotState?.status === "completed" &&
    snapshotState.stageVersion === versionText(stage.version)
  ) {
    lookupSource = "bulk_snapshot";
  } else {
    try {
      storedVersion = await readCompletedVersion(stage.name);
    } catch (error) {
      logger.error(
        { name: stage.name, version: stage.version, err: sanitizeError(error) },
        `[startup-stage] CHECK failed name=${stage.name} version=${stage.version}`,
      );
      throw error;
    }
  }
  const registryLookupMs = Math.max(0, Math.round(performance.now() - lookupStartedAt));

  logger.info(
    {
      name: stage.name,
      version: stage.version,
      registry_lookup_ms: registryLookupMs,
      registry_lookup_source: lookupSource,
    },
    `[startup-stage] CHECK name=${stage.name} version=${stage.version}`,
  );
  if (
    lookupSource === "bulk_snapshot" ||
    storedVersion === versionText(stage.version)
  ) {
    logger.info(
      {
        name: stage.name,
        version: stage.version,
        registry_lookup_ms: registryLookupMs,
        registry_lookup_source: lookupSource,
      },
      `[startup-stage] SKIP name=${stage.name} version=${stage.version} reason=already_completed`,
    );
    return { status: "skipped" };
  }

  const lockStartedAt = performance.now();
  const lock = await acquireStageLock(stage.name);
  const lockWaitMs = Math.max(0, Math.round(performance.now() - lockStartedAt));
  try {
    // Mandatory TOCTOU re-check after acquiring the per-stage lock.
    const lockedStoredVersion = await readCompletedVersion(stage.name, lock);
    if (lockedStoredVersion === versionText(stage.version)) {
      logger.info(
        { name: stage.name, version: stage.version, lock_wait_ms: lockWaitMs },
        `[startup-stage] SKIP name=${stage.name} version=${stage.version} reason=already_completed`,
      );
      return { status: "skipped" };
    }

    const metadataStartedAt = performance.now();
    await updateState(stage.name, stage.version, "running", null, lock);
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
      // Compatibility migrations still persist their own historical marker.
      // Carry the lock through the callback so that marker writes do not try
      // to acquire the same session advisory lock a second time.
      const contextAtEntry = stageLockContext.getStore();
      logger.info(
        {
          name: stage.name,
          version: stage.version,
          client_context_at_entry: contextAtEntry?.client != null,
        },
        "[startup-stage] EXEC starting",
      );
      const value = await stageLockContext.run({ name: stage.name, client: lock }, async () => {
        return await run();
      });
      const contextAfterAwait = stageLockContext.getStore();
      logger.info(
        {
          name: stage.name,
          version: stage.version,
          client_context_after_await: contextAfterAwait?.client != null,
          client_context_same_stage: contextAfterAwait?.name === stage.name,
        },
        "[startup-stage] EXEC settled",
      );
      const executionMs = Math.max(0, Math.round(performance.now() - executionStartedAt));
      const completionStartedAt = performance.now();
      await updateState(stage.name, stage.version, "completed", null, lock);
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
          await updateState(stage.name, stage.version, "failed", sanitizeError(error), lock);
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
  const context = stageLockContext.getStore();
  logger.info(
    {
      name,
      version,
      client_context_in_nested_marker: context?.client != null,
      client_context_stage: context?.name ?? null,
    },
    "[startup-stage] nested marker check",
  );
  await ensureStartupStateStore(context?.client);
  return (await readCompletedVersion(name, context?.client)) === versionText(version);
}

export async function markStartupMigrationComplete(
  name: string,
  version: string | number,
  _description: string,
): Promise<boolean> {
  const context = stageLockContext.getStore();
  await ensureStartupStateStore(context?.client);
  if (context?.name === name) {
    await updateState(name, version, "completed", null, context.client);
  } else {
    // Standalone callers (for example a route-triggered legacy fast path)
    // still need the same serialization guarantee as the startup runner.
    // The operation itself should preferably be called through the runner;
    // this lock at least prevents competing marker writes from racing.
    const lock = await acquireStageLock(name);
    try {
      await updateState(name, version, "completed");
    } finally {
      await releaseStageLock(lock, name);
    }
  }
  logger.info({ name, version }, "Startup migration marker persisted");
  return true;
}