import { db } from '@workspace/db';
import { sql } from 'drizzle-orm';
import { fetchCandidates } from '/home/runner/workspace/artifacts/api-server/src/lib/reconciliation/unifiedMatchingEngine.ts';

const { rows } = await db.execute(sql.raw(`
  SELECT id, transaction_date, amount, direction, mutation_key,
         provider_name, description, normalized_description,
         company_id, bank_account_id, source, source_account, status
  FROM bank_mutations
  WHERE source = 'google_sheet'
    AND (
      UPPER(COALESCE(provider_name, '')) = 'QRIS'
      OR LOWER(COALESCE(description, '')) LIKE '%qris%'
      OR LOWER(COALESCE(normalized_description, '')) LIKE '%qris%'
    )
  ORDER BY transaction_date DESC, id DESC
  LIMIT 200
`));

const summary = {
  rows: rows.length,
  providerQris: rows.filter((r: any) => String(r.provider_name ?? '').toUpperCase() === 'QRIS').length,
  descriptionQris: rows.filter((r: any) => /qris/i.test(String(r.description ?? '') + ' ' + String(r.normalized_description ?? ''))).length,
};
console.log('SUMMARY', JSON.stringify(summary));

const results: any[] = [];
for (const r of rows as any[]) {
  const candidates = await fetchCandidates({
    id: Number(r.id),
    amount: Number(r.amount),
    transaction_date: String(r.transaction_date).slice(0, 10),
    mutation_key: String(r.mutation_key),
    provider_name: r.provider_name == null ? null : String(r.provider_name),
    normalized_description: r.normalized_description == null ? String(r.description ?? '') : String(r.normalized_description),
    company_id: r.company_id == null ? null : Number(r.company_id),
    bank_account_id: r.bank_account_id == null ? null : Number(r.bank_account_id),
    direction: String(r.direction ?? 'IN'),
  });
  const qris = candidates.filter((c: any) => c.type === 'qris_settlement' || c.type === 'sport_payment');
  results.push({
    id: Number(r.id), date: String(r.transaction_date).slice(0, 10), amount: Number(r.amount),
    direction: r.direction, provider: r.provider_name, description: String(r.description ?? '').slice(0, 100),
    companyId: r.company_id, status: r.status,
    totalCandidates: candidates.length,
    qrisCandidates: qris.map((c: any) => ({ type: c.type, id: c.id, amount: c.amount, gross: c.gross_amount, mdr: c.mdr_amount, settlementDate: c.settlement_date, ref: c.ref, method: c.payment_method, itemCount: c.settlement_item_count })),
  });
}
console.log(JSON.stringify(results, null, 2));
await db.$client?.end?.().catch?.(() => {});
