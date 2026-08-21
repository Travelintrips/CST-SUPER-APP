import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { processCentralFinance } from "../lib/centralFinance.js";

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
    expect(processor).not.toContain("resolveConfig");
  });

  it("reaches the canonical settlement batch and finalize owners", () => {
    expect(processor).toContain("sport_center.create_payment_settlement_batch");
    expect(processor).toContain("sport_center.finalize_payment_settlement");
    expect(processor).toContain("central-finance-processor");
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

  it("uses a supplied transaction client for mode, claim, owner, and state updates", async () => {
    const originalMode = process.env.SPORT_CENTER_FINANCE_MODE;
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.SPORT_CENTER_FINANCE_MODE = "central";
    process.env.NODE_ENV = "development";

    const calls: string[] = [];
    let claimAvailable = true;
    const client = {
      async query(sql: string) {
        calls.push(sql.replace(/\s+/g, " ").trim());
        if (sql.includes("FOR UPDATE OF c SKIP LOCKED")) {
          return claimAvailable
            ? { rows: [{ id: 11, outbox_id: 22, source_payment_id: 33, correlation_id: "cfsc10b-test" }] }
            : { rows: [] };
        }
        if (sql.includes("create_payment_accounting_draft")) {
          claimAvailable = false;
          throw new Error("TRANSIENT_OWNER_FAILURE");
        }
        return { rows: [] };
      },
    };

    try {
      const first = await processCentralFinance({ client: client as never, fixturePaymentIds: [33] });
      const second = await processCentralFinance({ client: client as never, fixturePaymentIds: [33] });

      expect(first).toEqual({ claimed: 1, posted: 0, retried: 1, manualReview: 0 });
      expect(second).toEqual({ claimed: 0, posted: 0, retried: 0, manualReview: 0 });
      const modeIndex = calls.findIndex((sql) => sql.includes("set_config('sport_center.finance_mode'"));
      const ownerIndex = calls.findIndex((sql) => sql.includes("create_payment_accounting_draft"));
      expect(modeIndex).toBeGreaterThan(-1);
      expect(ownerIndex).toBeGreaterThan(modeIndex);
      expect(calls.filter((sql) => sql.includes("create_payment_accounting_draft"))).toHaveLength(1);
    } finally {
      if (originalMode == null) delete process.env.SPORT_CENTER_FINANCE_MODE;
      else process.env.SPORT_CENTER_FINANCE_MODE = originalMode;
      if (originalNodeEnv == null) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
    }
  });

  it("does not touch a client when legacy mode is active", async () => {
    const originalMode = process.env.SPORT_CENTER_FINANCE_MODE;
    process.env.SPORT_CENTER_FINANCE_MODE = "legacy";
    let queries = 0;
    const client = { async query() { queries++; return { rows: [] }; } };
    try {
      await expect(processCentralFinance({ client: client as never })).resolves.toEqual({
        claimed: 0,
        posted: 0,
        retried: 0,
        manualReview: 0,
      });
      expect(queries).toBe(0);
    } finally {
      if (originalMode == null) delete process.env.SPORT_CENTER_FINANCE_MODE;
      else process.env.SPORT_CENTER_FINANCE_MODE = originalMode;
    }
  });
});