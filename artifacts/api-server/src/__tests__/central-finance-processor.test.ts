import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const processor = readFileSync(
  resolve(process.cwd(), "src/lib/centralFinance.ts"),
  "utf8",
);

describe("central finance processor orchestration contract", () => {
  it("claims only available work with a row-locking database claim", () => {
    expect(processor).toContain("FOR UPDATE OF c SKIP LOCKED");
    expect(processor).toContain("c.status IN ('pending', 'failed')");
    expect(processor).toContain("c.available_at <= NOW()");
    expect(processor).toContain("status = 'processing'");
    expect(processor).toContain("attempts = attempts + 1");
  });

  it("delegates accounting ownership to the canonical database function", () => {
    expect(processor).toContain(
      'SELECT sport_center.create_payment_accounting_draft($1)',
    );
    expect(processor).not.toContain("postSportCenterBookingPayment");
    expect(processor).not.toContain("create_payment_settlement_batch");
    expect(processor).not.toContain("resolveConfig");
  });

  it("finishes both durable identities and distinguishes retry from review", () => {
    expect(processor).toContain("UPDATE sport_center.central_finance_processing");
    expect(processor).toContain("UPDATE sport_center.payment_accounting_outbox");
    expect(processor).toContain("status === \"manual_review\"");
    expect(processor).toContain("status === \"failed\"");
    expect(processor).toContain("available_at = ${retryAt}");
  });

  it("keeps the processor fail-closed outside explicit central DEV mode", () => {
    expect(processor).toContain("!isCentralFinanceMode()");
    expect(processor).toContain("process.env.NODE_ENV === \"production\"");
    expect(processor).toContain("return { claimed: 0, posted: 0, retried: 0, manualReview: 0 }");
  });
});