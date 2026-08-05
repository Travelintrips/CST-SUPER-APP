/**
 * Standalone script — check COA status on dev DB and report.
 * Run with: node scripts/check-and-seed-coa.mjs
 */
import pg from 'pg';

const { Client } = pg;

const devUrl = process.env.SUPABASE_DATABASE_URL_DEV;
if (!devUrl) {
  console.error('SUPABASE_DATABASE_URL_DEV not set');
  process.exit(1);
}

const client = new Client({ connectionString: devUrl, ssl: { rejectUnauthorized: false } });

async function main() {
  await client.connect();
  console.log('Connected to dev DB\n');

  // 1. Check COA counts
  const coaTotal = await client.query(`SELECT COUNT(*) AS total FROM chart_of_accounts`);
  const coaPerCompany = await client.query(`SELECT COUNT(*) AS total FROM chart_of_accounts WHERE company_id IS NOT NULL`);
  const journals = await client.query(`SELECT COUNT(*) AS total FROM accounting_journals WHERE company_id IS NOT NULL`);
  const settings = await client.query(`SELECT COUNT(*) AS total FROM accounting_settings WHERE company_id IS NOT NULL`);
  const taxes = await client.query(`SELECT COUNT(*) AS total FROM accounting_taxes WHERE company_id IS NOT NULL`);
  const expCats = await client.query(`SELECT COUNT(*) AS total FROM expense_categories`);

  console.log('=== Chart of Accounts status ===');
  console.log(`  chart_of_accounts total     : ${coaTotal.rows[0].total}`);
  console.log(`  chart_of_accounts per-company: ${coaPerCompany.rows[0].total}`);
  console.log(`  accounting_journals          : ${journals.rows[0].total}`);
  console.log(`  accounting_settings          : ${settings.rows[0].total}`);
  console.log(`  accounting_taxes             : ${taxes.rows[0].total}`);
  console.log(`  expense_categories           : ${expCats.rows[0].total}`);

  const perCompanyCount = parseInt(coaPerCompany.rows[0].total);

  if (perCompanyCount >= 100) {
    console.log('\n✅ COA already seeded — semua akun tersedia.');
  } else {
    console.log('\n⚠️  COA belum seeded atau kurang (<100 per-company accounts).');
    console.log('   Seed akan dijalankan oleh API server saat restart.');
  }

  // 2. Ensure expense_categories.code unique index
  console.log('\n=== Ensuring expense_categories.code unique index ===');
  try {
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS expense_categories_code_uniq ON expense_categories (code)`);
    console.log('  ✅ Index expense_categories_code_uniq OK');
  } catch (err) {
    console.log(`  ℹ️  Index: ${err.message}`);
  }

  // 3. Quick sanity: can we find a basic COA account?
  const sample = await client.query(`SELECT code, name, type FROM chart_of_accounts WHERE company_id IS NOT NULL ORDER BY id LIMIT 5`);
  console.log('\n=== Sample per-company accounts ===');
  if (sample.rows.length === 0) {
    console.log('  (none — seed needed)');
  } else {
    sample.rows.forEach(r => console.log(`  ${r.code} | ${r.name} | ${r.type}`));
  }

  await client.end();
}

main().catch(err => {
  console.error('Error:', err.message);
  client.end().catch(() => {});
  process.exit(1);
});
// Append: dedup and fix journals run separately via fix-dev-journals.mjs
