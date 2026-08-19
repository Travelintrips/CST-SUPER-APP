import { db, endPool } from "@workspace/db";
import { sql } from "drizzle-orm";

const ids = [268, 297, 298];
const idList = ids.join(",");

async function query(label: string, text: string): Promise<void> {
  try {
    const result = await db.execute(sql.raw(text));
    console.log(`\n=== ${label} ===`);
    console.log(JSON.stringify(result.rows, null, 2));
  } catch (error) {
    console.log(`\n=== ${label} ERROR ===`);
    console.log(String((error as Error & { cause?: Error }).cause?.message ?? (error as Error).message ?? error));
  }
}

await query("ENV_PROOF", "SELECT current_database() AS database, current_schema() AS schema, current_setting('app.environment', true) AS app_environment");
await query("CANONICAL_PAYMENTS", `SELECT id, booking_id, amount, status::text AS status, payment_type, payment_method, payment_provider, provider_id, provider_order_id, payment_number, company_id, paid_at, created_at, updated_at FROM sport_center.sport_payments WHERE id IN (${idList}) ORDER BY id`);
await query("CANONICAL_BOOKINGS", `SELECT id, order_number, booking_number, customer_id, customer_name, company_id, status::text AS status, total_amount, created_at FROM sport_center.sport_bookings WHERE id IN (SELECT booking_id FROM sport_center.sport_payments WHERE id IN (${idList})) ORDER BY id`);
await query("CANONICAL_JOURNALS", `SELECT id, payment_id, journal_type, status::text AS status, is_reversal, source_event_id, correlation_id, debit_amount, credit_revenue_amount, credit_ppn_amount, journal_date, created_at FROM sport_center.accounting_journals WHERE payment_id IN (${idList}) ORDER BY payment_id,id`);
await query("CANONICAL_JOURNAL_LINES", `SELECT l.id, l.journal_id, l.account_id, l.debit, l.credit, l.description FROM sport_center.accounting_journal_lines l WHERE l.journal_id IN (SELECT id FROM sport_center.accounting_journals WHERE payment_id IN (${idList})) ORDER BY l.journal_id,l.id`);
await query("OUTBOX", `SELECT id, payment_id, event_type, status, attempts, locked_at, available_at, processed_at, last_error, created_at, updated_at FROM sport_center.payment_accounting_outbox WHERE payment_id IN (${idList}) ORDER BY payment_id,id`);
await query("CANONICAL_SETTLEMENT_ITEMS", `SELECT to_jsonb(i) AS row FROM sport_center.payment_settlement_items i WHERE i.sport_payment_id IN (${idList}) ORDER BY i.sport_payment_id,i.id`);
await query("PUBLIC_SETTLEMENT_ITEMS", `SELECT to_jsonb(i) AS row FROM public.qris_settlement_items i WHERE i.sport_payment_id IN (${idList}) ORDER BY i.sport_payment_id,i.id`);
await query("PUBLIC_MIRRORS", `SELECT id, payment_number, booking_id, amount, status::text AS status, payment_type, payment_method, payment_provider, provider_id, provider_order_id, company_id, posting_status, accounting_payment_id, posting_error, created_at, updated_at FROM public.sport_payments WHERE payment_number IN ('SCPAY-SC-268','SCPAY-SC-297','SCPAY-SC-298') OR NULLIF(to_jsonb(sport_payments)->>'source_payment_id','')::int IN (${idList}) ORDER BY id`);
await query("ACCOUNTING_ENTRIES", `SELECT id, entry_number, company_id, journal_id, status::text AS status, source, source_id, source_event_id, total_debit, total_credit, payment_method, payment_provider, created_at FROM public.accounting_entries WHERE (source = 'sport_center_payment' AND source_id IN (${idList})) OR NULLIF(to_jsonb(accounting_entries)->>'source_event_id','') IN (SELECT source_event_id::text FROM sport_center.accounting_journals WHERE payment_id IN (${idList}) AND source_event_id IS NOT NULL) ORDER BY id`);
await query("ACCOUNTING_PAYMENTS", `SELECT id, payment_number, company_id, status::text AS status, amount, journal_id, entry_id, source_type, source_doc_id, payment_method, payment_provider, ref, date, created_at FROM public.accounting_payments WHERE source_type = 'sport_center' AND (source_doc_id IN (SELECT id FROM public.sport_payments WHERE payment_number IN ('SCPAY-SC-268','SCPAY-SC-297','SCPAY-SC-298')) OR entry_id IN (SELECT id FROM public.accounting_entries WHERE source = 'sport_center_payment' AND source_id IN (${idList}))) ORDER BY id`);
await query("RECON_MATCHES", `SELECT to_jsonb(m) AS row FROM sport_center.bank_reconciliation_matches m WHERE to_jsonb(m)::text ILIKE ANY (ARRAY['%268%','%297%','%298%']) ORDER BY m.id`);
await query("RECON_ALERTS", `SELECT to_jsonb(a) AS row FROM public.reconciliation_alerts a WHERE to_jsonb(a)::text ILIKE ANY (ARRAY['%268%','%297%','%298%']) ORDER BY a.id`);
await query("LEDGER_ALERTS", `SELECT id, alert_type, severity, entity_type, entity_id, resolved, description, created_at FROM public.ledger_consistency_alerts WHERE (entity_type = 'payment_accounting_outbox' AND entity_id IN (SELECT id::text FROM sport_center.payment_accounting_outbox WHERE payment_id IN (${idList}))) OR description ILIKE ANY (ARRAY['%payment%268%','%payment%297%','%payment%298%','%SCPAY-SC-268%','%SCPAY-SC-297%','%SCPAY-SC-298%']) ORDER BY id`);

await endPool();