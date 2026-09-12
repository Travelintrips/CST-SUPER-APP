/**
 * Canonical Marketplace approve-and-invite integration contract.
 *
 * This suite intentionally uses the isolated TEST_DATABASE_URL only. It calls
 * the real approveRfqForAdmin service and uses a direct test pool only for
 * fixture/assertion SQL. Operational side effects are mocked so no real
 * WhatsApp/email delivery or notification queue worker can run.
 */

import pg from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { resolveIsolatedTestDatabaseUrl } from "../../../../../../scripts/isolated-test-db-target.mjs";

const { Pool } = pg;

const { mockLogActivity, mockEnqueueNotification, mockCreateOrderLink } = vi.hoisted(() => ({
  mockLogActivity: vi.fn(),
  mockEnqueueNotification: vi.fn(),
  mockCreateOrderLink: vi.fn(),
}));

vi.mock("../../activityLog.js", () => ({
  logActivity: mockLogActivity,
}));

vi.mock("../marketplaceNotificationQueueService.js", () => ({
  enqueueNotification: mockEnqueueNotification,
}));

vi.mock("../orderLinkService.js", () => ({
  createOrderLink: mockCreateOrderLink,
}));

const TEST_DB_URL = resolveIsolatedTestDatabaseUrl(process.env, { requireExplicitTest: true });
const pool = new Pool({
  connectionString: TEST_DB_URL,
  ssl: { rejectUnauthorized: false },
  max: 4,
  connectionTimeoutMillis: 10_000,
});

type Fixture = {
  rfqId: number;
  vendorIds: number[];
  supplierIds: number[];
};

async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  values: unknown[] = [],
): Promise<T[]> {
  const result = await pool.query<T>(text, values);
  return result.rows;
}

async function createFixture(vendorCount = 2): Promise<Fixture> {
  const tag = `approve-invite-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const supplierRows = await query<{ id: number }>(
    `INSERT INTO suppliers (name, is_active, status)
     SELECT 'Integration ${tag} vendor ' || n, true, 'active'
     FROM generate_series(1, $1) AS n
     RETURNING id`,
    [vendorCount],
  );
  const supplierIds = supplierRows.map((row) => Number(row.id));

  const [rfq] = await query<{ id: number }>(
    `INSERT INTO mkt_rfqs
       (rfq_number, buyer_name, buyer_email, buyer_phone, status, approval_status, line_count, quote_count, notes)
     VALUES ($1, 'Integration Buyer', $2, '080000000000', 'draft', 'pending', 1, 0,
             'approve-and-invite integration fixture')
     RETURNING id`,
    [`MKT-TEST-${tag}`, `${tag}@test.invalid`],
  );

  await query(
    `INSERT INTO mkt_rfq_approvals (rfq_id, approver_level, status)
     VALUES ($1, 1, 'pending')`,
    [rfq.id],
  );

  return { rfqId: Number(rfq.id), vendorIds: supplierIds, supplierIds };
}

async function readRfq(rfqId: number): Promise<{
  status: string;
  approval_status: string;
  quote_count: number;
}> {
  const [row] = await query<{
    status: string;
    approval_status: string;
    quote_count: number;
  }>(
    `SELECT status, approval_status, quote_count
       FROM mkt_rfqs
      WHERE id = $1`,
    [rfqId],
  );
  return {
    status: row.status,
    approval_status: row.approval_status,
    quote_count: Number(row.quote_count),
  };
}

async function readQuotes(rfqId: number): Promise<Array<{ id: number; vendor_id: number }>> {
  return query<{ id: number; vendor_id: number }>(
    `SELECT id, vendor_id
       FROM mkt_vendor_quotes
      WHERE rfq_id = $1
      ORDER BY vendor_id`,
    [rfqId],
  );
}

async function cleanupFixture(fixture: Fixture | undefined): Promise<void> {
  if (!fixture) return;
  await query(`DELETE FROM mkt_vendor_quotes WHERE rfq_id = $1`, [fixture.rfqId]);
  await query(`DELETE FROM mkt_rfq_approvals WHERE rfq_id = $1`, [fixture.rfqId]);
  await query(`DELETE FROM mkt_rfqs WHERE id = $1`, [fixture.rfqId]);
  await query(`DELETE FROM suppliers WHERE id = ANY($1::int[])`, [fixture.supplierIds]);
}

async function loadService() {
  return import("../rfqApprovalService.js");
}

describe("canonical approve-and-invite", () => {
  beforeAll(() => {
    mockLogActivity.mockReset();
    mockEnqueueNotification.mockReset();
    mockCreateOrderLink.mockReset();
    mockLogActivity.mockResolvedValue(undefined);
    mockEnqueueNotification.mockResolvedValue(1);
    mockCreateOrderLink.mockResolvedValue(undefined);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("rolls back approval, first quote, and quote_count when a later vendor is invalid", async () => {
    const fixture = await createFixture(1);
    try {
      const { approveRfqForAdmin } = await loadService();
      const result = await approveRfqForAdmin({
        rfqId: fixture.rfqId,
        vendorIds: [fixture.vendorIds[0]!, fixture.vendorIds[0]! + 2_000_000],
        adminId: "integration-admin",
        adminName: "Integration Admin",
      });

      expect(result).toMatchObject({ ok: false, code: "VENDOR_NOT_FOUND" });
      expect(await readQuotes(fixture.rfqId)).toEqual([]);
      expect(await readRfq(fixture.rfqId)).toEqual({
        status: "draft",
        approval_status: "pending",
        quote_count: 0,
      });
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("replays the same request idempotently without duplicate quotes or count increments", async () => {
    const fixture = await createFixture(2);
    try {
      const { approveRfqForAdmin } = await loadService();
      const options = {
        rfqId: fixture.rfqId,
        vendorIds: fixture.vendorIds,
        adminId: "integration-admin",
        adminName: "Integration Admin",
      };

      const first = await approveRfqForAdmin(options);
      const afterFirst = await readRfq(fixture.rfqId);
      const quotesAfterFirst = await readQuotes(fixture.rfqId);
      const second = await approveRfqForAdmin(options);
      const afterSecond = await readRfq(fixture.rfqId);
      const quotesAfterSecond = await readQuotes(fixture.rfqId);

      expect(first.ok).toBe(true);
      expect(second).toMatchObject({ ok: true, alreadyApproved: true });
      if (second.ok) expect(second.invited.every((item) => item.alreadyInvited)).toBe(true);
      expect(afterFirst).toEqual({ status: "submitted", approval_status: "approved", quote_count: 2 });
      expect(afterSecond).toEqual(afterFirst);
      expect(quotesAfterSecond).toEqual(quotesAfterFirst);
      expect(quotesAfterSecond).toHaveLength(2);
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("serializes concurrent approval requests with one creator and no double quote count", async () => {
    const fixture = await createFixture(2);
    try {
      const { approveRfqForAdmin } = await loadService();
      const options = {
        rfqId: fixture.rfqId,
        vendorIds: fixture.vendorIds,
        adminId: "integration-admin",
        adminName: "Integration Admin",
      };

      const [left, right] = await Promise.all([
        approveRfqForAdmin(options),
        approveRfqForAdmin(options),
      ]);
      const results = [left, right];
      const quotes = await readQuotes(fixture.rfqId);
      const rfq = await readRfq(fixture.rfqId);

      expect(results.every((result) => result.ok)).toBe(true);
      expect(results.filter((result) => result.ok && !result.alreadyApproved)).toHaveLength(1);
      expect(results.filter((result) => result.ok && result.alreadyApproved)).toHaveLength(1);
      expect(quotes).toHaveLength(2);
      expect(new Set(quotes.map((quote) => quote.vendor_id)).size).toBe(2);
      expect(rfq).toEqual({ status: "submitted", approval_status: "approved", quote_count: 2 });
    } finally {
      await cleanupFixture(fixture);
    }
  });

  it("keeps committed business state when post-commit notification and activity side effects fail", async () => {
    const fixture = await createFixture(1);
    mockLogActivity.mockRejectedValue(new Error("simulated activity sink failure"));
    mockEnqueueNotification.mockRejectedValue(new Error("simulated notification failure"));
    mockCreateOrderLink.mockRejectedValue(new Error("simulated order-link failure"));

    try {
      const { approveRfqForAdmin } = await loadService();
      const result = await approveRfqForAdmin({
        rfqId: fixture.rfqId,
        vendorIds: fixture.vendorIds,
        adminId: "integration-admin",
        adminName: "Integration Admin",
      });

      expect(result.ok).toBe(true);
      expect(await readQuotes(fixture.rfqId)).toHaveLength(1);
      expect(await readRfq(fixture.rfqId)).toEqual({
        status: "submitted",
        approval_status: "approved",
        quote_count: 1,
      });
    } finally {
      await cleanupFixture(fixture);
      mockLogActivity.mockResolvedValue(undefined);
      mockEnqueueNotification.mockResolvedValue(1);
      mockCreateOrderLink.mockResolvedValue(undefined);
    }
  });

  it("keeps validation/replay errors typed and reserves DB_ERROR for unexpected transaction failures", async () => {
    const fixture = await createFixture(1);
    try {
      const { approveRfqForAdmin } = await loadService();
      const missingVendor = await approveRfqForAdmin({
        rfqId: fixture.rfqId,
        vendorIds: [fixture.vendorIds[0]!, fixture.vendorIds[0]! + 3_000_000],
        adminId: "integration-admin",
        adminName: "Integration Admin",
      });
      expect(missingVendor).toMatchObject({ ok: false, code: "VENDOR_NOT_FOUND" });
      expect(missingVendor).not.toMatchObject({ code: "INVITE_FAILED" });

      const successful = await approveRfqForAdmin({
        rfqId: fixture.rfqId,
        vendorIds: fixture.vendorIds,
        adminId: "integration-admin",
        adminName: "Integration Admin",
      });
      expect(successful.ok).toBe(true);

      const replay = await approveRfqForAdmin({
        rfqId: fixture.rfqId,
        vendorIds: fixture.vendorIds,
        adminId: "integration-admin",
        adminName: "Integration Admin",
      });
      expect(replay).toMatchObject({ ok: true, alreadyApproved: true });
      expect(replay).not.toMatchObject({ code: "INVITE_FAILED" });
    } finally {
      await cleanupFixture(fixture);
      mockLogActivity.mockResolvedValue(undefined);
      mockEnqueueNotification.mockResolvedValue(1);
      mockCreateOrderLink.mockResolvedValue(undefined);
    }
  });
});