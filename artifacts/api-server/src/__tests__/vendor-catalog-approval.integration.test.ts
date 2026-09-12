import express, { type Request, type Response, type NextFunction } from "express";
import request from "supertest";
import { afterAll, describe, expect, it } from "vitest";
import { eq, inArray, sql } from "drizzle-orm";
import {
  db,
  endPool,
  suppliersTable,
  vendorCatalogItemsTable,
  vendorCatalogSubmissionLinksTable,
  vendorCatalogSubmissionsTable,
} from "@workspace/db";
import { getIsolatedTestDatabaseUrl } from "../test-setup.js";
import {
  vendorCatalogEngineAdminRouter,
  vendorCatalogEnginePublicRouter,
} from "../routes/vendorCatalogEngine.js";
import { listPublicMarketplaceItems } from "../lib/services/portalVendorCatalogService.js";

getIsolatedTestDatabaseUrl();

const app = express();
app.use(express.json());
app.use((req: Request, _res: Response, next: NextFunction) => {
  // The catalog-engine admin router uses the internal session contract. The
  // test user is intentionally absent from users so requireAdmin exercises its
  // documented session-role fallback without creating an auth fixture.
  const testReq = req as any;
  testReq.isAuthenticated = () => true;
  testReq.isInternalSession = true;
  testReq.user = { id: "vendor-catalog-smoke-admin", role: "admin" };
  next();
});
app.use("/vendor-catalog-engine", vendorCatalogEnginePublicRouter);
app.use("/trading/catalog-engine", vendorCatalogEngineAdminRouter);

describe("vendor catalog approval flow (isolated database smoke)", () => {
  const fixture = {
    supplierId: 0,
    linkIds: [] as number[],
    submissionIds: [] as number[],
    itemIds: [] as number[],
  };
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const approvedName = `Smoke approved product ${suffix}`;
  const rejectedName = `Smoke rejected product ${suffix}`;

  async function createLink(token: string) {
    const [link] = await db
      .insert(vendorCatalogSubmissionLinksTable)
      .values({
        token,
        supplierId: fixture.supplierId,
        vendorName: `Smoke Vendor ${suffix}`,
        title: "Catalog smoke test",
        templateKind: "product",
        serviceType: "product",
        isActive: true,
      })
      .returning({ id: vendorCatalogSubmissionLinksTable.id });
    if (!link) throw new Error("Smoke fixture link was not created");
    fixture.linkIds.push(link.id);
    return link.id;
  }

  async function submitProduct(token: string, name: string) {
    const response = await request(app)
      .post(`/vendor-catalog-engine/submit/${token}`)
      .send({
        name,
        description: "Isolated approval-flow smoke fixture",
        unit: "unit",
        priceBase: 125000,
        currency: "IDR",
      })
      .expect(201);

    expect(response.body.status).toBe("pending_review");
    expect(response.body.submissionId).toEqual(expect.any(Number));
    expect(response.body.catalogItemId).toEqual(expect.any(Number));
    fixture.submissionIds.push(response.body.submissionId);
    fixture.itemIds.push(response.body.catalogItemId);
    return response.body as { submissionId: number; catalogItemId: number };
  }

  afterAll(async () => {
    if (fixture.itemIds.length > 0) {
      await db.execute(sql`
        DELETE FROM admin_notifications
        WHERE payload->>'catalogItemId' IN (${sql.join(fixture.itemIds.map((id) => sql`${id}`), sql`, `)})
      `);
      await db
        .delete(vendorCatalogItemsTable)
        .where(inArray(vendorCatalogItemsTable.id, fixture.itemIds));
    }
    if (fixture.submissionIds.length > 0) {
      await db
        .delete(vendorCatalogSubmissionsTable)
        .where(inArray(vendorCatalogSubmissionsTable.id, fixture.submissionIds));
    }
    if (fixture.linkIds.length > 0) {
      await db
        .delete(vendorCatalogSubmissionLinksTable)
        .where(inArray(vendorCatalogSubmissionLinksTable.id, fixture.linkIds));
    }
    if (fixture.supplierId) {
      await db.delete(suppliersTable).where(eq(suppliersTable.id, fixture.supplierId));
    }
    await endPool();
  });

  it("keeps submissions hidden, notifies admin, and publishes only approval", async () => {
    const [supplier] = await db
      .insert(suppliersTable)
      .values({
        name: `Smoke Vendor ${suffix}`,
        status: "active",
        isActive: true,
        isVerified: true,
        marketplaceStatus: "published",
      })
      .returning({ id: suppliersTable.id });
    if (!supplier) throw new Error("Smoke fixture supplier was not created");
    fixture.supplierId = supplier.id;

    const approvedToken = `smoke-approved-${suffix}`;
    await createLink(approvedToken);
    const approved = await submitProduct(approvedToken, approvedName);

    const [pendingItem] = await db
      .select({
        id: vendorCatalogItemsTable.id,
        status: vendorCatalogItemsTable.status,
        isPublished: vendorCatalogItemsTable.isPublished,
      })
      .from(vendorCatalogItemsTable)
      .where(eq(vendorCatalogItemsTable.id, approved.catalogItemId));
    expect(pendingItem).toMatchObject({
      status: "pending_review",
      isPublished: false,
    });

    const [adminNotification] = await db.execute(sql`
      SELECT id, type, payload
      FROM admin_notifications
      WHERE type = 'vendor_product_submitted'
        AND payload->>'catalogItemId' = ${String(approved.catalogItemId)}
      ORDER BY id DESC
      LIMIT 1
    `).then((result) => result.rows as Array<{ id: number; type: string; payload: { catalogItemId: number } }>);
    expect(adminNotification).toMatchObject({
      type: "vendor_product_submitted",
      payload: { catalogItemId: approved.catalogItemId },
    });

    const queue = await request(app)
      .get("/trading/catalog-engine/queue")
      .expect(200);
    expect(queue.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: approved.catalogItemId,
          status: "pending_review",
          sourceSubmissionId: approved.submissionId,
        }),
      ]),
    );

    const hiddenBeforeApproval = await listPublicMarketplaceItems({ q: approvedName });
    expect(hiddenBeforeApproval.some((item) => item.id === approved.catalogItemId)).toBe(false);

    await request(app)
      .post(`/trading/catalog-engine/submissions/${approved.submissionId}/approve`)
      .send({ reviewNotes: "Smoke approval" })
      .expect(200);

    const [publishedItem] = await db
      .select({
        status: vendorCatalogItemsTable.status,
        isPublished: vendorCatalogItemsTable.isPublished,
      })
      .from(vendorCatalogItemsTable)
      .where(eq(vendorCatalogItemsTable.id, approved.catalogItemId));
    expect(publishedItem).toMatchObject({
      status: "published",
      isPublished: true,
    });

    const visibleAfterApproval = await listPublicMarketplaceItems({ q: approvedName });
    expect(visibleAfterApproval.some((item) => item.id === approved.catalogItemId)).toBe(true);

    const rejectedToken = `smoke-rejected-${suffix}`;
    await createLink(rejectedToken);
    const rejected = await submitProduct(rejectedToken, rejectedName);

    await request(app)
      .post(`/trading/catalog-engine/submissions/${rejected.submissionId}/reject`)
      .send({ reviewNotes: "Smoke rejection" })
      .expect(200);

    const [rejectedItem] = await db
      .select({
        status: vendorCatalogItemsTable.status,
        isPublished: vendorCatalogItemsTable.isPublished,
      })
      .from(vendorCatalogItemsTable)
      .where(eq(vendorCatalogItemsTable.id, rejected.catalogItemId));
    expect(rejectedItem).toMatchObject({
      status: "rejected",
      isPublished: false,
    });

    const visibleAfterRejection = await listPublicMarketplaceItems({ q: rejectedName });
    expect(visibleAfterRejection.some((item) => item.id === rejected.catalogItemId)).toBe(false);
  });
});