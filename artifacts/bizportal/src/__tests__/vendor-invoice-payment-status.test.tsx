import React from "react";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("wouter", () => ({
  Link: ({ children, ...props }: any) => React.createElement("a", props, children),
  useLocation: () => ["/purchase/vendor-invoices/64", vi.fn()],
  useParams: () => ({ id: "64" }),
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

vi.mock("@/components/layout/AppShell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("sonner", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
  },
}));

import { VendorInvoiceEditorPage } from "@/pages/purchase/vendor-invoices";

const postedFullyPaidInvoice = {
  id: 64,
  invoiceNumber: "VI/2026/00064",
  status: "posted",
  supplierName: "PT. ANGKASA PURA INDONESIA",
  vendorInvoiceRef: "AP-00064",
  invoiceDate: "2026-09-11T00:00:00.000Z",
  paymentTermDays: 30,
  totalAmount: "26852296",
  taxAmount: "0",
  grandTotal: "26852296",
  amountPaid: "26852296",
  journalStatus: "posted",
  threeWayMatchStatus: "unmatched",
  lines: [],
  lineTaxes: [],
  withholdingRecords: [],
};

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("vendor invoice payment status", () => {
  let detailReads = 0;
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    detailReads = 0;
    fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = String(input);
      const method = init?.method ?? "GET";

      if (path.includes("/vendor-invoices/64/recalculate-payment-status") && method === "POST") {
        return response({
          ok: true,
          invoiceId: 64,
          paymentStatus: {
            status: "paid",
            amountPaid: 26852296,
            withholdingComplete: true,
          },
        });
      }

      if (path.includes("/vendor-invoices/64") && method === "GET") {
        detailReads += 1;
        return response({
          ...postedFullyPaidInvoice,
          status: detailReads === 1 ? "posted" : "paid",
        });
      }

      if (path.includes("/vendor-invoices/liability-accounts") && method === "GET") {
        return response([]);
      }

      throw new Error(`Unexpected request: ${method} ${path}`);
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("keeps sync available when the invoice is fully paid but status is still posted", async () => {
    const queryClient = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false },
      },
    });

    render(
      <QueryClientProvider client={queryClient}>
        <VendorInvoiceEditorPage />
      </QueryClientProvider>,
    );

    expect(await screen.findByRole("button", { name: "Sinkronkan Rekonsiliasi" })).toBeTruthy();
    expect(screen.getByText("posted")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Sinkronkan Rekonsiliasi" }));

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        "/api/purchase-workflow/vendor-invoices/64/recalculate-payment-status?company=1",
        expect.objectContaining({ method: "POST" }),
      );
    });
    await waitFor(() => expect(screen.getByText("paid")).toBeTruthy());
    expect(detailReads).toBeGreaterThanOrEqual(2);
  });
});