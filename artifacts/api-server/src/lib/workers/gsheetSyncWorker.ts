/**
 * gsheetSyncWorker.ts — Nightly Google Sheets sync
 *
 * Mendorong data akuntansi ke Google Sheets sekali sehari pukul 01:00 WIB (18:00 UTC)
 * untuk setiap perusahaan yang memiliki gsheetSpreadsheetId dikonfigurasi di
 * accounting_settings. Ini menjaga sheet selalu segar tanpa intervensi admin.
 *
 * Toggle: hapus / set null gsheetSpreadsheetId di accounting_settings untuk
 * menonaktifkan sinkronisasi per-perusahaan.
 *
 * Tab yang di-push: CoA, Jurnal, Lines, TrialBalance, GL (sama dengan POST /gsheet/push)
 *
 * Registered via registerWorker() di index.ts dengan delay 180_000ms.
 */

import {
  db,
  accountingSettingsTable,
  chartOfAccountsTable,
  accountingEntriesTable,
  accountingEntryLinesTable,
} from "@workspace/db";
import { isNull, isNotNull, eq, desc, inArray, sql } from "drizzle-orm";
import { logger } from "../logger.js";
import {
  ensureSheets,
  clearAndWriteSheet,
  getServiceAccountEmail,
} from "../googleSheets.js";
import { sendViaService as sendWhatsApp } from "../waTransport.js";
import { getAdminWa } from "../adminWa.js";

// ── Config ─────────────────────────────────────────────────────────────────────

const PREFIX = "[GSheetSyncWorker]";

/** 01:00 WIB = 18:00 UTC hari sebelumnya */
const SYNC_HOUR_UTC = 18;

const CHECK_INTERVAL_MS = 5 * 60 * 1000; // cek tiap 5 menit

/** Tab yang harus ada sebelum push */
const REQUIRED_SHEETS = ["CoA", "Jurnal", "Lines", "TrialBalance", "GL"];

// ── Internal state ─────────────────────────────────────────────────────────────

let _isRunning = false;
/** "YYYY-MM-DD" tanggal (WIB) terakhir kali sinkronisasi berhasil */
let _lastSyncDate: string | null = null;

// ── Helpers ────────────────────────────────────────────────────────────────────

function todayWib(): string {
  const now = new Date();
  const wib = new Date(now.getTime() + 7 * 60 * 60 * 1000);
  return wib.toISOString().slice(0, 10);
}

function currentHourUtc(): number {
  return new Date().getUTCHours();
}

// ── Core push logic ────────────────────────────────────────────────────────────

interface PushResult {
  ok: boolean;
  spreadsheetId: string;
  companyId: number | null;
  error?: string;
  notFound?: boolean; // true ketika spreadsheet sudah dihapus dari Google Drive
  pushed?: { accounts: number; entries: number; lines: number; glLines: number };
}

/**
 * Dorong semua 5 tab untuk satu perusahaan.
 * Logika ini mencerminkan POST /gsheet/push di accounting.ts.
 */
async function pushCompanyToSheet(
  spreadsheetId: string,
  companyId: number | null
): Promise<PushResult> {
  try {
    await ensureSheets(spreadsheetId, REQUIRED_SHEETS);

    // Scope filter
    const coaScope = companyId
      ? eq(chartOfAccountsTable.companyId, companyId)
      : isNull(chartOfAccountsTable.companyId);
    const entriesScope = companyId
      ? eq(accountingEntriesTable.companyId, companyId)
      : isNull(accountingEntriesTable.companyId);

    // 1) Chart of Accounts
    const accounts = await db
      .select()
      .from(chartOfAccountsTable)
      .where(coaScope)
      .orderBy(chartOfAccountsTable.code);

    const coaRows: unknown[][] = [
      ["ID", "Kode", "Nama Akun", "Tipe", "Parent ID", "Aktif"],
      ...accounts.map((a) => [
        a.id,
        a.code,
        a.name,
        a.type,
        a.parentId ?? "",
        a.isActive ? "Ya" : "Tidak",
      ]),
    ];
    await clearAndWriteSheet(spreadsheetId, "CoA", coaRows);

    // 2) Journal Entries (max 2000 terbaru)
    const entries = await db
      .select()
      .from(accountingEntriesTable)
      .where(entriesScope)
      .orderBy(desc(accountingEntriesTable.date))
      .limit(2000);

    const entryRows: unknown[][] = [
      [
        "ID",
        "Nomor",
        "Tanggal",
        "Jurnal ID",
        "Referensi",
        "Keterangan",
        "Status",
        "Sumber",
        "Total Debit",
        "Total Kredit",
      ],
      ...entries.map((e) => [
        e.id,
        e.entryNumber,
        String(e.date ?? "").slice(0, 10),
        e.journalId,
        e.ref ?? "",
        e.description ?? "",
        e.status,
        e.source ?? "",
        e.totalDebit ?? 0,
        e.totalCredit ?? 0,
      ]),
    ];
    await clearAndWriteSheet(spreadsheetId, "Jurnal", entryRows);

    // 3) Entry Lines
    const entryIds = entries.map((e) => e.id);
    let lineRows: unknown[][] = [
      [
        "Entry ID",
        "Nomor Entry",
        "Akun ID",
        "Kode Akun",
        "Nama Akun",
        "Keterangan",
        "Debit",
        "Kredit",
      ],
    ];
    if (entryIds.length > 0) {
      const lines = await db
        .select({
          entryId: accountingEntryLinesTable.entryId,
          entryNumber: accountingEntriesTable.entryNumber,
          accountId: accountingEntryLinesTable.accountId,
          accountCode: chartOfAccountsTable.code,
          accountName: chartOfAccountsTable.name,
          description: accountingEntryLinesTable.description,
          debit: accountingEntryLinesTable.debit,
          credit: accountingEntryLinesTable.credit,
        })
        .from(accountingEntryLinesTable)
        .leftJoin(
          accountingEntriesTable,
          eq(accountingEntryLinesTable.entryId, accountingEntriesTable.id)
        )
        .leftJoin(
          chartOfAccountsTable,
          eq(accountingEntryLinesTable.accountId, chartOfAccountsTable.id)
        )
        .where(inArray(accountingEntryLinesTable.entryId, entryIds))
        .orderBy(accountingEntryLinesTable.entryId);

      lineRows = [
        lineRows[0]!,
        ...lines.map((l) => [
          l.entryId,
          l.entryNumber,
          l.accountId,
          l.accountCode ?? "",
          l.accountName ?? "",
          l.description ?? "",
          l.debit ?? 0,
          l.credit ?? 0,
        ]),
      ];
    }
    await clearAndWriteSheet(spreadsheetId, "Lines", lineRows);

    // 4) Trial Balance
    const tbData = await db.execute(sql`
      SELECT coa.code, coa.name, coa.type,
        COALESCE(SUM(ael.debit), 0)  AS total_debit,
        COALESCE(SUM(ael.credit), 0) AS total_credit,
        COALESCE(SUM(ael.debit), 0) - COALESCE(SUM(ael.credit), 0) AS balance
      FROM chart_of_accounts coa
      LEFT JOIN accounting_entry_lines ael ON ael.account_id = coa.id
      LEFT JOIN accounting_entries ae
             ON ae.id = ael.entry_id AND ae.status::text = 'posted'
      WHERE coa.company_id ${companyId ? sql`= ${companyId}` : sql`IS NULL`}
      GROUP BY coa.code, coa.name, coa.type
      ORDER BY coa.code
    `);

    type TBRow = {
      code: string;
      name: string;
      type: string;
      total_debit: string;
      total_credit: string;
      balance: string;
    };
    const tbRows: unknown[][] = [
      ["Kode", "Nama Akun", "Tipe", "Total Debit", "Total Kredit", "Saldo"],
      ...(tbData.rows as TBRow[]).map((r) => [
        r.code,
        r.name,
        r.type,
        Number(r.total_debit),
        Number(r.total_credit),
        Number(r.balance),
      ]),
    ];
    await clearAndWriteSheet(spreadsheetId, "TrialBalance", tbRows);

    // 5) General Ledger
    const glData = await db.execute(sql`
      SELECT
        coa.code       AS account_code,
        coa.name       AS account_name,
        coa.type       AS account_type,
        ae.date,
        ae.entry_number,
        ae.ref,
        ae.description  AS entry_desc,
        ael.description AS line_desc,
        COALESCE(ael.debit,  0) AS debit,
        COALESCE(ael.credit, 0) AS credit
      FROM accounting_entry_lines ael
      JOIN accounting_entries ae  ON ae.id  = ael.entry_id
      JOIN chart_of_accounts  coa ON coa.id = ael.account_id
      WHERE ae.status::text = 'posted'
        AND coa.company_id ${companyId ? sql`= ${companyId}` : sql`IS NULL`}
      ORDER BY coa.code, ae.date, ae.entry_number, ael.id
    `);

    type GLRow = {
      account_code: string;
      account_name: string;
      account_type: string;
      date: Date | string;
      entry_number: string;
      ref: string | null;
      entry_desc: string | null;
      line_desc: string | null;
      debit: string;
      credit: string;
    };

    const glRaw = glData.rows as GLRow[];
    const glRows: unknown[][] = [
      [
        "Kode Akun",
        "Nama Akun",
        "Tipe",
        "Tanggal",
        "No. Entry",
        "Ref",
        "Keterangan Entri",
        "Keterangan Baris",
        "Debit",
        "Kredit",
        "Saldo Berjalan",
      ],
    ];

    let runningBalance = 0;
    let lastAccountCode = "";
    for (const r of glRaw) {
      if (r.account_code !== lastAccountCode) {
        runningBalance = 0;
        lastAccountCode = r.account_code;
      }
      const debit = Number(r.debit);
      const credit = Number(r.credit);
      runningBalance += debit - credit;
      const dateStr =
        r.date instanceof Date
          ? r.date.toISOString().slice(0, 10)
          : String(r.date).slice(0, 10);
      glRows.push([
        r.account_code,
        r.account_name,
        r.account_type,
        dateStr,
        r.entry_number,
        r.ref ?? "",
        r.entry_desc ?? "",
        r.line_desc ?? "",
        debit,
        credit,
        runningBalance,
      ]);
    }
    await clearAndWriteSheet(spreadsheetId, "GL", glRows);

    return {
      ok: true,
      spreadsheetId,
      companyId,
      pushed: {
        accounts: accounts.length,
        entries: entries.length,
        lines: lineRows.length - 1,
        glLines: glRows.length - 1,
      },
    };
  } catch (err: unknown) {
    const raw = err instanceof Error ? err.message : String(err);
    const code = (err as any)?.code ?? (err as any)?.status;
    const isNotFound =
      code === 404 ||
      raw.includes("Requested entity was not found") ||
      raw.toLowerCase().includes("not found");
    const saEmail = getServiceAccountEmail();
    const friendlyMsg =
      raw.includes("has not been used") || raw.includes("is disabled")
        ? "Google Sheets API belum diaktifkan di project GCP."
        : raw.includes("does not have permission") ||
            raw.includes("caller does not have permission")
          ? `Service Account tidak punya akses ke spreadsheet. Share ke: ${saEmail ?? "(tidak diketahui)"} (Editor).`
          : isNotFound
            ? "Spreadsheet tidak ditemukan di Google Drive — mungkin sudah dihapus."
            : raw;
    return { ok: false, spreadsheetId, companyId, error: friendlyMsg, notFound: isNotFound };
  }
}

// ── Nightly run ────────────────────────────────────────────────────────────────

async function runNightlySync(): Promise<void> {
  if (_isRunning) {
    logger.warn(`${PREFIX} Sinkronisasi sudah berjalan — skip`);
    return;
  }
  _isRunning = true;

  const dateWib = todayWib();
  logger.info({ dateWib }, `${PREFIX} Memulai sinkronisasi malam`);

  try {
    // Ambil semua perusahaan dengan spreadsheet yang dikonfigurasi
    const settings = await db
      .select({
        companyId: accountingSettingsTable.companyId,
        spreadsheetId: accountingSettingsTable.gsheetSpreadsheetId,
      })
      .from(accountingSettingsTable)
      .where(isNotNull(accountingSettingsTable.gsheetSpreadsheetId));

    if (settings.length === 0) {
      logger.info(
        `${PREFIX} Tidak ada perusahaan dengan Google Sheet dikonfigurasi — skip`
      );
      return;
    }

    logger.info(
      { count: settings.length },
      `${PREFIX} Menyinkronkan ${settings.length} perusahaan ke Google Sheets`
    );

    const results: PushResult[] = [];
    for (const row of settings) {
      const spreadsheetId = row.spreadsheetId!;
      const companyId = row.companyId ?? null;

      logger.info(
        { spreadsheetId, companyId },
        `${PREFIX} Push ke spreadsheet`
      );
      const result = await pushCompanyToSheet(spreadsheetId, companyId);
      results.push(result);

      if (result.ok) {
        logger.info(
          { spreadsheetId, companyId, pushed: result.pushed },
          `${PREFIX} ✅ Sinkronisasi berhasil`
        );
      } else {
        logger.error(
          { spreadsheetId, companyId, error: result.error, notFound: result.notFound },
          `${PREFIX} ❌ Sinkronisasi gagal`
        );

        // Jika spreadsheet sudah dihapus dari Drive, hapus ID dari DB agar
        // sinkronisasi berikutnya tidak mencoba lagi ke sheet yang sudah tidak ada.
        if (result.notFound) {
          try {
            await db
              .update(accountingSettingsTable)
              .set({ gsheetSpreadsheetId: null } as Partial<typeof accountingSettingsTable.$inferInsert>)
              .where(
                companyId
                  ? eq(accountingSettingsTable.companyId, companyId)
                  : isNull(accountingSettingsTable.companyId)
              );
            logger.warn(
              { spreadsheetId, companyId },
              `${PREFIX} SpreadsheetId dihapus dari DB — sheet tidak ditemukan di Drive`
            );
          } catch (dbErr) {
            logger.error({ dbErr }, `${PREFIX} Gagal menghapus stale spreadsheetId dari DB`);
          }
        }

        // Kirim WA alert ke admin (best-effort)
        try {
          const adminWa = await getAdminWa();
          if (adminWa) {
            const msg = result.notFound
              ? [
                  `🗑️ *GSheet Link Rusak (${dateWib})*`,
                  ``,
                  `Spreadsheet akuntansi tidak ditemukan di Google Drive — mungkin sudah dihapus.`,
                  `SpreadsheetId: ${spreadsheetId}`,
                  `CompanyId: ${companyId ?? "global"}`,
                  ``,
                  `Link spreadsheet telah dihapus dari konfigurasi secara otomatis.`,
                  `Buat spreadsheet baru melalui BizPortal → Akuntansi → Google Sheets.`,
                ].join("\n")
              : [
                  `⚠️ *GSheet Sync Gagal (${dateWib})*`,
                  ``,
                  `Sinkronisasi otomatis malam ke Google Sheets gagal.`,
                  `SpreadsheetId: ${spreadsheetId}`,
                  `CompanyId: ${companyId ?? "global"}`,
                  ``,
                  `Error: ${result.error}`,
                  ``,
                  `_Periksa konfigurasi dan coba Push Manual dari BizPortal._`,
                ].join("\n");
            await sendWhatsApp(adminWa, msg, {
              context: result.notFound ? "gsheet_link_broken" : "gsheet_nightly_sync_error",
            });
          }
        } catch (waErr) {
          logger.warn(
            { waErr },
            `${PREFIX} Gagal kirim WA alert (non-fatal)`
          );
        }
      }
    }

    const failed = results.filter((r) => !r.ok).length;
    logger.info(
      {
        dateWib,
        total: results.length,
        ok: results.length - failed,
        failed,
      },
      `${PREFIX} Sinkronisasi malam selesai`
    );

    _lastSyncDate = dateWib;
  } catch (err) {
    logger.error({ err }, `${PREFIX} Error fatal selama sinkronisasi malam`);
  } finally {
    _isRunning = false;
  }
}

// ── Scheduler ──────────────────────────────────────────────────────────────────

export function startGsheetSyncWorker(): void {
  const check = async () => {
    const hourUtc = currentHourUtc();
    if (hourUtc !== SYNC_HOUR_UTC) return;

    const dateWib = todayWib();
    // In-memory dedupe (proses tunggal, tidak butuh persistent state)
    if (_lastSyncDate === dateWib) return;

    await runNightlySync();
  };

  // Jalankan cek pertama setelah delay singkat supaya DB pool sudah stabil
  setTimeout(() => {
    void check();
    setInterval(() => void check(), CHECK_INTERVAL_MS).unref();
  }, 30_000).unref();

  logger.info(
    {
      syncHourUtc: SYNC_HOUR_UTC,
      syncHourWib: "01:00",
      checkIntervalMin: CHECK_INTERVAL_MS / 60_000,
    },
    `${PREFIX} Worker dimulai (01:00 WIB / ${SYNC_HOUR_UTC}:00 UTC)`
  );
}

// ── Manual trigger (untuk API /gsheet/sync-now jika diperlukan) ───────────────

export async function triggerGsheetSyncNow(): Promise<{
  triggered: boolean;
  message: string;
}> {
  if (_isRunning) {
    return {
      triggered: false,
      message: "Sinkronisasi sudah berjalan. Coba lagi nanti.",
    };
  }
  void runNightlySync();
  return { triggered: true, message: "Sinkronisasi dimulai." };
}
