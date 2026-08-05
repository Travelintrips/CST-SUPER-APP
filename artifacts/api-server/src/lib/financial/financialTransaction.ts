/**
 * financialTransaction.ts — RULE 3: Transaction Safety Layer
 *
 * Semua financial write yang membutuhkan atomicity WAJIB menggunakan wrapper ini.
 *
 * Behavior:
 *  - Buka BEGIN TRANSACTION
 *  - Jalankan callback dengan transaction client
 *  - COMMIT jika sukses
 *  - ROLLBACK otomatis jika callback throw
 *
 * Contoh penggunaan:
 *   const result = await financialTransaction(async (tx) => {
 *     const entry = await _postEntryCore(tx, input, journalCode);
 *     await tx.execute(sql`UPDATE bank_mutations SET status='approved' WHERE id=${id}`);
 *     return entry;
 *   }, "approve-reconciliation");
 */

import { db } from "@workspace/db";
import { logger } from "../logger.js";
import { captureFailedJob } from "./failedJobSystem.js";

// DbClient type — compatible dengan db atau tx yang dipass ke db.transaction()
export type DbClient = typeof db;
export type TransactionCallback<T> = (tx: DbClient) => Promise<T>;

/**
 * financialTransaction — wrapper aman untuk operasi finansial multi-step.
 *
 * @param callback  Fungsi async yang menerima transaction client
 * @param label     Label untuk logging + failed job capture (opsional)
 * @param payload   Payload asli — disimpan ke failed_jobs jika gagal
 */
export async function financialTransaction<T>(
  callback: TransactionCallback<T>,
  label = "financial_transaction",
  payload?: Record<string, unknown>,
): Promise<T> {
  try {
    return await db.transaction(async (tx) => {
      return callback(tx as unknown as DbClient);
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, label }, `[financialTransaction] ROLLBACK — ${label}: ${msg}`);

    // Capture to failed jobs (fire-and-forget)
    captureFailedJob(label, payload ?? {}, msg).catch(() => {});

    throw err; // re-throw — caller handles UI/HTTP response
  }
}

/**
 * withSelectForUpdate — helper untuk SELECT ... FOR UPDATE yang umum dipakai
 * untuk lock row sebelum update di dalam transaction.
 *
 * Contoh:
 *   const mutation = await withSelectForUpdate(tx, "bank_mutations", mutationId);
 *   if (!mutation) throw new Error("Not found");
 *   // sekarang row ter-lock sampai tx COMMIT/ROLLBACK
 */
export async function withSelectForUpdate(
  tx: DbClient,
  tableName: string,
  id: number,
): Promise<Record<string, unknown> | null> {
  const { sql } = await import("drizzle-orm");
  const { rows } = await tx.execute(
    sql.raw(`SELECT * FROM ${tableName} WHERE id = ${id} FOR UPDATE LIMIT 1`)
  );
  return (rows[0] as Record<string, unknown>) ?? null;
}
