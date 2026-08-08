import { db } from '@workspace/db';
import { sql } from 'drizzle-orm';
import { fetchCandidates } from './src/lib/reconciliation/unifiedMatchingEngine.ts';

const { rows } = await db.execute(sql.raw(`
  SELECT id, transaction_date, amount, direction, mutation_key,
         provider_name, description, normalized_description,
         company_id, bank_account_id, source, status
  FROM bank_mutations
  WHERE source = 'google_sheet' AND direction = 'IN'
  ORDER BY transaction_date DESC, id DESC
  LIMIT 200
`));
const results:any[]=[];
for (const r of rows as any[]) {
  const input = {
    id:Number(r.id), amount:Number(r.amount), transaction_date:String(r.transaction_date).slice(0,10),
    mutation_key:String(r.mutation_key), provider_name:r.provider_name == null ? null : String(r.provider_name),
    normalized_description:String(r.normalized_description ?? r.description ?? ''), company_id:r.company_id == null ? null : Number(r.company_id),
    bank_account_id:r.bank_account_id == null ? null : Number(r.bank_account_id), direction:'IN' as const,
  };
  const candidates=await fetchCandidates(input);
  const related=candidates.filter((c:any)=>c.type==='sport_payment'||c.type==='qris_settlement');
  if (related.length || /qris|qrtravel|merchant|paymt|payment|edc|gopay|dana|ovo|shopee/i.test(String(r.description))) {
    results.push({
      id:Number(r.id), date:input.transaction_date, amount:input.amount, status:r.status,
      description:String(r.description).slice(0,160), provider:r.provider_name,
      totalCandidates:candidates.length,
      related:related.map((c:any)=>({type:c.type,id:c.id,amount:c.amount,gross:c.gross_amount,mdr:c.mdr_amount,settlementDate:c.settlement_date,ref:c.ref,method:c.payment_method,status:c.settlement_status,itemCount:c.settlement_item_count}))
    });
  }
}
console.log(JSON.stringify({sheetInboundCount:rows.length,rowsWithQrOrSportEvidence:results.length,results},null,2));
await db.$client?.end?.().catch?.(()=>{});
