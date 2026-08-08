import { db } from '@workspace/db';
import { sql } from 'drizzle-orm';

const tables = ['bank_mutation_import_batches','bank_mutation_import_rows','bank_mutation_imports','bank_mutations','bank_sheet_configs','qris_settlements','qris_settlement_items','sport_payments'];
for (const table of tables) {
  const cols = await db.execute(sql.raw(`
    SELECT column_name, data_type
    FROM information_schema.columns
    WHERE table_schema='public' AND table_name='${table}'
    ORDER BY ordinal_position
  `)).catch((e:any) => ({ rows: [{ error: e?.cause?.message ?? e?.message }] }));
  const count = await db.execute(sql.raw(`SELECT COUNT(*)::int AS count FROM ${table}`)).catch((e:any) => ({ rows: [{ error: e?.cause?.message ?? e?.message }] }));
  console.log(table, JSON.stringify({columns: cols.rows, count: count.rows}));
}
const batchRows = await db.execute(sql.raw(`SELECT * FROM bank_mutation_import_batches ORDER BY id DESC LIMIT 10`)).catch((e:any) => ({ rows: [{ error: e?.cause?.message ?? e?.message }] }));
console.log('BATCH_ROWS', JSON.stringify(batchRows.rows, null, 2));
const importRows = await db.execute(sql.raw(`SELECT id, import_batch_id, transaction_date, debit, credit, description, payment_method, source_account, company, unique_key, status FROM bank_mutation_imports ORDER BY id DESC LIMIT 30`)).catch((e:any) => ({ rows: [{ error: e?.cause?.message ?? e?.message }] }));
console.log('IMPORT_ROWS', JSON.stringify(importRows.rows, null, 2));
const sheetRows = await db.execute(sql.raw(`SELECT * FROM bank_sheet_configs ORDER BY id DESC LIMIT 20`)).catch((e:any) => ({ rows: [{ error: e?.cause?.message ?? e?.message }] }));
console.log('SHEET_CONFIGS', JSON.stringify(sheetRows.rows, null, 2));
await db.$client?.end?.().catch?.(() => {});
