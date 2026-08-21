import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const resolverSource = readFileSync(
  new URL("../lib/financeProjectConfigResolver.ts", import.meta.url),
  "utf8",
);
const consumerSource = readFileSync(
  new URL("../lib/customerPortalFinanceConsumer.ts", import.meta.url),
  "utf8",
);

describe("CF-CP-6 Customer Portal resolver routing", () => {
  it("routes only the two certified project owners and fails closed otherwise", () => {
    expect(resolverSource).toContain('input.projectCode !== "customer_portal" && input.projectCode !== "sport_center"');
    expect(resolverSource).toContain("public.resolve_customer_portal_finance_config");
    expect(resolverSource).toContain("sport_center.resolve_shared_finance_config");
    expect(resolverSource).toContain("SHARED_CONFIG_PROJECT_UNSUPPORTED");
  });

  it("uses the Customer Portal resolver inside the transaction", () => {
    expect(consumerSource).toContain("resolveFinanceProjectConfigWithClient(client");
    expect(consumerSource).toContain('projectCode: "customer_portal"');
    expect(consumerSource).not.toContain("taxAccountId: 49109");
  });
});