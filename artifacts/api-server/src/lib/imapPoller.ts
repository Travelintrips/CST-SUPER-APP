import { ImapFlow } from "imapflow";
import { simpleParser } from "mailparser";
import { randomUUID } from "crypto";
import {
  db,
  emailCorrespondencesTable,
  emailAttachmentsTable,
} from "@workspace/db";
import { eq, inArray } from "drizzle-orm";
import { ObjectStorageService } from "./objectStorage.js";
import { logger } from "./logger.js";
import { processEmailForAiIntake } from "./aiOrderIntake.js";
import { sendViaService as sendWhatsApp } from "./waTransport.js";
import { getAdminWa, getAdminGroupWa } from "./adminWa.js";
import { getPreferredDomain } from "./domain.js";

function getImapConfig() {
  const host = process.env.IMAP_HOST;
  const port = process.env.IMAP_PORT ? Number(process.env.IMAP_PORT) : undefined;
  const user = process.env.IMAP_USER;
  const pass = process.env.IMAP_PASSWORD;
  return { host, port, user, pass };
}

function isImapConfigured(): boolean {
  const { host, user, pass } = getImapConfig();
  return !!(host && user && pass);
}

const _imapStorage = new ObjectStorageService();

async function notifyNewEmailViaWhatsApp(
  emailId: number,
  subject: string,
  fromEmail: string | null,
): Promise<void> {
  try {
    const domain = getPreferredDomain();
    const baseUrl = domain ? `https://${domain}` : "";

    const emailLink = baseUrl ? `${baseUrl}/bizportal/correspondences` : "";
    const approvalLink = baseUrl ? `${baseUrl}/bizportal/approvals` : "";

    const fromLine = fromEmail ? `\nDari: ${fromEmail}` : "";
    const emailLinkLine = emailLink ? `\n📧 Lihat email: ${emailLink}` : "";
    const approvalLinkLine = approvalLink ? `\n✅ Halaman Approval: ${approvalLink}` : "";

    const message =
      `📬 *Email Baru Masuk*\n` +
      `Subject: ${subject}` +
      fromLine +
      emailLinkLine +
      approvalLinkLine;

    const [adminWa, adminGroupWa] = await Promise.all([getAdminWa(), getAdminGroupWa()]);

    const targets = [adminGroupWa, adminWa].filter(Boolean);
    if (targets.length === 0) {
      logger.debug({ emailId }, "No admin WA target configured — skipping email notification");
      return;
    }

    await Promise.all(targets.map((t) => sendWhatsApp(t, message)));
    logger.info({ emailId, targets }, "WA notification sent for new email");
  } catch (err) {
    logger.warn({ err, emailId }, "Failed to send WA notification for new email");
  }
}

async function uploadAttachmentToStorage(
  buffer: Buffer,
  _fileName: string,
  mimeType: string,
): Promise<string> {
  const objectId = randomUUID();
  const storagePath = `private/documents/email/${objectId}`;
  await _imapStorage.uploadFile(buffer, storagePath, mimeType);
  return `/objects/documents/email/${objectId}`;
}

export async function syncImapEmails(): Promise<{ synced: number; errors: number }> {
  if (!isImapConfigured()) {
    logger.debug("IMAP not configured (IMAP_HOST/IMAP_USER/IMAP_PASSWORD missing), skipping sync");
    return { synced: 0, errors: 0 };
  }

  const { host, port, user, pass } = getImapConfig();
  let synced = 0;
  let errors = 0;

  const client = new ImapFlow({
    host: host!,
    port: port ?? 993,
    secure: true,
    auth: { user: user!, pass: pass! },
    logger: false,
    socketTimeout: 30000,
    connectionTimeout: 15000,
    disableAutoIdle: true,
    disableCompression: true,
  } as any);

  // Prevent unhandled 'error' events from crashing the process on socket timeout
  client.on("error", (err) => {
    logger.warn({ err }, "IMAP client error (socket/connection)");
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock("INBOX");

    try {
      // Only search the last 30 days — avoids fetching the entire mailbox on large inboxes
      const sinceDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const uidsResult = await client.search({ since: sinceDate }, { uid: true });
      const uids: number[] = Array.isArray(uidsResult) ? uidsResult : [];

      if (uids.length === 0) {
        logger.info({ synced: 0, errors: 0 }, "IMAP sync completed (no recent emails)");
        return { synced: 0, errors: 0 };
      }

      const recentUids = uids.slice(-200);
      // Skip UIDs already cached in memory from a previous sync run
      const uncachedUids = recentUids.filter((uid: number) => !processedUids.has(uid));

      if (uncachedUids.length === 0) {
        logger.info({ synced: 0, errors: 0, cached: recentUids.length }, "IMAP sync completed (all UIDs cached)");
        return { synced: 0, errors: 0 };
      }

      // ── Phase 1: Batch-fetch envelopes (ONE IMAP command) to get messageIds ──
      // Envelopes are tiny (no body), so this is fast even for 100+ emails.
      const uidToMsgId = new Map<number, string>();
      const uidRange = uncachedUids.join(",");
      for await (const msg of client.fetch(uidRange, { uid: true, envelope: true }, { uid: true })) {
        const msgId = (msg.envelope as any)?.messageId ?? `uid-${msg.uid}-${user}`;
        uidToMsgId.set(msg.uid, msgId);
      }

      // Mark any UIDs that had no envelope as cached (skip them)
      for (const uid of uncachedUids) {
        if (!uidToMsgId.has(uid)) processedUids.add(uid);
      }

      // ── Phase 2: Batch DB deduplication check ──
      const candidateMsgIds = [...uidToMsgId.values()];
      const existingRows = candidateMsgIds.length > 0
        ? await db
            .select({ emailMessageId: emailCorrespondencesTable.emailMessageId })
            .from(emailCorrespondencesTable)
            .where(inArray(emailCorrespondencesTable.emailMessageId, candidateMsgIds))
        : [];
      const existingSet = new Set(existingRows.map((r) => r.emailMessageId));

      // Mark already-stored UIDs as cached
      for (const [uid, msgId] of uidToMsgId) {
        if (existingSet.has(msgId)) processedUids.add(uid);
      }

      // ── Phase 3: fetchOne only for truly new emails ──
      const newUids = uncachedUids.filter((uid: number) => {
        const msgId = uidToMsgId.get(uid);
        return msgId !== undefined && !existingSet.has(msgId);
      });

      logger.info({ total: uncachedUids.length, alreadyStored: existingSet.size, toFetch: newUids.length }, "IMAP: deduplication complete");

      for (const uid of newUids) {
        const messageId = uidToMsgId.get(uid)!;
        try {
          const msgData = await client.fetchOne(String(uid), { uid: true, source: true }, { uid: true });
          if (!msgData || !("source" in msgData) || !msgData.source) {
            processedUids.add(uid);
            continue;
          }

          const parsed = await simpleParser(msgData.source as Buffer);

          const fromAddr = Array.isArray(parsed.from?.value)
            ? parsed.from!.value[0]
            : undefined;
          const toList = parsed.to
            ? (Array.isArray(parsed.to)
              ? parsed.to.flatMap((a) => a.value)
              : (parsed.to as any).value ?? [])
            : [];
          const ccList = parsed.cc
            ? (Array.isArray(parsed.cc)
              ? parsed.cc.flatMap((a) => a.value)
              : (parsed.cc as any).value ?? [])
            : [];

          const fromEmail = fromAddr?.address ?? null;
          const toEmail = toList.map((a: any) => a.address).filter(Boolean).join(", ") || null;
          const ccEmail = ccList.map((a: any) => a.address).filter(Boolean).join(", ") || null;

          const body = parsed.text ?? (typeof parsed.html === "string" ? parsed.html.replace(/<[^>]*>/g, "") : null) ?? null;
          const inReplyTo = (parsed as any).inReplyTo ?? null;

          const [saved] = await db
            .insert(emailCorrespondencesTable)
            .values({
              emailMessageId: messageId,
              fromEmail,
              toEmail,
              ccEmail,
              subject: parsed.subject ?? "(No Subject)",
              body: body ? body.slice(0, 10000) : null,
              receivedAt: parsed.date ?? new Date(),
              status: "new",
              inReplyTo: inReplyTo ? String(inReplyTo).slice(0, 500) : null,
            })
            .returning();

          if (!saved) continue;

          // Fire-and-forget WA notification for new email
          notifyNewEmailViaWhatsApp(
            saved.id,
            parsed.subject ?? "(No Subject)",
            fromEmail,
          ).catch(() => {});

          // Async AI intake — fire-and-forget (don't block email sync)
          if (body && parsed.subject) {
            processEmailForAiIntake(
              saved.id,
              parsed.subject ?? "(No Subject)",
              body,
              fromEmail,
              inReplyTo ? String(inReplyTo) : null,
            ).catch((err) => logger.warn({ err, emailId: saved.id }, "AI intake: email processing failed"));
          }

          for (const att of parsed.attachments ?? []) {
            if (!att.content) continue;
            try {
              const fileUrl = await uploadAttachmentToStorage(
                att.content,
                att.filename ?? "attachment",
                att.contentType ?? "application/octet-stream",
              );
              await db.insert(emailAttachmentsTable).values({
                emailCorrespondenceId: saved.id,
                fileName: att.filename ?? "attachment",
                fileUrl,
                mimeType: att.contentType ?? "application/octet-stream",
              });
            } catch (attErr) {
              logger.warn({ attErr, fileName: att.filename }, "Failed to store email attachment");
            }
          }

          processedUids.add(uid);
          synced++;
        } catch (msgErr) {
          logger.warn({ msgErr, uid }, "Failed to process email");
          errors++;
        }
      }
    } finally {
      lock.release();
    }
  } catch (err) {
    logger.error({ err }, "IMAP connection/sync failed");
    errors++;
  } finally {
    try { await client.logout(); } catch {}
  }

  logger.info({ synced, errors }, "IMAP sync completed");
  return { synced, errors };
}

let syncTimer: ReturnType<typeof setInterval> | null = null;
let isSyncing = false;
// In-memory UID cache — avoids fetchOne for already-processed UIDs across periodic syncs
const processedUids = new Set<number>();

export async function safeSyncImapEmails(context: string): Promise<{ synced: number; errors: number }> {
  if (isSyncing) {
    logger.debug({ context }, "IMAP sync skipped — previous sync still running");
    return { synced: 0, errors: 0 };
  }
  isSyncing = true;

  // Hard deadline: release mutex after 300s even if IMAP connection hangs.
  // The first sync after startup may take 150-180s due to Gmail throttling on
  // batch envelope fetch (100+ UIDs). Subsequent syncs are fast (<10s) because
  // the in-memory processedUids cache skips already-seen UIDs.
  const timeoutPromise = new Promise<{ synced: number; errors: number }>(
    (_, reject) => setTimeout(() => reject(new Error("IMAP sync exceeded 300s deadline")), 300_000),
  );

  try {
    return await Promise.race([syncImapEmails(), timeoutPromise]);
  } catch (err) {
    logger.error({ err, context }, "IMAP sync failed");
    return { synced: 0, errors: 1 };
  } finally {
    isSyncing = false;
  }
}

export function startImapPoller(intervalMs = 5 * 60 * 1000): void {
  if (!isImapConfigured()) {
    logger.info("IMAP not configured — email sync disabled. Set IMAP_HOST, IMAP_USER, IMAP_PASSWORD to enable.");
    return;
  }

  // Delay initial sync by 10s to let server fully boot and avoid connection storm on restart
  setTimeout(() => {
    safeSyncImapEmails("initial").catch(() => {});
  }, 10_000);

  syncTimer = setInterval(() => {
    safeSyncImapEmails("periodic").catch(() => {});
  }, intervalMs);

  logger.info({ intervalMs }, "IMAP poller started");
}

export function stopImapPoller(): void {
  if (syncTimer) {
    clearInterval(syncTimer);
    syncTimer = null;
  }
}
