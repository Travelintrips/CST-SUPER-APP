/**
 * Regression tests for the account selected when a bank mutation is approved.
 *
 * These tests exercise the resolver without creating journals or touching a
 * database. Posting/lifecycle behavior is covered by the reconciliation
 * hardening suite.
 */

import { describe, expect, it, vi } from "vitest";

vi.mock("@workspace/db", () => ({
  db: {},
  RECONCILIATION_CANDIDATE_SOURCES: {
    LEGACY_QRIS: "public.qris_settlements",
    CANONICAL_SPORT_CENTER: "sport_center.payment_settlement_batches",
  },
}));

vi.mock("drizzle-orm", () => ({
  sql: {
    raw: (query: string) => ({ query }),
  },
}));

vi.mock("../lib/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock("../lib/financial/failedJobSystem.js", () => ({
  captureFailedJob: vi.fn(),
}));

vi.mock("../lib/expenseClassificationService.js", () => ({
  classifyMutationDescription: vi.fn(),
  persistClassification: vi.fn(),
}));

vi.mock("../lib/accounting.js", () => ({
  postEntryWithClient: vi.fn(),
}));

import { resolveContraAccount } from "../lib/reconciliation/unifiedMatchingEngine.js";

function mockClient(coaId = 5301) {
  return {
    execute: vi.fn(async (statement: { query?: string }) => {
      const query = statement.query ?? "";
      if (query.includes("FROM chart_of_accounts")) {
        return { rows: [{ id: coaId }] };
      }
      return { rows: [] };
    }),
  } as any;
}

const baseArgs = {
  companyId: 42,
  bankAccountId: 7,
  candidateId: null,
  candidateType: null,
  description: "mutasi bank",
  expenseCategory: null,
  expenseSubtype: null,
  settings: {
    ar_account_id: 1201,
    ap_account_id: 2101,
    purchase_expense_account_id: 5204,
  },
};

describe("bank reconciliation contra-account mapping", () => {
  it("maps bank administration fees to 5-3010 expense, never AP", async () => {
    const result = await resolveContraAccount(mockClient(5310), {
      ...baseArgs,
      direction: "OUT",
      description: "BIAYA ADMINISTRASI BANK BULANAN",
      expenseCategory: "bank_fee",
    });

    expect(result).toEqual({
      accountId: 5310,
      label: "Beban Bunga & Administrasi Bank",
      treatment: "expense",
    });
    expect(result?.treatment).not.toBe("ap");
  });

  it("maps generic 'expense' category to purchase_expense_account_id from settings (fail-closed fallback)", async () => {
    // Domain contract: generic "expense" category falls back to settings.purchase_expense_account_id
    // rather than returning null, so that explicitly-labelled expense outflows do not block
    // approval when the company has configured a default expense account.
    // Unknown categories with NO configured account still return null (JOURNAL_MAPPING_REQUIRED).
    const result = await resolveContraAccount(mockClient(5204), {
      ...baseArgs,
      direction: "OUT",
      description: "Pembelian perlengkapan kantor",
      expenseCategory: "expense",
    });

    expect(result).toEqual({ accountId: 5204, label: "Beban", treatment: "expense" });
  });

  it("maps a selected accounting payment to AP", async () => {
    const result = await resolveContraAccount(mockClient(), {
      ...baseArgs,
      direction: "OUT",
      candidateType: "accounting_payment",
      candidateId: 901,
      description: "Pembayaran vendor",
    });

    expect(result).toEqual({
      accountId: 2101,
      label: "Hutang Usaha",
      treatment: "ap",
    });
  });

  it("maps an inbound invoice/customer receipt to AR", async () => {
    const result = await resolveContraAccount(mockClient(), {
      ...baseArgs,
      direction: "IN",
      candidateType: "invoice",
      candidateId: 902,
      description: "Pembayaran invoice pelanggan",
    });

    expect(result).toEqual({
      accountId: 1201,
      label: "Piutang Usaha",
      treatment: "ar",
    });
  });

  it("maps an inbound sport payment to Sport Center revenue", async () => {
    const result = await resolveContraAccount(mockClient(41017), {
      ...baseArgs,
      direction: "IN",
      candidateType: "sport_payment",
      candidateId: 903,
      description: "Pembayaran booking lapangan",
    });

    expect(result).toEqual({
      accountId: 41017,
      label: "Pendapatan Booking Sport Center",
      treatment: "revenue",
    });
  });

  it("maps inbound bank interest (jasa giro / bunga tabungan) to Pendapatan Bunga, NOT Piutang Usaha", async () => {
    // Regression: before this fix, any IN that wasn't sport_payment fell through
    // to AR (Piutang Usaha 1-1030). Interest income must go to 4-2010.
    const descriptions = [
      "JASA GIRO BLN JULI 2025",
      "BUNGA TABUNGAN",
      "KREDIT BUNGA",
      "interest income jul",
      "pendapatan bunga",
    ];

    for (const description of descriptions) {
      const result = await resolveContraAccount(mockClient(42010), {
        ...baseArgs,
        direction: "IN",
        candidateType: null,
        candidateId: null,
        description,
      });

      expect(result, `description "${description}" should map to Pendapatan Bunga`).toEqual({
        accountId: 42010,
        label: "Pendapatan Bunga",
        treatment: "revenue",
      });
      expect(result?.treatment, `"${description}" must NOT be AR`).not.toBe("ar");
    }
  });

  it("uses the selected candidate type instead of a generic OUT fallback", async () => {
    const client = mockClient(5310);
    const result = await resolveContraAccount(client, {
      ...baseArgs,
      direction: "OUT",
      candidateType: "accounting_payments",
      candidateId: 904,
      description: "ADMIN BANK",
      expenseCategory: "bank_fee",
    });

    expect(result?.treatment).toBe("ap");
    expect(result?.accountId).toBe(2101);
    expect(client.execute).not.toHaveBeenCalled();
  });
});