/**
 * driverJobWorker.ts
 * FASE 5 — Auto-cancel stale jobs + WA reminder ke driver INTERNAL
 */
import { db, driverJobsTable, driverJobLogsTable, driversTable, logisticOrdersTable } from "@workspace/db";
import { eq, and, notInArray, desc, gte, lt } from "drizzle-orm";
import { sendViaService as sendWhatsApp } from "./waTransport.js";
import { getAdminGroupWa } from "./adminWa.js";
import { logger } from "./logger.js";
import { registerHeartbeat, beat } from "./workerHeartbeat.js";

const TERMINAL = ["COMPLETED", "CANCELLED"] as const;
const AUTO_CANCEL_HOURS = Number(process.env.DRIVER_AUTO_CANCEL_HOURS ?? 24);
const REMINDER_HOURS = Number(process.env.DRIVER_REMINDER_HOURS ?? 6);
const WORKER_INTERVAL_MS = 15 * 60 * 1000;
const INITIAL_DELAY_MS = 5 * 60 * 1000;

const REMINDED_JOBS = new Set<number>(); // in-memory guard, reset on restart

function nowWIB(): string {
  return new Date().toLocaleString("id-ID", {
    timeZone: "Asia/Jakarta",
    day: "2-digit", month: "long", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }) + " WIB";
}

const STATUS_LABEL: Record<string, string> = {
  ASSIGNED:               "Driver Ditugaskan",
  ACCEPTED:               "Driver Menerima Job",
  ON_THE_WAY_TO_PICKUP:   "Menuju Lokasi Pickup",
  ARRIVED_AT_PICKUP:      "Tiba di Lokasi Pickup",
  PICKED_UP:              "Barang Berhasil Diambil",
  IN_TRANSIT:             "Dalam Perjalanan",
  ARRIVED_AT_DESTINATION: "Tiba di Tujuan",
  DELIVERED:              "Barang Terkirim",
  COMPLETED:              "Pengiriman Selesai",
  CANCELLED:              "Dibatalkan",
};

async function runDriverJobWorker(): Promise<void> {
  const activeJobs = await db
    .select({
      id: driverJobsTable.id,
      jobNumber: driverJobsTable.jobNumber,
      status: driverJobsTable.status,
      assignedAt: driverJobsTable.assignedAt,
      driverId: driverJobsTable.driverId,
      driverType: driverJobsTable.driverType,
      executionMode: driverJobsTable.executionMode,
      driverNameOverride: driverJobsTable.driverNameOverride,
      driverPhoneOverride: driverJobsTable.driverPhoneOverride,
      waProgressToken: driverJobsTable.waProgressToken,
      logisticOrderId: driverJobsTable.logisticOrderId,
      pickupAddress: driverJobsTable.pickupAddress,
      deliveryAddress: driverJobsTable.deliveryAddress,
    })
    .from(driverJobsTable)
    .where(notInArray(driverJobsTable.status as any, TERMINAL as any));

  if (activeJobs.length === 0) return;

  for (const job of activeJobs) {
    try {
      const [lastLog] = await db
        .select({ timestamp: driverJobLogsTable.timestamp, note: driverJobLogsTable.note })
        .from(driverJobLogsTable)
        .where(eq(driverJobLogsTable.driverJobId, job.id))
        .orderBy(desc(driverJobLogsTable.timestamp))
        .limit(1);

      const lastUpdate = lastLog?.timestamp ?? job.assignedAt;
      const hoursStale = (Date.now() - lastUpdate.getTime()) / 3_600_000;

      if (hoursStale < REMINDER_HOURS) continue;

      // ── AUTO-CANCEL ──────────────────────────────────────────────────────────
      if (hoursStale >= AUTO_CANCEL_HOURS) {
        logger.info({ jobId: job.id, jobNumber: job.jobNumber, hoursStale: Math.round(hoursStale) }, "driverJobWorker: auto-cancel stale job");

        await db
          .update(driverJobsTable)
          .set({ status: "CANCELLED" })
          .where(eq(driverJobsTable.id, job.id));

        await db.insert(driverJobLogsTable).values({
          driverJobId: job.id,
          status: "CANCELLED",
          note: `Auto-cancel: tidak ada update progress dalam ${AUTO_CANCEL_HOURS} jam`,
          timestamp: new Date(),
        });

        REMINDED_JOBS.delete(job.id);

        // WA ke admin group
        const adminGroupWa = await getAdminGroupWa().catch(() => null);
        if (adminGroupWa) {
          let orderInfo = "";
          if (job.logisticOrderId) {
            const [order] = await db
              .select({ orderNumber: logisticOrdersTable.orderNumber, customerName: logisticOrdersTable.customerName })
              .from(logisticOrdersTable)
              .where(eq(logisticOrdersTable.id, job.logisticOrderId));
            if (order) orderInfo = `\n📦 Order: ${order.orderNumber} (${order.customerName})`;
          }
          const driverDisplay = job.driverType === "INTERNAL"
            ? (job.driverNameOverride ?? "Driver Internal")
            : "Driver (External)";
          const msg = [
            `⏰ *Auto-Cancel Driver Job*`,
            ``,
            `Job *${job.jobNumber}* otomatis dibatalkan`,
            `karena tidak ada update dalam *${AUTO_CANCEL_HOURS} jam*.`,
            ``,
            `👤 Driver: ${driverDisplay}`,
            `📍 Status Terakhir: ${STATUS_LABEL[job.status] ?? job.status}`,
            orderInfo,
            `🕐 ${nowWIB()}`,
          ].filter((v) => v !== "").join("\n");
          sendWhatsApp(adminGroupWa, msg).catch(() => {});
        }
        continue;
      }

      // ── WA REMINDER ──────────────────────────────────────────────────────────
      if (REMINDED_JOBS.has(job.id)) continue;

      // Check jika sudah pernah kirim reminder sejak 6 jam terakhir via log
      const reminderAlreadySent = lastLog?.note?.includes("Auto-reminder:") ?? false;
      if (reminderAlreadySent) {
        REMINDED_JOBS.add(job.id);
        continue;
      }

      logger.info({ jobId: job.id, jobNumber: job.jobNumber, hoursStale: Math.round(hoursStale) }, "driverJobWorker: sending reminder");

      await db.insert(driverJobLogsTable).values({
        driverJobId: job.id,
        status: job.status as typeof driverJobsTable.$inferSelect.status,
        note: `Auto-reminder: driver belum update progress sejak ${Math.round(hoursStale)} jam`,
        timestamp: new Date(),
      });

      REMINDED_JOBS.add(job.id);

      // WA reminder ke admin group
      const adminGroupWa = await getAdminGroupWa().catch(() => null);
      if (adminGroupWa) {
        let orderInfo = "";
        if (job.logisticOrderId) {
          const [order] = await db
            .select({ orderNumber: logisticOrdersTable.orderNumber, customerName: logisticOrdersTable.customerName })
            .from(logisticOrdersTable)
            .where(eq(logisticOrdersTable.id, job.logisticOrderId));
          if (order) orderInfo = `\n📦 Order: ${order.orderNumber} (${order.customerName})`;
        }
        const driverDisplay = job.driverType === "INTERNAL"
          ? (job.driverNameOverride ?? "Driver Internal")
          : "Driver (External)";
        const msg = [
          `⚠️ *Reminder: Driver Belum Update Progress*`,
          ``,
          `Job *${job.jobNumber}* sudah ${Math.round(hoursStale)} jam`,
          `tanpa update progress.`,
          ``,
          `👤 Driver: ${driverDisplay}`,
          `📍 Status: ${STATUS_LABEL[job.status] ?? job.status}`,
          orderInfo,
          ``,
          `Akan auto-cancel dalam ${Math.round(AUTO_CANCEL_HOURS - hoursStale)} jam jika tidak ada update.`,
          `🕐 ${nowWIB()}`,
        ].filter((v) => v !== "").join("\n");
        sendWhatsApp(adminGroupWa, msg).catch(() => {});
      }

      // WA reminder ke driver INTERNAL via nomor override
      if (job.executionMode === "WA_MINI_FORM" && job.driverPhoneOverride) {
        try {
          const { normalizePhone } = await import("./phoneUtils.js");
          const phone = normalizePhone(job.driverPhoneOverride);
          const domain = process.env.REPLIT_DEV_DOMAIN ?? "cstlogistic.co.id";
          const waLink = job.waProgressToken ? `https://${domain}/driver-progress/${job.waProgressToken}` : null;
          const msg = [
            `🚚 *Reminder Pengiriman — B2B Marketplace and Logistic*`,
            ``,
            `Halo ${job.driverNameOverride ?? "Driver"},`,
            ``,
            `Anda belum update progress pengiriman *${job.jobNumber}*`,
            `dalam ${Math.round(hoursStale)} jam terakhir.`,
            ``,
            waLink ? `Silakan klik link berikut untuk update:\n${waLink}` : null,
          ].filter(Boolean).join("\n");
          sendWhatsApp(phone, msg).catch(() => {});
        } catch {
          // non-fatal
        }
      }
    } catch (err) {
      logger.warn({ err, jobId: job.id }, "driverJobWorker: error processing job");
    }
  }
}

export function startDriverJobWorker(): void {
  registerHeartbeat("driver-job-worker", WORKER_INTERVAL_MS);
  const run = () => {
    beat("driver-job-worker");
    return runDriverJobWorker().catch((err: unknown) =>
      logger.warn({ err }, "driverJobWorker: uncaught error")
    );
  };

  setTimeout(() => {
    run();
    setInterval(run, WORKER_INTERVAL_MS).unref();
  }, INITIAL_DELAY_MS).unref();

  logger.info(
    { intervalMin: WORKER_INTERVAL_MS / 60_000, autoCancelHours: AUTO_CANCEL_HOURS, reminderHours: REMINDER_HOURS },
    "driverJobWorker started"
  );
}
