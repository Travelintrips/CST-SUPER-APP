/**
 * marketplaceNotificationQueueService.ts — Phase 2E.1
 *
 * Service untuk enqueue dan mengelola mkt_notification_queue.
 * Worker terpisah (marketplaceNotificationWorker.ts) yang men-poll dan mengirim.
 *
 * Event types:
 *   - mkt_vendor_invitation_notification  → WA ke vendor yang diundang submit quote
 *   - mkt_vendor_winner_notification      → WA ke vendor yang menang
 *   - mkt_vendor_rejected_notification    → WA ke vendor yang tidak terpilih
 *
 * Pattern: mirip dualWriteReliabilityService — reliability gate, retry, exhausted.
 * Migration: 0021_mkt_notification_queue.sql
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "../logger.js";

// ── Config ────────────────────────────────────────────────────────────────────

export const MAX_ATTEMPTS         = 3;
const RETRY_DELAY_MIN_MS          = 5  * 60 * 1000;  // 5 menit setelah gagal
const RETRY_DELAY_MAX_MS          = 30 * 60 * 1000;  // max backoff

// P0-2: configurable stuck-"sending" recovery timeout (default 10 menit).
const STUCK_SENDING_TIMEOUT_MIN = (() => {
  const raw = Number(process.env.MKT_NOTIF_STUCK_SENDING_TIMEOUT_MIN);
  return Number.isFinite(raw) && raw > 0 ? raw : 10;
})();

// ── Reliability gate (sama seperti dualWriteReliabilityService) ───────────────

let _tableReady: boolean | null = null;

export async function validateNotifQueueTableReadiness(): Promise<boolean> {
  if (_tableReady !== null) return _tableReady;

  try {
    const { rows } = await db.execute(sql`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE  table_schema = 'public'
          AND  table_name   = 'mkt_notification_queue'
      ) AS "exists"
    `);
    const exists = (rows[0] as Record<string, unknown>)?.["exists"];
    _tableReady = exists === true || exists === "true" || exists === "t";

    if (!_tableReady) {
      logger.error(
        "[mktNotifQueue:validate] Tabel 'mkt_notification_queue' TIDAK DITEMUKAN. " +
        "Jalankan migration 0021_mkt_notification_queue.sql untuk mengaktifkan.",
      );
    } else {
      logger.info("[mktNotifQueue:validate] Tabel 'mkt_notification_queue' OK — notification queue AKTIF");
    }
  } catch (err) {
    logger.error({ err }, "[mktNotifQueue:validate] Gagal cek tabel — notification queue DINONAKTIFKAN");
    _tableReady = false;
  }

  return _tableReady;
}

/** Reset untuk test / manual re-check */
export function resetNotifQueueTableReadiness(): void {
  _tableReady = null;
}

// ── Enqueue ───────────────────────────────────────────────────────────────────

export interface EnqueueNotifOpts {
  eventType:        string;
  channel?:         string;
  recipientType:    string;
  recipientId?:     number | null;
  recipientPhone?:  string | null;
  rfqId?:           number | null;
  vendorQuoteId?:   number | null;
  purchaseOrderId?: number | null;
  payloadJson:      Record<string, unknown>;
  maxAttempts?:     number;
  /**
   * P2: optional dedup key. When provided and a row with the same key
   * already exists, enqueue is a no-op (ON CONFLICT DO NOTHING) and the
   * existing queue id is returned. Omitting it preserves prior behavior
   * exactly (backward compatible) — no dedup is enforced.
   */
  deduplicationKey?: string | null;
}

/**
 * enqueueNotification — tambah notifikasi ke queue dengan status 'pending'.
 * Non-throwing. Mengembalikan queue id (0 jika gagal atau disabled).
 * Setelah insert berhasil, fires mkt_notification_queued ke activity_log (non-fatal).
 */
export async function enqueueNotification(opts: EnqueueNotifOpts): Promise<number> {
  if (!(await validateNotifQueueTableReadiness())) return 0;

  try {
    const dedupKey = opts.deduplicationKey ?? null;

    // P2: when a dedup key is supplied, ON CONFLICT DO NOTHING guards against
    // double-enqueue of the same logical notification. Without a dedup key
    // (existing callers), behavior is unchanged.
    const { rows } = await db.execute(sql`
      INSERT INTO mkt_notification_queue (
        event_type, channel, recipient_type, recipient_id, recipient_phone,
        rfq_id, vendor_quote_id, purchase_order_id,
        payload_json, status, attempt_count, max_attempts, deduplication_key
      ) VALUES (
        ${opts.eventType},
        ${opts.channel ?? "whatsapp"},
        ${opts.recipientType},
        ${opts.recipientId ?? null},
        ${opts.recipientPhone ?? null},
        ${opts.rfqId ?? null},
        ${opts.vendorQuoteId ?? null},
        ${opts.purchaseOrderId ?? null},
        ${JSON.stringify(opts.payloadJson)},
        'pending',
        0,
        ${opts.maxAttempts ?? MAX_ATTEMPTS},
        ${dedupKey}
      )
      ON CONFLICT (deduplication_key) WHERE deduplication_key IS NOT NULL DO NOTHING
      RETURNING id
    `);

    if (!rows[0] && dedupKey) {
      // Conflict occurred — a row with this dedup key already exists.
      const existing = await db.execute(sql`
        SELECT id FROM mkt_notification_queue WHERE deduplication_key = ${dedupKey} LIMIT 1
      `);
      const existingId = Number((existing.rows[0] as Record<string, unknown>)?.["id"] ?? 0);
      logger.debug(
        { existingId, eventType: opts.eventType, dedupKey },
        "[mktNotifQueue] enqueue skipped — duplicate deduplication_key",
      );
      return existingId;
    }

    const queueId = Number((rows[0] as Record<string, unknown>)?.["id"] ?? 0);

    logger.debug(
      { queueId, eventType: opts.eventType, recipientPhone: opts.recipientPhone },
      "[mktNotifQueue] Notifikasi di-enqueue",
    );

    // Activity log: mkt_notification_queued — non-fatal, fire-and-forget
    if (queueId) {
      void (async () => {
        try {
          const { logActivity } = await import("../activityLog.js");
          void logActivity({
            mktRfqId:          opts.rfqId ?? null,
            mktVendorQuoteId:  opts.vendorQuoteId ?? null,
            mktPurchaseOrderId: opts.purchaseOrderId ?? null,
            actorType:         "system",
            action:            "mkt_notification_queued",
            description:       `Notifikasi ${opts.eventType} di-enqueue (queueId=${queueId}, phone=${opts.recipientPhone ?? "none"})`,
            newValue:          { queueId, eventType: opts.eventType, recipientPhone: opts.recipientPhone, channel: opts.channel ?? "whatsapp" },
          }).catch(() => {});
        } catch { /* non-fatal */ }
      })();
    }

    return queueId;
  } catch (err) {
    logger.warn({ err, eventType: opts.eventType }, "[mktNotifQueue] enqueueNotification gagal (non-fatal)");
    return 0;
  }
}

// ── Fetch batch untuk worker ──────────────────────────────────────────────────

export interface NotifQueueRow {
  id:               number;
  eventType:        string;
  channel:          string;
  recipientType:    string;
  recipientId:      number | null;
  recipientPhone:   string | null;
  rfqId:            number | null;
  vendorQuoteId:    number | null;
  purchaseOrderId:  number | null;
  payloadJson:      Record<string, unknown>;
  attemptCount:     number;
  maxAttempts:      number;
}

/** Legacy fetch — tidak atomic. Dipertahankan untuk referensi. Worker menggunakan fetchAndClaimNotifications. */
export async function fetchPendingNotifications(batchSize = 20): Promise<NotifQueueRow[]> {
  if (!(await validateNotifQueueTableReadiness())) return [];

  try {
    const { rows } = await db.execute(sql`
      SELECT
        id, event_type, channel, recipient_type, recipient_id, recipient_phone,
        rfq_id, vendor_quote_id, purchase_order_id,
        payload_json, attempt_count, max_attempts
      FROM mkt_notification_queue
      WHERE status IN ('pending', 'retrying', 'failed')
        AND (next_retry_at IS NULL OR next_retry_at <= NOW())
      ORDER BY created_at ASC
      LIMIT ${batchSize}
      FOR UPDATE SKIP LOCKED
    `);

    return (rows as Array<Record<string, unknown>>).map((r) => ({
      id:              Number(r["id"]),
      eventType:       String(r["event_type"] ?? ""),
      channel:         String(r["channel"] ?? "whatsapp"),
      recipientType:   String(r["recipient_type"] ?? ""),
      recipientId:     r["recipient_id"] != null ? Number(r["recipient_id"]) : null,
      recipientPhone:  r["recipient_phone"] != null ? String(r["recipient_phone"]) : null,
      rfqId:           r["rfq_id"] != null ? Number(r["rfq_id"]) : null,
      vendorQuoteId:   r["vendor_quote_id"] != null ? Number(r["vendor_quote_id"]) : null,
      purchaseOrderId: r["purchase_order_id"] != null ? Number(r["purchase_order_id"]) : null,
      payloadJson:     (typeof r["payload_json"] === "object" && r["payload_json"] !== null
                         ? r["payload_json"]
                         : {}) as Record<string, unknown>,
      attemptCount:    Number(r["attempt_count"] ?? 0),
      maxAttempts:     Number(r["max_attempts"] ?? MAX_ATTEMPTS),
    }));
  } catch (err) {
    logger.warn({ err }, "[mktNotifQueue] fetchPendingNotifications gagal");
    return [];
  }
}

/**
 * fetchAndClaimNotifications — atomic claim: UPDATE...RETURNING in one query.
 * Avoids race conditions between worker instances.
 * Atomic fetch-and-claim: UPDATE rows ke 'sending' lalu RETURNING —
 * menghindari race condition antar worker instances.
 * fetchAndClaimNotifications — atomic claim.
 * Single UPDATE...WHERE id IN (SELECT...FOR UPDATE SKIP LOCKED)...RETURNING
 * Menandai rows sebagai 'sending' dalam satu statement atomik.
 * Menyertakan 'failed' dalam filter sehingga rows yang sudah failed tetap di-retry.
 * Menggantikan fetchPendingNotifications() + markSending() — bebas race condition.
 */
export async function fetchAndClaimNotifications(batchSize = 20): Promise<NotifQueueRow[]> {
  if (!(await validateNotifQueueTableReadiness())) return [];

  try {
    const { rows } = await db.execute(sql`
      UPDATE mkt_notification_queue
      SET status = 'sending', updated_at = NOW()
      WHERE id IN (
        SELECT id
        FROM mkt_notification_queue
        WHERE status IN ('pending', 'retrying', 'failed')
          AND (next_retry_at IS NULL OR next_retry_at <= NOW())
        ORDER BY created_at ASC
        LIMIT ${batchSize}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING
        id, event_type, channel, recipient_type, recipient_id, recipient_phone,
        rfq_id, vendor_quote_id, purchase_order_id,
        payload_json, attempt_count, max_attempts
    `);

    return (rows as Array<Record<string, unknown>>).map((r) => ({
      id:              Number(r["id"]),
      eventType:       String(r["event_type"] ?? ""),
      channel:         String(r["channel"] ?? "whatsapp"),
      recipientType:   String(r["recipient_type"] ?? ""),
      recipientId:     r["recipient_id"] != null ? Number(r["recipient_id"]) : null,
      recipientPhone:  r["recipient_phone"] != null ? String(r["recipient_phone"]) : null,
      rfqId:           r["rfq_id"] != null ? Number(r["rfq_id"]) : null,
      vendorQuoteId:   r["vendor_quote_id"] != null ? Number(r["vendor_quote_id"]) : null,
      purchaseOrderId: r["purchase_order_id"] != null ? Number(r["purchase_order_id"]) : null,
      payloadJson:     (typeof r["payload_json"] === "object" && r["payload_json"] !== null
                         ? r["payload_json"]
                         : {}) as Record<string, unknown>,
      attemptCount:    Number(r["attempt_count"] ?? 0),
      maxAttempts:     Number(r["max_attempts"] ?? MAX_ATTEMPTS),
    }));
  } catch (err) {
    logger.warn({ err }, "[mktNotifQueue] fetchAndClaimNotifications gagal");
    return [];
  }
}

/**
 * recoverStuckSendingRows — dipanggil saat worker startup.
 * Rows yang stuck di status 'sending' direset ke 'pending' agar diambil ulang.
 * Mengembalikan jumlah rows yang direcover.
 * Reset rows yang stuck di status='sending' lebih dari STUCK_SENDING_TIMEOUT_MIN menit
 * kembali ke 'pending' agar dapat diambil ulang di batch berikutnya.
 * Threshold dikonfigurasi via env MKT_NOTIF_STUCK_SENDING_TIMEOUT_MIN (default 10 menit).
 * Mengembalikan jumlah rows yang berhasil direset.
 */
export async function recoverStuckSendingRows(): Promise<number> {
  if (!(await validateNotifQueueTableReadiness())) return 0;

  try {
    // Single atomic UPDATE — no separate SELECT, so no race window.
    const { rows } = await db.execute(sql`
      UPDATE mkt_notification_queue
      SET status = 'pending', updated_at = NOW()
      WHERE status = 'sending'
        AND updated_at < NOW() - INTERVAL '1 minute' * ${STUCK_SENDING_TIMEOUT_MIN}
      RETURNING id
    `);
    const count = (rows as unknown[]).length;
    if (count > 0) {
      logger.info(
        { count, thresholdMin: STUCK_SENDING_TIMEOUT_MIN },
        "[mktNotifQueue] Recovered stuck sending rows",
      );
    }
    logger.info("[mktNotifQueue] recoverStuckSendingRows selesai");
    return count;
  } catch (err) {
    logger.warn({ err }, "[mktNotifQueue] recoverStuckSendingRows gagal (non-fatal)");
    return 0;
  }
}

// ── Status update helpers ─────────────────────────────────────────────────────

/** Set status = 'sending' sebelum kirim */
export async function markSending(queueId: number): Promise<void> {
  await db.execute(sql`
    UPDATE mkt_notification_queue
    SET status = 'sending', updated_at = NOW()
    WHERE id = ${queueId}
  `).catch((err: unknown) => {
    logger.warn({ err, queueId }, "[mktNotifQueue] markSending gagal (non-fatal)");
  });
}

/** Set status = 'sent' setelah berhasil kirim */
export async function markSent(queueId: number): Promise<void> {
  await db.execute(sql`
    UPDATE mkt_notification_queue
    SET status       = 'sent',
        sent_at      = NOW(),
        attempt_count = attempt_count + 1,
        last_error   = NULL,
        updated_at   = NOW()
    WHERE id = ${queueId}
  `).catch((err: unknown) => {
    logger.warn({ err, queueId }, "[mktNotifQueue] markSent gagal (non-fatal)");
  });
}

/** Set status = 'failed' atau 'exhausted' setelah gagal kirim */
export async function markFailed(
  queueId: number,
  errorMsg: string,
  currentAttemptCount: number,
  maxAttempts: number,
): Promise<void> {
  const nextAttempt   = currentAttemptCount + 1;
  const isExhausted   = nextAttempt >= maxAttempts;
  const backoffMs     = Math.min(RETRY_DELAY_MIN_MS * (nextAttempt), RETRY_DELAY_MAX_MS);
  const nextRetryAt   = isExhausted ? null : new Date(Date.now() + backoffMs).toISOString();

  await db.execute(sql`
    UPDATE mkt_notification_queue
    SET status        = ${isExhausted ? "exhausted" : "failed"},
        attempt_count = ${nextAttempt},
        last_error    = ${errorMsg.slice(0, 2000)},
        next_retry_at = ${nextRetryAt ?? null},
        updated_at    = NOW()
    WHERE id = ${queueId}
  `).catch((err: unknown) => {
    logger.warn({ err, queueId }, "[mktNotifQueue] markFailed gagal (non-fatal)");
  });
}

/** Set status = 'retrying' sebelum retry attempt */
export async function markRetrying(queueId: number): Promise<void> {
  await db.execute(sql`
    UPDATE mkt_notification_queue
    SET status = 'retrying', updated_at = NOW()
    WHERE id = ${queueId}
  `).catch((err: unknown) => {
    logger.warn({ err, queueId }, "[mktNotifQueue] markRetrying gagal (non-fatal)");
  });
}

// ── Stats ─────────────────────────────────────────────────────────────────────

export interface NotifQueueStats {
  pending:   number;
  sending:   number;
  sent:      number;
  failed:    number;
  retrying:  number;
  exhausted: number;
  total24h:  number;
  enabled:   boolean;
}

export async function getNotifQueueStats(): Promise<NotifQueueStats> {
  const disabled: NotifQueueStats = {
    pending: 0, sending: 0, sent: 0, failed: 0, retrying: 0, exhausted: 0, total24h: 0, enabled: false,
  };
  if (!(await validateNotifQueueTableReadiness())) return disabled;

  try {
    const { rows } = await db.execute(sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'pending')   AS pending,
        COUNT(*) FILTER (WHERE status = 'sending')   AS sending,
        COUNT(*) FILTER (WHERE status = 'sent')      AS sent,
        COUNT(*) FILTER (WHERE status = 'failed')    AS failed,
        COUNT(*) FILTER (WHERE status = 'retrying')  AS retrying,
        COUNT(*) FILTER (WHERE status = 'exhausted') AS exhausted,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS total24h
      FROM mkt_notification_queue
    `);
    const r = (rows[0] as Record<string, unknown>) ?? {};
    return {
      pending:   Number(r["pending"] ?? 0),
      sending:   Number(r["sending"] ?? 0),
      sent:      Number(r["sent"] ?? 0),
      failed:    Number(r["failed"] ?? 0),
      retrying:  Number(r["retrying"] ?? 0),
      exhausted: Number(r["exhausted"] ?? 0),
      total24h:  Number(r["total24h"] ?? 0),
      enabled:   true,
    };
  } catch {
    return disabled;
  }
}

// ── Admin helpers ─────────────────────────────────────────────────────────────

export interface ExhaustedNotifRow {
  id:             number;
  eventType:      string;
  channel:        string;
  recipientPhone: string | null;
  rfqId:          number | null;
  attemptCount:   number;
  maxAttempts:    number;
  lastError:      string | null;
  updatedAt:      string;
  createdAt:      string;
}

/**
 * getExhaustedNotifications — list rows yang sudah exhausted (semua attempt habis).
 * Digunakan oleh admin endpoint untuk monitoring dan manual retry.
 */
export async function getExhaustedNotifications(limit = 50): Promise<ExhaustedNotifRow[]> {
  if (!(await validateNotifQueueTableReadiness())) return [];

  try {
    const { rows } = await db.execute(sql`
      SELECT
        id, event_type, channel, recipient_phone,
        rfq_id, attempt_count, max_attempts,
        last_error, updated_at, created_at
      FROM mkt_notification_queue
      WHERE status = 'exhausted'
      ORDER BY updated_at DESC
      LIMIT ${limit}
    `);

    return (rows as Array<Record<string, unknown>>).map((r) => ({
      id:             Number(r["id"]),
      eventType:      String(r["event_type"] ?? ""),
      channel:        String(r["channel"] ?? "whatsapp"),
      recipientPhone: r["recipient_phone"] != null ? String(r["recipient_phone"]) : null,
      rfqId:          r["rfq_id"] != null ? Number(r["rfq_id"]) : null,
      attemptCount:   Number(r["attempt_count"] ?? 0),
      maxAttempts:    Number(r["max_attempts"] ?? MAX_ATTEMPTS),
      lastError:      r["last_error"] != null ? String(r["last_error"]) : null,
      updatedAt:      String(r["updated_at"] ?? ""),
      createdAt:      String(r["created_at"] ?? ""),
    }));
  } catch (err) {
    logger.warn({ err }, "[mktNotifQueue] getExhaustedNotifications gagal");
    return [];
  }
}

/**
 * retryExhaustedNotification — reset satu row 'exhausted' kembali ke 'pending'.
 * Mengosongkan last_error, next_retry_at, dan attempt_count agar mulai dari awal.
 * Returns { ok: true } jika berhasil, { ok: false, code } jika tidak ditemukan atau bukan exhausted.
 */
export async function retryExhaustedNotification(
  queueId: number,
): Promise<{ ok: true } | { ok: false; code: "NOT_FOUND" | "NOT_EXHAUSTED" | "DB_ERROR" }> {
  if (!(await validateNotifQueueTableReadiness())) {
    return { ok: false, code: "DB_ERROR" };
  }

  try {
    const { rows } = await db.execute(sql`
      UPDATE mkt_notification_queue
      SET status        = 'pending',
          attempt_count = 0,
          last_error    = NULL,
          next_retry_at = NULL,
          updated_at    = NOW()
      WHERE id     = ${queueId}
        AND status = 'exhausted'
      RETURNING id
    `);

    if (rows.length === 0) {
      const check = await db.execute(sql`
        SELECT status FROM mkt_notification_queue WHERE id = ${queueId} LIMIT 1
      `);
      if (check.rows.length === 0) return { ok: false, code: "NOT_FOUND" };
      return { ok: false, code: "NOT_EXHAUSTED" };
    }

    logger.info({ queueId }, "[mktNotifQueue] Admin re-queued exhausted notification");
    return { ok: true };
  } catch (err) {
    logger.warn({ err, queueId }, "[mktNotifQueue] retryExhaustedNotification gagal");
    return { ok: false, code: "DB_ERROR" };
  }
}
