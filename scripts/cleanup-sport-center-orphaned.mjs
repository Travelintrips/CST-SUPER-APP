/**
 * One-time cleanup: hapus accounting_payments & accounting_entries sport_center
 * yang data sumber-nya (sport_payments / sport_bookings) sudah tidak ada.
 *
 * Run: node scripts/cleanup-sport-center-orphaned.mjs [--execute]
 * Default: dry run (hanya laporan, tidak hapus)
 * Tambahkan --execute untuk benar-benar menghapus.
 */

import pg from "pg";
import { resolveSupabaseDatabaseUrl } from "./resolve-supabase-db-url.mjs";

const dryRun = !process.argv.includes("--execute");
const { url: connStr } = resolveSupabaseDatabaseUrl();

const client = new pg.Client({
  connectionString: connStr,
  ssl: { rejectUnauthorized: false },
});
await client.connect();
// Set search_path untuk pgBouncer (transaction mode)
await client.query("SET search_path TO public");

console.log(`\n=== Sport Center Accounting Cleanup (${dryRun ? "DRY RUN" : "EXECUTE"}) ===\n`);

// 1. PAY/ entries orphaned (source_doc_id tidak ada di public.sport_payments)
const orphanedPayRes = await client.query(`
  SELECT ap.id, ap.payment_number, ap.partner_name, ap.amount::text, ap.date::text, ap.source_doc_id
  FROM accounting_payments ap
  WHERE ap.source_type = 'sport_center'
    AND ap.source_doc_id IS NOT NULL
    AND ap.payment_number NOT LIKE 'SCPAY%'
    AND NOT EXISTS (
      SELECT 1 FROM sport_payments sp WHERE sp.id = ap.source_doc_id
    )
  ORDER BY ap.date DESC
`);

// 2. SCPAY/ entries orphaned (source_doc_id tidak ada di sport_center.sport_payments)
let orphanedScpayRows = [];
try {
  const orphanedScpayRes = await client.query(`
    SELECT ap.id, ap.payment_number, ap.partner_name, ap.amount::text, ap.date::text, ap.source_doc_id
    FROM accounting_payments ap
    WHERE ap.source_type = 'sport_center'
      AND ap.source_doc_id IS NOT NULL
      AND ap.payment_number LIKE 'SCPAY%'
      AND NOT EXISTS (
        SELECT 1 FROM sport_center.sport_payments sp WHERE sp.id = ap.source_doc_id
      )
    ORDER BY ap.date DESC
  `);
  orphanedScpayRows = orphanedScpayRes.rows;
} catch (e) {
  console.warn("WARN: sport_center schema tidak accessible, skip SCPAY check:", e.message);
}

// 3. accounting_entries orphaned (booking_id tidak ada di sport_bookings)
const orphanedAeRes = await client.query(`
  SELECT ae.id, ae.source, ae.source_id, ae.date::text, ae.total_debit::text
  FROM accounting_entries ae
  WHERE ae.source IN ('sport_center_booking', 'sport_center_booking_reversal')
    AND ae.source_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM sport_bookings sb WHERE sb.id = ae.source_id
    )
  ORDER BY ae.date DESC
`);

const allOrphanedAp = [...orphanedPayRes.rows, ...orphanedScpayRows];
const allOrphanedAe = orphanedAeRes.rows;

console.log(`Ditemukan ${allOrphanedAp.length} accounting_payments orphaned:`);
for (const row of allOrphanedAp) {
  console.log(`  [${row.payment_number}] ${row.partner_name} | ${row.amount} | ${row.date} | source_doc_id=${row.source_doc_id}`);
}

console.log(`\nDitemukan ${allOrphanedAe.length} accounting_entries orphaned:`);
for (const row of allOrphanedAe) {
  console.log(`  id=${row.id} source=${row.source} source_id=${row.source_id} | ${row.total_debit} | ${row.date}`);
}

if (dryRun) {
  console.log("\n[DRY RUN] Tidak ada yang dihapus. Jalankan dengan --execute untuk menghapus.");
} else {
  let deletedAp = 0;
  let deletedAe = 0;

  if (allOrphanedAp.length > 0) {
    const apIds = allOrphanedAp.map((r) => r.id);
    const result = await client.query(
      `DELETE FROM accounting_payments WHERE id = ANY($1::int[])`,
      [apIds]
    );
    deletedAp = result.rowCount ?? 0;
    console.log(`\n✓ Dihapus ${deletedAp} accounting_payments`);
  }

  if (allOrphanedAe.length > 0) {
    const aeIds = allOrphanedAe.map((r) => r.id);
    // Harus disable trigger (blok delete posted) dalam transaksi terpisah
    await client.query("BEGIN");
    try {
      await client.query("ALTER TABLE accounting_entries DISABLE TRIGGER trg_block_posted_delete");
      await client.query(`DELETE FROM gl_journal_bridge WHERE accounting_entry_id = ANY($1::int[])`, [aeIds]).catch(() => {});
      const result = await client.query(
        `DELETE FROM accounting_entries WHERE id = ANY($1::int[])`,
        [aeIds]
      );
      deletedAe = result.rowCount ?? 0;
      await client.query("ALTER TABLE accounting_entries ENABLE TRIGGER trg_block_posted_delete");
      await client.query("COMMIT");
      console.log(`✓ Dihapus ${deletedAe} accounting_entries`);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    }
  }

  if (deletedAp === 0 && deletedAe === 0) {
    console.log("\nTidak ada data orphaned yang perlu dihapus.");
  }
}

await client.end();
console.log("\nSelesai.");
