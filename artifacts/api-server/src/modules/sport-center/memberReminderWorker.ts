/**
 * memberReminderWorker.ts
 *
 * Worker harian yang mengirim reminder WhatsApp ke anggota sport center
 * yang masa keanggotaannya akan habis dalam N hari.
 *
 * Jadwal reminder (configurable, default: 4 hari & 1 hari sebelum end_date):
 *   - "4days"  → 4 hari sebelum end_date
 *   - "1day"   → 1 hari sebelum end_date
 *
 * Dedup: via tabel sport_member_reminder_logs
 *   (member_id + reminder_type + sent_date UNIQUE) — tidak kirim dua kali di hari yang sama.
 *
 * Transport: sendViaService (via Fonnte).
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { sendViaService } from "../../lib/waTransport.js";
import { logger } from "../../lib/logger.js";

const PREFIX = "[memberReminderWorker]";

export interface ReminderConfig {
  daysAhead: number;
  reminderType: string;
  label: string;
}

const DEFAULT_REMINDERS: ReminderConfig[] = [
  { daysAhead: 4, reminderType: "4days", label: "4 hari lagi" },
  { daysAhead: 1, reminderType: "1day",  label: "1 hari lagi" },
];

/**
 * Baca konfigurasi reminder_days dari sport_settings.
 * Fallback ke DEFAULT_REMINDERS jika belum dikonfigurasi atau gagal.
 */
export async function getReminderConfig(companyId?: number | null): Promise<ReminderConfig[]> {
  try {
    const r = await db.execute(sql`
      SELECT reminder_days FROM sport_settings
      WHERE (${companyId ?? null}::int IS NULL OR company_id = ${companyId ?? null})
      LIMIT 1
    `);
    const row = r.rows[0] as { reminder_days?: string } | undefined;
    if (!row?.reminder_days) return DEFAULT_REMINDERS;
    const days = row.reminder_days
      .split(",")
      .map((s) => parseInt(s.trim(), 10))
      .filter((d) => !isNaN(d) && d >= 1 && d <= 90)
      .sort((a, b) => b - a);
    if (days.length === 0) return DEFAULT_REMINDERS;
    return days.map((d) => ({
      daysAhead: d,
      reminderType: d === 1 ? "1day" : `${d}days`,
      label: d === 1 ? "1 hari lagi" : `${d} hari lagi`,
    }));
  } catch {
    return DEFAULT_REMINDERS;
  }
}

export interface ReminderResult {
  sent: number;
  skipped: number;
  errors: number;
  details: Array<{ memberId: number; name: string; phone: string; reminderType: string; status: "sent" | "skipped" | "error"; reason?: string }>;
}

async function ensureLogTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS sport_member_reminder_logs (
      id              SERIAL PRIMARY KEY,
      member_id       INT         NOT NULL,
      reminder_type   TEXT        NOT NULL,
      sent_date       DATE        NOT NULL DEFAULT CURRENT_DATE,
      phone           TEXT,
      status          TEXT        NOT NULL DEFAULT 'sent',
      error_message   TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (member_id, reminder_type, sent_date)
    )
  `);
}

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return new Intl.DateTimeFormat("id-ID", {
      day: "2-digit",
      month: "long",
      year: "numeric",
      timeZone: "Asia/Jakarta",
    }).format(d);
  } catch {
    return dateStr;
  }
}

const DEFAULT_WA_TEMPLATE =
  "Halo *{{name}}*! 👋\n\n" +
  "Kami ingin menginformasikan bahwa masa keanggotaan Anda di *{{center_name}}* akan berakhir *{{days_label}}* ({{end_date}}).\n\n" +
  "Segera perpanjang keanggotaan Anda agar tetap dapat menikmati fasilitas kami tanpa gangguan.\n\n" +
  "Untuk informasi perpanjangan, silakan hubungi kami atau kunjungi langsung Sport Center.\n\n" +
  "Terima kasih atas kepercayaan Anda! 🏆";

/**
 * Baca wa_template dari sport_settings.
 * Fallback ke DEFAULT_WA_TEMPLATE jika belum diset.
 */
export async function getWaTemplate(companyId?: number | null): Promise<{ template: string; centerName: string }> {
  try {
    const r = await db.execute(sql`
      SELECT wa_template, center_name FROM sport_settings
      WHERE (${companyId ?? null}::int IS NULL OR company_id = ${companyId ?? null})
      LIMIT 1
    `);
    const row = r.rows[0] as { wa_template?: string; center_name?: string } | undefined;
    return {
      template: row?.wa_template?.trim() || DEFAULT_WA_TEMPLATE,
      centerName: row?.center_name || "Sport Center",
    };
  } catch {
    return { template: DEFAULT_WA_TEMPLATE, centerName: "Sport Center" };
  }
}

function buildMessage(
  name: string,
  endDate: string,
  label: string,
  template: string,
  centerName: string,
): string {
  const formatted = formatDate(endDate);
  return template
    .replace(/\{\{name\}\}/g, name)
    .replace(/\{\{end_date\}\}/g, formatted)
    .replace(/\{\{days_label\}\}/g, label)
    .replace(/\{\{center_name\}\}/g, centerName);
}

async function processReminder(
  config: ReminderConfig,
  waTemplate: string,
  centerName: string,
): Promise<{ sent: number; skipped: number; errors: number; details: ReminderResult["details"] }> {
  const { daysAhead, reminderType, label } = config;
  const details: ReminderResult["details"] = [];
  let sent = 0;
  let skipped = 0;
  let errors = 0;

  const membersRes = await db.execute(sql`
    SELECT id, name, phone, end_date, company_id
    FROM sport_members
    WHERE status = 'active'
      AND end_date IS NOT NULL
      AND end_date = (CURRENT_DATE + ${daysAhead} * INTERVAL '1 day')::date
  `);

  const members = membersRes.rows as Array<{
    id: number;
    name: string;
    phone: string | null;
    end_date: string;
    company_id: number | null;
  }>;

  if (members.length === 0) {
    logger.debug(
      { reminderType, daysAhead },
      `${PREFIX} tidak ada member yang jatuh tempo ${daysAhead} hari lagi`,
    );
    return { sent, skipped, errors, details };
  }

  for (const member of members) {
    const phone = member.phone?.trim() ?? "";
    if (!phone) {
      details.push({ memberId: member.id, name: member.name, phone: "", reminderType, status: "skipped", reason: "phone kosong" });
      skipped++;
      continue;
    }

    // Dedup check: sudah kirim hari ini untuk tipe ini?
    const existing = await db.execute(sql`
      SELECT id FROM sport_member_reminder_logs
      WHERE member_id = ${member.id}
        AND reminder_type = ${reminderType}
        AND sent_date = CURRENT_DATE
      LIMIT 1
    `);
    if (existing.rows.length > 0) {
      details.push({ memberId: member.id, name: member.name, phone, reminderType, status: "skipped", reason: "sudah dikirim hari ini" });
      skipped++;
      continue;
    }

    const message = buildMessage(member.name, member.end_date, label, waTemplate, centerName);

    try {
      await sendViaService(phone, message, {
        context: "sport_member_reminder",
        refType: "sport_member",
        refId: `member_${member.id}_${reminderType}_${new Date().toISOString().slice(0, 10)}`,
      });

      await db.execute(sql`
        INSERT INTO sport_member_reminder_logs (member_id, reminder_type, sent_date, phone, status)
        VALUES (${member.id}, ${reminderType}, CURRENT_DATE, ${phone}, 'sent')
        ON CONFLICT (member_id, reminder_type, sent_date) DO NOTHING
      `);

      logger.info({ memberId: member.id, name: member.name, phone, reminderType, daysAhead }, `${PREFIX} reminder terkirim`);
      details.push({ memberId: member.id, name: member.name, phone, reminderType, status: "sent" });
      sent++;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error({ err, memberId: member.id, reminderType }, `${PREFIX} gagal kirim reminder`);

      await db.execute(sql`
        INSERT INTO sport_member_reminder_logs (member_id, reminder_type, sent_date, phone, status, error_message)
        VALUES (${member.id}, ${reminderType}, CURRENT_DATE, ${phone}, 'error', ${errMsg})
        ON CONFLICT (member_id, reminder_type, sent_date) DO UPDATE SET status = 'error', error_message = EXCLUDED.error_message
      `).catch(() => {});

      details.push({ memberId: member.id, name: member.name, phone, reminderType, status: "error", reason: errMsg });
      errors++;
    }
  }

  return { sent, skipped, errors, details };
}

/**
 * Jalankan semua reminder config sekarang. Dipanggil oleh worker interval
 * dan oleh endpoint manual trigger di routes.ts.
 *
 * Jika `reminders` tidak diberikan, baca konfigurasi dari sport_settings.
 */
export async function runMemberReminders(
  reminders?: ReminderConfig[],
): Promise<ReminderResult> {
  await ensureLogTable();
  if (!reminders) {
    reminders = await getReminderConfig();
  }

  let totalSent = 0;
  let totalSkipped = 0;
  let totalErrors = 0;
  const allDetails: ReminderResult["details"] = [];

  const { template: waTemplate, centerName } = await getWaTemplate();

  for (const config of reminders) {
    const r = await processReminder(config, waTemplate, centerName);
    totalSent    += r.sent;
    totalSkipped += r.skipped;
    totalErrors  += r.errors;
    allDetails.push(...r.details);
  }

  logger.info(
    { sent: totalSent, skipped: totalSkipped, errors: totalErrors },
    `${PREFIX} run selesai`,
  );

  return { sent: totalSent, skipped: totalSkipped, errors: totalErrors, details: allDetails };
}

/**
 * Ambil log reminder terbaru.
 */
export async function getMemberReminderLogs(limit = 50): Promise<unknown[]> {
  await ensureLogTable();
  try {
    const res = await db.execute(sql`
      SELECT
        l.id,
        l.member_id,
        m.name     AS member_name,
        l.phone,
        l.reminder_type,
        l.sent_date,
        l.status,
        l.error_message,
        l.created_at
      FROM sport_member_reminder_logs l
      LEFT JOIN sport_members m ON m.id = l.member_id
      ORDER BY l.created_at DESC
      LIMIT ${limit}
    `);
    return res.rows;
  } catch {
    return [];
  }
}

/**
 * Start background worker — cek setiap 1 jam, initial delay 5 menit.
 */
export function startMemberReminderWorker(
  intervalMs  = 60 * 60 * 1000,
  initialDelayMin = 5,
): void {
  const initialDelay = initialDelayMin * 60 * 1000;

  setTimeout(() => {
    runMemberReminders().catch((err: unknown) => {
      logger.error({ err }, `${PREFIX} tick error`);
    });
    setInterval(() => {
      runMemberReminders().catch((err: unknown) => {
        logger.error({ err }, `${PREFIX} tick error`);
      });
    }, intervalMs).unref();
  }, initialDelay).unref();

  logger.info(
    { intervalMin: Math.round(intervalMs / 60_000), initialDelayMin },
    `${PREFIX} started`,
  );
}
