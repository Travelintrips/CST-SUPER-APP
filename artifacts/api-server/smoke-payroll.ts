/**
 * Read-only payroll allocation smoke inspector.
 *
 * Usage:
 *   APP_ENV=development node load-secrets.mjs pnpm exec tsx smoke-payroll.ts <runId>
 *
 * The mutating fixture smoke test is test-payroll-smoke.mjs. This inspector
 * validates a calculated run's canonical allocation ledger without posting
 * journals or changing DEV data.
 */
import { db, payrollItemsTable, payrollRunsTable } from "@workspace/db";
import { and, eq, sql } from "drizzle-orm";

const companyId = Number(process.env.SMOKE_COMPANY_ID ?? 1);
const runId = Number(process.argv[2] ?? 0);
if (!Number.isInteger(runId) || runId <= 0) {
  throw new Error("Pass a payroll run id.");
}

const [run] = await db.select().from(payrollRunsTable).where(and(
  eq(payrollRunsTable.id, runId),
  eq(payrollRunsTable.companyId, companyId),
));
if (!run) throw new Error(`Payroll run ${runId} not found in company ${companyId}.`);

const items = await db.select().from(payrollItemsTable).where(eq(payrollItemsTable.runId, runId));
const allocationRows = await db.execute<{
  payroll_item_id: number;
  cash_advance_id: number;
  amount: string;
}>(sql`
  SELECT payroll_item_id, cash_advance_id, amount
  FROM payroll_cash_advance_allocations
  WHERE payroll_item_id IN (
    SELECT id FROM payroll_items WHERE run_id = ${runId}
  )
  ORDER BY payroll_item_id, id
`).then((result) => result.rows);

const byItem = new Map<number, typeof allocationRows>();
for (const row of allocationRows) {
  const list = byItem.get(row.payroll_item_id) ?? [];
  list.push(row);
  byItem.set(row.payroll_item_id, list);
}

for (const item of items) {
  const allocations = byItem.get(item.id) ?? [];
  const allocated = allocations.reduce((sum, row) => sum + Number(row.amount), 0);
  const deduction = Number(item.kasbonDeduction);
  if (Math.abs(allocated - deduction) > 0.01) {
    throw new Error(`Payroll item ${item.id}: allocation ${allocated} != deduction ${deduction}.`);
  }
  if (allocations.length > 1 && allocations[0].cash_advance_id !== item.cashAdvanceId) {
    throw new Error(`Payroll item ${item.id}: compatibility pointer is not the first FIFO allocation.`);
  }
}

console.log(JSON.stringify({
  runId,
  companyId,
  status: run.status,
  items: items.length,
  allocationRows: allocationRows.length,
  message: "Payroll allocation ledger is consistent.",
}, null, 2));