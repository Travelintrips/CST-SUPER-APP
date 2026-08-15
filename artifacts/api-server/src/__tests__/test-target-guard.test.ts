import { describe, expect, it } from "vitest";
import { getIsolatedTestDatabaseUrl } from "../test-setup.js";

const VALID_STAGING_URL =
  "postgresql://postgres.stagingref:password@aws-1-ap-southeast-2.pooler.supabase.com:6543/postgres";

describe("isolated regression test target guard", () => {
  it("requires an explicit test or staging URL", () => {
    expect(() => getIsolatedTestDatabaseUrl({})).toThrow(/TEST_DATABASE_URL or STAGING_DATABASE_URL/);
  });

  it("rejects the built-in Helium/Replit database", () => {
    expect(() =>
      getIsolatedTestDatabaseUrl({
        TEST_DATABASE_URL: "postgres://user:password@helium:5432/replit",
      }),
    ).toThrow(/built-in\/local Replit database/);
  });

  it("rejects a Replit database host as well as Helium", () => {
    expect(() =>
      getIsolatedTestDatabaseUrl({
        TEST_DATABASE_URL: "postgres://user:password@replit-db:5432/replit",
      }),
    ).toThrow(/built-in\/local Replit database/);
  });

  it("rejects a production Supabase project", () => {
    expect(() =>
      getIsolatedTestDatabaseUrl({
        STAGING_DATABASE_URL:
          "postgresql://postgres.nzdweipzckfszczzqtuw:password@db.nzdweipzckfszczzqtuw.supabase.co:5432/postgres",
      }),
    ).toThrow(/reserved DEV\/PROD/);
  });

  it("rejects a development Supabase project", () => {
    expect(() =>
      getIsolatedTestDatabaseUrl({
        TEST_DATABASE_URL:
          "postgresql://postgres.xssrfshdrtdfupgqwfdw:password@db.xssrfshdrtdfupgqwfdw.supabase.co:5432/postgres",
      }),
    ).toThrow(/reserved DEV\/PROD/);
  });

  it("accepts an explicit isolated Supabase staging target", () => {
    expect(
      getIsolatedTestDatabaseUrl({
        TEST_DATABASE_URL: VALID_STAGING_URL,
      }),
    ).toBe(VALID_STAGING_URL);
  });

  it("rejects a staging variable that aliases a shared database variable", () => {
    expect(() =>
      getIsolatedTestDatabaseUrl({
        TEST_DATABASE_URL: VALID_STAGING_URL,
        DATABASE_URL: VALID_STAGING_URL,
      }),
    ).toThrow(/aliases a shared DEV\/PROD database variable/);
  });
});