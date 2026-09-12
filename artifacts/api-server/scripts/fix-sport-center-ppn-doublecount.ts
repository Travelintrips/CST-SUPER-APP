/**
 * One-time correction: sport_center_booking journal entries yang double-count PPN.
 *
 * Root cause (sudah diperbaiki di modules/sport-center/routes.ts):
 *   baseAmount yang dikirim ke postSportCenterBookingWithTax() adalah total_amount
 *   penuh (sudah termasuk PPN 11%), padahal fungsi tsb menghitung total = base + tax.
 *   Akibatnya Debit Kas = harga (sudah include PPN) + PPN lagi → dobel PPN.
 *
 * Strategi koreksi (tanpa mengubah/menghapus entry posted — immutability rule):
 *   1. Reverse entry yang salah (source='sport_center_booking_reversal', swap debit/credit).
 *   2. Repost entry yang benar (source='manual', ref berisi tag [KOREKSI]) dengan:
 *        Debit Kas            = grand_total (harga asli, sudah termasuk PPN)
 *        Credit Pendapatan    = grand_total - ppn_amount
 *        Credit PPN Keluaran  = ppn_amount
 *
 * Entry yang diproses: HANYA id yang eksplisit ada di daftar TARGET_ENTRY_IDS
 * (hasil investigasi manual — 91 entries dengan debit == legacy grand_total + ppn_amount).
 * Entry lain (termasuk 5 anomali) TIDAK disentuh oleh script ini.
 *
 * Jalankan: npx tsx scripts/fix-sport-center-ppn-doublecount.ts --dry-run
 *           npx tsx scripts/fix-sport-center-ppn-doublecount.ts             (live)
 */

import { db, accountingEntriesTable, accountingEntryLinesTable, accountingJournalsTable } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import { postEntry, resolveSportCenterBookingAccountId } from "../src/lib/accounting.js";
import { ensureAccountingSettings } from "../src/lib/accountingSeed.js";

const DRY_RUN = process.argv.includes("--dry-run");

// Diisi oleh caller sebelum run (lihat TARGET_ENTRY_IDS_PATH) — daftar id accounting_entries
// yang sudah dikonfirmasi double-count (91 entries hasil investigasi).
const TARGET_ENTRY_IDS: number[] = JSON.parse(
  process.env.TARGET_ENTRY_IDS_JSON ?? "[]",
);

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

async function main() {
  console.log(`\n=== fix-sport-center-ppn-doublecount ===`);
  console.log(`Mode : ${DRY_RUN ? "DRY RUN (tidak ada perubahan)" : "LIVE (menulis ke DB)"}`);
  console.log(`Target: ${TARGET_ENTRY_IDS.length} entries\n`);

  if (TARGET_ENTRY_IDS.length === 0) {
    console.error("TARGET_ENTRY_IDS_JSON kosong — abort.");
    process.exit(1);
  }

  const entries = await db
    .select()
    .from(accountingEntriesTable)
    .where(inArray(accountingEntriesTable.id, TARGET_ENTRY_IDS));

  console.log(`Ditemukan ${entries.length} / ${TARGET_ENTRY_IDS.length} entry di DB\n`);

  let fixed = 0, skipped = 0, errors = 0;

  for (const entry of entries) {
    if (entry.status !== "posted") {
      console.log(`  SKIP id=${entry.id} ref=${entry.ref} — status bukan 'posted' (${entry.status})`);
      skipped++;
      continue;
    }
    if (!entry.sourceId) {
      console.log(`  SKIP id=${entry.id} ref=${entry.ref} — tidak ada source_id (booking id)`);
      skipped++;
      continue;
    }

    // Idempotency: a booking is only "done" once BOTH its reversal and its corrected
    // repost exist. If a prior run crashed between the two steps, we must resume
    // from step 2 (repost), never re-reverse an already-reversed entry.
    const [alreadyReversed] = await db
      .select({ id: accountingEntriesTable.id })
      .from(accountingEntriesTable)
      .where(sql`${accountingEntriesTable.source} = 'sport_center_booking_reversal' AND ${accountingEntriesTable.sourceId} = ${entry.sourceId} AND ${accountingEntriesTable.createdById} = 'SYSTEM-PPN-CORRECTION'`)
      .limit(1);
    const correctionRef = `${entry.ref ?? `SC-${entry.sourceId}`}-KOREKSI`;
    const [alreadyReposted] = await db
      .select({ id: accountingEntriesTable.id })
      .from(accountingEntriesTable)
      .where(sql`${accountingEntriesTable.source} = 'manual' AND ${accountingEntriesTable.createdById} = 'SYSTEM-PPN-CORRECTION' AND ${accountingEntriesTable.ref} = ${correctionRef}`)
      .limit(1);
    if (alreadyReversed && alreadyReposted) {
      console.log(`  SKIP id=${entry.id} ref=${entry.ref} — sudah dikoreksi sepenuhnya (booking id=${entry.sourceId})`);
      skipped++;
      continue;
    }
    if (alreadyReversed && !alreadyReposted) {
      console.log(`  RESUME id=${entry.id} ref=${entry.ref} — reversal sudah ada, melanjutkan ke repost (booking id=${entry.sourceId})`);
    }

    // Ambil booking legacy (sport_center.sport_bookings) via source_id untuk grand_total/ppn_amount asli.
    const legacy = await db.execute(sql`
      SELECT order_number, grand_total, ppn_amount
      FROM sport_center.sport_bookings
      WHERE id = ${entry.sourceId}
      LIMIT 1
    `);
    const legacyRow = legacy.rows[0] as Record<string, unknown> | undefined;
    if (!legacyRow) {
      console.log(`  SKIP id=${entry.id} ref=${entry.ref} — booking legacy id=${entry.sourceId} tidak ditemukan`);
      skipped++;
      continue;
    }

    const grandTotal = Number(legacyRow.grand_total ?? 0);
    const ppnAmount = Number(legacyRow.ppn_amount ?? 0);
    if (grandTotal <= 0 || ppnAmount <= 0) {
      console.log(`  SKIP id=${entry.id} ref=${entry.ref} — grand_total/ppn_amount tidak valid`);
      skipped++;
      continue;
    }

    const origLines = await db
      .select()
      .from(accountingEntryLinesTable)
      .where(eq(accountingEntryLinesTable.entryId, entry.id));
    if (origLines.length === 0) {
      console.log(`  SKIP id=${entry.id} ref=${entry.ref} — tidak ada baris jurnal`);
      skipped++;
      continue;
    }

    const [journal] = await db
      .select()
      .from(accountingJournalsTable)
      .where(eq(accountingJournalsTable.id, entry.journalId));
    if (!journal) {
      console.log(`  SKIP id=${entry.id} ref=${entry.ref} — jurnal tidak ditemukan`);
      skipped++;
      continue;
    }

    const correctTotal = round2(grandTotal);
    const correctBase = round2(grandTotal - ppnAmount);
    const correctTax = round2(ppnAmount);

    console.log(
      `  FIX id=${entry.id} ref=${String(entry.ref).padEnd(14)} booking=${legacyRow.order_number}` +
      `  wrongDebit=${Number(entry.totalDebit)}  →  correctTotal=${correctTotal}` +
      `  (base=${correctBase} + ppn=${correctTax})`
    );

    if (DRY_RUN) {
      fixed++;
      continue;
    }

    // NOTE: postEntry() always commits against the global `db` pool (it does not
    // accept an external tx client), so wrapping these two calls in db.transaction()
    // would NOT make them atomic. We accept that a crash between step 1 and step 2
    // can leave a reversal without its repost — the idempotency check above (skip if
    // already reversed) makes it safe to re-run this script to complete any such gap,
    // but a partial gap must be manually verified after an interrupted run.
    try {
      // 1. Reverse entry yang salah (skip if a prior interrupted run already did this —
      //    never reverse the same posted entry twice).
      if (!alreadyReversed) {
        await postEntry(
          {
            journalId: entry.journalId,
            date: new Date(),
            ref: entry.ref ?? null,
            description: `[PEMBALIK - Koreksi Dobel PPN] ${entry.description ?? `Entri #${entry.id}`}`,
            source: "sport_center_booking_reversal",
            sourceId: entry.sourceId,
            companyId: entry.companyId,
            createdById: "SYSTEM-PPN-CORRECTION",
            lines: origLines.map((l) => ({
              accountId: l.accountId,
              debit: Number(l.credit ?? 0),
              credit: Number(l.debit ?? 0),
              description: `[PEMBALIK] Koreksi dobel PPN: ${l.description ?? ""}`,
            })),
          },
          journal.code,
        );
      }

      // 2. Repost entry yang benar.
      const settings = await ensureAccountingSettings(entry.companyId ?? 1);
      const cashAccountId = settings.defaultCashAccountId ?? settings.defaultBankAccountId;
      const incomeAccountId = await resolveSportCenterBookingAccountId(entry.companyId, settings.salesIncomeAccountId);
      // Ambil akun PPN dari baris kredit ke-2 pada entry asli (baris ke-1 = pendapatan, ke-2 = PPN keluaran)
      // Fallback: cari baris kredit kedua terkecil kalau ada > 2 baris kredit.
      const creditLines = origLines.filter((l) => Number(l.credit) > 0);
      const ppnAccountId = creditLines.length >= 2 ? creditLines[creditLines.length - 1].accountId : null;

      if (!cashAccountId || !incomeAccountId || !ppnAccountId) {
        throw new Error(`Akun tidak lengkap untuk repost (cash=${cashAccountId}, income=${incomeAccountId}, ppn=${ppnAccountId}) — REVERSAL SUDAH DIBUAT, repost belum, perlu perbaikan manual untuk entry id=${entry.id}`);
      }

      await postEntry(
        {
          journalId: entry.journalId,
          date: new Date(entry.date as unknown as string),
          ref: `${entry.ref ?? `SC-${entry.sourceId}`}-KOREKSI`,
          description: `[KOREKSI Dobel PPN] ${entry.description ?? `Booking ${legacyRow.order_number}`}`,
          source: "manual",
          companyId: entry.companyId,
          createdById: "SYSTEM-PPN-CORRECTION",
          lines: [
            { accountId: cashAccountId, debit: correctTotal, credit: 0, description: `Penerimaan (koreksi) booking ${legacyRow.order_number}` },
            { accountId: incomeAccountId, debit: 0, credit: correctBase, description: `Pendapatan (koreksi) booking ${legacyRow.order_number}` },
            { accountId: ppnAccountId, debit: 0, credit: correctTax, description: `PPN Keluaran (koreksi) booking ${legacyRow.order_number}` },
          ],
        },
        journal.code,
      );
      fixed++;
    } catch (err) {
      console.error(`  ERROR id=${entry.id}:`, err);
      errors++;
    }
  }

  console.log(`\n─────────────────────────────────────`);
  console.log(`Difix   : ${fixed}`);
  console.log(`Diskip  : ${skipped}`);
  console.log(`Error   : ${errors}`);
  if (DRY_RUN) {
    console.log(`\nJalankan tanpa --dry-run untuk terapkan perubahan.`);
  } else {
    console.log(`\nSelesai.`);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
