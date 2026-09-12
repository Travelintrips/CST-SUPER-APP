import pg from "pg";

const { Client } = pg;
const client = new Client({
  connectionString: process.env.SUPABASE_DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  connectionTimeoutMillis: 15_000,
  statement_timeout: 15_000,
});

await client.connect();
const query = (text, params = []) => client.query(text, params).then((r) => r.rows);

try {
  const out = { captured_at: new Date().toISOString() };
  out.mutation = (await query(
    `SELECT id,status,journal_entry_id,mutation_key,amount,transaction_date,company_id
     FROM public.bank_mutations WHERE id=$1`,
    [144],
  ))[0] ?? null;
  out.canonical = out.mutation
    ? ((await query(
      `SELECT id,status,mutation_key,amount,transaction_date,company_id,bank_account_id,provider_name
       FROM sport_center.bank_mutations WHERE mutation_key=$1`,
      [out.mutation.mutation_key],
    ))[0] ?? null)
    : null;
  out.matches = await query(
    `SELECT id,mutation_id,candidate_type,candidate_id,candidate_source,status,match_score,created_at
     FROM public.bank_reconciliation_matches
     WHERE mutation_id=$1 ORDER BY match_score DESC,id`,
    [144],
  );
  out.match_rank = out.matches.map((match, index) => ({ ...match, rank: index + 1 }));
  out.settlement1 = (await query(
    `SELECT id,status,bank_mutation_id,settlement_journal_id
     FROM sport_center.payment_settlement_batches WHERE id=1`,
  ))[0] ?? null;
  out.settlement2 = (await query(
    `SELECT id,status,bank_mutation_id,settlement_journal_id
     FROM sport_center.payment_settlement_batches WHERE id=2`,
  ))[0] ?? null;
  out.settlementJournal = out.settlement1?.settlement_journal_id
    ? ((await query(
      `SELECT id,status,journal_type,is_reversal,settlement_batch_id
       FROM sport_center.accounting_journals WHERE id=$1`,
      [out.settlement1.settlement_journal_id],
    ))[0] ?? null)
    : null;
  const tables = await query(
    `SELECT table_schema,table_name
     FROM information_schema.tables
     WHERE table_schema IN ('public','sport_center')
       AND table_name IN ('accounting_entries','accounting_entry_lines','accounting_lines',
                          'ledger_entries','bank_reconciliation_audit','accounting_journals')
     ORDER BY table_schema,table_name`,
  );
  out.tables = tables;
  out.counts = {};
  for (const table of tables) {
    const key = `${table.table_schema}.${table.table_name}`;
    out.counts[key] = Number((await query(
      `SELECT COUNT(*)::int AS n FROM ${table.table_schema}.${table.table_name}`,
    ))[0]?.n ?? 0);
  }
  out.mutationAudit = await query(
    `SELECT id,action,actor,meta,created_at
     FROM public.bank_reconciliation_audit WHERE mutation_id=$1 ORDER BY id`,
    [144],
  );
  console.log(JSON.stringify(out, null, 2));
} finally {
  await client.end();
}