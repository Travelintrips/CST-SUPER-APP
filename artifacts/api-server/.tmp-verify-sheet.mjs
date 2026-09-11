import pg from 'pg';
const c = new pg.Client({ connectionString: process.env.SUPABASE_DATABASE_URL });
await c.connect();
for (const [label, query] of [
  ['config', `SELECT id,label,last_synced_at,last_sync_status,last_sync_error FROM public.bank_sheet_configs WHERE id=3`],
  ['mutations', `SELECT COUNT(*)::int AS count, MIN(transaction_date)::text AS first_date, MAX(transaction_date)::text AS last_date, COUNT(*) FILTER (WHERE source='google_sheet')::int AS google_sheet_count FROM public.bank_mutations WHERE sheet_config_id=3`],
  ['sample', `SELECT id,transaction_date,amount,direction,description,status,company_id,bank_account_id,source FROM public.bank_mutations WHERE sheet_config_id=3 ORDER BY id LIMIT 3`]
]) { console.log(`---${label}---`); console.log(JSON.stringify((await c.query(query)).rows,null,2)); }
await c.end();
