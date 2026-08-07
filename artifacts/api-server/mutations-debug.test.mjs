/**
 * Debug test — cari penyebab 500 di GET /api/bank-reconciliation/mutations
 * Jalankan: npx vitest run mutations-debug.test.mjs
 */
import { describe, it } from "vitest";

describe("mutations endpoint debug", () => {
  it("union all query should work", async () => {
    const { db } = await import("@workspace/db");
    const { sql } = await import("drizzle-orm");

    // Step 1: test masing-masing tabel secara terpisah
    try {
      const r1 = await db.execute(sql.raw(`SELECT id, transaction_date, status FROM bank_mutations LIMIT 1`));
      console.log("bank_mutations OK, sample:", JSON.stringify(r1.rows[0] ?? "empty"));
    } catch (e) {
      console.error("bank_mutations FAIL:", e.cause?.message ?? e.message);
    }

    try {
      const r2 = await db.execute(sql.raw(`SELECT id, transaction_date, status FROM bank_mutation_imports LIMIT 1`));
      console.log("bank_mutation_imports OK, sample:", JSON.stringify(r2.rows[0] ?? "empty"));
    } catch (e) {
      console.error("bank_mutation_imports FAIL:", e.cause?.message ?? e.message);
    }

    // Step 2: test UNION ALL sederhana
    try {
      const r3 = await db.execute(sql.raw(`
        SELECT id, transaction_date::text AS txdate FROM bank_mutations LIMIT 1
        UNION ALL
        SELECT id, transaction_date::text AS txdate FROM bank_mutation_imports LIMIT 1
      `));
      console.log("simple UNION ALL OK, rows:", r3.rows.length);
    } catch (e) {
      console.error("simple UNION ALL FAIL:", e.cause?.message ?? e.message);
    }

    // Step 3: test UNION ALL sama persis kolom tipe
    try {
      const r4 = await db.execute(sql.raw(`
        SELECT id, transaction_date FROM bank_mutations LIMIT 1
        UNION ALL
        SELECT id, transaction_date::text FROM bank_mutation_imports LIMIT 1
      `));
      console.log("type-mismatch UNION ALL OK");
    } catch (e) {
      console.error("type-mismatch UNION ALL FAIL:", e.cause?.message ?? e.message);
    }

    // Step 4: test correlated subquery candidates pada bank_mutations
    try {
      const r5 = await db.execute(sql.raw(`
        SELECT
          bm.id,
          (SELECT json_agg(to_jsonb(m)) FROM bank_reconciliation_matches m WHERE m.mutation_id = bm.id) AS candidates
        FROM bank_mutations bm LIMIT 1
      `));
      console.log("candidates subquery OK, rows:", r5.rows.length);
    } catch (e) {
      console.error("candidates subquery FAIL:", e.cause?.message ?? e.message);
    }

    // Step 5: test ap.source_type di accounting_payments
    try {
      const r6 = await db.execute(sql.raw(`
        SELECT id, source_type, payment_type, partner_name FROM accounting_payments LIMIT 1
      `));
      console.log("accounting_payments columns OK:", Object.keys(r6.rows[0] ?? {}));
    } catch (e) {
      console.error("accounting_payments columns FAIL:", e.cause?.message ?? e.message);
    }

    // Step 6: test full candidateDetailsSql (tanpa data)
    try {
      const r7 = await db.execute(sql.raw(`
        SELECT
          CASE 'accounting_payment'
            WHEN 'accounting_payment' THEN (
              SELECT jsonb_build_object(
                'amount', ap.amount,
                'date', ap.date,
                'name', ap.partner_name,
                'reference', ap.ref,
                'paymentNumber', ap.payment_number,
                'memo', ap.memo,
                'status', ap.status,
                'paymentType', ap.payment_type,
                'sourceType', ap.source_type
              )
              FROM accounting_payments ap
              WHERE ap.id = -999
            )
          END AS details
      `));
      console.log("candidateDetailsSql (AP) OK");
    } catch (e) {
      console.error("candidateDetailsSql (AP) FAIL:", e.cause?.message ?? e.message);
    }

    // Step 7: test kolom yang ada di bank_mutations
    try {
      const r8 = await db.execute(sql.raw(`
        SELECT column_name, data_type
        FROM information_schema.columns
        WHERE table_name = 'bank_mutations'
        ORDER BY ordinal_position
      `));
      console.log("bank_mutations columns:", r8.rows.map((r) => r.column_name + ":" + r.data_type).join(", "));
    } catch (e) {
      console.error("column_info FAIL:", e.cause?.message ?? e.message);
    }
  }, 60000);
});
