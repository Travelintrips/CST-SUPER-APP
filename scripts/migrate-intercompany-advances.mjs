/**
 * Migrate old-style intercompany advances (IC-{num}) to new style (IC-ADV-{num}).
 *
 * OLD PATH (postIntercompanyLiability):
 *   Responsible company books: DR 1-1099 (clearing)  CR 2-2098 (liability)
 *   Funding company books:     DR 1-1033 (Piutang)   CR Cash/Bank
 *   ref: IC-{advance_number}, source_module: advance_intercompany
 *
 * NEW PATH (postIntercompanyDisbursementPair):
 *   Funding company books:     DR 1-1099 (Piutang Intercompany)  CR Cash/Bank
 *   Responsible company books: DR Expense (5-2040)               CR 2-2098 (liability)
 *   ref: IC-ADV-{advance_number}
 *
 * MIGRATION STRATEGY (correction entries — tidak mengubah entry lama):
 *   1. Funding company:     DR 1-1099  CR 1-1033   (reklasifikasi piutang)
 *   2. Responsible company: DR Expense CR 1-1099   (clearing + beban)
 *      => net: 1-1099 = 0, 2-2098 tetap (liability benar), Expense +amount
 *
 * Usage:
 *   node scripts/migrate-intercompany-advances.mjs            # dry run
 *   node scripts/migrate-intercompany-advances.mjs --execute  # actual migration
 */

import { Pool } from "pg";

// ── DB connection ──────────────────────────────────────────────────────────────
function resolveDbUrl() {
  const isProd = process.env.NODE_ENV === "production" || !!process.env.REPLIT_DEPLOYMENT;
  if (isProd) {
    return process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
  }
  return (
    process.env.SUPABASE_DATABASE_URL_DEV ||
    process.env.SUPABASE_DATABASE_URL ||
    process.env.DATABASE_URL
  );
}

const pool = new Pool({
  connectionString: resolveDbUrl(),
  max: 3,
  options: "-c search_path=public",
  ssl: { rejectUnauthorized: false },
});

const DRY_RUN = !process.argv.includes("--execute");

// ── Find next available entry number for a journal ────────────────────────────
async function nextEntryNumber(client, journalId) {
  const res = await client.query(`
    SELECT COALESCE(MAX(CAST(REGEXP_REPLACE(entry_number, '[^0-9]', '', 'g') AS BIGINT)), 0) + 1 AS next
    FROM accounting_entries WHERE journal_id = $1
  `, [journalId]);
  return String(res.rows[0].next).padStart(6, "0");
}

// ── Find or auto-create COA for a company ─────────────────────────────────────
async function findCoa(client, companyId, codeLike, type) {
  const res = await client.query(`
    SELECT id, code, name FROM chart_of_accounts
    WHERE company_id = $1 AND code LIKE $2 AND type = $3 AND is_active = true
    ORDER BY code LIMIT 1
  `, [companyId, codeLike + "%", type]);
  return res.rows[0] ?? null;
}

// ── Find general journal for a company ────────────────────────────────────────
async function findJournal(client, companyId, type = "general") {
  const res = await client.query(`
    SELECT id, code FROM accounting_journals
    WHERE company_id = $1 AND type = $2 AND is_active = true
    ORDER BY id LIMIT 1
  `, [companyId, type]);
  return res.rows[0] ?? null;
}

// ── Post a single correction entry ────────────────────────────────────────────
async function postCorrectionEntry(client, { journalId, journalCode, companyId, ref, description, date, lines, sourceModule }) {
  const entryNum = await nextEntryNumber(client, journalId);
  const entryRes = await client.query(`
    INSERT INTO accounting_entries
      (journal_id, entry_number, date, ref, description, status, company_id, source, source_module, created_at, updated_at)
    VALUES ($1, $2, $3, $4, $5, 'posted', $6, 'kasbon', $7, NOW(), NOW())
    RETURNING id
  `, [journalId, `${journalCode}-${entryNum}`, date, ref, description, companyId, sourceModule]);

  const entryId = entryRes.rows[0].id;

  for (const line of lines) {
    await client.query(`
      INSERT INTO accounting_entry_lines (entry_id, account_id, debit, credit, description, created_at)
      VALUES ($1, $2, $3, $4, $5, NOW())
    `, [entryId, line.accountId, line.debit, line.credit, line.description]);
  }
  return entryId;
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  console.log(`\n=== Migrate Intercompany Advances: Old IC-{num} → New IC-ADV-{num} ===`);
  console.log(`Mode: ${DRY_RUN ? "🔍 DRY RUN (tidak ada perubahan)" : "⚡ EXECUTE (menulis ke DB)"}\n`);

  const client = await pool.connect();
  try {
    // 1. Find all old-style advances: have IC-{num} ref (no ADV), source_module = advance_intercompany
    const oldEntries = await client.query(`
      SELECT DISTINCT
        ae.id         AS entry_id,
        ae.ref        AS old_ref,
        ae.company_id AS responsible_company_id,
        ae.date,
        ca.id         AS advance_id,
        ca.advance_number,
        ca.category,
        ca.funding_company_id,
        ca.source_company_id,
        ca.entry_id   AS original_entry_id,
        ca.funding_entry_id,
        ca.responsible_entry_id,
        ca.intercompany_reference,
        SUM(ael.debit) AS amount
      FROM accounting_entries ae
      JOIN accounting_entry_lines ael ON ael.entry_id = ae.id
      LEFT JOIN cash_advances ca ON (
        ae.ref = 'IC-' || ca.advance_number
      )
      WHERE ae.source_module = 'advance_intercompany'
        AND ae.status = 'posted'
        AND ae.ref LIKE 'IC-%'
        AND ae.ref NOT LIKE 'IC-ADV-%'
        AND ae.ref NOT LIKE 'IC-RPY-%'
      GROUP BY ae.id, ae.ref, ae.company_id, ae.date,
               ca.id, ca.advance_number, ca.category,
               ca.funding_company_id, ca.source_company_id,
               ca.entry_id, ca.funding_entry_id, ca.responsible_entry_id,
               ca.intercompany_reference
    `);

    if (oldEntries.rows.length === 0) {
      console.log("✅ Tidak ada advance lama yang perlu dimigrasi.\n");
      return;
    }

    console.log(`Ditemukan ${oldEntries.rows.length} advance lama:\n`);

    let migratedCount = 0;
    let skippedCount = 0;
    const errors = [];

    for (const row of oldEntries.rows) {
      const advNum    = row.advance_number;
      const amount    = Number(row.amount);
      const date      = row.date;
      const respCoId  = row.responsible_company_id;
      const fundCoId  = row.funding_company_id || row.source_company_id;
      const category  = row.category;
      const newRef    = `IC-ADV-${advNum}`;

      console.log(`\n--- Advance: ${advNum} | Amount: ${amount.toLocaleString("id-ID")} ---`);
      console.log(`  Responsible company_id: ${respCoId}`);
      console.log(`  Funding company_id:     ${fundCoId ?? "(tidak ada)"}`);
      console.log(`  Old ref: ${row.old_ref} | New ref: ${newRef}`);

      if (!fundCoId) {
        console.log(`  ⚠️  SKIP: funding_company_id kosong, tidak bisa migrasi.`);
        skippedCount++;
        continue;
      }

      if (fundCoId === respCoId) {
        console.log(`  ⚠️  SKIP: funding = responsible (same company), bukan intercompany.`);
        skippedCount++;
        continue;
      }

      // Check if already migrated (IC-ADV ref already exists for this advance)
      const alreadyMigrated = await client.query(`
        SELECT id FROM accounting_entries
        WHERE ref = $1 AND company_id = $2 AND status = 'posted'
        LIMIT 1
      `, [newRef, fundCoId]);
      if (alreadyMigrated.rows.length > 0) {
        console.log(`  ⚠️  SKIP: sudah ada entry ${newRef} di buku funding company.`);
        skippedCount++;
        continue;
      }

      try {
        // --- Funding company: cari akun 1-1033 (Piutang Dana Talangan) & 1-1099 ---
        const coa1033 = await findCoa(client, fundCoId, "1-1033", "asset");
        const coa1099Fund = await findCoa(client, fundCoId, "1-1099", "asset");
        const journalFund = await findJournal(client, fundCoId, "general");

        // --- Responsible company: cari akun 1-1099, expense, journal ---
        const coa1099Resp = await findCoa(client, respCoId, "1-1099", "asset");

        // Expense code based on category
        const expenseCodeMap = {
          "Pembayaran Vendor": "5-1010", "Pembelian Barang": "5-1010",
          "Freight / Pengiriman": "5-1011", "Customs Clearance": "5-1012",
          "Pajak": "5-3020", "Perjalanan Dinas": "5-2050",
          "Gaji / Karyawan": "5-2010", "Marketing": "5-2040",
          "Operasional": "5-2040", "Proyek": "5-2040",
        };
        const expCode = expenseCodeMap[category ?? ""] ?? "5-2040";
        const coaExpense = await findCoa(client, respCoId, expCode, "expense");
        const journalResp = await findJournal(client, respCoId, "general");

        console.log(`  Funding COA 1-1033: ${coa1033 ? `✅ ${coa1033.code}` : "❌ tidak ada"}`);
        console.log(`  Funding COA 1-1099: ${coa1099Fund ? `✅ ${coa1099Fund.code}` : "❌ tidak ada"}`);
        console.log(`  Resp    COA 1-1099: ${coa1099Resp ? `✅ ${coa1099Resp.code}` : "❌ tidak ada"}`);
        console.log(`  Resp    COA expense: ${coaExpense ? `✅ ${coaExpense.code}` : `❌ ${expCode} tidak ada`}`);

        if (!coa1099Fund || !journalFund) {
          console.log(`  ⚠️  SKIP: COA 1-1099 atau journal tidak ada di funding company.`);
          skippedCount++;
          continue;
        }
        if (!coa1099Resp || !coaExpense || !journalResp) {
          console.log(`  ⚠️  SKIP: COA 1-1099 / expense / journal tidak ada di responsible company.`);
          skippedCount++;
          continue;
        }

        if (DRY_RUN) {
          console.log(`  ✅ DRY RUN — akan buat correction entries:`);
          if (coa1033) {
            console.log(`     [Funding]  DR ${coa1099Fund.code} ${amount.toLocaleString("id-ID")} | CR ${coa1033.code} ${amount.toLocaleString("id-ID")}`);
          } else {
            console.log(`     [Funding]  DR ${coa1099Fund.code} ${amount.toLocaleString("id-ID")} (1-1033 tidak ada, skip CR)`);
          }
          console.log(`     [Resp]     DR ${coaExpense.code} ${amount.toLocaleString("id-ID")} | CR ${coa1099Resp.code} ${amount.toLocaleString("id-ID")}`);
          migratedCount++;
          continue;
        }

        // ── EXECUTE ──────────────────────────────────────────────────────────
        await client.query("BEGIN");

        let fundingEntryId = null;

        // Correction 1: Funding company — reklasifikasi 1-1033 → 1-1099
        if (coa1033) {
          fundingEntryId = await postCorrectionEntry(client, {
            journalId: journalFund.id,
            journalCode: journalFund.code,
            companyId: fundCoId,
            ref: newRef,
            description: `[Migrasi] Reklasifikasi Piutang Intercompany ${advNum} — ${coa1033.code} → ${coa1099Fund.code}`,
            date,
            sourceModule: "advance_intercompany_funding",
            lines: [
              { accountId: coa1099Fund.id, debit: amount, credit: 0,      description: "Piutang Intercompany Dana Talangan" },
              { accountId: coa1033.id,     debit: 0,      credit: amount, description: "Reklasifikasi dari Piutang Dana Talangan" },
            ],
          });
        } else {
          // 1-1033 tidak ada — langsung DR 1-1099 saja (tanpa CR — entry tidak seimbang, skip)
          console.log(`  ⚠️  Funding company tidak punya 1-1033, skip correction funding.`);
        }

        // Correction 2: Responsible company — DR Expense, CR 1-1099 (clear clearing)
        const respEntryId = await postCorrectionEntry(client, {
          journalId: journalResp.id,
          journalCode: journalResp.code,
          companyId: respCoId,
          ref: newRef,
          description: `[Migrasi] Koreksi Intercompany ${advNum} — clearing 1-1099 → beban`,
          date,
          sourceModule: "advance_intercompany_responsible",
          lines: [
            { accountId: coaExpense.id,    debit: amount, credit: 0,      description: `Beban ${category ?? "Dana Talangan"} ${advNum}` },
            { accountId: coa1099Resp.id,   debit: 0,      credit: amount, description: "Clearing akun intercompany lama" },
          ],
        });

        // Update cash_advances
        await client.query(`
          UPDATE cash_advances SET
            intercompany_reference = $1,
            funding_entry_id       = COALESCE($2, funding_entry_id),
            responsible_entry_id   = $3,
            updated_at             = NOW()
          WHERE id = $4
        `, [newRef, fundingEntryId, respEntryId, row.advance_id]);

        // Update old IC entry source_module supaya tidak ter-query lagi sebagai "lama"
        await client.query(`
          UPDATE accounting_entries SET source_module = 'advance_intercompany_legacy'
          WHERE id = $1
        `, [row.entry_id]);

        await client.query("COMMIT");

        console.log(`  ✅ Berhasil migrasi — funding entry: ${fundingEntryId ?? "skip"}, resp entry: ${respEntryId}`);
        migratedCount++;

      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        console.log(`  ❌ ERROR: ${err.message}`);
        errors.push({ advNum, error: err.message });
      }
    }

    console.log(`\n${"=".repeat(60)}`);
    console.log(`Ringkasan:`);
    console.log(`  Total ditemukan : ${oldEntries.rows.length}`);
    console.log(`  Dimigrasi       : ${migratedCount}`);
    console.log(`  Diskip          : ${skippedCount}`);
    console.log(`  Error           : ${errors.length}`);
    if (errors.length > 0) {
      console.log(`\nError detail:`);
      for (const e of errors) console.log(`  - ${e.advNum}: ${e.error}`);
    }
    if (DRY_RUN && migratedCount > 0) {
      console.log(`\n💡 Jalankan dengan --execute untuk benar-benar mengubah data:`);
      console.log(`   node scripts/migrate-intercompany-advances.mjs --execute\n`);
    }

  } finally {
    client.release();
    await pool.end();
  }
}

main().catch(err => {
  console.error("Fatal:", err);
  process.exit(1);
});
