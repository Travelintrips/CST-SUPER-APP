import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("wouter", () => ({
  Link: ({ children, ...props }: any) => React.createElement("a", props, children),
  useSearch: () => "",
}));

vi.mock("@/contexts/CompanyContext", () => ({
  useCompany: () => ({
    companies: [{ id: 1, companyName: "PT Contoh", companyCode: "CONTOH" }],
    activeCompany: { id: 1, companyName: "PT Contoh", companyCode: "CONTOH" },
    activeCompanyId: 1,
    isConsolidated: false,
    isLoading: false,
  }),
}));

import AccountingHubGLPage from "@/pages/accounting/hub/general-ledger";

const bankPaymentRow = {
  line_id: 101,
  entry_id: 201,
  entry_number: "JRNL-201",
  company_id: 1,
  branch_id: null,
  division_id: null,
  date: "2026-09-12",
  source_module: "bank_reconciliation",
  source_schema: "public",
  source_table: "accounting_entries",
  source_id: 301,
  ref: "BANK-301",
  entry_description: "Pembayaran vendor melalui rekonsiliasi bank",
  line_description: null,
  status: "posted",
  journal_name: "Bank Reconciliation",
  journal_type: "general",
  account_id: 401,
  account_code: "1-1001",
  account_name: "Bank",
  account_type: "asset",
  normal_balance: "DEBIT",
  debit: "100000",
  credit: "0",
  created_at: "2026-09-12T10:00:00.000Z",
  posted_at: "2026-09-12T10:00:00.000Z",
  partner_name: "Vendor Contoh",
  source_doc_number: "VP-301",
  payment_method: "bank",
  running_balance: "900000",
  account_opening_balance: "800000",
};

const ledgerResponse = {
  data: [bankPaymentRow],
  total: 1,
  openingBalance: 800000,
  closingBalance: 900000,
  totalDebit: 100000,
  totalCredit: 0,
};

describe("Buku Besar bank payment filters", () => {
  const requests: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    requests.push(String(input));
    return {
      ok: true,
      status: 200,
      json: async () => ledgerResponse,
      text: async () => "",
    } as Response;
  });

  beforeEach(() => {
    requests.length = 0;
    fetchMock.mockClear();
    localStorage.clear();
    Element.prototype.scrollIntoView = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("submits Rekonsiliasi Bank and Transfer Bank filters while preserving payment amounts", async () => {
    render(<AccountingHubGLPage />);

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const rowBeforeFiltering = screen.getAllByRole("row")[1].textContent;

    fireEvent.click(screen.getByTestId("select-gl-source-module"));
    fireEvent.click(await screen.findByRole("option", { name: "Rekonsiliasi Bank" }));
    fireEvent.click(screen.getByTestId("select-gl-payment-method"));
    fireEvent.click(await screen.findByRole("option", { name: "Transfer Bank" }));
    fireEvent.click(screen.getByRole("button", { name: "Terapkan" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const filteredRequest = new URL(requests[requests.length - 1], "http://localhost");
    expect(filteredRequest.searchParams.get("source_module")).toBe("bank_reconciliation");
    expect(filteredRequest.searchParams.get("payment_method")).toBe("bank");

    await waitFor(() => expect(screen.getAllByRole("row")[1].textContent).toContain("Transfer Bank"));
    const rowAfterFiltering = screen.getAllByRole("row")[1].textContent;
    expect(rowAfterFiltering).toBe(rowBeforeFiltering);
    expect(rowAfterFiltering).toContain("100.000");
    expect(rowAfterFiltering).toContain("Rp 900.000");
  });
});