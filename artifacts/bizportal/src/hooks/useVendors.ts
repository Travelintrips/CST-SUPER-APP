import { useQuery } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import type { Supplier } from "@workspace/api-client-react";

/**
 * Fetch vendors filtered by active company via vendor_company_assignments.
 * - Global vendors (no assignments) always appear.
 * - Assigned vendors only appear for matching companies.
 * - Admin in "consolidated" mode gets all vendors (companyId=all).
 */
export function useVendors() {
  const { companyQueryParam } = useCompany();
  return useQuery<Supplier[]>({
    queryKey: ["vendors-filtered", companyQueryParam],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/trading/suppliers?${companyQueryParam}&limit=1000`, {
        credentials: "include",
        signal,
      });
      if (!res.ok) throw new Error("Failed to fetch vendors");
      const json = await res.json();
      // Endpoint returns paginated envelope { success, data, pagination }
      // Fall back to plain array for any legacy response shape
      return (Array.isArray(json) ? json : (json?.data ?? [])) as Supplier[];
    },
    staleTime: 30_000,
  });
}
