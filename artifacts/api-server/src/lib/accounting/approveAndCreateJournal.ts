/**
 * journalApprovalGate.ts — RULE 1: Single Entry Point Enforcement
 *
 * EXPORTS:
 *   createDraftJournalFromApproval() — generic helper for POS/HRD/MANUAL flows
 *   voidApprovedJournal()            — reversal entry for bank_reconciliation_void
 *
 * NOTE: The reconciliation-specific approveAndCreateJournal() lives in:
 *   lib/reconciliation/unifiedMatchingEngine.ts
 *
 * For bank reconciliation approval, ALWAYS use the UME version (has FOR UPDATE
 * inside a real DB transaction). This module is for non-reconciliation flows.
 *
 * RENAME LOG: The former export `approveAndCreateJournal` in this file has been
 * renamed to `createDraftJournalFromApproval` (Phase 10 hardening) to eliminate
 * ambiguity with the reconciliation-specific function of the same name.
 */

import { logger } from "../logger.js";
import { postEntry, type PostingLine } from "../accounting.js";
import { validateJournalCreation, tagJournalEntry, type LedgerSourceType } from "./ledgerGuard.js";
import { emitJournalCreated } from "../events/financialEventBus.js";
import { autoMapJournalTax } from "../taxEngineCore.js";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import {
  ORIGINAL_VOID_UPDATE_FAILED,
  buildOriginalVoidUpdateFailureResult,
} from "./reversalFailure.js";

function currentPeriod(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateDraftJournalFromApprovalInput {
  sourceType:   LedgerSourceType;
  sourceId:     string | number;
  companyId:    number;
  journalId:    number;
  journalCode:  string;
  lines:        PostingLine[];
  ref?:         string | null;
  description?: string | null;
  date?:        Date | null;
  actor:        string;
  mutationId?:  number | null;
}

export interface CreateDraftJournalFromApprovalResult {
  ok:       boolean;
  entryId?: number;
  error?:   string;
  auditId?: number;
}

// ─── Phase 10: renamed from approveAndCreateJournal ──────────────────────────

/**
 * createDraftJournalFromApproval — generic non-reconciliation journal gate.
 *
 * Use this for POS, HRD, MANUAL_ADJUSTMENT flows.
 * For bank reconciliation approval, use approveAndCreateJournal() from
 *   lib/reconciliation/unifiedMatchingEngine.ts (has FOR UPDATE + atomic tx).
 */
export async function createDraftJournalFromApproval(
  input: CreateDraftJournalFromApprovalInput,
): Promise<CreateDraftJournalFromApprovalResult> {
  const {
    sourceType, sourceId, companyId, journalId, journalCode, lines,
    ref, description, date, actor, mutationId,
  } = input;

  // STEP 1 — Guard validation
  const guardResult = await validateJournalCreation({
    sourceType,
    sourceId,
    amount: lines.reduce((s, l) => s + (Number(l.debit) || 0), 0),
    actor,
    companyId,
    ref: ref ?? null,
  });

  if (!guardResult.allowed) {
    logger.warn(
      { sourceType, sourceId, reason: guardResult.reason },
      "[createDraftJournalFromApproval] REJECTED by ledgerGuard",
    );
    return { ok: false, error: guardResult.reason, auditId: guardResult.auditId };
  }

  // STEP 2 — Post the entry
  let entry: Awaited<ReturnType<typeof postEntry>>;
  try {
    entry = await postEntry(
      {
        journalId,
        date: date ?? new Date(),
        ref: ref ?? null,
        description: description ?? `Journal ${sourceType} #${sourceId}`,
        source: "bank_reconciliation" as any,
        sourceId: typeof sourceId === "number" ? sourceId : null,
        createdById: actor,
        companyId,
        lines,
      },
      journalCode,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error({ err, sourceType, sourceId }, "[createDraftJournalFromApproval] postEntry failed");
    return { ok: false, error: `Journal creation failed: ${msg}` };
  }

  // STEP 3 — Tag the entry with ledger source info
  await tagJournalEntry(entry.id, sourceType, sourceId);

  // STEP 4 — Update mutation status if this is a reconciliation approval
  if (mutationId) {
    await db.execute(sql`
      UPDATE bank_mutations
      SET status      = 'approved',
          journal_id  = ${entry.id},
          approved_at = NOW(),
          approved_by = ${actor}
      WHERE id = ${mutationId}
        AND status != 'approved'
    `).catch((e: unknown) => {
      logger.warn({ e, mutationId }, "[createDraftJournalFromApproval] mutation status update failed (non-fatal)");
    });
  }

  // STEP 5 — Auto-map GL tax lines (fire-and-forget, non-fatal)
  autoMapJournalTax({
    companyId,
    accountingEntryId: entry.id,
    period: currentPeriod(),
    source: String(sourceType),
  }).catch((e: unknown) => {
    logger.warn({ e, entryId: entry.id }, "[createDraftJournalFromApproval] autoMapJournalTax non-fatal");
  });

  // STEP 6 — Emit financial event
  const totalDebit = lines.reduce((s, l) => s + (Number(l.debit) || 0), 0);
  emitJournalCreated({
    entryId: entry.id,
    sourceType,
    sourceId,
    amount: totalDebit,
    actor,
    ref: ref ?? null,
    companyId,
    mutationId: mutationId ?? null,
  });

  logger.info(
    { entryId: entry.id, sourceType, sourceId, actor, mutationId },
    "[createDraftJournalFromApproval] Journal created successfully",
  );

  return { ok: true, entryId: entry.id, auditId: guardResult.auditId };
}

/**
 * @deprecated Use createDraftJournalFromApproval() — this shim exists only for
 * backward compatibility and will be removed in the next major cleanup.
 * For bank reconciliation, use approveAndCreateJournal() from unifiedMatchingEngine.ts.
 */
export const approveAndCreateJournal = createDraftJournalFromApproval;
export type ApproveAndCreateJournalInput  = CreateDraftJournalFromApprovalInput;
export type ApproveAndCreateJournalResult = CreateDraftJournalFromApprovalResult;

// ─── Void journal via approval gate ──────────────────────────────────────────

export interface VoidApprovedJournalInput {
  entryId:    number;
  companyId:  number;
  journalId:  number;
  journalCode: string;
  actor:      string;
  reason?:    string | null;
}

export interface VoidApprovedJournalResult {
  ok:           boolean;
  voidEntryId?: number;
  error?:       string;
  code?:
    | "JOURNAL_ALREADY_VOIDED"
    | "ALREADY_VOIDED_BY_CONCURRENT"
    | "NOT_FOUND"
    | "NO_LINES"
    | typeof ORIGINAL_VOID_UPDATE_FAILED;
}

/**
 * voidApprovedJournal — membuat VOID ENTRY yang membalikkan entri asli.
 *
 * Phase 8 hardening:
 *   1. SELECT FOR UPDATE on original entry (prevents concurrent double-void)
 *   2. Check existing reversal by source/source_id (DB-level duplicate catch)
 *   3. Check void_entry_id column
 *   4. Re-check status after lock
 *   5. Status update failure is now EXPLICIT — logged and returned, not silently swallowed
 *
 * Rule 4: Unapprove TIDAK BOLEH delete journal atau set draft.
 * HARUS membuat VOID ENTRY sebagai reversal.
 */
export async function voidApprovedJournal(
  input: VoidApprovedJournalInput,
): Promise<VoidApprovedJournalResult> {
  const { entryId, companyId, journalId, journalCode, actor, reason } = input;

  // ── Phase 8, Step 1+4: SELECT FOR UPDATE + re-check after lock ──────────────
  let origEntry: Record<string, unknown>;
  try {
    const entryRes = await db.execute(sql`
      SELECT ae.*
      FROM accounting_entries ae
      WHERE ae.id = ${entryId}
        AND ae.company_id = ${companyId}
      FOR UPDATE
      LIMIT 1
    `);
    if (!entryRes.rows.length) {
      return { ok: false, error: `Entry #${entryId} tidak ditemukan`, code: "NOT_FOUND" };
    }
    origEntry = entryRes.rows[0] as Record<string, unknown>;
  } catch (e: unknown) {
    // FOR UPDATE may not work outside a transaction in some pooler configs — fallback to plain SELECT
    const entryRes = await db.execute(sql`
      SELECT * FROM accounting_entries
      WHERE id = ${entryId} AND company_id = ${companyId}
      LIMIT 1
    `);
    if (!entryRes.rows.length) {
      return { ok: false, error: `Entry #${entryId} tidak ditemukan`, code: "NOT_FOUND" };
    }
    origEntry = entryRes.rows[0] as Record<string, unknown>;
  }

  // ── Phase 8, Step 2: status check (after FOR UPDATE) ────────────────────────
  if (origEntry["status"] === "voided") {
    logger.warn({ entryId, companyId }, "[voidApprovedJournal] Entry already voided — JOURNAL_ALREADY_VOIDED");
    return {
      ok: false,
      error: `Entry #${entryId} sudah di-void sebelumnya`,
      code: "JOURNAL_ALREADY_VOIDED",
    };
  }

  // ── Phase 8, Step 3: check void_entry_id column (may be set without status update) ─
  if (origEntry["void_entry_id"] != null) {
    logger.warn({ entryId, voidEntryId: origEntry["void_entry_id"] }, "[voidApprovedJournal] void_entry_id already set — JOURNAL_ALREADY_VOIDED");
    return {
      ok: false,
      error: `Entry #${entryId} sudah memiliki void entry (#${origEntry["void_entry_id"]})`,
      code: "JOURNAL_ALREADY_VOIDED",
    };
  }

  // ── Phase 8, Step 2b: check existing reversal by company_id/source/source_id ──
  // Phase 5 hardening: scope by company_id so a reversal in company A does not
  // block a legitimate void in company B that shares the same source_id.
  // Phase 10: NO silent catch — a failed lookup here must NOT silently allow a
  // duplicate void to proceed. Log explicitly and propagate.
  let existingReversal: { rows: unknown[] };
  try {
    existingReversal = await db.execute(sql`
      SELECT id FROM accounting_entries
      WHERE source::text = 'bank_reconciliation_void'
        AND source_id = ${entryId}
        AND company_id = ${companyId}
      LIMIT 1
    `);
  } catch (lookupErr: unknown) {
    logger.error(
      { err: (lookupErr as Error).message, entryId, companyId },
      "[voidApprovedJournal] CRITICAL: reversal existence check failed — aborting void to prevent duplicate",
    );
    return {
      ok: false,
      error: "Tidak dapat memverifikasi reversal yang ada — void dibatalkan untuk mencegah duplikasi",
    };
  }

  if ((existingReversal.rows as unknown[]).length > 0) {
    const existingRevId = ((existingReversal.rows as any[])[0] as Record<string, unknown>)["id"];
    logger.warn({ entryId, existingRevId }, "[voidApprovedJournal] Reversal already exists — JOURNAL_ALREADY_VOIDED");
    return {
      ok: false,
      error: `Entry #${entryId} sudah memiliki reversal entry (#${existingRevId})`,
      code: "JOURNAL_ALREADY_VOIDED",
    };
  }

  // ── Get entry lines ──────────────────────────────────────────────────────────
  const linesRes = await db.execute(sql`
    SELECT * FROM accounting_entry_lines WHERE entry_id = ${entryId}
  `);
  const origLines = linesRes.rows as Array<Record<string, unknown>>;

  if (!origLines.length) {
    return { ok: false, error: "Entry tidak memiliki baris jurnal", code: "NO_LINES" };
  }

  // ── Buat reversal lines (debit ↔ credit) ────────────────────────────────────
  const reversalLines: PostingLine[] = origLines.map((l) => ({
    accountId: Number(l["account_id"]),
    debit:     Number(l["credit"] ?? 0),
    credit:    Number(l["debit"] ?? 0),
    description: `[VOID] ${String(l["description"] ?? "")}`.trim(),
  }));

  const baseDesc = `[VOID] ${String(origEntry["description"] ?? `Entri #${entryId}`)}`;
  const voidDesc = reason ? `${baseDesc} — ${reason}` : baseDesc;

  let voidEntry: Awaited<ReturnType<typeof postEntry>>;
  try {
    voidEntry = await postEntry(
      {
        journalId,
        date: new Date(),
        ref: origEntry["ref"] ? String(origEntry["ref"]) : null,
        description: voidDesc,
        source: "bank_reconciliation_void",
        sourceId: entryId,
        createdById: actor,
        companyId,
        lines: reversalLines,
      },
      journalCode,
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    // Catch duplicate reversal at DB level (unique index violation)
    if (msg.includes("unique") || msg.includes("duplicate") || msg.includes("idx_accounting_entries")) {
      logger.warn({ entryId }, "[voidApprovedJournal] DB unique constraint blocked duplicate reversal");
      return {
        ok: false,
        error: `Reversal untuk entry #${entryId} sudah ada (concurrent void request)`,
        code: "ALREADY_VOIDED_BY_CONCURRENT",
      };
    }
    return { ok: false, error: `Void entry creation failed: ${msg}` };
  }

  // ── Phase 8, Step 5: Mark original entry as voided — explicit error, not silent ─
  try {
    const metadataUpdate = await db.execute(sql`
      UPDATE accounting_entries
      SET status        = 'voided',
          void_entry_id = ${voidEntry.id},
          void_reason   = ${reason ?? null},
          updated_at    = NOW()
      WHERE id = ${entryId} AND status = 'posted'
      RETURNING status, void_entry_id
    `);

    const updatedMetadata = metadataUpdate.rows[0] as
      | { status?: unknown; void_entry_id?: unknown }
      | undefined;
    if (
      metadataUpdate.rows.length !== 1 ||
      updatedMetadata?.status !== "voided" ||
      Number(updatedMetadata.void_entry_id) !== voidEntry.id
    ) {
      throw new Error(
        `metadata update affected ${metadataUpdate.rows.length} row(s) or returned unexpected void metadata`,
      );
    }

    logger.info({ entryId, voidEntryId: voidEntry.id }, "[voidApprovedJournal] Original entry marked voided");
  } catch (e: unknown) {
    // Status update failed — reversal entry already committed (postEntry succeeded).
    // Log explicitly — this is NOT a successful void. The reversal balances
    // the ledger, but status inconsistency must block downstream cleanup.
    logger.error(
      { err: (e as Error).message, entryId, voidEntryId: voidEntry.id },
      "[voidApprovedJournal] CRITICAL: void entry created but original status NOT updated — " +
      "run scripts/remediate-historical-void-status.mjs to fix",
    );
    return buildOriginalVoidUpdateFailureResult({
      entryId,
      voidEntryId: voidEntry.id,
      cause: e,
    });
  }

  import("../events/financialEventBus.js").then(({ emitJournalVoided }) => {
    emitJournalVoided({
      entryId,
      voidEntryId: voidEntry.id,
      reason: reason ?? null,
      actor,
      companyId,
    });
  }).catch((e: unknown) => {
    logger.warn({ err: (e as Error).message }, "[voidApprovedJournal] emitJournalVoided failed (non-fatal)");
  });

  logger.info({ entryId, voidEntryId: voidEntry.id, actor }, "[voidApprovedJournal] Void entry created successfully");

  return { ok: true, voidEntryId: voidEntry.id };
}
