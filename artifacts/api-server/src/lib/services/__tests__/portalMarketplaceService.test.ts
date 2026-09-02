import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDb,
  mockGetCatalogItemPublic,
  mockGetPortalCustomerContext,
  mockCreateMktRfqEntry,
  mockRecordLegacyWriteFailure,
} =
  vi.hoisted(() => ({
    mockDb: {
      execute: vi.fn().mockResolvedValue({ rows: [] }),
      transaction: vi.fn(),
    },
    mockGetCatalogItemPublic: vi.fn(),
    mockGetPortalCustomerContext: vi.fn(),
    mockCreateMktRfqEntry: vi.fn(),
    mockRecordLegacyWriteFailure: vi.fn().mockResolvedValue(undefined),
  }));

vi.mock("@workspace/db", () => ({
  db: mockDb,
  portalProductOrdersTable: {},
  portalProductOrderItemsTable: {},
}));

vi.mock("../portalVendorCatalogService.js", () => ({
  getCatalogItemPublic: mockGetCatalogItemPublic,
}));

vi.mock("../portalCustomerContextService.js", () => ({
  getPortalCustomerContext: mockGetPortalCustomerContext,
}));

vi.mock("../marketplaceRfqService.js", () => ({
  isMarketplaceNewPipelineEnabled: vi.fn().mockResolvedValue(true),
  createMktRfqEntry: mockCreateMktRfqEntry,
  linkMktRfqToLegacy: vi.fn().mockResolvedValue(undefined),
  validateMarketplaceDestinationMetadata: vi.fn().mockResolvedValue({
    placeId: null,
    lat: null,
    lng: null,
  }),
}));

vi.mock("../dualWriteReliabilityService.js", () => ({
  recordLegacyWriteFailure: mockRecordLegacyWriteFailure,
}));

vi.mock("../notificationService.js", () => ({
  NotificationService: {
    saveAndBroadcast: vi.fn().mockResolvedValue(undefined),
  },
}));

const catalogItem = {
  id: 33,
  vendorId: 7,
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
};

const individualContext = {
  customer: {
    id: 42,
    name: "Canonical Buyer",
    email: "canonical@example.test",
    phone: "081234567890",
    customerType: "individual",
    legacyCompany: null,
  },
  customerType: "individual",
  status: "individual",
  companyId: null,
  company: null,
  activeMemberships: [],
  pendingRequest: null,
};

function makeTx() {
  const insertedValues: Record<string, unknown>[] = [];
  const tx = {
    execute: vi.fn().mockResolvedValue({ rows: [] }),
    insert: vi.fn(() => ({
      values: vi.fn((values: Record<string, unknown>) => {
        insertedValues.push(values);
        const query = {
          onConflictDoNothing: vi.fn(() => query),
          returning: vi.fn().mockResolvedValue([
            { id: 101, orderNumber: "MCT-260828-12345" },
          ]),
        };
        return query;
      }),
    })),
  };
  return { tx, insertedValues };
}

describe("submitMarketplaceQuote authenticated ownership boundary", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDb.execute.mockResolvedValue({ rows: [] });
    mockGetCatalogItemPublic.mockResolvedValue(catalogItem);
    mockGetPortalCustomerContext.mockResolvedValue(individualContext);
  });

  it("fails closed when canonical RFQ creation fails for an authenticated customer", async () => {
    const canonicalError = new Error("canonical RFQ insert failed");
    mockCreateMktRfqEntry.mockRejectedValue(canonicalError);

    await expect(
      import("../portalMarketplaceService.js").then(({ submitMarketplaceQuote }) =>
        submitMarketplaceQuote({
          catalogItemId: catalogItem.id,
          portalCustomerId: individualContext.customer.id,
          ip: "127.0.0.1",
          body: {
            idempotency_key: "authenticated-canonical-failure",
            buyer_name: "Canonical Buyer",
            email: "forged@example.test",
            guest_contact: individualContext.customer.phone!,
            destination: "Jakarta",
          },
        }),
      ),
    ).rejects.toBe(canonicalError);

    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("returns the existing RFQ/order for a duplicate quote retry", async () => {
    mockDb.execute.mockResolvedValue({
      rows: [{
        id: 101,
        order_number: "MCT-260828-12345",
        mkt_rfq_id: 202,
        mkt_rfq_number: "MKT-RFQ-202608-0202",
      }],
    });

    const { submitMarketplaceQuote } = await import("../portalMarketplaceService.js");
    const result = await submitMarketplaceQuote({
      catalogItemId: catalogItem.id,
      portalCustomerId: individualContext.customer.id,
      ip: "127.0.0.1",
      body: {
        idempotency_key: "duplicate-quote-retry",
        buyer_name: "Canonical Buyer",
        email: "forged@example.test",
        guest_contact: individualContext.customer.phone!,
        destination: "Jakarta",
      },
    });

    expect(result).toEqual({
      orderNumber: "MCT-260828-12345",
      id: 101,
      status: "Quote Request",
      rfqId: 202,
      rfqNumber: "MKT-RFQ-202608-0202",
      newPipeline: true,
    });
    expect(mockCreateMktRfqEntry).not.toHaveBeenCalled();
    expect(mockDb.transaction).not.toHaveBeenCalled();
  });

  it("uses session customer identity for RFQ and legacy dual-write despite forged body email", async () => {
    const { tx, insertedValues } = makeTx();
    mockDb.transaction.mockImplementation(async (callback: (transaction: ReturnType<typeof makeTx>["tx"]) => unknown) => callback(tx));
    mockCreateMktRfqEntry.mockResolvedValue({ rfqId: 202, rfqNumber: "MKT-RFQ-202608-0202" });

    const { submitMarketplaceQuote } = await import("../portalMarketplaceService.js");
    await submitMarketplaceQuote({
      catalogItemId: catalogItem.id,
      portalCustomerId: individualContext.customer.id,
      ip: "127.0.0.1",
      body: {
        idempotency_key: "authenticated-ownership-boundary",
        buyer_name: "Forged Display Name",
        email: "forged@example.test",
        customer_id: 999999999,
        company_id: 999999999,
        guest_contact: individualContext.customer.phone!,
        destination: "Jakarta",
      } as never,
    });

    expect(mockCreateMktRfqEntry).toHaveBeenCalledWith(
      expect.objectContaining({
        portalCustomerId: individualContext.customer.id,
        buyerEmail: individualContext.customer.email,
        companyId: null,
      }),
    );
    expect(insertedValues[0]).toMatchObject({
      customerName: "Forged Display Name",
      email: individualContext.customer.email,
      companyId: null,
    });
    expect(insertedValues[0]).not.toMatchObject({
      email: "forged@example.test",
      companyId: 999999999,
    });
  });

  it("returns canonical success when the legacy compatibility write fails", async () => {
    const legacyError = Object.assign(
      new Error("duplicate key value violates unique constraint"),
      {
        code: "23505",
        constraint: "portal_product_orders_order_number_unique",
        detail: "Key (order_number)=(MCT-260901-12345) already exists.",
      },
    );
    mockCreateMktRfqEntry.mockResolvedValue({
      rfqId: 202,
      rfqNumber: "MKT-RFQ-202609-0202",
    });
    mockDb.transaction.mockRejectedValue(legacyError);

    const { submitMarketplaceQuote } = await import("../portalMarketplaceService.js");
    const result = await submitMarketplaceQuote({
      catalogItemId: catalogItem.id,
      portalCustomerId: individualContext.customer.id,
      ip: "127.0.0.1",
      correlationId: "fb9a7a52-1d44-4b52-94e1-331c08647b90",
      idempotencyKey: "retry-safe-marketplace-request",
      body: {
        buyer_name: "Canonical Buyer",
        email: "forged@example.test",
        guest_contact: individualContext.customer.phone!,
        destination: "Jakarta",
      },
    });

    expect(result).toMatchObject({
      orderNumber: "MKT-RFQ-202609-0202",
      id: 202,
      status: "Quote Request",
      rfqId: 202,
      rfqNumber: "MKT-RFQ-202609-0202",
      newPipeline: true,
      legacyWritePending: true,
    });
    expect(mockDb.transaction).toHaveBeenCalledTimes(3);
    expect(mockRecordLegacyWriteFailure).toHaveBeenCalledWith(
      202,
      expect.stringContaining("duplicate key value"),
      "fb9a7a52-1d44-4b52-94e1-331c08647b90",
    );
  });

  it("reuses the same canonical RFQ when the client retries after compatibility failure", async () => {
    const legacyError = Object.assign(
      new Error("legacy compatibility unavailable"),
      {
        code: "23505",
        constraint: "portal_product_orders_order_number_unique",
        detail: "Key (order_number)=(MCT-260901-54321) already exists.",
      },
    );
    const secondTx = makeTx();
    mockCreateMktRfqEntry.mockResolvedValue({
      rfqId: 303,
      rfqNumber: "MKT-RFQ-202609-0303",
    });
    mockDb.transaction
      .mockRejectedValueOnce(legacyError)
      .mockRejectedValueOnce(legacyError)
      .mockRejectedValueOnce(legacyError)
      .mockImplementationOnce(async (callback: (transaction: ReturnType<typeof makeTx>["tx"]) => unknown) => callback(secondTx.tx));

    const { submitMarketplaceQuote } = await import("../portalMarketplaceService.js");
    const request = {
      catalogItemId: catalogItem.id,
      portalCustomerId: individualContext.customer.id,
      ip: "127.0.0.1",
      correlationId: "retry-correlation-id",
      idempotencyKey: "stable-marketplace-request",
      body: {
        buyer_name: "Canonical Buyer",
        email: "forged@example.test",
        guest_contact: individualContext.customer.phone!,
        destination: "Jakarta",
      },
    };

    const firstResult = await submitMarketplaceQuote(request);
    const secondResult = await submitMarketplaceQuote(request);

    expect(firstResult).toMatchObject({
      rfqId: 303,
      rfqNumber: "MKT-RFQ-202609-0303",
      id: 303,
      legacyWritePending: true,
    });
    expect(secondResult).toMatchObject({
      rfqId: 303,
      rfqNumber: "MKT-RFQ-202609-0303",
      id: 101,
      newPipeline: true,
    });
    expect(secondResult.orderNumber).toMatch(/^MCT-\d{6}-\d{5}$/);
    expect(mockCreateMktRfqEntry).toHaveBeenCalledTimes(2);
    expect(mockCreateMktRfqEntry).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ idempotencyKey: "stable-marketplace-request" }),
    );
    expect(mockCreateMktRfqEntry).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ idempotencyKey: "stable-marketplace-request" }),
    );
    expect(mockRecordLegacyWriteFailure).toHaveBeenCalledWith(
      303,
      expect.stringContaining("legacy compatibility unavailable"),
      "retry-correlation-id",
    );
    expect(secondTx.insertedValues).toHaveLength(2);
  });

  it("treats identical payloads with different keys as two intentional submissions", async () => {
    const legacyError = Object.assign(new Error("legacy unavailable"), {
      code: "23505",
      constraint: "portal_product_orders_order_number_unique",
    });
    mockCreateMktRfqEntry
      .mockResolvedValueOnce({ rfqId: 401, rfqNumber: "MKT-RFQ-202609-0401" })
      .mockResolvedValueOnce({ rfqId: 402, rfqNumber: "MKT-RFQ-202609-0402" });
    mockDb.transaction.mockRejectedValue(legacyError);

    const { submitMarketplaceQuote } = await import("../portalMarketplaceService.js");
    const baseRequest = {
      catalogItemId: catalogItem.id,
      portalCustomerId: individualContext.customer.id,
      ip: "127.0.0.1",
      body: {
        buyer_name: "Canonical Buyer",
        email: "forged@example.test",
        guest_contact: individualContext.customer.phone!,
        destination: "Jakarta",
      },
    };

    const first = await submitMarketplaceQuote({ ...baseRequest, idempotencyKey: "intentional-submit-a" });
    const second = await submitMarketplaceQuote({ ...baseRequest, idempotencyKey: "intentional-submit-b" });

    expect(first.rfqId).toBe(401);
    expect(second.rfqId).toBe(402);
    expect(mockCreateMktRfqEntry).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ idempotencyKey: "intentional-submit-a" }),
    );
    expect(mockCreateMktRfqEntry).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ idempotencyKey: "intentional-submit-b" }),
    );
  });

  it("fails closed for a blank idempotency identity", async () => {
    const { submitMarketplaceQuote } = await import("../portalMarketplaceService.js");
    await expect(submitMarketplaceQuote({
      catalogItemId: catalogItem.id,
      portalCustomerId: individualContext.customer.id,
      ip: "127.0.0.1",
      idempotencyKey: "   ",
      body: {
        buyer_name: "Canonical Buyer",
        guest_contact: individualContext.customer.phone!,
        destination: "Jakarta",
      },
    })).rejects.toMatchObject({ statusCode: 400 });
    expect(mockCreateMktRfqEntry).not.toHaveBeenCalled();
  });
});