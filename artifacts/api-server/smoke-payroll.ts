import {
  db, cashAdvancesTable, employeesTable, payrollRunsTable, payrollItemsTable,
} from "@workspace/db";
import { eq, and, sql } from "drizzle-orm";
import { PayrollJournalService, resolvePayrollAccountMapping } from "./src/lib/payroll/PayrollJournalService.js";

const COMPANY_ID = 1;
const RUN_ID = 12; // created by test-payroll-smoke.mjs

function n(v: unknown) { return v == null ? 0 : Number(v); }
function normalizeName(s: string) { return s.trim().toLowerCase().replace(/\s+/g, " "); }

async function main() {
  const items = await db.select({ item: payrollItemsTable, employee: employeesTable })
    .from(payrollItemsTable)
    .leftJoin(employeesTable, eq(payrollItemsTable.employeeId, employeesTable.id))
    .where(eq(payrollItemsTable.runId, RUN_ID));
  console.log("items", items.length);

  const outstanding = await db.select().from(cashAdvancesTable)
    .where(and(eq(cashAdvancesTable.companyId, COMPANY_ID), sql`${cashAdvancesTable.status} IN ('active','partial')`));
  console.log("outstanding advances", outstanding.length);

  for (const { item, employee } of items) {
    if (!employee) continue;
    const fullName = normalizeName(`${employee.firstName} ${employee.lastName}`);
    const adv = outstanding.find((a) => normalizeName(a.partyName) === fullName && n(a.remainingAmount) > 0);
    console.log("employee", fullName, "matched advance?", !!adv, adv?.id);

    const gross = n(item.baseSalary) + n(item.allowance);
    const nonKasbon = n(item.bpjsJhtEmployee) + n(item.bpjsKesEmployee) + n(item.pph21) + n(item.otherDeductions);
    const payCapacity = Math.max(0, gross - nonKasbon);
    let deduction = 0, cashAdvanceId: number | null = null, kasbonBalanceAfter = 0;
    if (adv) {
      const remaining = n(adv.remainingAmount);
      const planned = adv.repaymentMethod === "installment" && adv.installmentAmount != null ? Number(adv.installmentAmount) : remaining;
      deduction = Math.min(planned, remaining, payCapacity);
      cashAdvanceId = adv.id;
      kasbonBalanceAfter = remaining - deduction;
    }
    const totalDeductions = nonKasbon + deduction;
    const netSalary = gross - totalDeductions;
    console.log("deduction", deduction, "netSalary", netSalary);

    await db.update(payrollItemsTable).set({
      kasbonDeduction: String(deduction), cashAdvanceId, totalDeductions: String(totalDeductions),
      netSalary: String(netSalary), kasbonBalanceAfter: String(kasbonBalanceAfter),
    }).where(eq(payrollItemsTable.id, item.id));
  }
  await db.update(payrollRunsTable).set({ status: "calculated" }).where(eq(payrollRunsTable.id, RUN_ID));
  console.log("Marked run as calculated");

  // ── approve: post accrual journal ──
  const mapping = await resolvePayrollAccountMapping(COMPANY_ID);
  console.log("mapping", mapping);
  if (!mapping) { console.error("MAPPING MISSING"); process.exit(1); }

  const items2 = await db.select().from(payrollItemsTable).where(eq(payrollItemsTable.runId, RUN_ID));
  const totalSalary = items2.reduce((s, i) => s + n(i.baseSalary), 0);
  const totalAllowance = items2.reduce((s, i) => s + n(i.allowance), 0);
  const totalTax = items2.reduce((s, i) => s + n(i.pph21), 0);
  const totalBpjs = items2.reduce((s, i) => s + n(i.bpjsJhtEmployee) + n(i.bpjsKesEmployee), 0);
  const totalSalaryPayable = items2.reduce((s, i) => s + n(i.netSalary), 0);
  const kasbonItems = items2.filter((i) => n(i.kasbonDeduction) > 0 && i.cashAdvanceId);
  const advanceIds = [...new Set(kasbonItems.map((i) => i.cashAdvanceId!))];
  const advances = advanceIds.length ? await db.select().from(cashAdvancesTable).where(sql`${cashAdvancesTable.id} IN ${advanceIds}`) : [];
  const advanceById = new Map(advances.map((a) => [a.id, a]));
  const kasbonByAccountMap = new Map<number, number>();
  for (const i of kasbonItems) {
    const adv = advanceById.get(i.cashAdvanceId!);
    if (!adv?.receivableAccountId) continue;
    kasbonByAccountMap.set(adv.receivableAccountId, (kasbonByAccountMap.get(adv.receivableAccountId) ?? 0) + n(i.kasbonDeduction));
  }
  const kasbonByAccount = [...kasbonByAccountMap.entries()].map(([accountId, amount]) => ({ accountId, amount }));
  console.log({ totalSalary, totalAllowance, totalTax, totalBpjs, totalSalaryPayable, kasbonByAccount });

  const { entryId } = await PayrollJournalService.postAccrualJournal(mapping, {
    companyId: COMPANY_ID, payrollRunId: RUN_ID, period: "2026-99", date: new Date(),
    totalSalary, totalAllowance, totalTax, totalBpjs, kasbonByAccount, totalSalaryPayable,
  });
  console.log("ACCRUAL ENTRY POSTED", entryId);

  await db.update(payrollRunsTable).set({ status: "approved", accountingEntryId: entryId, approvedAt: new Date(), postingStatus: "posted" }).where(eq(payrollRunsTable.id, RUN_ID));

  for (const i of kasbonItems) {
    const adv = advanceById.get(i.cashAdvanceId!);
    if (!adv) continue;
    const deduction = n(i.kasbonDeduction);
    const newRemaining = Math.max(0, n(adv.remainingAmount) - deduction);
    const newStatus = newRemaining <= 0.01 ? "repaid" : "partial";
    await db.update(cashAdvancesTable).set({
      paidAmount: String(n(adv.paidAmount) + deduction), settledAmount: String(n(adv.settledAmount) + deduction),
      remainingAmount: String(newRemaining), status: newStatus, repaidAt: newStatus === "repaid" ? new Date() : adv.repaidAt,
    }).where(eq(cashAdvancesTable.id, adv.id));
    console.log("Kasbon", adv.id, "new status", newStatus, "remaining", newRemaining);
  }

  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
