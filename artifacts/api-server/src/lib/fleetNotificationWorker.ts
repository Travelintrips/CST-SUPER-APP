/**
 * Fleet Notification Worker
 * - Kirim WA via Fonnte jika outstanding tinggi
 * - Kirim WA jika driver tidak aktif > N hari
 * - Kirim WA jika pendapatan turun > 15%
 * - Auto-blast harian ke semua driver outstanding ≥500rb sesuai jam yg dikonfigurasi
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { sendViaService, sendToAdminGroup } from "./waTransport.js";
import { logger } from "./logger.js";

const OUTSTANDING_THRESHOLD = 500_000;
const INACTIVE_DAYS = 7;
const REVENUE_DROP_PCT = 15;
const INTERVAL_MS = 60 * 60 * 1000; // cek alert setiap 1 jam
const CRON_CHECK_MS = 60 * 1000;    // cek jadwal auto-blast setiap 1 menit

let workerInterval: ReturnType<typeof setInterval> | null = null;
let cronInterval: ReturnType<typeof setInterval> | null = null;

export function startFleetNotificationWorker() {
  if (workerInterval) return;
  // Delay awal 5 menit untuk alert worker
  setTimeout(() => {
    runFleetChecks().catch((err) => logger.error({ err }, "[fleetNotif] initial run error"));
    workerInterval = setInterval(() => {
      runFleetChecks().catch((err) => logger.error({ err }, "[fleetNotif] interval run error"));
    }, INTERVAL_MS);
  }, 5 * 60 * 1000);

  // Cron auto-blast: mulai setelah 2 menit, cek setiap menit
  setTimeout(() => {
    checkAutoBlastCron().catch(() => {});
    cronInterval = setInterval(() => {
      checkAutoBlastCron().catch(() => {});
    }, CRON_CHECK_MS);
  }, 2 * 60 * 1000);

  logger.info("[fleetNotificationWorker] started (alert 1h, auto-blast cron 1min check)");
}

async function runFleetChecks() {
  try {
    const companiesRes = await db.execute(sql.raw(`
      SELECT DISTINCT company_id FROM fleet_partners WHERE is_active = TRUE AND company_id IS NOT NULL
    `));
    const companyIds = companiesRes.rows.map((r: any) => r.company_id as number);
    for (const companyId of companyIds) {
      await Promise.allSettled([
        checkOutstanding(companyId),
        checkInactiveDrivers(companyId),
        checkRevenueDrop(companyId),
      ]);
    }
  } catch (err) {
    logger.error({ err }, "[fleetNotif] runFleetChecks error");
  }
}

// ─── Auto-blast cron ──────────────────────────────────────────────────────────

async function checkAutoBlastCron() {
  try {
    // Ambil semua company yang punya accounting_settings dengan auto-blast enabled
    const settingsRows = await db.execute(sql.raw(`
      SELECT company_id, fleet_auto_blast_hour, fleet_auto_blast_last_run
      FROM accounting_settings
      WHERE fleet_auto_blast_enabled = TRUE
        AND company_id IS NOT NULL
    `));

    if (settingsRows.rows.length === 0) return;

    // Jam WIB = UTC+7
    const nowUtc = new Date();
    const wibHour = (nowUtc.getUTCHours() + 7) % 24;
    const todayWib = new Date(nowUtc.getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);

    for (const row of settingsRows.rows as any[]) {
      const companyId = Number(row.company_id);
      const blastHour = Number(row.fleet_auto_blast_hour ?? 8);
      const lastRun = row.fleet_auto_blast_last_run
        ? String(row.fleet_auto_blast_last_run).slice(0, 10)
        : null;

      // Sudah berjalan hari ini?
      if (lastRun === todayWib) continue;
      // Belum waktunya?
      if (wibHour !== blastHour) continue;

      logger.info({ companyId, blastHour, todayWib }, "[fleetAutoBlast] Memulai auto-blast harian");
      await runAutoBlast(companyId, todayWib);
    }
  } catch (err) {
    logger.warn({ err }, "[fleetAutoBlast] checkAutoBlastCron error (non-fatal)");
  }
}

async function runAutoBlast(companyId: number, todayWib: string) {
  try {
    const rows = await db.execute(sql.raw(`
      SELECT o.id, o.driver_name, o.outstanding_amount,
             COALESCE(o.driver_phone, d.phone) AS driver_phone,
             COALESCE(o.vehicle_plate, d.vehicle_plate) AS vehicle_plate
      FROM fleet_outstanding o
      LEFT JOIN fleet_drivers d ON d.id = o.driver_id AND d.company_id = ${companyId}
      WHERE o.company_id = ${companyId}
        AND o.status = 'open'
        AND o.outstanding_amount >= ${OUTSTANDING_THRESHOLD}
        AND COALESCE(o.driver_phone, d.phone) IS NOT NULL
        AND COALESCE(o.driver_phone, d.phone) != ''
      ORDER BY o.outstanding_amount DESC
    `));

    const drivers = rows.rows as any[];
    let sent = 0;
    let failed = 0;

    const fmtIdr = (v: unknown) =>
      new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 })
        .format(parseFloat(String(v ?? 0)) || 0);

    for (const driver of drivers) {
      const phone = String(driver.driver_phone ?? "").trim();
      if (!phone) { failed++; continue; }
      const name = String(driver.driver_name ?? "Driver");
      const plate = String(driver.vehicle_plate ?? "-");
      const amount = fmtIdr(driver.outstanding_amount);

      const message =
        `*Pemberitahuan Pembayaran Rental Fee*\n\n` +
        `Nama Driver: ${name}\n` +
        `Nomor Kendaraan: ${plate}\n` +
        `Nomor Telepon: ${phone}\n` +
        `Total Outstanding: ${amount}\n\n` +
        `*Instruksi Pembayaran*\n\n` +
        `Kami mohon agar pembayaran rental fee segera dilakukan melalui salah satu cara berikut:\n\n` +
        `Top-up Saldo GoPay\n` +
        `Silakan isi saldo GoPay sesuai nominal outstanding di atas.\n` +
        `Transfer Bank ke Rekening Perusahaan\n` +
        `Lakukan transfer ke rekening resmi perusahaan. Pastikan mencantumkan nama driver dan nomor kendaraan pada kolom keterangan.\n\n` +
        `*Catatan Penting:*\n\n` +
        `Pembayaran tepat waktu sangat membantu kelancaran operasional.\n` +
        `Simpan bukti pembayaran untuk verifikasi lebih lanjut.`;

      const esc = (s: string) => s.replace(/'/g, "''").slice(0, 2000);
      let waStatus = "sent";
      await sendViaService(phone, message, { context: "fleet_auto_blast_daily", refId: String(driver.id) })
        .catch(() => { waStatus = "failed"; });

      await db.execute(sql.raw(`
        UPDATE fleet_outstanding SET last_wa_sent_at = NOW(), is_notified = TRUE, updated_at = NOW()
        WHERE id = ${driver.id} AND company_id = ${companyId}
      `)).catch(() => {});

      await db.execute(sql.raw(`
        INSERT INTO fleet_wa_logs
          (company_id, outstanding_id, driver_name, driver_phone, vehicle_plate, outstanding_amount, message, sent_by, send_type, status)
        VALUES
          (${companyId}, ${driver.id}, '${esc(name)}', '${esc(phone)}', '${esc(plate)}',
           ${numVal(driver.outstanding_amount)}, '${esc(message)}', 'system', 'auto_daily', '${waStatus}')
      `)).catch(() => {});

      if (waStatus === "sent") sent++; else failed++;
    }

    // Update last_run
    await db.execute(sql.raw(`
      UPDATE accounting_settings SET fleet_auto_blast_last_run = '${todayWib}', updated_at = NOW()
      WHERE company_id = ${companyId}
    `)).catch(() => {});

    // Kirim summary ke admin group
    const groupId = await getAdminGroupId();
    if (groupId && drivers.length > 0) {
      const summary =
        `📣 *Auto-Blast WA Outstanding Fleet*\n\n` +
        `Hari ini (${todayWib}) WA pengingat dikirim ke *${sent} driver* outstanding ≥Rp 500rb.\n` +
        (failed > 0 ? `⚠ ${failed} driver gagal terkirim.\n` : "") +
        `\nTotal driver eligible: ${drivers.length}`;
      await sendToAdminGroup(groupId, summary, { context: "fleet_auto_blast_summary" }).catch(() => {});
    }

    logger.info({ companyId, sent, failed, total: drivers.length }, "[fleetAutoBlast] Auto-blast selesai");
  } catch (err) {
    logger.error({ err, companyId }, "[fleetAutoBlast] runAutoBlast error");
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

async function getAdminPhones(companyId: number): Promise<string[]> {
  try {
    const rows = await db.execute(sql.raw(`
      SELECT phone FROM users
      WHERE company_id = ${companyId} AND role IN ('admin', 'owner') AND phone IS NOT NULL AND phone != ''
      LIMIT 5
    `));
    return rows.rows.map((r: any) => String(r.phone)).filter(Boolean);
  } catch {
    const fallback = process.env.ADMIN_WA_PHONES ?? process.env.FONNTE_ADMIN_WA ?? "";
    return fallback.split(",").map((p) => p.trim()).filter(Boolean);
  }
}

async function getAdminGroupId(): Promise<string | null> {
  return process.env.FONNTE_ADMIN_WA ?? null;
}

function esc(v: unknown): string {
  return String(v ?? "").replace(/'/g, "''").slice(0, 2000);
}

async function createAlert(
  companyId: number,
  alertType: string,
  severity: string,
  title: string,
  message: string,
  driverId?: number | null,
  refId?: string,
) {
  try {
    const safeRefId   = esc(refId ?? "");
    const safeType    = esc(alertType);
    const safeSev     = esc(severity);
    const safeTitle   = esc(title);
    const safeMessage = esc(message);

    const dup = await db.execute(sql.raw(`
      SELECT id FROM fleet_alerts
      WHERE company_id = ${companyId} AND alert_type = '${safeType}'
        AND reference_id = '${safeRefId}'
        AND created_at >= NOW() - INTERVAL '24 hours'
      LIMIT 1
    `));
    if (dup.rows.length > 0) return;

    const driverIdSql = driverId != null ? String(Number(driverId)) : "NULL";
    const refIdSql    = safeRefId ? `'${safeRefId}'` : "NULL";

    await db.execute(sql.raw(`
      INSERT INTO fleet_alerts (company_id, alert_type, severity, title, message, driver_id, reference_id)
      VALUES (${companyId}, '${safeType}', '${safeSev}', '${safeTitle}', '${safeMessage}', ${driverIdSql}, ${refIdSql})
    `));
  } catch (err) {
    logger.warn({ err }, "[fleetNotif] createAlert error (non-fatal)");
  }
}

// ── Check 1: Outstanding Tinggi ───────────────────────────────────────────────
async function checkOutstanding(companyId: number) {
  const rows = await db.execute(sql.raw(`
    SELECT o.id, o.driver_id, o.driver_name, o.outstanding_amount, o.last_wa_sent_at,
           COALESCE(o.driver_phone, d.phone) AS driver_phone,
           COALESCE(o.vehicle_plate, d.vehicle_plate) AS vehicle_plate
    FROM fleet_outstanding o
    LEFT JOIN fleet_drivers d ON d.id = o.driver_id AND d.company_id = ${companyId}
    WHERE o.company_id = ${companyId}
      AND o.status = 'open'
      AND o.outstanding_amount >= ${OUTSTANDING_THRESHOLD}
      AND COALESCE(o.driver_phone, d.phone) IS NOT NULL
      AND COALESCE(o.driver_phone, d.phone) != ''
      AND (
        (o.outstanding_amount >= 1000000 AND (o.last_wa_sent_at IS NULL OR o.last_wa_sent_at < NOW() - INTERVAL '8 hours'))
        OR
        (o.outstanding_amount >= ${OUTSTANDING_THRESHOLD} AND o.outstanding_amount < 1000000
          AND (o.last_wa_sent_at IS NULL OR o.last_wa_sent_at < NOW() - INTERVAL '24 hours'))
      )
    ORDER BY o.outstanding_amount DESC
    LIMIT 20
  `));

  if (rows.rows.length === 0) return;

  const phones = await getAdminPhones(companyId);
  const groupId = await getAdminGroupId();

  let summary = `🚨 *Fleet Alert: Outstanding Tinggi*\n\n`;
  summary += `Terdapat *${rows.rows.length} driver* dengan outstanding ≥ Rp ${(OUTSTANDING_THRESHOLD / 1000).toFixed(0)}rb:\n\n`;

  for (const row of rows.rows as any[]) {
    const name   = String(row.driver_name ?? "Unknown");
    const phone  = String(row.driver_phone ?? "").trim();
    const plate  = String(row.vehicle_plate ?? "-");
    const isHigh = numVal(row.outstanding_amount) >= 1_000_000;
    const amount = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(numVal(row.outstanding_amount));
    summary += `• ${name}: *${amount}*\n`;

    await createAlert(
      companyId, "outstanding_high", "warning",
      `Outstanding Driver ${name}`,
      `Driver ${name} memiliki outstanding ${amount} yang belum diselesaikan.`,
      row.driver_id,
      `outstanding_${row.id}`,
    );

    if (phone) {
      const driverMsg =
        `*Pemberitahuan Pembayaran Rental Fee*\n\n` +
        `Nama Driver: ${name}\nNomor Kendaraan: ${plate}\nNomor Telepon: ${phone}\nTotal Outstanding: ${amount}\n\n` +
        `*Instruksi Pembayaran*\n\n` +
        `Kami mohon agar pembayaran rental fee segera dilakukan melalui salah satu cara berikut:\n\n` +
        `Top-up Saldo GoPay\nSilakan isi saldo GoPay sesuai nominal outstanding di atas.\n` +
        `Transfer Bank ke Rekening Perusahaan\nLakukan transfer ke rekening resmi perusahaan. ` +
        `Pastikan mencantumkan nama driver dan nomor kendaraan pada kolom keterangan untuk proses rekonsiliasi.\n\n` +
        `*Catatan Penting:*\n\nPembayaran tepat waktu sangat membantu kelancaran operasional.\n` +
        `Simpan bukti pembayaran untuk verifikasi lebih lanjut.`;

      const sendType = isHigh ? "auto_3x" : "auto_daily";
      let waStatus = "sent";
      await sendViaService(phone, driverMsg, { context: "fleet_outstanding_driver", refId: String(row.id) })
        .catch(() => { waStatus = "failed"; });

      await db.execute(sql.raw(`
        UPDATE fleet_outstanding SET last_wa_sent_at = NOW(), is_notified = TRUE, updated_at = NOW()
        WHERE id = ${row.id} AND company_id = ${companyId}
      `)).catch(() => {});

      const escName  = esc(name);
      const escPhone = esc(phone);
      const escPlate = esc(plate);
      await db.execute(sql.raw(`
        INSERT INTO fleet_wa_logs
          (company_id, outstanding_id, driver_name, driver_phone, vehicle_plate, outstanding_amount, sent_by, send_type, status)
        VALUES
          (${companyId}, ${row.id}, '${escName}', '${escPhone}', '${escPlate}',
           ${numVal(row.outstanding_amount)}, 'system', '${sendType}', '${waStatus}')
      `)).catch(() => {});
    }
  }

  if (groupId) {
    await sendToAdminGroup(groupId, summary, { context: "fleet_outstanding_summary" }).catch(() => {});
  }
  for (const phone of phones) {
    await sendViaService(phone, summary, { context: "fleet_outstanding_admin" }).catch(() => {});
  }

  const notifiedToSql = phones.length > 0 ? `'${phones.map(p => p.replace(/'/g, "''")).join(",")}'` : "NULL";
  await db.execute(sql.raw(`
    UPDATE fleet_alerts SET is_notified = TRUE, notified_at = NOW(), notified_to = ${notifiedToSql}
    WHERE company_id = ${companyId} AND alert_type = 'outstanding_high' AND is_notified = FALSE
  `)).catch(() => {});
}

// ── Check 2: Driver Tidak Aktif ───────────────────────────────────────────────
async function checkInactiveDrivers(companyId: number) {
  const rows = await db.execute(sql.raw(`
    SELECT d.*
    FROM fleet_drivers d
    WHERE d.company_id = ${companyId}
      AND d.status = 'active'
      AND (d.last_active_date IS NULL OR d.last_active_date < CURRENT_DATE - INTERVAL '${INACTIVE_DAYS} days')
    ORDER BY d.last_active_date ASC NULLS FIRST
    LIMIT 20
  `));

  if (rows.rows.length === 0) return;

  const phones = await getAdminPhones(companyId);
  const groupId = await getAdminGroupId();

  let msg = `⚠️ *Fleet Alert: Driver Tidak Aktif*\n\n`;
  msg += `${rows.rows.length} driver tidak ada aktivitas selama ≥${INACTIVE_DAYS} hari:\n\n`;

  for (const d of rows.rows as any[]) {
    const lastActive = d.last_active_date ?? "belum pernah aktif";
    msg += `• ${d.name} (${d.vehicle_plate ?? "-"}): terakhir ${lastActive}\n`;
    await createAlert(
      companyId, "driver_inactive", "info",
      `Driver Tidak Aktif: ${d.name}`,
      `Driver ${d.name} tidak ada aktivitas sejak ${lastActive}.`,
      d.id,
      `inactive_${d.id}_${lastActive}`,
    );
  }

  if (groupId) await sendToAdminGroup(groupId, msg, { context: "fleet_inactive_drivers" }).catch(() => {});
  for (const phone of phones) await sendViaService(phone, msg, { context: "fleet_inactive_admin" }).catch(() => {});
}

// ── Check 3: Revenue Turun > 15% ─────────────────────────────────────────────
async function checkRevenueDrop(companyId: number) {
  const res = await db.execute(sql.raw(`
    SELECT
      COALESCE(SUM(CASE WHEN summary_date >= CURRENT_DATE - INTERVAL '7 days' THEN net_revenue ELSE 0 END), 0) as cur_week,
      COALESCE(SUM(CASE WHEN summary_date >= CURRENT_DATE - INTERVAL '14 days' AND summary_date < CURRENT_DATE - INTERVAL '7 days' THEN net_revenue ELSE 0 END), 0) as prev_week
    FROM fleet_daily_summary
    WHERE company_id = ${companyId}
      AND summary_date >= CURRENT_DATE - INTERVAL '14 days'
  `));

  const row = res.rows[0] as any;
  const curWeek = numVal(row?.cur_week);
  const prevWeek = numVal(row?.prev_week);
  if (prevWeek === 0 || curWeek === 0) return;

  const drop = ((prevWeek - curWeek) / prevWeek) * 100;
  if (drop < REVENUE_DROP_PCT) return;

  const curFmt = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(curWeek);
  const prevFmt = new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(prevWeek);
  const msg = `📉 *Fleet Alert: Revenue Turun ${drop.toFixed(1)}%*\n\nPendapatan fleet 7 hari terakhir:\n• Minggu lalu: *${prevFmt}*\n• Minggu ini: *${curFmt}*\n\nPenurunan ${drop.toFixed(1)}% melebihi threshold ${REVENUE_DROP_PCT}%. Segera cek kondisi armada.`;

  const phones = await getAdminPhones(companyId);
  const groupId = await getAdminGroupId();

  await createAlert(
    companyId, "revenue_drop", "critical",
    `Revenue Fleet Turun ${drop.toFixed(1)}%`,
    msg,
    null,
    `rev_drop_${new Date().toISOString().slice(0, 10)}`,
  );

  if (groupId) await sendToAdminGroup(groupId, msg, { context: "fleet_revenue_drop" }).catch(() => {});
  for (const phone of phones) await sendViaService(phone, msg, { context: "fleet_revenue_admin" }).catch(() => {});
}

function numVal(v: unknown): number {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(String(v).replace(/[^\d.-]/g, ""));
  return isNaN(n) ? 0 : n;
}
