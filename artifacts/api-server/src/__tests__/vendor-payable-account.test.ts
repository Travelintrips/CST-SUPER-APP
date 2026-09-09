import { describe, expect, it, vi } from "vitest";

vi.mock("drizzle-orm", () => ({
  sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
    strings: Array.from(strings),
    values,
  }),
}));

import { resolveVendorPayableAccountId } from "../lib/vendorPayableAccount.js";

function clientReturning(...responses: Array<{ rows: unknown[] }>) {
  return {
    execute: vi.fn(async () => responses.shift() ?? { rows: [] }),
  } as any;
}

const activeAccount = (overrides: Record<string, unknown> = {}) => ({
  id: 49108,
  code: "2-1010-CST",
  name: "Hutang Usaha CST",
  type: "liability",
  is_active: true,
  is_postable: true,
  status: "ACTIVE",
  ...overrides,
});

describe("resolveVendorPayableAccountId", () => {
  it("resolves the unique vendor-payable child below a configured AP parent", async () => {
    const client = clientReturning(
      { rows: [{ ...activeAccount(), is_postable: false }] },
      {
        rows: [{
          id: 76228,
          code: "2-1012-CST",
          name: "Hutang Pemasok/Vendor",
          type: "liability",
          is_active: true,
          is_postable: true,
          status: "ACTIVE",
        }],
      },
    );

    await expect(resolveVendorPayableAccountId(client, 1, 49108)).resolves.toBe(76228);
    expect(client.execute).toHaveBeenCalledTimes(2);
  });

  it("keeps an explicitly named postable vendor-payable account", async () => {
    const client = clientReturning({
      rows: [activeAccount({
        id: 76228,
        code: "2-1012-CST",
        name: "Hutang Pemasok/Vendor",
      })],
    });

    await expect(resolveVendorPayableAccountId(client, 1, 76228)).resolves.toBe(76228);
    expect(client.execute).toHaveBeenCalledTimes(1);
  });

  it("fails closed when the configured parent has multiple vendor-payable children", async () => {
    const client = clientReturning(
      { rows: [{ ...activeAccount(), is_postable: false }] },
      {
        rows: [
          { ...activeAccount({ id: 76228, code: "2-1012-CST", name: "Hutang Pemasok/Vendor" }) },
          { ...activeAccount({ id: 76229, code: "2-1013-CST", name: "Hutang Supplier Lain" }) },
        ],
      },
    );

    await expect(resolveVendorPayableAccountId(client, 1, 49108))
      .rejects.toThrow("lebih dari satu child COA Hutang Pemasok/Vendor");
  });
});