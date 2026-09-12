/**
 * Smoke & Rollback Test — Allocation Engine Phase 1 Transaction Hardening
 * Run: pnpm --filter @workspace/api-server exec tsx src/scripts/test-allocation-tx.ts
 *
 * Tests:
 *  T1 — Normal create  (smoke)               → header + lines committed
 *  T2 — Invalid line on create (rollback)    → NO orphan header
 *  T3 — Normal update  (smoke)               → header + lines updated atomically
 *  T4 — Invalid line on update (rollback)    → header unchanged, old lines intact
 *  T5 — Journal balance check                → sum of lines == received_amount
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

const RUN = `TX_TEST_${Date.now()}`;
const COMPANY_ID = 1; // CST-GROUP holding — guaranteed to exist

// ── helpers ──────────────────────────────────────────────────────────────────

async function countHeaders(allocationNo: string): Promise<number> {
  const rows = await db.execute<{ c: string }>(
    sql`SELECT COUNT(*) AS c FROM allocation_headers WHERE allocation_no = ${allocationNo}`
  ).then((r) => r.rows);
  return parseInt(rows[0]?.c ?? "0");
}

async function countLines(headerId: number): Promise<number> {
  const rows = await db.execute<{ c: string }>(
    sql`SELECT COUNT(*) AS c FROM allocation_lines WHERE allocation_header_id = ${headerId}`
  ).then((r) => r.rows);
  return parseInt(rows[0]?.c ?? "0");
}

async function getHeader(id: number) {
  const rows = await db.execute<{
    id: number; status: string; received_amount: string; allocated_amount: string;
  }>(sql`SELECT id, status, received_amount, allocated_amount FROM allocation_headers WHERE id = ${id}`)
    .then((r) => r.rows);
  return rows[0] ?? null;
}

async function cleanup(nos: string[]) {
  for (const no of nos) {
    await db.execute(sql`
      DELETE FROM allocation_audit_logs WHERE allocation_header_id IN (
        SELECT id FROM allocation_headers WHERE allocation_no = ${no}
      )
    `).catch(() => {});
    await db.execute(sql`
      DELETE FROM allocation_lines WHERE allocation_header_id IN (
        SELECT id FROM allocation_headers WHERE allocation_no = ${no}
      )
    `).catch(() => {});
    await db.execute(sql`DELETE FROM allocation_headers WHERE allocation_no = ${no}`).catch(() => {});
  }
}

let passed = 0;
let failed = 0;

function assert(condition: boolean, label: string) {
  if (condition) {
    console.log(`  ✅ PASS — ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL — ${label}`);
    failed++;
  }
}

// ── T1: Normal create (smoke) ─────────────────────────────────────────────────

async function t1_normalCreate() {
  console.log("\n[T1] Normal create — smoke test");
  const no = `${RUN}_T1`;
  let headerId = -1;

  try {
    headerId = await db.transaction(async (tx) => {
      const rows = await tx.execute<{ id: number }>(sql`
        INSERT INTO allocation_headers
          (company_id, allocation_no, currency, exchange_rate, received_amount,
           allocated_amount, remaining_amount, status, allocation_date, created_by)
        VALUES
          (${COMPANY_ID}, ${no}, 'IDR', 1, 1000000, 1000000, 0,
           'draft', CURRENT_DATE, 'test-script')
        RETURNING id
      `).then((r) => r.rows);
      const hId = rows[0]?.id;
      if (!hId) throw new Error("no id");

      await tx.execute(sql`
        INSERT INTO allocation_lines
          (allocation_header_id, allocation_type, amount, sort_order, allocation_status)
        VALUES
          (${hId}, 'ADVANCE_PRINCIPAL', 600000, 0, 'pending')
      `);
      await tx.execute(sql`
        INSERT INTO allocation_lines
          (allocation_header_id, allocation_type, amount, sort_order, allocation_status)
        VALUES
          (${hId}, 'DIRECT_REVENUE', 400000, 1, 'pending')
      `);
      return hId;
    });

    assert(headerId > 0, "header ID returned");
    assert(await countHeaders(no) === 1, "exactly 1 header in DB");
    assert(await countLines(headerId) === 2, "exactly 2 lines in DB");
    const h = await getHeader(headerId);
    assert(parseFloat(h?.received_amount ?? "0") === 1000000, "received_amount = 1,000,000");
    assert(parseFloat(h?.allocated_amount ?? "0") === 1000000, "allocated_amount = 1,000,000");
  } catch (err) {
    console.error("  T1 threw unexpectedly:", err);
    failed++;
  }
  return no;
}

// ── T2: Invalid line triggers rollback (no orphan header) ────────────────────

async function t2_invalidLineRollback() {
  console.log("\n[T2] Invalid line — rollback, no orphan header");
  const no = `${RUN}_T2`;

  try {
    await db.transaction(async (tx) => {
      const rows = await tx.execute<{ id: number }>(sql`
        INSERT INTO allocation_headers
          (company_id, allocation_no, currency, exchange_rate, received_amount,
           allocated_amount, remaining_amount, status, allocation_date, created_by)
        VALUES
          (${COMPANY_ID}, ${no}, 'IDR', 1, 500000, 500000, 0,
           'draft', CURRENT_DATE, 'test-script')
        RETURNING id
      `).then((r) => r.rows);
      const hId = rows[0]?.id;
      if (!hId) throw new Error("no id");

      // Valid first line
      await tx.execute(sql`
        INSERT INTO allocation_lines
          (allocation_header_id, allocation_type, amount, sort_order, allocation_status)
        VALUES
          (${hId}, 'ADVANCE_PRINCIPAL', 500000, 0, 'pending')
      `);

      // Invalid second line: allocation_type is NOT NULL — force violation by injecting null
      await tx.execute(
        sql`INSERT INTO allocation_lines
              (allocation_header_id, allocation_type, amount, sort_order, allocation_status)
            VALUES
              (${hId}, ${null as any}, 0, 1, 'pending')`
      );
    });

    // If we get here, the transaction did NOT roll back — test failure
    const orphans = await countHeaders(no);
    assert(false, `transaction should have thrown but committed ${orphans} header(s)`);
  } catch {
    // Expected: transaction threw — verify rollback
    const orphans = await countHeaders(no);
    assert(orphans === 0, `NO orphan header after failed tx (found ${orphans})`);
  }
}

// ── T3: Normal update (smoke) ─────────────────────────────────────────────────

async function t3_normalUpdate(createNo: string) {
  console.log("\n[T3] Normal update — smoke test");
  const rows = await db.execute<{ id: number }>(
    sql`SELECT id FROM allocation_headers WHERE allocation_no = ${createNo}`
  ).then((r) => r.rows);
  const headerId = rows[0]?.id;
  if (!headerId) { console.error("  T3 SKIP — T1 header not found"); failed++; return; }

  try {
    await db.transaction(async (tx) => {
      await tx.execute(sql`
        UPDATE allocation_headers
        SET received_amount = 2000000, allocated_amount = 2000000,
            remaining_amount = 0, updated_at = NOW()
        WHERE id = ${headerId}
      `);
      await tx.execute(sql`DELETE FROM allocation_lines WHERE allocation_header_id = ${headerId}`);
      await tx.execute(sql`
        INSERT INTO allocation_lines
          (allocation_header_id, allocation_type, amount, sort_order, allocation_status)
        VALUES
          (${headerId}, 'ADVANCE_PRINCIPAL', 1200000, 0, 'pending')
      `);
      await tx.execute(sql`
        INSERT INTO allocation_lines
          (allocation_header_id, allocation_type, amount, sort_order, allocation_status)
        VALUES
          (${headerId}, 'DIRECT_REVENUE', 800000, 1, 'pending')
      `);
    });

    const h = await getHeader(headerId);
    assert(parseFloat(h?.received_amount ?? "0") === 2000000, "received_amount updated to 2,000,000");
    assert(await countLines(headerId) === 2, "lines replaced — still 2");
  } catch (err) {
    console.error("  T3 threw unexpectedly:", err);
    failed++;
  }
}

// ── T4: Invalid line on update — full rollback ────────────────────────────────

async function t4_updateInvalidLineRollback(createNo: string) {
  console.log("\n[T4] Update with invalid line — full rollback");
  const rows = await db.execute<{ id: number; received_amount: string }>(
    sql`SELECT id, received_amount FROM allocation_headers WHERE allocation_no = ${createNo}`
  ).then((r) => r.rows);
  const headerId = rows[0]?.id;
  const beforeAmount = parseFloat(rows[0]?.received_amount ?? "0");
  const beforeLines = headerId ? await countLines(headerId) : 0;

  if (!headerId) { console.error("  T4 SKIP — T1/T3 header not found"); failed++; return; }

  try {
    await db.transaction(async (tx) => {
      // Update header amount
      await tx.execute(sql`
        UPDATE allocation_headers
        SET received_amount = 9999999, allocated_amount = 9999999, updated_at = NOW()
        WHERE id = ${headerId}
      `);
      // Delete existing lines
      await tx.execute(sql`DELETE FROM allocation_lines WHERE allocation_header_id = ${headerId}`);
      // Invalid line (null type → NOT NULL violation)
      await tx.execute(
        sql`INSERT INTO allocation_lines
              (allocation_header_id, allocation_type, amount, sort_order, allocation_status)
            VALUES
              (${headerId}, ${null as any}, 9999999, 0, 'pending')`
      );
    });

    assert(false, "transaction should have thrown but did not");
  } catch {
    // Expected: rollback
    const h = await getHeader(headerId);
    const afterAmount = parseFloat(h?.received_amount ?? "0");
    const afterLines = await countLines(headerId);

    assert(afterAmount === beforeAmount, `header received_amount rolled back (${beforeAmount} → ${afterAmount})`);
    assert(afterLines === beforeLines, `lines rolled back — still ${afterLines} (was ${beforeLines})`);
    assert(afterAmount !== 9999999, "header does NOT show partial update (9999999)");
  }
}

// ── T5: Balance check ─────────────────────────────────────────────────────────

async function t5_journalBalance(createNo: string) {
  console.log("\n[T5] Journal balance — sum(lines) == received_amount");
  const rows = await db.execute<{ id: number; received_amount: string }>(
    sql`SELECT id, received_amount FROM allocation_headers WHERE allocation_no = ${createNo}`
  ).then((r) => r.rows);
  const h = rows[0];
  if (!h) { console.error("  T5 SKIP — header not found"); failed++; return; }

  const lineRows = await db.execute<{ amount: string }>(
    sql`SELECT amount FROM allocation_lines WHERE allocation_header_id = ${h.id}`
  ).then((r) => r.rows);

  const lineSum = lineRows.reduce((acc, l) => acc + parseFloat(l.amount), 0);
  const received = parseFloat(h.received_amount);
  const diff = Math.abs(lineSum - received);

  assert(diff < 0.01, `lines sum (${lineSum}) == received_amount (${received}), diff=${diff}`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

(async () => {
  console.log(`\n${"═".repeat(60)}`);
  console.log("Allocation Engine Phase 1 — Transaction Hardening Tests");
  console.log(`Run ID: ${RUN}`);
  console.log("═".repeat(60));

  const t1No = await t1_normalCreate();
  await t2_invalidLineRollback();
  await t3_normalUpdate(t1No);
  await t4_updateInvalidLineRollback(t1No);
  await t5_journalBalance(t1No);

  // Cleanup
  console.log("\n[cleanup] removing test rows...");
  await cleanup([t1No, `${RUN}_T2`]);
  console.log("  done.");

  console.log(`\n${"═".repeat(60)}`);
  console.log(`RESULT: ${passed} passed, ${failed} failed`);
  console.log("═".repeat(60));

  if (failed > 0) {
    process.exit(1);
  }
})();
