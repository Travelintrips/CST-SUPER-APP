import { useState, useEffect, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";

const LS_KEY = "sport_center_cost_center";

export interface CostCenter {
  id: number;
  code: string;
  name: string;
  isActive: boolean;
  companyId: number | null;
}

export function useSportCostCenter() {
  const [selectedId, setSelectedIdState] = useState<number | null>(() => {
    try {
      const v = localStorage.getItem(LS_KEY);
      return v ? Number(v) : null;
    } catch {
      return null;
    }
  });

  const setSelectedId = useCallback((id: number | null) => {
    setSelectedIdState(id);
    try {
      if (id == null) localStorage.removeItem(LS_KEY);
      else localStorage.setItem(LS_KEY, String(id));
    } catch { /* ignore */ }
  }, []);

  const { data: costCenters = [] } = useQuery<CostCenter[]>({
    queryKey: ["cost-centers-list"],
    queryFn: async () => {
      const r = await fetch("/api/accounting/cost-centers", { credentials: "include" });
      if (!r.ok) throw new Error("Gagal memuat cost centers");
      return r.json();
    },
    staleTime: 5 * 60 * 1000,
  });

  // Jika cost center yang disimpan sudah tidak ada, reset
  useEffect(() => {
    if (selectedId != null && costCenters.length > 0) {
      const exists = costCenters.some(cc => cc.id === selectedId);
      if (!exists) setSelectedId(null);
    }
  }, [costCenters, selectedId, setSelectedId]);

  const selectedLabel = selectedId
    ? (costCenters.find(cc => cc.id === selectedId)?.name ?? "—")
    : "Semua Cost Center";

  return { costCenters, selectedId, setSelectedId, selectedLabel };
}
