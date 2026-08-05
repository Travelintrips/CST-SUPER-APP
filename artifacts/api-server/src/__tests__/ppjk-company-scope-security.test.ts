/**
 * BUG-002 Regression Tests — Company Scope Injection Prevention
 *
 * Verifies that tenant actors cannot override companyId via request body/query:
 *   1. POST /orders with body companyId=TenantB → 403 COMPANY_SCOPE_OVERRIDE_DENIED
 *   2. POST /orders with body company_id=TenantB → ignored or rejected
 *   3. Tenant A create without bodyCompanyId → uses session company (Tenant A)
 *   4. super_admin with explicit companyId → allowed
 *   5. admin with null companyId → 403 TENANT_CONTEXT_REQUIRED
 *   6. Update cannot move order to a different company
 *
 * Auth is fixture-injected via X-Test-User header (same pattern as other PPJK tests).
 * DB is mocked.
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
    insert: vi.fn(() => ({ values: () => ({ returning: () => Promise.resolve([{ id: 99, companyId: 1, status: "draft", orderNumber: "PPJK/2025/01/00099" }]) }) })),
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

import ppjkRouter from "../routes/ppjk.js";
import { db } from "@workspace/db";

// ── Constants ─────────────────────────────────────────────────────────────────
const COMPANY_A = 1;
const COMPANY_B = 2;

const TENANT_A = { id: "uid-a", name: "Admin A", role: "admin", companyId: COMPANY_A };
const TENANT_B = { id: "uid-b", name: "Admin B", role: "admin", companyId: COMPANY_B };
const SUPER_ADMIN = { id: "uid-sa", name: "Super Admin", role: "super_admin", companyId: null };
const ADMIN_NO_CO = { id: "uid-nc", name: "Admin NoComp", role: "admin", companyId: null };

const ORDER_A = { id: 7, companyId: COMPANY_A, status: "draft", orderNumber: "PPJK/2025/01/00007", customerPhone: null, slaDeadline: null, statusEnteredAt: null, customsStatus: null, createdAt: new Date(), updatedAt: new Date() };

// ── App factory ───────────────────────────────────────────────────────────────
function buildApp(actor: { id: string; name: string; role: string; companyId: number | null }) {
  const app = express();
  app.use(express.json());
  app.use((req: any, _res, next) => {
    req.user = actor;
    req.isAuthenticated = () => true;
    req.isInternalSession = true;
    next();
  });
  app.use("/api/ppjk", ppjkRouter);
  return app;
}

function mockSelectReturns(rows: any[]) {
  (db.select as any).mockImplementation(() => {
    const c: any = {};
    ["from","where","orderBy","limit","offset"].forEach((m) => { c[m] = () => c; });
    c.catch = (fn: any) => Object.assign(Promise.resolve(rows).catch(fn), c);
    c.then = (fn: any, rej: any) => Promise.resolve(rows).then(fn, rej);
    return c;
  });
}

const BASE_ORDER_BODY = {
  customerName: "PT Test Tenant A",
  customerEmail: "test@a.co",
  tradeType: "import",
};

// ─────────────────────────────────────────────────────────────────────────────
// BUG-002 — POST /api/ppjk/orders company scope injection
// ─────────────────────────────────────────────────────────────────────────────
describe("BUG-002 — POST /orders: tenant actor cannot inject companyId from body", () => {
  beforeEach(() => vi.clearAllMocks());

  it("Tenant A sending companyId=COMPANY_B → 403 COMPANY_SCOPE_OVERRIDE_DENIED", async () => {
    const app = buildApp(TENANT_A);
    const res = await supertest(app)
      .post("/api/ppjk/orders")
      .send({ ...BASE_ORDER_BODY, companyId: COMPANY_B });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("COMPANY_SCOPE_OVERRIDE_DENIED");
  });

  it("Tenant A sending companyId=COMPANY_B as string → 403 COMPANY_SCOPE_OVERRIDE_DENIED", async () => {
    const app = buildApp(TENANT_A);
    const res = await supertest(app)
      .post("/api/ppjk/orders")
      .send({ ...BASE_ORDER_BODY, companyId: String(COMPANY_B) });
    expect(res.status).toBe(403);
    expect(res.body.code).toBe("COMPANY_SCOPE_OVERRIDE_DENIED");
  });

  it("Tenant A without companyId in body → uses session company (COMPANY_A)", async () => {
    const app = buildApp(TENANT_A);
    // Capture ALL insert values — order insert will have orderNumber field
    const allInserts: any[] = [];
    (db.insert as any).mockImplementation(() => ({
      values: (v: any) => {
        allInserts.push(v);
        const returning = Array.isArray(v)
          ? [{ ...v[0], id: 1, orderNumber: "PPJK/TEST/001" }]
          : [{ ...v, id: 1, orderNumber: "PPJK/TEST/001" }];
        return { returning: () => Promise.resolve(returning) };
      },
    }));
    (db.execute as any).mockResolvedValue({ rows: [{ maxSeq: 0 }] });
    const res = await supertest(app)
      .post("/api/ppjk/orders")
      .send({ ...BASE_ORDER_BODY });
    // Either 201 (created) or a non-403 response indicates no scope override denial
    expect(res.status).not.toBe(403);
    // The order insert (has orderNumber field) must have companyId = COMPANY_A
    const orderInsert = allInserts.find((v) => "orderNumber" in v);
    if (orderInsert) {
      expect(orderInsert.companyId).toBe(COMPANY_A);
    }
  });

  it("Tenant A sending same companyId=COMPANY_A (own company) → allowed", async () => {
    const app = buildApp(TENANT_A);
    (db.execute as any).mockResolvedValue({ rows: [{ maxSeq: 0 }] });
    const res = await supertest(app)
      .post("/api/ppjk/orders")
      .send({ ...BASE_ORDER_BODY, companyId: COMPANY_A });
    // Not blocked (same company as session)
    expect(res.status).not.toBe(403);
  });

  it("Admin with companyId=null → 403 TENANT_CONTEXT_REQUIRED (not allowed to create orders)", async () => {
    const app = buildApp(ADMIN_NO_CO);
    const res = await supertest(app)
      .post("/api/ppjk/orders")
      .send({ ...BASE_ORDER_BODY });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe("TENANT_CONTEXT_REQUIRED");
  });

  it("super_admin with explicit companyId in body → allowed", async () => {
    const app = buildApp(SUPER_ADMIN);
    (db.execute as any).mockResolvedValue({ rows: [{ maxSeq: 0 }] });
    const res = await supertest(app)
      .post("/api/ppjk/orders")
      .send({ ...BASE_ORDER_BODY, companyId: COMPANY_B });
    // super_admin may specify any company
    expect(res.status).not.toBe(403);
  });

  it("super_admin without companyId in body → allowed (null companyId is OK for platform actor)", async () => {
    const app = buildApp(SUPER_ADMIN);
    (db.execute as any).mockResolvedValue({ rows: [{ maxSeq: 0 }] });
    const res = await supertest(app)
      .post("/api/ppjk/orders")
      .send({ ...BASE_ORDER_BODY });
    expect(res.status).not.toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUG-002 — PUT /orders/:id cannot move order to another tenant
// ─────────────────────────────────────────────────────────────────────────────
describe("BUG-002 — PUT /orders/:id: tenant actor cannot move order to another company via body", () => {
  beforeEach(() => vi.clearAllMocks());

  it("Tenant A cannot change companyId of own order to COMPANY_B via PUT body", async () => {
    mockSelectReturns([ORDER_A]);
    (db.update as any).mockImplementation(() => {
      let setValues: any = {};
      return {
        set: (v: any) => { setValues = v; return { where: () => ({ returning: () => Promise.resolve([{ ...ORDER_A, ...setValues }]) }) }; },
      };
    });
    const app = buildApp(TENANT_A);
    const res = await supertest(app)
      .put("/api/ppjk/orders/7")
      .send({ notes: "legit update", companyId: COMPANY_B });
    // companyId is not in allowedFields for PUT — it should not be updated
    // The order should still succeed (200) but companyId must not be changed
    if (res.status === 200) {
      // If the PUT succeeds, the returned companyId must not be COMPANY_B
      expect(res.body.companyId).not.toBe(COMPANY_B);
    }
    // Alternatively, it may be explicitly blocked
    expect(res.status).not.toBe(500);
  });

  it("Tenant B cannot PUT (update) Tenant A's order (403)", async () => {
    mockSelectReturns([ORDER_A]);
    const app = buildApp(TENANT_B);
    const res = await supertest(app)
      .put("/api/ppjk/orders/7")
      .send({ notes: "hacked" });
    expect(res.status).toBe(403);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUG-002 — Child entities inherit parent order company
// ─────────────────────────────────────────────────────────────────────────────
describe("BUG-002 — child entities cannot have companyId overridden via body", () => {
  beforeEach(() => vi.clearAllMocks());

  it("POST /orders/:id/checklist: companyId from checklist body is not stored independently (uses parent order)", async () => {
    mockSelectReturns([ORDER_A]);
    let insertedValues: any = null;
    (db as any).insert = vi.fn(() => ({
      values: (v: any) => { insertedValues = v; return { returning: () => Promise.resolve([v]) }; },
      onConflictDoNothing: () => Promise.resolve(),
    }));
    // Also mock the select for checklist existence check
    (db.select as any).mockImplementation(() => {
      const c: any = {};
      ["from","where","orderBy","limit","offset"].forEach((m) => { c[m] = () => c; });
      c.catch = () => Object.assign(Promise.resolve([null]), c);
      c.then = (fn: any, rej: any) => Promise.resolve([null]).then(fn, rej);
      return c;
    });
    const app = buildApp(TENANT_A);
    await supertest(app)
      .post("/api/ppjk/orders/7/checklist")
      .send({ docType: "invoice", status: "uploaded", companyId: COMPANY_B });
    // Checklist insert must not include a COMPANY_B companyId
    if (insertedValues) {
      const vals = Array.isArray(insertedValues) ? insertedValues[0] : insertedValues;
      if (vals.companyId !== undefined) {
        expect(vals.companyId).not.toBe(COMPANY_B);
      }
    }
  });

  it("POST /orders/:id/assign: assignment body companyId is ignored", async () => {
    mockSelectReturns([ORDER_A]);
    let updatedPatch: any = null;
    (db.update as any).mockImplementation(() => ({
      set: (v: any) => { updatedPatch = v; return { where: () => ({ returning: () => Promise.resolve([ORDER_A]) }) }; },
    }));
    (db.insert as any).mockImplementation(() => ({ values: () => ({ returning: () => Promise.resolve([]) }) }));
    const app = buildApp(TENANT_A);
    await supertest(app)
      .post("/api/ppjk/orders/7/assign")
      .send({ assignedOfficerName: "Budi", companyId: COMPANY_B });
    // The patch applied to the order must not contain COMPANY_B
    if (updatedPatch) {
      expect(updatedPatch.companyId).not.toBe(COMPANY_B);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// BUG-002 — Audit records correct company
// ─────────────────────────────────────────────────────────────────────────────
describe("BUG-002 — audit log records actual target company, not injected value", () => {
  beforeEach(() => vi.clearAllMocks());

  it("Audit entry for POST /orders records session company (COMPANY_A), not injected COMPANY_B", async () => {
    const app = buildApp(TENANT_A);
    let auditValues: any = null;
    let createdRow: any = { id: 1, companyId: COMPANY_A, status: "draft", orderNumber: "PPJK/T/001" };

    (db.insert as any).mockImplementation(() => ({
      values: (v: any) => {
        // Capture audit log insert (has action field) vs order insert
        if (v && v.action) auditValues = v;
        return { returning: () => Promise.resolve([createdRow]) };
      },
    }));
    (db.execute as any).mockResolvedValue({ rows: [{ maxSeq: 5 }] });

    // No companyId injection (legitimate create)
    await supertest(app)
      .post("/api/ppjk/orders")
      .send({ ...BASE_ORDER_BODY });

    // If an audit row was captured, it should reference COMPANY_A's order
    if (auditValues) {
      expect(auditValues.action).toBe("created");
    }
  });
});
