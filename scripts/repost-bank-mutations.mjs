/**
 * Standalone repost script — bypass HTTP auth, langsung ke DB.
 * Jalankan: node scripts/repost-bank-mutations.mjs
 */
import pg from "pg";
import { resolveSupabaseDatabaseUrl } from "./resolve-supabase-db-url.mjs";

const { Pool } = pg;
const { url: DB_URL } = resolveSupabaseDatabaseUrl();

const pool = new Pool({ connectionString: DB_URL, max: 3, connectionTimeoutMillis: 10000 });

async function q(sql, params = []) {
  const client = await pool.connect();
  try { return await client.query(sql, params); }
  finally { client.release(); }
}

// ── Normalisasi class ────────────────────────────────────────────────────────
const NORM_MAP = {
  INCOME: "REVENUE", TRANSFER: "INTERNAL_TRANSFER",
  LIABILITY_SETTLEMENT: "REIMBURSEMENT", ASSET: "REIMBURSEMENT",
  COST: "EXPENSE", OPEX: "EXPENSE",
};
const VALID = ["REVENUE","EXPENSE","INTERNAL_TRANSFER","REIMBURSEMENT",
               "TAX_PAYMENT","INTERCOMPANY_LOAN","EMPLOYEE_ADVANCE"];
function normClass(raw) { return NORM_MAP[raw] ?? raw ?? null; }

// ── COA resolution ──────────────────────────────────────────────────────────
async function resolveCoaId(codePrefix, companyId) {
  const { rows } = await q(
    `SELECT id FROM chart_of_accounts WHERE code LIKE $1
     ${companyId ? `AND (company_id = ${companyId} OR company_id IS NULL)` : ""}
     ORDER BY company_id DESC NULLS LAST, id ASC LIMIT 1`,
    [codePrefix + "%"]
  );
  return rows[0]?.id ?? null;
}

async function resolveBankJournalId() {
  const { rows } = await q(
    `SELECT id FROM accounting_journals
     WHERE code IN ('BNK','BANK','GEN','JE','MISC')
        OR code LIKE 'BNK-%' OR code LIKE 'BANK-%'
     ORDER BY CASE WHEN code IN ('BNK','BANK','GEN','JE','MISC') THEN 0 ELSE 1 END, id ASC LIMIT 1`
  );
  return rows[0]?.id ?? null;
}

async function resolveCoaMapping(erpCategory) {
  if (!erpCategory) return null;
  const { rows } = await q(
    `SELECT coa_code, accounting_class FROM master_coa_mapping WHERE erp_category = $1 AND is_active = TRUE LIMIT 1`,
    [erpCategory]
  );
  return rows[0] ? { coaCode: rows[0].coa_code, accountingClass: rows[0].accounting_class } : null;
}

async function resolveBankCoaCode(bankAccountId, sourceAccount) {
  if (bankAccountId) {
    const { rows } = await q(`SELECT coa_code FROM master_bank_accounts WHERE id = $1 AND is_active = TRUE LIMIT 1`, [bankAccountId]);
    if (rows[0]?.coa_code) return rows[0].coa_code;
  }
  if (sourceAccount) {
    const { rows } = await q(
      `SELECT coa_code FROM master_bank_accounts WHERE is_active = TRUE AND (account_name ILIKE $1 OR bank_name ILIKE $1) LIMIT 1`,
      [`%${sourceAccount}%`]
    );
    if (rows[0]?.coa_code) return rows[0].coa_code;
  }
  return "1-1020";
}

const CLASS_FALLBACK = {
  REVENUE:           { drCode: "1-1020", crCode: "4-1020" },
  EXPENSE:           { drCode: "5-2040", crCode: "1-1020" },
  INTERNAL_TRANSFER: { drCode: "1-1020", crCode: "1-1020" },
  EMPLOYEE_ADVANCE:  { drCode: "1-1032", crCode: "1-1020" },
  INTERCOMPANY_LOAN: { drCode: "1-1031", crCode: "1-1020" },
  TAX_PAYMENT:       { drCode: "2-1020", crCode: "1-1020" },
  REIMBURSEMENT:     { drCode: "2-1010", crCode: "1-1020" },
};

// ── Entry number sequence ────────────────────────────────────────────────────
async function nextEntryNumber(journalCode) {
  const year = new Date().getFullYear();
  const pattern = `BNK/${year}/%`;
  const { rows } = await q(
    `SELECT COALESCE(MAX(CAST(SPLIT_PART(entry_number,'/',3) AS int)),0) AS seq
     FROM accounting_entries WHERE entry_number LIKE $1`, [pattern]
  );
  const seq = (rows[0]?.seq ?? 0) + 1;
  return `BNK/${year}/${String(seq).padStart(6,"0")}`;
}

// ── Post single row ──────────────────────────────────────────────────────────
async function postRow(row, journalId, companyId, errors) {
  const rawClass = row.accounting_class;
  const accClass = normClass(rawClass);
  const erpCat = row.erp_category ?? null;

  if (!VALID.includes(accClass)) {
    errors.push({ id: row.id, reason: `accounting_class '${rawClass}' tidak dikenal — dilewati` });
    return "skipped";
  }

  const masterMap = await resolveCoaMapping(erpCat);
  const resolvedClass = masterMap?.accountingClass ?? accClass;
  const bankCoa = await resolveBankCoaCode(row.bank_account_id ?? null, row.source_account ?? null);

  let drCode, crCode;
  if (resolvedClass === "REVENUE") {
    drCode = bankCoa; crCode = masterMap?.coaCode ?? CLASS_FALLBACK.REVENUE.crCode;
  } else if (resolvedClass === "EXPENSE") {
    drCode = masterMap?.coaCode ?? CLASS_FALLBACK.EXPENSE.drCode; crCode = bankCoa;
  } else if (resolvedClass === "TAX_PAYMENT") {
    drCode = masterMap?.coaCode ?? CLASS_FALLBACK.TAX_PAYMENT.drCode; crCode = bankCoa;
  } else if (resolvedClass === "REIMBURSEMENT") {
    if (erpCat === "REIMBURSEMENT_PAYMENT") {
      drCode = masterMap?.coaCode ?? "2-1050"; crCode = bankCoa;
    } else {
      drCode = bankCoa; crCode = masterMap?.coaCode ?? "1-1033";
    }
  } else if (resolvedClass === "INTERCOMPANY_LOAN") {
    drCode = masterMap?.coaCode ?? CLASS_FALLBACK.INTERCOMPANY_LOAN.drCode; crCode = bankCoa;
  } else if (resolvedClass === "INTERNAL_TRANSFER") {
    drCode = masterMap?.coaCode ?? CLASS_FALLBACK.INTERNAL_TRANSFER.drCode; crCode = bankCoa;
  } else if (resolvedClass === "EMPLOYEE_ADVANCE") {
    drCode = masterMap?.coaCode ?? CLASS_FALLBACK.EMPLOYEE_ADVANCE.drCode; crCode = bankCoa;
  } else {
    const fb = CLASS_FALLBACK[resolvedClass];
    if (!fb) { errors.push({ id: row.id, reason: `class '${resolvedClass}' tidak ada fallback` }); return "failed"; }
    drCode = fb.drCode; crCode = fb.crCode;
  }

  const drAccId = await resolveCoaId(drCode, companyId);
  const crAccId = await resolveCoaId(crCode, companyId);

  if (!drAccId || !crAccId) {
    errors.push({ id: row.id, reason: `COA tidak ditemukan: dr=${drCode}(${drAccId}), cr=${crCode}(${crAccId}), cat=${erpCat}` });
    return "failed";
  }

  const creditAmt = Number(row.credit || 0);
  const debitAmt  = Number(row.debit  || 0);
  const amount    = creditAmt > 0 ? creditAmt : debitAmt;
  if (amount <= 0) { errors.push({ id: row.id, reason: "Jumlah nol" }); return "failed"; }

  const txDate = row.transaction_date ? new Date(row.transaction_date).toISOString().split("T")[0] : new Date().toISOString().split("T")[0];

  const entryNumber = await nextEntryNumber("BNK");

  const { rows: [entry] } = await q(
    `INSERT INTO accounting_entries
       (entry_number, journal_id, date, ref, description, status, source, total_debit, total_credit, company_id)
     VALUES ($1,$2,$3,$4,$5,'posted','manual',$6,$7,$8)
     RETURNING id, entry_number`,
    [entryNumber, journalId, txDate, row.unique_key ?? null,
     row.description ?? null, String(amount), String(amount), companyId ?? 1]
  );

  await q(
    `INSERT INTO accounting_entry_lines (entry_id, account_id, debit, credit, description)
     VALUES ($1,$2,$3,$4,$5), ($1,$6,$7,$8,$9)`,
    [entry.id, drAccId, String(amount), "0", row.description ?? null,
     crAccId, "0", String(amount), row.description ?? null]
  );

  await q(`UPDATE bank_mutation_imports SET journal_entry_id = $1, status = 'IMPORTED' WHERE id = $2`, [entry.id, row.id]);

  return { entryId: entry.id, entryNumber: entry.entry_number, drCode, crCode, amount };
}

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  console.log("=== BANK MUTATION REPOST SCRIPT ===\n");

  // 1. Ensure migration table exists
  await q(`CREATE TABLE IF NOT EXISTS bank_mutation_import_audit (
    id SERIAL PRIMARY KEY, batch_id INT, row_id INT, action TEXT,
    actor TEXT, field TEXT, before_val TEXT, after_val TEXT,
    meta JSONB, created_at TIMESTAMPTZ DEFAULT NOW()
  )`);

  // 2. Normalize existing data
  const normSQL = `
    UPDATE bank_mutation_imports SET accounting_class = CASE
      WHEN accounting_class = 'INCOME'               THEN 'REVENUE'
      WHEN accounting_class = 'TRANSFER'             THEN 'INTERNAL_TRANSFER'
      WHEN accounting_class = 'LIABILITY_SETTLEMENT' THEN 'REIMBURSEMENT'
      WHEN accounting_class = 'ASSET'                THEN 'REIMBURSEMENT'
      WHEN accounting_class = 'COST'                 THEN 'EXPENSE'
      WHEN accounting_class = 'OPEX'                 THEN 'EXPENSE'
      ELSE accounting_class END
    WHERE journal_entry_id IS NULL
      AND accounting_class IN ('INCOME','TRANSFER','LIABILITY_SETTLEMENT','ASSET','COST','OPEX')`;
  const normResult = await q(normSQL);
  console.log(`Normalisasi data lama: ${normResult.rowCount} baris diupdate`);

  // 3. Get journal
  const journalId = await resolveBankJournalId();
  if (!journalId) { console.error("Tidak ada jurnal bank!"); process.exit(1); }
  console.log(`Journal ID: ${journalId}\n`);

  // 4. Get all DRAFT_IMPORT batches
  const { rows: batches } = await q(`SELECT * FROM bank_mutation_import_batches WHERE status = 'DRAFT_IMPORT' ORDER BY id`);
  console.log(`Jumlah batch DRAFT_IMPORT: ${batches.length}\n`);

  let totalPosted = 0, totalFailed = 0, totalSkipped = 0;
  const allErrors = [];

  for (const batch of batches) {
    const { rows: pendingRows } = await q(
      `SELECT * FROM bank_mutation_imports WHERE import_batch_id = $1 AND status != 'IMPORTED' AND journal_entry_id IS NULL AND accounting_class IS NOT NULL ORDER BY transaction_date ASC, id ASC`,
      [batch.id]
    );
    
    let bPosted = 0, bFailed = 0, bSkipped = 0;
    console.log(`Batch #${batch.id} (${batch.filename}): ${pendingRows.length} baris pending`);

    for (const row of pendingRows) {
      const result = await postRow(row, journalId, batch.company_id ?? null, allErrors);
      if (result === "skipped") bSkipped++;
      else if (result === "failed") bFailed++;
      else bPosted++;
    }

    if (bPosted > 0) {
      await q(`UPDATE bank_mutation_import_batches SET status = 'IMPORTED', updated_at = NOW() WHERE id = $1`, [batch.id]);
    }

    console.log(`  → posted: ${bPosted}, failed: ${bFailed}, skipped: ${bSkipped}`);
    totalPosted += bPosted; totalFailed += bFailed; totalSkipped += bSkipped;
  }

  console.log(`\n=== HASIL AKHIR ===`);
  console.log(`Total posted : ${totalPosted}`);
  console.log(`Total failed : ${totalFailed}`);
  console.log(`Total skipped: ${totalSkipped}`);
  
  if (allErrors.length > 0) {
    console.log(`\n=== ERRORS (${allErrors.length}) ===`);
    allErrors.slice(0,30).forEach(e => console.log(`  Row ${e.id}: ${e.reason}`));
    if (allErrors.length > 30) console.log(`  ... dan ${allErrors.length - 30} lainnya`);
  }

  await pool.end();
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
