/**
 * WA Retry Worker — mencoba ulang pengiriman WA yang gagal.
 *
 * Berjalan setiap 5 menit sebagai background worker.
 * Retry hanya dilakukan untuk:
 *   - channel = 'wa'
 *   - status  = 'failed'
 *   - retryCount < MAX_RETRIES (3)
 *   - nextRetryAt IS NULL OR nextRetryAt <= NOW()
 *
 * Backoff eksponensial: 5 menit × 2^retryCount
 *   retry 1 → 5 menit, retry 2 → 10 menit, retry 3 → 20 menit
 *
 * Setelah retry ke-3 gagal, retryCount = 3 sehingga tidak akan diquery lagi.
 * Pada retry sukses, status diupdate ke 'sent' dan waMessageId disimpan.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { notificationLogsTable } from "@workspace/db/schema";
import { and, eq, isNull, lte, lt, or } from "drizzle-orm";
import { logger } from "./logger.js";
import { getPreferredDomain } from "./domain.js";
import { registerHeartbeat, beat } from "./workerHeartbeat.js";

import { getAppConfig } from "./appConfig.js";
const FONNTE_URL   = "https://api.fonnte.com/send";

const MAX_RETRIES   = 3;
const INTERVAL_MS   = 5 * 60 * 1000;
const BACKOFF_BASE  = 5 * 60 * 1000;

function extractMessageId(body: Record<string, unknown>): string | undefined {
  const raw = body.id ?? body.message_id ?? body.messageId;
  if (!raw) return undefined;
  if (Array.isArray(raw)) return raw[0] ? String(raw[0]) : undefined;
  return String(raw);
}

async function fonnteRawSend(
  target: string,
  message: string,
  mediaUrl?: string | null,
): Promise<{ ok: boolean; errorMsg: string; waMessageId?: string }> {
  const FONNTE_TOKEN = await getAppConfig("FONNTE_TOKEN");
  if (!FONNTE_TOKEN) {
    return { ok: false, errorMsg: "FONNTE_TOKEN not configured" };
  }
  try {
    const params: Record<string, string> = { target, message };
    if (mediaUrl?.trim()) params.url = mediaUrl.trim();

    const res = await fetch(FONNTE_URL, {
      method: "POST",
      headers: {
        Authorization: FONNTE_TOKEN,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams(params).toString(),
    });
    const body = await res.json() as Record<string, unknown>;
    if (!res.ok) {
      return { ok: false, errorMsg: `HTTP ${res.status}` };
    }
    if (body.status === false || body.status === "false") {
      return { ok: false, errorMsg: String(body.reason ?? body.message ?? "Fonnte status:false") };
    }
    return { ok: true, errorMsg: "", waMessageId: extractMessageId(body) };
  } catch (err) {
    return { ok: false, errorMsg: String(err) };
  }
}

function toAbsoluteMediaUrl(mediaUrl: string | null | undefined): string | null | undefined {
  if (!mediaUrl?.trim()) return mediaUrl;
  if (mediaUrl.startsWith("http://") || mediaUrl.startsWith("https://")) return mediaUrl;
  // Relative URL — convert to absolute
  const domain = process.env.REPLIT_DEV_DOMAIN || getPreferredDomain() || "cstlogistic.co.id";
  return `https://${domain}${mediaUrl.startsWith("/") ? "" : "/"}${mediaUrl}`;
}

async function fixRelativeMediaUrls(): Promise<void> {
  try {
    const domain = process.env.REPLIT_DEV_DOMAIN || getPreferredDomain() || "cstlogistic.co.id";
    const prefix = `https://${domain}`;
    const result = await db.execute(sql`
      UPDATE notification_logs
      SET media_url    = CONCAT(${prefix}::text, media_url),
          retry_count  = GREATEST(retry_count - 1, 0),
          next_retry_at = NULL,
          error_msg    = 'reset: relative media_url fixed'
      WHERE channel = 'wa'
        AND status = 'failed'
        AND media_url IS NOT NULL
        AND media_url NOT LIKE 'http%'
    `);
    const count = (result as any).rowCount ?? 0;
    if (count > 0) {
      logger.info({ count }, "[waRetryWorker] fixed relative media_url entries (reset for retry)");
    }
  } catch (err) {
    logger.warn({ err }, "[waRetryWorker] fixRelativeMediaUrls error (non-fatal)");
  }
}

async function runRetryTick(): Promise<void> {
  try {
    const now = new Date();

    const rows = await db
      .select({
        id:        notificationLogsTable.id,
        recipient: notificationLogsTable.recipient,
        message:   notificationLogsTable.message,
        retryCount: notificationLogsTable.retryCount,
        context:   notificationLogsTable.context,
        refId:     notificationLogsTable.refId,
        mediaUrl:  notificationLogsTable.mediaUrl,
      })
      .from(notificationLogsTable)
      .where(
        and(
          eq(notificationLogsTable.channel, "wa"),
          eq(notificationLogsTable.status, "failed"),
          lt(notificationLogsTable.retryCount, MAX_RETRIES),
          or(
            isNull(notificationLogsTable.nextRetryAt),
            lte(notificationLogsTable.nextRetryAt, now),
          ),
        ),
      )
      .limit(20);

    if (rows.length === 0) return;

    logger.info({ count: rows.length }, "[waRetryWorker] processing failed WA entries");

    for (const row of rows) {
      const absoluteMediaUrl = toAbsoluteMediaUrl(row.mediaUrl);
      const { ok, errorMsg, waMessageId } = await fonnteRawSend(row.recipient, row.message, absoluteMediaUrl);
      const newRetryCount = (row.retryCount ?? 0) + 1;

      if (ok) {
        await db
          .update(notificationLogsTable)
          .set({
            status:           "sent",
            retryCount:       newRetryCount,
            nextRetryAt:      null,
            errorMsg:         null,
            waMessageId:      waMessageId ?? null,
            waDeliveryStatus: waMessageId ? "sent" : null,
          })
          .where(eq(notificationLogsTable.id, row.id));

        logger.info(
          {
            id: row.id,
            recipient: row.recipient,
            retryCount: newRetryCount,
            context: row.context,
            refId: row.refId,
            hasMedia: !!row.mediaUrl,
            waMessageId,
          },
          "[waRetryWorker] retry sukses",
        );
      } else {
        const backoffMs = BACKOFF_BASE * Math.pow(2, newRetryCount - 1);
        const nextRetry = newRetryCount < MAX_RETRIES ? new Date(Date.now() + backoffMs) : null;

        await db
          .update(notificationLogsTable)
          .set({
            retryCount:  newRetryCount,
            nextRetryAt: nextRetry,
            errorMsg:    `[retry ${newRetryCount}] ${errorMsg}`,
          })
          .where(eq(notificationLogsTable.id, row.id));

        logger.warn(
          { id: row.id, recipient: row.recipient, retryCount: newRetryCount, nextRetry, errorMsg, hasMedia: !!row.mediaUrl },
          "[waRetryWorker] retry gagal",
        );
      }
    }
  } catch (err) {
    logger.error({ err }, "[waRetryWorker] tick error (non-fatal)");
  }
}

export function startWaRetryWorker(): void {
  registerHeartbeat("wa-retry-worker", INTERVAL_MS);
  logger.info(`[waRetryWorker] started — interval ${INTERVAL_MS / 1000}s, max retries ${MAX_RETRIES}`);
  // Fix existing records yang punya relative media_url sebelum retry pertama
  void fixRelativeMediaUrls();
  setTimeout(() => {
    void runRetryTick();
    setInterval(() => {
      beat("wa-retry-worker");
      void runRetryTick();
    }, INTERVAL_MS).unref();
  }, 2 * 60 * 1000).unref();
}
