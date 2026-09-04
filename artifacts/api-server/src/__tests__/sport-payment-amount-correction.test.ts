import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  assessSportPaymentAmountCorrection,
  buildSportPaymentAmountCorrectionLines,
  calculateInclusiveTaxSplit,
  parseSportPaymentCorrectionAmount,
} from "../lib/reconciliation/sportPaymentAmountCorrectionPolicy.js";

const serviceSource = readFileSync(
  resolve(process.cwd(), "src/lib/reconciliation/sportPaymentAmountCorrection.ts"),
  "utf8",
);
const routeSource = readFileSync(
  resolve(process.cwd(), "src/routes/bankReconciliation.ts"),
  "utf8",
);
const migrationSource = readFileSync(
  resolve(process.cwd(), "src/modules/sport-center/migration.ts"),
  "utf8",
);

const identity = (overrides: Record<string, unknown> = {}) => ({
  sourceAmount: 100_000,
  mirrorAmount: 100_000,
  accountingPaymentAmount: 100_000,
  journalTotalDebit: 100_000,
  journalTotalCredit: 100_000,
  settlementStatus: "unsettled",
  activeSettlementCount: 0,
  sourceStatus: "confirmed",
  ...overrides,
});

describe("Sport payment amount correction policy", () => {
  it("normalizes a positive amount to IDR cents", () => {
    expect(parseSportPaymentCorrectionAmount("125000.456")).toBe(125000.46);
    expect(() => parseSportPaymentCorrectionAmount(0)).toThrow(/lebih besar/i);
    expect(() => parseSportPaymentCorrectionAmount("not-a-number")).toThrow(/lebih besar/i);
  });

  it("splits an inclusive 11% delta into revenue and tax", () => {
    expect(calculateInclusiveTaxSplit(111_000, 11)).toEqual({
      revenueAmount: 100_000,
      taxAmount: 11_000,
    });
  });

  it("builds balanced additive lines for both increase and decrease", () => {
    const increase = buildSportPaymentAmountCorrectionLines({
      delta: 11_100,
      bankAccountId: 10,
      revenueAccountId: 20,
      taxAccountId: 30,
      taxRate: 11,
      bookingNumber: "SC-001",
    });
    const decrease = buildSportPaymentAmountCorrectionLines({
      delta: -11_100,
      bankAccountId: 10,
      revenueAccountId: 20,
      taxAccountId: 30,
      taxRate: 11,
      bookingNumber: "SC-001",
    });

    for (const lines of [increase, decrease]) {
      expect(lines.reduce((sum, line) => sum + line.debit, 0))
        .toBe(lines.reduce((sum, line) => sum + line.credit, 0));
    }
    expect(increase[0]).toMatchObject({ accountId: 10, debit: 11_100, credit: 0 });
    expect(decrease[0]).toMatchObject({ accountId: 10, debit: 0, credit: 11_100 });
  });

  it("returns apply only when every financial identity still agrees", () => {
    expect(assessSportPaymentAmountCorrection(identity(), 125_000)).toMatchObject({
      kind: "apply",
      amount: 125_000,
      delta: 25_000,
    });
    expect(() => assessSportPaymentAmountCorrection(
      identity({ mirrorAmount: 99_999 }),
      125_000,
    )).toThrow("PAYMENT_FINANCIAL_IDENTITY_DRIFT");
  });

  it("blocks settled payments and makes the same amount a safe no-op", () => {
    expect(() => assessSportPaymentAmountCorrection(
      identity({ activeSettlementCount: 1 }),
      125_000,
    )).toThrow("PAYMENT_SETTLED");
    expect(assessSportPaymentAmountCorrection(identity(), 100_000)).toEqual({
      kind: "noop",
      amount: 100_000,
    });
  });

  it("blocks a second correction through the payment-scoped idempotency identity", () => {
    expect(assessSportPaymentAmountCorrection(
      identity({ existingCorrectionId: 812 }),
      125_000,
    )).toEqual({
      kind: "already_corrected",
      correctionId: 812,
    });
    expect(serviceSource).toContain("source_id = ${input.paymentId}");
    expect(serviceSource).toContain("source_event_id = ${correctionSourceEventId}");
    expect(serviceSource).toContain("sourceId: input.paymentId");
    expect(serviceSource).not.toContain("sourceId: Number(source.booking_id)");
  });
});

describe("Sport payment amount correction transaction guards", () => {
  const routeStart = routeSource.indexOf(
    'router.patch("/qris-candidates/payments/:paymentId/amount"',
  );
  const routeEnd = routeSource.indexOf(
    '// ─── PATCH /api/bank-reconciliation/qris-candidates/payments/:paymentId/date',
    routeStart,
  );
  const route = routeSource.slice(routeStart, routeEnd);

  it("locks the canonical source row and validates company context before the transaction", () => {
    expect(route).toContain("requireAdmin(req, res)");
    expect(route).toContain("resolveCompanyId(req)");
    expect(serviceSource).toContain("FOR UPDATE OF sp");
    expect(serviceSource).toContain("FOR UPDATE OF i, b");
    expect(serviceSource).toContain("AND settlement_status = 'unsettled'");
  });

  it("commits the correction before asynchronously regenerating QRIS candidates", () => {
    expect(route).toContain("await db.transaction((tx)");
    expect(route).toContain("setImmediate(() => queueQrisCandidateRefresh(companyId, paymentId))");
    expect(route).toContain("candidateRefreshPending: result.changed");
    expect(route).not.toContain("await generateQrisCandidates");
  });

  it("enforces one correction event per payment at the database boundary", () => {
    expect(migrationSource).toContain(
      "accounting_entries_sport_amount_correction_event_uniq",
    );
    expect(migrationSource).toContain(
      "source = 'sport_center_amount_correction' AND source_event_id IS NOT NULL",
    );
  });
});