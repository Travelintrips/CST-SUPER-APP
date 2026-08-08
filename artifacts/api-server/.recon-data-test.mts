import { db } from '@workspace/db';
import { sql } from 'drizzle-orm';
const q = async (label:string, query:string) => { const r=await db.execute(sql.raw(query)).catch((e:any)=>({rows:[{error:e?.cause?.message??e?.message}]})); console.log(label, JSON.stringify(r.rows,null,2)); };
await q('MUTATION_COUNTS', `SELECT source, provider_name, direction, status, COUNT(*)::int AS count, MIN(transaction_date)::text AS min_date, MAX(transaction_date)::text AS max_date FROM bank_mutations GROUP BY source, provider_name, direction, status ORDER BY count DESC LIMIT 100`);
await q('RECENT_MUTATIONS', `SELECT id, transaction_date, amount, direction, provider_name, description, normalized_description, source, source_account, company_id, sheet_config_id, status FROM bank_mutations ORDER BY created_at DESC, id DESC LIMIT 100`);
await q('SYNC_LOGS', `SELECT * FROM reconciliation_sync_logs ORDER BY created_at DESC LIMIT 20`);
await q('SHEET_CONFIGS', `SELECT id,label,company_id,tab_name,last_synced_at,last_sync_status,last_sync_error FROM bank_sheet_configs ORDER BY id`);
await q('SPORT_QRIS', `SELECT id,company_id,amount,method,status,paid_at,net_amount,mdr_amount,settlement_date,settlement_status,settlement_reference FROM sport_payments ORDER BY id DESC LIMIT 30`);
await db.$client?.end?.().catch?.(()=>{});
