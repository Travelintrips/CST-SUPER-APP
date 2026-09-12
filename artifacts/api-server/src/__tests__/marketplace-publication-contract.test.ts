import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const apiRoot = resolve(import.meta.dirname, "../..");

function read(relativePath: string): string {
  return readFileSync(resolve(apiRoot, relativePath), "utf8");
}

describe("public Marketplace publication contract", () => {
  it("allows published active items and rejects drafts", () => {
    const visibility = read("src/lib/catalogVisibility.ts");

    expect(visibility).toContain("item.isPublished === true");
    expect(visibility).toContain("item.isActive !== false");
    expect(visibility).toContain("!item.deletedAt");
  });

  it("keeps list and detail responses uncached", () => {
    const portalRoutes = read("src/routes/portal.ts");
    const listRoute = portalRoutes.slice(
      portalRoutes.indexOf('router.get("/marketplace",'),
      portalRoutes.indexOf('router.get("/marketplace/featured"', portalRoutes.indexOf('router.get("/marketplace",')),
    );
    const detailRoute = portalRoutes.slice(
      portalRoutes.indexOf('router.get("/marketplace/:id",'),
      portalRoutes.indexOf('router.post("/marketplace/:id/quote"', portalRoutes.indexOf('router.get("/marketplace/:id",')),
    );

    expect(listRoute).toContain('res.setHeader("Cache-Control", "no-store")');
    expect(detailRoute).toContain('res.setHeader("Cache-Control", "no-store")');
  });
});