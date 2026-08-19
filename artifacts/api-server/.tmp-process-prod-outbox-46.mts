import { db, endPool } from "@workspace/db";
import { sql } from "drizzle-orm";
import { ingestModulePayment } from "./src/lib/ingestModulePayment.js";

const countRows = async () => {
  const entries = await db.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM accounting_entries
    WHERE source_payment_id = 268
  `);
  const payments = await db.execute(sql`
    SELECT COUNT(*)::int AS count
    FROM accounting_payments
    WHERE source_type = 'sport_center' AND source_doc_id = 268
  `);
  return {
    entries: Number((entries.rows[0] as Record<string, unknown>)?.count ?? 0),
    payments: Number((payments.rows[0] as Record<string, unknown>)?.count ?? 0),
  };
};

const before = await countRows();
const result = await ingestModulePayment({
  moduleType: "sport_center",
  sourceDocId: 268,
  companyId: 1,
  amount: 700000,
  method: "transfer",
  partnerName: "DHL expres",
  date: "2026-07-29",
  ref: "SCPAY-268",
  description: "Pembayaran booking sport center",
  actorId: "SYSTEM",
});
console.log("RECOVERY_RESULT", JSON.stringify(result));

if (!result.ok || !result.alreadyPosted || result.accountingEntryId !== 28058) {
  throw new Error(`Controlled recovery did not validate existing owner: ${JSON.stringify(result)}`);
}

const afterAccounting = await countRows();
if (afterAccounting.entries !== before.entries || afterAccounting.payments !== before.payments) {
  throw new Error(`Financial row count changed: before=${JSON.stringify(before)} after=${JSON.stringify(afterAccounting)}`);
}

await db.execute(sql`
  UPDATE sport_center.payment_accounting_outbox
  SET status = 'posted',
      last_error = NULL,
      locked_at = NULL,
      processed_at = COALESCE(processed_at, NOW()),
      updated_at = NOW()
  WHERE id = 46
    AND payment_id = 268
    AND status = 'failed'
`);

const final = await db.execute(sql`
  SELECT id, status, attempts, last_error, processed_at
  FROM sport_center.payment_accounting_outbox
  WHERE id = 46
`);
console.log("COUNTS", JSON.stringify({ before, after: afterAccounting }));
console.log("OUTBOX_FINAL", JSON.stringify(final.rows));
await endPool();