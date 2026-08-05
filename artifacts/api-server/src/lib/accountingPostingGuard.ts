/**
 * Accounting Posting Integrity Guard
 *
 * Prinsip: "Posted Journal is Immutable."
 * Transaksi operasional yang sudah memiliki jurnal POSTED tidak boleh dihapus
 * fisik. Pembatalan WAJIB memakai VOID (belum ada uang keluar) atau REVERSAL
 * (koreksi) atau REPAYMENT (uang sudah keluar, dikembalikan lewat transaksi
 * baru yang membalik saldo, bukan membalik jurnal asal).
 *
 * File ini adalah lapisan tipis di atas `lib/accounting.ts` (postEntry) dan
 * `lib/accounting/ledgerGuard.ts`. Ia TIDAK menduplikasi createJournal() —
 * ia menambahkan pre-condition checks (assertCanXxx) yang dipanggil oleh
 * route handler SEBELUM melakukan DELETE/VOID/REVERSE, plus dua journal
 * factory (createReversalJournal, createRepaymentJournal) yang dipakai
 * modul-modul non-reconciliation (Kasbon, Talangan, Expense, dst).
 *
 * Semua fungsi di sini SENGAJA generic (tidak spesifik satu modul) supaya
 * bisa dipakai ulang oleh Kasbon, Dana Talangan, AR/AP Payment, Installment,
 * Expense, dan modul finansial lain sesuai audit
 * docs/accounting-posting-integrity-audit.md.
 */

import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger.js";
import { postEntry, type PostingLine, type PostingInput } from "./accounting.js";
import { auditFromReq } from "./auditLog.js";
import type { Request } from "express";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TransactionJournalState {
  /** id akan null jika transaksi belum pernah posting jurnal sama sekali. */
  entryId: number | null;
  /** entry_status pada accounting_entries: 'draft' | 'posted' | 'voided' (jika kolom tidak ada, treat as 'posted'). */
  entryStatus?: string | null;
  /** Apakah uang benar-benar sudah keluar/masuk (disbursed) secara fisik. */
  moneyMoved: boolean;
}

export interface GuardResult {
  allowed: boolean;
  reason?: string;
  code?:
    | "NO_JOURNAL_OK"
    | "POSTED_JOURNAL_BLOCKED"
    | "MONEY_MOVED_BLOCKED"
    | "ALREADY_VOIDED"
    | "OK";
}

// ─── assertCanDeleteTransaction ─────────────────────────────────────────────

/**
 * Aturan universal: transaksi HANYA boleh di-hard-delete jika:
 *  1. Belum pernah posting jurnal (entryId == null), DAN
 *  2. Uang belum bergerak sama sekali (moneyMoved === false)
 *
 * Jika salah satu gagal → block, arahkan caller ke VOID atau REPAYMENT.
 */
export function assertCanDeleteTransaction(state: TransactionJournalState): GuardResult {
  if (state.entryId != null) {
    return {
      allowed: false,
      code: "POSTED_JOURNAL_BLOCKED",
      reason:
        "Transaksi ini sudah masuk General Ledger (jurnal ter-posting). " +
        "Gunakan Void/Repayment, bukan Delete.",
    };
  }
  if (state.moneyMoved) {
    return {
      allowed: false,
      code: "MONEY_MOVED_BLOCKED",
      reason: "Dana sudah bergerak (disbursed/diterima) — tidak bisa dihapus. Gunakan Repayment/Reversal.",
    };
  }
  return { allowed: true, code: "NO_JOURNAL_OK" };
}

// ─── assertCanVoidTransaction ────────────────────────────────────────────────

/**
 * VOID hanya sah jika jurnal SUDAH posted TAPI uang BELUM benar-benar keluar
 * (mis. approved tapi belum disbursed). Jika uang sudah keluar, VOID
 * langsung dilarang — harus REPAYMENT.
 */
export function assertCanVoidTransaction(state: TransactionJournalState): GuardResult {
  if (state.entryId == null) {
    return { allowed: false, reason: "Tidak ada jurnal untuk di-void. Gunakan Delete jika transaksi masih draft." };
  }
  if (state.entryStatus === "voided") {
    return { allowed: false, code: "ALREADY_VOIDED", reason: "Jurnal ini sudah pernah di-void sebelumnya." };
  }
  if (state.moneyMoved) {
    return {
      allowed: false,
      code: "MONEY_MOVED_BLOCKED",
      reason: "Dana sudah keluar/diterima — tidak boleh VOID langsung. Gunakan Repayment/Settlement.",
    };
  }
  return { allowed: true, code: "OK" };
}

// ─── assertCanReverseJournal ─────────────────────────────────────────────────

/**
 * REVERSE dipakai untuk koreksi jurnal yang sudah posted (uang sudah keluar,
 * tapi transaksi sumbernya dibatalkan/salah). Reversal SELALU diperbolehkan
 * untuk entry posted yang belum pernah di-reverse — beda dengan VOID yang
 * dilarang begitu uang bergerak.
 */
export function assertCanReverseJournal(state: TransactionJournalState): GuardResult {
  if (state.entryId == null) {
    return { allowed: false, reason: "Tidak ada jurnal untuk di-reverse." };
  }
  if (state.entryStatus === "voided") {
    return { allowed: false, code: "ALREADY_VOIDED", reason: "Jurnal ini sudah di-reverse/void sebelumnya." };
  }
  return { allowed: true, code: "OK" };
}

// ─── validateJournalBalance ──────────────────────────────────────────────────

export interface BalanceCheckResult {
  balanced: boolean;
  totalDebit: number;
  totalCredit: number;
  diff: number;
}

export function validateJournalBalance(lines: Array<{ debit?: number | string | null; credit?: number | string | null }>): BalanceCheckResult {
  const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  const totalCredit = lines.reduce((s, l) => s + (Number(l.credit) || 0), 0);
  const diff = Math.abs(totalDebit - totalCredit);
  return { balanced: diff <= 0.01, totalDebit, totalCredit, diff };
}

// ─── createReversalJournal ───────────────────────────────────────────────────

export interface CreateReversalJournalInput {
  /** accounting_entries.id dari jurnal asal yang akan dibalik. */
  originalEntryId: number;
  companyId: number | null;
  actor: string | null;
  reason: string;
  /** Prefix deskripsi, mis. "[VOID KASBON]" atau "[REVERSE AP PAYMENT]". */
  tag?: string;
}

export interface JournalActionResult {
  ok: boolean;
  entryId?: number;
  error?: string;
}

/**
 * createReversalJournal — buat jurnal pembalik 100% dari entry asal
 * (debit<->credit ditukar), tandai entry asal sebagai 'voided', dan simpan
 * previous_entry_id agar audit trail lengkap. TIDAK PERNAH menghapus jurnal
 * asal — hanya menambah entry baru + menandai status.
 */
export async function createReversalJournal(input: CreateReversalJournalInput): Promise<JournalActionResult> {
  const { originalEntryId, companyId, actor, reason, tag } = input;

  const entryRes = await db.execute(sql`SELECT * FROM accounting_entries WHERE id = ${originalEntryId} LIMIT 1`);
  const orig = entryRes.rows[0] as Record<string, unknown> | undefined;
  if (!orig) return { ok: false, error: `Entry #${originalEntryId} tidak ditemukan.` };
  if (orig["status"] === "voided") return { ok: false, error: "Entry sudah di-void/reverse sebelumnya." };

  const linesRes = await db.execute(sql`SELECT * FROM accounting_entry_lines WHERE entry_id = ${originalEntryId}`);
  const origLines = linesRes.rows as Array<Record<string, unknown>>;
  if (!origLines.length) return { ok: false, error: "Jurnal asal tidak memiliki baris — tidak bisa dibalik." };

  const reversalLines: PostingLine[] = origLines.map((l) => ({
    accountId: Number(l["account_id"]),
    debit: Number(l["credit"] ?? 0),
    credit: Number(l["debit"] ?? 0),
    description: `${tag ?? "[REVERSAL]"} ${String(l["description"] ?? "")}`.trim(),
  }));

  const balance = validateJournalBalance(reversalLines);
  if (!balance.balanced) {
    return { ok: false, error: `Jurnal pembalik tidak balance (debit ${balance.totalDebit} != credit ${balance.totalCredit}).` };
  }

  const baseDesc = `${tag ?? "[REVERSAL]"} ${String(orig["description"] ?? `Entri #${originalEntryId}`)}`;
  const desc = `${baseDesc} — ${reason}`;

  let reversalEntry: Awaited<ReturnType<typeof postEntry>>;
  try {
    reversalEntry = await postEntry(
      {
        journalId: Number(orig["journal_id"]),
        date: new Date(),
        ref: String(orig["ref"] ?? ""),
        description: desc,
        source: "reversal",
        sourceId: originalEntryId,
        createdById: actor,
        companyId: companyId ?? (orig["company_id"] as number | null),
        lines: reversalLines,
      } as PostingInput,
      String(orig["entry_number"] ?? "").split("/")[0] || "JE",
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, originalEntryId }, "[accountingPostingGuard] createReversalJournal failed");
    return { ok: false, error: msg };
  }

  await db.execute(sql`
    UPDATE accounting_entries
    SET status = 'voided', voided_at = NOW(), void_entry_id = ${reversalEntry.id}
    WHERE id = ${originalEntryId}
  `).catch((e: unknown) => {
    logger.warn({ e, originalEntryId }, "[accountingPostingGuard] mark voided failed (non-fatal)");
  });

  await db.execute(sql`
    UPDATE accounting_entries SET previous_entry_id = ${originalEntryId} WHERE id = ${reversalEntry.id}
  `).catch(() => {});

  logger.info({ originalEntryId, reversalEntryId: reversalEntry.id, actor, reason }, "[accountingPostingGuard] Reversal journal created");

  return { ok: true, entryId: reversalEntry.id };
}

// ─── createRepaymentJournal ──────────────────────────────────────────────────

export interface CreateRepaymentJournalInput {
  companyId: number | null;
  actor: string | null;
  journalId: number;
  journalCode: string;
  date: Date;
  ref: string;
  description: string;
  /** Akun yang di-debit (biasanya Kas/Bank saat repayment kasbon/talangan diterima kembali). */
  debitAccountId: number;
  /** Akun yang di-credit (biasanya Piutang Karyawan/Talangan yang berkurang). */
  creditAccountId: number;
  amount: number;
  /** entry asal (opsional) untuk audit trail — TIDAK dianggap reversal karena ini transaksi baru. */
  relatedEntryId?: number | null;
}

/**
 * createRepaymentJournal — dipakai ketika uang SUDAH keluar dan transaksi
 * dilunasi/dikembalikan (bukan dibatalkan). Ini SELALU jurnal baru
 * (DR Kas/Bank, CR Piutang) — bukan pembalik jurnal disbursement asal.
 */
export async function createRepaymentJournal(input: CreateRepaymentJournalInput): Promise<JournalActionResult> {
  const lines: PostingLine[] = [
    { accountId: input.debitAccountId, debit: input.amount, credit: 0, description: input.description },
    { accountId: input.creditAccountId, debit: 0, credit: input.amount, description: input.description },
  ];
  const balance = validateJournalBalance(lines);
  if (!balance.balanced) return { ok: false, error: "Jurnal repayment tidak balance." };

  try {
    const entry = await postEntry(
      {
        journalId: input.journalId,
        date: input.date,
        ref: input.ref,
        description: input.description,
        source: "manual",
        createdById: input.actor,
        companyId: input.companyId,
        lines,
      } as PostingInput,
      input.journalCode,
    );

    if (input.relatedEntryId) {
      await db.execute(sql`
        UPDATE accounting_entries SET previous_entry_id = ${input.relatedEntryId} WHERE id = ${entry.id}
      `).catch(() => {});
    }

    return { ok: true, entryId: entry.id };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, input }, "[accountingPostingGuard] createRepaymentJournal failed");
    return { ok: false, error: msg };
  }
}

// ─── Audit trail helper ──────────────────────────────────────────────────────

/**
 * logPostingGuardAction — wrapper tipis di atas auditFromReq() khusus untuk
 * aksi VOID/REVERSAL/REPAYMENT supaya konsisten module="accounting_posting_guard".
 */
export function logPostingGuardAction(
  req: Request,
  opts: {
    action: "void" | "reverse" | "repayment" | "delete_blocked";
    module: string;
    referenceId: string;
    oldData?: Record<string, unknown> | null;
    newData?: Record<string, unknown> | null;
  },
): void {
  auditFromReq(req, {
    action: `posting_guard_${opts.action}`,
    module: opts.module,
    referenceId: opts.referenceId,
    oldData: opts.oldData ?? null,
    newData: opts.newData ?? null,
  });
}
