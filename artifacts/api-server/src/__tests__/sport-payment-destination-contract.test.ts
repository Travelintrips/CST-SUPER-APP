import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(process.cwd(), "src/modules/sport-center/supabaseSync.ts"),
  "utf8",
);

const start = source.indexOf("export async function syncPaymentsToAccounting");
const end = source.indexOf("\n/*", start);
const activeSync = source.slice(start, end > start ? end : undefined);

describe("Sport Center canonical payment destination contract", () => {
  it("resolves destination from the normalized payment method", () => {
    expect(activeSync).toContain("resolvePaymentDestination(paymentMethod");
    expect(activeSync).toContain("defaultCashAccountId");
    expect(activeSync).toContain("defaultBankAccountId");
    expect(activeSync).toContain("qrisAccountId");
    expect(activeSync).toContain("destinationAccountId");
    expect(activeSync).toContain("destinationJournalId");
    expect(activeSync).toContain("destinationJournalCode");
  });

  it("maps bank transfers to the exact configured external bank account", () => {
    expect(activeSync).toContain('paymentMethod === "transfer"');
    expect(activeSync).toContain("cba.account_number::text = ${externalBankAccountId}");
    expect(activeSync).toContain("CANONICAL_PAYMENT_BANK_ACCOUNT_UNRESOLVED");
    expect(activeSync).toContain("accountId: destinationAccountId");
    expect(activeSync).toContain("journalId: destinationJournalId");
  });

  it("keeps QRIS and cash destination policy distinct from transfer bank", () => {
    expect(activeSync).toContain("qrisAccountId");
    expect(activeSync).toContain("cashJournalId");
    expect(activeSync).toContain("bankJournalId");
    expect(activeSync).toContain("destinationJournalCode");
  });

  it("fails closed instead of inventing a payment destination", () => {
    expect(activeSync).toContain("CANONICAL_PAYMENT_METHOD_UNRESOLVED");
    expect(activeSync).toContain("CANONICAL_PAYMENT_DESTINATION_UNRESOLVED");
    expect(activeSync).toContain("bankMapping.rows.length !== 1");
  });
});
