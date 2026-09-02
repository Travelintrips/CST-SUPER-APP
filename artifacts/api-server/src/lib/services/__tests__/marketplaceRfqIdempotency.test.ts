import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, mockCreateDualWriteLog } = vi.hoisted(() => ({
  mockDb: { transaction: vi.fn() },
  mockCreateDualWriteLog: vi.fn(),
}));

vi.mock("@workspace/db", () => ({
  db: mockDb,
  mktRfqsTable: {},
  mktRfqLinesTable: {},
}));

vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  sql: Object.assign(
    vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => ({ strings, values })),
    { raw: vi.fn() },
  ),
}));

vi.mock("../dualWriteReliabilityService.js", () => ({
  createDualWriteLog: mockCreateDualWriteLog,
  markDualWriteSuccess: vi.fn().mockResolvedValue(undefined),
  markDualWriteFailed: vi.fn().mockResolvedValue(undefined),
  linkLegacyOrder: vi.fn(),
}));

vi.mock("../../appConfig.js", () => ({
  getAppConfig: vi.fn(),
}));

vi.mock("../../activityLog.js", () => ({
  logActivity: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../logger.js", () => ({
  logger: { warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() },
}));

vi.mock("../../tokenUtils.js", () => ({
  hashToken: vi.fn((value: string) => `hash:${value}`),
}));

vi.mock("../rfqApprovalService.js", () => ({
  initApprovalFlow: vi.fn(),
}));

const tx = {
  execute: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
};

const baseOptions = {
  catalogItem: {
    id: 59,
    vendorId: 54,
    vendorName: "Vendor",
    name: "Service",
    description: null,
    unit: "unit",
    priceSell: 100,
    currency: "IDR",
    categoryKey: "service",
    serviceType: null,
    kategori: null,
    templateKind: null,
    templateId: null,
    templateVersion: null,
    specValues: {},
  },
  buyerName: "Buyer",
  buyerEmail: "buyer@example.test",
  buyerPhone: "081234567890",
  qty: 1,
  idempotencyKey: "mkt-rfq:test-key",
  dualWriteLogId: 55,
};

describe("canonical RFQ idempotency", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateDualWriteLog.mockResolvedValue(0);
    mockDb.transaction.mockImplementation(async (callback: (value: typeof tx) => unknown) => callback(tx));
    tx.execute.mockReset();
    tx.insert.mockReset();
    tx.update.mockReset();
  });

  it("reuses the canonical RFQ recorded on the locked retry log", async () => {
    tx.execute
      .mockResolvedValueOnce({ rows: [{ id: 55, status: "retrying", mkt_rfq_id: 777, idempotency_key: "mkt-rfq:test-key" }] })
      .mockResolvedValueOnce({ rows: [{ id: 777, rfq_number: "MKT-RFQ-202608-0777" }] })
      .mockResolvedValueOnce({ rows: [] });

    const { createMktRfqEntry } = await import("../marketplaceRfqService.js");
    await expect(createMktRfqEntry(baseOptions)).resolves.toEqual({
      rfqId: 777,
      rfqNumber: "MKT-RFQ-202608-0777",
    });

    expect(mockDb.transaction).toHaveBeenCalledTimes(1);
    expect(tx.insert).not.toHaveBeenCalled();
    expect(tx.execute).toHaveBeenCalledTimes(3);
    const lockQuery = tx.execute.mock.calls[0]?.[0];
    expect(lockQuery.values).toContain(55);
    expect(lockQuery.strings.join(" ")).toContain("FOR UPDATE");
  });

  it("does not revive an exhausted retry log", async () => {
    tx.execute.mockResolvedValueOnce({
      rows: [{ id: 55, status: "exhausted", mkt_rfq_id: null, idempotency_key: "mkt-rfq:test-key" }],
    });

    const { createMktRfqEntry } = await import("../marketplaceRfqService.js");
    await expect(createMktRfqEntry(baseOptions)).rejects.toMatchObject({
      code: "DUAL_WRITE_EXHAUSTED",
    });
    expect(tx.insert).not.toHaveBeenCalled();
    expect(tx.execute).toHaveBeenCalledTimes(1);
  });

  it("fails closed when a new canonical RFQ has no durable identity", async () => {
    const { createMktRfqEntry } = await import("../marketplaceRfqService.js");
    const { dualWriteLogId: _ignored, idempotencyKey: _key, ...withoutIdentity } = baseOptions;

    await expect(createMktRfqEntry(withoutIdentity)).rejects.toMatchObject({
      code: "RFQ_IDEMPOTENCY_KEY_REQUIRED",
    });
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });
});