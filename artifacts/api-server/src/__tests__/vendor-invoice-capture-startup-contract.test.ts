import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const apiIndex = readFileSync(resolve(process.cwd(), "src/index.ts"), "utf8");
const captureMigration = readFileSync(
  resolve(process.cwd(), "src/lib/vendorPaymentHardeningMigration.ts"),
  "utf8",
);

const VENDOR_INVOICE_OCR_COLUMNS = [
  "sap_lock_snapshot",
  "is_locked",
  "withholding_tax_amount",
  "invoice_breakdown",
  "tax_review_status",
  "tax_review_reason",
  "withholding_review_status",
  "withholding_review_completed_by",
  "withholding_review_completed_at",
  "withholding_tax_type",
  "tax_object",
] as const;

const VENDOR_INVOICE_LINE_OCR_COLUMNS = [
  "coa_hint",
  "coa_account_id",
  "coa_resolution_status",
  "coa_confirmed_by",
  "coa_confirmed_at",
  "coa_mapping_key",
] as const;

function alterTableBlock(tableName: string): string {
  const start = captureMigration.indexOf(`ALTER TABLE ${tableName}`);
  const end = captureMigration.indexOf("`);", start);

  expect(start, `${tableName} ALTER TABLE block`).toBeGreaterThan(-1);
  expect(end, `${tableName} ALTER TABLE block terminator`).toBeGreaterThan(start);

  return captureMigration.slice(start, end);
}

describe("Vendor Invoice capture startup contract", () => {
  it("runs the capture repair outside the completed legacy marker gate", () => {
    const registryReady = apiIndex.indexOf("markCoreDatabaseReady();");
    const captureSubstep = apiIndex.search(
      /await runPreStartSubstepWithRetry\(\s*"vendor_invoice_capture_schema_v1",\s*ensureVendorInvoiceCaptureSchema/,
    );
    const criticalPreStartStart = apiIndex.indexOf(
      "async function runCriticalPreStartMigrations()",
    );
    const criticalPreStartEnd = apiIndex.indexOf(
      "// Flag set to true once the full migration + seed chain completes.",
      criticalPreStartStart,
    );
    const criticalPreStartInvocation = apiIndex.indexOf(
      "await runCriticalPreStartMigrations();",
      captureSubstep,
    );
    const criticalPreStartBlock = apiIndex.slice(
      criticalPreStartStart,
      criticalPreStartEnd,
    );

    expect(registryReady).toBeGreaterThan(-1);
    expect(captureSubstep).toBeGreaterThan(registryReady);
    expect(captureSubstep).toBeGreaterThan(criticalPreStartEnd);
    expect(captureSubstep).toBeLessThan(criticalPreStartInvocation);
    expect(criticalPreStartBlock).toContain("if (preStartAlreadyComplete)");
    expect(criticalPreStartBlock).not.toContain(
      '"vendor_invoice_capture_schema_v1"',
    );
  });

  it("must complete the capture substep before readiness can become true", () => {
    const captureSubstep = apiIndex.indexOf(
      '"vendor_invoice_capture_schema_v1"',
    );
    const readinessCompletion = apiIndex.indexOf(
      "migrationsComplete = true;",
      captureSubstep,
    );

    expect(captureSubstep).toBeGreaterThan(-1);
    expect(readinessCompletion).toBeGreaterThan(captureSubstep);
  });

  it("repairs every Vendor Invoice OCR header column idempotently", () => {
    const block = alterTableBlock("vendor_invoices");

    for (const column of VENDOR_INVOICE_OCR_COLUMNS) {
      expect(block).toContain(`ADD COLUMN IF NOT EXISTS ${column}`);
    }
  });

  it("repairs every Vendor Invoice OCR line-resolution column idempotently", () => {
    const block = alterTableBlock("vendor_invoice_lines");

    for (const column of VENDOR_INVOICE_LINE_OCR_COLUMNS) {
      expect(block).toContain(`ADD COLUMN IF NOT EXISTS ${column}`);
    }
  });

  it("keeps the full hardening migration dependent on the same capture repair", () => {
    const hardeningStart = captureMigration.indexOf(
      "export async function runVendorPaymentHardeningMigration()",
    );
    const captureCall = captureMigration.indexOf(
      "await ensureVendorInvoiceCaptureSchema();",
      hardeningStart,
    );
    const lineTaxTable = captureMigration.indexOf(
      "CREATE TABLE IF NOT EXISTS vendor_invoice_line_taxes",
      hardeningStart,
    );

    expect(hardeningStart).toBeGreaterThan(-1);
    expect(captureCall).toBeGreaterThan(hardeningStart);
    expect(captureCall).toBeLessThan(lineTaxTable);
  });
});