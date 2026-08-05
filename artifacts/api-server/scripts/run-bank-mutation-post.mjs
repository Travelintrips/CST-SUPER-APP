/**
 * Script: run-bank-mutation-post.mjs
 * Jalankan: node scripts/run-bank-mutation-post.mjs
 *
 * Posting semua batch bank_mutation_imports DRAFT_IMPORT ke jurnal akuntansi.
 * Pakai raw pg — tidak butuh TS compile atau HTTP auth.
 */

import pg from "/home/runner/workspace/node_modules/pg/lib/index.js";
const { Pool } = pg;

// ── DB connection ─────────────────────────────────────────────────────────────
const DB_URL = process.env.SUPABASE_DATABASE_URL || process.env.DATABASE_URL;
if (!DB_URL) { console.error("❌ SUPABASE_DATABASE_URL tidak diset"); process.exit(1); }

const pool = new Pool({
  connectionString: DB_URL,
  max: 3,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
});

async function q(sql, params = []) {
  const client = await pool.connect();
  try {
    return await client.query(sql, params);
  } finally {
    client.release();
  }
}

// ── Normalisasi ───────────────────────────────────────────────────────────────
const ACC_CLASS_NORMALIZE = {
  INCOME: "REVENUE",
  TRANSFER: "INTERNAL_TRANSFER",
  LIABILITY_SETTLEMENT: "REIMBURSEMENT",
  ASSET: "REIMBURSEMENT",
  REVENUE: "REVENUE",
  EXPENSE: "EXPENSE",
  INTERNAL_TRANSFER: "INTERNAL_TRANSFER",
  EMPLOYEE_ADVANCE: "EMPLOYEE_ADVANCE",
  INTERCOMPANY_LOAN: "INTERCOMPANY_LOAN",
  TAX_PAYMENT: "TAX_PAYMENT",
  REIMBURSEMENT: "REIMBURSEMENT",
};

const VALID_ACC_CLASSES = new Set([
  "REVENUE", "EXPENSE", "INTERNAL_TRANSFER", "EMPLOYEE_ADVANCE",
  "INTERCOMPANY_LOAN", "TAX_PAYMENT", "REIMBURSEMENT",
]);

const CLASS_MAP_FALLBACK = {
  REVENUE:           { drCode: "1-1020", crCode: "4-1020" },
  EXPENSE:           { drCode: "5-2040", crCode: "1-1020" },
  INTERNAL_TRANSFER: { drCode: "1-1020", crCode: "1-1020" },
  EMPLOYEE_ADVANCE:  { drCode: "1-1032", crCode: "1-1020" },
  INTERCOMPANY_LOAN: { drCode: "1-1031", crCode: "1-1020" },
  TAX_PAYMENT:       { drCode: "2-1020", crCode: "1-1020" },
  REIMBURSEMENT:     { drCode: "2-1010", crCode: "1-1020" },
};

function normClass(raw) {
  if (!raw) return null;
  const u = raw.trim().toUpperCase();
  return ACC_CLASS_NORMALIZE[u] ?? u;
}

// ── Resolvers ─────────────────────────────────────────────────────────────────
async function resolveCoaId(codePrefix, companyId) {
  const compFilter = companyId
    ? `AND (company_id = ${Number(companyId)} OR company_id IS NULL)`
    : "";
  const r = await q(
    `SELECT id FROM chart_of_accounts
     WHERE code LIKE $1
     ${compFilter}
     ORDER BY company_id DESC NULLS LAST, id ASC LIMIT 1`,
    [`${codePrefix}%`]
  );
  return r.rows[0]?.id ?? null;
}

async function resolveBankJournalId() {
  const r = await q(
    `SELECT id FROM accounting_journals
     WHERE code IN ('BNK','BANK','GEN','JE','MISC')
        OR code LIKE 'BNK-%' OR code LIKE 'BANK-%'
     ORDER BY CASE WHEN code IN ('BNK','BANK','GEN','JE','MISC') THEN 0 ELSE 1 END, id ASC LIMIT 1`
  );
  return r.rows[0]?.id ?? null;
}

async function resolveCoaMapping(erpCategory) {
  if (!erpCategory) return null;
  const r = await q(
    `SELECT coa_code, accounting_class FROM master_coa_mapping
     WHERE erp_category = $1 AND is_active = TRUE LIMIT 1`,
    [erpCategory]
  );
  if (!r.rows.length) return null;
  return { coaCode: r.rows[0].coa_code, accountingClass: r.rows[0].accounting_class };
}

async function resolveBankCoaCode(bankAccountId, sourceAccount) {
  if (bankAccountId) {
    const r = await q(
      `SELECT coa_code FROM master_bank_accounts WHERE id = $1 AND is_active = TRUE LIMIT 1`,
      [bankAccountId]
    );
    if (r.rows[0]?.coa_code) return r.rows[0].coa_code;
  }
  if (sourceAccount) {
    const r = await q(
      `SELECT coa_code FROM master_bank_accounts
       WHERE is_active = TRUE
         AND (account_name ILIKE $1 OR bank_name ILIKE $1)
       LIMIT 1`,
      [`%${sourceAccount}%`]
    );
    if (r.rows[0]?.coa_code) return r.rows[0].coa_code;
  }
  return "1-1020";
}

// ── postEntry — implementasi inline (tanpa import accounting.ts) ───────────────
// Duplikasi minimal dari postEntry: buat accounting_entry + 2 lines, auto entry_number
async function postEntryInline({ journalId, date, description, ref, source, companyId, lines }) {
  // Generate entry_number: <journal_code>/<YYYY>/<seq>
  const jRes = await q(`SELECT code FROM accounting_journals WHERE id = $1`, [journalId]);
  const jCode = jRes.rows[0]?.code ?? "BNK";
  const year = date.getFullYear();

  const seqRes = await q(
    `SELECT COALESCE(MAX(sequence_number), 0) + 1 AS next_seq
     FROM accounting_entries
     WHERE journal_id = $1 AND EXTRACT(YEAR FROM entry_date) = $2`,
    [journalId, year]
  );
  const seqNum = seqRes.rows[0].next_seq;
  const entryNumber = `${jCode}/${year}/${String(seqNum).padStart(6, "0")}`;

  // Insert entry
  const entryRes = await q(
    `INSERT INTO accounting_entries
       (journal_id, entry_date, entry_number, description, reference, source, company_id, status,
        sequence_number, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'posted', $8, NOW(), NOW())
     RETURNING id, entry_number`,
    [journalId, date, entryNumber, description ?? null, ref ?? null, source ?? "manual", companyId ?? 1, seqNum]
  );
  const entryId = entryRes.rows[0].id;

  // Insert 2 lines
  for (const line of lines) {
    await q(
      `INSERT INTO accounting_entry_lines
         (entry_id, account_id, debit, credit, description, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())`,
      [entryId, line.accountId, line.debit ?? 0, line.credit ?? 0, line.description ?? null]
    );
  }

  return { id: entryId, entry_number: entryNumber };
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  await q(`SET search_path TO public`);

  console.log("=== POSTING ENGINE — BANK MUTATION IMPORT ===\n");

  // 1. Semua batch DRAFT_IMPORT
  const batchRes = await q(
    `SELECT id, filename, status, row_count, company_id FROM bank_mutation_import_batches
     WHERE status = 'DRAFT_IMPORT' ORDER BY id ASC`
  );
  const batches = batchRes.rows;

  if (!batches.length) {
    console.log("✅ Tidak ada batch DRAFT_IMPORT.");
    await pool.end();
    return;
  }
  console.log(`Ditemukan ${batches.length} batch DRAFT_IMPORT:`);
  for (const b of batches) console.log(`  Batch #${b.id}: ${b.filename} (${b.row_count} rows)`);

  // 2. Journal bank
  const journalId = await resolveBankJournalId();
  if (!journalId) {
    console.error("\n❌ FATAL: Tidak ditemukan jurnal bank. Pastikan Chart of Accounts sudah disetup.");
    await pool.end(); process.exit(1);
  }
  console.log(`\n✅ Jurnal Bank ID=${journalId}\n`);

  let totalPosted = 0, totalFailed = 0, totalSkipped = 0;
  const allErrors = [];

  for (const batch of batches) {
    const batchId = Number(batch.id);
    const companyId = batch.company_id ? Number(batch.company_id) : null;
    console.log(`\n─── Batch #${batchId}: ${batch.filename} ───`);

    // Ambil pending rows
    const rowRes = await q(
      `SELECT * FROM bank_mutation_imports
       WHERE import_batch_id = $1
         AND status != 'IMPORTED'
         AND journal_entry_id IS NULL
         AND accounting_class IS NOT NULL
       ORDER BY transaction_date ASC, id ASC`,
      [batchId]
    );
    const pending = rowRes.rows;
    console.log(`  Pending: ${pending.length} rows`);
    if (!pending.length) continue;

    // Normalisasi accounting_class (in-memory + DB update)
    let normCount = 0;
    for (const r of pending) {
      const norm = normClass(r.accounting_class);
      if (norm && norm !== r.accounting_class) {
        await q(`UPDATE bank_mutation_imports SET accounting_class = $1 WHERE id = $2`, [norm, r.id]);
        r.accounting_class = norm;
        normCount++;
      }
    }
    if (normCount) console.log(`  ✅ Normalized ${normCount} baris (INCOME→REVENUE, dst)`);

    // Filter valid
    const invalid = pending.filter(r => !VALID_ACC_CLASSES.has(r.accounting_class));
    const valid   = pending.filter(r =>  VALID_ACC_CLASSES.has(r.accounting_class));

    if (invalid.length) {
      const byClass = {};
      for (const r of invalid) byClass[r.accounting_class] = (byClass[r.accounting_class] ?? 0) + 1;
      console.log(`  ⚠️  ${invalid.length} baris tidak valid (dilewati): ${JSON.stringify(byClass)}`);
      totalSkipped += invalid.length;
    }
    console.log(`  Akan diposting: ${valid.length} rows`);
    if (!valid.length) continue;

    let batchPosted = 0, batchFailed = 0;

    for (let i = 0; i < valid.length; i++) {
      const row = valid[i];
      try {
        const accClass = row.accounting_class;
        const erpCategory = row.erp_category ?? null;

        const masterMapping = await resolveCoaMapping(erpCategory);
        const resolvedClass = masterMapping?.accountingClass ?? accClass;
        const bankCoaCode   = await resolveBankCoaCode(row.bank_account_id ?? null, row.source_account ?? null);

        let drCode, crCode;

        if (resolvedClass === "REVENUE") {
          drCode = bankCoaCode;
          crCode = masterMapping?.coaCode ?? CLASS_MAP_FALLBACK.REVENUE.crCode;
        } else if (resolvedClass === "EXPENSE") {
          drCode = masterMapping?.coaCode ?? CLASS_MAP_FALLBACK.EXPENSE.drCode;
          crCode = bankCoaCode;
        } else if (resolvedClass === "TAX_PAYMENT") {
          drCode = masterMapping?.coaCode ?? CLASS_MAP_FALLBACK.TAX_PAYMENT.drCode;
          crCode = bankCoaCode;
        } else if (resolvedClass === "REIMBURSEMENT") {
          if (erpCategory === "REIMBURSEMENT_PAYMENT") {
            drCode = masterMapping?.coaCode ?? "2-1010";
            crCode = bankCoaCode;
          } else {
            drCode = bankCoaCode;
            crCode = masterMapping?.coaCode ?? "1-1031";
          }
        } else if (resolvedClass === "INTERCOMPANY_LOAN") {
          drCode = masterMapping?.coaCode ?? CLASS_MAP_FALLBACK.INTERCOMPANY_LOAN.drCode;
          crCode = bankCoaCode;
        } else if (resolvedClass === "INTERNAL_TRANSFER") {
          drCode = masterMapping?.coaCode ?? CLASS_MAP_FALLBACK.INTERNAL_TRANSFER.drCode;
          crCode = bankCoaCode;
        } else if (resolvedClass === "EMPLOYEE_ADVANCE") {
          drCode = masterMapping?.coaCode ?? CLASS_MAP_FALLBACK.EMPLOYEE_ADVANCE.drCode;
          crCode = bankCoaCode;
        } else {
          const fb = CLASS_MAP_FALLBACK[resolvedClass];
          if (!fb) {
            batchFailed++; totalFailed++;
            allErrors.push({ id: row.id, reason: `class '${resolvedClass}' tidak dikenal` });
            continue;
          }
          drCode = fb.drCode; crCode = fb.crCode;
        }

        const drAccId = await resolveCoaId(drCode, companyId);
        const crAccId = await resolveCoaId(crCode, companyId);

        if (!drAccId || !crAccId) {
          batchFailed++; totalFailed++;
          allErrors.push({
            id: row.id,
            reason: `CoA tidak ditemukan: dr=${drCode}(${drAccId}) cr=${crCode}(${crAccId}) class=${resolvedClass} cat=${erpCategory}`,
          });
          continue;
        }

        const creditAmt = Number(row.credit || 0);
        const debitAmt  = Number(row.debit  || 0);
        const amount    = creditAmt > 0 ? creditAmt : debitAmt;
        if (amount <= 0) {
          batchFailed++; totalFailed++;
          allErrors.push({ id: row.id, reason: `amount nol/negatif (cr=${creditAmt}, dr=${debitAmt})` });
          continue;
        }

        const txDate = row.transaction_date ? new Date(row.transaction_date) : new Date();
        const entry = await postEntryInline({
          journalId,
          date: txDate,
          description: row.description ?? null,
          ref: row.unique_key ?? null,
          source: "manual",
          companyId: companyId ?? 1,
          lines: [
            { accountId: drAccId, debit: amount,  credit: 0,      description: row.description ?? null },
            { accountId: crAccId, debit: 0,        credit: amount, description: row.description ?? null },
          ],
        });

        await q(
          `UPDATE bank_mutation_imports SET journal_entry_id = $1, status = 'IMPORTED' WHERE id = $2`,
          [entry.id, row.id]
        );

        batchPosted++; totalPosted++;
        if (batchPosted % 50 === 0) process.stdout.write(`    Posted ${batchPosted}/${valid.length}...\r`);

      } catch (e) {
        batchFailed++; totalFailed++;
        allErrors.push({ id: row.id, reason: e?.message ?? String(e) });
        if (batchFailed <= 5) console.log(`    ❌ Row ${row.id}: ${e?.message ?? e}`);
      }
    }

    if (batchPosted > 0) {
      await q(
        `UPDATE bank_mutation_import_batches SET status = 'IMPORTED', updated_at = NOW() WHERE id = $1`,
        [batchId]
      );
    }
    console.log(`  📊 Batch #${batchId}: posted=${batchPosted}, failed=${batchFailed}, skipped=${invalid.length}`);
  }

  // 4. Ringkasan
  console.log(`\n${"=".repeat(55)}`);
  console.log(`RINGKASAN POSTING:`);
  console.log(`  ✅ Berhasil diposting  : ${totalPosted} jurnal`);
  console.log(`  ❌ Gagal               : ${totalFailed} baris`);
  console.log(`  ⚠️  Dilewati (invalid)  : ${totalSkipped} baris`);
  if (allErrors.length > 0) {
    console.log(`\nSAMPLE ERRORS (maks 10):`);
    for (const e of allErrors.slice(0, 10)) console.log(`  Row ${e.id}: ${e.reason}`);
  }
  console.log(`${"=".repeat(55)}\n`);

  // 5. Verifikasi DB
  const verifRes = await q(`
    SELECT
      COUNT(*) FILTER (WHERE journal_entry_id IS NOT NULL) AS posted,
      COUNT(*) FILTER (WHERE journal_entry_id IS NULL AND accounting_class != 'NEED_REVIEW') AS unposted,
      COUNT(*) FILTER (WHERE accounting_class = 'NEED_REVIEW') AS need_review
    FROM bank_mutation_imports
  `);
  const v = verifRes.rows[0];
  console.log(`VERIFIKASI DB FINAL:`);
  console.log(`  journal_entry_id IS NOT NULL : ${v.posted}`);
  console.log(`  journal_entry_id IS NULL     : ${v.unposted} (di luar NEED_REVIEW)`);
  console.log(`  NEED_REVIEW                  : ${v.need_review}`);

  await pool.end();
}

main().catch(e => { console.error("Fatal:", e); pool.end(); process.exit(1); });
