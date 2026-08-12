#!/usr/bin/env node
/**
 * Focused public-asset verifier.
 *
 * Usage:
 *   ASSET_BASE_URL=http://127.0.0.1:23434 node scripts/verify-assets.mjs
 *
 * It deliberately checks the response body as well as status/MIME. A SPA
 * fallback returning 200 text/html must fail this verifier.
 */
const base = (process.env.ASSET_BASE_URL ?? "http://127.0.0.1:23434").replace(/\/+$/, "");
const assets = [
  "/api/storage/public-objects/portal-assets/static/customer-portal/images/logo.png",
  "/api/storage/public-objects/portal-assets/static/customer-portal/images/logo-baru.png",
  "/api/storage/public-objects/portal-assets/static/customer-portal/images/hero-bg.webp",
  "/api/storage/public-objects/portal-assets/static/customer-portal/images/port-operations.webp",
];
const legacy = [
  "/api/storage/public-objects/portal/images/logo.png",
  "/images/logo.png",
  "/portal/images/logo.png",
];
const missing = [
  "/api/storage/public-objects/portal-assets/static/customer-portal/images/does-not-exist.png",
  "/images/does-not-exist.png",
  "/portal/images/does-not-exist.png",
];

async function verify(path, expectRedirect = false) {
  const response = await fetch(`${base}${path}`, { redirect: "manual" });
  const type = (response.headers.get("content-type") ?? "").split(";")[0].toLowerCase();
  const body = Buffer.from(await response.arrayBuffer());
  const isRedirect = response.status >= 300 && response.status < 400;
  const followsLegacy = isRedirect && (response.headers.get("location") ?? "").includes("/portal-assets/static/customer-portal/images/");
  const badBody = type === "text/html" || type === "application/json" ||
    /^\s*(?:<!doctype html|<html\b|\{)/i.test(body.subarray(0, 256).toString("utf8"));
  let destinationOk = false;
  if (expectRedirect && followsLegacy) {
    const destination = new URL(response.headers.get("location"), base).toString();
    const finalResponse = await fetch(destination);
    const finalType = (finalResponse.headers.get("content-type") ?? "").split(";")[0].toLowerCase();
    const finalBody = Buffer.from(await finalResponse.arrayBuffer());
    destinationOk = finalResponse.ok && finalType.startsWith("image/") && finalBody.length > 0 &&
      finalType !== "text/html" && finalType !== "application/json";
  }
  const ok = expectRedirect
    ? destinationOk
    : response.ok && type.startsWith("image/") && body.length > 0 && !badBody;
  console.log(`${ok ? "PASS" : "FAIL"} ${response.status} ${type || "(missing MIME)"} ${body.length}B ${path}`);
  if (!ok) throw new Error(`asset verification failed: ${path}`);
}

for (const path of assets) await verify(path);
for (const path of legacy) await verify(path, true);
for (const path of missing) {
  const response = await fetch(`${base}${path}`, { redirect: "manual" });
  const type = (response.headers.get("content-type") ?? "").split(";")[0].toLowerCase();
  const body = Buffer.from(await response.arrayBuffer());
  const ok = response.status === 404 && type !== "text/html" && body.length > 0;
  console.log(`${ok ? "PASS" : "FAIL"} ${response.status} ${type || "(missing MIME)"} ${body.length}B ${path}`);
  if (!ok) throw new Error(`missing asset verification failed: ${path}`);
}
console.log(`Verified ${assets.length} canonical, ${legacy.length} legacy, and ${missing.length} missing asset URLs.`);