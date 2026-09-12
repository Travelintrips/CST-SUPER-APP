/**
 * Fix dev DB: dedup expense_categories, add unique index, then journals seed
 * will run automatically on next API server startup.
 */
import pg from 'pg';
const { Client } = pg;

const devUrl = process.env.SUPABASE_DATABASE_URL_DEV;
if (!devUrl) { console.error('SUPABASE_DATABASE_URL_DEV not set'); process.exit(1); }

const client = new Client({ connectionString: devUrl, ssl: { rejectUnauthorized: false } });

async function main() {
  await client.connect();
  console.log('Connected to dev DB\n');

  // 1. Check duplicate expense_categories codes
  const dups = await client.query(`
    SELECT code, COUNT(*) AS cnt FROM expense_categories GROUP BY code HAVING COUNT(*) > 1
  `);
  console.log(`Duplicate expense_categories codes: ${dups.rows.length}`);
  dups.rows.forEach(r => console.log(`  code="${r.code}" count=${r.cnt}`));

  // 2. Deduplicate: keep only MIN(id) per code
  const dedupResult = await client.query(`
    DELETE FROM expense_categories
    WHERE id NOT IN (
      SELECT MIN(id) FROM expense_categories GROUP BY code
    )
  `);
  console.log(`\nDeleted ${dedupResult.rowCount} duplicate expense_categories rows`);

  // 3. Now add unique index
  try {
    await client.query(`CREATE UNIQUE INDEX IF NOT EXISTS expense_categories_code_uniq ON expense_categories (code)`);
    console.log('✅ expense_categories_code_uniq index created');
  } catch (err) {
    console.log(`index: ${err.message}`);
  }

  // 4. Confirm journals are still 0
  const j = await client.query(`SELECT COUNT(*) AS total FROM accounting_journals WHERE company_id IS NOT NULL`);
  console.log(`\naccounting_journals (per-company): ${j.rows[0].total}`);
  console.log('→ Restart API server to trigger seedAccountingDefaults (will fill journals)\n');

  await client.end();
}

main().catch(err => { console.error('Error:', err.message); client.end().catch(()=>{}); process.exit(1); });
