import { db, endPool } from "@workspace/db";
import { sql } from "drizzle-orm";

const schema = await db.execute(sql`
  SELECT table_name, string_agg(column_name, ', ' ORDER BY ordinal_position) AS columns
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name IN ('sales_documents', 'sales_document_lines', 'products',
      'accounting_entries', 'accounting_entry_lines', 'chart_of_accounts',
      'finance_project_coa_mappings', 'finance_project_tax_mappings', 'tax_rules')
  GROUP BY table_name ORDER BY table_name
`);
console.log(JSON.stringify(schema.rows, null, 2));
for (const query of [
  sql`SELECT id, doc_number, kind, status, invoice_status, payment_status, total_amount, tax_rate_id, tax_amount, grand_total, company_id FROM public.sales_documents ORDER BY id`,
  sql`SELECT id, name, sku, item_type, default_sales_tax_id, company_id, is_active FROM public.products ORDER BY id`,
  sql`SELECT e.id, e.status, e.source, e.source_id, e.total_debit, e.total_credit,
             l.account_id, l.debit, l.credit, l.description, ca.code, ca.name
        FROM public.accounting_entries e
        JOIN public.accounting_entry_lines l ON l.entry_id = e.id
        LEFT JOIN public.chart_of_accounts ca ON ca.id = l.account_id
       WHERE e.company_id = 1 AND e.source IN ('sales_invoice','sales_payment','ecommerce_order','pos_sale')
       ORDER BY e.id DESC, l.id`,
  sql`SELECT id, account_role, coa_id, payment_method, provider_code, is_active FROM public.finance_project_coa_mappings WHERE finance_project_config_id = 3 ORDER BY id`,
  sql`SELECT id, transaction_type, tax_rule_id, product_scope, payment_method, provider_code, is_active FROM public.finance_project_tax_mappings WHERE finance_project_config_id = 3 ORDER BY id`,
  sql`SELECT * FROM public.tax_rules WHERE company_id = 1 ORDER BY id`,
  sql`SELECT ca.id, ca.code, ca.name, ca.company_id, ca.is_active, ca.is_postable,
             COUNT(l.id)::int AS usage_count,
             COALESCE(SUM(l.debit), 0) AS total_debit,
             COALESCE(SUM(l.credit), 0) AS total_credit
        FROM public.chart_of_accounts ca
        LEFT JOIN public.accounting_entry_lines l ON l.account_id = ca.id
       WHERE ca.company_id = 1
         AND ca.is_active = true
         AND (ca.code LIKE '4-%' OR ca.name ILIKE '%pendapatan%')
       GROUP BY ca.id, ca.code, ca.name, ca.company_id, ca.is_active, ca.is_postable
       ORDER BY ca.code`,
]) {
  try {
    const result = await db.execute(query);
    console.log(JSON.stringify(result.rows, null, 2));
  } catch (error) {
    console.log(JSON.stringify({ error: String(error) }));
  }
}
await endPool();