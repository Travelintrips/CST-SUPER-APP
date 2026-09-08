/**
 * Payroll — Cash Advance & Payroll Accounting Automation.
 *
 * Tables reused as-is: employees, payroll_runs, payroll_items (pre-existing).
 * Employee-linked advances use employee_id first; normalized party_name matching
 * remains only as a compatibility fallback for legacy rows.
 * Kasbon is matched to employees by employee_id first, with a unique normalized
 * name fallback for legacy rows that predate the employee_id column.
 * All journal postings go through PayrollJournalService — never postEntry() directly.
 */
import { Router } from "express";
import { eq, and, sql } from "drizzle-orm";
import {
  db, cashAdvancesTable, cashAdvanceRepaymentsTable, employeesTable, payrollRunsTable, payrollItemsTable,
  payrollCashAdvanceAllocationsTable,
} from "@workspace/db";
import { requireAdmin } from "../lib/requireAdmin.js";
import { resolveCompanyId } from "../lib/resolveCompany.js";
import { auditFromReq } from "../lib/auditLog.js";
import {
  PayrollJournalService, resolvePayrollAccountMapping,
} from "../lib/payroll/PayrollJournalService.js";
import { AccountingConfigError } from "../lib/advance/AdvanceErrors.js";
import { deriveStatusAfterPayment, mapToLegacyStatus } from "../lib/advance/AdvanceStateMachine.js";

const router = Router();

const MAPPING_ERROR = "Accounting Mapping belum lengkap. Lengkapi pemetaan akun payroll di Pengaturan Akuntansi (Salary Expense, Allowance Expense, Salary Payable, Tax Payable, BPJS Payable).";
const PAYROLL_CLAIM_TIMEOUT_MINUTES = 15;

export async function runPayrollPostingClaimMigration(): Promise<void> {
  await db.execute(sql`
    ALTER TABLE payroll_runs
    ADD COLUMN IF NOT EXISTS posting_claimed_at TIMESTAMP
  `);
}

type PayrollPostingPhase = "approval" | "payment";

/**
 * A process can die after claiming a run but before persisting the entry id.
 * The accounting hub is idempotent by (source, source_id), so a stale claim
 * can be reopened safely after checking whether that journal already exists.
 */
export async function recoverStalePayrollClaim(
  companyId: number,
  runId: number,
  phase: PayrollPostingPhase,
): Promise<void> {
  const status = phase === "approval" ? "calculated" : "approved";
  const source = phase === "approval" ? "payroll" : "hrd_salary_payment";
  const staleMessage = phase === "approval"
    ? "Payroll approval claim expired; retry will reuse any existing accrual journal."
    : "Payroll payment claim expired; retry will reuse any existing payment journal.";

  await db.execute(sql`
    UPDATE payroll_runs
    SET posting_status = 'error',
        posting_error = CASE
          WHEN EXISTS (
            SELECT 1
            FROM accounting_entries ae
            WHERE ae.company_id = ${companyId}
              AND ae.source = ${source}
              AND ae.source_id = ${runId}
          )
          THEN ${`${staleMessage} Existing journal detected.`}
          ELSE ${staleMessage}
        END,
        posting_claimed_at = NULL
    WHERE id = ${runId}
      AND company_id = ${companyId}
      AND status = ${status}
      AND posting_status = 'processing'
      AND posting_claimed_at IS NOT NULL
      AND posting_claimed_at < NOW() - (${PAYROLL_CLAIM_TIMEOUT_MINUTES} * INTERVAL '1 minute')
      AND ${phase === "approval"
        ? sql`accounting_entry_id IS NULL`
        : sql`payment_entry_id IS NULL`}
  `);
}

function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function n(v: unknown): number {
  return v == null ? 0 : Number(v);
}

function sortOutstandingAdvances<T extends { date: unknown; id: number }>(advances: T[]): T[] {
  return [...advances].sort((a, b) => {
    const dateOrder = String(a.date ?? "").localeCompare(String(b.date ?? ""));
    return dateOrder || a.id - b.id;
  });
}

function resolveAdvanceForEmployee(
  advances: Array<{
    id: number;
    employeeId: number | null;
    responsibleEmployeeId: string | null;
    partyName: string;
    date: unknown;
    remainingAmount: string;
    repaymentMethod: string;
    installmentAmount: string | null;
  }>,
  employee: { id: number; firstName: string; lastName: string },
) {
  const eligible = advances.filter((a) => n(a.remainingAmount) > 0);
  const explicit = eligible.filter((a) =>
    (a.employeeId != null && String(a.employeeId) === String(employee.id)) ||
    (a.responsibleEmployeeId != null && String(a.responsibleEmployeeId) === String(employee.id)),
  );
  if (explicit.length) return sortOutstandingAdvances(explicit)[0] ?? null;

  // Legacy fallback is safe only when the name identifies one outstanding
  // advance. Never guess between multiple same-name advances.
  const fullName = normalizeName(`${employee.firstName} ${employee.lastName}`);
  const byName = eligible.filter((a) => normalizeName(a.partyName) === fullName);
  return byName.length === 1 ? byName[0] : null;
}

function payrollRunIntegrityError(run: {
  status: string;
  postingStatus: string;
  accountingEntryId: number | null;
  paymentEntryId: number | null;
}): string | null {
  if (run.postingStatus === "posted" && !run.accountingEntryId) {
    return "Payroll ditandai posted tetapi journal accrual belum terhubung.";
  }
  if (run.status === "approved" && !run.accountingEntryId) {
    return "Payroll approved tetapi journal accrual belum terhubung.";
  }
  if (run.status === "paid" && (!run.accountingEntryId || !run.paymentEntryId)) {
    return "Payroll paid tetapi journal accrual atau journal pembayaran belum lengkap.";
  }
  return null;
}

async function assertPostedAccountingEntry(entryId: number | null | undefined, companyId: number, label: string): Promise<void> {
  if (!Number.isInteger(entryId) || Number(entryId) <= 0) {
    throw new Error(`${label}: journal entry belum terhubung.`);
  }
  const result = await db.execute<{ id: number }>(sql`
    SELECT id
    FROM accounting_entries
    WHERE id = ${Number(entryId)}
      AND company_id = ${companyId}
      AND status = 'posted'
    LIMIT 1
  `);
  if (!result.rows.length) {
    throw new Error(`${label}: journal entry tidak ditemukan atau belum posted.`);
  }
}

async function loadRunWithItems(runId: number, companyId: number) {
  const [run] = await db.select().from(payrollRunsTable)
    .where(and(eq(payrollRunsTable.id, runId), eq(payrollRunsTable.companyId, companyId)));
  if (!run) return null;
  const items = await db.select({
    item: payrollItemsTable,
    employee: employeesTable,
  }).from(payrollItemsTable)
    .leftJoin(employeesTable, eq(payrollItemsTable.employeeId, employeesTable.id))
    .where(eq(payrollItemsTable.runId, runId));
  return { run, items, integrityError: payrollRunIntegrityError(run) };
}

// ── GET /api/payroll/runs ──────────────────────────────────────────────────────
router.get("/runs", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const companyId = resolveCompanyId(req);
  const runs = await db.select().from(payrollRunsTable)
    .where(eq(payrollRunsTable.companyId, companyId))
    .orderBy(sql`year desc, month desc, id desc`);
  res.json({
    runs: runs.map((run) => ({
      ...run,
      integrityError: payrollRunIntegrityError(run),
    })),
  });
});

// ── POST /api/payroll/runs — create draft run ─────────────────────────────────
router.post("/runs", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const companyId = resolveCompanyId(req);
  const { month, year, notes } = req.body ?? {};
  if (!month || !year) {
    res.status(400).json({ message: "month dan year wajib diisi" });
    return;
  }
  const existing = await db.select({ id: payrollRunsTable.id }).from(payrollRunsTable)
    .where(and(eq(payrollRunsTable.companyId, companyId), eq(payrollRunsTable.month, Number(month)), eq(payrollRunsTable.year, Number(year))));
  if (existing.length) {
    res.status(409).json({ message: `Payroll run untuk periode ${month}/${year} sudah ada.` });
    return;
  }
  const [run] = await db.insert(payrollRunsTable).values({
    companyId, month: Number(month), year: Number(year), notes: notes ?? null, status: "draft",
  }).returning();
  auditFromReq(req, { action: "payroll_run_created", module: "payroll", referenceId: String(run.id), newData: run });
  res.json({ run });
});

// ── GET /api/payroll/runs/:id ──────────────────────────────────────────────────
router.get("/runs/:id", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const companyId = resolveCompanyId(req);
  const data = await loadRunWithItems(Number(req.params.id), companyId);
  if (!data) { res.status(404).json({ message: "Payroll run tidak ditemukan" }); return; }
  res.json(data);
});

// ── POST /api/payroll/runs/:id/generate-items — pull active employees ────────
router.post("/runs/:id/generate-items", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const companyId = resolveCompanyId(req);
  const runId = Number(req.params.id);
  const [run] = await db.select().from(payrollRunsTable)
    .where(and(eq(payrollRunsTable.id, runId), eq(payrollRunsTable.companyId, companyId)));
  if (!run) { res.status(404).json({ message: "Payroll run tidak ditemukan" }); return; }
  if (run.status !== "draft") { res.status(400).json({ message: "Hanya payroll run status draft yang bisa digenerate ulang." }); return; }

  const emps = await db.select().from(employeesTable)
    .where(and(eq(employeesTable.companyId, companyId), eq(employeesTable.status, "active"), sql`${employeesTable.deletedAt} IS NULL`));

  const existingItems = await db.select({ employeeId: payrollItemsTable.employeeId }).from(payrollItemsTable)
    .where(eq(payrollItemsTable.runId, runId));
  const already = new Set(existingItems.map((i) => i.employeeId));

  const toInsert = emps.filter((e) => !already.has(e.id)).map((e) => {
    const base = n(e.salary);
    return {
      runId, employeeId: e.id, baseSalary: String(base), allowance: "0", grossSalary: String(base),
      bpjsJhtEmployee: "0", bpjsKesEmployee: "0", pph21: "0", kasbonDeduction: "0", otherDeductions: "0",
      totalDeductions: "0", netSalary: String(base), kasbonBalanceAfter: "0",
    };
  });
  if (toInsert.length) await db.insert(payrollItemsTable).values(toInsert);
  const data = await loadRunWithItems(runId, companyId);
  res.json({ added: toInsert.length, ...data });
});

// ── PATCH /api/payroll/runs/:id/items/:itemId — edit an item while draft ─────
router.patch("/runs/:id/items/:itemId", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const companyId = resolveCompanyId(req);
  const runId = Number(req.params.id);
  const [run] = await db.select().from(payrollRunsTable)
    .where(and(eq(payrollRunsTable.id, runId), eq(payrollRunsTable.companyId, companyId)));
  if (!run) { res.status(404).json({ message: "Payroll run tidak ditemukan" }); return; }
  if (run.status !== "draft") { res.status(400).json({ message: "Item hanya bisa diedit saat status draft." }); return; }

  const { baseSalary, allowance, bpjsJhtEmployee, bpjsKesEmployee, pph21, otherDeductions } = req.body ?? {};
  const [item] = await db.select().from(payrollItemsTable)
    .where(and(eq(payrollItemsTable.id, Number(req.params.itemId)), eq(payrollItemsTable.runId, runId)));
  if (!item) { res.status(404).json({ message: "Item tidak ditemukan" }); return; }

  const base = baseSalary != null ? Number(baseSalary) : n(item.baseSalary);
  const allow = allowance != null ? Number(allowance) : n(item.allowance);
  const bpjsJht = bpjsJhtEmployee != null ? Number(bpjsJhtEmployee) : n(item.bpjsJhtEmployee);
  const bpjsKes = bpjsKesEmployee != null ? Number(bpjsKesEmployee) : n(item.bpjsKesEmployee);
  const tax = pph21 != null ? Number(pph21) : n(item.pph21);
  const other = otherDeductions != null ? Number(otherDeductions) : n(item.otherDeductions);
  const gross = base + allow;
  const kasbon = n(item.kasbonDeduction); // untouched here — set by /calculate
  const totalDed = bpjsJht + bpjsKes + tax + kasbon + other;
  const net = gross - totalDed;

  const [updated] = await db.update(payrollItemsTable).set({
    baseSalary: String(base), allowance: String(allow), grossSalary: String(gross),
    bpjsJhtEmployee: String(bpjsJht), bpjsKesEmployee: String(bpjsKes), pph21: String(tax),
    otherDeductions: String(other), totalDeductions: String(totalDed), netSalary: String(net),
  }).where(eq(payrollItemsTable.id, item.id)).returning();
  res.json({ item: updated });
});

// ── POST /api/payroll/runs/:id/calculate — allocate outstanding kasbon FIFO ────
router.post("/runs/:id/calculate", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const companyId = resolveCompanyId(req);
  const runId = Number(req.params.id);
  const [run] = await db.select().from(payrollRunsTable)
    .where(and(eq(payrollRunsTable.id, runId), eq(payrollRunsTable.companyId, companyId)));
  if (!run) { res.status(404).json({ message: "Payroll run tidak ditemukan" }); return; }
  if (run.status !== "draft" && run.status !== "calculated") {
    res.status(400).json({ message: "Payroll run harus berstatus draft atau calculated untuk dihitung ulang." });
    return;
  }

  const items = await db.select({ item: payrollItemsTable, employee: employeesTable })
    .from(payrollItemsTable)
    .leftJoin(employeesTable, eq(payrollItemsTable.employeeId, employeesTable.id))
    .where(eq(payrollItemsTable.runId, runId));

  // Sertakan status legacy dan canonical agar data lama tetap terbaca.
  const outstanding = await db.select().from(cashAdvancesTable)
    .where(and(
      eq(cashAdvancesTable.companyId, companyId),
      sql`(${cashAdvancesTable.status} IN ('active', 'partial')
        OR lifecycle_status IN ('outstanding', 'partially_settled', 'disbursed'))`,
    ));

  const schedules = outstanding.length
    ? await db.execute<{
        id: number; advance_id: number; installment_number: number; amount: string; status: string;
      }>(sql`
        SELECT id, advance_id, installment_number, amount, status
        FROM cash_advance_installment_schedules
        WHERE advance_id IN ${outstanding.map((a) => a.id)}
          AND status IN ('pending', 'overdue')
        ORDER BY advance_id, installment_number
      `).then((r) => r.rows)
    : [];
  const schedulesByAdvance = new Map<number, typeof schedules>();
  for (const schedule of schedules) {
    const list = schedulesByAdvance.get(schedule.advance_id) ?? [];
    list.push(schedule);
    schedulesByAdvance.set(schedule.advance_id, list);
  }

  const results: Array<{
    itemId: number; matched: boolean; deduction: number; cashAdvanceId: number | null;
    allocations: Array<{ cashAdvanceId: number; amount: number; installmentScheduleId: number | null }>;
  }> = [];

  // Recalculation is authoritative for a draft/calculated run. Remove the
  // previous allocation snapshot before writing the new one.
  await db.transaction(async (tx) => {
    await tx.execute(sql`
      DELETE FROM payroll_cash_advance_allocations
      WHERE payroll_item_id IN (SELECT id FROM payroll_items WHERE run_id = ${runId})
    `);

    for (const { item, employee } of items) {
      const gross = n(item.baseSalary) + n(item.allowance);
      const nonKasbonDeductions = n(item.bpjsJhtEmployee) + n(item.bpjsKesEmployee) + n(item.otherDeductions) + n(item.pph21);
      let capacity = Math.max(0, gross - nonKasbonDeductions);
      const allocations: Array<{ cashAdvanceId: number; amount: number; installmentScheduleId: number | null }> = [];

      if (employee && capacity > 0) {
        const fullName = normalizeName(`${employee.firstName} ${employee.lastName}`);
        // Prefer the durable employee_id link. Name matching is retained only
        // for historical rows that predate the relational link.
        const direct = outstanding.filter((a) => a.employeeId === employee.id);
        const candidates = (direct.length
          ? direct
          : outstanding.filter((a) => !a.employeeId && normalizeName(a.partyName) === fullName))
          .filter((a) => n(a.remainingAmount) > 0)
          .sort((a, b) => String(a.date).localeCompare(String(b.date)) || a.id - b.id);

        for (const adv of candidates) {
          if (capacity <= 0) break;
          const remaining = n(adv.remainingAmount);
          const schedule = schedulesByAdvance.get(adv.id)?.[0] ?? null;
          const planned = schedule
            ? n(schedule.amount)
            : adv.repaymentMethod === "installment" && adv.installmentAmount != null
              ? Number(adv.installmentAmount)
              : remaining;
          const amount = Math.min(planned, remaining, capacity);
          if (amount <= 0) continue;
          allocations.push({
            cashAdvanceId: adv.id,
            amount,
            installmentScheduleId: schedule?.id ?? null,
          });
          capacity -= amount;
        }
      }

      const deduction = allocations.reduce((sum, allocation) => sum + allocation.amount, 0);
      const totalDeductions = nonKasbonDeductions + deduction;
      const netSalary = gross - totalDeductions;
      const allocatedIds = new Set(allocations.map((allocation) => allocation.cashAdvanceId));
      const balanceAfter = outstanding
        .filter((advance) => allocatedIds.has(advance.id))
        .reduce((sum, advance) => {
          const allocated = allocations
            .filter((allocation) => allocation.cashAdvanceId === advance.id)
            .reduce((inner, allocation) => inner + allocation.amount, 0);
          return sum + Math.max(0, n(advance.remainingAmount) - allocated);
        }, 0);

      await tx.update(payrollItemsTable).set({
        kasbonDeduction: String(deduction),
        cashAdvanceId: allocations[0]?.cashAdvanceId ?? null,
        totalDeductions: String(totalDeductions),
        netSalary: String(netSalary),
        kasbonBalanceAfter: String(balanceAfter),
      }).where(eq(payrollItemsTable.id, item.id));

      if (allocations.length) {
        await tx.insert(payrollCashAdvanceAllocationsTable).values(
          allocations.map((allocation) => ({
            payrollItemId: item.id,
            cashAdvanceId: allocation.cashAdvanceId,
            installmentScheduleId: allocation.installmentScheduleId,
            amount: String(allocation.amount),
          })),
        );
      }

      results.push({
        itemId: item.id,
        matched: allocations.length > 0,
        deduction,
        cashAdvanceId: allocations[0]?.cashAdvanceId ?? null,
        allocations,
      });
    }
  });

  await db.update(payrollRunsTable).set({ status: "calculated" }).where(eq(payrollRunsTable.id, runId));
  auditFromReq(req, { action: "payroll_run_calculated", module: "payroll", referenceId: String(runId), newData: { results } });
  const data = await loadRunWithItems(runId, companyId);
  res.json({ results, ...data });
});

// ── POST /api/payroll/runs/:id/approve — post accrual journal + settle kasbon ──
router.post("/runs/:id/approve", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const companyId = resolveCompanyId(req);
  const runId = Number(req.params.id);
  await recoverStalePayrollClaim(companyId, runId, "approval");
  const [run] = await db.select().from(payrollRunsTable)
    .where(and(eq(payrollRunsTable.id, runId), eq(payrollRunsTable.companyId, companyId)));
  if (!run) { res.status(404).json({ message: "Payroll run tidak ditemukan" }); return; }
  if (run.status !== "calculated") { res.status(400).json({ message: "Payroll run harus dihitung (calculate) sebelum diapprove." }); return; }

  const mapping = await resolvePayrollAccountMapping(companyId);
  if (!mapping) { res.status(400).json({ message: MAPPING_ERROR }); return; }

  const items = await db.select().from(payrollItemsTable).where(eq(payrollItemsTable.runId, runId));
  if (!items.length) { res.status(400).json({ message: "Payroll run tidak memiliki item." }); return; }

  const unlinkedKasbon = items.filter((i) => n(i.kasbonDeduction) > 0 && !i.cashAdvanceId);
  if (unlinkedKasbon.length) {
    res.status(409).json({
      message: "Payroll memiliki potongan kasbon tanpa sumber kasbon. Jalankan Hitung Ulang sebelum approve.",
      itemIds: unlinkedKasbon.map((i) => i.id),
    });
    return;
  }

  const totalSalary = items.reduce((s, i) => s + n(i.baseSalary), 0);
  const totalAllowance = items.reduce((s, i) => s + n(i.allowance), 0);
  const totalTax = items.reduce((s, i) => s + n(i.pph21), 0);
  const totalBpjs = items.reduce((s, i) => s + n(i.bpjsJhtEmployee) + n(i.bpjsKesEmployee), 0);
  const totalSalaryPayable = items.reduce((s, i) => s + n(i.netSalary), 0);

  const allocationRows = await db.execute<{
    payroll_item_id: number;
    cash_advance_id: number;
    installment_schedule_id: number | null;
    amount: string;
  }>(sql`
    SELECT a.payroll_item_id, a.cash_advance_id, a.installment_schedule_id, a.amount
    FROM payroll_cash_advance_allocations a
    JOIN payroll_items pi ON pi.id = a.payroll_item_id
    JOIN cash_advances ca ON ca.id = a.cash_advance_id AND ca.company_id = ${companyId}
    WHERE pi.run_id = ${runId}
    ORDER BY a.payroll_item_id, a.id
  `).then((r) => r.rows);

  // Compatibility for runs calculated before the allocation ledger existed.
  const allocationsByItem = new Map<number, typeof allocationRows>();
  for (const allocation of allocationRows) {
    const list = allocationsByItem.get(allocation.payroll_item_id) ?? [];
    list.push(allocation);
    allocationsByItem.set(allocation.payroll_item_id, list);
  }
  for (const item of items) {
    if (n(item.kasbonDeduction) > 0 && item.cashAdvanceId && !allocationsByItem.has(item.id)) {
      allocationsByItem.set(item.id, [{
        payroll_item_id: item.id,
        cash_advance_id: item.cashAdvanceId,
        installment_schedule_id: null,
        amount: String(item.kasbonDeduction),
      }]);
    }
  }

  const allAllocations = [...allocationsByItem.values()].flat();
  const advanceIds = [...new Set(allAllocations.map((allocation) => allocation.cash_advance_id))];
  const advances = advanceIds.length
    ? await db.select().from(cashAdvancesTable).where(sql`
        ${cashAdvancesTable.companyId} = ${companyId}
        AND ${cashAdvancesTable.id} IN ${advanceIds}
      `)
    : [];
  if (allAllocations.length && advances.length !== advanceIds.length) {
    res.status(400).json({ message: "Alokasi kasbon payroll mengacu pada kasbon yang tidak ditemukan dalam perusahaan aktif.", code: "INVALID_CASH_ADVANCE_ALLOCATION" });
    return;
  }
  const advanceById = new Map(advances.map((a) => [a.id, a]));
  const invalidAllocation = allAllocations.find((allocation) => {
    const advance = advanceById.get(allocation.cash_advance_id);
    return !advance || n(allocation.amount) <= 0 || n(allocation.amount) > n(advance.remainingAmount) + 0.01;
  });
  if (invalidAllocation) {
    res.status(409).json({ message: "Potongan kasbon melebihi saldo outstanding saat approval payroll.", code: "CASH_ADVANCE_BALANCE_CHANGED" });
    return;
  }
  const kasbonByAccountMap = new Map<number, number>();
  for (const allocation of allAllocations) {
    const adv = advanceById.get(allocation.cash_advance_id);
    if (!adv?.receivableAccountId) {
      res.status(409).json({ message: `COA piutang kasbon ${allocation.cash_advance_id} belum terisi.` });
      return;
    }
    kasbonByAccountMap.set(
      adv.receivableAccountId,
      (kasbonByAccountMap.get(adv.receivableAccountId) ?? 0) + n(allocation.amount),
    );
  }
  const kasbonByAccount = [...kasbonByAccountMap.entries()].map(([accountId, amount]) => ({ accountId, amount }));

  // Claim only after all read-only validation has passed; a rejected request
  // must not leave the run stuck in a transient processing state.
  const [approvalClaim] = await db.update(payrollRunsTable).set({
    postingStatus: "processing",
    postingError: null,
    postingClaimedAt: new Date(),
  }).where(and(
    eq(payrollRunsTable.id, runId),
    eq(payrollRunsTable.companyId, companyId),
    eq(payrollRunsTable.status, "calculated"),
    sql`${payrollRunsTable.accountingEntryId} IS NULL`,
    sql`${payrollRunsTable.postingStatus} <> 'processing'`,
  )).returning({ id: payrollRunsTable.id });
  if (!approvalClaim) {
    res.status(409).json({ message: "Payroll run sedang diproses atau sudah memiliki jurnal accrual.", code: "PAYROLL_APPROVAL_IN_PROGRESS" });
    return;
  }

  const period = `${run.year}-${String(run.month).padStart(2, "0")}`;

  try {
    const { entryId } = await PayrollJournalService.postAccrualJournal(mapping, {
      companyId, payrollRunId: runId, period, date: new Date(),
      totalSalary, totalAllowance, totalTax, totalBpjs, kasbonByAccount, totalSalaryPayable,
    });
    await assertPostedAccountingEntry(entryId, companyId, "Journal accrual payroll");

    await db.transaction(async (tx) => {
      await tx.update(payrollRunsTable).set({
        status: "approved", accountingEntryId: entryId, approvedAt: new Date(),
        postingStatus: "posted", postingError: null, postingClaimedAt: null,
      }).where(eq(payrollRunsTable.id, runId));

      const now = new Date();
      // Tanggal efektif posting: tanggal aktual approve (bukan 1 bulan periode)
      // agar cocok dengan tanggal journal entry dan tidak mismatch di rekonsiliasi
      const repaymentDate = now.toISOString().slice(0, 10);

       for (const allocation of allAllocations) {
         const [lockedAdvance] = await tx.execute<any>(sql`
           SELECT id, paid_amount, settled_amount, remaining_amount, repaid_at
           FROM cash_advances
           WHERE id = ${allocation.cash_advance_id} AND company_id = ${companyId}
           FOR UPDATE
         `).then((r) => r.rows);
         if (!lockedAdvance) throw new Error("Kasbon payroll tidak ditemukan dalam company scope.");
         const deduction = n(allocation.amount);
         const currentRemaining = n(lockedAdvance.remaining_amount);
         if (deduction > currentRemaining + 0.01) {
           throw new Error("Saldo kasbon berubah sebelum approval payroll.");
         }
         const newPaid = n(lockedAdvance.paid_amount) + deduction;
         const newSettled = n(lockedAdvance.settled_amount) + deduction;
         const newRemaining = Math.max(0, currentRemaining - deduction);

        // Pakai threshold yang sama dengan AdvanceStateMachine.deriveStatusAfterPayment (<= 0.005)
        const newLifecycleStatus = deriveStatusAfterPayment(newRemaining);
        const isFullyRepaid = newLifecycleStatus === "settled";
         const newStatus = mapToLegacyStatus(newLifecycleStatus);

        await tx.execute(sql`
          UPDATE cash_advances SET
            paid_amount          = ${String(newPaid)},
            settled_amount       = ${String(newSettled)},
            remaining_amount     = ${String(newRemaining)},
            status               = ${newStatus},
            lifecycle_status     = ${newLifecycleStatus},
            repayment_journal_id = ${entryId},
             repaid_at            = ${isFullyRepaid ? now : (lockedAdvance.repaid_at ?? null)},
            updated_at           = ${now}
           WHERE id = ${allocation.cash_advance_id} AND company_id = ${companyId}
        `);

         const repayment = await tx.insert(cashAdvanceRepaymentsTable).values({
           advanceId:     allocation.cash_advance_id,
          amount:        String(deduction),
          paymentMethod: "payroll",
          date:          repaymentDate,
          notes:         `Potongan Payroll ${period}`,
          entryId,
         }).returning({ id: cashAdvanceRepaymentsTable.id });

         if (allocation.installment_schedule_id) {
           const scheduleUpdate = await tx.execute(sql`
             UPDATE cash_advance_installment_schedules
             SET status = 'paid',
                 repayment_id = ${repayment[0]?.id ?? null},
                 paid_date = ${repaymentDate},
                 paid_amount = ${deduction},
                 accounting_entry_id = ${entryId},
                 payroll_item_id = ${allocation.payroll_item_id},
                 updated_at = NOW()
             WHERE id = ${allocation.installment_schedule_id}
               AND advance_id = ${allocation.cash_advance_id}
               AND status IN ('pending', 'overdue')
           `);
           if ((scheduleUpdate.rowCount ?? 0) !== 1) {
             throw new Error("Jadwal cicilan kasbon sudah berubah sebelum approval payroll.");
           }
         }
      }
    });

    auditFromReq(req, { action: "payroll_run_approved", module: "payroll", referenceId: String(runId), newData: { entryId, totalSalaryPayable } });
    const data = await loadRunWithItems(runId, companyId);
    res.json({ entryId, ...data });
  } catch (err) {
    const message = err instanceof AccountingConfigError ? err.message : "Gagal memposting jurnal payroll.";
    await db.update(payrollRunsTable).set({
      postingStatus: "error", postingError: message, postingClaimedAt: null,
    }).where(eq(payrollRunsTable.id, runId));
    res.status(400).json({ message });
  }
});

// ── POST /api/payroll/runs/:id/pay — post payment journal ────────────────────
router.post("/runs/:id/pay", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const companyId = resolveCompanyId(req);
  const runId = Number(req.params.id);
  await recoverStalePayrollClaim(companyId, runId, "payment");
  const [run] = await db.select().from(payrollRunsTable)
    .where(and(eq(payrollRunsTable.id, runId), eq(payrollRunsTable.companyId, companyId)));
  if (!run) { res.status(404).json({ message: "Payroll run tidak ditemukan" }); return; }
  if (run.status !== "approved") { res.status(400).json({ message: "Payroll run harus diapprove sebelum dibayar." }); return; }
  const integrityError = payrollRunIntegrityError(run);
  if (integrityError || run.postingStatus !== "posted" || !run.accountingEntryId) {
    res.status(409).json({
      message: integrityError ?? "Payroll belum memiliki journal accrual yang posted.",
    });
    return;
  }
  try {
    await assertPostedAccountingEntry(run.accountingEntryId, companyId, "Journal accrual payroll");
  } catch (err) {
    res.status(409).json({ message: err instanceof Error ? err.message : "Journal accrual payroll tidak valid." });
    return;
  }

  const mapping = await resolvePayrollAccountMapping(companyId);
  if (!mapping) { res.status(400).json({ message: MAPPING_ERROR }); return; }

  const [settings] = await db.execute<{ default_bank_account_id: number | null }>(sql`
    SELECT default_bank_account_id FROM accounting_settings WHERE company_id = ${companyId} LIMIT 1
  `).then((r) => r.rows);
  const cashBankAccountId = settings?.default_bank_account_id;
  if (!cashBankAccountId) { res.status(400).json({ message: "Akun Kas/Bank belum dikonfigurasi." }); return; }

  const items = await db.select().from(payrollItemsTable).where(eq(payrollItemsTable.runId, runId));
  if (!items.length) { res.status(400).json({ message: "Payroll run tidak memiliki item." }); return; }
  const [paymentClaim] = await db.update(payrollRunsTable).set({
    postingStatus: "processing",
    postingError: null,
    postingClaimedAt: new Date(),
  }).where(and(
    eq(payrollRunsTable.id, runId),
    eq(payrollRunsTable.companyId, companyId),
    eq(payrollRunsTable.status, "approved"),
    sql`${payrollRunsTable.paymentEntryId} IS NULL`,
    sql`${payrollRunsTable.postingStatus} <> 'processing'`,
  )).returning({ id: payrollRunsTable.id });
  if (!paymentClaim) {
    res.status(409).json({ message: "Payroll run sedang dibayar atau sudah memiliki jurnal pembayaran.", code: "PAYROLL_PAYMENT_IN_PROGRESS" });
    return;
  }
  const amount = items.reduce((s, i) => s + n(i.netSalary), 0);
  const period = `${run.year}-${String(run.month).padStart(2, "0")}`;
  const evidenceResult = await db.execute<{
    mutation_id: number;
    payment_id: number;
    transaction_date: string;
  }>(sql`
    SELECT bm.id AS mutation_id, ap.id AS payment_id, bm.transaction_date
    FROM bank_mutations bm
    JOIN accounting_payments ap ON ap.id = bm.matched_payment_id
    JOIN bank_reconciliation_matches brm
      ON brm.mutation_id = bm.id
     AND brm.candidate_type = 'accounting_payment'
     AND brm.candidate_id = ap.id
     AND brm.status = 'approved'
    WHERE bm.company_id = ${companyId}
      AND bm.direction = 'OUT'
      AND bm.status IN ('matched', 'posted')
      AND bm.linked_transaction_type = 'accounting_payment'
      AND bm.linked_transaction_id = ap.id
      AND ap.company_id = ${companyId}
      AND ap.status = 'posted'
      AND (
        (ap.source_type = 'payroll' AND ap.source_doc_id = ${runId})
        OR (ap.source_type = 'hrd_salary_payment' AND ap.source_id = ${runId})
      )
      AND bm.amount::numeric = (
        SELECT COALESCE(SUM(pi.net_salary), 0)::numeric
        FROM payroll_items pi
        WHERE pi.run_id = ${runId}
      )
      AND ap.amount::numeric = (
        SELECT COALESCE(SUM(pi.net_salary), 0)::numeric
        FROM payroll_items pi
        WHERE pi.run_id = ${runId}
      )
    ORDER BY bm.id
  `);
  if (evidenceResult.rows.length !== 1) {
    res.status(409).json({
      message: "Pembayaran payroll ditahan: harus ada tepat satu bank/payment evidence yang approved, linked ke run, dan nominalnya sama persis.",
      code: "PAYROLL_PAYMENT_EVIDENCE_NOT_UNIQUE",
      evidenceCount: evidenceResult.rows.length,
    });
    return;
  }

  try {
    const paidBy = (req.user as { id?: string } | undefined)?.id ?? null;
    await db.transaction(async (tx) => {
      await tx.update(payrollRunsTable).set({
        status: "paid", paymentEntryId: entryId, postedAt: new Date(),
        postingStatus: "posted", postingError: null, postingClaimedAt: null, paymentMethod,
      }).where(eq(payrollRunsTable.id, runId));
      await tx.update(payrollItemsTable).set({ isPaid: true, paidAt: new Date(), paidBy }).where(eq(payrollItemsTable.runId, runId));
       // Keep the per-employee salary history in the existing salary_payments
       // table. The NOT EXISTS guard makes a retry after a partial request
       // idempotent for each payroll item.
       await tx.execute(sql`
         INSERT INTO salary_payments
           (payroll_item_id, amount, payment_method, paid_at, paid_by, notes)
         SELECT pi.id, pi.net_salary, ${paymentMethod}, NOW(), ${paidBy},
                ${`Payroll ${period}`}
         FROM payroll_items pi
         WHERE pi.run_id = ${runId}
           AND NOT EXISTS (
             SELECT 1 FROM salary_payments sp
             WHERE sp.payroll_item_id = pi.id
           )
       `);
    const result = await PayrollJournalService.postPaymentJournal({
      companyId,
      payrollRunId: runId,
      bankMutationId: evidenceResult.rows[0]!.mutation_id,
      accountingPaymentId: evidenceResult.rows[0]!.payment_id,
      date: evidenceResult.rows[0]!.transaction_date,
      salaryPayableAccountId: mapping.salaryPayableAccountId,
      cashBankAccountId,
      actor: paidBy ?? "payroll-payment",
      paidBy,
    });
    const { entryId } = result;
    await assertPostedAccountingEntry(entryId, companyId, "Journal pembayaran payroll");

    auditFromReq(req, { action: "payroll_run_paid", module: "payroll", referenceId: String(runId), newData: { entryId, payment: result } });
    const data = await loadRunWithItems(runId, companyId);
    res.json({ entryId, ...data });
  } catch (err) {
    const message = err instanceof AccountingConfigError ? err.message : "Gagal memposting jurnal pembayaran payroll.";
    await db.update(payrollRunsTable).set({
      postingStatus: "error", postingError: message, postingClaimedAt: null,
    }).where(eq(payrollRunsTable.id, runId));
    res.status(400).json({ message });
  }
});

// ── POST /api/payroll/runs/:id/cancel ─────────────────────────────────────────
router.post("/runs/:id/cancel", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const companyId = resolveCompanyId(req);
  const runId = Number(req.params.id);
  const [run] = await db.select().from(payrollRunsTable)
    .where(and(eq(payrollRunsTable.id, runId), eq(payrollRunsTable.companyId, companyId)));
  if (!run) { res.status(404).json({ message: "Payroll run tidak ditemukan" }); return; }
  if (run.status === "paid") { res.status(400).json({ message: "Payroll run yang sudah dibayar tidak bisa dibatalkan." }); return; }

  await db.update(payrollRunsTable).set({ status: "cancelled" }).where(eq(payrollRunsTable.id, runId));
  auditFromReq(req, { action: "payroll_run_cancelled", module: "payroll", referenceId: String(runId) });
  res.json({ success: true });
});

// ── GET /api/payroll/account-mapping — read current mapping (for settings UI) ─
router.get("/account-mapping", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const companyId = resolveCompanyId(req);
  const [row] = await db.execute<Record<string, unknown>>(sql`
    SELECT salary_expense_account_id, allowance_expense_account_id, salary_payable_account_id,
           tax_payable_account_id, bpjs_payable_account_id
    FROM accounting_settings WHERE company_id = ${companyId} LIMIT 1
  `).then((r) => r.rows);
  res.json({ mapping: row ?? null });
});

// ── PUT /api/payroll/account-mapping — set mapping ────────────────────────────
router.put("/account-mapping", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const companyId = resolveCompanyId(req);
  const {
    salaryExpenseAccountId, allowanceExpenseAccountId, salaryPayableAccountId, taxPayableAccountId, bpjsPayableAccountId,
  } = req.body ?? {};
  await db.execute(sql`
    UPDATE accounting_settings SET
      salary_expense_account_id = ${salaryExpenseAccountId ?? null},
      allowance_expense_account_id = ${allowanceExpenseAccountId ?? null},
      salary_payable_account_id = ${salaryPayableAccountId ?? null},
      tax_payable_account_id = ${taxPayableAccountId ?? null},
      bpjs_payable_account_id = ${bpjsPayableAccountId ?? null}
    WHERE company_id = ${companyId}
  `);
  auditFromReq(req, { action: "payroll_account_mapping_updated", module: "payroll", newData: req.body });
  res.json({ success: true });
});

export default router;
