import { describe, expect, it, vi, beforeEach } from "vitest";

vi.mock("@workspace/db", () => ({
  db: { execute: vi.fn() },
}));

vi.mock("../lib/services/portalCustomerContextService.js", () => ({
  PortalCustomerContextError: class PortalCustomerContextError extends Error {
    constructor(public readonly statusCode: 404 | 422, message: string) {
      super(message);
    }
  },
  getPortalCustomerContext: vi.fn(),
}));

import { db } from "@workspace/db";
import { getPortalCustomerContext } from "../lib/services/portalCustomerContextService.js";
import { hasCustomerServiceRequestAccess } from "../lib/services/portalServiceRequestOwnership.js";

const execute = vi.mocked(db.execute);
const getContext = vi.mocked(getPortalCustomerContext);

const individualContext = {
  customer: {
    id: 10,
    name: "Customer A",
    email: "a@example.test",
    phone: null,
    customerType: "individual" as const,
    legacyCompany: null,
  },
  customerType: "individual" as const,
  status: "individual" as const,
  companyId: null,
  company: null,
  activeMemberships: [],
  pendingRequest: null,
};

const companyContext = {
  ...individualContext,
  customerType: "company" as const,
  status: "company_mapped" as const,
  companyId: 7,
  company: {
    id: 7,
    name: "Company A",
    code: "CO-A",
    buyerRole: "buyer",
    department: null,
    costCenter: null,
    approvalLevel: null,
  },
};

function request(portalCustomerId?: number, body: Record<string, unknown> = {}) {
  return {
    portalCustomerId,
    body,
  } as any;
}

describe("Customer Service Request canonical ownership", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getContext.mockResolvedValue(individualContext);
    execute.mockResolvedValue({ rows: [] } as any);
  });

  it("allows Customer A to access its own individual request", async () => {
    execute.mockResolvedValueOnce({ rows: [{ id: 101 }] } as any);

    await expect(hasCustomerServiceRequestAccess(request(10), 101)).resolves.toBe(true);
  });

  it("blocks Customer A from Customer B's request and guessed IDs", async () => {
    await expect(hasCustomerServiceRequestAccess(request(10), 202)).resolves.toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("scopes company customers to the canonical active company", async () => {
    getContext.mockResolvedValue(companyContext);
    execute.mockResolvedValueOnce({ rows: [{ id: 303 }] } as any);

    await expect(hasCustomerServiceRequestAccess(
      request(10, { companyId: 999, customerId: 999, customerEmail: "forged@example.test" }),
      303,
    )).resolves.toBe(true);

    expect(getContext).toHaveBeenCalledWith(10);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("does not let forged body identity fields change ownership", async () => {
    execute.mockResolvedValueOnce({ rows: [{ id: 404 }] } as any);

    await expect(hasCustomerServiceRequestAccess(
      request(10, { email: "b@example.test", customerId: 99, companyId: 999 }),
      404,
    )).resolves.toBe(true);
    expect(getContext).toHaveBeenCalledWith(10);
  });

  it("never falls back to guest access when an authenticated customer misses", async () => {
    await expect(hasCustomerServiceRequestAccess(request(10), 505, { allowGuest: true }))
      .resolves.toBe(false);
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("preserves the guest draft contract only for genuinely unauthenticated requests", async () => {
    execute.mockResolvedValueOnce({ rows: [{ id: 606 }] } as any);

    await expect(hasCustomerServiceRequestAccess(request(), 606, { allowGuest: true }))
      .resolves.toBe(true);
    expect(execute).toHaveBeenCalledTimes(1);
  });
});