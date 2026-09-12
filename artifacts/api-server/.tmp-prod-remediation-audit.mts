import { db, endPool } from "@workspace/db";
import { sql } from "drizzle-orm";

const query = async (label: string, text: string) => {
  try {
    const result = await db.execute(sql.raw(text));
    console.log(`\n=== ${label} ===`);
    console.log(JSON.stringify(result.rows, null, 2));
  } catch (error) {
    console.log(`\n=== ${label} ERROR ===`);
    console.log(String((error as Error & { cause?: Error }).cause?.message ?? (error as Error).message ?? error));
  }
};

await query(
  "AUDIT_EVENT_TABLES",
  "SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema IN ('public','sport_center') AND (table_name ILIKE '%audit%' OR table_name ILIKE '%event%' OR table_name ILIKE '%history%' OR table_name ILIKE '%activity%' OR table_name ILIKE '%log%') ORDER BY table_schema, table_name",
);
await query(
  "LEDGER_RELATED_TABLES",
  "SELECT table_schema, table_name FROM information_schema.tables WHERE table_schema IN ('public','sport_center') AND (table_name ILIKE '%accounting%' OR table_name ILIKE '%journal%' OR table_name ILIKE '%ledger%') ORDER BY table_schema, table_name",
);

await query(
  "PAYMENT_268_CANONICAL_FULL",
  "SELECT to_jsonb(p) AS row FROM sport_center.sport_payments p WHERE p.id = 268",
);
await query(
  "PAYMENTS_297_298_CANONICAL_FULL",
  "SELECT to_jsonb(p) AS row FROM sport_center.sport_payments p WHERE p.id IN (297,298) ORDER BY p.id",
);
await query(
  "PAYMENT_297_298_BOOKING_FULL",
  "SELECT to_jsonb(b) AS row FROM sport_center.sport_bookings b WHERE b.id = 440",
);

await query(
  "PUBLIC_MIRROR_268",
  "SELECT to_jsonb(p) AS row FROM public.sport_payments p WHERE p.source_payment_id = 268 OR p.payment_number = 'SCPAY-SC-268'",
);
await query(
  "PUBLIC_MIRRORS_297_298",
  "SELECT to_jsonb(p) AS row FROM public.sport_payments p WHERE p.source_payment_id IN (297,298) OR p.payment_number IN ('SCPAY-SC-297','SCPAY-SC-298') ORDER BY p.id",
);

await query(
  "CANONICAL_JOURNALS_268_297_298",
  "SELECT to_jsonb(j) AS row FROM sport_center.accounting_journals j WHERE j.payment_id IN (268,297,298) ORDER BY j.payment_id,j.id",
);
await query(
  "PUBLIC_JOURNAL_8195",
  "SELECT to_jsonb(j) AS row FROM public.accounting_journals j WHERE j.id = 8195",
);
await query(
  "ACCOUNTING_ENTRY_28058",
  "SELECT to_jsonb(e) AS row FROM public.accounting_entries e WHERE e.id = 28058",
);
await query(
  "ACCOUNTING_ENTRY_LINES_28058",
  "SELECT to_jsonb(l) AS row FROM public.accounting_entry_lines l WHERE l.entry_id = 28058 ORDER BY l.id",
);
await query(
  "ACCOUNTING_PAYMENT_5776",
  "SELECT to_jsonb(p) AS row FROM public.accounting_payments p WHERE p.id = 5776",
);
await query(
  "ACCOUNTING_IDENTITY_SEARCH",
  "SELECT to_jsonb(e) AS row FROM public.accounting_entries e WHERE e.id = 28058 OR e.ref = 'SCPAY-268' OR e.source_payment_id = 268 OR e.source_id = 268",
);

await query(
  "OUTBOX_268_297_298",
  "SELECT to_jsonb(o) AS row FROM sport_center.payment_accounting_outbox o WHERE o.payment_id IN (268,297,298) ORDER BY o.payment_id,o.id",
);
await query(
  "LEDGER_ALERTS_TARGET",
  "SELECT to_jsonb(a) AS row FROM public.ledger_consistency_alerts a WHERE (a.entity_type = 'accounting_payment' AND a.entity_id = '5776') OR (a.entity_type = 'accounting_entry' AND a.entity_id = '28058') OR (a.entity_type = 'payment_accounting_outbox' AND a.entity_id IN ('46','124','164')) ORDER BY a.id",
);

await query(
  "PAYMENT_AUDIT_LIKE_ROWS",
  "SELECT table_schema, table_name, column_name FROM information_schema.columns WHERE table_schema IN ('public','sport_center') AND (column_name ILIKE '%payment%' OR column_name ILIKE '%event%' OR column_name ILIKE '%actor%' OR column_name ILIKE '%action%' OR column_name ILIKE '%reference%') AND table_name ILIKE ANY (ARRAY['%audit%','%event%','%history%','%activity%','%log%']) ORDER BY table_schema,table_name,ordinal_position",
);

await endPool();