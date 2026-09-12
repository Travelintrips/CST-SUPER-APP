import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: { execute: vi.fn() },
  endPool: vi.fn(),
}));

vi.mock("../lib/notificationStore.js", () => ({
  saveAndBroadcast: vi.fn().mockResolvedValue(undefined),
}));

import {
  getCandidateSourceHealthSummary,
  recordCandidateSourceAvailability,
  resetCandidateSourceHealthForTests,
} from "../lib/monitoring/reconciliationMonitor.js";
import { saveAndBroadcast } from "../lib/notificationStore.js";

describe("candidate source observability", () => {
  beforeEach(() => {
    resetCandidateSourceHealthForTests();
    vi.stubEnv("APP_ENV", "development");
    vi.mocked(saveAndBroadcast).mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    resetCandidateSourceHealthForTests();
  });

  it("reports an unavailable optional source as a degraded warning without transaction data", () => {
    recordCandidateSourceAvailability({
      source: "invoice",
      optional: true,
      available: false,
      failureKind: "schema_preflight",
      failureCode: "missing_schema_requirements",
    });

    const health = getCandidateSourceHealthSummary();
    const source = health.sources[0];

    expect(health).toMatchObject({
      status: "degraded",
      environment: "development",
      unavailable_optional_sources: ["invoice"],
      unavailable_required_sources: [],
      alert: {
        severity: "warning",
        code: "OPTIONAL_CANDIDATE_SOURCE_UNAVAILABLE",
        source_count: 1,
      },
    });
    expect(source).toMatchObject({
      source: "invoice",
      environment: "development",
      optional: true,
      required: false,
      availability: "unavailable",
      preflight_failure_count: 1,
      query_failure_count: 0,
      failure_count: 1,
      last_failure_kind: "schema_preflight",
      last_failure_code: "missing_schema_requirements",
    });
    expect(saveAndBroadcast).toHaveBeenCalledWith("admin_notification", expect.objectContaining({
      type: "reconciliation_candidate_source_unavailable",
      source: "invoice",
      environment: "development",
      optional: true,
      required: false,
      severity: "warning",
      failureKind: "schema_preflight",
      failureCode: "missing_schema_requirements",
      targetRole: "admin",
    }));
    expect(JSON.stringify(health)).not.toMatch(/mutation|credential|password|token/i);
  });

  it("escalates an unavailable required source after a query failure", () => {
    recordCandidateSourceAvailability({
      source: "accounting_payment",
      optional: false,
      available: false,
      failureKind: "query",
      failureCode: "candidate_query_failed",
    });

    const health = getCandidateSourceHealthSummary();
    const source = health.sources[0];

    expect(health).toMatchObject({
      status: "critical",
      unavailable_optional_sources: [],
      unavailable_required_sources: ["accounting_payment"],
      alert: {
        severity: "critical",
        code: "REQUIRED_CANDIDATE_SOURCE_UNAVAILABLE",
        source_count: 1,
      },
    });
    expect(source).toMatchObject({
      optional: false,
      required: true,
      availability: "unavailable",
      preflight_failure_count: 0,
      query_failure_count: 1,
      failure_count: 1,
      last_failure_kind: "query",
      last_failure_code: "candidate_query_failed",
    });
    expect(saveAndBroadcast).toHaveBeenCalledWith("admin_notification", expect.objectContaining({
      type: "reconciliation_candidate_source_unavailable",
      source: "accounting_payment",
      required: true,
      severity: "critical",
      failureKind: "query",
      failureCode: "candidate_query_failed",
    }));
  });

  it("deduplicates repeated failure alerts and notifies admins when the source recovers", () => {
    const unavailable = {
      source: "invoice",
      optional: true,
      available: false,
      failureKind: "query" as const,
      failureCode: "candidate_query_failed",
    };
    recordCandidateSourceAvailability(unavailable);
    recordCandidateSourceAvailability(unavailable);

    expect(saveAndBroadcast).toHaveBeenCalledTimes(1);

    recordCandidateSourceAvailability({
      source: "invoice",
      optional: true,
      available: true,
    });

    expect(getCandidateSourceHealthSummary()).toMatchObject({
      status: "healthy",
      unavailable_optional_sources: [],
      alert: null,
    });
    expect(saveAndBroadcast).toHaveBeenLastCalledWith("admin_notification", expect.objectContaining({
      type: "reconciliation_candidate_source_recovered",
      source: "invoice",
      availability: "available",
      failureKind: null,
      failureCode: null,
      targetRole: "admin",
    }));
  });
});