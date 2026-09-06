/**
 * Payroll — Cash Advance & Payroll Accounting Automation.
 *
 * Tables reused as-is: employees, payroll_runs, payroll_items (pre-existing).
 * Kasbon (cash_advances) has no employee_id FK — matched to employees at
 * calculate-time by normalized full name (party_name vs first_name+last_name).
 * All journal postings go through PayrollJournalService — never postEntry() directly.
 */
import { Router } from "express";
import { eq, and, sql } from "drizzle-orm";
import {
  db, cashAdvancesTable, cashAdvanceRepaymentsTable, employeesTable, payrollRunsTable, payrollItemsTable,
} from "@workspace/db";
import { requireAdmin } from "../lib/requireAdmin.js";
import { resolveCompanyId } from "../lib/resolveCompany.js";
import { auditFromReq } from "../lib/auditLog.js";
import {
  PayrollJournalService, resolvePayrollAccountMapping,
} from "../lib/payroll/PayrollJournalService.js";
import { AccountingConfigError } from "../lib/advance/AdvanceErrors.js";
import { deriveStatusAfterPayment } from "../lib/advance/AdvanceStateMachine.js";

const router = Router();

const MAPPING_ERROR = "Accounting Mapping belum lengkap. Lengkapi pemetaan akun payroll di Pengaturan Akuntansi (Salary Expense, Allowance Expense, Salary Payable, Tax Payable, BPJS Payable).";

function normalizeName(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, " ");
}

function n(v: unknown): number {
  return v == null ? 0 : Number(v);
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

// ── POST /api/payroll/runs/:id/calculate — match outstanding kasbon per employee ─
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

  // Bug fix: sertakan kasbon lifecycle baru (outstanding/partially_settled/disbursed)
  // agar tidak terlewat saat calculate
  const outstanding = await db.select().from(cashAdvancesTable)
    .where(and(
      eq(cashAdvancesTable.companyId, companyId),
      sql`(${cashAdvancesTable.status} IN ('active', 'partial')
        OR lifecycle_status IN ('outstanding', 'partially_settled', 'disbursed'))`,
    ));

  const results = [];
  for (const { item, employee } of items) {
    if (!employee) { results.push({ itemId: item.id, matched: false }); continue; }
    const fullName = normalizeName(`${employee.firstName} ${employee.lastName}`);
    const adv = outstanding.find((a) => normalizeName(a.partyName) === fullName && n(a.remainingAmount) > 0);

    const gross = n(item.baseSalary) + n(item.allowance);
    const nonKasbonDeductions = n(item.bpjsJhtEmployee) + n(item.bpjsKesEmployee) + n(item.pph21) + n(item.otherDeductions);
    const payCapacity = Math.max(0, gross - nonKasbonDeductions);

    let deduction = 0;
    let cashAdvanceId: number | null = null;
    let kasbonBalanceAfter = 0;
    if (adv) {
      const remaining = n(adv.remainingAmount);
      const planned = adv.repaymentMethod === "installment" && adv.installmentAmount != null
        ? Number(adv.installmentAmount)
        : remaining; // one_time: pay off in full this run
      deduction = Math.min(planned, remaining, payCapacity);
      cashAdvanceId = adv.id;
      kasbonBalanceAfter = remaining - deduction;
    }

    const totalDeductions = nonKasbonDeductions + deduction;
    const netSalary = gross - totalDeductions;

    await db.update(payrollItemsTable).set({
      kasbonDeduction: String(deduction),
      cashAdvanceId,
      totalDeductions: String(totalDeductions),
      netSalary: String(netSalary),
      kasbonBalanceAfter: String(kasbonBalanceAfter),
    }).where(eq(payrollItemsTable.id, item.id));

    results.push({ itemId: item.id, matched: !!adv, deduction, cashAdvanceId });
  }

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
  const [run] = await db.select().from(payrollRunsTable)
    .where(and(eq(payrollRunsTable.id, runId), eq(payrollRunsTable.companyId, companyId)));
  if (!run) { res.status(404).json({ message: "Payroll run tidak ditemukan" }); return; }
  if (run.status !== "calculated") { res.status(400).json({ message: "Payroll run harus dihitung (calculate) sebelum diapprove." }); return; }

  const mapping = await resolvePayrollAccountMapping(companyId);
  if (!mapping) { res.status(400).json({ message: MAPPING_ERROR }); return; }

  const items = await db.select().from(payrollItemsTable).where(eq(payrollItemsTable.runId, runId));
  if (!items.length) { res.status(400).json({ message: "Payroll run tidak memiliki item." }); return; }

  const totalSalary = items.reduce((s, i) => s + n(i.baseSalary), 0);
  const totalAllowance = items.reduce((s, i) => s + n(i.allowance), 0);
  const totalTax = items.reduce((s, i) => s + n(i.pph21), 0);
  const totalBpjs = items.reduce((s, i) => s + n(i.bpjsJhtEmployee) + n(i.bpjsKesEmployee), 0);
  const totalSalaryPayable = items.reduce((s, i) => s + n(i.netSalary), 0);

  const kasbonItems = items.filter((i) => n(i.kasbonDeduction) > 0 && i.cashAdvanceId);
  const advanceIds = [...new Set(kasbonItems.map((i) => i.cashAdvanceId!))];
  const advances = advanceIds.length
    ? await db.select().from(cashAdvancesTable).where(sql`${cashAdvancesTable.id} IN ${advanceIds}`)
    : [];
  const advanceById = new Map(advances.map((a) => [a.id, a]));
  const kasbonByAccountMap = new Map<number, number>();
  for (const i of kasbonItems) {
    const adv = advanceById.get(i.cashAdvanceId!);
    if (!adv?.receivableAccountId) continue;
    kasbonByAccountMap.set(adv.receivableAccountId, (kasbonByAccountMap.get(adv.receivableAccountId) ?? 0) + n(i.kasbonDeduction));
  }
  const kasbonByAccount = [...kasbonByAccountMap.entries()].map(([accountId, amount]) => ({ accountId, amount }));

  const period = `${run.year}-${String(run.month).padStart(2, "0")}`;

  try {
    const { entryId } = await PayrollJournalService.postAccrualJournal(mapping, {
      companyId, payrollRunId: runId, period, date: new Date(),
      totalSalary, totalAllowance, totalTax, totalBpjs, kasbonByAccount, totalSalaryPayable,
    });
    await assertPostedAccountingEntry(entryId, companyId, "Journal accrual payroll");

    await db.transaction(async (tx) => {
      await tx.update(payrollRunsTable).set({
        status: "approved", accountingEntryId: entryId, approvedAt: new Date(), postingStatus: "posted", postingError: null,
      }).where(eq(payrollRunsTable.id, runId));

      const now = new Date();
      // Tanggal efektif posting: tanggal aktual approve (bukan 1 bulan periode)
      // agar cocok dengan tanggal journal entry dan tidak mismatch di rekonsiliasi
      const repaymentDate = now.toISOString().slice(0, 10);

      for (const i of kasbonItems) {
        const adv = advanceById.get(i.cashAdvanceId!);
        if (!adv) continue;
        const deduction = n(i.kasbonDeduction);
        const newPaid = n(adv.paidAmount) + deduction;
        const newSettled = n(adv.settledAmount) + deduction;
        const newRemaining = Math.max(0, n(adv.remainingAmount) - deduction);

        // Pakai threshold yang sama dengan AdvanceStateMachine.deriveStatusAfterPayment (<= 0.005)
        const newLifecycleStatus = deriveStatusAfterPayment(newRemaining);
        const isFullyRepaid = newLifecycleStatus === "settled";
        // Legacy status (backward compat dengan konsumer lama)
        const newStatus = isFullyRepaid ? "repaid" : "partial";

        // Perbaikan 1: lifecycle_status canonical + repayment_journal_id = entryId sekarang
        // (bukan COALESCE — tiap payroll run bisa punya entryId berbeda; consumer harus
        //  melihat cash_advance_repayments untuk riwayat lengkap)
        await tx.execute(sql`
          UPDATE cash_advances SET
            paid_amount          = ${String(newPaid)},
            settled_amount       = ${String(newSettled)},
            remaining_amount     = ${String(newRemaining)},
            status               = ${newStatus},
            lifecycle_status     = ${newLifecycleStatus},
            repayment_journal_id = ${entryId},
            repaid_at            = ${isFullyRepaid ? now : (adv.repaidAt ?? null)},
            updated_at           = ${now}
          WHERE id = ${adv.id}
        `);

        // Perbaikan 2: catat repayment di cash_advance_repayments — riwayat per-kasbon
        await tx.insert(cashAdvanceRepaymentsTable).values({
          advanceId:     adv.id,
          amount:        String(deduction),
          paymentMethod: "payroll",
          date:          repaymentDate,
          notes:         `Potongan Payroll ${period}`,
          entryId,
        });
      }
    });

    auditFromReq(req, { action: "payroll_run_approved", module: "payroll", referenceId: String(runId), newData: { entryId, totalSalaryPayable } });
    const data = await loadRunWithItems(runId, companyId);
    res.json({ entryId, ...data });
  } catch (err) {
    const message = err instanceof AccountingConfigError ? err.message : "Gagal memposting jurnal payroll.";
    await db.update(payrollRunsTable).set({ postingStatus: "error", postingError: message }).where(eq(payrollRunsTable.id, runId));
    res.status(400).json({ message });
  }
});

// ── POST /api/payroll/runs/:id/pay — post payment journal ────────────────────
router.post("/runs/:id/pay", async (req, res) => {
  if (!(await requireAdmin(req, res))) return;
  const companyId = resolveCompanyId(req);
  const runId = Number(req.params.id);
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

  const [settings] = await db.execute<{ default_cash_account_id: number | null; default_bank_account_id: number | null }>(sql`
    SELECT default_cash_account_id, default_bank_account_id FROM accounting_settings WHERE company_id = ${companyId} LIMIT 1
  `).then((r) => r.rows);
  const paymentMethod: "cash" | "bank" = req.body?.paymentMethod === "cash" ? "cash" : "bank";
  const cashBankAccountId = paymentMethod === "cash" ? settings?.default_cash_account_id : settings?.default_bank_account_id;
  if (!cashBankAccountId) { res.status(400).json({ message: "Akun Kas/Bank belum dikonfigurasi." }); return; }

  const items = await db.select().from(payrollItemsTable).where(eq(payrollItemsTable.runId, runId));
  const amount = items.reduce((s, i) => s + n(i.netSalary), 0);
  const period = `${run.year}-${String(run.month).padStart(2, "0")}`;

  try {
    const { entryId } = await PayrollJournalService.postPaymentJournal({
      companyId, payrollRunId: runId, period, date: new Date(), amount,
      salaryPayableAccountId: mapping.salaryPayableAccountId, cashBankAccountId, paymentMethod,
    });
    await assertPostedAccountingEntry(entryId, companyId, "Journal pembayaran payroll");

    const paidBy = (req.user as { id?: string } | undefined)?.id ?? null;
    await db.transaction(async (tx) => {
      await tx.update(payrollRunsTable).set({
        status: "paid", paymentEntryId: entryId, postedAt: new Date(), postingStatus: "posted", postingError: null, paymentMethod,
      }).where(eq(payrollRunsTable.id, runId));
      await tx.update(payrollItemsTable).set({ isPaid: true, paidAt: new Date(), paidBy }).where(eq(payrollItemsTable.runId, runId));
    });

    auditFromReq(req, { action: "payroll_run_paid", module: "payroll", referenceId: String(runId), newData: { entryId, amount } });
    const data = await loadRunWithItems(runId, companyId);
    res.json({ entryId, ...data });
  } catch (err) {
    const message = err instanceof AccountingConfigError ? err.message : "Gagal memposting jurnal pembayaran payroll.";
    await db.update(payrollRunsTable).set({ postingStatus: "error", postingError: message }).where(eq(payrollRunsTable.id, runId));
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
