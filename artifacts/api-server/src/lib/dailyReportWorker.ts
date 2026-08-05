/**
 * WhatsApp Report Worker
 * - Laporan HARIAN  : setiap 22:00 WIB (15:00 UTC)
 * - Laporan BULANAN : tanggal 1 setiap bulan, 22:00 WIB (rekap bulan lalu)
 * Menggunakan FONNTE_TOKEN_REPORT jika ada, fallback ke FONNTE_TOKEN.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";

const PREFIX = "[DailyReportWA]";

// 22:00 WIB = 15:00 UTC
const REPORT_HOUR_UTC = 15;
const CHECK_INTERVAL_MS = 5 * 60 * 1000;

let lastSentDate: string | null = null;
let lastSentMonth: string | null = null;
let isRunning = false;
let isMonthlyRunning = false;

function todayWib(): string {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return wib.toISOString().slice(0, 10);
}

function currentHourUtc(): number {
  return new Date().getUTCHours();
}

function formatRupiah(amount: number): string {
  if (amount < 0) return `-Rp ${Math.abs(amount).toLocaleString("id-ID")}`;
  return `Rp ${amount.toLocaleString("id-ID")}`;
}

function formatDate(isoDate: string): string {
  const d = new Date(isoDate + "T00:00:00+07:00");
  return d.toLocaleDateString("id-ID", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

// ── DB setup ──────────────────────────────────────────────────────────────────

// Nomor penerima tetap laporan harian WA
const FIXED_REPORT_RECIPIENTS = ["628111167596", "6281388882647"];

export async function ensureReportSettingsTable(): Promise<void> {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS whatsapp_report_settings (
      id SERIAL PRIMARY KEY,
      enabled BOOLEAN NOT NULL DEFAULT false,
      send_hour_wib INTEGER NOT NULL DEFAULT 22,
      recipients JSONB NOT NULL DEFAULT '[]',
      last_sent_date TEXT,
      last_sent_month TEXT,
      last_status TEXT,
      last_monthly_status TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )
  `).catch(() => {});

  // Tambah kolom bulanan jika tabel sudah ada sebelumnya
  await db.execute(sql`ALTER TABLE whatsapp_report_settings ADD COLUMN IF NOT EXISTS last_sent_month TEXT`).catch(() => {});
  await db.execute(sql`ALTER TABLE whatsapp_report_settings ADD COLUMN IF NOT EXISTS last_monthly_status TEXT`).catch(() => {});

  // Upsert row id=1 dengan recipients + enabled=true
  await db.execute(sql`
    INSERT INTO whatsapp_report_settings (id, enabled, send_hour_wib, recipients)
    VALUES (1, true, 22, ${JSON.stringify(FIXED_REPORT_RECIPIENTS)}::jsonb)
    ON CONFLICT (id) DO UPDATE
      SET recipients    = ${JSON.stringify(FIXED_REPORT_RECIPIENTS)}::jsonb,
          enabled       = true,
          updated_at    = NOW()
  `).catch(() => {});
}

// ── Settings helpers ───────────────────────────────────────────────────────────

export interface ReportSettings {
  id: number;
  enabled: boolean;
  sendHourWib: number;
  recipients: string[];
  lastSentDate: string | null;
  lastSentMonth: string | null;
  lastStatus: string | null;
  lastMonthlyStatus: string | null;
}

export async function getReportSettings(): Promise<ReportSettings> {
  try {
    const rows = await db.execute(sql`
      SELECT id, enabled, send_hour_wib, recipients,
             last_sent_date, last_sent_month, last_status, last_monthly_status
      FROM whatsapp_report_settings
      WHERE id = 1
    `);
    const row = rows.rows[0] as Record<string, unknown> | undefined;
    if (!row) {
      return { id: 1, enabled: true, sendHourWib: 22, recipients: FIXED_REPORT_RECIPIENTS, lastSentDate: null, lastSentMonth: null, lastStatus: null, lastMonthlyStatus: null };
    }
    const recip = row.recipients;
    const recipients: string[] = Array.isArray(recip)
      ? recip.map(String)
      : typeof recip === "string"
        ? JSON.parse(recip)
        : FIXED_REPORT_RECIPIENTS;
    return {
      id: 1,
      enabled: Boolean(row.enabled),
      sendHourWib: Number(row.send_hour_wib ?? 22),
      recipients,
      lastSentDate: (row.last_sent_date as string | null) ?? null,
      lastSentMonth: (row.last_sent_month as string | null) ?? null,
      lastStatus: (row.last_status as string | null) ?? null,
      lastMonthlyStatus: (row.last_monthly_status as string | null) ?? null,
    };
  } catch {
    return { id: 1, enabled: true, sendHourWib: 22, recipients: FIXED_REPORT_RECIPIENTS, lastSentDate: null, lastSentMonth: null, lastStatus: null, lastMonthlyStatus: null };
  }
}

export async function updateReportSettings(patch: Partial<Omit<ReportSettings, "id" | "lastSentDate" | "lastStatus">>): Promise<void> {
  if (patch.enabled !== undefined) {
    await db.execute(sql`UPDATE whatsapp_report_settings SET enabled = ${patch.enabled}, updated_at = NOW() WHERE id = 1`);
  }
  if (patch.sendHourWib !== undefined) {
    await db.execute(sql`UPDATE whatsapp_report_settings SET send_hour_wib = ${patch.sendHourWib}, updated_at = NOW() WHERE id = 1`);
  }
  if (patch.recipients !== undefined) {
    await db.execute(sql`UPDATE whatsapp_report_settings SET recipients = ${JSON.stringify(patch.recipients)}::jsonb, updated_at = NOW() WHERE id = 1`);
  }
}

async function markSent(date: string, status: string): Promise<void> {
  await db.execute(sql`
    UPDATE whatsapp_report_settings
    SET last_sent_date = ${date}, last_status = ${status}, updated_at = NOW()
    WHERE id = 1
  `).catch(() => {});
}

// ── Report data generation ────────────────────────────────────────────────────

interface PlData { revenue: number; expenses: number; }

interface ArItem {
  customerName: string;
  outstanding: number;
  invoiceCount: number;
  hasOverdue: boolean;
}

interface ReportData {
  date: string;
  // harian
  revenue: number;
  expenses: number;
  netProfit: number;
  // bulan berjalan
  monthRevenue: number;
  monthExpenses: number;
  monthNetProfit: number;
  monthLabel: string;
  // kas/bank & aktivitas
  totalEntries: number;
  totalVolume: number;
  cashInflows: number;
  cashOutflows: number;
  // piutang outstanding
  arItems: ArItem[];
  arTotal: number;
  arOverdueTotal: number;
}

async function fetchPl(fromDate: string, toDate: string): Promise<PlData> {
  const result = await db.execute(sql`
    SELECT
      COALESCE(SUM(CASE WHEN coa.account_type IN ('income','revenue','pendapatan') OR coa.code LIKE '4%' THEN ael.credit - ael.debit ELSE 0 END), 0)::numeric AS revenue,
      COALESCE(SUM(CASE WHEN coa.account_type IN ('expense','expenses','beban','cost','cogs') OR coa.code LIKE '5%' OR coa.code LIKE '6%' THEN ael.debit - ael.credit ELSE 0 END), 0)::numeric AS expenses
    FROM accounting_entry_lines ael
    JOIN accounting_entries ae ON ae.id = ael.entry_id
    JOIN chart_of_accounts coa ON coa.id = ael.account_id
    WHERE ae.date >= ${fromDate}
      AND ae.date < ${toDate}
      AND ae.status IN ('posted','approved')
  `).catch(() => ({ rows: [] }));
  const row = result.rows[0] as Record<string, unknown> | undefined;
  return { revenue: Number(row?.revenue ?? 0), expenses: Number(row?.expenses ?? 0) };
}

async function generateReportData(dateWib: string): Promise<ReportData> {
  const dateSql = dateWib;
  const dateNext = new Date(dateSql);
  dateNext.setDate(dateNext.getDate() + 1);
  const dateNextSql = dateNext.toISOString().slice(0, 10);

  // Bulan berjalan: 1 s/d tanggal ini
  const monthStart = dateSql.slice(0, 7) + "-01";
  const monthLabelRaw = new Date(dateSql + "T00:00:00+07:00");
  const monthLabel = monthLabelRaw.toLocaleDateString("id-ID", { month: "long", year: "numeric" });

  const [daily, monthly] = await Promise.all([
    fetchPl(dateSql, dateNextSql),
    fetchPl(monthStart, dateNextSql),
  ]);

  const activityResult = await db.execute(sql`
    SELECT
      COUNT(*)::int AS total_entries,
      COALESCE(SUM(CASE WHEN ael.debit > 0 THEN ael.debit ELSE 0 END), 0)::numeric AS total_volume
    FROM accounting_entries ae
    JOIN accounting_entry_lines ael ON ael.entry_id = ae.id
    WHERE ae.date >= ${dateSql}
      AND ae.date < ${dateNextSql}
      AND ae.status IN ('posted','approved')
  `).catch(() => ({ rows: [] }));

  const act = activityResult.rows[0] as Record<string, unknown> | undefined;

  const cashResult = await db.execute(sql`
    SELECT
      COALESCE(SUM(CASE WHEN ael.debit > 0 THEN ael.debit ELSE 0 END), 0)::numeric AS inflows,
      COALESCE(SUM(CASE WHEN ael.credit > 0 THEN ael.credit ELSE 0 END), 0)::numeric AS outflows
    FROM accounting_entry_lines ael
    JOIN accounting_entries ae ON ae.id = ael.entry_id
    JOIN chart_of_accounts coa ON coa.id = ael.account_id
    WHERE ae.date >= ${dateSql}
      AND ae.date < ${dateNextSql}
      AND ae.status IN ('posted','approved')
      AND (coa.account_type IN ('asset','cash','bank','kas','bank') OR coa.code LIKE '1%')
  `).catch(() => ({ rows: [] }));

  const cash = cashResult.rows[0] as Record<string, unknown> | undefined;

  // ── AR Outstanding ─────────────────────────────────────────────────────────
  const arResult = await db.execute(sql`
    SELECT
      customer_name,
      COUNT(*)::int                                                            AS invoice_count,
      COALESCE(SUM(grand_total::numeric - COALESCE(amount_paid::numeric, 0)), 0)::numeric AS outstanding,
      BOOL_OR(due_date IS NOT NULL AND due_date::date < ${dateSql}::date)       AS has_overdue
    FROM sales_documents
    WHERE invoice_status = 'invoiced'
      AND grand_total::numeric > COALESCE(amount_paid::numeric, 0)
    GROUP BY customer_name
    ORDER BY outstanding DESC
    LIMIT 15
  `).catch(() => ({ rows: [] }));

  type ArRow = { customer_name: string; invoice_count: string | number; outstanding: string; has_overdue: boolean };
  const arRows = arResult.rows as ArRow[];

  const arItems: ArItem[] = arRows.map((r) => ({
    customerName: String(r.customer_name ?? "—"),
    outstanding: Number(r.outstanding ?? 0),
    invoiceCount: Number(r.invoice_count ?? 1),
    hasOverdue: Boolean(r.has_overdue),
  }));

  const arTotal = arItems.reduce((s, r) => s + r.outstanding, 0);

  // Total overdue: query terpisah untuk akurasi
  const arOverdueResult = await db.execute(sql`
    SELECT COALESCE(SUM(grand_total::numeric - COALESCE(amount_paid::numeric, 0)), 0)::numeric AS overdue_total
    FROM sales_documents
    WHERE invoice_status = 'invoiced'
      AND grand_total::numeric > COALESCE(amount_paid::numeric, 0)
      AND due_date IS NOT NULL
      AND due_date::date < ${dateSql}::date
  `).catch(() => ({ rows: [] }));

  const arOverdueRow = arOverdueResult.rows[0] as Record<string, unknown> | undefined;
  const arOverdueTotal = Number(arOverdueRow?.overdue_total ?? 0);

  return {
    date: dateWib,
    revenue: daily.revenue,
    expenses: daily.expenses,
    netProfit: daily.revenue - daily.expenses,
    monthRevenue: monthly.revenue,
    monthExpenses: monthly.expenses,
    monthNetProfit: monthly.revenue - monthly.expenses,
    monthLabel,
    totalEntries: Number(act?.total_entries ?? 0),
    totalVolume: Number(act?.total_volume ?? 0),
    cashInflows: Number(cash?.inflows ?? 0),
    cashOutflows: Number(cash?.outflows ?? 0),
    arItems,
    arTotal,
    arOverdueTotal,
  };
}

function buildReportMessage(data: ReportData): string {
  const labaHarian = data.netProfit >= 0
    ? `✅ *Laba Bersih : ${formatRupiah(data.netProfit)}*`
    : `🔴 *Rugi Bersih : ${formatRupiah(Math.abs(data.netProfit))}*`;
  const labaBulan = data.monthNetProfit >= 0
    ? `✅ *Laba Bersih : ${formatRupiah(data.monthNetProfit)}*`
    : `🔴 *Rugi Bersih : ${formatRupiah(Math.abs(data.monthNetProfit))}*`;

  // ── Susun baris AR Outstanding ──────────────────────────────────────────────
  const arLines: string[] = [];
  arLines.push(`━━━━━━━━━━━━━━━━━━`);
  arLines.push(`🔔 *PIUTANG OUTSTANDING*`);

  if (data.arItems.length === 0) {
    arLines.push(`Tidak ada piutang outstanding.`);
  } else {
    arLines.push(`Total : *${formatRupiah(data.arTotal)}*`);
    if (data.arOverdueTotal > 0) {
      arLines.push(`⚠️ Jatuh tempo : *${formatRupiah(data.arOverdueTotal)}*`);
    }
    arLines.push(`──────────────────`);
    for (const item of data.arItems) {
      const overdueFlag = item.hasOverdue ? " ⚠️" : "";
      const invLabel = item.invoiceCount > 1 ? ` (${item.invoiceCount} inv)` : "";
      // Potong nama customer max 22 karakter supaya rapi di WA
      const name = item.customerName.length > 22
        ? item.customerName.slice(0, 21) + "…"
        : item.customerName;
      arLines.push(`• ${name}${overdueFlag}${invLabel}`);
      arLines.push(`  ${formatRupiah(item.outstanding)}`);
    }
  }

  const lines = [
    `📊 *LAPORAN HARIAN CST LOGISTICS*`,
    `📅 ${formatDate(data.date)} — 22:00 WIB`,
    ``,
    `━━━━━━━━━━━━━━━━━━`,
    `💰 *LABA RUGI HARI INI*`,
    `Pendapatan : ${formatRupiah(data.revenue)}`,
    `Beban      : ${formatRupiah(data.expenses)}`,
    `──────────────────`,
    labaHarian,
    ``,
    `━━━━━━━━━━━━━━━━━━`,
    `📈 *LABA RUGI ${data.monthLabel.toUpperCase()} (MTD)*`,
    `Pendapatan : ${formatRupiah(data.monthRevenue)}`,
    `Beban      : ${formatRupiah(data.monthExpenses)}`,
    `──────────────────`,
    labaBulan,
    ``,
    `━━━━━━━━━━━━━━━━━━`,
    `🏦 *PERGERAKAN KAS/BANK (HARI INI)*`,
    `Masuk  : ${formatRupiah(data.cashInflows)}`,
    `Keluar : ${formatRupiah(data.cashOutflows)}`,
    ``,
    `📋 *AKTIVITAS HARI INI*`,
    `Jurnal diposting : ${data.totalEntries.toLocaleString("id-ID")} entri`,
    `Volume transaksi : ${formatRupiah(data.totalVolume)}`,
    ``,
    ...arLines,
    ``,
    `_Dikirim otomatis oleh BizPortal_`,
  ];
  return lines.join("\n");
}

// ── Fonnte send (token terpisah) ──────────────────────────────────────────────

async function sendReportWhatsApp(target: string, message: string): Promise<void> {
  // Hanya kirim dari environment production (deployed). Di dev workspace skip agar
  // tidak ada laporan ganda dengan data yang tidak lengkap masuk ke WA group.
  if (!process.env.REPLIT_DEPLOYMENT) {
    logger.info(`${PREFIX} Dev environment — skip kirim ke ${target} (hanya prod yang kirim)`);
    return;
  }
  // Gunakan FONNTE_TOKEN_REPORT jika ada, fallback ke FONNTE_TOKEN (ops biasa)
  const token = process.env.FONNTE_TOKEN_REPORT?.trim() || process.env.FONNTE_TOKEN?.trim();
  if (!token) {
    logger.warn(`${PREFIX} Tidak ada FONNTE token (FONNTE_TOKEN_REPORT / FONNTE_TOKEN) — skip kirim ke ${target}`);
    return;
  }
  const phone = target.includes("@") ? target.trim() : target.replace(/^\+/, "").replace(/^0/, "62");
  const res = await fetch("https://api.fonnte.com/send", {
    method: "POST",
    headers: {
      Authorization: token,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ target: phone, message }).toString(),
  });
  const body = await res.json() as Record<string, unknown>;
  if (!res.ok || body.status === false || body.status === "false") {
    throw new Error(`Fonnte: HTTP ${res.status} — ${JSON.stringify(body)}`);
  }
  logger.info({ phone }, `${PREFIX} Laporan terkirim`);
}

// ── Preview (generate message tanpa kirim) ───────────────────────────────────

export async function previewDailyReport(forceDate?: string): Promise<{ message: string; date: string; data: ReportData }> {
  const dateWib = forceDate ?? todayWib();
  const data = await generateReportData(dateWib);
  const message = buildReportMessage(data);
  return { message, date: dateWib, data };
}

// ── Main run function (juga dipanggil dari API send-now) ──────────────────────

export async function runDailyReport(forceDate?: string): Promise<{ ok: boolean; message: string; recipients: string[]; errors: string[] }> {
  if (isRunning) {
    return { ok: false, message: "Report sedang berjalan", recipients: [], errors: [] };
  }
  isRunning = true;
  const errors: string[] = [];
  try {
    const settings = await getReportSettings();
    if (!settings.enabled && !forceDate) {
      return { ok: false, message: "Laporan WA tidak aktif", recipients: [], errors: [] };
    }
    const dateWib = forceDate ?? todayWib();
    const data = await generateReportData(dateWib);
    const message = buildReportMessage(data);

    const sentTo: string[] = [];
    for (const target of settings.recipients) {
      if (!target?.trim()) continue;
      try {
        await sendReportWhatsApp(target.trim(), message);
        sentTo.push(target);
      } catch (err) {
        const msg = String(err);
        errors.push(`${target}: ${msg}`);
        logger.error({ err, target }, `${PREFIX} Gagal kirim ke ${target}`);
      }
    }

    const status = errors.length === 0 ? "ok" : `partial (${errors.length} error)`;
    await markSent(dateWib, status);
    lastSentDate = dateWib;

    logger.info({ dateWib, sentTo, errors }, `${PREFIX} Laporan selesai`);
    return { ok: errors.length === 0, message, recipients: sentTo, errors };
  } finally {
    isRunning = false;
  }
}

// ── Worker scheduler ──────────────────────────────────────────────────────────

export function startDailyReportWorker(): void {
  void ensureReportSettingsTable().catch((err) =>
    logger.warn({ err }, `${PREFIX} Gagal setup tabel (non-fatal)`)
  );

  const check = async () => {
    const hour = currentHourUtc();
    if (hour !== REPORT_HOUR_UTC) return;

    const dateWib = todayWib();
    if (lastSentDate === dateWib) return;

    try {
      const settings = await getReportSettings();
      if (!settings.enabled) return;
      if (settings.lastSentDate === dateWib) {
        lastSentDate = dateWib;
        return;
      }
      lastSentDate = dateWib;
      logger.info({ dateWib }, `${PREFIX} Memulai jadwal harian (22:00 WIB)`);
      await runDailyReport();
    } catch (err) {
      logger.error({ err }, `${PREFIX} Scheduler error`);
    }
  };

  void check();
  setInterval(() => void check(), CHECK_INTERVAL_MS).unref();

  logger.info(
    { reportHourUtc: REPORT_HOUR_UTC, checkIntervalMin: CHECK_INTERVAL_MS / 60_000 },
    `${PREFIX} Worker dimulai (harian 22:00 WIB / ${REPORT_HOUR_UTC}:00 UTC)`
  );
}
