import assert from "node:assert/strict";
import test from "node:test";
import {
  assertAuthorizedDevRuntimeProof,
  DEV_PROJECT_REF,
  PROD_PROJECT_REF,
} from "../runtime-db-guard.mjs";

const devUrl = `postgresql://postgres.${DEV_PROJECT_REF}:secret@db.${DEV_PROJECT_REF}.supabase.co:5432/postgres`;
const prodUrl = `postgresql://postgres.${PROD_PROJECT_REF}:secret@db.${PROD_PROJECT_REF}.supabase.co:5432/postgres`;
const base = {
  APP_ENV: "development",
  NODE_ENV: "development",
  SAFE_DEV_TEST_MODE: "true",
  SUPABASE_DATABASE_URL_DEV: devUrl,
  SUPABASE_DATABASE_URL_PROD: prodUrl,
};

test("allows canonical DEV with SAFE_DEV_TEST_MODE", () => {
  assert.equal(assertAuthorizedDevRuntimeProof({
    env: base,
    harnessIdentity: "CF-SC-14A",
  }).allowed, true);
});

test("rejects DEV without SAFE_DEV_TEST_MODE", () => {
  assert.throws(() => assertAuthorizedDevRuntimeProof({
    env: { ...base, SAFE_DEV_TEST_MODE: undefined },
    harnessIdentity: "CF-SC-14A",
  }), /SAFE_DEV_TEST_MODE/);
});

test("rejects a PROD target", () => {
  assert.throws(() => assertAuthorizedDevRuntimeProof({
    env: { ...base, SUPABASE_DATABASE_URL_DEV: prodUrl },
    harnessIdentity: "CF-SC-14A",
  }), /canonical development|Production/);
});

test("rejects an unknown or unverified database", () => {
  assert.throws(() => assertAuthorizedDevRuntimeProof({
    env: { ...base, SUPABASE_DATABASE_URL_DEV: devUrl.replace(DEV_PROJECT_REF, "unknownref") },
    harnessIdentity: "CF-SC-14A",
  }), /canonical development/);
});

test("rejects missing explicit environment", () => {
  assert.throws(() => assertAuthorizedDevRuntimeProof({
    env: { ...base, APP_ENV: undefined },
    harnessIdentity: "CF-SC-14A",
  }), /explicit.*development/);
});