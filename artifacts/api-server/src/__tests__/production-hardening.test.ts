/**
 * Production Hardening Regression Tests
 *
 * Covers closure of two production advisories:
 *
 * Advisory A — devTestRoutes env guard (fail-closed allowlist)
 *   Test 1: NODE_ENV kosong, APP_ENV kosong  → dev routes TIDAK aktif
 *   Test 2: APP_ENV = "production"           → dev routes TIDAK aktif
 *   Test 3: APP_ENV = "development", ENABLE_DEV_ROUTES = "false" → TIDAK aktif
 *   Test 4: APP_ENV = "development", ENABLE_DEV_ROUTES = "true"  → aktif
 *   Test 4b: APP_ENV = "development", ENABLE_DEV_ROUTES unset     → aktif (default allow in dev)
 *
 * Advisory B — expireStaleApprovals auto-approve guard
 *   Test 5: autoApproveMinutes = null      → isAutoApproveConfigured = false (skip)
 *   Test 6: autoApproveMinutes = 0        → isAutoApproveConfigured = false (skip)
 *   Test 7: autoApproveMinutes = undefined → isAutoApproveConfigured = false (skip)
 *   Test 8: autoApproveMinutes = -5       → isAutoApproveConfigured = false (skip)
 *   Test 9: autoApproveMinutes = 30       → isAutoApproveConfigured = true  (enable)
 */

import { describe, it, expect, afterEach } from "vitest";
import { isAutoApproveConfigured } from "../lib/aiGovernance.js";
import { isDevRoutesEnabled } from "../routes/devTestRoutes.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function withEnv(vars: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = v;
    }
  }
  try {
    fn();
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) {
        delete process.env[k];
      } else {
        process.env[k] = v;
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Advisory A — devTestRoutes fail-closed guard
// ─────────────────────────────────────────────────────────────────────────────

describe("Advisory A — devTestRoutes: fail-closed env guard", () => {
  it("Test 1: NODE_ENV kosong dan APP_ENV tidak di-set → routes TIDAK aktif", () => {
    withEnv({ NODE_ENV: undefined, APP_ENV: undefined, ENABLE_DEV_ROUTES: undefined }, () => {
      expect(isDevRoutesEnabled()).toBe(false);
    });
  });

  it("Test 2: APP_ENV = 'production' → routes TIDAK aktif", () => {
    withEnv({ APP_ENV: "production", ENABLE_DEV_ROUTES: undefined }, () => {
      expect(isDevRoutesEnabled()).toBe(false);
    });
  });

  it("Test 2b: APP_ENV = 'staging' → routes TIDAK aktif", () => {
    withEnv({ APP_ENV: "staging", ENABLE_DEV_ROUTES: undefined }, () => {
      expect(isDevRoutesEnabled()).toBe(false);
    });
  });

  it("Test 3: APP_ENV = 'development', ENABLE_DEV_ROUTES = 'false' → routes TIDAK aktif", () => {
    withEnv({ APP_ENV: "development", ENABLE_DEV_ROUTES: "false" }, () => {
      expect(isDevRoutesEnabled()).toBe(false);
    });
  });

  it("Test 4: APP_ENV = 'development', ENABLE_DEV_ROUTES = 'true' → routes AKTIF", () => {
    withEnv({ APP_ENV: "development", ENABLE_DEV_ROUTES: "true" }, () => {
      expect(isDevRoutesEnabled()).toBe(true);
    });
  });

  it("Test 4b: APP_ENV = 'development', ENABLE_DEV_ROUTES tidak di-set → routes AKTIF (default dev)", () => {
    withEnv({ APP_ENV: "development", ENABLE_DEV_ROUTES: undefined }, () => {
      expect(isDevRoutesEnabled()).toBe(true);
    });
  });

  it("APP_ENV kosong string → routes TIDAK aktif", () => {
    withEnv({ APP_ENV: "", ENABLE_DEV_ROUTES: undefined }, () => {
      expect(isDevRoutesEnabled()).toBe(false);
    });
  });

  it("NODE_ENV = 'development' tapi APP_ENV tidak di-set → routes TIDAK aktif (NODE_ENV tidak cukup)", () => {
    withEnv({ NODE_ENV: "development", APP_ENV: undefined, ENABLE_DEV_ROUTES: undefined }, () => {
      expect(isDevRoutesEnabled()).toBe(false);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Advisory B — isAutoApproveConfigured guard
// ─────────────────────────────────────────────────────────────────────────────

describe("Advisory B — isAutoApproveConfigured: auto-approve guard", () => {
  it("Test 5: autoApproveMinutes = null → false (scanner harus skip)", () => {
    expect(isAutoApproveConfigured(null)).toBe(false);
  });

  it("Test 6: autoApproveMinutes = 0 → false (scanner harus skip)", () => {
    expect(isAutoApproveConfigured(0)).toBe(false);
  });

  it("Test 7: autoApproveMinutes = undefined → false (scanner harus skip)", () => {
    expect(isAutoApproveConfigured(undefined)).toBe(false);
  });

  it("Test 8: autoApproveMinutes = -5 → false (nilai negatif tidak valid)", () => {
    expect(isAutoApproveConfigured(-5)).toBe(false);
  });

  it("Test 9: autoApproveMinutes = 30 → true (konfigurasi eksplisit valid)", () => {
    expect(isAutoApproveConfigured(30)).toBe(true);
  });

  it("autoApproveMinutes = 1 → true (minimum positive)", () => {
    expect(isAutoApproveConfigured(1)).toBe(true);
  });

  it("autoApproveMinutes = Infinity → false (bukan finite)", () => {
    expect(isAutoApproveConfigured(Infinity)).toBe(false);
  });

  it("autoApproveMinutes = NaN → false (bukan finite)", () => {
    expect(isAutoApproveConfigured(NaN)).toBe(false);
  });
});
