/**
 * Script: run-bank-mutation-post.ts
 * Jalankan via: npx tsx scripts/run-bank-mutation-post.ts
 *
 * Posting semua batch bank_mutation_imports yang masih DRAFT_IMPORT ke jurnal akuntansi.
 * Tidak butuh HTTP auth — langsung akses DB.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { postEntry } from "../src/lib/accounting.js";

// ── Normalisasi accounting_class ──────────────────────────────────────────────
const ACC_CLASS_NORMALIZE: Record<string, string> = {
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

const CLASS_MAP_FALLBACK: Record<string, { drCode: string; crCode: string }> = {
  REVENUE:           { drCode: "1-1020", crCode: "4-1020" },
  EXPENSE:           { drCode: "5-2040", crCode: "1-1020" },
  INTERNAL_TRANSFER: { drCode: "1-1020", crCode: "1-1020" },
  EMPLOYEE_ADVANCE:  { drCode: "1-1032", crCode: "1-1020" },
  INTERCOMPANY_LOAN: { drCode: "1-1031", crCode: "1-1020" },
  TAX_PAYMENT:       { drCode: "2-1020", crCode: "1-1020" },
  REIMBURSEMENT:     { drCode: "2-1010", crCode: "1-1020" },
};

function normClass(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const u = raw.trim().toUpperCase();
  return ACC_CLASS_NORMALIZE[u] ?? u;
}

async function resolveCoaId(codePrefix: string, companyId?: number | null): Promise<number | null> {
  const { rows } = await db.execute(sql.raw(
    `SELECT id FROM chart_of_accounts
     WHERE code LIKE '${codePrefix.replace(/'/g, "''")}%'
     ${companyId ? `AND (company_id = ${companyId} OR company_id IS NULL)` : ""}
     ORDER BY company_id DESC NULLS LAST, id ASC LIMIT 1`
  ));
  return rows.length ? (rows[0] as any).id : null;
}

async function resolveBankJournalId(): Promise<number | null> {
  const { rows } = await db.execute(sql.raw(
    `SELECT id FROM accounting_journals
     WHERE code IN ('BNK','BANK','GEN','JE','MISC')
        OR code LIKE 'BNK-%' OR code LIKE 'BANK-%'
     ORDER BY CASE WHEN code IN ('BNK','BANK','GEN','JE','MISC') THEN 0 ELSE 1 END, id ASC LIMIT 1`
  ));
  return rows.length ? (rows[0] as any).id : null;
}

async function resolveCoaMapping(erpCategory: string | null): Promise<{ coaCode: string; accountingClass: string } | null> {
  if (!erpCategory) return null;
  const { rows } = await db.execute(sql.raw(
    `SELECT coa_code, accounting_class FROM master_coa_mapping
     WHERE erp_category = '${erpCategory.replace(/'/g, "''")}' AND is_active = TRUE LIMIT 1`
  ));
  if (!rows.length) return null;
  return { coaCode: (rows[0] as any).coa_code, accountingClass: (rows[0] as any).accounting_class };
}

async function resolveBankCoaCode(bankAccountId: number | null, sourceAccount: string | null): Promise<string> {
  if (bankAccountId) {
    const { rows } = await db.execute(sql.raw(
      `SELECT coa_code FROM master_bank_accounts WHERE id = ${bankAccountId} AND is_active = TRUE LIMIT 1`
    ));
    if (rows.length && (rows[0] as any).coa_code) return (rows[0] as any).coa_code;
  }
  if (sourceAccount) {
    const { rows } = await db.execute(sql.raw(
      `SELECT coa_code FROM master_bank_accounts
       WHERE is_active = TRUE
         AND (account_name ILIKE '%${sourceAccount.replace(/'/g, "''")}%'
           OR bank_name ILIKE '%${sourceAccount.replace(/'/g, "''")}%')
       LIMIT 1`
    ));
    if (rows.length && (rows[0] as any).coa_code) return (rows[0] as any).coa_code;
  }
  return "1-1020";
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  await db.execute(sql.raw(`SET search_path TO public`));

  console.log("=== POSTING ENGINE — BANK MUTATION IMPORT ===\n");

  // 1. Ambil semua batch DRAFT_IMPORT
  const { rows: batches } = await db.execute(sql.raw(
    `SELECT id, filename, status, row_count, company_id FROM bank_mutation_import_batches
     WHERE status = 'DRAFT_IMPORT' ORDER BY id ASC`
  ));

  if (!batches.length) {
    console.log("✅ Tidak ada batch DRAFT_IMPORT. Semua sudah diposting.");
    process.exit(0);
  }

  console.log(`Ditemukan ${batches.length} batch DRAFT_IMPORT:\n`);
  for (const b of batches as any[]) {
    console.log(`  Batch #${b.id}: ${b.filename} (${b.row_count} rows)`);
  }

  // 2. Resolve journal ID sekali
  const journalId = await resolveBankJournalId();
  if (!journalId) {
    console.error("\n❌ FATAL: Tidak ditemukan jurnal bank (BNK/BANK/GEN). Abort.");
    process.exit(1);
  }
  console.log(`\n✅ Jurnal Bank ditemukan: ID=${journalId}\n`);

  let totalPosted = 0;
  let totalFailed = 0;
  let totalSkipped = 0;

  // 3. Proses tiap batch
  for (const batch of batches as any[]) {
    const batchId = batch.id;
    const companyId: number | null = batch.company_id ?? null;

    console.log(`\n─── Batch #${batchId}: ${batch.filename} ───`);

    // Ambil semua baris yang belum diposting
    const { rows: pendingRows } = await db.execute(sql.raw(`
      SELECT * FROM bank_mutation_imports
      WHERE import_batch_id = ${batchId}
        AND status != 'IMPORTED'
        AND journal_entry_id IS NULL
        AND accounting_class IS NOT NULL
      ORDER BY transaction_date ASC, id ASC
    `));

    console.log(`  Pending rows: ${pendingRows.length}`);

    // Normalisasi accounting_class di DB dulu
    let normalizedCount = 0;
    for (const r of pendingRows as any[]) {
      const norm = normClass(r.accounting_class);
      if (norm && norm !== r.accounting_class) {
        r.accounting_class = norm;
        await db.execute(sql.raw(
          `UPDATE bank_mutation_imports SET accounting_class = '${norm}' WHERE id = ${r.id}`
        ));
        normalizedCount++;
      }
    }
    if (normalizedCount > 0) {
      console.log(`  ✅ Normalized ${normalizedCount} baris accounting_class (INCOME→REVENUE, dst)`);
    }

    // Cek blocker setelah normalisasi
    const blockers = (pendingRows as any[]).filter(r => !VALID_ACC_CLASSES.has(r.accounting_class));
    if (blockers.length > 0) {
      const byClass: Record<string, number> = {};
      for (const r of blockers) byClass[r.accounting_class] = (byClass[r.accounting_class] ?? 0) + 1;
      console.log(`  ⚠️  ${blockers.length} baris tidak valid (dilewati):`);
      for (const [cls, cnt] of Object.entries(byClass)) {
        console.log(`       ${cls}: ${cnt} rows`);
      }
      totalSkipped += blockers.length;
    }

    const validRows = (pendingRows as any[]).filter(r => VALID_ACC_CLASSES.has(r.accounting_class));
    console.log(`  Rows yang akan diposting: ${validRows.length}`);
    if (!validRows.length) continue;

    let batchPosted = 0;
    let batchFailed = 0;

    for (const row of validRows) {
      try {
        const accClass = row.accounting_class as string;
        const erpCategory: string | null = row.erp_category ?? null;

        const masterMapping = await resolveCoaMapping(erpCategory);
        const resolvedClass = masterMapping?.accountingClass ?? accClass;
        const bankCoaCode = await resolveBankCoaCode(row.bank_account_id ?? null, row.source_account ?? null);

        let drCode: string;
        let crCode: string;

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
            batchFailed++;
            totalFailed++;
            if (batchFailed <= 3) console.log(`    ❌ Row ${row.id}: accounting_class '${resolvedClass}' tidak dikenal`);
            continue;
          }
          drCode = fb.drCode;
          crCode = fb.crCode;
        }

        const drAccId = await resolveCoaId(drCode, companyId);
        const crAccId = await resolveCoaId(crCode, companyId);

        if (!drAccId || !crAccId) {
          batchFailed++;
          totalFailed++;
          if (batchFailed <= 5) {
            console.log(`    ❌ Row ${row.id}: CoA tidak ditemukan dr=${drCode}(${drAccId}) cr=${crCode}(${crAccId}) class=${resolvedClass} cat=${erpCategory}`);
          }
          continue;
        }

        const creditAmt = Number(row.credit || 0);
        const debitAmt  = Number(row.debit  || 0);
        const amount    = creditAmt > 0 ? creditAmt : debitAmt;
        if (amount <= 0) {
          batchFailed++;
          totalFailed++;
          if (batchFailed <= 3) console.log(`    ❌ Row ${row.id}: amount nol/negatif (cr=${creditAmt}, dr=${debitAmt})`);
          continue;
        }

        const txDate = row.transaction_date ? new Date(row.transaction_date) : new Date();
        const entry = await postEntry(
          {
            journalId,
            date: txDate,
            description: row.description ?? null,
            ref: row.unique_key ?? null,
            source: "manual",
            companyId: companyId ?? 1,
            lines: [
              { accountId: drAccId, debit: amount, credit: 0, description: row.description ?? null },
              { accountId: crAccId, debit: 0, credit: amount, description: row.description ?? null },
            ],
          },
          "BNK",
        );

        await db.execute(sql.raw(
          `UPDATE bank_mutation_imports SET journal_entry_id = ${entry.id}, status = 'IMPORTED' WHERE id = ${row.id}`
        ));

        batchPosted++;
        totalPosted++;

        // Progress setiap 50 baris
        if (batchPosted % 50 === 0) {
          process.stdout.write(`    Posted ${batchPosted}/${validRows.length}...\r`);
        }
      } catch (e: any) {
        batchFailed++;
        totalFailed++;
        if (batchFailed <= 5) console.log(`    ❌ Row ${row.id}: ${e?.message ?? e}`);
      }
    }

    // Update status batch jika ada yang diposting
    if (batchPosted > 0) {
      await db.execute(sql.raw(
        `UPDATE bank_mutation_import_batches SET status = 'IMPORTED', updated_at = NOW() WHERE id = ${batchId}`
      ));
    }

    console.log(`  📊 Batch #${batchId}: posted=${batchPosted}, failed=${batchFailed}, skipped=${blockers.length}`);
  }

  // 4. Ringkasan akhir
  console.log(`\n${"=".repeat(50)}`);
  console.log(`RINGKASAN POSTING:`);
  console.log(`  ✅ Berhasil diposting : ${totalPosted} jurnal`);
  console.log(`  ❌ Gagal             : ${totalFailed} baris`);
  console.log(`  ⚠️  Dilewati (invalid): ${totalSkipped} baris`);
  console.log(`${"=".repeat(50)}\n`);

  // 5. Verifikasi akhir
  const { rows: verif } = await db.execute(sql.raw(`
    SELECT 
      COUNT(*) FILTER (WHERE journal_entry_id IS NOT NULL) AS posted,
      COUNT(*) FILTER (WHERE journal_entry_id IS NULL AND status != 'NEED_REVIEW') AS unposted,
      COUNT(*) FILTER (WHERE accounting_class = 'NEED_REVIEW') AS need_review
    FROM bank_mutation_imports
  `));
  const v = verif[0] as any;
  console.log(`VERIFIKASI DB:`);
  console.log(`  journal_entry_id IS NOT NULL : ${v.posted}`);
  console.log(`  journal_entry_id IS NULL     : ${v.unposted} (diluar NEED_REVIEW)`);
  console.log(`  NEED_REVIEW                  : ${v.need_review}`);

  process.exit(0);
}

main().catch(e => {
  console.error("Fatal error:", e);
  process.exit(1);
});
