import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb } = vi.hoisted(() => ({
  mockDb: { execute: vi.fn() },
}));

vi.mock("@workspace/db", () => ({ db: mockDb }));
vi.mock("drizzle-orm", () => ({
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
    { raw: vi.fn() },
  ),
}));
vi.mock("../../logger.js", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));
vi.mock("../../workerHeartbeat.js", () => ({
  registerHeartbeat: vi.fn(),
  beat: vi.fn(),
}));

describe("dual-write retry idempotency guards", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    delete process.env["MKT_DUAL_WRITE_RETRY_ENABLED"];
    vi.useRealTimers();
  });

  it.each([
    { label: "undefined", value: undefined, enabled: false },
    { label: "false", value: "false", enabled: false },
    { label: "true", value: "true", enabled: true },
    { label: "invalid", value: "TRUE", enabled: false },
  ])("enforces exact opt-in auto-retry flag for $label", async ({ value, enabled }) => {
    vi.resetModules();
    vi.useFakeTimers();
    if (value === undefined) {
      delete process.env["MKT_DUAL_WRITE_RETRY_ENABLED"];
    } else {
      process.env["MKT_DUAL_WRITE_RETRY_ENABLED"] = value;
    }

    const { registerHeartbeat } = await import("../../workerHeartbeat.js");
    const { startDualWriteRetryWorker } = await import("../dualWriteReliabilityService.js");
    startDualWriteRetryWorker();

    expect(registerHeartbeat).toHaveBeenCalledTimes(enabled ? 1 : 0);
  });

  it("resolves an existing ledger row after a conflict instead of creating another log", async () => {
    mockDb.execute
      .mockResolvedValueOnce({ rows: [{ exists: true }] })
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({ rows: [{ id: 55 }] });

    const { createDualWriteLog, resetTableReadinessCache } =
      await import("../dualWriteReliabilityService.js");
    resetTableReadinessCache();
    await expect(createDualWriteLog({
      catalogItemId: 59,
      buyerName: "Buyer",
      buyerEmail: "buyer@example.test",
      idempotencyKey: "mkt-rfq:test-key",
      payload: { idempotencyKey: "mkt-rfq:test-key" },
    })).resolves.toBe(55);

    const insertQuery = mockDb.execute.mock.calls[1]?.[0];
    expect(insertQuery.strings.join(" ")).toContain("ON CONFLICT DO NOTHING");
    expect(insertQuery.values).toContain("mkt-rfq:test-key");
    expect(mockDb.execute).toHaveBeenCalledTimes(3);
  });

  it("rejects exhausted manual retries without claiming or invoking the create path", async () => {
    mockDb.execute
      .mockResolvedValueOnce({ rows: [{ exists: true }] })
      .mockResolvedValueOnce({ rows: [{ id: 55, status: "exhausted", attempt: 3, payload: {} }] });

    const { retrySingleEntry, resetTableReadinessCache } =
      await import("../dualWriteReliabilityService.js");
    resetTableReadinessCache();
    await expect(retrySingleEntry(55)).resolves.toEqual({
      ok: false,
      error: "logId 55 berstatus exhausted; hanya failed yang boleh di-retry",
    });
    expect(mockDb.execute).toHaveBeenCalledTimes(2);
  });

  it("claims the retry batch atomically and excludes legacy rows without a key", async () => {
    mockDb.execute
      .mockResolvedValueOnce({ rows: [{ exists: true }] })
      .mockResolvedValueOnce({ rows: [] });

    const { retryFailedDualWrites, resetTableReadinessCache } =
      await import("../dualWriteReliabilityService.js");
    resetTableReadinessCache();
    await expect(retryFailedDualWrites()).resolves.toEqual({
      retried: 0,
      recovered: 0,
      exhausted: 0,
      skipped: 0,
    });

    const claimQuery = mockDb.execute.mock.calls[1]?.[0];
    const claimSql = claimQuery.strings.join(" ");
    expect(claimSql).toContain("FOR UPDATE SKIP LOCKED");
    expect(claimSql).toContain("UPDATE mkt_dual_write_log AS log");
    expect(claimSql).toContain("idempotency_key IS NOT NULL");
  });
});