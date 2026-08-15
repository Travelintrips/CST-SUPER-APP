import { describe, expect, it } from "vitest";
import { resolveCatalogItemKind } from "../catalogVisibility.js";

describe("resolveCatalogItemKind", () => {
  it("treats an explicit legacy product classifier as a product", () => {
    expect(resolveCatalogItemKind({
      type: "product",
      templateKind: "service",
    })).toBe("product");
  });

  it("treats an explicit product template as a product", () => {
    expect(resolveCatalogItemKind({
      type: "service",
      templateKind: "product",
    })).toBe("product");
  });

  it("keeps a consistent service row as a service", () => {
    expect(resolveCatalogItemKind({
      type: "service",
      templateKind: "service",
    })).toBe("service");
  });

  it("returns null when neither classifier is known", () => {
    expect(resolveCatalogItemKind({
      type: null,
      templateKind: null,
    })).toBeNull();
  });
});