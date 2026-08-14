import { describe, expect, it } from "vitest";
import { resolveTemplateKind } from "../vendorCatalogDraft.js";

describe("resolveTemplateKind", () => {
  it.each(["product", "PRODUCT", "marketplace", " Marketplace "])(
    "maps %s to product",
    (serviceType) => {
      expect(resolveTemplateKind(serviceType)).toBe("product");
    },
  );

  it("treats an omitted invitation type as a product invitation", () => {
    expect(resolveTemplateKind(null)).toBe("product");
    expect(resolveTemplateKind(undefined)).toBe("product");
  });

  it.each(["sea_freight", "air_freight", "trucking", "warehousing", "other"])(
    "keeps %s as service",
    (serviceType) => {
      expect(resolveTemplateKind(serviceType)).toBe("service");
    },
  );
});