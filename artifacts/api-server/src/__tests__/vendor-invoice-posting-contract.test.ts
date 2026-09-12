import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const paymentStatusSource = readFileSync(
  new URL("../lib/vendorInvoicePaymentStatus.ts", import.meta.url),
  "utf8",
);
const reconciliationSource = readFileSync(
  new URL("../routes/bankReconciliation.ts", import.meta.url),
  "utf8",
);

describe("vendor invoice payment posting contract", () => {
  it("only treats a posted accounting journal as gross-settlement evidence", () => {
    expect(paymentStatusSource).toContain("ae.status = 'posted'");
    expect(paymentStatusSource).toContain("bm.status::text IN ('posted', 'reconciled')");
    expect(paymentStatusSource).not.toContain(
      "bm.status::text IN ('approved_pending_posting', 'approved', 'posted', 'reconciled', 'matched')",
    );
  });

  it("defers invoice amount_paid until the linked bank journal is posted", () => {
    const approvalBlock = reconciliationSource.slice(
      reconciliationSource.indexOf('"/:mutationId/vendor-invoice-payment-batch"'),
      reconciliationSource.indexOf('router.get(\n  "/:mutationId/vendor-invoice-candidates"'),
    );
    expect(approvalBlock).toContain("amount_paid_before");
    expect(approvalBlock).toContain('postEntryWithClient(');
    expect(approvalBlock).not.toContain("SET amount_paid = ${String(newPaid)}");
    expect(reconciliationSource).toContain("applyPostedVendorInvoiceBatchPayment(");
  });

  it("makes the post-side invoice update monotonic and company-scoped", () => {
    expect(reconciliationSource).toContain("const nextAmountPaid = Math.max(currentAmountPaid, targetAmountPaid);");
    expect(reconciliationSource).toContain("WHERE id = ${invoiceId}");
    expect(reconciliationSource).toContain("AND company_id = ${companyId}");
  });
});