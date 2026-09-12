#!/usr/bin/env node
/**
 * Compatibility entrypoint for the old verifier command.
 *
 * The authoritative implementation is now the scoped manifest verifier:
 *   APP_ENV=production CUSTOMER_PORTAL_BASE_URL=https://... \
 *     node ../api-server/scripts/customer-portal-assets.mjs verify --env production
 */
import { readManifest, verifyCmsReferences, verifyStorageEnvironment, MANIFEST_PATH } from "../../api-server/scripts/customer-portal-assets.mjs";

const environment = process.env.APP_ENV;
if (environment !== "development" && environment !== "production") {
  throw new Error("APP_ENV must be explicitly set to development or production.");
}
const manifest = await readManifest(MANIFEST_PATH);
await verifyStorageEnvironment(environment, manifest);
const baseUrl = process.env.CUSTOMER_PORTAL_BASE_URL ?? process.env.ASSET_BASE_URL;
if (!baseUrl) throw new Error("CUSTOMER_PORTAL_BASE_URL or ASSET_BASE_URL is required for CMS reference verification.");
await verifyCmsReferences(baseUrl);