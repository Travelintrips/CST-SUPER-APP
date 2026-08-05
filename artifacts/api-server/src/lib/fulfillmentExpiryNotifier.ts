/**
 * Fulfillment Expiry Notifier
 *
 * Runs every hour. Finds vendorFulfillmentLinks that:
 *  - status = "pending" (vendor belum submit)
 *  - expiresAt antara sekarang dan 24 jam ke depan (H-1)
 *
 * Kirim WA pengingat ke vendor. Deduplication via notificationLogsTable
 * (context="fulfillment_expiry_reminder", refId=link.token).
 */

import { db, vendorFulfillmentLinksTable, suppliersTable, logisticOrdersTable } from "@workspace/db";
import { notificationLogsTable } from "@workspace/db/schema";
import { sql, and, eq, gte, lte, isNotNull, inArray } from "drizzle-orm";
import { sendViaService as sendWhatsApp } from "./waTransport.js";
import { getPreferredDomain } from "./domain.js";
import { logger } from "./logger.js";

const INTERVAL_MS     = 60 * 60 * 1000;   // setiap 1 jam
const INITIAL_DELAY_MS = 5 * 60 * 1000;   // delay 5 menit setelah boot
const CONTEXT         = "fulfillment_expiry_reminder";

// ── Cari link yang akan expired dalam 24 jam ──────────────────────────────────
async function findExpiringLinks() {
  const now    = new Date();
  const in24h  = new Date(now.getTime() + 24 * 3600_000);
  return db
    .select({
      id:        vendorFulfillmentLinksTable.id,
      token:     vendorFulfillmentLinksTable.token,
      orderId:   vendorFulfillmentLinksTable.orderId,
      vendorId:  vendorFulfillmentLinksTable.vendorId,
      expiresAt: vendorFulfillmentLinksTable.expiresAt,
    })
    .from(vendorFulfillmentLinksTable)
    .where(
      and(
        eq(vendorFulfillmentLinksTable.status, "pending"),
        isNotNull(vendorFulfillmentLinksTable.expiresAt),
        gte(vendorFulfillmentLinksTable.expiresAt, now),
        lte(vendorFulfillmentLinksTable.expiresAt, in24h),
      )
    );
}

// ── Filter sudah pernah dikirimi reminder ─────────────────────────────────────
async function filterAlreadyNotified(tokens: string[]): Promise<string[]> {
  if (tokens.length === 0) return [];
  const rows = await db
    .select({ refId: notificationLogsTable.refId })
    .from(notificationLogsTable)
    .where(
      and(
        eq(notificationLogsTable.context, CONTEXT),
        inArray(notificationLogsTable.refId, tokens),
      )
    );
  return rows.map(r => r.refId).filter(Boolean) as string[];
}

// ── Catat ke notificationLogsTable (sebagai dedup marker) ────────────────────
async function markNotified(token: string, recipient: string, message: string) {
  await db.insert(notificationLogsTable).values({
    channel:   "wa",
    recipient,
    message,
    context:   CONTEXT,
    refId:     token,
    status:    "sent",
    retryCount: 0,
    createdAt: new Date(),
  } as any).catch(() => {});
}

// ── Main check ────────────────────────────────────────────────────────────────
export async function runFulfillmentExpiryCheck(): Promise<void> {
  logger.info("Fulfillment expiry check: starting");
  try {
    const expiring = await findExpiringLinks();
    if (expiring.length === 0) {
      logger.info("Fulfillment expiry check: no expiring links");
      return;
    }

    const tokens          = expiring.map(l => l.token);
    const alreadySent     = new Set(await filterAlreadyNotified(tokens));
    const toNotify        = expiring.filter(l => !alreadySent.has(l.token));

    logger.info(
      { total: expiring.length, toNotify: toNotify.length },
      "Fulfillment expiry check: links found"
    );

    if (toNotify.length === 0) return;

    const domain = getPreferredDomain() || "cstlogistic.co.id";

    for (const link of toNotify) {
      try {
        // Ambil data vendor & order
        const [[vendor], [order]] = await Promise.all([
          link.vendorId
            ? db.select({ name: suppliersTable.name, phone: suppliersTable.phone })
                .from(suppliersTable)
                .where(eq(suppliersTable.id, link.vendorId))
            : Promise.resolve([null]),
          db.select({ orderNumber: logisticOrdersTable.orderNumber, shipmentType: logisticOrdersTable.shipmentType, origin: logisticOrdersTable.origin, destination: logisticOrdersTable.destination })
            .from(logisticOrdersTable)
            .where(eq(logisticOrdersTable.id, link.orderId)),
        ]);

        const vendorPhone = (vendor as any)?.phone ?? null;
        if (!vendorPhone) {
          logger.info({ token: link.token }, "Fulfillment expiry: vendor tidak punya nomor WA, skip");
          continue;
        }

        const formUrl    = `https://${domain}/vendor-fulfillment/${link.token}`;
        const expiryStr  = link.expiresAt
          ? new Date(link.expiresAt).toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" })
          : "hari ini";

        const waMsg =
          `⏰ *Pengingat: Form Fulfillment Segera Kadaluarsa*\n\n` +
          `Halo ${(vendor as any)?.name ?? "Vendor"},\n\n` +
          `Form fulfillment untuk order *${(order as any)?.orderNumber ?? `#${link.orderId}`}* ` +
          `belum diisi dan akan kadaluarsa pada *${expiryStr}*.\n` +
          ((order as any)?.shipmentType ? `Layanan: ${(order as any).shipmentType}\n` : "") +
          (((order as any)?.origin && (order as any)?.destination)
            ? `Rute: ${(order as any).origin} → ${(order as any).destination}\n`
            : "") +
          `\nSilakan isi sekarang melalui link berikut:\n${formUrl}\n\n` +
          `_Jika sudah mengisi, abaikan pesan ini._`;

        await sendWhatsApp(vendorPhone, waMsg, {
          context: CONTEXT,
          refType: "vendor_fulfillment_link",
          refId:   link.token,
        });

        await markNotified(link.token, vendorPhone, waMsg);

        logger.info(
          { token: link.token, vendorPhone, orderId: link.orderId },
          "Fulfillment expiry: WA reminder sent"
        );
      } catch (innerErr) {
        logger.warn({ innerErr, token: link.token }, "Fulfillment expiry: gagal kirim 1 link, lanjut");
      }
    }
  } catch (err) {
    logger.error({ err }, "Fulfillment expiry check: error (non-fatal)");
  }
}

// ── Scheduler ─────────────────────────────────────────────────────────────────
export function startFulfillmentExpiryNotifier(): void {
  const run = () =>
    runFulfillmentExpiryCheck().catch(err => {
      logger.warn({ err }, "Fulfillment expiry notifier: uncaught error");
    });

  setTimeout(() => {
    run();
    setInterval(run, INTERVAL_MS).unref();
  }, INITIAL_DELAY_MS).unref();

  logger.info(
    { intervalHours: INTERVAL_MS / 3_600_000, initialDelayMin: INITIAL_DELAY_MS / 60_000 },
    "Fulfillment expiry notifier started"
  );
}
