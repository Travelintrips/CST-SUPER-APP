/**
 * Rekonsiliasi GSheet Worker
 * Menjalankan rekonsiliasi otomatis DB ↔ Google Sheets sesuai jadwal.
 * Konfigurasi disimpan di accounting_settings.meta.rekonSchedule (per company atau global).
 */
import { db, accountingSettingsTable, accountingEntriesTable, accountingEntryLinesTable } from "@workspace/db";
import { eq, and, gte, lte } from "drizzle-orm";
import { readSheet, batchUpdateSheet } from "./googleSheets.js";
import { logger } from "./logger.js";

const INTERVAL_MIN = 60; // cek tiap jam, tapi hanya jalankan pada jam yang dikonfigurasi
const INITIAL_DELAY_MIN = 3;

// ─── Types ────────────────────────────────────────────────────────────────────

interface RekonScheduleConfig {
  enabled: boolean;
  spreadsheetId: string;
  sheetName: string;
  colKey: number;
  colStatus: number;
  startRow: number;
  companyId?: number | null;
  hourWib: number; // jam WIB kapan rekonsiliasi dijalankan (default 2 = jam 02:00 WIB)
  lastRunDate?: string; // tanggal terakhir berhasil run (YYYY-MM-DD)
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function generateKey(tanggal: Date | string, debit: number, kredit: number): string {
  const d = new Date(tanggal);
  const dateStr =
    `${d.getFullYear()}` +
    String(d.getMonth() + 1).padStart(2, "0") +
    String(d.getDate()).padStart(2, "0");
  const amount = kredit > 0 ? kredit : debit;
  const type = kredit > 0 ? "IN" : "OUT";
  return `${dateStr}_${amount}_${type}`;
}

function colToLetter(n: number): string {
  let s = "";
  let col = n;
  while (col >= 0) {
    s = String.fromCharCode((col % 26) + 65) + s;
    col = Math.floor(col / 26) - 1;
  }
  return s;
}

function todayWib(): string {
  // WIB = UTC+7
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 3600 * 1000);
  return wib.toISOString().split("T")[0]!;
}

function currentHourWib(): number {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 3600 * 1000);
  return wib.getUTCHours();
}

// ─── Baca semua config dari DB ────────────────────────────────────────────────

async function loadConfigs(): Promise<Array<{ settingId: number; config: RekonScheduleConfig }>> {
  const rows = await db
    .select({ id: accountingSettingsTable.id, meta: accountingSettingsTable.meta })
    .from(accountingSettingsTable);

  const result: Array<{ settingId: number; config: RekonScheduleConfig }> = [];
  for (const row of rows) {
    const meta = (row.meta ?? {}) as Record<string, unknown>;
    const cfg = meta.rekonSchedule as RekonScheduleConfig | undefined;
    if (cfg?.enabled && cfg.spreadsheetId) {
      result.push({ settingId: row.id, config: cfg });
    }
  }
  return result;
}

// ─── Simpan lastRunDate setelah berhasil ──────────────────────────────────────

async function saveLastRunDate(settingId: number, existing: Record<string, unknown>, date: string) {
  const newMeta = {
    ...existing,
    rekonSchedule: {
      ...(existing.rekonSchedule as object),
      lastRunDate: date,
    },
  };
  await db
    .update(accountingSettingsTable)
    .set({ meta: newMeta })
    .where(eq(accountingSettingsTable.id, settingId));
}

// ─── Jalankan rekonsiliasi untuk satu config ──────────────────────────────────

async function runRekonsiliasi(settingId: number, cfg: RekonScheduleConfig): Promise<[string, string?]> {
  const today = todayWib();

  // Filter: kemarin saja (data hari ini mungkin belum lengkap)
  const yesterday = new Date(new Date().getTime() - 24 * 3600 * 1000)
    .toISOString()
    .split("T")[0]!;

  const conds = [eq(accountingEntriesTable.status, "posted")] as ReturnType<typeof eq>[];
  if (cfg.companyId) conds.push(eq(accountingEntriesTable.companyId, cfg.companyId));
  // Filter 30 hari terakhir agar tidak terlalu banyak
  const dateFrom = new Date(new Date().getTime() - 30 * 24 * 3600 * 1000)
    .toISOString()
    .split("T")[0]!;
  conds.push(gte(accountingEntriesTable.date, dateFrom));
  conds.push(lte(accountingEntriesTable.date, yesterday));

  const [dbLines, allRows] = await Promise.all([
    db
      .select({
        id: accountingEntryLinesTable.id,
        debit: accountingEntryLinesTable.debit,
        credit: accountingEntryLinesTable.credit,
        entryDate: accountingEntriesTable.date,
        entryNumber: accountingEntriesTable.entryNumber,
      })
      .from(accountingEntryLinesTable)
      .innerJoin(accountingEntriesTable, eq(accountingEntryLinesTable.entryId, accountingEntriesTable.id))
      .where(and(...conds)),
    readSheet(cfg.spreadsheetId, cfg.sheetName),
  ]);

  const colKey = cfg.colKey ?? 4;
  const colStatus = cfg.colStatus ?? 5;
  const startRow = cfg.startRow ?? 2;
  const dataRows = allRows.slice(startRow - 1);

  const keyFrequency: Record<string, number> = {};
  const keyToFirstRow: Record<string, number> = {};
  dataRows.forEach((row, idx) => {
    const key = (row[colKey] ?? "").trim();
    if (key) {
      keyFrequency[key] = (keyFrequency[key] || 0) + 1;
      if (keyToFirstRow[key] === undefined) keyToFirstRow[key] = idx + startRow;
    }
  });

  let matched = 0, duplicate = 0, notFound = 0;
  const updateRequests: Array<{ range: string; values: string[][] }> = [];

  for (const line of dbLines) {
    const debit = Number(line.debit ?? 0);
    const credit = Number(line.credit ?? 0);
    const key = generateKey(line.entryDate, debit, credit);
    const count = keyFrequency[key] ?? 0;

    let status: string;
    if (count > 1) { status = "⚠️ DUPLIKAT"; duplicate++; }
    else if (count === 1) { status = "✅ COCOK"; matched++; }
    else { status = "❌ TIDAK ADA"; notFound++; }

    const gsRow = keyToFirstRow[key] ?? null;
    if (gsRow !== null) {
      updateRequests.push({
        range: `'${cfg.sheetName}'!${colToLetter(colStatus)}${gsRow}`,
        values: [[status]],
      });
    }
  }

  await batchUpdateSheet(cfg.spreadsheetId, updateRequests);

  // Simpan tanggal run
  const meta = await db
    .select({ meta: accountingSettingsTable.meta })
    .from(accountingSettingsTable)
    .where(eq(accountingSettingsTable.id, settingId))
    .then((r) => (r[0]?.meta ?? {}) as Record<string, unknown>);
  await saveLastRunDate(settingId, meta, today);

  const total = dbLines.length;
  const idr = (n: number) => new Intl.NumberFormat("id-ID").format(n);
  const fmtDate = (s: Date | string) => {
    const d = new Date(s); return `${String(d.getDate()).padStart(2,"0")}/${String(d.getMonth()+1).padStart(2,"0")}/${d.getFullYear()}`;
  };

  const msg1 =
    `📊 *Rekonsiliasi Otomatis Selesai*\n\n` +
    `📅 Tanggal: ${today}\n` +
    `📋 Sheet: ${cfg.sheetName}\n\n` +
    `✅ Cocok: ${matched}\n` +
    `⚠️ Duplikat: ${duplicate}\n` +
    `❌ Tidak Ada: ${notFound}\n` +
    `📝 Total Entry DB: ${total}\n` +
    `🔄 Baris GSheet diperbarui: ${updateRequests.length}`;

  // Pesan 2: detail entri tidak ditemukan di bank
  const tidakAda = dbLines.filter((_, i) => {
    const line = dbLines[i];
    const debit = Number(line.debit ?? 0);
    const credit = Number(line.credit ?? 0);
    const key = generateKey(line.entryDate, debit, credit);
    return (keyFrequency[key] ?? 0) === 0;
  });

  let msg2: string | undefined;
  if (tidakAda.length > 0) {
    const MAX_TOTAL = 30;
    const byDate: Record<string, typeof tidakAda> = {};
    for (const r of tidakAda) {
      const dk = fmtDate(r.entryDate);
      if (!byDate[dk]) byDate[dk] = [];
      byDate[dk].push(r);
    }
    let count = 0;
    const groupLines: string[] = [];
    for (const [tgl, rows] of Object.entries(byDate)) {
      if (count >= MAX_TOTAL) break;
      groupLines.push(`📅 *${tgl}*`);
      for (const r of rows) {
        if (count >= MAX_TOTAL) { groupLines.push(`_...dan lebih banyak lagi_`); break; }
        const debit = Number(r.debit ?? 0);
        const credit = Number(r.credit ?? 0);
        const nominal = debit > 0 ? `D: ${idr(debit)}` : `K: ${idr(credit)}`;
        groupLines.push(`  ❌ *${r.entryNumber}* | ${nominal}`);
        count++;
      }
    }
    const truncNote = tidakAda.length > MAX_TOTAL ? `\n_...dan ${tidakAda.length - MAX_TOTAL} baris lainnya_` : "";
    msg2 =
      `⚠️ *Entri Tidak Ditemukan di Bank (${tidakAda.length} baris)*\n` +
      `_Entri berikut ada di BizPortal tapi tidak cocok di Google Sheet — mohon periksa:_\n\n` +
      groupLines.join("\n") + truncNote;
  }

  return [msg1, msg2];
}

// ─── Kirim WA notifikasi ──────────────────────────────────────────────────────

async function notifyWa(message: string, message2?: string) {
  try {
    const { getAdminGroupWa } = await import("./adminWa.js");
    const { sendWhatsApp } = await import("./fonnte.js");
    const group = await getAdminGroupWa();
    if (!group) return;
    await sendWhatsApp(group, message, { context: "rekon_gsheet_auto" });
    if (message2) await sendWhatsApp(group, message2, { context: "rekon_gsheet_auto_detail" });
  } catch { /* non-fatal */ }
}

// ─── Main check ───────────────────────────────────────────────────────────────

async function checkAndRun() {
  const hourWib = currentHourWib();
  let configs: Awaited<ReturnType<typeof loadConfigs>>;
  try {
    configs = await loadConfigs();
  } catch (err) {
    logger.warn({ err }, "rekonsiliasiWorker: gagal membaca config");
    return;
  }

  for (const { settingId, config } of configs) {
    const targetHour = config.hourWib ?? 2;
    if (hourWib !== targetHour) continue;

    const today = todayWib();
    if (config.lastRunDate === today) continue; // sudah run hari ini

    logger.info({ settingId, spreadsheetId: config.spreadsheetId }, "rekonsiliasiWorker: menjalankan rekonsiliasi otomatis");

    try {
      const [msg1, msg2] = await runRekonsiliasi(settingId, config);
      await notifyWa(msg1, msg2);
      logger.info({ settingId }, "rekonsiliasiWorker: selesai, WA terkirim");
    } catch (err) {
      logger.warn({ err, settingId }, "rekonsiliasiWorker: error saat rekonsiliasi");
      await notifyWa(
        `❌ *Rekonsiliasi Otomatis Gagal*\n\nWaktu: ${today} ${String(targetHour).padStart(2, "0")}:00 WIB\nError: ${err instanceof Error ? err.message : String(err)}\n\nCek konfigurasi di BizPortal → Accounting → Rekonsiliasi Bank → tab Google Sheets.`
      );
    }
  }
}

// ─── Export ───────────────────────────────────────────────────────────────────

export function startRekonsiliasiWorker() {
  const initialDelayMs = INITIAL_DELAY_MIN * 60 * 1000;
  const intervalMs = INTERVAL_MIN * 60 * 1000;
  setTimeout(() => {
    checkAndRun();
    setInterval(checkAndRun, intervalMs);
  }, initialDelayMs);
  logger.info(
    { intervalMin: INTERVAL_MIN, initialDelayMin: INITIAL_DELAY_MIN },
    "rekonsiliasiWorker started (cek tiap jam, run sesuai jadwal WIB)"
  );
}
