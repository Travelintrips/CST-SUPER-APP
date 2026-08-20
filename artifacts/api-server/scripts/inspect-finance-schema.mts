import { db, endPool } from "@workspace/db";
import { sql } from "drizzle-orm";

const tables = await db.execute(sql`
  SELECT table_schema, table_name, column_name, data_type, udt_name, is_nullable
  FROM information_schema.columns
  WHERE table_name LIKE '%finance_project%'
     OR (table_schema = 'public' AND table_name IN
       ('companies', 'company_bank_accounts', 'chart_of_accounts', 'tax_rules'))
  ORDER BY table_schema, table_name, ordinal_position
`);
console.log(JSON.stringify(tables.rows, null, 2));
for (const query of [
  sql`SELECT * FROM public.finance_project_configs ORDER BY id`,
  sql`SELECT * FROM public.finance_project_payment_configs ORDER BY id`,
  sql`SELECT * FROM public.finance_project_tax_mappings ORDER BY id`,
  sql`SELECT * FROM public.finance_project_coa_mappings ORDER BY id`,
]) {
  const result = await db.execute(query);
  console.log(JSON.stringify(result.rows, null, 2));
}
await endPool();