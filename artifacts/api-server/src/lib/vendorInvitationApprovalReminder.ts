/**
 * Vendor Invitation Approval Reminder
 *
 * Runs every hour. Finds portal_vendor_invitations that:
 *  - status = 'accepted' (vendor sudah melengkapi pendaftaran)
 *  - supplier_id IS NULL (belum di-approve/aktivasi admin)
 *  - accepted_at sudah lebih dari 24 jam lalu
 *
 * Kirim WA pengingat ke admin. Deduplication via notificationLogsTable
 * (context="vendor_invitation_approval_reminder", refId=invitation.id) — hanya
 * dikirim sekali per undangan agar tidak spam admin di setiap siklus worker.
 */

import { db } from "@workspace/db";
import { notificationLogsTable } from "@workspace/db/schema";
import { sql, and, eq, inArray } from "drizzle-orm";
import { sendViaService as sendWhatsApp } from "./waTransport.js";
import { getAdminWa, getAdminGroupWa, getAdminPhones } from "./adminWa.js";
import { getPreferredDomain } from "./domain.js";
import { logger } from "./logger.js";

const INTERVAL_MS = 60 * 60 * 1000; // setiap 1 jam
const INITIAL_DELAY_MS = 8 * 60 * 1000; // delay 8 menit setelah boot
const CONTEXT = "vendor_invitation_approval_reminder";
const CONTEXT_ESCALATION = "vendor_invitation_approval_escalation";
const STALE_AFTER_HOURS = 24;
const ESCALATION_AFTER_HOURS = 48;

function getAdminPanelUrl(): string {
  const domain = getPreferredDomain();
  const base = domain ? `https://${domain}` : "http://localhost:5000";
  return `${base}/admin?tab=vendor-invitations`;
}

type PendingInvitation = {
  id: number;
  vendorName: string;
  companyName: string | null;
  categoryLabel: string | null;
  acceptedAt: string;
};

async function findPendingInvitationsOlderThan(hours: number): Promise<PendingInvitation[]> {
  const rows = await db.execute(sql`
    SELECT id, vendor_name, company_name, category_label, accepted_at
    FROM portal_vendor_invitations
    WHERE status = 'accepted'
      AND supplier_id IS NULL
      AND accepted_at IS NOT NULL
      AND accepted_at <= NOW() - INTERVAL '${sql.raw(String(hours))} hours'
  `);
  return ((rows as any).rows ?? []).map((r: any) => ({
    id: r.id,
    vendorName: r.vendor_name,
    companyName: r.company_name,
    categoryLabel: r.category_label,
    acceptedAt: r.accepted_at,
  }));
}

async function filterAlreadyNotified(ids: string[], context: string): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await db
    .select({ refId: notificationLogsTable.refId })
    .from(notificationLogsTable)
    .where(
      and(
        eq(notificationLogsTable.context, context),
        inArray(notificationLogsTable.refId, ids),
      )
    );
  return rows.map(r => r.refId).filter(Boolean) as string[];
}

async function markNotified(id: string, recipient: string, message: string, context: string) {
  await db.insert(notificationLogsTable).values({
    channel: "wa",
    recipient,
    message,
    context,
    refId: id,
    status: "sent",
    retryCount: 0,
    createdAt: new Date(),
  } as any).catch(() => {});
}

function buildInvitationLines(items: PendingInvitation[]): string[] {
  return items.slice(0, 15).map(i => {
    const acceptedDate = new Date(i.acceptedAt).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });
    return `• ${i.companyName || i.vendorName} (${i.categoryLabel || "Umum"}) — diterima ${acceptedDate}`;
  }).concat(items.length > 15 ? [`...dan ${items.length - 15} lainnya`] : []);
}

async function collectEscalationRecipients(): Promise<string[]> {
  const [groupWa, phones] = await Promise.all([getAdminGroupWa(), getAdminPhones()]);
  const recipients = new Set<string>();
  if (groupWa) recipients.add(groupWa);
  for (const p of phones) recipients.add(p);
  return Array.from(recipients);
}

export async function runVendorInvitationApprovalReminderCheck(): Promise<void> {
  logger.info("Vendor invitation approval reminder: starting");
  try {
    const adminWa = await getAdminWa();
    if (!adminWa) {
      logger.info("Vendor invitation approval reminder: admin WA belum diatur, skip");
      return;
    }

    const panelUrl = getAdminPanelUrl();

    // Tier 1: pengingat standar setelah 24 jam, ke admin utama.
    const stale = await findPendingInvitationsOlderThan(STALE_AFTER_HOURS);
    if (stale.length > 0) {
      const ids = stale.map(i => String(i.id));
      const alreadySent = new Set(await filterAlreadyNotified(ids, CONTEXT));
      const toNotify = stale.filter(i => !alreadySent.has(String(i.id)));

      logger.info(
        { total: stale.length, toNotify: toNotify.length },
        "Vendor invitation approval reminder: undangan tertunda ditemukan"
      );

      if (toNotify.length > 0) {
        const waMessage = [
          `*Pengingat: Vendor Menunggu Persetujuan*`,
          ``,
          `Ada ${toNotify.length} undangan vendor yang sudah diterima lebih dari ${STALE_AFTER_HOURS} jam tapi belum di-approve:`,
          ``,
          ...buildInvitationLines(toNotify),
          ``,
          `Tinjau & setujui: ${panelUrl}`,
        ].join("\n");

        await sendWhatsApp(adminWa, waMessage, {
          context: CONTEXT,
          refType: "portal_vendor_invitations",
          refId: `batch-${Date.now()}`,
        });

        for (const inv of toNotify) {
          await markNotified(String(inv.id), adminWa, waMessage, CONTEXT);
        }

        logger.info({ notified: toNotify.length }, "Vendor invitation approval reminder: WA reminder sent");
      }
    } else {
      logger.info("Vendor invitation approval reminder: tidak ada undangan yang tertunda (tier 1)");
    }

    // Tier 2: eskalasi setelah 48 jam, ke grup WA + semua nomor admin terdaftar.
    const escalated = await findPendingInvitationsOlderThan(ESCALATION_AFTER_HOURS);
    if (escalated.length === 0) {
      logger.info("Vendor invitation approval reminder: tidak ada undangan yang perlu eskalasi (tier 2)");
      return;
    }

    const escIds = escalated.map(i => String(i.id));
    const escAlreadySent = new Set(await filterAlreadyNotified(escIds, CONTEXT_ESCALATION));
    const toEscalate = escalated.filter(i => !escAlreadySent.has(String(i.id)));

    if (toEscalate.length === 0) return;

    const recipients = await collectEscalationRecipients();
    if (recipients.length === 0) {
      logger.info("Vendor invitation approval reminder: tidak ada penerima eskalasi (grup/nomor admin belum diatur), skip tier 2");
      return;
    }

    const escMessage = [
      `*URGENT — Vendor Menunggu Persetujuan >${ESCALATION_AFTER_HOURS} Jam*`,
      ``,
      `${toEscalate.length} undangan vendor BELUM di-approve setelah lebih dari ${ESCALATION_AFTER_HOURS} jam sejak diterima:`,
      ``,
      ...buildInvitationLines(toEscalate),
      ``,
      `Mohon segera ditindaklanjuti: ${panelUrl}`,
    ].join("\n");

    for (const recipient of recipients) {
      await sendWhatsApp(recipient, escMessage, {
        context: CONTEXT_ESCALATION,
        refType: "portal_vendor_invitations",
        refId: `escalation-${Date.now()}`,
      });
    }

    for (const inv of toEscalate) {
      await markNotified(String(inv.id), recipients.join(","), escMessage, CONTEXT_ESCALATION);
    }

    logger.info(
      { escalated: toEscalate.length, recipients: recipients.length },
      "Vendor invitation approval reminder: escalation sent"
    );
  } catch (err) {
    logger.error({ err }, "Vendor invitation approval reminder: error (non-fatal)");
  }
}

export function startVendorInvitationApprovalReminder(): void {
  const run = () =>
    runVendorInvitationApprovalReminderCheck().catch(err => {
      logger.warn({ err }, "Vendor invitation approval reminder: uncaught error");
    });

  setTimeout(() => {
    run();
    setInterval(run, INTERVAL_MS).unref();
  }, INITIAL_DELAY_MS).unref();

  logger.info(
    { intervalHours: INTERVAL_MS / 3_600_000, initialDelayMin: INITIAL_DELAY_MS / 60_000 },
    "Vendor invitation approval reminder started"
  );
}
