import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from "react";
import { useSupabaseAuth } from "@/contexts/SupabaseAuthContext";

export interface Company {
  id: number;
  companyName: string;
  companyCode: string;
  logoUrl?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  npwp?: string | null;
  isActive: boolean;
  isHolding?: boolean;
}

// Sentinel ID for "All Companies (Consolidated)" mode.
// Must not clash with any real company id (positive integers starting from 1).
export const CONSOLIDATED_ID = 0;

export type CompanyScope = number | typeof CONSOLIDATED_ID | null;

interface CompanyContextValue {
  companies: Company[];
  activeCompany: Company | null;
  activeCompanyId: CompanyScope;
  /** Alias for activeCompanyId — same value */
  selectedCompanyId: CompanyScope;
  isConsolidated: boolean;
  setActiveCompany: (company: Company) => void;
  setConsolidated: () => void;
  setConsolidatedMode: () => void;
  isLoading: boolean;
  refetch: () => void;
  /** Query param string for API calls, e.g. "companyId=3" or "companyId=all" */
  companyQueryParam: string;
}

const CompanyContext = createContext<CompanyContextValue>({
  companies: [],
  activeCompany: null,
  activeCompanyId: null,
  selectedCompanyId: null,
  isConsolidated: false,
  setActiveCompany: () => {},
  setConsolidated: () => {},
  setConsolidatedMode: () => {},
  isLoading: false,
  refetch: () => {},
  companyQueryParam: "",
});

const STORAGE_KEY = "biz_active_company_id";
const CONSOLIDATED_STORAGE_VALUE = "all";

export function CompanyProvider({ children }: { children: React.ReactNode }) {
  const { isAuthenticated, isApiReady } = useSupabaseAuth();
  const [companies, setCompanies] = useState<Company[]>([]);

  const [activeCompanyId, setActiveCompanyIdState] = useState<CompanyScope>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === CONSOLIDATED_STORAGE_VALUE) return CONSOLIDATED_ID;
      return stored ? Number(stored) : null;
    } catch {
      return null;
    }
  });

  const [isLoading, setIsLoading] = useState(true);
  const fetchedRef = useRef(false);

  const fetchCompanies = useCallback(async () => {
    if (!isApiReady) return;

    try {
      const res = await fetch("/api/companies", { credentials: "include" });
      if (!res.ok) return;
      const data = (await res.json()) as Company[];
      setCompanies(data);
      if (data.length > 0 && activeCompanyId !== CONSOLIDATED_ID) {
        const storedRaw = (() => {
          try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
        })();
        if (storedRaw === CONSOLIDATED_STORAGE_VALUE) return;
        const storedId = storedRaw ? Number(storedRaw) : null;
        if (!data.find((c) => c.id === storedId)) {
          setActiveCompanyIdState(data[0].id);
        }
      }
    } catch {
      // silently ignore
    } finally {
      setIsLoading(false);
    }
  }, [activeCompanyId, isApiReady]);

  useEffect(() => {
    if (isAuthenticated) { fetchedRef.current = false; }
  }, [isAuthenticated]);

  useEffect(() => {
    if (isAuthenticated && isApiReady && !fetchedRef.current) {
      fetchedRef.current = true;
      void fetchCompanies();
    } else if (!isAuthenticated) {
      setIsLoading(false);
    }
  }, [isAuthenticated, isApiReady, fetchCompanies]);

  const setActiveCompany = useCallback((company: Company) => {
    setActiveCompanyIdState(company.id);
    try { localStorage.setItem(STORAGE_KEY, String(company.id)); } catch {}
  }, []);

  const setConsolidated = useCallback(() => {
    setActiveCompanyIdState(CONSOLIDATED_ID);
    try { localStorage.setItem(STORAGE_KEY, CONSOLIDATED_STORAGE_VALUE); } catch {}
  }, []);

  const setConsolidatedMode = setConsolidated;

  const isConsolidated = activeCompanyId === CONSOLIDATED_ID;
  const activeCompany = isConsolidated
    ? null
    : (companies.find((c) => c.id === activeCompanyId) ?? companies[0] ?? null);

  const resolvedId: CompanyScope = isConsolidated
    ? CONSOLIDATED_ID
    : (activeCompany?.id ?? activeCompanyId);

  const companyQueryParam = isConsolidated
    ? "companyId=all"
    : resolvedId != null
      ? `companyId=${resolvedId}`
      : "";

  return (
    <CompanyContext.Provider
      value={{
        companies,
        activeCompany,
        activeCompanyId: resolvedId,
        selectedCompanyId: resolvedId,
        isConsolidated,
        setActiveCompany,
        setConsolidated,
        setConsolidatedMode,
        isLoading,
        refetch: fetchCompanies,
        companyQueryParam,
      }}
    >
      {children}
    </CompanyContext.Provider>
  );
}

export function useCompany() {
  return useContext(CompanyContext);
}

/** @deprecated Use companyQueryParam from useCompany() instead */
export function useCompanyQuery() {
  const { companyQueryParam } = useCompany();
  return companyQueryParam;
}
