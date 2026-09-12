import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: { execute: vi.fn() },
}));

import { db } from "@workspace/db";
import {
  hasMarketplaceOperatorPermission,
  requireMarketplaceOperator,
  MARKETPLACE_PERMISSION_MODULE,
} from "../lib/marketplaceAuthorization.js";

const execute = vi.mocked(db.execute);

function makeResponse() {
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      response.statusCode = code;
      return response;
    },
    json(body: unknown) {
      response.body = body;
      return response;
    },
  };
  return response;
}

function makeRequest(overrides: Record<string, unknown> = {}) {
  return {
    isAuthenticated: () => true,
    isInternalSession: true,
    method: "GET",
    user: { id: "user-1", role: "admin" },
    ...overrides,
  } as any;
}

describe("Customer Portal Marketplace authorization", () => {
  it("supports explicit view/manage capabilities and rejects unrelated modules", () => {
    expect(hasMarketplaceOperatorPermission([`${MARKETPLACE_PERMISSION_MODULE}:view`], "view")).toBe(true);
    expect(hasMarketplaceOperatorPermission([`${MARKETPLACE_PERMISSION_MODULE}:manage`], "delete")).toBe(true);
    expect(hasMarketplaceOperatorPermission(["finance:view"], "view")).toBe(false);
    expect(hasMarketplaceOperatorPermission([`${MARKETPLACE_PERMISSION_MODULE}:view`], "create")).toBe(false);
  });

  it("returns 401 for unauthenticated requests", async () => {
    const res = makeResponse();
    const allowed = await requireMarketplaceOperator(
      makeRequest({ isAuthenticated: () => false }),
      res as any,
    );

    expect(allowed).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(execute).not.toHaveBeenCalled();
  });

  it("returns 403 for a Company 1 user without Marketplace permission", async () => {
    execute.mockResolvedValueOnce({ rows: [{ company_id: 1, role: "admin", permissions: [] }] } as any);
    const res = makeResponse();

    const allowed = await requireMarketplaceOperator(makeRequest(), res as any);

    expect(allowed).toBe(false);
    expect(res.statusCode).toBe(403);
  });

  it("returns 403 for a customer or vendor even if the capability is present", async () => {
    execute
      .mockResolvedValueOnce({ rows: [{ company_id: 1, role: "customer", permissions: [`${MARKETPLACE_PERMISSION_MODULE}:manage`] }] } as any)
      .mockResolvedValueOnce({ rows: [{ company_id: 2, role: "vendor", permissions: [`${MARKETPLACE_PERMISSION_MODULE}:manage`] }] } as any);

    const customerRes = makeResponse();
    const vendorRes = makeResponse();
    const customerAllowed = await requireMarketplaceOperator(
      makeRequest({ user: { id: "customer-1", role: "customer" } }),
      customerRes as any,
    );
    const vendorAllowed = await requireMarketplaceOperator(
      makeRequest({ user: { id: "vendor-1", role: "vendor" } }),
      vendorRes as any,
    );

    expect(customerAllowed).toBe(false);
    expect(customerRes.statusCode).toBe(403);
    expect(vendorAllowed).toBe(false);
    expect(vendorRes.statusCode).toBe(403);
  });

  it("allows an explicitly assigned Company 1 operator and preserves Super Admin bypass", async () => {
    execute.mockResolvedValueOnce({
      rows: [{ company_id: 1, role: "admin", permissions: [`${MARKETPLACE_PERMISSION_MODULE}:manage`] }],
    } as any);
    const operatorRes = makeResponse();
    const operatorAllowed = await requireMarketplaceOperator(makeRequest({ method: "POST" }), operatorRes as any);

    const superAdminRes = makeResponse();
    const superAdminAllowed = await requireMarketplaceOperator(
      makeRequest({ user: { id: "root-1", role: "super_admin" } }),
      superAdminRes as any,
    );

    expect(operatorAllowed).toBe(true);
    expect(operatorRes.statusCode).toBe(200);
    expect(superAdminAllowed).toBe(true);
    expect(superAdminRes.statusCode).toBe(200);
  });
});