/**
 * Token Cleanup Worker — P1.3
 *
 * Scheduled cleanup untuk:
 * - Token expired > 90 hari → soft-delete (tandai status=archived) atau hapus
 * - token_access_log lama > configurable retention → hapus
 *
 * Cleanup bersifat idempotent. Token yang masih diperlukan audit TIDAK dihapus.
 * Hanya token yang sudah expired/revoked/used dan melewati retention window.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../lib/logger.js";

const EXPIRED_RETENTION_DAYS   = parseInt(process.env.TOKEN_CLEANUP_RETENTION_DAYS ?? "90", 10);
const ACCESS_LOG_RETENTION_DAYS = parseInt(process.env.TOKEN_ACCESS_LOG_RETENTION_DAYS ?? "180", 10);
const CLEANUP_INTERVAL_MS       = 24 * 60 * 60 * 1000; // sekali sehari

async function runCleanup(): Promise<void> {
  logger.info({ retentionDays: EXPIRED_RETENTION_DAYS, logRetentionDays: ACCESS_LOG_RETENTION_DAYS },
    "[tokenCleanup] Memulai cleanup...");

  try {
    // ── 1. admin_action_links: hapus jika expired/used/revoked > retention ──
    const aal = await db.execute(sql`
      DELETE FROM admin_action_links
      WHERE (
        (expires_at IS NOT NULL AND expires_at < NOW() - INTERVAL '1 day' * ${EXPIRED_RETENTION_DAYS})
        OR (used_at IS NOT NULL AND used_at < NOW() - INTERVAL '1 day' * ${EXPIRED_RETENTION_DAYS})
        OR (revoked_at IS NOT NULL AND revoked_at < NOW() - INTERVAL '1 day' * ${EXPIRED_RETENTION_DAYS})
      )
      AND created_at < NOW() - INTERVAL '1 day' * ${EXPIRED_RETENTION_DAYS}
    `).catch((e) => { logger.warn({ e }, "[tokenCleanup] admin_action_links cleanup error (non-fatal)"); return null; });

    // ── 2. rfq_vendor_links: hapus yang sudah expired/submitted lama ─────────
    const rvl = await db.execute(sql`
      DELETE FROM rfq_vendor_links
      WHERE status IN ('expired', 'rejected', 'not_selected')
        AND created_at < NOW() - INTERVAL '1 day' * ${EXPIRED_RETENTION_DAYS}
    `).catch((e) => { logger.warn({ e }, "[tokenCleanup] rfq_vendor_links cleanup error (non-fatal)"); return null; });

    // ── 3. vendor_fulfillment_links: hapus expired/submitted lama ──────────
    const vfl = await db.execute(sql`
      DELETE FROM vendor_fulfillment_links
      WHERE (
        (expires_at IS NOT NULL AND expires_at < NOW() - INTERVAL '1 day' * ${EXPIRED_RETENTION_DAYS})
        OR (revoked_at IS NOT NULL AND revoked_at < NOW() - INTERVAL '1 day' * ${EXPIRED_RETENTION_DAYS})
      )
      AND created_at < NOW() - INTERVAL '1 day' * ${EXPIRED_RETENTION_DAYS}
    `).catch((e) => { logger.warn({ e }, "[tokenCleanup] vendor_fulfillment_links cleanup error (non-fatal)"); return null; });

    // ── 4. token_access_log: hapus entri lama ─────────────────────────────
    const tal = await db.execute(sql`
      DELETE FROM token_access_log
      WHERE created_at < NOW() - INTERVAL '1 day' * ${ACCESS_LOG_RETENTION_DAYS}
    `).catch((e) => { logger.warn({ e }, "[tokenCleanup] token_access_log cleanup error (non-fatal)"); return null; });

    logger.info(
      {
        aalRows: (aal as any)?.rowCount ?? "?",
        rvlRows: (rvl as any)?.rowCount ?? "?",
        vflRows: (vfl as any)?.rowCount ?? "?",
        talRows: (tal as any)?.rowCount ?? "?",
      },
      "[tokenCleanup] Cleanup selesai"
    );
  } catch (err) {
    logger.error({ err }, "[tokenCleanup] Cleanup gagal (non-fatal)");
  }
}

export function startTokenCleanupWorker(): void {
  // Jalankan sekali saat startup (dengan delay kecil agar tidak menekan DB)
  const initialDelay = 5 * 60 * 1000; // 5 menit setelah server start
  setTimeout(() => {
    void runCleanup();
    setInterval(() => { void runCleanup(); }, CLEANUP_INTERVAL_MS);
  }, initialDelay);

  logger.info(
    { retentionDays: EXPIRED_RETENTION_DAYS, intervalHours: CLEANUP_INTERVAL_MS / 3_600_000 },
    "[tokenCleanup] Worker dijadwalkan"
  );
}
