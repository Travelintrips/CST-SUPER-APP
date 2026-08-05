import { db } from "@workspace/db";
import { notificationLogsTable } from "@workspace/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { createHash } from "crypto";
import { logger } from "./logger.js";

const DEDUP_WINDOW_MS = parseInt(process.env.WA_DEDUP_WINDOW_MS ?? "1800000", 10);

function computeDedupKey(
  channel: string,
  recipient: string,
  context: string,
  refId: string,
): string {
  const bucket = Math.floor(Date.now() / DEDUP_WINDOW_MS);
  return createHash("sha256")
    .update(`${channel}:${recipient}:${context}:${refId}:${bucket}`)
    .digest("hex");
}

export interface LogNotifOptions {
  channel: "wa" | "email";
  recipient: string;
  subject?: string;
  message: string;
  status: "sent" | "failed" | "deduped" | "simulated";
  errorMsg?: string;
  context?: string;
  refType?: string;
  refId?: string;
  mediaUrl?: string;
  waMessageId?: string;
}

export async function logNotification(opts: LogNotifOptions): Promise<void> {
  const dedupKey =
    opts.status === "sent" && opts.context && opts.refId
      ? computeDedupKey(opts.channel, opts.recipient, opts.context, opts.refId)
      : null;

  try {
    await db
      .insert(notificationLogsTable)
      .values({
        channel: opts.channel,
        recipient: opts.recipient,
        subject: opts.subject ?? null,
        message: opts.message.slice(0, 2000),
        status: opts.status,
        errorMsg: opts.errorMsg ?? null,
        context: opts.context ?? "general",
        refType: opts.refType ?? null,
        refId: opts.refId ?? null,
        mediaUrl: opts.mediaUrl ?? null,
        dedupKey,
        waMessageId: opts.waMessageId ?? null,
        waDeliveryStatus: opts.waMessageId ? "sent" : null,
      })
      .onConflictDoNothing({ target: notificationLogsTable.dedupKey });
  } catch (err) {
    logger.error({ err }, "Failed to write notification log");
  }
}

export async function wasRecentlyNotified(
  context: string,
  refId: string,
  windowMs = 5 * 60 * 1000,
): Promise<boolean> {
  try {
    const since = new Date(Date.now() - windowMs);
    const rows = await db
      .select({ id: notificationLogsTable.id })
      .from(notificationLogsTable)
      .where(
        and(
          eq(notificationLogsTable.channel, "wa"),
          eq(notificationLogsTable.context, context),
          eq(notificationLogsTable.refId, refId),
          eq(notificationLogsTable.status, "sent"),
          gte(notificationLogsTable.createdAt, since),
        ),
      )
      .limit(1);
    return rows.length > 0;
  } catch (err) {
    logger.warn({ err, context, refId }, "wasRecentlyNotified DB check failed — allowing send");
    return false;
  }
}
