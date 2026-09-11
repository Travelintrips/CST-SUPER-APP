import pg from 'pg';
const client = new pg.Client({ connectionString: process.env.SUPABASE_DATABASE_URL });
await client.connect();
async function q(label, text) {
  const r = await client.query(text);
  console.log(`---${label}---`);
  console.log(JSON.stringify(r.rows, null, 2));
}
await q('config_columns', `SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='bank_sheet_configs' ORDER BY ordinal_position`);
await q('configs', `SELECT * FROM public.bank_sheet_configs ORDER BY id`);
await q('mutations_by_sheet', `SELECT sheet_config_id,company_id,bank_account_id,transaction_date,direction,amount,description,status,provider_name,source,mutation_key,canonical_key,created_at FROM public.bank_mutations WHERE sheet_config_id IS NOT NULL ORDER BY created_at DESC LIMIT 100`);
await q('accounts', `SELECT id,company_id,account_number,bank_name,is_active FROM public.company_bank_accounts ORDER BY company_id,id`);
await client.end();
