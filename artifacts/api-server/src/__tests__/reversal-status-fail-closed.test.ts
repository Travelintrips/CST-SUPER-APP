import { describe, expect, it } from "vitest";
import {
  ORIGINAL_VOID_UPDATE_FAILED,
  buildOriginalVoidUpdateFailureResult,
} from "../lib/accounting/reversalFailure.js";

describe("reversal status fail-closed contract", () => {
  it("turns original metadata failure into an explicit non-success result", () => {
    const result = buildOriginalVoidUpdateFailureResult({
      entryId: 14593,
      voidEntryId: 28585,
      cause: new Error("LEDGER IMMUTABILITY VIOLATION"),
    });

    expect(result).toMatchObject({
      ok: false,
      voidEntryId: 28585,
      code: ORIGINAL_VOID_UPDATE_FAILED,
    });
    expect(result.error).toContain("LEDGER IMMUTABILITY VIOLATION");
    expect(result.error).toContain("Cleanup dan pelaporan sukses dibatalkan");
  });

  it("does not allow a created reversal id to pass the success/cleanup guard", () => {
    const result = buildOriginalVoidUpdateFailureResult({
      entryId: 10,
      voidEntryId: 20,
      cause: "metadata update returned zero rows",
    });

    const mayContinueWithSuccessOrCleanup = result.ok;

    expect(result.voidEntryId).toBe(20);
    expect(mayContinueWithSuccessOrCleanup).toBe(false);
  });
});
