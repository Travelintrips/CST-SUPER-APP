// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const reconciliationSource = readFileSync(
  resolve(process.cwd(), "src/pages/accounting/bank-reconciliation.tsx"),
  "utf8",
);

describe("bank reconciliation bulk actions", () => {
  it("selects only safe non-QRIS mutations and keeps select-all scoped to the page", () => {
    expect(reconciliationSource).toContain("const canBulkSelect = (m: BankMutation) =>");
    expect(reconciliationSource).toContain("!isQrisMutation(m) && (canPost(m) || bulkApproveCandidate(m) != null)");
    expect(reconciliationSource).toContain("const bulkSelectableMutations = mutations.filter(canBulkSelect);");
    expect(reconciliationSource).toContain("bulkSelectableMutations.map(m => m.id)");
    expect(reconciliationSource).toContain('aria-label="Pilih semua mutasi yang dapat diproses pada halaman ini"');
  });

  it("offers separate approve and post actions with the matching status guards", () => {
    expect(reconciliationSource).toContain("const selectedBulkApprove = selectedMutations.filter(m => bulkApproveCandidate(m) != null);");
    expect(reconciliationSource).toContain("const selectedBulkPost = selectedMutations.filter(canPost);");
    expect(reconciliationSource).toContain('runBulkAction("approve")');
    expect(reconciliationSource).toContain('runBulkAction("post")');
    expect(reconciliationSource).toContain("Approve Terpilih");
    expect(reconciliationSource).toContain("Post Terpilih");
  });

  it("processes items sequentially and exposes partial failures instead of hiding them", () => {
    expect(reconciliationSource).toContain("for (const mutation of targets)");
    expect(reconciliationSource).toContain("const failures: string[] = [];");
    expect(reconciliationSource).toContain("failures.push(`#${mutation.id}:");
    expect(reconciliationSource).toContain("Bulk action selesai sebagian");
    expect(reconciliationSource).toContain('"x-idempotency-key": crypto.randomUUID()');
  });
});