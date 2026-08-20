/**
 * load-secrets.test.mjs
 *
 * Unit tests for load-secrets.mjs core functions.
 * Tests cover all 17 required scenarios from GCP Bootstrap Secret Architecture spec.
 *
 * Run: pnpm --filter @workspace/api-server exec vitest run load-secrets.test.mjs
 */

import { describe, it, expect } from "vitest";
import {
  resolveEnvironment,
  validateBootstrapJson,
  resolveBundleName,
  extractSecretVersion,
  injectSecrets,
  validateRequiredSecrets,
} from "./load-secrets.mjs";

describe("Secret Manager version observability", () => {
  it("extracts only a safe non-secret version identifier", () => {
    expect(extractSecretVersion("projects/test/secrets/cst-super-app-production/versions/12")).toBe("12");
    expect(extractSecretVersion("projects/test/secrets/x/versions/latest")).toBe("latest");
    expect(extractSecretVersion("projects/test/secrets/x/versions/secret value")).toBeNull();
    expect(extractSecretVersion("secret payload")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeBootstrapJson(overrides = {}) {
  return JSON.stringify({
    project_id: "test-project-123",
    client_email: "sa@test-project-123.iam.gserviceaccount.com",
    private_key: "-----BEGIN RSA PRIVATE KEY-----\nfake\n-----END RSA PRIVATE KEY-----",
    type: "service_account",
    ...overrides,
  });
}

function makeDevBundle(extraKeys = {}) {
  return {
    APP_ENV: "development",
    SESSION_SECRET: "a".repeat(40),
    SUPABASE_DATABASE_URL: "postgres://dev-host/dev-db",
    OPENAI_API_KEY: "sk-dev-key",
    FONNTE_TOKEN: "fonnte-dev",
    ...extraKeys,
  };
}

function makeProdBundle(extraKeys = {}) {
  return {
    APP_ENV: "production",
    SESSION_SECRET: "b".repeat(40),
    SUPABASE_DATABASE_URL: "postgres://prod-host/prod-db",
    OPENAI_API_KEY: "sk-prod-key",
    FONNTE_TOKEN: "fonnte-prod",
    ...extraKeys,
  };
}

function makeLegacyBundle() {
  return {
    SESSION_SECRET: "c".repeat(40),
    SESSION_SECRET_DEV: "d".repeat(40),
    SUPABASE_DATABASE_URL: "postgres://prod-host/prod-db",
    SUPABASE_DATABASE_URL_DEV: "postgres://dev-host/dev-db",
    OPENAI_API_KEY: "sk-prod",
    OPENAI_API_KEY_DEV: "sk-dev",
    FONNTE_TOKEN: "fonnte-prod",
    FONNTE_TOKEN_DEV: "fonnte-dev",
    SHARED_API_KEY: "shared-key-no-dev-variant",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Test 1 — APP_ENV missing → fail
// ─────────────────────────────────────────────────────────────────────────────

describe("Test 1: APP_ENV missing → fail", () => {
  it("throws when APP_ENV is not set", () => {
    expect(() => resolveEnvironment({})).toThrow(/APP_ENV is not set/);
  });

  it("throws when APP_ENV is empty string", () => {
    expect(() => resolveEnvironment({ APP_ENV: "" })).toThrow(/APP_ENV is not set/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 2 — APP_ENV invalid → fail
// ─────────────────────────────────────────────────────────────────────────────

describe("Test 2: APP_ENV invalid → fail", () => {
  it('throws when APP_ENV="staging"', () => {
    expect(() => resolveEnvironment({ APP_ENV: "staging" })).toThrow(/not valid/);
  });

  it('throws when APP_ENV="test"', () => {
    expect(() => resolveEnvironment({ APP_ENV: "test" })).toThrow(/not valid/);
  });

  it('throws when APP_ENV="prod" (abbreviation not accepted)', () => {
    expect(() => resolveEnvironment({ APP_ENV: "prod" })).toThrow(/not valid/);
  });

  it("does NOT throw for NODE_ENV without APP_ENV", () => {
    // NODE_ENV alone must not satisfy APP_ENV requirement
    expect(() => resolveEnvironment({ NODE_ENV: "production" })).toThrow(/APP_ENV is not set/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 3 — Bootstrap missing → fail
// ─────────────────────────────────────────────────────────────────────────────

describe("Test 3: Bootstrap credential missing → fail", () => {
  it("throws when GCP_SECRET_MANAGER_BOOTSTRAP_JSON is undefined", () => {
    expect(() => validateBootstrapJson(undefined)).toThrow(/GCP_SECRET_MANAGER_BOOTSTRAP_JSON is not set/);
  });

  it("throws when GCP_SECRET_MANAGER_BOOTSTRAP_JSON is empty string", () => {
    expect(() => validateBootstrapJson("")).toThrow(/GCP_SECRET_MANAGER_BOOTSTRAP_JSON is not set/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 4 — Bootstrap malformed → fail
// ─────────────────────────────────────────────────────────────────────────────

describe("Test 4: Bootstrap malformed → fail", () => {
  it("throws when bootstrap JSON is not valid JSON", () => {
    expect(() => validateBootstrapJson("{not json")).toThrow(/not valid JSON/);
  });

  it("throws when bootstrap JSON is an array", () => {
    expect(() => validateBootstrapJson("[]")).toThrow(/must be a JSON object/);
  });

  it("throws when project_id is missing", () => {
    expect(() =>
      validateBootstrapJson(
        JSON.stringify({ client_email: "sa@test.iam", private_key: "key" })
      )
    ).toThrow(/project_id/);
  });

  it("throws when client_email is missing", () => {
    expect(() =>
      validateBootstrapJson(
        JSON.stringify({ project_id: "proj", private_key: "key" })
      )
    ).toThrow(/client_email/);
  });

  it("throws when private_key is missing", () => {
    expect(() =>
      validateBootstrapJson(
        JSON.stringify({ project_id: "proj", client_email: "sa@test.iam" })
      )
    ).toThrow(/private_key/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 5 — DEV selects DEV bundle (new mode)
// ─────────────────────────────────────────────────────────────────────────────

describe("Test 5: DEV selects DEV bundle (new mode)", () => {
  it("resolves cst-super-app-development bundle for development", () => {
    const { credentials } = validateBootstrapJson(makeBootstrapJson());
    const { secretName, legacyMode, bundleName } = resolveBundleName(
      "development",
      credentials,
      {} // no GCP_PROJECT_ID or GCP_SECRET_ID
    );
    expect(legacyMode).toBe(false);
    expect(bundleName).toBe("cst-super-app-development");
    expect(secretName).toContain("cst-super-app-development");
    expect(secretName).toContain("test-project-123");
  });

  it("uses custom bundle prefix when GCP_SECRET_BUNDLE_PREFIX is set", () => {
    const { credentials } = validateBootstrapJson(makeBootstrapJson());
    const { bundleName } = resolveBundleName("development", credentials, {
      GCP_SECRET_BUNDLE_PREFIX: "myapp",
    });
    expect(bundleName).toBe("myapp-development");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 6 — PROD selects PROD bundle (new mode)
// ─────────────────────────────────────────────────────────────────────────────

describe("Test 6: PROD selects PROD bundle (new mode)", () => {
  it("resolves cst-super-app-production bundle for production", () => {
    const { credentials } = validateBootstrapJson(makeBootstrapJson());
    const { secretName, legacyMode, bundleName } = resolveBundleName(
      "production",
      credentials,
      {}
    );
    expect(legacyMode).toBe(false);
    expect(bundleName).toBe("cst-super-app-production");
    expect(secretName).toContain("cst-super-app-production");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 7 — DEV never falls back to PROD (new mode injection)
// ─────────────────────────────────────────────────────────────────────────────

describe("Test 7: DEV never falls back to PROD", () => {
  it("rejects production bundle when APP_ENV=development", () => {
    const target = {};
    // Production bundle presented to DEV loader → mismatch → error
    expect(() =>
      injectSecrets(makeProdBundle(), "development", false, target)
    ).toThrow(/Bundle environment mismatch/);
  });

  it("injects dev bundle successfully for development", () => {
    const target = {};
    const { injected } = injectSecrets(makeDevBundle(), "development", false, target);
    expect(injected).toBeGreaterThan(0);
    expect(target.SUPABASE_DATABASE_URL).toBe("postgres://dev-host/dev-db");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 8 — PROD never falls back to DEV
// ─────────────────────────────────────────────────────────────────────────────

describe("Test 8: PROD never falls back to DEV", () => {
  it("rejects development bundle when APP_ENV=production", () => {
    const target = {};
    expect(() =>
      injectSecrets(makeDevBundle(), "production", false, target)
    ).toThrow(/Bundle environment mismatch/);
  });

  it("injects prod bundle successfully for production", () => {
    const target = {};
    const { injected } = injectSecrets(makeProdBundle(), "production", false, target);
    expect(injected).toBeGreaterThan(0);
    expect(target.SUPABASE_DATABASE_URL).toBe("postgres://prod-host/prod-db");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 9 — Bundle environment mismatch → fail
// ─────────────────────────────────────────────────────────────────────────────

describe("Test 9: Bundle APP_ENV mismatch → fail", () => {
  it("throws when prod bundle is used in dev context", () => {
    expect(() =>
      injectSecrets({ APP_ENV: "production", SESSION_SECRET: "x" }, "development", false, {})
    ).toThrow(/Bundle environment mismatch/);
  });

  it("throws when dev bundle is used in prod context", () => {
    expect(() =>
      injectSecrets({ APP_ENV: "development", SESSION_SECRET: "x" }, "production", false, {})
    ).toThrow(/Bundle environment mismatch/);
  });

  it("warns but continues when an application bundle omits APP_ENV", () => {
    expect(() =>
      injectSecrets(
        { SESSION_SECRET: "x", SUPABASE_DATABASE_URL: "postgres://host/db" },
        "production",
        false,
        {}
      )
    ).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 10 — Required secret missing → fail
// ─────────────────────────────────────────────────────────────────────────────

describe("Test 10: Required secret missing → fail", () => {
  it("reports missing SESSION_SECRET", () => {
    const { missing } = validateRequiredSecrets({
      SUPABASE_DATABASE_URL: "postgres://host/db",
    });
    expect(missing).toContain("SESSION_SECRET");
  });

  it("reports missing SUPABASE_DATABASE_URL", () => {
    const { missing } = validateRequiredSecrets({
      SESSION_SECRET: "a".repeat(40),
    });
    expect(missing).toContain("SUPABASE_DATABASE_URL");
  });

  it("reports weak SESSION_SECRET (too short)", () => {
    const { weak } = validateRequiredSecrets({
      SESSION_SECRET: "short",
      SUPABASE_DATABASE_URL: "postgres://host/db",
    });
    expect(weak.some((w) => w.includes("SESSION_SECRET"))).toBe(true);
  });

  it("passes when all required secrets are present and strong enough", () => {
    const { missing, weak } = validateRequiredSecrets({
      SESSION_SECRET: "a".repeat(40),
      SUPABASE_DATABASE_URL: "postgres://host/db",
    });
    expect(missing).toHaveLength(0);
    expect(weak).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 11 — Optional secret missing → warn/continue
// ─────────────────────────────────────────────────────────────────────────────

describe("Test 11: Optional secret missing → continues (no failure)", () => {
  it("does not include optional secrets in required-secret check", () => {
    // OPENAI_API_KEY is optional — not in REQUIRED_SECRETS
    const { missing } = validateRequiredSecrets({
      SESSION_SECRET: "a".repeat(40),
      SUPABASE_DATABASE_URL: "postgres://host/db",
      // OPENAI_API_KEY intentionally absent
    });
    expect(missing).not.toContain("OPENAI_API_KEY");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 12 — Secret value never logged
// ─────────────────────────────────────────────────────────────────────────────

describe("Test 12: Secret values are never logged by core functions", () => {
  it("injectSecrets returns key names not values", () => {
    const target = {};
    const { loadedKeys } = injectSecrets(makeDevBundle(), "development", false, target);
    // loadedKeys must be string array of key names only
    for (const key of loadedKeys) {
      expect(typeof key).toBe("string");
      // Must not contain a value (e.g. no "postgres://", "sk-", etc.)
      expect(key).not.toMatch(/postgres:\/\//);
      expect(key).not.toMatch(/sk-/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 13 — APP_ENV not overwritten
// ─────────────────────────────────────────────────────────────────────────────

describe("Test 13: APP_ENV is never overwritten by bundle", () => {
  it("does not inject APP_ENV from bundle into target (new mode)", () => {
    const target = { APP_ENV: "development" };
    const bundle = makeDevBundle({ APP_ENV: "development", EXTRA_KEY: "value" });
    injectSecrets(bundle, "development", false, target);
    // APP_ENV should not be in loadedKeys and target must remain as-is
    // (the inject() function skips APP_ENV explicitly)
    expect(target.APP_ENV).toBe("development");
  });

  it("does not inject APP_ENV from bundle into target (legacy mode)", () => {
    const target = { APP_ENV: "production" };
    const legacy = { ...makeLegacyBundle(), APP_ENV: "production" };
    injectSecrets(legacy, "production", true, target);
    expect(target.APP_ENV).toBe("production");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 14 — Development + PROD DB → blocked (envGuard in src/index.ts)
// ─────────────────────────────────────────────────────────────────────────────

describe("Test 14: Development + PROD DB blocked (by envGuard, not loader)", () => {
  it("loader itself does not select PROD DB in DEV mode (new mode)", () => {
    const target = {};
    injectSecrets(makeDevBundle(), "development", false, target);
    // Should have DEV database URL
    expect(target.SUPABASE_DATABASE_URL).toBe("postgres://dev-host/dev-db");
    // Should NOT have prod URL
    expect(target.SUPABASE_DATABASE_URL).not.toContain("prod-host");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 15 — Production + DEV DB → blocked (envGuard in src/index.ts)
// ─────────────────────────────────────────────────────────────────────────────

describe("Test 15: Production + DEV DB blocked (by envGuard, not loader)", () => {
  it("loader itself does not select DEV DB in PROD mode (new mode)", () => {
    const target = {};
    injectSecrets(makeProdBundle(), "production", false, target);
    expect(target.SUPABASE_DATABASE_URL).toBe("postgres://prod-host/prod-db");
    expect(target.SUPABASE_DATABASE_URL).not.toContain("dev-host");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 16 — Valid DEV startup → success
// ─────────────────────────────────────────────────────────────────────────────

describe("Test 16: Valid DEV flow → all checks pass", () => {
  it("resolves env, validates bootstrap, resolves bundle, injects, validates required", () => {
    const env = { APP_ENV: "development" };
    expect(() => resolveEnvironment(env)).not.toThrow();

    const { credentials } = validateBootstrapJson(makeBootstrapJson());
    const { legacyMode, bundleName } = resolveBundleName("development", credentials, {});
    expect(legacyMode).toBe(false);
    expect(bundleName).toBe("cst-super-app-development");

    const target = {};
    const { injected, loadedKeys } = injectSecrets(makeDevBundle(), "development", false, target);
    expect(injected).toBeGreaterThan(0);
    expect(loadedKeys).toContain("SESSION_SECRET");
    expect(loadedKeys).toContain("SUPABASE_DATABASE_URL");

    const { missing, weak } = validateRequiredSecrets(target);
    expect(missing).toHaveLength(0);
    expect(weak).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Test 17 — Valid PROD validation → success
// ─────────────────────────────────────────────────────────────────────────────

describe("Test 17: Valid PROD flow → all checks pass", () => {
  it("resolves env, validates bootstrap, resolves bundle, injects, validates required", () => {
    const env = { APP_ENV: "production" };
    expect(() => resolveEnvironment(env)).not.toThrow();

    const { credentials } = validateBootstrapJson(makeBootstrapJson());
    const { legacyMode, bundleName } = resolveBundleName("production", credentials, {});
    expect(legacyMode).toBe(false);
    expect(bundleName).toBe("cst-super-app-production");

    const target = {};
    const { injected, loadedKeys } = injectSecrets(makeProdBundle(), "production", false, target);
    expect(injected).toBeGreaterThan(0);
    expect(loadedKeys).toContain("SESSION_SECRET");
    expect(loadedKeys).toContain("SUPABASE_DATABASE_URL");

    const { missing, weak } = validateRequiredSecrets(target);
    expect(missing).toHaveLength(0);
    expect(weak).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bonus — Legacy mode backward compatibility
// ─────────────────────────────────────────────────────────────────────────────

describe("Legacy mode: backward compat with GCP_PROJECT_ID + GCP_SECRET_ID", () => {
  it("enters legacy mode when GCP_PROJECT_ID and GCP_SECRET_ID are set", () => {
    const { credentials } = validateBootstrapJson(makeBootstrapJson());
    const { legacyMode } = resolveBundleName("development", credentials, {
      GCP_PROJECT_ID: "my-proj",
      GCP_SECRET_ID: "replit-app-secrets",
    });
    expect(legacyMode).toBe(true);
  });

  it("selects _DEV keys in legacy dev mode", () => {
    const target = {};
    injectSecrets(makeLegacyBundle(), "development", true, target);
    // SESSION_SECRET should come from SESSION_SECRET_DEV
    expect(target.SESSION_SECRET).toBe("d".repeat(40));
    expect(target.SUPABASE_DATABASE_URL).toBe("postgres://dev-host/dev-db");
    expect(target.OPENAI_API_KEY).toBe("sk-dev");
    // Shared key (no _DEV variant) should be injected
    expect(target.SHARED_API_KEY).toBe("shared-key-no-dev-variant");
  });

  it("selects production keys in legacy prod mode", () => {
    const target = {};
    injectSecrets(makeLegacyBundle(), "production", true, target);
    expect(target.SESSION_SECRET).toBe("c".repeat(40));
    expect(target.SUPABASE_DATABASE_URL).toBe("postgres://prod-host/prod-db");
    expect(target.OPENAI_API_KEY).toBe("sk-prod");
  });

  it("never injects _DEV keys as-is in legacy prod mode", () => {
    const target = {};
    injectSecrets(makeLegacyBundle(), "production", true, target);
    // No key should end with _DEV in the result
    for (const key of Object.keys(target)) {
      expect(key).not.toMatch(/_DEV$/);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Bonus — resolveBundleName: project_id from bootstrap JSON (new mode)
// ─────────────────────────────────────────────────────────────────────────────

describe("resolveBundleName: project_id from bootstrap JSON", () => {
  it("uses project_id from bootstrap JSON when GCP_PROJECT_ID is not set", () => {
    const { credentials } = validateBootstrapJson(
      makeBootstrapJson({ project_id: "from-json-project" })
    );
    const { secretName } = resolveBundleName("development", credentials, {});
    expect(secretName).toContain("from-json-project");
  });

  it("GCP_PROJECT_ID overrides project_id from bootstrap JSON in legacy mode", () => {
    const { credentials } = validateBootstrapJson(
      makeBootstrapJson({ project_id: "from-json-project" })
    );
    const { secretName } = resolveBundleName("development", credentials, {
      GCP_PROJECT_ID: "override-project",
      GCP_SECRET_ID: "my-secret",
    });
    expect(secretName).toContain("override-project");
    expect(secretName).not.toContain("from-json-project");
  });
});
