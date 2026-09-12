/**
 * BUG-001 Regression Tests — Invalid ID Security
 *
 * Verifies that ALL PPJK endpoints that accept a numeric :id parameter:
 *   1. Return 400 INVALID_ID for non-numeric / zero / negative / oversized input
 *   2. Never return HTTP 500
 *   3. Never leak SQL statements, table names, stack traces, or DB connection info
 *
 * Uses real Express app + real PPJK router.
 * Auth layer replaced by header-based fixture (same pattern as ppjk-tenant-isolation.test.ts).
 * DB is mocked — no real DB required.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import supertest from "supertest";

// ── Mocks (must precede router import) ────────────────────────────────────────
vi.mock("@workspace/db", () => {
  const chain = () => {
    const obj: any = {};
    ["from","where","orderBy","limit","offset"].forEach((m) => { obj[m] = () => obj; });
    obj.catch = (fn: any) => Object.assign(Promise.resolve([]).catch(fn), obj);
    obj.then = (fn: any, rej: any) => Promise.resolve([]).then(fn, rej);
    return obj;
  };
  const mockDb: any = {
    select: vi.fn(() => chain()),
    insert: vi.fn(() => ({ values: () => ({ returning: () => Promise.resolve([]) }) })),
    update: vi.fn(() => ({ set: () => ({ where: () => ({ returning: () => Promise.resolve([]) }) }) })),
    delete: vi.fn(() => ({ where: () => ({ returning: () => Promise.resolve([]) }) })),
    execute: vi.fn(() => Promise.resolve({ rows: [] })),
    transaction: vi.fn((cb: any) => cb(mockDb)),
  };
  return {
    db: mockDb,
    ppjkOrdersTable: { id: "id", companyId: "company_id", status: "status", orderNumber: "order_number" },
    ppjkAuditLogsTable: { ppjkOrderId: "ppjk_order_id", createdAt: "created_at" },
    ppjkStatusLogsTable: {},
    ppjkDocumentChecklistTable: {},
    freightCustomsDocsTable: { sourceModule: "source_module", sourceOrderId: "source_order_id", createdAt: "created_at" },
    PPJK_DOC_LABELS: {},
    PPJK_DOC_TYPES: [],
  };
});

vi.mock("../lib/requireAdmin.js", () => ({
  requireAdmin: vi.fn(async (req: any, res: any) => {
    if (!req.user) { res.status(401).json({ message: "Unauthorized" }); return false; }
    return true;
  }),
  requireRole: vi.fn(async (req: any, res: any) => {
    if (!req.user) { res.status(401).json({ message: "Unauthorized" }); return false; }
    return true;
  }),
}));

vi.mock("../lib/waTransport.js", () => ({ sendViaService: vi.fn(() => Promise.resolve()) }));
vi.mock("../lib/domain.js", () => ({ getPreferredDomain: vi.fn(() => null) }));
vi.mock("../lib/openaiClient.js", () => ({ getOpenAI: vi.fn(() => { throw new Error("AI not configured"); }) }));
vi.mock("../lib/ppjkDocumentResolver.js", () => ({
  resolveRequiredDocuments: vi.fn(() => []),
  checkReadyForCeisa: vi.fn(() => ({ ready: true, missing: [] })),
}));
vi.mock("../lib/ppjkFinancialService.js", () => ({
  calculatePpjkFinancials: vi.fn(() => ({ grandTotal: 0, totalTagihanPabean: 0, totalServiceFee: 0, components: {} })),
  PpjkFinancialError: class PpjkFinancialError extends Error {},
}));
vi.mock("../lib/ppjkWorkflowEngine.js", () => ({
  isTransitionAllowed: vi.fn(() => true),
  allowedTransitions: vi.fn(() => []),
  computeSlaDeadline: vi.fn(() => null),
  isOverdue: vi.fn(() => false),
  isValidStatus: vi.fn(() => true),
  normaliseStatus: vi.fn((s: string) => s),
  isValidCustomsStatus: vi.fn(() => true),
  PPJK_STATUS_LABELS: {},
  PPJK_STATUSES: ["draft","waiting_documents","completed","cancelled"],
  PPJK_TERMINAL_STATUSES: ["completed","cancelled"],
  PPJK_CUSTOMS_STATUSES: [],
  PPJK_CUSTOMS_STATUS_LABELS: {},
  LEGACY_STATUS_MAP: {},
}));

import ppjkRouter, { parsePositiveIntegerId } from "../routes/ppjk.js";

// ── Test app ──────────────────────────────────────────────────────────────────
function buildApp() {
  const app = express();
  app.use(express.json());
  // Fixture: inject authenticated admin with company 1
  app.use((req: any, _res, next) => {
    req.user = { id: "uid-test", name: "Test Admin", role: "admin", companyId: 1 };
    req.isAuthenticated = () => true;
    req.isInternalSession = true;
    next();
  });
  app.use("/api/ppjk", ppjkRouter);
  return app;
}

const app = buildApp();

// ── Unit tests for parsePositiveIntegerId ─────────────────────────────────────
describe("parsePositiveIntegerId — unit", () => {
  it("accepts a valid positive integer", () => expect(parsePositiveIntegerId("1")).toBe(1));
  it("accepts large safe integer", () => expect(parsePositiveIntegerId("9007199254740991")).toBe(9007199254740991));
  it("rejects non-numeric string 'abc'", () => expect(parsePositiveIntegerId("abc")).toBeNull());
  it("rejects empty string", () => expect(parsePositiveIntegerId("")).toBeNull());
  it("rejects zero '0'", () => expect(parsePositiveIntegerId("0")).toBeNull());
  it("rejects negative string '-1'", () => expect(parsePositiveIntegerId("-1")).toBeNull());
  it("rejects float '1.5'", () => expect(parsePositiveIntegerId("1.5")).toBeNull());
  it("rejects oversized unsafe integer", () => expect(parsePositiveIntegerId("99999999999999999999")).toBeNull());
  it("rejects null", () => expect(parsePositiveIntegerId(null)).toBeNull());
  it("rejects undefined", () => expect(parsePositiveIntegerId(undefined)).toBeNull());
  it("rejects string with spaces ' 1 '", () => expect(parsePositiveIntegerId(" 1 ")).toBeNull());
  it("rejects SQL injection '1 OR 1=1'", () => expect(parsePositiveIntegerId("1 OR 1=1")).toBeNull());
  it("rejects script tag", () => expect(parsePositiveIntegerId("<script>")).toBeNull());
});

// ── HTTP integration: invalid ID → 400 INVALID_ID ────────────────────────────

const INVALID_INPUTS = ["abc", "0", "-1", "1.5", " 1", "99999999999999999999999", "<script>", "1 OR 1=1", "--"];

function expectInvalidIdResponse(res: supertest.Response) {
  expect(res.status, `Expected 400 but got ${res.status}: ${JSON.stringify(res.body)}`).toBe(400);
  expect(res.body.code).toBe("INVALID_ID");
  // Must never leak SQL details
  const bodyStr = JSON.stringify(res.body);
  expect(bodyStr).not.toMatch(/SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|pg|postgres|syntax/i);
  expect(bodyStr).not.toMatch(/stack|at Object|at async|Error:/);
  expect(bodyStr).not.toMatch(/ppjk_orders|ppjk_audit/i);
}

describe("BUG-001 — GET /api/ppjk/orders/:id invalid IDs → 400", () => {
  for (const input of INVALID_INPUTS) {
    it(`GET /orders/${JSON.stringify(input)} → 400 INVALID_ID`, async () => {
      const res = await supertest(app).get(`/api/ppjk/orders/${encodeURIComponent(input)}`);
      expectInvalidIdResponse(res);
    });
  }
});

describe("BUG-001 — PUT /api/ppjk/orders/:id invalid IDs → 400", () => {
  for (const input of ["abc", "0", "-1", "99999999999999999999"]) {
    it(`PUT /orders/${input} → 400 INVALID_ID`, async () => {
      const res = await supertest(app).put(`/api/ppjk/orders/${input}`).send({ notes: "x" });
      expectInvalidIdResponse(res);
    });
  }
});

describe("BUG-001 — POST /api/ppjk/orders/:id/workflow invalid IDs → 400", () => {
  for (const input of ["abc", "0", "-1", "99999999999999999999"]) {
    it(`POST /orders/${input}/workflow → 400 INVALID_ID`, async () => {
      const res = await supertest(app).post(`/api/ppjk/orders/${input}/workflow`).send({ status: "waiting_documents" });
      expectInvalidIdResponse(res);
    });
  }
});

describe("BUG-001 — DELETE /api/ppjk/orders/:id invalid IDs → 400", () => {
  for (const input of ["abc", "0", "-1", "99999999999999999999"]) {
    it(`DELETE /orders/${input} → 400 INVALID_ID`, async () => {
      const res = await supertest(app).delete(`/api/ppjk/orders/${input}`).send({ reason: "test reason" });
      expectInvalidIdResponse(res);
    });
  }
});

describe("BUG-001 — POST /api/ppjk/orders/:id/status invalid IDs → 400", () => {
  for (const input of ["abc", "0"]) {
    it(`POST /orders/${input}/status → 400 INVALID_ID`, async () => {
      const res = await supertest(app).post(`/api/ppjk/orders/${input}/status`).send({ status: "draft" });
      expectInvalidIdResponse(res);
    });
  }
});

describe("BUG-001 — GET /api/ppjk/orders/:id/timeline invalid IDs → 400", () => {
  it("GET /orders/abc/timeline → 400 INVALID_ID", async () => {
    const res = await supertest(app).get("/api/ppjk/orders/abc/timeline");
    expectInvalidIdResponse(res);
  });
});

describe("BUG-001 — GET /api/ppjk/orders/:id/checklist invalid IDs → 400", () => {
  it("GET /orders/0/checklist → 400 INVALID_ID", async () => {
    const res = await supertest(app).get("/api/ppjk/orders/0/checklist");
    expectInvalidIdResponse(res);
  });
});

describe("BUG-001 — POST /api/ppjk/orders/:id/checklist invalid IDs → 400", () => {
  it("POST /orders/abc/checklist → 400 INVALID_ID", async () => {
    const res = await supertest(app).post("/api/ppjk/orders/abc/checklist").send({ docType: "invoice" });
    expectInvalidIdResponse(res);
  });
});

describe("BUG-001 — PATCH /api/ppjk/orders/:id/checklist/:itemId invalid IDs → 400", () => {
  it("PATCH /orders/abc/checklist/1 → 400 INVALID_ID (bad orderId)", async () => {
    const res = await supertest(app).patch("/api/ppjk/orders/abc/checklist/1").send({ status: "verified" });
    expectInvalidIdResponse(res);
  });
  it("PATCH /orders/1/checklist/abc → 400 INVALID_ID (bad itemId)", async () => {
    // orderId valid → passes parsePositiveIntegerId, then itemId fails
    // First mock db.select to return an order so tenant check passes
    const { db } = await import("@workspace/db");
    const ORDER = { id: 1, companyId: 1, status: "draft", orderNumber: "PPJK/1" };
    (db.select as any).mockImplementationOnce(() => {
      const c: any = {};
      ["from","where","orderBy","limit","offset"].forEach((m) => { c[m] = () => c; });
      c.catch = (fn: any) => Object.assign(Promise.resolve([ORDER]).catch(fn), c);
      c.then = (fn: any, rej: any) => Promise.resolve([ORDER]).then(fn, rej);
      return c;
    });
    const res = await supertest(app).patch("/api/ppjk/orders/1/checklist/abc").send({ status: "verified" });
    expectInvalidIdResponse(res);
  });
});

describe("BUG-001 — GET /api/ppjk/orders/:id/sla invalid IDs → 400", () => {
  it("GET /orders/-1/sla → 400 INVALID_ID", async () => {
    const res = await supertest(app).get("/api/ppjk/orders/-1/sla");
    expectInvalidIdResponse(res);
  });
});

describe("BUG-001 — GET /api/ppjk/orders/:id/dashboard invalid IDs → 400", () => {
  it("GET /orders/abc/dashboard → 400 INVALID_ID", async () => {
    const res = await supertest(app).get("/api/ppjk/orders/abc/dashboard");
    expectInvalidIdResponse(res);
  });
});

describe("BUG-001 — POST /api/ppjk/orders/:id/ai-assist invalid IDs → 400", () => {
  it("POST /orders/abc/ai-assist → 400 INVALID_ID", async () => {
    const res = await supertest(app).post("/api/ppjk/orders/abc/ai-assist").send({ query: "test" });
    expectInvalidIdResponse(res);
  });
});

describe("BUG-001 — GET /api/ppjk/orders/:id/audit-log invalid IDs → 400", () => {
  it("GET /orders/abc/audit-log → 400 INVALID_ID", async () => {
    const res = await supertest(app).get("/api/ppjk/orders/abc/audit-log");
    expectInvalidIdResponse(res);
  });
});

// ── Valid numeric ID not found → 404 (not 500) ────────────────────────────────
// Build a dedicated app where db.select always returns empty (simulates missing ID)
function buildEmptyDbApp() {
  const emptyChain = () => {
    const obj: any = {};
    ["from","where","orderBy","limit","offset"].forEach((m) => { obj[m] = () => obj; });
    obj.catch = (fn: any) => Object.assign(Promise.resolve([]).catch(fn), obj);
    obj.then = (fn: any, rej: any) => Promise.resolve([]).then(fn, rej);
    return obj;
  };
  const { db: mockDb } = require("@workspace/db");
  mockDb.select.mockReturnValue(emptyChain());

  const testApp = express();
  testApp.use(express.json());
  testApp.use((req: any, _res, next) => {
    req.user = { id: "uid-test", name: "Test Admin", role: "admin", companyId: 1 };
    req.isAuthenticated = () => true;
    req.isInternalSession = true;
    next();
  });
  testApp.use("/api/ppjk", ppjkRouter);
  return testApp;
}

describe("BUG-001 — numeric ID that does not exist → 404, not 500", () => {
  it("GET /orders/999999999 → must not be 500 for valid numeric ID", async () => {
    // Valid numeric ID → parsePositiveIntegerId passes → DB lookup → 404 or 200 depending on mock,
    // but NEVER 500 (which would indicate unguarded DB error leak).
    const res = await supertest(app).get("/api/ppjk/orders/999999999");
    expect(res.status).not.toBe(500);
    // Response body must not contain SQL or stack trace
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toMatch(/SELECT|INSERT|FROM|WHERE|syntax error/i);
    expect(bodyStr).not.toMatch(/\.ts:\d+|at Object\.|at async /);
    expect(bodyStr).not.toMatch(/ppjk_orders|ppjk_audit/i);
  });

  it("parsePositiveIntegerId('999999999') is a valid positive integer — DB gets a safe integer", () => {
    // Re-use the already-imported parsePositiveIntegerId (top-level import)
    expect(parsePositiveIntegerId("999999999")).toBe(999999999);
  });
});

// ── Response must never contain SQL or internal details ───────────────────────
describe("BUG-001 — response body must not contain SQL or internal details", () => {
  const LEAK_PATTERNS = [
    /SELECT\s+/i, /FROM\s+ppjk/i, /pg_/i, /syntax error/i,
    /ECONNREFUSED/i, /stack trace/i, /at Object\./i, /\.ts:\d+/,
  ];

  it("400 INVALID_ID body is clean", async () => {
    const res = await supertest(app).get("/api/ppjk/orders/abc");
    const body = JSON.stringify(res.body);
    for (const pattern of LEAK_PATTERNS) {
      expect(body, `Leaked pattern ${pattern} in: ${body}`).not.toMatch(pattern);
    }
  });
});
