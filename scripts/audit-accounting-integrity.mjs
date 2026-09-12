#!/usr/bin/env node
/**
 * Accounting Posting Integrity — Detection Script
 *
 * Memindai indikasi pelanggaran prinsip "Posted Journal is Immutable" (lihat
 * docs/accounting-reversal-void-repayment-policy.md) langsung terhadap DB
 * memakai `pg` (Client) mentah — TIDAK memakai `@workspace/db`/drizzle supaya
 * script ini bisa dijalankan berdiri sendiri (mis. dari CI/cron) tanpa harus
 * membangun seluruh workspace TypeScript.
 *
 * Cek yang dijalankan:
 *   1. Posted journal tanpa transaksi sumber (orphan journal — source_id
 *      menunjuk baris yang sudah tidak ada di tabel asal).
 *   2. Transaksi sumber berstatus void/cancelled TANPA jurnal pembalik.
 *   3. Jurnal tidak balance (total debit != total kredit per entry).
 *   4. Pembayaran/dokumen berstatus "paid"/"posted" tanpa jurnal terkait.
 *   5. Entry pada jurnal kas/bank yang source_id-nya tidak valid.
 *   6. Kasbon/Talangan hilang dari tabel sumber padahal masih dirujuk jurnal
 *      (integrity break dua arah — DELETE fisik sesudah ada jurnal itu bug).
 *
 * The official resolver selects the Supabase target from APP_ENV.
 *
 * Read-only: script ini TIDAK PERNAH melakukan INSERT/UPDATE/DELETE/DDL.
 *
 * Usage:
 *   node scripts/audit-accounting-integrity.mjs
 *
 * Exit code 0 jika bersih, 1 jika ada temuan (dipakai di CI/cron), 2 jika
 * script gagal jalan (mis. tidak ada DB URL / koneksi gagal).
 */

import pg from "pg";
import { resolveSupabaseDatabaseUrl } from "./resolve-supabase-db-url.mjs";

const { Client } = pg;

const { name: DB_LABEL, url: DB_URL } = resolveSupabaseDatabaseUrl();

const client = new Client({
  connectionString: DB_URL,
});

const RESET = "\x1b[0m";
const RED = "\x1b[31m";
const YELLOW = "\x1b[33m";
const GREEN = "\x1b[32m";
const CYAN = "\x1b[36m";
const DIM = "\x1b[2m";

let findingsCount = 0;
/** @type {Array<{ check: string, severity: string, count: number, rows: Array<Record<string, unknown>> }>} */
const findingsSummary = [];

function section(title) {
  console.log(`\n${CYAN}── ${title} ──${RESET}`);
}

/**
 * report — cetak hasil query ke console + akumulasi ke findingsSummary untuk
 * dipakai membangun docs/accounting-integrity-findings.md.
 */
function report(checkName, severity, rows, formatter) {
  if (!rows.length) {
    console.log(`${GREEN}  OK — tidak ada temuan.${RESET}`);
    return;
  }
  findingsCount += rows.length;
  findingsSummary.push({ check: checkName, severity, count: rows.length, rows });
  console.log(`${RED}  ${rows.length} temuan:${RESET}`);
  for (const r of rows) console.log(`  ${YELLOW}•${RESET} ${formatter(r)}`);
}

/** tableExists — cek information_schema sebelum query supaya script tidak
 * crash / false-negative diam-diam di lingkungan yang skema-nya beda (dev vs
 * prod bisa drift, lihat replit.md gotchas). */
async function tableExists(table) {
  const res = await client.query(
    `SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = $1`,
    [table],
  );
  return res.rowCount > 0;
}

async function columnExists(table, column) {
  const res = await client.query(
    `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1 AND column_name = $2`,
    [table, column],
  );
  return res.rowCount > 0;
}

// ─── 1. Orphan journal — source_id eksplisit menunjuk row yang sudah hilang ──

/**
 * Peta source tag (accounting_entries.source) → tabel sumber yang sudah
 * dikonfirmasi ada di lib/db/src/schema/. Source tag lain SENGAJA tidak
 * dipetakan di sini untuk menghindari false-positive dari tebakan nama tabel
 * yang salah — lihat docs/accounting-integrity-findings.md untuk daftar
 * source tag yang belum terpetakan.
 */
const ORPHAN_SOURCE_MAP = [
  { sourceTag: "reversal", table: "accounting_entries", idCol: "id" },
  { sourceTag: "sales_invoice", table: "sales_documents", idCol: "id" },
  { sourceTag: "purchase_bill", table: "purchase_documents", idCol: "id" },
];

async function checkOrphanJournalsForModule(sourceTag, table, idCol) {
  if (!(await tableExists(table))) {
    console.log(`${DIM}  (dilewati — tabel "${table}" tidak ada di DB ini)${RESET}`);
    return;
  }
  const res = await client.query(`
    SELECT ae.id AS entry_id, ae.source, ae.source_id, ae.description, ae.created_at
    FROM accounting_entries ae
    WHERE ae.source = '${sourceTag}'
      AND ae.status = 'posted'
      AND ae.source_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM ${table} t WHERE t.${idCol} = ae.source_id)
  `);
  report(
    `orphan_journal:${sourceTag}`,
    "HIGH",
    res.rows,
    (r) =>
      `Entry #${r.entry_id} (source=${sourceTag}, source_id=${r.source_id}) posted ${r.created_at} — sumber "${table}.${idCol}=${r.source_id}" tidak ditemukan. "${r.description}"`,
  );
}

// ─── 2. Kasbon/Talangan: entry_id merujuk jurnal yang sudah tidak ada ────────

async function checkCashAdvanceEntryIntegrity() {
  if (!(await tableExists("cash_advances"))) {
    console.log(`${DIM}  (dilewati — tabel "cash_advances" tidak ada di DB ini)${RESET}`);
    return;
  }
  const res = await client.query(`
    SELECT ca.id, ca.advance_number, ca.entry_id, ca.status
    FROM cash_advances ca
    WHERE ca.entry_id IS NOT NULL
      AND NOT EXISTS (SELECT 1 FROM accounting_entries ae WHERE ae.id = ca.entry_id)
  `);
  report(
    "kasbon_entry_missing",
    "CRITICAL",
    res.rows,
    (r) =>
      `Kasbon/Talangan #${r.id} (${r.advance_number}, status=${r.status}) mereferensikan entry_id=${r.entry_id} yang TIDAK ADA di accounting_entries.`,
  );
}

// ─── 3. Kasbon/Talangan VOID tanpa jurnal pembalik ───────────────────────────

async function checkVoidWithoutReversal() {
  if (!(await tableExists("cash_advances"))) return;
  const res = await client.query(`
    SELECT id, advance_number, status, reversal_journal_id, voided_at
    FROM cash_advances
    WHERE status = 'void' AND reversal_journal_id IS NULL
  `);
  report(
    "kasbon_void_without_reversal",
    "CRITICAL",
    res.rows,
    (r) =>
      `Kasbon/Talangan #${r.id} (${r.advance_number}) berstatus 'void' (voided_at=${r.voided_at}) tapi TIDAK punya reversal_journal_id — void tanpa jurnal pembalik.`,
  );
}

// ─── 4. accounting_payments VOID tanpa void_entry_id ─────────────────────────

async function checkPaymentVoidWithoutReversal() {
  if (!(await tableExists("accounting_payments"))) return;
  const res = await client.query(`
    SELECT id, payment_number, status, source_type, source_doc_id, void_entry_id
    FROM accounting_payments
    WHERE status = 'voided' AND void_entry_id IS NULL
  `);
  report(
    "payment_voided_without_reversal",
    "HIGH",
    res.rows,
    (r) =>
      `accounting_payment #${r.id} (${r.payment_number ?? "-"}, source=${r.source_type}/${r.source_doc_id}) berstatus 'voided' tapi TIDAK punya void_entry_id.`,
  );
}

// ─── 5. Jurnal tidak balance ──────────────────────────────────────────────────

async function checkUnbalancedJournals() {
  const res = await client.query(`
    SELECT ael.entry_id,
           SUM(COALESCE(ael.debit, 0)) AS total_debit,
           SUM(COALESCE(ael.credit, 0)) AS total_credit
    FROM accounting_entry_lines ael
    JOIN accounting_entries ae ON ae.id = ael.entry_id
    WHERE ae.status = 'posted'
    GROUP BY ael.entry_id
    HAVING ABS(SUM(COALESCE(ael.debit, 0)) - SUM(COALESCE(ael.credit, 0))) > 0.01
  `);
  report(
    "unbalanced_journal",
    "CRITICAL",
    res.rows,
    (r) =>
      `Entry #${r.entry_id} TIDAK BALANCE — total debit ${r.total_debit} != total kredit ${r.total_credit}.`,
  );
}

// ─── 6. Entry posted tanpa entry_lines sama sekali ───────────────────────────

async function checkEntriesWithoutLines() {
  const res = await client.query(`
    SELECT ae.id, ae.entry_number, ae.source, ae.source_id, ae.created_at
    FROM accounting_entries ae
    WHERE ae.status = 'posted'
      AND NOT EXISTS (SELECT 1 FROM accounting_entry_lines ael WHERE ael.entry_id = ae.id)
  `);
  report(
    "posted_entry_without_lines",
    "CRITICAL",
    res.rows,
    (r) =>
      `Entry #${r.id} (${r.entry_number}, source=${r.source}/${r.source_id}) status=posted TAPI tidak punya baris (accounting_entry_lines) sama sekali, dibuat ${r.created_at}.`,
  );
}

// ─── 7. Pembayaran/dokumen "paid"/"posted" tanpa jurnal ─────────────────────

async function checkOrphanAccountingPayments() {
  if (!(await tableExists("accounting_payments"))) return;
  const res = await client.query(`
    SELECT id, payment_number, status, source_type, source_doc_id, amount, created_at
    FROM accounting_payments
    WHERE status = 'posted' AND entry_id IS NULL
  `);
  report(
    "payment_posted_without_journal",
    "HIGH",
    res.rows,
    (r) =>
      `accounting_payment #${r.id} (${r.payment_number ?? "-"}, source=${r.source_type}/${r.source_doc_id}, amount=${r.amount}) berstatus 'posted' TAPI entry_id kosong (tidak ada jurnal).`,
  );
}

async function checkVendorInvoicesPaidWithoutJournal() {
  if (!(await tableExists("vendor_invoices"))) return;
  const res = await client.query(`
    SELECT id, invoice_number, status, grand_total, journal_entry_id
    FROM vendor_invoices
    WHERE status IN ('posted', 'paid')
      AND (journal_entry_id IS NULL OR NOT EXISTS (
        SELECT 1 FROM accounting_entries ae WHERE ae.id = vendor_invoices.journal_entry_id
      ))
  `);
  report(
    "vendor_invoice_paid_without_journal",
    "HIGH",
    res.rows,
    (r) =>
      `vendor_invoice #${r.id} (${r.invoice_number}, status=${r.status}, total=${r.grand_total}) tidak punya journal_entry_id valid.`,
  );
}

// ─── 8. Jurnal kas/bank dengan source_id tidak valid ─────────────────────────

async function checkCashBankJournalInvalidSource() {
  const mapped = ORPHAN_SOURCE_MAP.map((m) => m.sourceTag);
  const existingTables = [];
  for (const m of ORPHAN_SOURCE_MAP) {
    if (await tableExists(m.table)) existingTables.push(m);
  }
  if (existingTables.length === 0) {
    console.log(`${DIM}  (dilewati — tidak ada tabel sumber ter-mapping yang tersedia)${RESET}`);
    return;
  }

  const existsClauses = existingTables
    .map((m) => `(ae.source = '${m.sourceTag}' AND EXISTS (SELECT 1 FROM ${m.table} t WHERE t.${m.idCol} = ae.source_id))`)
    .join(" OR ");

  const res = await client.query(`
    SELECT ae.id AS entry_id, ae.source, ae.source_id, aj.type AS journal_type, ae.description, ae.created_at
    FROM accounting_entries ae
    JOIN accounting_journals aj ON aj.id = ae.journal_id
    WHERE ae.status = 'posted'
      AND aj.type IN ('cash', 'bank')
      AND ae.source_id IS NOT NULL
      AND ae.source::text = ANY(ARRAY[${mapped.map((s) => `'${s}'`).join(",")}]::text[])
      AND NOT (${existsClauses})
  `);
  report(
    "cash_bank_journal_invalid_source",
    "HIGH",
    res.rows,
    (r) =>
      `Entry #${r.entry_id} pada jurnal ${r.journal_type} (source=${r.source}, source_id=${r.source_id}) tidak punya sumber valid. "${r.description}"`,
  );
}

async function main() {
  console.log(`${CYAN}Accounting Posting Integrity — Audit Scan${RESET}`);
  console.log(`Waktu: ${new Date().toISOString()}`);
  console.log(`DB    : ${DB_LABEL}`);

  await client.connect();
  // Supabase pooler rejects search_path as a startup parameter. Apply the
  // session setting after authentication so the same read-only audit works
  // against the canonical production connection.
  await client.query("SET search_path TO public");

  try {
    section("1. Kasbon/Talangan — entry_id merujuk jurnal yang hilang (dua arah)");
    await checkCashAdvanceEntryIntegrity();

    section("2. Kasbon/Talangan — VOID tanpa jurnal pembalik");
    await checkVoidWithoutReversal();

    section("3. accounting_payments — VOID tanpa jurnal pembalik");
    await checkPaymentVoidWithoutReversal();

    section("4. Jurnal tidak balance (debit != kredit)");
    await checkUnbalancedJournals();

    section("5. Posted entry tanpa entry_lines sama sekali");
    await checkEntriesWithoutLines();

    section("6. Pembayaran 'posted'/'paid' tanpa jurnal");
    await checkOrphanAccountingPayments();
    await checkVendorInvoicesPaidWithoutJournal();

    section("7. Jurnal kas/bank dengan source tidak valid");
    await checkCashBankJournalInvalidSource();

    section("8. Orphan journal — source_id eksplisit menunjuk row yang hilang");
    for (const m of ORPHAN_SOURCE_MAP) {
      console.log(`${DIM}  · source=${m.sourceTag} → ${m.table}.${m.idCol}${RESET}`);
      await checkOrphanJournalsForModule(m.sourceTag, m.table, m.idCol);
    }

    console.log(`\n${CYAN}── Ringkasan ──${RESET}`);
    if (findingsCount === 0) {
      console.log(`${GREEN}Semua pemeriksaan bersih. Tidak ada pelanggaran posting integrity terdeteksi.${RESET}`);
    } else {
      console.log(`${RED}Total ${findingsCount} temuan di seluruh pemeriksaan. Lihat detail di atas.${RESET}`);
    }
  } finally {
    await client.end().catch(() => {});
  }

  process.exitCode = findingsCount > 0 ? 1 : 0;
}

main().catch((err) => {
  console.error(`${RED}Audit script gagal dijalankan:${RESET}`, err);
  process.exitCode = 2;
});
