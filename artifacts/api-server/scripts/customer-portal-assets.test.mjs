import assert from "node:assert/strict";
import { test } from "node:test";
import {
  discoverManifest,
  normalizeStoragePath,
  selectManifestAssets,
  resolveStorageCredentials,
  verifyHttpAsset,
  verifyCmsReferences,
} from "./customer-portal-assets.mjs";

function response({ status = 200, type = "image/webp", body = Buffer.from("image") } = {}) {
  return new Response(body, { status, headers: { "content-type": type } });
}

test("normalizes raster source names to the derived WebP object", () => {
  assert.equal(
    normalizeStoragePath("/api/storage/public-objects/portal/images/logo.png"),
    "portal-assets/static/customer-portal/images/logo.webp",
  );
  assert.equal(
    normalizeStoragePath("images/sea-freight.jpg"),
    "portal-assets/static/customer-portal/images/sea-freight.webp",
  );
  assert.equal(
    normalizeStoragePath("portal-assets/static/customer-portal/images/routes.svg"),
    "portal-assets/static/customer-portal/images/routes.svg",
  );
  assert.equal(normalizeStoragePath("images/not-an-image.txt"), null);
});

test("environment isolation never uses production credentials for development or vice versa", () => {
  const env = {
    SUPABASE_URL_DEV: "https://dev.example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY_DEV: "dev-key",
    SUPABASE_URL: "https://prod.example.supabase.co",
    SUPABASE_SERVICE_ROLE_KEY: "prod-key",
  };
  assert.deepEqual(resolveStorageCredentials("development", env), {
    url: "https://dev.example.supabase.co",
    key: "dev-key",
  });
  assert.deepEqual(resolveStorageCredentials("production", env), {
    url: "https://prod.example.supabase.co",
    key: "prod-key",
  });
  assert.throws(
    () => resolveStorageCredentials("production", { ...env, SUPABASE_SERVICE_ROLE_KEY: undefined }),
    /Missing environment-specific/,
  );
});

test("manifest is derived from source usage and contains derived assets", async () => {
  const manifest = await discoverManifest();
  const paths = new Set(manifest.assets.map((asset) => asset.storagePath));
  assert.ok(paths.has("portal-assets/static/customer-portal/images/air-freight.webp"));
  assert.ok(paths.has("portal-assets/static/customer-portal/images/customs.webp"));
  assert.ok(paths.has("portal-assets/static/customer-portal/images/customs-document.webp"));
  for (const vehicle of [
    "mobil-ai",
    "mobil-xl-ai",
    "van-ai",
    "pickup-kecil-ai",
    "box-kecil-ai",
    "engkel-ai",
    "double-engkel-ai",
    "cdd-long-ai",
    "fuso-ai",
    "tronton-ai",
    "truk-trailer-ai",
    "truk-reefer-ai",
  ]) {
    assert.ok(paths.has(`portal-assets/static/customer-portal/images/vehicles/${vehicle}.webp`), vehicle);
  }
  assert.ok(paths.has("portal-assets/static/customer-portal/images/categories/coffee.webp"));
  assert.ok(![...paths].some((asset) => asset.endsWith(".png") || asset.endsWith(".jpg")));
});

test("scoped promotion only accepts manifest assets", () => {
  const manifest = {
    assets: [
      { storagePath: "portal-assets/static/customer-portal/images/customs.webp" },
      { storagePath: "portal-assets/static/customer-portal/images/customs-document.webp" },
    ],
  };
  assert.deepEqual(
    selectManifestAssets(manifest, [
      "portal-assets/static/customer-portal/images/customs-document.webp",
      "portal-assets/static/customer-portal/images/customs.webp",
    ]).map((asset) => asset.storagePath),
    [
      "portal-assets/static/customer-portal/images/customs-document.webp",
      "portal-assets/static/customer-portal/images/customs.webp",
    ],
  );
  assert.throws(
    () => selectManifestAssets(manifest, ["portal-assets/static/customer-portal/images/not-approved.webp"]),
    /not in the Customer Portal manifest/,
  );
});

test("missing asset, wrong MIME, and empty body fail the HTTP verifier", async () => {
  await assert.rejects(
    async () => {
      const result = await verifyHttpAsset("https://example.invalid/missing", "image/webp", async () =>
        response({ status: 404, type: "application/json", body: Buffer.from('{"error":"missing"}') }),
      );
      assert.equal(result.ok, false);
      if (!result.ok) throw new Error("asset failed");
    },
    /asset failed/,
  );
  const wrongMime = await verifyHttpAsset("https://example.invalid/wrong", "image/webp", async () =>
    response({ type: "text/html", body: Buffer.from("<html>SPA</html>") }),
  );
  assert.equal(wrongMime.ok, false);
  const empty = await verifyHttpAsset("https://example.invalid/empty", "image/webp", async () =>
    response({ body: Buffer.alloc(0) }),
  );
  assert.equal(empty.ok, false);
});

test("CMS stale media references are reported as failures", async () => {
  const cmsFetch = async (url) => {
    if (url.includes("/api/portal/content?")) {
      return new Response(JSON.stringify({ hero_bg: "/api/storage/public-objects/portal/images/missing.png" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return response({ status: 404, type: "application/json", body: Buffer.from("{}") });
  };
  await assert.rejects(
    () => verifyCmsReferences("https://portal.example", cmsFetch),
    /STALE STORAGE REFERENCE/,
  );
});