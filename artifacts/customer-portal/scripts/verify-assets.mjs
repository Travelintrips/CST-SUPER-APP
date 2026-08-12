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
  "/api/storage/public-objects/portal-assets/static/customer-portal/images/warehouse.webp",
  "/api/storage/public-objects/portal-assets/static/customer-portal/images/customs.png",
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

function contentType(response) {
  return (response.headers.get("content-type") ?? "").split(";")[0].toLowerCase();
}

async function requestWithRedirects(path) {
  let url = new URL(path, base).toString();
  let firstStatus = null;
  let firstType = "";
  let firstBytes = 0;
  const chain = [];

  for (let hop = 0; hop < 6; hop++) {
    const response = await fetch(url, { redirect: "manual" });
    const type = contentType(response);
    const body = Buffer.from(await response.arrayBuffer());
    if (firstStatus === null) {
      firstStatus = response.status;
      firstType = type;
      firstBytes = body.length;
    }
    chain.push(`${response.status} ${type || "(missing MIME)"}`);
    if (response.status < 300 || response.status >= 400) {
      return { response, type, body, firstStatus, firstType, firstBytes, chain };
    }
    const location = response.headers.get("location");
    if (!location) throw new Error(`redirect without location: ${path}`);
    url = new URL(location, url).toString();
  }

  throw new Error(`too many redirects: ${path}`);
}

function isHtmlOrJson(type, body) {
  return type === "text/html" || type === "application/json" ||
    /^\s*(?:<!doctype html|<html\b|\{)/i.test(body.subarray(0, 256).toString("utf8"));
}

async function verify(path, expectRedirect = false) {
  const result = await requestWithRedirects(path);
  const { response, type, body, firstStatus, firstType, firstBytes, chain } = result;
  const finalIsImage = response.ok && type.startsWith("image/") && body.length > 0 &&
    !isHtmlOrJson(type, body);
  const redirectOk = !expectRedirect || firstStatus >= 300 && firstStatus < 400;
  const ok = redirectOk && finalIsImage;
  console.log(`${ok ? "PASS" : "FAIL"} ${firstStatus} ${firstType || "(missing MIME)"} ${firstBytes}B → ${chain.join(" → ")} ${path}`);
  if (!ok) throw new Error(`asset verification failed: ${path}`);
}

for (const path of assets) await verify(path);
for (const path of legacy) await verify(path, true);
for (const path of missing) {
  const { response, type, body, firstStatus, firstType, firstBytes, chain } =
    await requestWithRedirects(path);
  const ok = response.status === 404 && type !== "text/html" && body.length > 0 &&
    !/^\s*(?:<!doctype html|<html\b)/i.test(body.subarray(0, 256).toString("utf8"));
  console.log(`${ok ? "PASS" : "FAIL"} ${firstStatus} ${firstType || "(missing MIME)"} ${firstBytes}B → ${chain.join(" → ")} ${path}`);
  if (!ok) throw new Error(`missing asset verification failed: ${path}`);
}

const cmsAssets = ["hero_bg", "about_img1", "about_img2", "logo"];
const cmsByLocale = {};
for (const locale of ["id-ID", "en-US"]) {
  const response = await fetch(`${base}/api/portal/content?locale=${encodeURIComponent(locale)}`);
  if (!response.ok) throw new Error(`CMS content request failed: ${locale} (${response.status})`);
  const content = await response.json();
  cmsByLocale[locale] = content;
  for (const key of cmsAssets) {
    if (typeof content[key] !== "string" || !content[key]) continue;
    await verify(content[key], content[key].includes("/portal/images/") || content[key].includes("/images/"));
  }
}

if (cmsByLocale["id-ID"].hero_bg !== cmsByLocale["en-US"].hero_bg) {
  throw new Error("CMS global hero_bg differs between id-ID and en-US");
}

console.log(
  `Verified ${assets.length} canonical, ${legacy.length} legacy, ${missing.length} missing, ` +
  `${cmsAssets.length} CMS keys across id-ID/en-US.`,
);