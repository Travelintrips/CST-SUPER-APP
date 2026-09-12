import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const portalSource = readFileSync(new URL("../routes/portal.ts", import.meta.url), "utf8");
const logisticSource = readFileSync(new URL("../routes/logisticOrders.ts", import.meta.url), "utf8");
const proofSource = readFileSync(new URL("../routes/paymentProof.ts", import.meta.url), "utf8");
const appSource = readFileSync(
  new URL("../../../customer-portal/src/App.tsx", import.meta.url),
  "utf8",
);

function routeBlock(source: string, startMarker: string, endMarker: string): string {
  const start = source.indexOf(startMarker);
  const end = source.indexOf(endMarker, start);
  expect(start, `missing route marker: ${startMarker}`).toBeGreaterThanOrEqual(0);
  expect(end, `missing route end marker: ${endMarker}`).toBeGreaterThan(start);
  return source.slice(start, end);
}

describe("Customer Portal P0 security contracts", () => {
  it.each([
    [
      'router.get("/me/invoices/:id"',
      'router.get("/me/invoices/:id/download"',
    ],
    [
      'router.get("/me/invoices/:id/download"',
      'router.get("/me/invoices/:id/payment-proof"',
    ],
    [
      'router.get("/me/invoices/:id/payment-proof"',
      'router.get("/me/invoices/:id/payment-proof/file"',
    ],
    [
      'router.get("/me/invoices/:id/payment-proof/file"',
      '// ── GET /api/portal/vendor-catalog/compare',
    ],
  ])("guards invoice operation %s with canonical ownership", (start, end) => {
    const route = routeBlock(portalSource, start, end);
    expect(route).toContain("requireCustomerPortalAuth");
    expect(route).toContain("portal_customer_id = ${customerId}");
    expect(route).toContain("pcm.portal_customer_id = ${customerId}");
    expect(route).toContain("pcm.is_active = TRUE");
    expect(route).not.toContain("customer_name");
    expect(route).not.toContain("invoice_number = ${");
  });

  it("keeps invoice and proof downloads private and fail-closed for legacy URLs", () => {
    const downloadRoute = routeBlock(
      portalSource,
      'router.get("/me/invoices/:id/download"',
      'router.get("/me/invoices/:id/payment-proof"',
    );
    const proofFileRoute = routeBlock(
      portalSource,
      'router.get("/me/invoices/:id/payment-proof/file"',
      '// ── GET /api/portal/vendor-catalog/compare',
    );

    expect(downloadRoute).toContain("getSignedUrl(storedPath, 300)");
    expect(downloadRoute).toContain("PDF invoice legacy belum tersedia");
    expect(proofFileRoute).toContain("getSignedUrl(storedPath, 300)");
    expect(proofFileRoute).toContain("Bukti pembayaran legacy belum tersedia");
    expect(proofFileRoute).not.toContain("res.json({ proofUrl");
  });

  it("guards customer payment initiation and proof mutation by portal customer id", () => {
    const paymentRoute = routeBlock(
      logisticSource,
      'logisticOrdersRouter.post("/:orderNumber/create-paylabs-link"',
      'logisticOrdersRouter.patch("/:orderNumber/payment-proof"',
    );
    const proofMutationRoute = routeBlock(
      logisticSource,
      'logisticOrdersRouter.patch("/:orderNumber/payment-proof"',
      "// ─── AUTH WALL:",
    );

    expect(paymentRoute).toContain("requireCustomerPortalAuth");
    expect(paymentRoute).toContain("eq(logisticOrdersTable.portalCustomerId");
    expect(proofMutationRoute).toContain("requireCustomerPortalAuth");
    expect(proofMutationRoute).toContain("eq(logisticOrdersTable.portalCustomerId");
    expect(proofMutationRoute).toContain("UPDATE logistic_orders");
  });

  it("keeps tokenized proof upload separate from private file readback", () => {
    const tokenRoute = routeBlock(
      proofSource,
      'router.get("/:token"',
      'router.post("/:token/upload"',
    );
    const uploadRoute = routeBlock(
      proofSource,
      'router.post("/:token/upload"',
      '// ─── ADMIN: GET /api/payment-proof/file/:documentId',
    );
    const fileRoute = proofSource.slice(
      proofSource.indexOf('// ─── ADMIN: GET /api/payment-proof/file/:documentId'),
    );

    expect(tokenRoute).toContain('/^[a-f0-9]{48}$/');
    expect(tokenRoute).toContain("proof_upload_token_expires_at");
    expect(tokenRoute).toContain("proofUrl = proofUrlRaw ? `/api/payment-proof/file/${docId}` : null");
    expect(uploadRoute).toContain("uploadPrivateEntity");
    expect(uploadRoute).toContain("proof_url IS NULL");
    expect(fileRoute).toContain("if (!(await requireAdmin(req, res))) return");
    expect(fileRoute).toContain("getSignedUrl");
  });

  it("keeps legacy admin pages behind the canonical admin guard", () => {
    expect(appSource).toContain('ProtectedRoute component={LogisticAdmin} adminOnly');
    expect(appSource).toContain('ProtectedRoute component={LogisticAdminOrderDetail} adminOnly');
  });
});