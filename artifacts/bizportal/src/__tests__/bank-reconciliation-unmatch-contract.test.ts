import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = readFileSync(
  resolve(process.cwd(), "src/pages/accounting/bank-reconciliation.tsx"),
  "utf8",
);

describe("posted bank unmatch UI contract", () => {
  it("reverses before reopening and does not report partial reopen as success", () => {
    const unmatchStart = pageSource.indexOf("const unmatchMut = useMutation");
    const unmatchEnd = pageSource.indexOf("const deleteAllMut = useMutation", unmatchStart);
    expect(unmatchStart).toBeGreaterThanOrEqual(0);
    expect(unmatchEnd).toBeGreaterThan(unmatchStart);
    const flow = pageSource.slice(unmatchStart, unmatchEnd);

    expect(flow.indexOf("/void-journal")).toBeLessThan(flow.indexOf("/reopen"));
    expect(flow).toContain("partialReversal = true");
    expect(flow).toContain("Reversal berhasil, tetapi reopen gagal");
    expect(flow).toContain("invalidate()");
    expect(flow).toContain('title: "Transaksi berhasil di-unmatch"');
  });
});