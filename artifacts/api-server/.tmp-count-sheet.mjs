import pg from 'pg';
const c=new pg.Client({connectionString:process.env.SUPABASE_DATABASE_URL}); await c.connect();
for (const q of [
  `SELECT c.id,c.label,c.company_id,c.bank_account_number,c.is_active,c.last_synced_at,c.last_sync_status,c.last_sync_error,COUNT(bm.id)::int AS mutation_count FROM public.bank_sheet_configs c LEFT JOIN public.bank_mutations bm ON bm.sheet_config_id=c.id GROUP BY c.id ORDER BY c.id`,
  `SELECT sheet_config_id,COUNT(*)::int AS count,MIN(transaction_date)::text AS min_date,MAX(transaction_date)::text AS max_date FROM public.bank_mutations WHERE sheet_config_id IN (2,3) GROUP BY sheet_config_id ORDER BY sheet_config_id`,
  `SELECT id,company_id,account_number,is_active FROM public.company_bank_accounts WHERE company_id=1 AND account_number IN ('123456789','1234567890','1640006707220') ORDER BY id`
]) { console.log(JSON.stringify((await c.query(q)).rows,null,2)); }
await c.end();
