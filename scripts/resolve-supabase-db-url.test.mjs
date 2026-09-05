import { describe, expect, it } from "vitest";
import {
  resolveProductionSupabaseDatabaseUrl,
  resolveSupabaseDatabaseUrl,
} from "./resolve-supabase-db-url.mjs";

const PROD_URL = "postgresql://app.prod@db.example.supabase.co:5432/app";
const SAME_TARGET_MIGRATION_URL = "postgresql://migration.prod@db.example.supabase.co:5432/app";
const DIFFERENT_TARGET_MIGRATION_URL = "postgresql://migration.prod@pooler.example.supabase.co:6543/app";

describe("production Supabase database target resolution", () => {
  it("always returns the canonical application URL when migration also exists", () => {
    expect(resolveProductionSupabaseDatabaseUrl({
      SUPABASE_DATABASE_URL: PROD_URL,
      SUPABASE_MIGRATION_URL: DIFFERENT_TARGET_MIGRATION_URL,
    })).toEqual({
      name: "SUPABASE_DATABASE_URL",
      url: PROD_URL,
      isProduction: true,
    });
  });

  it("does not fall back to migration URL when canonical production URL is absent", () => {
    expect(() => resolveProductionSupabaseDatabaseUrl({
      SUPABASE_MIGRATION_URL: SAME_TARGET_MIGRATION_URL,
    })).toThrow(/requires SUPABASE_DATABASE_URL/);
  });

  it("fails closed when the canonical production URL is malformed", () => {
    expect(() => resolveProductionSupabaseDatabaseUrl({
      SUPABASE_DATABASE_URL: "not-a-postgres-url",
      SUPABASE_MIGRATION_URL: SAME_TARGET_MIGRATION_URL,
    })).toThrow(/SUPABASE_DATABASE_URL must be a PostgreSQL URL/);
  });

  it("uses the DEV URL for development without consulting production URLs", () => {
    const result = resolveSupabaseDatabaseUrl({
      APP_ENV: "development",
      SUPABASE_DATABASE_URL_DEV: "postgresql://dev@db.dev.supabase.co:5432/app",
      SUPABASE_DATABASE_URL: PROD_URL,
      SUPABASE_MIGRATION_URL: DIFFERENT_TARGET_MIGRATION_URL,
    });
    expect(result.name).toBe("SUPABASE_DATABASE_URL_DEV");
    expect(result.isProduction).toBe(false);
  });

});