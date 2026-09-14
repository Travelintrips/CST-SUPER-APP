import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const routeSource = readFileSync(
  resolve(process.cwd(), "src/routes/bankReconciliation.ts"),
  "utf8",
);
const engineSource = readFileSync(
  resolve(process.cwd(), "src/lib/reconciliation/unifiedMatchingEngine.ts"),
  "utf8",
);

describe("Sport Center bank reconciliation approval boundary", () => {
  it("does not classify multiple active Sport Center payments as ready", () => {
    const statusStart = routeSource.indexOf("function effectiveBankMutationStatusSql");
    const statusEnd = routeSource.indexOf("type ReconciliationRepairDisposition", statusStart);
    const statusSql = routeSource.slice(statusStart, statusEnd);

    expect(statusSql).toContain("candidate_type IN ('sport_payment', 'sport_payments')");
    expect(statusSql).toContain("COUNT(DISTINCT sport_payment_match.candidate_id::text) > 1");
    expect(statusSql).toContain("THEN 'duplicate_need_review'");
  });

  it("requires an explicit candidate when approval has multiple Sport Center options", () => {
    expect(engineSource).toContain("SPORT_PAYMENT_CANDIDATE_SELECTION_REQUIRED");
    expect(engineSource).toContain("Mutasi memiliki lebih dari satu kandidat Sport Center aktif");
    expect(engineSource).toContain("Kandidat rekonsiliasi sudah tidak aktif; muat ulang daftar kandidat.");
  });

  it("keeps canonical QRIS and ordinary transfer approval on existing paths", () => {
    expect(routeSource).toContain("approveCanonicalSettlementLink");
    expect(routeSource).toContain("manual_review_required: true");
    expect(engineSource).toContain("selectedType === \"sport_payment\"");
    expect(engineSource).toContain("isSportPaymentInActiveCanonicalSettlement");
  });
});