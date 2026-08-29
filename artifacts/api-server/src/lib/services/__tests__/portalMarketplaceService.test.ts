import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDb, mockGetCatalogItemPublic, mockGetPortalCustomerContext, mockCreateMktRfqEntry } =
  vi.hoisted(() => ({
    mockDb: {
      execute: vi.fn().mockResolvedValue({ rows: [] }),
      transaction: vi.fn(),
    },
    mockGetCatalogItemPublic: vi.fn(),
    mockGetPortalCustomerContext: vi.fn(),
    mockCreateMktRfqEntry: vi.fn(),
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
    insert: vi.fn(() => ({
      values: vi.fn((values: Record<string, unknown>) => {
        insertedValues.push(values);
        return {
          returning: vi.fn().mockResolvedValue([
            { id: 101, orderNumber: "MCT-260828-12345" },
          ]),
        };
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
});