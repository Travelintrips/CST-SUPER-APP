import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { postEntryWithClient } from "../accounting.js";
import type { DbClient } from "../financial/financialTransaction.js";
import {
  hasMatchingBankDebit,
  invertHistoricalDuplicateLines,
} from "./historicalDuplicateReversalMath.js";

export interface HistoricalDuplicateReversalInput {
  legacyEntryId: number;
  canonicalReplacementEntryId: number;
  expectedCompanyId: number;
  reason: string;
  actor: string;
}

export interface HistoricalDuplicateReversalResult {
  ok: boolean;
  reversalEntryId?: number;
  alreadyReversed?: boolean;
  error?: string;
  code?: string;
}

type Row = Record<string, unknown>;

function amount(value: unknown): number {
  return Number(value ?? 0);
}

function balanced(lines: Row[]): boolean {
  const debit = lines.reduce((sum, line) => sum + amount(line["debit"]), 0);
  const credit = lines.reduce((sum, line) => sum + amount(line["credit"]), 0);
  return Math.abs(debit - credit) <= 0.01;
}

function sameAmount(a: unknown, b: unknown): boolean {
  return Math.abs(amount(a) - amount(b)) <= 0.01;
}

function errorResult(error: string, code = "VALIDATION_FAILED"): HistoricalDuplicateReversalResult {
  return { ok: false, error, code };
}

/**
 * Owner path for confirmed historical duplicate postings.
 *
 * This deliberately does not touch accounting_payments and does not require a
 * bank_mutations owner. All validation and ledger writes happen in one
 * transaction; canonical entries are read-only throughout.
 */
export async function reverseHistoricalDuplicate(
  input: HistoricalDuplicateReversalInput,
): Promise<HistoricalDuplicateReversalResult> {
  try {
    const result = await db.transaction(async (tx) => {
    const legacyRes = await tx.execute(sql`
      SELECT *
      FROM accounting_entries
      WHERE id = ${input.legacyEntryId}
      FOR UPDATE
    `);
    const legacy = legacyRes.rows[0] as Row | undefined;
    if (!legacy) return errorResult(`Legacy entry #${input.legacyEntryId} tidak ditemukan`, "NOT_FOUND");

    if (Number(legacy["company_id"]) !== input.expectedCompanyId) {
      return errorResult("Company legacy entry tidak sesuai dengan company context", "COMPANY_MISMATCH");
    }

    const existingRes = await tx.execute(sql`
      SELECT id
      FROM accounting_entries
      WHERE company_id = ${input.expectedCompanyId}
        AND source::text = 'historical_duplicate_reversal'
        AND source_id = ${input.legacyEntryId}
      ORDER BY id
      LIMIT 1
    `);
    const existing = existingRes.rows[0] as Row | undefined;
    if (existing) {
      return {
        ok: true,
        reversalEntryId: Number(existing["id"]),
        alreadyReversed: true,
      };
    }

    if (legacy["status"] !== "posted") return errorResult("Legacy entry harus berstatus posted", "INVALID_STATUS");
    if (String(legacy["source"]) !== "sport_center_booking") return errorResult("Legacy source harus sport_center_booking", "SOURCE_MISMATCH");
    if (legacy["void_entry_id"] != null) return errorResult("Legacy entry sudah memiliki void_entry_id", "ALREADY_REVERSED");
    if (Boolean(legacy["is_voided"])) return errorResult("Legacy entry sudah is_voided=true", "ALREADY_REVERSED");
    if (Boolean(legacy["is_reversed"])) return errorResult("Legacy entry sudah is_reversed=true", "ALREADY_REVERSED");

    if (input.canonicalReplacementEntryId === input.legacyEntryId) {
      return errorResult("Canonical replacement tidak boleh sama dengan legacy entry", "SAME_ENTRY");
    }

    const canonicalRes = await tx.execute(sql`
      SELECT *
      FROM accounting_entries
      WHERE id = ${input.canonicalReplacementEntryId}
      LIMIT 1
    `);
    const canonical = canonicalRes.rows[0] as Row | undefined;
    if (!canonical) return errorResult("Canonical replacement tidak ditemukan", "CANONICAL_NOT_FOUND");
    if (canonical["status"] !== "posted") return errorResult("Canonical replacement harus berstatus posted", "CANONICAL_INVALID_STATUS");
    if (String(canonical["source"]) !== "sport_center_payment") return errorResult("Canonical source harus sport_center_payment", "CANONICAL_SOURCE_MISMATCH");
    if (Number(canonical["company_id"]) !== input.expectedCompanyId) return errorResult("Company canonical entry tidak sesuai", "CANONICAL_COMPANY_MISMATCH");
    if (!sameAmount(legacy["total_debit"], canonical["total_debit"]) || !sameAmount(legacy["total_credit"], canonical["total_credit"])) {
      return errorResult("Total debit/credit legacy dan canonical tidak sama", "AMOUNT_MISMATCH");
    }

    const [legacyLinesRes, canonicalLinesRes] = await Promise.all([
      tx.execute(sql`SELECT account_id, debit, credit, description FROM accounting_entry_lines WHERE entry_id = ${input.legacyEntryId}`),
      tx.execute(sql`SELECT account_id, debit, credit, description FROM accounting_entry_lines WHERE entry_id = ${input.canonicalReplacementEntryId}`),
    ]);
    const legacyLines = legacyLinesRes.rows as Row[];
    const canonicalLines = canonicalLinesRes.rows as Row[];
    if (!legacyLines.length || !balanced(legacyLines)) return errorResult("Legacy entry tidak balance", "LEGACY_UNBALANCED");
    if (!canonicalLines.length || !balanced(canonicalLines)) return errorResult("Canonical entry tidak balance", "CANONICAL_UNBALANCED");

    if (!hasMatchingBankDebit(legacyLines, canonicalLines)) {
      return errorResult("Bank debit account atau amount tidak sama", "BANK_DEBIT_MISMATCH");
    }

    // The canonical source_id is the sport payment and the legacy source_id is
    // the booking. Requiring this relationship prevents a false replacement.
    const identityRes = await tx.execute(sql`
      SELECT id
      FROM sport_payments
      WHERE id = ${Number(canonical["source_id"])}
        AND booking_id = ${Number(legacy["source_id"])}
      LIMIT 1
    `);
    if (!identityRes.rows.length) {
      return errorResult("Canonical payment tidak terbukti milik booking legacy yang sama", "BUSINESS_IDENTITY_MISMATCH");
    }

    const journalRes = await tx.execute(sql`
      SELECT code
      FROM accounting_journals
      WHERE id = ${Number(legacy["journal_id"])}
      LIMIT 1
    `);
    const journal = journalRes.rows[0] as Row | undefined;
    if (!journal) return errorResult("Journal legacy tidak ditemukan", "JOURNAL_NOT_FOUND");

    const reversalLines = invertHistoricalDuplicateLines(legacyLines.map((line) => ({
      accountId: Number(line["account_id"]),
      debit: amount(line["debit"]),
      credit: amount(line["credit"]),
      description: String(line["description"] ?? ""),
    })));

    const reversal = await postEntryWithClient(
      tx as unknown as DbClient,
      {
        journalId: Number(legacy["journal_id"]),
        date: new Date(),
        ref: String(legacy["ref"] ?? `LEGACY-${input.legacyEntryId}`),
        description: `[HISTORICAL_DUPLICATE_REVERSAL] ${String(legacy["description"] ?? "")} — ${input.reason}`,
        source: "historical_duplicate_reversal" as any,
        sourceId: input.legacyEntryId,
        createdById: input.actor,
        companyId: input.expectedCompanyId,
        lines: reversalLines,
      },
      String(journal["code"]),
    );

    await tx.execute(sql`
      UPDATE accounting_entries
      SET status = 'voided',
          void_entry_id = ${reversal.id},
          is_voided = TRUE,
          is_reversed = TRUE,
          void_reason = ${input.reason},
          voided_at = NOW(),
          voided_by = ${input.actor},
          updated_at = NOW()
      WHERE id = ${input.legacyEntryId}
    `);
    await tx.execute(sql`
      UPDATE accounting_entries
      SET previous_entry_id = ${input.legacyEntryId}
      WHERE id = ${reversal.id}
    `);
    await tx.execute(sql`
      INSERT INTO erp_audit_logs
        (company_id, user_id, action, module, reference_id, new_data, created_at)
      VALUES
        (${input.expectedCompanyId}, ${input.actor}, 'HISTORICAL_DUPLICATE_REVERSAL',
         'accounting', ${String(input.legacyEntryId)},
         ${JSON.stringify({
           legacy_entry_id: input.legacyEntryId,
           canonical_replacement_entry_id: input.canonicalReplacementEntryId,
           reversal_entry_id: reversal.id,
           actor: input.actor,
           reason: input.reason,
         })}::jsonb, NOW())
    `);

    return { ok: true, reversalEntryId: reversal.id, alreadyReversed: false };
    });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("unique") || message.includes("duplicate")) {
      const existingRes = await db.execute(sql`
        SELECT id
        FROM accounting_entries
        WHERE company_id = ${input.expectedCompanyId}
          AND source::text = 'historical_duplicate_reversal'
          AND source_id = ${input.legacyEntryId}
        ORDER BY id
        LIMIT 1
      `);
      const existing = existingRes.rows[0] as Row | undefined;
      if (existing) {
        return { ok: true, reversalEntryId: Number(existing["id"]), alreadyReversed: true };
      }
    }
    throw err;
  }
}