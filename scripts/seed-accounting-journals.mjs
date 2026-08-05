/**
 * Safety-net seed script: ensures accounting_journals exist for all active companies.
 * Uses company_code from DB directly as the journal abbreviation suffix — no hardcoded map.
 * This mirrors accountingSeed.ts populateDynamicCompanies() which is also DB-driven.
 *
 * Run with: node scripts/seed-accounting-journals.mjs
 *
 * Safe to run multiple times (idempotent).
 * Non-fatal if COA accounts don't exist yet — API server startup will complete the seed.
 */
import pg from 'pg';
const { Client } = pg;

const devUrl = process.env.SUPABASE_DATABASE_URL_DEV;
if (!devUrl) {
  console.log('[seed-journals] SUPABASE_DATABASE_URL_DEV not set — skipping.');
  process.exit(0);
}

const client = new Client({ connectionString: devUrl, ssl: { rejectUnauthorized: false } });

// Journal templates — must match accountingSeed.ts JOURNAL_TEMPLATES
const TEMPLATES = [
  { suffix: 'SAL', label: 'Penjualan',              type: 'sales',    debit: '1-1030', credit: '4-1010' },
  { suffix: 'PUR', label: 'Pembelian',              type: 'purchase', debit: '5-1010', credit: '2-1010' },
  { suffix: 'BNK', label: 'Bank Mandiri',           type: 'bank',     debit: '1-1020', credit: '1-1020' },
  { suffix: 'CSH', label: 'Kas Kecil',              type: 'cash',     debit: '1-1010', credit: '1-1010' },
  { suffix: 'GEN', label: 'Memorial / Penyesuaian', type: 'general',  debit: null,     credit: null     },
  { suffix: 'EXP', label: 'Beban & Reimburse',      type: 'purchase', debit: '5-1010', credit: '2-1010' },
];

async function lookupAccount(code) {
  if (!code) return null;
  const r = await client.query(
    `SELECT id FROM chart_of_accounts WHERE code = $1 AND company_id IS NOT NULL LIMIT 1`,
    [code]
  );
  return r.rows[0]?.id ?? null;
}

async function main() {
  await client.connect();
  console.log('[seed-journals] Connected to dev DB');

  // Ensure journals_company_code_uniq index exists
  await client.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS journals_company_code_uniq
    ON accounting_journals (company_id, code)
  `).catch(e => console.log(`[seed-journals] Index note: ${e.message}`));

  // Load companies dynamically from DB
  const companiesRes = await client.query(
    `SELECT id, company_code FROM companies WHERE is_active = true ORDER BY id`
  ).catch(() => ({ rows: [] }));

  if (companiesRes.rows.length === 0) {
    console.log('[seed-journals] No companies found — COA not seeded yet. API server startup will handle it.');
    await client.end();
    return;
  }

  // Check if COA exists for the first company (proxy for "COA seeded")
  const firstCo = companiesRes.rows[0];
  const coaCheck = await client.query(
    `SELECT COUNT(*) AS n FROM chart_of_accounts WHERE company_id = $1`,
    [firstCo.id]
  );
  if (parseInt(coaCheck.rows[0].n) === 0) {
    console.log('[seed-journals] COA not seeded yet — API server startup will seed COA + journals automatically.');
    await client.end();
    return;
  }

  console.log(`[seed-journals] Found ${companiesRes.rows.length} companies`);

  let inserted = 0;
  let skipped = 0;

  for (const company of companiesRes.rows) {
    // Gunakan company_code dari DB sebagai abbreviasi — DB adalah sumber kebenaran.
    const abbr = company.company_code.slice(0, 8).toUpperCase();

    for (const tpl of TEMPLATES) {
      const code = `${tpl.suffix}-${abbr}`;
      const name = tpl.label + (tpl.suffix === 'BNK' ? ` ${abbr}` : '');
      const debitId  = tpl.debit  ? await lookupAccount(`${tpl.debit}-${abbr}`)  : null;
      const creditId = tpl.credit ? await lookupAccount(`${tpl.credit}-${abbr}`) : null;

      const existing = await client.query(
        `SELECT id FROM accounting_journals WHERE company_id = $1 AND code = $2`,
        [company.id, code]
      );
      if (existing.rows.length > 0) {
        skipped++;
        continue;
      }

      await client.query(
        `INSERT INTO accounting_journals
           (code, name, type, company_id, default_debit_account_id, default_credit_account_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT DO NOTHING`,
        [code, name, tpl.type, company.id, debitId, creditId]
      );
      console.log(`  ✓ ${code} | ${name} (debit=${debitId ?? 'null'}, credit=${creditId ?? 'null'})`);
      inserted++;
    }
  }

  const total = await client.query(
    `SELECT COUNT(*) AS n FROM accounting_journals WHERE company_id IS NOT NULL`
  );
  console.log(`\n[seed-journals] Done: inserted=${inserted}, skipped=${skipped}, total=${total.rows[0].n}`);
  await client.end();
}

main().catch(err => {
  console.error('[seed-journals] Error:', err.message);
  client.end().catch(() => {});
  process.exit(0); // non-fatal: don't fail post-merge if journal seed fails
});
