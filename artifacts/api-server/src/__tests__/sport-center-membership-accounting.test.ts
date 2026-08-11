/**
 * Sport Center accounting compatibility boundary.
 *
 * Sport Center payments are owned by the Supabase payment-trigger/canonical
 * settlement path. The CST application must retain this legacy export without
 * creating duplicate accounting rows.
 */

import { describe, expect, it, vi } from "vitest";

const mockInfo = vi.fn();

vi.mock("../lib/logger.js", () => ({
  logger: { info: mockInfo, warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

const { backfillSportCenterAccountingPayments } = await import(
  "../lib/backfillSportCenterPayments.js"
);

describe("backfillSportCenterAccountingPayments — compatibility boundary", () => {
  it("returns an empty result without creating accounting rows", async () => {
    await expect(backfillSportCenterAccountingPayments()).resolves.toEqual({
      total: 0,
      posted: 0,
      skipped: 0,
      errors: 0,
      entriesLinked: 0,
      entriesMissing: 0,
    });
  });

  it("records that Sport Center accounting is isolated from the CST application", async () => {
    await backfillSportCenterAccountingPayments();

    expect(mockInfo).toHaveBeenCalledWith(
      "[backfill] Sport Center accounting isolated — no accounting rows created",
    );
  });
});