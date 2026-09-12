/**
 * whtReminderWorker.ts
 *
 * Runs every hour. Pada tanggal 7 (H-3) dan 9 (H-1) bulan berjalan,
 * kirim reminder WA ke admin group tentang total WHT yang harus disetor ke DJP
 * (batas setor PPh 23: tanggal 10 bulan berikutnya dari periode potong).
 *
 * Idempotent: sentinel disimpan di app_settings dengan key
 *   wht_reminder_sent_YYYY-MM-DD agar tidak duplikat jika worker restart.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";
import { sendViaService as sendWhatsApp } from "./waTransport.js";
import { getAdminGroupWa } from "./adminWa.js";

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // cek setiap jam
const INITIAL_DELAY_MS  = 2 * 60 * 1000;  // mulai 2 menit setelah boot

// Hari dalam sebulan yang memicu reminder (H-3 dan H-1 sebelum tanggal 10)
const REMINDER_DAYS = [7, 9];

function fmtRp(n: number): string {
  return "Rp " + Math.round(n).toLocaleString("id-ID");
}

function prevMonthPeriod(now: Date): { period: string; label: string; start: Date; end: Date } {
  const year  = now.getMonth() === 0 ? now.getFullYear() - 1 : now.getFullYear();
  const month = now.getMonth() === 0 ? 12 : now.getMonth();
  const pad   = (n: number) => String(n).padStart(2, "0");
  const MONTHS = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agt","Sep","Okt","Nov","Des"];
  return {
    period: `${year}-${pad(month)}`,
    label:  `${MONTHS[month - 1]} ${year}`,
    start:  new Date(year, month - 1, 1),
    end:    new Date(year, month, 1),
  };
}

async function isSentToday(dateKey: string): Promise<boolean> {
  try {
    const rows = await db.execute(sql`
      SELECT value FROM app_settings
      WHERE key = ${"wht_reminder_sent_" + dateKey}
      LIMIT 1
    `);
    return (rows as unknown as Array<{ value: string }>).length > 0;
  } catch {
    return false;
  }
}

async function markSentToday(dateKey: string): Promise<void> {
  try {
    await db.execute(sql`
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (${"wht_reminder_sent_" + dateKey}, 'sent', NOW())
      ON CONFLICT (key) DO UPDATE SET value = 'sent', updated_at = NOW()
    `);
  } catch (err) {
    logger.warn({ err }, "whtReminderWorker: failed to mark sentinel");
  }
}

async function queryWhtTotal(start: Date, end: Date): Promise<{
  total: number;
  bySupplier: Array<{ name: string; wht: number }>;
  paymentCount: number;
}> {
  const rows = await db.execute(sql`
    SELECT
      COALESCE(s.name, 'Vendor tidak dikenal') AS supplier_name,
      SUM(vp.wht_amount)::numeric              AS total_wht,
      COUNT(*)::int                            AS cnt
    FROM vendor_payments vp
    LEFT JOIN suppliers s ON s.id = vp.supplier_id
    WHERE vp.wht_amount > 0
      AND vp.created_at >= ${start.toISOString()}
      AND vp.created_at <  ${end.toISOString()}
    GROUP BY s.name
    ORDER BY SUM(vp.wht_amount) DESC
    LIMIT 10
  `);

  const typed = rows as unknown as Array<{
    supplier_name: string;
    total_wht: string;
    cnt: number;
  }>;

  const bySupplier = typed.map((r) => ({
    name: r.supplier_name,
    wht:  Number(r.total_wht),
  }));

  const total        = bySupplier.reduce((s, r) => s + r.wht, 0);
  const paymentCount = typed.reduce((s, r) => s + r.cnt, 0);

  return { total, bySupplier, paymentCount };
}

function buildWaMessage(
  period: string,
  dueDay: number,
  total: number,
  paymentCount: number,
  bySupplier: Array<{ name: string; wht: number }>,
  now: Date,
): string {
  const daysLeft  = dueDay - now.getDate();
  const MONTHS    = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agt","Sep","Okt","Nov","Des"];
  const dueMonth  = MONTHS[now.getMonth()];
  const dueYear   = now.getFullYear();
  const urgency   = daysLeft <= 1 ? "🔴" : "🟡";

  const lines: string[] = [
    `${urgency} *Reminder Setoran WHT Payable*`,
    ``,
    `Periode pemotongan: *${period}*`,
    `Batas setor ke DJP: *${dueDay} ${dueMonth} ${dueYear}*`,
    `Sisa waktu: *${daysLeft} hari*`,
    ``,
    `*Total WHT yang harus disetor:*`,
    `💰 ${fmtRp(total)}`,
    `(dari ${paymentCount} transaksi pembayaran vendor)`,
    ``,
  ];

  if (bySupplier.length > 0) {
    lines.push(`*Rincian per vendor:*`);
    bySupplier.slice(0, 5).forEach((r) => {
      lines.push(`  • ${r.name}: ${fmtRp(r.wht)}`);
    });
    if (bySupplier.length > 5) lines.push(`  ... dan ${bySupplier.length - 5} vendor lainnya`);
    lines.push(``);
  }

  lines.push(
    `📋 Detail lengkap: BizPortal → Accounting → Rekonsiliasi WHT Payable`,
    ``,
    `_Jenis pajak: PPh 23 / PPh 4(2) · Lapor SPT Masa paling lambat tgl 20_`,
  );

  return lines.join("\n");
}

export async function runWhtReminder(): Promise<void> {
  const now = new Date();
  const day = now.getDate();

  if (!REMINDER_DAYS.includes(day)) return;

  const pad     = (n: number) => String(n).padStart(2, "0");
  const dateKey = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(day)}`;

  const alreadySent = await isSentToday(dateKey);
  if (alreadySent) return;

  const { period, label, start, end } = prevMonthPeriod(now);
  const { total, bySupplier, paymentCount } = await queryWhtTotal(start, end);

  if (total <= 0) {
    logger.info({ period }, "whtReminderWorker: no WHT to remind for period");
    await markSentToday(dateKey); // tandai agar tidak cek ulang hari ini
    return;
  }

  const adminWa = await getAdminGroupWa().catch(() => null);
  if (!adminWa) {
    logger.warn("whtReminderWorker: no admin WA group configured — skipping");
    return;
  }

  const dueDay = 10; // tanggal 10 bulan berjalan
  const msg = buildWaMessage(label, dueDay, total, paymentCount, bySupplier, now);

  await sendWhatsApp(adminWa, msg, {
    context: "wht_reminder",
    refType: "wht_payable",
    refId:   period,
  });

  await markSentToday(dateKey);

  logger.info(
    { period, total, paymentCount, day, daysLeft: dueDay - day },
    "whtReminderWorker: WHT reminder sent",
  );
}

export function startWhtReminderWorker(): void {
  setTimeout(() => {
    runWhtReminder().catch((err) =>
      logger.warn({ err }, "whtReminderWorker: initial run error (non-fatal)"),
    );
    setInterval(() => {
      runWhtReminder().catch((err) =>
        logger.warn({ err }, "whtReminderWorker: interval run error (non-fatal)"),
      );
    }, CHECK_INTERVAL_MS).unref();
  }, INITIAL_DELAY_MS);

  logger.info(
    { checkIntervalHours: CHECK_INTERVAL_MS / 3600000, reminderDays: REMINDER_DAYS },
    "whtReminderWorker started",
  );
}
