import { describe, expect, it } from "vitest";
import { resolveImageUrl } from "@/lib/utils";

const CANONICAL_ROOT =
  "/api/storage/public-objects/portal-assets/static/customer-portal/images/";

describe("resolveImageUrl", () => {
  it.each([
    ["/images/foo.webp", "foo.webp"],
    ["/images/foo.png", "foo.webp"],
    ["/portal/images/nested/foo.jpg", "nested/foo.webp"],
    ["/portal/images/foo.webp", "foo.webp"],
    ["/api/storage/public-objects/portal/images/foo.webp", "foo.webp"],
    ["/api/storage/public-objects/images/foo.webp", "foo.webp"],
  ])("normalizes legacy path %s", (input, relative) => {
    expect(resolveImageUrl(input)).toBe(`${CANONICAL_ROOT}${relative}`);
  });

  it("keeps published PNG branding references on PNG", () => {
    expect(resolveImageUrl("/portal/images/logo.png")).toBe(`${CANONICAL_ROOT}logo.png`);
    expect(resolveImageUrl("/portal/images/logo-baru.png")).toBe(`${CANONICAL_ROOT}logo-baru.png`);
  });

  it("keeps canonical storage URLs unchanged", () => {
    const canonical = `${CANONICAL_ROOT}foo.webp`;
    expect(resolveImageUrl(canonical)).toBe(canonical);
  });

  it("rejects a legacy bare object UUID before the browser requests it", () => {
    expect(
      resolveImageUrl(
        "/api/storage/public-objects/portal-assets/db674887-3d77-4679-8725-bb8866fe53de",
      ),
    ).toBeNull();
  });

  it("allows a verified CMS legacy UUID when explicitly requested", () => {
    const legacy =
      "/api/storage/public-objects/portal-assets/de648c66-00ae-46c4-8bc2-fbd7a7368b3c";
    expect(resolveImageUrl(legacy, { allowLegacyObjectId: true })).toBe(legacy);
  });

  it("keeps a newly uploaded UUID asset with an extension", () => {
    const uploaded =
      "/api/storage/public-objects/portal-assets/7e07e12c-173a-45fe-a701-309013b788ef.webp";
    expect(resolveImageUrl(uploaded)).toBe(uploaded);
  });

  it("keeps valid external URLs unchanged", () => {
    const external = "https://external-valid.example/image.webp";
    expect(resolveImageUrl(external)).toBe(external);
  });

  it.each(["/images/../secret.webp", "/images/foo\\bar.webp", "/images/", "../foo.webp"])(
    "rejects unsafe or empty legacy path %s",
    (input) => {
      expect(resolveImageUrl(input)).toBeNull();
    },
  );
});