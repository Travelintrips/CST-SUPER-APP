/**
 * Canonical Posting Engine (Tahap 3).
 *
 * Single public entry point for creating journal entries. Wraps the existing,
 * battle-tested `_postEntryCore` (via `postEntryWithClient`) — it does NOT
 * reimplement idempotency/period-lock/balance logic, it reuses it inside a
 * transaction this engine controls, so future tax-line inserts can commit or
 * roll back atomically with the journal.
 *
 * See docs/canonical-posting-engine/02-design.md for the full design.
 */

import { db, type accountingEntriesTable } from "@workspace/db";
import { postEntryWithClient, type PostingInput } from "../accounting.js";
import { logger } from "../logger.js";
import type { PostingRequest, PostingResult, PostingValidator } from "./types.js";
import { PostingValidationError } from "./types.js";
import { createDefaultValidators } from "./validators.js";

type JournalEntryRow = typeof accountingEntriesTable.$inferSelect;

export class CanonicalPostingEngine {
  constructor(private readonly validators: PostingValidator[] = createDefaultValidators()) {}

  async post(request: PostingRequest): Promise<PostingResult> {
    if (request.taxes && request.taxes.length > 0) {
      // v1 scope: atomic tax+journal posting is not wired up yet — the real
      // tax-detection logic (rate lookup, PPh21 progressive calc, period-lock
      // check) lives in taxAutoService.recordTransactionTax() and has not been
      // safely extracted to run inside an engine-controlled transaction.
      // Migrating that is planned for the postSalesInvoice/postEcommerceOrder
      // step (see docs/canonical-posting-engine/02-design.md §6). Fail loud
      // rather than silently posting the journal without its tax line.
      return {
        ok: false,
        error: "Atomic tax posting belum diimplementasikan di CanonicalPostingEngine v1 — gunakan recordTransactionTax terpisah untuk saat ini.",
        errorCode: "TRANSACTION_FAILED",
      };
    }

    try {
      for (const validator of this.validators) {
        await validator.validate(request, { client: db });
      }
    } catch (err) {
      if (err instanceof PostingValidationError) {
        logger.warn({ err, source: request.source, sourceId: request.sourceId }, `[posting-engine] validation failed: ${err.code}`);
        return { ok: false, error: err.message, errorCode: err.code };
      }
      throw err;
    }

    const input: PostingInput = {
      journalId: request.journalId,
      date: request.date,
      ref: request.ref ?? null,
      description: request.description ?? null,
      source: request.source,
      sourceId: request.sourceId,
      companyId: request.companyId,
      createdById: request.createdById ?? null,
      lines: request.lines,
    };

    try {
      // ⚠️ NOT wrapped in db.transaction() yet, even though this engine's whole
      // purpose is atomic journal+tax posting. Reason (found during Tahap 3
      // testing, see docs/canonical-posting-engine/03-findings-addendum.md):
      // `postLedgerEvent()` swallows its own INSERT errors internally
      // (fire-and-forget audit trail), but if it runs INSIDE a caller-owned
      // `db.transaction()`, a swallowed error there still poisons the whole
      // Postgres transaction — every later statement (including the entry
      // lines insert) silently fails, yet COMMIT does not throw, so the
      // caller gets back a "successful" entryId for a row that was actually
      // rolled back. Wrapping here without first hardening `postLedgerEvent`
      // (SAVEPOINT before its own INSERT) would make that failure MORE likely
      // to happen unnoticed, not less. Until that's fixed, this engine posts
      // exactly like `postEntry()` does today (no explicit transaction) —
      // still fully idempotent/period-lock/balance-checked via
      // `postEntryWithClient`, just not yet wrapping this specific insert
      // with an outer explicit transaction. Re-enable `db.transaction()` here
      // once `taxes` support lands AND postLedgerEvent uses a SAVEPOINT.
      const entry: JournalEntryRow = await postEntryWithClient(db, input, request.journalCode, request.initialStatus ?? "posted");

      // Post-commit hooks — fire-and-forget, must never fail the caller.
      import("../ledgerImmutability.js").then(({ lockAccountingEntry }) => {
        lockAccountingEntry(entry.id, request.createdById ?? "SYSTEM").catch(() => {});
      }).catch(() => {});
      import("../events/financialEventBus.js").then(({ emitJournalCreated }) => {
        emitJournalCreated({
          entryId: entry.id,
          sourceType: request.source,
          sourceId: request.sourceId,
          amount: request.lines.reduce((s, l) => s + (l.debit ?? 0), 0),
          actor: request.createdById ?? "SYSTEM",
          ref: request.ref ?? null,
          companyId: request.companyId,
        });
      }).catch(() => {});

      return { ok: true, entryId: entry.id };
    } catch (err) {
      const e = err as Error;
      logger.error({ err: e, source: request.source, sourceId: request.sourceId }, "[posting-engine] transaction failed");
      return { ok: false, error: e.message, errorCode: "TRANSACTION_FAILED" };
    }
  }
}
