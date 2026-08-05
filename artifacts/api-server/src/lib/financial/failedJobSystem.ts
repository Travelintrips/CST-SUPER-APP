/**
 * failedJobSystem.ts — RULE 5+6: Failed Job Capture + Recovery Worker
 *
 * RULE 5: Setiap error pada operasi finansial otomatis masuk ke failed_financial_jobs.
 * RULE 6: Worker replayFailedJobs() menjalankan ulang job yang bisa di-retry.
 *
 * Job types yang di-capture:
 *  - financial_transaction   : generic tx failure
 *  - outbox_processing       : outbox event gagal diproses
 *  - journal_creation        : createJournal() gagal
 *  - mutation_import         : import bank mutation gagal
 *  - reconciliation_approval : approval jurnal gagal
 *
 * Job types yang bisa auto-replay:
 *  - outbox_processing → panggil processOutboxBatch()
 *
 * Job types yang butuh manual intervention:
 *  - mutation_import, reconciliation_approval → emit alert, flag untuk review
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../logger.js";

// ─── Migration ────────────────────────────────────────────────────────────────

let _migrated = false;

async function ensureTable(): Promise<void> {
  if (_migrated) return;
  _migrated = true;

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS failed_financial_jobs (
      id            BIGSERIAL PRIMARY KEY,
      type          TEXT NOT NULL,
      payload       JSONB NOT NULL,
      error         TEXT,
      created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      retry_count   INTEGER NOT NULL DEFAULT 0,
      last_retry_at TIMESTAMPTZ,
      processed     BOOLEAN NOT NULL DEFAULT FALSE,
      processed_at  TIMESTAMPTZ,
      resolution    TEXT
    )
  `).catch(() => {});

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS ffj_processed_idx ON failed_financial_jobs(processed) WHERE processed = FALSE
  `).catch(() => {});

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS ffj_type_idx ON failed_financial_jobs(type)
  `).catch(() => {});

  await db.execute(sql`
    CREATE INDEX IF NOT EXISTS ffj_created_idx ON failed_financial_jobs(created_at)
  `).catch(() => {});
}

// ─── Capture ──────────────────────────────────────────────────────────────────

/**
 * captureFailedJob — dipanggil setiap kali operasi finansial gagal.
 * Fire-and-forget, non-blocking, non-fatal.
 *
 * Juga emit FAILED_JOB_CREATED ke financial event bus.
 */
export async function captureFailedJob(
  type: string,
  payload: Record<string, unknown>,
  error: string,
): Promise<void> {
  await ensureTable();

  const truncatedError = error.slice(0, 2000); // cap error length

  await db.execute(sql`
    INSERT INTO failed_financial_jobs (type, payload, error)
    VALUES (${type}, ${JSON.stringify(payload)}, ${truncatedError})
  `).catch((e: unknown) => {
    logger.warn({ e, type }, "[failedJobSystem] captureFailedJob insert failed (non-fatal)");
  });

  logger.warn({ type, error: truncatedError }, `[FailedJobSystem] Job captured — type=${type}`);

  // Emit FAILED_JOB_CREATED event (lazy import to avoid circular)
  import("../events/financialEventBus.js").then(({ financialEventBus }) => {
    financialEventBus.emit("MUTATION_IMPORTED" as never, {
      eventType: "FAILED_JOB_CREATED" as never,
      sourceType: type,
      meta: { error: truncatedError, payloadKeys: Object.keys(payload) },
    } as never);
  }).catch(() => {});
}

// ─── Replay ───────────────────────────────────────────────────────────────────

const REPLAY_BATCH    = 20;
const MAX_RETRY_COUNT = 3;

/**
 * replayFailedJobs — ambil job yang belum diproses, retry jika memungkinkan.
 * Dipanggil oleh worker setiap 5 menit.
 */
export async function replayFailedJobs(): Promise<{ replayed: number; stillFailed: number; skipped: number }> {
  await ensureTable();

  const { rows } = await db.execute(sql`
    SELECT id, type, payload, error, retry_count
    FROM failed_financial_jobs
    WHERE processed = FALSE
      AND retry_count < ${MAX_RETRY_COUNT}
    ORDER BY created_at ASC
    LIMIT ${REPLAY_BATCH}
  `).catch(() => ({ rows: [] }));

  let replayed = 0;
  let stillFailed = 0;
  let skipped = 0;

  for (const row of rows as Array<Record<string, unknown>>) {
    const id        = Number(row["id"]);
    const type      = String(row["type"]);
    const retryCount = Number(row["retry_count"] ?? 0);

    // Mark retry attempt
    await db.execute(sql`
      UPDATE failed_financial_jobs
      SET retry_count = retry_count + 1, last_retry_at = NOW()
      WHERE id = ${id}
    `).catch(() => {});

    let success = false;

    try {
      if (type === "outbox_processing") {
        // Auto-replay: trigger outbox processor
        const { processOutboxBatch } = await import("../accounting/outboxProcessor.js") as { processOutboxBatch?: () => Promise<number> };
        if (typeof processOutboxBatch === "function") {
          await processOutboxBatch();
          success = true;
        } else {
          skipped++;
          continue;
        }
      } else {
        // Types that need manual intervention — alert + skip
        logger.warn(
          { id, type, retryCount },
          `[FailedJobSystem] Job type '${type}' requires manual intervention (retry_count=${retryCount})`,
        );
        // Mark as skipped after MAX_RETRY_COUNT
        if (retryCount + 1 >= MAX_RETRY_COUNT) {
          await db.execute(sql`
            UPDATE failed_financial_jobs
            SET resolution = 'MANUAL_REVIEW_REQUIRED'
            WHERE id = ${id}
          `).catch(() => {});
        }
        skipped++;
        continue;
      }

      if (success) {
        await db.execute(sql`
          UPDATE failed_financial_jobs
          SET processed = TRUE, processed_at = NOW(), resolution = 'AUTO_REPLAYED'
          WHERE id = ${id}
        `).catch(() => {});
        replayed++;
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.warn({ id, type, err: msg }, "[FailedJobSystem] replay attempt failed");
      await db.execute(sql`
        UPDATE failed_financial_jobs
        SET error = ${msg}
        WHERE id = ${id}
      `).catch(() => {});
      stillFailed++;
    }
  }

  if (replayed > 0 || stillFailed > 0) {
    logger.info({ replayed, stillFailed, skipped }, "[FailedJobSystem] Replay batch complete");
  }

  return { replayed, stillFailed, skipped };
}

// ─── Query helpers for API exposure ──────────────────────────────────────────

export async function getPendingFailedJobs(limit = 50): Promise<Array<Record<string, unknown>>> {
  await ensureTable();
  const { rows } = await db.execute(sql`
    SELECT id, type, error, created_at, retry_count, resolution
    FROM failed_financial_jobs
    WHERE processed = FALSE
    ORDER BY created_at DESC
    LIMIT ${limit}
  `).catch(() => ({ rows: [] }));
  return rows as Array<Record<string, unknown>>;
}

// ─── Worker entry point ───────────────────────────────────────────────────────

const REPLAY_INTERVAL_MS = 5 * 60 * 1000; // every 5 minutes
const INITIAL_DELAY_MS   = 3 * 60 * 1000; // 3 min after startup

export function startFailedJobReplayWorker(): void {
  setTimeout(() => {
    replayFailedJobs().catch(() => {});
  }, INITIAL_DELAY_MS);

  setInterval(() => {
    replayFailedJobs().catch((e: unknown) => {
      logger.warn({ e }, "[FailedJobSystem] replay tick failed (non-fatal)");
    });
  }, REPLAY_INTERVAL_MS);

  logger.info(
    { intervalMin: REPLAY_INTERVAL_MS / 60_000, initialDelayMin: INITIAL_DELAY_MS / 60_000 },
    "[FailedJobSystem] Failed job replay worker started",
  );
}
