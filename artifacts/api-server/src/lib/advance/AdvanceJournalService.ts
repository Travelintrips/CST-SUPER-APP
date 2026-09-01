/**
 * AdvanceJournalService — Single Source of Truth for all advance-related journal operations.
 *
 * RULE: ALL journal postings for Advance Management MUST go through this service.
 * No route or other service should call postEntry() directly for advance transactions.
 *
 * Methods (single-company):
 *   postDisbursementJournal()          DR Advance Receivable / CR Bank/Kas
 *   postRepaymentJournal()             DR Bank/Kas / CR Advance Receivable
 *   postExpenseSettlement()            DR Expense / CR Advance Receivable (Pertanggungjawaban)
 *   postAllocationSettlement()         Complex allocation (Unified Engine)
 *   postKasbonSettleToExpense()        DR Expense / CR Receivable (kasbon settle)
 *   postVoidReversal()                 Reversal of a posted advance disbursement journal
 *
 * Methods (intercompany — SINGLE unified path, ref format IC-ADV-{num}):
 *   postIntercompanyDisbursementPair() Funding co: DR 1-1099 / CR Cash
 *                                      Responsible co: DR Expense / CR 2-2098
 *   postIntercompanyRepaymentPair()    Responsible co: DR 2-2098 / CR Cash
 *                                      Funding co: DR Cash / CR 1-1099
 *
 * NOTE: Legacy single-book functions (postIntercompanyLiability / reverseIntercompanyLiability)
 * that recorded only in the responsible company's books with ref IC-{num} have been removed.
 * Existing DB entries with that ref format are display-compatible via the accountingHub query.
 */

import { db, accountingJournalsTable, chartOfAccountsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  postEntry,
  postEntryWithClient,
  postIntercompanyPair,
  type DbClient,
  type PostingInput,
} from "../accounting.js";
import {
  createReversalJournal,
  validateJournalBalance,
} from "../accountingPostingGuard.js";
import {
  AccountingConfigError,
  JournalPostingError,
} from "./AdvanceErrors.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DisbursementJournalParams {
  companyId: number;
  advanceNumber: string;
  partyName: string;
  advanceType: string;   // e.g. "kasbon", "EMPLOYEE", "VENDOR", "TRAVEL"
  amount: number;
  date: Date | string;
  receivableAccountId: number;
  cashBankAccountId: number;
  paymentMethod?: string;
  /** Override deskripsi jurnal. Jika tidak diisi, akan dibuat otomatis dari advanceNumber + label + partyName. */
  description?: string;
}

export interface RepaymentJournalParams {
  companyId: number;
  advanceNumber: string;
  partyName: string;
  amount: number;
  date: Date | string;
  receivableAccountId: number;
  cashBankAccountId: number;
  paymentMethod?: string;
  refSuffix?: string;   // appended to advanceNumber for unique ref
}

export interface ExpenseSettlementParams {
  companyId: number;
  advanceNumber: string;
  settlementRef: string;
  partyName: string;
  amount: number;
  date: Date | string;
  receivableAccountId: number;
  expenseAccountId: number;
  category?: string | null;
}

export interface AllocationLine {
  allocation_type: string;
  coa_id?: number | null;
  amount: number;
  remarks?: string | null;
}

export interface AllocationSettlementParams {
  companyId: number;
  advanceNumber: string;
  settlementNumber: string;
  partyName: string;
  amountReceived: number;
  date: Date | string;
  bankAccountId: number;
  receivableAccountId: number;
  allocationLines: AllocationLine[];
}

export interface VoidReversalParams {
  originalEntryId: number;
  companyId: number;
  advanceNumber: string;
  actor: string | null;
  reason: string;
}

export interface JournalResult {
  entryId: number;
}

export interface IntercompanyDisbursementPairParams {
  fundingCompanyId: number;
  responsibleCompanyId: number;
  advanceNumber: string;
  partyName: string;
  category?: string | null;
  purpose?: string | null;
  amount: number;
  date: Date | string;
  fundingReceivableAccountId: number;
  fundingCashBankAccountId: number;
  responsibleExpenseAccountId: number;
  responsiblePayableAccountId: number;
  sourceAdvanceId?: number;
  afterPost?: (tx: any, entries: {
    sourceEntry: any;
    mirrorEntry: any;
  }) => Promise<unknown>;
}

export interface IntercompanyRepaymentPairParams {
  fundingCompanyId: number;
  responsibleCompanyId: number;
  advanceNumber: string;
  partyName: string;
  amount: number;
  date: Date | string;
  repaymentNumber: string;
  fundingReceivableAccountId: number;
  fundingCashBankAccountId: number;
  responsiblePayableAccountId: number;
  responsibleCashBankAccountId: number;
  afterPost?: (tx: any, entries: {
    sourceEntry: any;
    mirrorEntry: any;
  }) => Promise<unknown>;
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function resolveJournal(
  companyId: number,
  type: "bank" | "cash" | "general",
  client: DbClient = db,
) {
  const rows = await client.execute<{ id: number; code: string; type: string }>(sql`
    SELECT id, code, type FROM accounting_journals
    WHERE (company_id = ${companyId} OR company_id IS NULL)
      AND type = ${type}
    ORDER BY company_id DESC NULLS LAST
    LIMIT 1
  `).then((r) => r.rows);
  if (rows.length) return rows[0];
  // Fallback: any journal
  const fallback = await client.execute<{ id: number; code: string; type: string }>(sql`
    SELECT id, code, type FROM accounting_journals
    WHERE company_id = ${companyId} OR company_id IS NULL
    ORDER BY id LIMIT 1
  `).then((r) => r.rows[0] ?? null);
  return fallback;
}

async function requireJournal(
  companyId: number,
  type: "bank" | "cash" | "general",
  client: DbClient = db,
) {
  const j = await resolveJournal(companyId, type, client);
  if (!j) {
    throw new AccountingConfigError(
      `Jurnal '${type}' tidak ditemukan. Konfigurasi jurnal akuntansi diperlukan.`,
    );
  }
  return j;
}

async function requireExactJournal(companyId: number, type: "bank" | "cash" | "general") {
  const [j] = await db.execute<{ id: number; code: string; type: string }>(sql`
    SELECT id, code, type FROM accounting_journals
    WHERE company_id = ${companyId} AND type = ${type}
    ORDER BY id LIMIT 1
  `).then((r) => r.rows);
  if (!j) {
    throw new AccountingConfigError(
      `Jurnal '${type}' untuk perusahaan ${companyId} tidak ditemukan. Konfigurasi jurnal akuntansi diperlukan.`,
    );
  }
  return j;
}

// FAIL-CLOSED (Task #6): "Marketing", "Operasional", "Proyek" removed from
// INTERCOMPANY_EXPENSE_CODES. Those categories must be assigned a specific
// COA via the COA governance workflow rather than silently falling back to
// the generic 5-2040 (Beban Operasional Lain) account.
const INTERCOMPANY_EXPENSE_CODES: Record<string, string> = {
  "Pembayaran Vendor":  "5-1010",
  "Pembelian Barang":   "5-1010",
  "Freight / Pengiriman": "5-1011",
  "Customs Clearance":  "5-1012",
  "Pajak":              "5-3020",
  "Perjalanan Dinas":   "5-2050",
  "Gaji / Karyawan":    "5-2010",
};

async function requireCompanyCoa(companyId: number, baseCode: string, type: string) {
  let [account] = await db.execute<{ id: number; code: string; name: string }>(sql`
    SELECT id, code, name
    FROM chart_of_accounts
    WHERE company_id = ${companyId}
      AND code LIKE ${baseCode + "%"}
      AND type = ${type}
      AND is_active = true
      AND is_header = false
      AND is_postable = true
    ORDER BY code LIMIT 1
  `).then((r) => r.rows);

  // Intercompany accounts were added after some advances had already been
  // created.  The accounting seed can be skipped by its fast-path on older
  // databases, so repair these two structural accounts at the point of use.
  // This is idempotent and also reactivates an account that was accidentally
  // disabled.  Expense COA mappings remain strict and are not auto-created.
  if (!account && (baseCode === "1-1099" || baseCode === "2-2098")) {
    const accountName =
      baseCode === "1-1099"
        ? "Piutang Intercompany Dana Talangan"
        : "Hutang Dana Talangan Intercompany";
    const accountSubtype = baseCode === "1-1099" ? "receivable" : "current_liability";

    await db.execute(sql`
      INSERT INTO chart_of_accounts (
        company_id, code, name, type, subtype, is_active, created_at
      )
      VALUES (
        ${companyId}, ${baseCode}, ${accountName}, ${type}, ${accountSubtype}, true, NOW()
      )
      ON CONFLICT (company_id, code)
      DO UPDATE SET
        name = EXCLUDED.name,
        type = EXCLUDED.type,
        subtype = EXCLUDED.subtype,
        is_active = true
    `);

    [account] = await db.execute<{ id: number; code: string; name: string }>(sql`
      SELECT id, code, name
      FROM chart_of_accounts
      WHERE company_id = ${companyId}
        AND code LIKE ${baseCode + "%"}
        AND type = ${type}
        AND is_active = true
      ORDER BY code LIMIT 1
    `).then((r) => r.rows);
  }

  if (!account) {
    throw new AccountingConfigError(
      `Mapping COA ${baseCode} untuk perusahaan ${companyId} tidak tersedia. Lengkapi COA sebelum memposting intercompany.`,
    );
  }
  return account;
}

export async function resolveIntercompanyAccounts(params: {
  fundingCompanyId: number;
  responsibleCompanyId: number;
  category?: string | null;
}) {
  // FAIL-CLOSED (Task #6): no "5-2040" default. If the category has no
  // specific mapping, throw AccountingConfigError instead of silently using
  // the generic "Beban Operasional Lain" account.
  const expenseCode = INTERCOMPANY_EXPENSE_CODES[params.category ?? ""] ?? null;
  if (!expenseCode) {
    throw new AccountingConfigError(
      `Kategori intercompany "${params.category ?? "tidak diketahui"}" tidak memiliki mapping COA spesifik. ` +
      `Tambahkan mapping COA melalui governance sebelum memposting intercompany advance.`,
    );
  }
  // Task #6: fail-closed — unknown category must NOT silently default to generic 5-2040.
  // requireCompanyCoa will throw AccountingConfigError if the code is not found,
  // but we additionally reject unknown categories before even attempting a lookup.
  const [fundingReceivable, responsiblePayable, responsibleExpense] = await Promise.all([
    requireCompanyCoa(params.fundingCompanyId, "1-1099", "asset"),
    requireCompanyCoa(params.responsibleCompanyId, "2-2098", "liability"),
    requireCompanyCoa(params.responsibleCompanyId, expenseCode, "expense"),
  ]);
  return {
    fundingReceivable,
    responsiblePayable,
    responsibleExpense,
    expenseCode,
  };
}

/** Resolve receivable COA for a given advance type. */
export async function resolveReceivableAccount(
  advanceType: string,
  companyId: number,
): Promise<number | null> {
  const isKasbon =
    advanceType === "kasbon" || advanceType === "EMPLOYEE";
  const coaPrefix = isKasbon ? "1-1032" : "1-1033";
  const rows = await db
    .select({ id: chartOfAccountsTable.id })
    .from(chartOfAccountsTable)
    .where(
      sql`code LIKE ${coaPrefix + "%"} AND (company_id = ${companyId} OR company_id IS NULL)`,
    )
    .orderBy(sql`company_id DESC NULLS LAST`)
    .limit(1);
  return rows[0]?.id ?? null;
}

function advanceTypeLabel(advanceType: string): string {
  const map: Record<string, string> = {
    kasbon:      "Kasbon",
    talangan:    "Dana Talangan",
    EMPLOYEE:    "Employee Advance",
    VENDOR:      "Vendor Advance",
    CUSTOMER:    "Customer Advance",
    PROJECT:     "Project Advance",
    PURCHASE:    "Purchase Advance",
    TRAVEL:      "Travel Advance",
    OPERATIONAL: "Operational Advance",
    OTHER:       "Advance",
  };
  return map[advanceType] ?? `Advance (${advanceType})`;
}

async function postRepaymentJournalOnClient(
  client: DbClient,
  p: RepaymentJournalParams,
): Promise<JournalResult> {
  const pm = p.paymentMethod ?? "bank";
  const journalType = pm === "cash" ? "cash" : "bank";
  const j = await requireJournal(p.companyId, journalType, client);
  const ref = p.refSuffix
    ? `${p.advanceNumber}-${p.refSuffix}`
    : `RPY-${p.advanceNumber}`;

  const entry = await postEntryWithClient(
    client,
    {
      journalId: j.id,
      date: new Date(p.date),
      ref,
      description: `${ref} — Pelunasan Advance ${p.partyName}`,
      source: "kasbon",
      sourceModule: "advance_repayment",
      companyId: p.companyId,
      lines: [
        {
          accountId: p.cashBankAccountId,
          debit: p.amount,
          credit: 0,
          description: pm === "cash" ? "Kas" : "Bank",
        },
        {
          accountId: p.receivableAccountId,
          debit: 0,
          credit: p.amount,
          description: `Advance — ${p.partyName}`,
        },
      ],
    } as PostingInput,
    j.code,
  );

  return { entryId: entry.id };
}

// ── AdvanceJournalService ─────────────────────────────────────────────────────

export const AdvanceJournalService = {
  /**
   * Post both books for an internal-company advance in one database transaction.
   *
   * Funding company: DR Piutang Intercompany / CR Kas-Bank.
   * Responsible company: DR Beban-Aset sesuai mapping / CR Hutang Intercompany.
   */
  async postIntercompanyDisbursementPair(
    p: IntercompanyDisbursementPairParams,
  ): Promise<{ fundingEntryId: number; responsibleEntryId: number; afterPostResult?: unknown }> {
    const [fundingJournal, responsibleJournal] = await Promise.all([
      requireExactJournal(p.fundingCompanyId, "bank"),
      requireExactJournal(p.responsibleCompanyId, "general"),
    ]);
    const reference = `IC-ADV-${p.advanceNumber}`;
    const description = `Dana Talangan ${p.advanceNumber} — ${p.partyName}`;

    const result = await postIntercompanyPair({
      sourceJournalCode: fundingJournal.code,
      mirrorJournalCode: responsibleJournal.code,
      sourceInput: {
        journalId: fundingJournal.id,
        date: new Date(p.date),
        ref: reference,
        description: `${description} — Piutang Intercompany`,
        source: "kasbon",
        sourceModule: "advance_intercompany_funding",
        companyId: p.fundingCompanyId,
        lines: [
          {
            accountId: p.fundingReceivableAccountId,
            debit: p.amount,
            credit: 0,
            description: `Piutang Intercompany ke perusahaan penanggung`,
          },
          {
            accountId: p.fundingCashBankAccountId,
            debit: 0,
            credit: p.amount,
            description: `Pencairan Dana Talangan ${p.advanceNumber}`,
          },
        ],
      },
      afterPost: p.afterPost,
      mirrorInput: {
        journalId: responsibleJournal.id,
        date: new Date(p.date),
        ref: reference,
        description: `${description} — Hutang Intercompany`,
        source: "kasbon",
        sourceModule: "advance_intercompany_responsible",
        companyId: p.responsibleCompanyId,
        lines: [
          {
            accountId: p.responsibleExpenseAccountId,
            debit: p.amount,
            credit: 0,
            description: `Beban/Aset ${p.category ?? "Dana Talangan"}${p.purpose ? ` — ${p.purpose}` : ""}`,
          },
          {
            accountId: p.responsiblePayableAccountId,
            debit: 0,
            credit: p.amount,
            description: `Hutang Intercompany ke perusahaan pemberi dana`,
          },
        ],
      },
    });
    return {
      fundingEntryId: result.sourceEntry.id,
      responsibleEntryId: result.mirrorEntry.id,
      afterPostResult: result.afterPostResult,
    };
  },

  /**
   * Post both books for an intercompany repayment in one transaction.
   *
   * Responsible company: DR Hutang Intercompany / CR Kas-Bank.
   * Funding company: DR Kas-Bank / CR Piutang Intercompany.
   */
  async postIntercompanyRepaymentPair(
    p: IntercompanyRepaymentPairParams,
  ): Promise<{ fundingEntryId: number; responsibleEntryId: number; afterPostResult?: unknown }> {
    const [fundingJournal, responsibleJournal] = await Promise.all([
      requireExactJournal(p.fundingCompanyId, "bank"),
      requireExactJournal(p.responsibleCompanyId, "bank"),
    ]);
    const reference = `IC-RPY-${p.advanceNumber}-${p.repaymentNumber}`;
    const description = `Pelunasan Dana Talangan ${p.advanceNumber}`;

    const result = await postIntercompanyPair({
      sourceJournalCode: responsibleJournal.code,
      mirrorJournalCode: fundingJournal.code,
      sourceInput: {
        journalId: responsibleJournal.id,
        date: new Date(p.date),
        ref: reference,
        description: `${description} — Buku Penanggung`,
        source: "kasbon",
        sourceModule: "advance_intercompany_repay_responsible",
        companyId: p.responsibleCompanyId,
        lines: [
          {
            accountId: p.responsiblePayableAccountId,
            debit: p.amount,
            credit: 0,
            description: `Pelunasan Hutang Intercompany`,
          },
          {
            accountId: p.responsibleCashBankAccountId,
            debit: 0,
            credit: p.amount,
            description: `Kas/Bank perusahaan penanggung`,
          },
        ],
      },
      afterPost: p.afterPost,
      mirrorInput: {
        journalId: fundingJournal.id,
        date: new Date(p.date),
        ref: reference,
        description: `${description} — Buku Pemberi Dana`,
        source: "kasbon",
        sourceModule: "advance_intercompany_repay_funding",
        companyId: p.fundingCompanyId,
        lines: [
          {
            accountId: p.fundingCashBankAccountId,
            debit: p.amount,
            credit: 0,
            description: `Kas/Bank perusahaan pemberi dana`,
          },
          {
            accountId: p.fundingReceivableAccountId,
            debit: 0,
            credit: p.amount,
            description: `Pelunasan Piutang Intercompany`,
          },
        ],
      },
    });
    return {
      responsibleEntryId: result.sourceEntry.id,
      fundingEntryId: result.mirrorEntry.id,
      afterPostResult: result.afterPostResult,
    };
  },

  /**
   * Post disbursement journal.
   * DR Advance Receivable / CR Bank or Kas.
   * Called when advance is disbursed (money leaves company).
   */
  async postDisbursementJournal(p: DisbursementJournalParams): Promise<JournalResult> {
    const pm = p.paymentMethod ?? "bank";
    const journalType = pm === "cash" ? "cash" : "bank";
    const j = await requireJournal(p.companyId, journalType);
    const label = advanceTypeLabel(p.advanceType);

    const entry = await postEntry(
      {
        journalId: j.id,
        date: new Date(p.date),
        ref: p.advanceNumber,
        description: p.description ?? `${p.advanceNumber} — Disbursement ${label} ${p.partyName}`,
        // PA-06: use 'kasbon' (most specific valid enum) for all advance journals;
        // sourceModule carries the sub-type for filtering/reporting.
        source: "kasbon",
        sourceModule: "advance_disbursement",
        companyId: p.companyId,
        lines: [
          {
            accountId: p.receivableAccountId,
            debit: p.amount,
            credit: 0,
            description: `${label} — ${p.partyName}`,
          },
          {
            accountId: p.cashBankAccountId,
            debit: 0,
            credit: p.amount,
            description: pm === "cash" ? "Kas" : "Bank",
          },
        ],
      } as PostingInput,
      j.code,
    );

    return { entryId: entry.id };
  },

  /**
   * Post repayment journal.
   * DR Bank or Kas / CR Advance Receivable.
   * Called when counterparty returns money to company (partial or full).
   */
  async postRepaymentJournal(p: RepaymentJournalParams): Promise<JournalResult> {
    return postRepaymentJournalOnClient(db, p);
  },

  /**
   * Transaction-aware repayment posting. The caller must use the returned
   * entry and persist the repayment/saldo through the same client so a
   * concurrent repayment cannot commit only its journal.
   */
  async postRepaymentJournalWithClient(
    client: DbClient,
    p: RepaymentJournalParams,
  ): Promise<JournalResult> {
    return postRepaymentJournalOnClient(client, p);
  },

  /**
   * Post repayment journal using the supplied database client.
   * This is intentionally kept separate from the public object methods so
   * legacy callers continue to use the global client while transactional
   * callers can share their transaction connection.
   */

  /**
   * Post expense settlement journal (Pertanggungjawaban).
   * DR Expense / CR Advance Receivable.
   * No cash movement — reclassify receivable to expense with receipt proof.
   */
  async postExpenseSettlement(p: ExpenseSettlementParams): Promise<JournalResult> {
    const j = await requireJournal(p.companyId, "general");

    const entry = await postEntry(
      {
        journalId: j.id,
        date: new Date(p.date),
        ref: p.settlementRef,
        description: `${p.settlementRef} — Pertanggungjawaban Advance ${p.partyName}${p.category ? ` (${p.category})` : ""}`,
        source: "kasbon",
        sourceModule: "advance_settlement",
        companyId: p.companyId,
        lines: [
          {
            accountId: p.expenseAccountId,
            debit: p.amount,
            credit: 0,
            description: `Beban — ${p.partyName}`,
          },
          {
            accountId: p.receivableAccountId,
            debit: 0,
            credit: p.amount,
            description: `Advance — ${p.partyName}`,
          },
        ],
      } as PostingInput,
      j.code,
    );

    return { entryId: entry.id };
  },

  /**
   * Post allocation-based settlement journal (Unified Engine).
   * DR Bank (amount_received) / CR Advance Receivable + other COA lines.
   * Called by POST /api/advances/:id/settle with allocation_lines payload.
   */
  async postAllocationSettlement(p: AllocationSettlementParams): Promise<JournalResult> {
    const j = await requireJournal(p.companyId, "bank");

    const lines: Array<{
      accountId: number;
      debit: number;
      credit: number;
      description: string;
    }> = [
      {
        accountId: p.bankAccountId,
        debit: p.amountReceived,
        credit: 0,
        description: `Settlement ${p.settlementNumber}`,
      },
    ];

    for (const line of p.allocationLines) {
      const amt = Number(line.amount);
      if (amt <= 0) continue;
      const creditAccountId =
        line.allocation_type === "ADVANCE_PRINCIPAL"
          ? p.receivableAccountId
          : line.coa_id
          ? Number(line.coa_id)
          : null;
      if (!creditAccountId) continue;
      lines.push({
        accountId: creditAccountId,
        debit: 0,
        credit: amt,
        description: `${line.allocation_type}${line.remarks ? ` — ${line.remarks}` : ""}`,
      });
    }

    const balance = validateJournalBalance(lines);
    if (!balance.balanced) {
      throw new JournalPostingError(
        `Journal tidak balance: debit ${balance.totalDebit} ≠ credit ${balance.totalCredit} (diff ${balance.diff})`,
      );
    }

    const entry = await postEntry(
      {
        journalId: j.id,
        date: new Date(p.date),
        ref: p.settlementNumber,
        description: `Settlement Advance ${p.advanceNumber} — ${p.partyName}`,
        source: "kasbon",
        sourceModule: "advance_allocation_settlement",
        companyId: p.companyId,
        lines,
      } as PostingInput,
      j.code,
    );

    return { entryId: entry.id };
  },

  /**
   * Post Allocation Engine journal (Standalone — tidak terkait satu advance).
   * DR Bank (received_amount) / CR each allocation line by COA.
   * Called by POST /api/allocation/:id/post.
   *
   * RULE: Semua journal dari Allocation Engine harus melalui method ini.
   */
  async postAllocationEngineJournal(p: {
    companyId: number;
    allocationNo: string;
    receivedAmount: number;
    date: Date | string;
    bankAccountId: number;
    lines: Array<{
      allocation_type: string;
      coa_id: number;
      amount: number;
      remarks?: string | null;
    }>;
    actor?: string | null;
  }): Promise<JournalResult> {
    const j = await requireJournal(p.companyId, "bank");

    const journalLines: Array<{
      accountId: number;
      debit: number;
      credit: number;
      description: string;
    }> = [
      {
        accountId: p.bankAccountId,
        debit: p.receivedAmount,
        credit: 0,
        description: `Bank Receipt — ${p.allocationNo}`,
      },
    ];

    for (const line of p.lines) {
      const amt = Number(line.amount);
      if (amt <= 0) continue;
      journalLines.push({
        accountId: Number(line.coa_id),
        debit: 0,
        credit: amt,
        description: `${line.allocation_type}${line.remarks ? ` — ${line.remarks}` : ""}`,
      });
    }

    const balance = validateJournalBalance(journalLines);
    if (!balance.balanced) {
      throw new JournalPostingError(
        `Allocation journal tidak balance: debit ${balance.totalDebit} ≠ credit ${balance.totalCredit} (selisih ${balance.diff})`,
      );
    }

    const entry = await postEntry(
      {
        journalId: j.id,
        date: new Date(p.date),
        ref: p.allocationNo,
        description: `Allocation ${p.allocationNo}${p.actor ? ` — ${p.actor}` : ""}`,
        source: "manual",
        sourceModule: "allocation_engine",
        companyId: p.companyId,
        lines: journalLines,
      } as PostingInput,
      j.code,
    );

    return { entryId: entry.id };
  },

  /**
   * Post void reversal: counter-entry that zeros the original disbursement journal.
   * Called when advance is voided BEFORE money is physically disbursed.
   * Uses createReversalJournal from accountingPostingGuard (single reversal implementation).
   */
  async postVoidReversal(p: VoidReversalParams): Promise<JournalResult> {
    const result = await createReversalJournal({
      originalEntryId: p.originalEntryId,
      companyId: p.companyId,
      actor: p.actor,
      reason: p.reason,
      tag: `[VOID ${p.advanceNumber}]`,
    });

    if (!result.ok) {
      throw new JournalPostingError(
        result.error ?? "createReversalJournal returned ok=false without error message",
      );
    }

    return { entryId: result.entryId! };
  },
};
