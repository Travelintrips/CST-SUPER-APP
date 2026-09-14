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
import { postEntryWithClient, type DbClient, type PostingInput } from "../accounting.js";
import { logger } from "../logger.js";
import type { PostingRequest, PostingResult, PostingValidator } from "./types.js";
import { PostingValidationError } from "./types.js";
import { createDefaultValidators } from "./validators.js";

type JournalEntryRow = typeof accountingEntriesTable.$inferSelect;

export class CanonicalPostingEngine {
  constructor(private readonly validators: PostingValidator[] = createDefaultValidators()) {}

  /**
   * Post using the caller's transaction client when one is supplied.
   *
   * The default remains the root db client for existing callers. Payment
   * ingestion supplies its transaction client so validators, the journal, its
   * lines, and the source/payment links all share one PostgreSQL transaction.
   */
  async post(request: PostingRequest, client: DbClient = db): Promise<PostingResult> {
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
        await validator.validate(request, { client });
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
      paymentMethod: request.paymentMethod ?? null,
      source: request.source,
      sourceId: request.sourceId,
      companyId: request.companyId,
      createdById: request.createdById ?? null,
      lines: request.lines,
    };

    try {
      // The caller owns the transaction boundary. postEntryWithClient inserts
      // the entry as draft, inserts lines, then promotes it to posted.
      const entry: JournalEntryRow = await postEntryWithClient(client, input, request.journalCode, request.initialStatus ?? "posted");

      // These hooks are only safe for the root-client path. A transaction
      // caller may still roll back after post() returns, so it must publish
      // its own post-commit effects after the transaction commits.
      if (client === db) {
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
      }

      return { ok: true, entryId: entry.id };
    } catch (err) {
      const e = err as Error;
      logger.error({ err: e, source: request.source, sourceId: request.sourceId }, "[posting-engine] transaction failed");
      return { ok: false, error: e.message, errorCode: "TRANSACTION_FAILED" };
    }
  }
}
