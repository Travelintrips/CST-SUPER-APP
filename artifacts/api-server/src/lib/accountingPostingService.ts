/**
 * AccountingPostingService
 * Pusat semua posting transaksi ke Accounting Hub.
 * Semua modul (tenant, sport center, logistics, expense, payroll, POS) harus melalui service ini.
 */
import { db } from "@workspace/db";
import { sql, eq, and } from "drizzle-orm";
import {
  accountingEntriesTable,
  accountingEntryLinesTable,
  accountingPaymentsTable,
  accountingPostingErrorsTable,
  coaModuleMappingTable,
  accountingSettingsTable,
  accountingJournalsTable,
  chartOfAccountsTable,
} from "@workspace/db";
import { logger } from "./logger.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PostingContext {
  companyId: number;
  branchId?: number;
  divisionId?: number;
  sourceModule: string;
  sourceSchema?: string;
  sourceTable?: string;
  sourceId?: number;
  sourceRef?: string;
}

export interface PostingLine {
  accountId: number;
  debit: string;
  credit: string;
  description?: string;
}

export interface PostingRequest {
  ctx: PostingContext;
  date: string;
  ref: string;
  description: string;
  lines: PostingLine[];
  journalId?: number;
  entrySource?: string;
  paymentType?: "inbound" | "outbound";
  amount?: string;
  partnerName?: string;
  paymentRef?: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function generateEntryNumber(): string {
  const now = new Date();
  const yy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const rand = String(Math.floor(Math.random() * 900000) + 100000);
  return `HUB/${yy}/${mm}/${rand}`;
}

function generatePaymentNumber(): string {
  const now = new Date();
  const yy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const rand = String(Math.floor(Math.random() * 900000) + 100000);
  return `PAY/${yy}/${mm}/${rand}`;
}

async function recordPostingError(
  ctx: PostingContext,
  errorCode: string,
  errorMessage: string,
  payload?: unknown,
): Promise<void> {
  try {
    await db.insert(accountingPostingErrorsTable).values({
      companyId: ctx.companyId,
      branchId: ctx.branchId ?? null,
      divisionId: ctx.divisionId ?? null,
      sourceModule: ctx.sourceModule,
      sourceTable: ctx.sourceTable ?? null,
      sourceId: ctx.sourceId ?? null,
      sourceRef: ctx.sourceRef ?? null,
      errorCode,
      errorMessage,
      payload: payload ? payload as Record<string, unknown> : null,
    });
  } catch (e) {
    logger.warn({ e }, "[AccountingHub] Gagal menyimpan posting error");
  }
}

async function resolveJournalId(companyId: number, preferredType: "bank" | "cash" | "general" | "sales" | "purchase"): Promise<number | null> {
  const settings = await db
    .select()
    .from(accountingSettingsTable)
    .where(eq(accountingSettingsTable.companyId, companyId))
    .limit(1);

  if (settings[0]) {
    const s = settings[0];
    if (preferredType === "bank"     && s.bankJournalId)     return s.bankJournalId;
    if (preferredType === "cash"     && s.cashJournalId)     return s.cashJournalId;
    if (preferredType === "sales"    && s.salesJournalId)    return s.salesJournalId;
    if (preferredType === "purchase" && s.purchaseJournalId) return s.purchaseJournalId;
  }

  const [journal] = await db
    .select({ id: accountingJournalsTable.id })
    .from(accountingJournalsTable)
    .where(
      and(
        eq(accountingJournalsTable.companyId, companyId),
        eq(accountingJournalsTable.type, preferredType),
      ),
    )
    .limit(1);

  return journal?.id ?? null;
}

async function resolveCOAMapping(
  companyId: number,
  module: string,
  transactionType: string,
): Promise<{ debitAccountId: number; creditAccountId: number } | null> {
  const [mapping] = await db
    .select()
    .from(coaModuleMappingTable)
    .where(
      and(
        eq(coaModuleMappingTable.companyId, companyId),
        eq(coaModuleMappingTable.module, module),
        eq(coaModuleMappingTable.transactionType, transactionType),
        eq(coaModuleMappingTable.isActive, true),
      ),
    )
    .limit(1);

  if (!mapping) return null;
  return { debitAccountId: mapping.debitAccountId, creditAccountId: mapping.creditAccountId };
}

// ── Core Posting ──────────────────────────────────────────────────────────────

export async function postToAccountingHub(req: PostingRequest): Promise<{ entryId: number; paymentId?: number } | null> {
  const { ctx, date, ref, description, lines, journalId: reqJournalId, entrySource } = req;

  // Validasi debit = kredit
  const totalDebit  = lines.reduce((s, l) => s + parseFloat(l.debit  || "0"), 0);
  const totalCredit = lines.reduce((s, l) => s + parseFloat(l.credit || "0"), 0);
  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    await recordPostingError(ctx, "BALANCE_VIOLATION", `Debit (${totalDebit}) ≠ Kredit (${totalCredit})`, req);
    return null;
  }

  if (!ctx.companyId) {
    await recordPostingError(ctx, "MISSING_COMPANY_ID", "company_id wajib ada", req);
    return null;
  }

  const journalId = reqJournalId ?? await resolveJournalId(ctx.companyId, "general");
  if (!journalId) {
    await recordPostingError(ctx, "NO_JOURNAL_FOUND", "Tidak ada journal yang bisa digunakan", req);
    return null;
  }

  // ── Idempotency: skip jika source+sourceId sudah ada ─────────────────────────
  const resolvedSource = (entrySource ?? "manual") as string;
  if (resolvedSource !== "manual" && ctx.sourceId != null) {
    try {
      const [existingEntry] = await db
        .select({ id: accountingEntriesTable.id })
        .from(accountingEntriesTable)
        .where(sql`source = ${resolvedSource} AND source_id = ${ctx.sourceId}`)
        .limit(1);
      if (existingEntry) {
        logger.info({ source: resolvedSource, sourceId: ctx.sourceId }, "[AccountingHub] Skipping duplicate — entry already exists");
        return { entryId: existingEntry.id };
      }
    } catch { /* non-fatal — lanjut ke insert */ }
  }

  try {
    const entryNumber = generateEntryNumber();
    const now = new Date();

    const [entry] = await db
      .insert(accountingEntriesTable)
      .values({
        companyId: ctx.companyId,
        branchId: ctx.branchId ?? null,
        divisionId: ctx.divisionId ?? null,
        entryNumber,
        journalId,
        date,
        ref,
        description,
        status: "posted",
        source: resolvedSource as any,
        sourceId: ctx.sourceId ?? null,
        sourceSchema: ctx.sourceSchema ?? "public",
        sourceModule: ctx.sourceModule,
        sourceTable: ctx.sourceTable ?? null,
        totalDebit: String(totalDebit.toFixed(2)),
        totalCredit: String(totalCredit.toFixed(2)),
        postedAt: now,
      })
      .returning({ id: accountingEntriesTable.id });

    const entryId = entry.id;

    await db.insert(accountingEntryLinesTable).values(
      lines.map((l) => ({
        entryId,
        accountId: l.accountId,
        description: l.description ?? null,
        debit: l.debit,
        credit: l.credit,
      })),
    );

    let paymentId: number | undefined;

    if (req.paymentType && req.amount) {
      const paymentNumber = generatePaymentNumber();
      const [payment] = await db
        .insert(accountingPaymentsTable)
        .values({
          companyId: ctx.companyId,
          branchId: ctx.branchId ?? null,
          divisionId: ctx.divisionId ?? null,
          paymentNumber,
          paymentType: req.paymentType,
          status: "posted",
          amount: req.amount,
          journalId,
          date,
          ref: req.paymentRef ?? ref,
          memo: description,
          partnerName: req.partnerName ?? null,
          entryId,
          sourceType: ctx.sourceModule,
          sourceDocId: ctx.sourceId ?? null,
          sourceModule: ctx.sourceModule,
          sourceSchema: ctx.sourceSchema ?? "public",
          postedAt: now,
        })
        .returning({ id: accountingPaymentsTable.id });

      paymentId = payment.id;
    }

    logger.info({ entryId, paymentId, module: ctx.sourceModule, ref }, "[AccountingHub] Transaksi berhasil diposting");
    return { entryId, paymentId };
  } catch (err: any) {
    await recordPostingError(ctx, "DB_ERROR", err?.message ?? "Unknown error", { req, err: String(err) });
    logger.error({ err, ctx }, "[AccountingHub] Gagal posting transaksi");
    return null;
  }
}

// ── Void Entry ────────────────────────────────────────────────────────────────

export async function voidAccountingEntry(
  entryId: number,
  reason: string,
  voidedBy?: string,
): Promise<{ voidEntryId: number } | null> {
  const [original] = await db
    .select()
    .from(accountingEntriesTable)
    .where(eq(accountingEntriesTable.id, entryId))
    .limit(1);

  if (!original) {
    logger.warn({ entryId }, "[AccountingHub] Entry tidak ditemukan untuk void");
    return null;
  }

  if (original.status !== "posted") {
    logger.warn({ entryId, status: original.status }, "[AccountingHub] Hanya entry posted yang bisa di-void");
    return null;
  }

  const originalLines = await db
    .select()
    .from(accountingEntryLinesTable)
    .where(eq(accountingEntryLinesTable.entryId, entryId));

  const reversalLines: PostingLine[] = originalLines.map((l) => ({
    accountId: l.accountId,
    debit: l.credit,
    credit: l.debit,
    description: `REVERSAL: ${l.description ?? ""}`,
  }));

  const now = new Date();
  const voidEntryNumber = generateEntryNumber().replace("HUB/", "VOID/");

  try {
    const [voidEntry] = await db
      .insert(accountingEntriesTable)
      .values({
        companyId: original.companyId,
        branchId: original.branchId ?? null,
        divisionId: original.divisionId ?? null,
        entryNumber: voidEntryNumber,
        journalId: original.journalId,
        date: new Date().toISOString().split("T")[0],
        ref: `VOID-${original.ref ?? original.entryNumber}`,
        description: `Pembalik jurnal: ${original.description ?? ""} — Alasan: ${reason}`,
        status: "posted",
        source: "reversal",
        sourceId: original.id,
        sourceSchema: original.sourceSchema ?? "public",
        sourceModule: original.sourceModule ?? "manual",
        sourceTable: original.sourceTable ?? null,
        totalDebit: original.totalCredit,
        totalCredit: original.totalDebit,
        postedAt: now,
        voidedAt: null,
      })
      .returning({ id: accountingEntriesTable.id });

    const voidEntryId = voidEntry.id;

    await db.insert(accountingEntryLinesTable).values(
      reversalLines.map((l) => ({
        entryId: voidEntryId,
        accountId: l.accountId,
        description: l.description ?? null,
        debit: l.debit,
        credit: l.credit,
      })),
    );

    // FIX: DB punya trigger immutability (fn_block_posted_entry_update) yang HANYA
    // mengizinkan UPDATE pada entry posted jika NEW.status='draft' DAN cancel_reason
    // DAN cancelled_at diisi bersamaan. Update sebelumnya tidak menyertakan status,
    // sehingga akan gagal dengan IMMUTABILITY_VIOLATION saat benar-benar dijalankan
    // terhadap DB produksi. Menyertakan status:'draft' di sini juga otomatis
    // mengeluarkan entry ini dari semua query trial-balance/P&L yang memfilter
    // status='posted'.
    await db
      .update(accountingEntriesTable)
      .set({
        status: "draft",
        cancelledAt: now,
        cancelledBy: voidedBy ?? null,
        cancelReason: reason,
        voidedAt: now,
        voidEntryId,
      })
      .where(eq(accountingEntriesTable.id, entryId));

    logger.info({ entryId, voidEntryId, reason }, "[AccountingHub] Entry berhasil di-void");
    return { voidEntryId };
  } catch (err: any) {
    logger.error({ err, entryId }, "[AccountingHub] Gagal void entry");
    return null;
  }
}

// ── Module-specific posting functions ─────────────────────────────────────────

export async function postTenantPaymentToAccounting(
  paymentId: number,
  companyId: number,
  opts?: { amount: string; tenantName: string; date: string; branchId?: number }
): Promise<{ entryId: number; paymentId?: number } | null> {
  const ctx: PostingContext = {
    companyId,
    branchId: opts?.branchId,
    sourceModule: "tenant",
    sourceSchema: "public",
    sourceTable: "tenant_payments",
    sourceId: paymentId,
    sourceRef: `TENANT-PAY-${paymentId}`,
  };

  const mapping = await resolveCOAMapping(companyId, "tenant", "rent_payment");
  if (!mapping) {
    await recordPostingError(ctx, "COA_MAPPING_NOT_FOUND", "Mapping COA untuk tenant.rent_payment tidak ditemukan");
    return null;
  }

  const amount = opts?.amount ?? "0";
  return postToAccountingHub({
    ctx,
    date: opts?.date ?? new Date().toISOString().split("T")[0],
    ref: `TENANT-PAY-${paymentId}`,
    description: `Pembayaran sewa tenant: ${opts?.tenantName ?? `ID-${paymentId}`}`,
    entrySource: "tenant_rent_payment",
    paymentType: "inbound",
    amount,
    partnerName: opts?.tenantName,
    lines: [
      { accountId: mapping.debitAccountId, debit: amount, credit: "0", description: "Kas/Bank diterima" },
      { accountId: mapping.creditAccountId, debit: "0", credit: amount, description: "Pendapatan sewa tenant" },
    ],
  });
}

export async function postSportBookingPaymentToAccounting(
  paymentId: number,
  companyId: number,
  opts?: { amount: string; customerName: string; date: string; facilityName?: string }
): Promise<{ entryId: number; paymentId?: number } | null> {
  const ctx: PostingContext = {
    companyId,
    sourceModule: "sport_center",
    sourceSchema: "public",
    sourceTable: "sport_payments",
    sourceId: paymentId,
    sourceRef: `SC-PAY-${paymentId}`,
  };

  const mapping = await resolveCOAMapping(companyId, "sport_center", "booking_payment");
  if (!mapping) {
    await recordPostingError(ctx, "COA_MAPPING_NOT_FOUND", "Mapping COA untuk sport_center.booking_payment tidak ditemukan");
    return null;
  }

  const amount = opts?.amount ?? "0";
  return postToAccountingHub({
    ctx,
    date: opts?.date ?? new Date().toISOString().split("T")[0],
    ref: `SC-PAY-${paymentId}`,
    description: `Pembayaran sport center: ${opts?.customerName ?? `ID-${paymentId}`}${opts?.facilityName ? ` — ${opts.facilityName}` : ""}`,
    entrySource: "sport_center_booking",
    paymentType: "inbound",
    amount,
    partnerName: opts?.customerName,
    lines: [
      { accountId: mapping.debitAccountId, debit: amount, credit: "0", description: "Kas diterima sport center" },
      { accountId: mapping.creditAccountId, debit: "0", credit: amount, description: "Pendapatan sport center" },
    ],
  });
}

export async function postExpenseToAccounting(
  expenseId: number,
  companyId: number,
  opts?: { amount: string; description: string; date: string; branchId?: number; divisionId?: number }
): Promise<{ entryId: number } | null> {
  const ctx: PostingContext = {
    companyId,
    branchId: opts?.branchId,
    divisionId: opts?.divisionId,
    sourceModule: "expense",
    sourceSchema: "public",
    sourceTable: "expenses",
    sourceId: expenseId,
    sourceRef: `EXP-${expenseId}`,
  };

  const mapping = await resolveCOAMapping(companyId, "expense", "general_expense");
  if (!mapping) {
    await recordPostingError(ctx, "COA_MAPPING_NOT_FOUND", "Mapping COA untuk expense.general_expense tidak ditemukan");
    return null;
  }

  const amount = opts?.amount ?? "0";
  const result = await postToAccountingHub({
    ctx,
    date: opts?.date ?? new Date().toISOString().split("T")[0],
    ref: `EXP-${expenseId}`,
    description: opts?.description ?? `Pengeluaran #${expenseId}`,
    entrySource: "manual",
    lines: [
      { accountId: mapping.debitAccountId, debit: amount, credit: "0", description: "Beban pengeluaran" },
      { accountId: mapping.creditAccountId, debit: "0", credit: amount, description: "Kas/Bank keluar" },
    ],
  });
  return result ? { entryId: result.entryId } : null;
}

export async function postPayrollToAccounting(
  payrollRunId: number,
  companyId: number,
  opts?: { amount: string; period: string; date: string; branchId?: number }
): Promise<{ entryId: number } | null> {
  const ctx: PostingContext = {
    companyId,
    branchId: opts?.branchId,
    sourceModule: "hrd",
    sourceSchema: "public",
    sourceTable: "payroll_runs",
    sourceId: payrollRunId,
    sourceRef: `PAYROLL-${payrollRunId}`,
  };

  const mapping = await resolveCOAMapping(companyId, "hrd", "payroll");
  if (!mapping) {
    await recordPostingError(ctx, "COA_MAPPING_NOT_FOUND", "Mapping COA untuk hrd.payroll tidak ditemukan");
    return null;
  }

  const amount = opts?.amount ?? "0";
  const result = await postToAccountingHub({
    ctx,
    date: opts?.date ?? new Date().toISOString().split("T")[0],
    ref: `PAYROLL-${payrollRunId}`,
    description: `Penggajian periode ${opts?.period ?? payrollRunId}`,
    entrySource: "manual",
    lines: [
      { accountId: mapping.debitAccountId, debit: amount, credit: "0", description: "Beban gaji" },
      { accountId: mapping.creditAccountId, debit: "0", credit: amount, description: "Kas/Bank penggajian" },
    ],
  });
  return result ? { entryId: result.entryId } : null;
}

export async function postInvoicePaymentToAccounting(
  paymentId: number,
  companyId: number,
  opts?: { amount: string; invoiceNumber: string; partnerName: string; date: string; type: "inbound" | "outbound" }
): Promise<{ entryId: number; paymentId?: number } | null> {
  const txType = opts?.type === "outbound" ? "bill_payment" : "invoice_payment";
  const ctx: PostingContext = {
    companyId,
    sourceModule: "sales",
    sourceSchema: "public",
    sourceTable: "accounting_payments",
    sourceId: paymentId,
    sourceRef: `INV-PAY-${paymentId}`,
  };

  const mapping = await resolveCOAMapping(companyId, "sales", txType);
  if (!mapping) {
    await recordPostingError(ctx, "COA_MAPPING_NOT_FOUND", `Mapping COA untuk sales.${txType} tidak ditemukan`);
    return null;
  }

  const amount = opts?.amount ?? "0";
  return postToAccountingHub({
    ctx,
    date: opts?.date ?? new Date().toISOString().split("T")[0],
    ref: `INV-PAY-${paymentId}`,
    description: `Pembayaran invoice ${opts?.invoiceNumber ?? `#${paymentId}`} — ${opts?.partnerName ?? ""}`,
    entrySource: opts?.type === "outbound" ? "purchase_payment" : "sales_payment",
    paymentType: opts?.type ?? "inbound",
    amount,
    partnerName: opts?.partnerName,
    lines: [
      { accountId: mapping.debitAccountId, debit: amount, credit: "0" },
      { accountId: mapping.creditAccountId, debit: "0", credit: amount },
    ],
  });
}

export async function voidAccountingPayment(
  paymentId: number,
  reason: string,
  voidedBy?: string,
): Promise<{ voidEntryId: number } | null> {
  const [payment] = await db
    .select()
    .from(accountingPaymentsTable)
    .where(eq(accountingPaymentsTable.id, paymentId))
    .limit(1);

  if (!payment) {
    logger.warn({ paymentId }, "[AccountingHub] Payment tidak ditemukan");
    return null;
  }

  if (payment.status === "voided") {
    logger.warn({ paymentId }, "[AccountingHub] Payment sudah di-void sebelumnya");
    return null;
  }

  if (!payment.entryId) {
    logger.warn({ paymentId }, "[AccountingHub] Payment tidak punya entryId, skip void entry");
    await db
      .update(accountingPaymentsTable)
      .set({ status: "voided", voidReason: reason, voidedAt: new Date() })
      .where(eq(accountingPaymentsTable.id, paymentId));
    return { voidEntryId: -1 };
  }

  const result = await voidAccountingEntry(payment.entryId, reason, voidedBy);
  if (!result) return null;

  await db
    .update(accountingPaymentsTable)
    .set({
      status: "voided",
      voidReason: reason,
      voidedAt: new Date(),
      voidEntryId: result.voidEntryId,
    })
    .where(eq(accountingPaymentsTable.id, paymentId));

  return result;
}
