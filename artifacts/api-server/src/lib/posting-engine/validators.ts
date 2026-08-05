/**
 * Canonical Posting Engine — validators (Tahap 3).
 *
 * Each validator is a standalone class implementing `PostingValidator`.
 * New checks can be added to `createDefaultValidators()` without touching
 * existing ones (Open/Closed Principle). All validators are read-only checks
 * run BEFORE the posting transaction starts — the actual insert-time
 * idempotency/period-lock/balance guarantees still live in `_postEntryCore`
 * (via `postEntryWithClient`), so these are a fast-fail pre-check layer, not
 * a replacement for that defense-in-depth.
 */

import { sql } from "drizzle-orm";
import { chartOfAccountsTable } from "@workspace/db";
import { inArray } from "drizzle-orm";
import { logger } from "../logger.js";
import type { PostingRequest, PostingValidator, ValidationContext } from "./types.js";
import { PostingValidationError } from "./types.js";
import { isEffectiveOn } from "../coaGovernance.js";

const PERIOD_LOCK_EXEMPT_SOURCES = new Set(["closing_entry", "reversal", "bank_reconciliation_void"]);

export class FinancialPeriodValidator implements PostingValidator {
  readonly name = "FinancialPeriodValidator";
  async validate(request: PostingRequest, ctx: ValidationContext): Promise<void> {
    if (PERIOD_LOCK_EXEMPT_SOURCES.has(request.source)) return;
    try {
      const { rows } = await ctx.client.execute(sql`
        SELECT is_closed, override_allowed
        FROM financial_periods
        WHERE company_id = ${request.companyId}
          AND year = ${request.date.getFullYear()}
          AND month = ${request.date.getMonth() + 1}
        LIMIT 1
      `);
      const period = rows[0] as { is_closed?: boolean; override_allowed?: boolean } | undefined;
      if (period?.is_closed && !period?.override_allowed) {
        throw new PostingValidationError(
          "PERIOD_CLOSED",
          `Fiscal period ${request.date.getFullYear()}-${String(request.date.getMonth() + 1).padStart(2, "0")} sudah ditutup.`,
        );
      }
    } catch (err) {
      if (err instanceof PostingValidationError) throw err;
      // Non-fatal DB error (e.g. table missing in a very old env) — defer to the
      // DB trigger `ae_period_lock_insert_guard` which will still enforce this.
      logger.warn({ err }, "[posting-engine] FinancialPeriodValidator pre-check failed (non-fatal, DB trigger still enforces)");
    }
  }
}

export class AccountExistenceValidator implements PostingValidator {
  readonly name = "AccountExistenceValidator";
  async validate(request: PostingRequest, ctx: ValidationContext): Promise<void> {
    const accountIds = Array.from(new Set(request.lines.map((l) => l.accountId)));
    if (accountIds.length === 0) return;
    const rows = await ctx.client
      .select({ id: chartOfAccountsTable.id })
      .from(chartOfAccountsTable)
      .where(inArray(chartOfAccountsTable.id, accountIds));
    const found = new Set(rows.map((r) => r.id));
    const missing = accountIds.filter((id) => !found.has(id));
    if (missing.length > 0) {
      throw new PostingValidationError(
        "ACCOUNT_NOT_FOUND",
        `Akun COA tidak ditemukan: ${missing.join(", ")}`,
      );
    }
  }
}

export class AccountPostingGovernanceValidator implements PostingValidator {
  readonly name = "AccountPostingGovernanceValidator";
  async validate(request: PostingRequest, ctx: ValidationContext): Promise<void> {
    const accountIds = Array.from(new Set(request.lines.map((l) => l.accountId)));
    if (accountIds.length === 0) return;
    const rows = await ctx.client
      .select({
        id: chartOfAccountsTable.id,
        companyId: chartOfAccountsTable.companyId,
        isActive: chartOfAccountsTable.isActive,
        isPostable: chartOfAccountsTable.isPostable,
        isHeader: chartOfAccountsTable.isHeader,
        status: chartOfAccountsTable.status,
        effectiveFrom: chartOfAccountsTable.effectiveFrom,
        effectiveTo: chartOfAccountsTable.effectiveTo,
      })
      .from(chartOfAccountsTable)
      .where(inArray(chartOfAccountsTable.id, accountIds));
    for (const accountId of accountIds) {
      const account = rows.find((row) => row.id === accountId);
      if (!account) continue;
      if (account.companyId !== null && account.companyId !== request.companyId) {
        throw new PostingValidationError("ACCOUNT_COMPANY_MISMATCH", `Akun ${accountId} bukan milik company posting.`);
      }
      if (!account.isActive || account.status !== "ACTIVE") {
        throw new PostingValidationError("ACCOUNT_INACTIVE", `Akun ${accountId} tidak ACTIVE.`);
      }
      if (account.isHeader || !account.isPostable) {
        throw new PostingValidationError("ACCOUNT_NOT_POSTABLE", `Akun ${accountId} adalah header/non-postable.`);
      }
      if (!isEffectiveOn(account.effectiveFrom, account.effectiveTo, request.date)) {
        throw new PostingValidationError("ACCOUNT_NOT_EFFECTIVE", `Akun ${accountId} tidak berlaku pada tanggal posting.`);
      }
    }
  }
}

export class BalanceValidator implements PostingValidator {
  readonly name = "BalanceValidator";
  async validate(request: PostingRequest): Promise<void> {
    if (request.lines.length === 0) {
      throw new PostingValidationError("NOT_BALANCED", "Journal entry must have at least one line");
    }
    const round2 = (n: number) => Math.round(n * 100) / 100;
    const totalDebit = round2(request.lines.reduce((s, l) => s + (l.debit ?? 0), 0));
    const totalCredit = round2(request.lines.reduce((s, l) => s + (l.credit ?? 0), 0));
    if (Math.abs(totalDebit - totalCredit) > 0.01) {
      throw new PostingValidationError(
        "NOT_BALANCED",
        `Journal entry not balanced: debit=${totalDebit} credit=${totalCredit}`,
      );
    }
  }
}

export function createDefaultValidators(): PostingValidator[] {
  return [
    new FinancialPeriodValidator(),
    new AccountExistenceValidator(),
    new AccountPostingGovernanceValidator(),
    new BalanceValidator(),
  ];
}
