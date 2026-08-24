import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { canSupplierAppearInMarketplace } from "../lib/services/supplierStatusService.js";
import { hasUsablePortalPassword } from "../lib/services/portalAuthService.js";

const routeSource = readFileSync(
  resolve(process.cwd(), "src/routes/portal.ts"),
  "utf8",
);
const lifecycleSource = readFileSync(
  resolve(process.cwd(), "src/lib/services/vendorLifecycleService.ts"),
  "utf8",
);

describe("vendor lifecycle continuation", () => {
  describe("canonical Marketplace visibility", () => {
    const activePublishedSupplier = {
      status: "active",
      isActive: true,
      isVerified: true,
      marketplaceStatus: "published",
    };

    it("allows only a fully active, verified, published supplier", () => {
      expect(canSupplierAppearInMarketplace(activePublishedSupplier)).toBe(true);
    });

    it.each([
      ["status", { status: "pending" }],
      ["isActive", { isActive: false }],
      ["isVerified", { isVerified: false }],
      ["marketplaceStatus", { marketplaceStatus: "draft" }],
    ])("rejects when %s is not satisfied", (_field, override) => {
      expect(
        canSupplierAppearInMarketplace({
          ...activePublishedSupplier,
          ...override,
        }),
      ).toBe(false);
    });
  });

  describe("credential setup and login gate", () => {
    it("treats empty and whitespace-only hashes as requiring setup", () => {
      expect(hasUsablePortalPassword("")).toBe(false);
      expect(hasUsablePortalPassword("   ")).toBe(false);
      expect(hasUsablePortalPassword(null)).toBe(false);
      expect(hasUsablePortalPassword("$2b$10$existing-hash")).toBe(true);
    });
  });

  describe("admin invitation approval invariants", () => {
    it("keeps approval state changes atomic and fail-closed", () => {
      expect(routeSource).toContain("await db.transaction(async (tx) =>");
      expect(routeSource).toContain("LIMIT 1\n        FOR UPDATE");
      expect(routeSource).toContain("await verifySupplier({");
      expect(routeSource).toContain('newMarketplaceStatus: "published"');
      expect(routeSource).toContain("await updateMarketplaceStatus({");
    });

    it("publishes products in the transaction with a duplicate guard", () => {
      expect(routeSource).toContain("WHERE NOT EXISTS (");
      expect(routeSource).toContain("type = 'product'");
      expect(routeSource).not.toMatch(
        /vendor_catalog_items[\s\S]{0,1800}\.catch\(\(e: unknown\)/,
      );
    });

    it("reuses an active submission link on approval retry", () => {
      expect(lifecycleSource).toContain("Approval retries must be deterministic");
      expect(lifecycleSource).toContain("eq(vendorCatalogSubmissionLinksTable.isActive, true)");
      expect(lifecycleSource).toContain("return {");
      expect(lifecycleSource).toContain("existingLink.token");
    });
  });

  describe("inactive vendor route guards", () => {
    it("protects every vendor self-service mutation with the active-vendor guard", () => {
      const guardedRoutes = [
        'router.get("/vendor/catalog", requirePortalAuth, requireActiveVendor',
        'router.post("/vendor/catalog", requirePortalAuth, requireActiveVendor',
        'router.put("/vendor/catalog/:id", requirePortalAuth, requireActiveVendor',
        'router.patch("/vendor/catalog/:id/media-assets", requirePortalAuth, requireActiveVendor',
        'router.post("/vendor/catalog/:id/publish", requirePortalAuth, requireActiveVendor',
        'router.post("/vendor/catalog/:id/unpublish", requirePortalAuth, requireActiveVendor',
        'router.post("/vendor/catalog/:id/archive", requirePortalAuth, requireActiveVendor',
        'router.delete("/vendor/catalog/media/:mediaId", requirePortalAuth, requireActiveVendor',
      ];
      for (const route of guardedRoutes) expect(routeSource).toContain(route);
      expect(routeSource).toContain('"/vendor/catalog/:itemId/media/upload",\n  requirePortalAuth,\n  requireActiveVendor');
      expect(routeSource).toContain('"/vendor/catalog/:id/media-assets/upload",\n  requirePortalAuth,\n  requireActiveVendor');
    });
  });
});