import { db } from '@workspace/db';
import { sql } from 'drizzle-orm';
import { fetchCandidates } from './src/lib/reconciliation/unifiedMatchingEngine.ts';

const rows = await db.execute(sql.raw(`
SELECT bm.id,bm.transaction_date::text AS date,bm.amount,bm.description,bm.company_id,
       EXISTS(SELECT 1 FROM sport_payments sp WHERE sp.company_id=bm.company_id AND sp.method ILIKE '%qris%' AND sp.status='paid' AND COALESCE(sp.settlement_date,sp.paid_at::date+1) BETWEEN bm.transaction_date::date-3 AND bm.transaction_date::date+3 AND ABS(COALESCE(NULLIF(sp.net_amount,0),sp.amount)::numeric-bm.amount::numeric)<.01) AS exact_qris_candidate,
       (SELECT json_agg(json_build_object('id',sp.id,'amount',sp.amount,'net',sp.net_amount,'paid',sp.paid_at::date,'settlement',sp.settlement_date,'status',sp.settlement_status)) FROM sport_payments sp WHERE sp.company_id=bm.company_id AND sp.method ILIKE '%qris%' AND sp.status='paid' AND COALESCE(sp.settlement_date,sp.paid_at::date+1) BETWEEN bm.transaction_date::date-3 AND bm.transaction_date::date+3) AS nearby_qris
FROM bank_mutations bm
WHERE bm.source='google_sheet' AND bm.direction='IN' AND (bm.description ILIKE '%qris%' OR bm.description ILIKE '%qrtravel%' OR bm.description ILIKE '%merchant%')
ORDER BY bm.transaction_date DESC,bm.id DESC`));
console.log('ROWS',JSON.stringify(rows.rows,null,2));

const sheetRows = await db.execute(sql.raw(`SELECT id,transaction_date,amount,direction,mutation_key,provider_name,description,normalized_description,company_id,bank_account_id,status FROM bank_mutations WHERE source='google_sheet' AND direction='IN' ORDER BY transaction_date DESC,id DESC`));
const out:any[]=[];
for (const r of sheetRows.rows as any[]) {
  const base:any={id:Number(r.id),amount:Number(r.amount),transaction_date:String(r.transaction_date).slice(0,10),mutation_key:String(r.mutation_key),normalized_description:String(r.normalized_description??r.description??''),company_id:r.company_id==null?null:Number(r.company_id),bank_account_id:r.bank_account_id==null?null:Number(r.bank_account_id),direction:'IN'};
  const actual=await fetchCandidates({...base,provider_name:r.provider_name==null?null:String(r.provider_name)});
  const forced=await fetchCandidates({...base,provider_name:'QRIS'});
  const actualRel=actual.filter((c:any)=>c.type==='sport_payment'||c.type==='qris_settlement');
  const forcedRel=forced.filter((c:any)=>c.type==='sport_payment'||c.type==='qris_settlement');
  if (actualRel.length || forcedRel.length || /qris|qrtravel|merchant/i.test(String(r.description))) out.push({id:base.id,date:base.transaction_date,amount:base.amount,description:String(r.description).slice(0,120),actual:actualRel.map((c:any)=>({type:c.type,id:c.id,amount:c.amount,settlementDate:c.settlement_date,ref:c.ref})),forcedQris:forcedRel.map((c:any)=>({type:c.type,id:c.id,amount:c.amount,gross:c.gross_amount,mdr:c.mdr_amount,settlementDate:c.settlement_date,ref:c.ref,status:c.settlement_status}))});
}
console.log('MATCH_COMPARISON',JSON.stringify(out,null,2));
await db.$client?.end?.().catch?.(()=>{});
