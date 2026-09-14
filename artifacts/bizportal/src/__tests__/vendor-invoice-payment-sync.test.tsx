import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("wouter", () => ({
  useLocation: () => ["/purchase/vendor-invoices/42", vi.fn()],
  useParams: () => ({ id: "42" }),
  useSearch: () => "",
  Link: ({ children, ...props }: React.ComponentProps<"a">) => React.createElement("a", props, children),
}));

vi.mock("@/components/layout/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock("@/contexts/CompanyContext", () => ({
  useCompany: () => ({
    activeCompanyId: 1,
    activeCompany: { id: 1, companyName: "PT Contoh", companyCode: "CONTOH" },
    companies: [{ id: 1, companyName: "PT Contoh", companyCode: "CONTOH" }],
    isConsolidated: false,
    isLoading: false,
  }),
}));

import { VendorInvoiceEditorPage } from "@/pages/purchase/vendor-invoices";

const postedInvoice = {
  id: 42,
  invoiceNumber: "INV-042",
  status: "posted",
  supplierName: "Vendor Contoh",
  vendorInvoiceRef: "VENDOR-042",
  invoiceDate: "2026-09-12",
  dueDate: "2026-10-12",
  paymentTermDays: 30,
  totalAmount: "100000",
  taxAmount: "0",
  grandTotal: "100000",
  amountPaid: "100000",
  journalStatus: "posted",
  journalEntryNumber: "JRNL-042",
  threeWayMatchStatus: "matched",
  lines: [{
    id: 4201,
    name: "Jasa",
    quantity: "1",
    unit: "lot",
    unitCost: "100000",
    subtotal: "100000",
    taxAmount: "0",
    notes: "",
  }],
  lineTaxes: [],
  withholdingRecords: [],
};

describe("Vendor invoice payment synchronization", () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (url.includes("/liability-accounts")) {
        return {
          ok: true,
          json: async () => [],
        } as Response;
      }

      if (init?.method === "POST" && url.includes("/recalculate-payment-status")) {
        return {
          ok: true,
          json: async () => ({
            paymentStatus: {
              status: "paid",
              amountPaid: 100000,
              withholdingComplete: true,
            },
          }),
        } as Response;
      }

      return {
        ok: true,
        json: async () => ({
          ...postedInvoice,
          status: fetchMock.mock.calls.filter(([request]) =>
            String(request).includes("/purchase-workflow/vendor-invoices/42"),
          ).length > 1 ? "paid" : "posted",
        }),
      } as Response;
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps sync available for a fully paid posted invoice and updates status after sync", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <VendorInvoiceEditorPage />
      </QueryClientProvider>,
    );

    const syncButton = await screen.findByRole("button", { name: "Sinkronkan Rekonsiliasi" });
    expect(screen.getByText("posted", { exact: true })).toBeTruthy();

    fireEvent.click(syncButton);

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/purchase-workflow/vendor-invoices/42/recalculate-payment-status?company=1",
        expect.objectContaining({ method: "POST" }),
      );
    });
    await waitFor(() => {
      expect(screen.getByText("paid", { exact: true })).toBeTruthy();
      expect(screen.queryByRole("button", { name: "Sinkronkan Rekonsiliasi" })).toBeNull();
    });
  });
});