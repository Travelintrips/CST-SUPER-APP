import { logger } from "../../lib/logger.js";
import { runDailyPaymentSync } from "./supabaseSync.js";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const PREFIX = "[SportPaymentSync]";

// Jam 00:00 WIB = 17:00 UTC hari sebelumnya
const SYNC_HOUR_UTC = 17;
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // cek setiap 5 menit

let lastRunDate: string | null = null;
let isRunning = false;

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function currentHourUtc(): number {
  return new Date().getUTCHours();
}

export async function runSportCenterPaymentSync(): Promise<void> {
  if (isRunning) {
    logger.warn(`${PREFIX} Sync sedang berjalan, skip`);
    return;
  }
  isRunning = true;
  try {
    logger.info(`${PREFIX} Memulai sinkronisasi harian pembayaran Sport Center`);
    const result = await runDailyPaymentSync(1, "scheduler");
    logger.info(
      {
        bookingsPulled: result.bookings.pulled,
        paymentsPulled: result.payments.pulled,
        accountingSynced: result.accounting.synced,
        statusUpdated: result.statusUpdated,
        auditLogId: result.auditLogId,
        durationMs: Date.now() - new Date(result.startedAt).getTime(),
      },
      `${PREFIX} Sinkronisasi selesai`
    );
  } catch (err) {
    logger.error({ err }, `${PREFIX} Sinkronisasi gagal`);
  } finally {
    isRunning = false;
  }
}

async function reconcileLocalPaymentStatus(): Promise<void> {
  try {
    const result = await db.execute(sql`
      UPDATE sport_bookings sb
      SET payment_status = 'paid', updated_at = NOW()
      FROM (
        SELECT DISTINCT booking_id
        FROM sport_payments
        WHERE status = 'paid'
      ) sp
      WHERE sp.booking_id = sb.id
        AND sb.payment_status != 'paid'
    `);
    const count = result.rowCount ?? 0;
    if (count > 0) {
      logger.info({ count }, `${PREFIX} Reconcile lokal: ${count} booking diupdate payment_status → paid`);
    }
  } catch (err) {
    logger.warn({ err }, `${PREFIX} Reconcile lokal gagal (non-fatal)`);
  }
}

export function startSportCenterPaymentSyncWorker(): void {
  // Reconcile lokal saat startup (sinkronkan payment_status dari sport_payments)
  void reconcileLocalPaymentStatus();

  const check = () => {
    const today = todayUtc();
    const hour = currentHourUtc();

    if (hour === SYNC_HOUR_UTC && lastRunDate !== today) {
      lastRunDate = today;
      logger.info({ date: today }, `${PREFIX} Memulai jadwal harian (00:00 WIB)`);
      runSportCenterPaymentSync().catch((err) =>
        logger.error({ err }, `${PREFIX} Scheduler error`)
      );
    }
  };

  check();
  setInterval(check, CHECK_INTERVAL_MS).unref();

  logger.info(
    { syncHourUtc: SYNC_HOUR_UTC, checkIntervalMin: CHECK_INTERVAL_MS / 60_000 },
    `${PREFIX} Worker dimulai (harian 00:00 WIB / ${SYNC_HOUR_UTC}:00 UTC)`
  );
}
