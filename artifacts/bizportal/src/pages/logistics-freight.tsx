import { DatePicker } from "@/components/ui/date-picker";
import { useState, useEffect, useCallback, useRef } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { useOrderNotificationsContext } from "@/contexts/OrderNotificationsContext";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, RefreshCw, Ship, Trash2, Eye, Filter, X, Clock, ShoppingCart, TrendingUp, TrendingDown, ChevronLeft, ChevronRight, Search } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";
import {
  useListFreightShipments,
  useDeleteFreightShipment,
  getListFreightShipmentsQueryKey,
  useListSalesDocuments,
  getGetFreightShipmentQueryOptions,
  type FreightShipment,
} from "@workspace/api-client-react";
import { usePrefetchOnHover } from "@/hooks/use-prefetch-on-hover";

const STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  rfq_sent: "RFQ Dikirim",
  confirmed: "Dikonfirmasi",
  in_transit: "Dalam Perjalanan",
  completed: "Selesai",
  cancelled: "Dibatalkan",
};

const STATUS_COLORS: Record<string, string> = {
  draft: "bg-muted text-muted-foreground",
  rfq_sent: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  confirmed: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  in_transit: "bg-indigo-500/10 text-indigo-500 border-indigo-500/20",
  completed: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  cancelled: "bg-destructive/10 text-destructive border-destructive/20",
};

const ACTIVE_STATUSES = ["draft", "rfq_sent", "confirmed", "in_transit"];

const BL_ELIGIBLE_STATUSES = ["confirmed", "in_transit", "completed"];

function hasBLData(s: FreightShipment): boolean {
  if (!BL_ELIGIBLE_STATUSES.includes(s.status)) return false;
  return !!(s.vessel || s.voyage || s.portOfLoading || s.portOfDischarge || s.notifyParty || s.marksAndNumbers || s.measurement);
}

function idr(value: string | number | null | undefined): string {
  if (value == null) return "—";
  const n = typeof value === "string" ? parseFloat(value) : value;
  if (isNaN(n)) return "—";
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);
}

function CostBadge({ actualCost, approvedQuoteCost }: { actualCost?: string | null; approvedQuoteCost?: string | null }) {
  const actual = actualCost ? parseFloat(actualCost) : null;
  const quoted = approvedQuoteCost ? parseFloat(approvedQuoteCost) : null;
  if (actual === null && quoted === null) return null;
  if (actual !== null && quoted !== null) {
    const over = actual > quoted;
    const pct = quoted !== 0 ? Math.abs(((actual - quoted) / quoted) * 100) : null;
    return (
      <div className={`inline-flex flex-col gap-0.5 text-xs rounded px-1.5 py-1 border ${over ? "bg-red-500/5 border-red-500/20" : "bg-emerald-500/5 border-emerald-500/20"}`}>
        <span className="text-muted-foreground leading-none">Kuota: {idr(quoted)}</span>
        <span className={`flex items-center gap-0.5 font-medium leading-none ${over ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
          {over ? <TrendingUp className="h-3 w-3 shrink-0" /> : <TrendingDown className="h-3 w-3 shrink-0" />}
          {idr(actual)}{pct !== null && <span className="opacity-70 ml-0.5">({pct.toFixed(0)}%{over ? " ↑" : " ↓"})</span>}
        </span>
      </div>
    );
  }
  if (actual !== null) {
    return <span className="text-xs text-muted-foreground">Aktual: {idr(actual)}</span>;
  }
  return <span className="text-xs text-muted-foreground">Kuota: {idr(quoted)}</span>;
}

function ExpenseBadge({ totalExpenses, actualCost, approvedQuoteCost }: { totalExpenses?: string | null; actualCost?: string | null; approvedQuoteCost?: string | null }) {
  const expenses = totalExpenses ? parseFloat(totalExpenses) : null;
  if (expenses === null || expenses === 0) return null;
  const actual = actualCost ? parseFloat(actualCost) : null;
  const quoted = approvedQuoteCost ? parseFloat(approvedQuoteCost) : null;
  const baseline = actual ?? quoted;
  const baselineLabel = actual !== null ? "Aktual" : "Kuota";
  if (baseline === null) return null;
  const over = expenses > baseline;
  const pct = baseline !== 0 ? Math.abs(((expenses - baseline) / baseline) * 100) : null;
  return (
    <div className={`inline-flex flex-col gap-0.5 text-xs rounded px-1.5 py-1 border mt-1 ${over ? "bg-red-500/5 border-red-500/20" : "bg-emerald-500/5 border-emerald-500/20"}`}>
      <span className="text-muted-foreground leading-none">Biaya Op. vs {baselineLabel}</span>
      <span className={`flex items-center gap-0.5 font-medium leading-none ${over ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"}`}>
        {over ? <TrendingUp className="h-3 w-3 shrink-0" /> : <TrendingDown className="h-3 w-3 shrink-0" />}
        {idr(expenses)}{pct !== null && <span className="opacity-70 ml-0.5">({pct.toFixed(0)}%{over ? " ↑" : " ↓"})</span>}
      </span>
    </div>
  );
}

const FREIGHT_REFRESH_INTERVALS = [
  { label: "30 detik", value: "30" },
  { label: "1 menit", value: "60" },
  { label: "5 menit", value: "300" },
  { label: "Mati", value: "off" },
] as const;

type FreightRefreshValue = "30" | "60" | "300" | "off";

const FREIGHT_REFRESH_LS_KEY = "freight-refresh-interval";
const FREIGHT_DATE_LS_KEY = "freight-date-filter";
const FREIGHT_STATUS_LS_KEY = "freight-status-filter";
const FREIGHT_BL_LS_KEY = "freight_blReadyFilter";

function getInitialRefreshInterval(): FreightRefreshValue {
  try {
    const stored = localStorage.getItem(FREIGHT_REFRESH_LS_KEY);
    if (stored === "30" || stored === "60" || stored === "300" || stored === "off") {
      return stored;
    }
  } catch {}
  return "60";
}

function loadDateFromStorage(): { preset: DatePreset; from: string; to: string } {
  try {
    const raw = localStorage.getItem(FREIGHT_DATE_LS_KEY);
    if (!raw) return { preset: "all", from: "", to: "" };
    const data = JSON.parse(raw) as Record<string, unknown>;
    const preset = DATE_PRESETS.includes(data.preset as DatePreset) ? (data.preset as DatePreset) : "all";
    return {
      preset,
      from: typeof data.from === "string" ? data.from : "",
      to: typeof data.to === "string" ? data.to : "",
    };
  } catch {
    return { preset: "all", from: "", to: "" };
  }
}

function refetchIntervalMs(value: FreightRefreshValue): number | false {
  if (value === "off") return false;
  return parseInt(value, 10) * 1000;
}

const STATUS_FILTERS: { value: string | null; label: string }[] = [
  { value: null, label: "Semua" },
  { value: "active", label: "Aktif" },
  { value: "draft", label: "Draft" },
  { value: "rfq_sent", label: "RFQ Dikirim" },
  { value: "confirmed", label: "Dikonfirmasi" },
  { value: "in_transit", label: "Dalam Perjalanan" },
  { value: "completed", label: "Selesai" },
  { value: "cancelled", label: "Dibatalkan" },
];

type DatePreset = "all" | "7days" | "30days" | "custom";

const DATE_PRESETS: DatePreset[] = ["all", "7days", "30days", "custom"];

function parseParamsFromSearch(search: string) {
  const p = new URLSearchParams(search);
  const rawDate = p.get("date") ?? "";
  const from = p.get("from") ?? "";
  const to = p.get("to") ?? "";
  let preset: DatePreset = DATE_PRESETS.includes(rawDate as DatePreset)
    ? (rawDate as DatePreset)
    : "all";
  if (preset === "all" && (from || to)) {
    preset = "custom";
  }
  return {
    status: p.get("status") ?? null,
    bl: p.get("bl") === "1",
    preset,
    from,
    to,
  };
}

export default function LogisticsFreightPage() {
  const queryClient = useQueryClient();
  const prefetchHover = usePrefetchOnHover();
  const { toast } = useToast();
  const { t } = useLanguage();
  const [location, navigate] = useLocation();
  const [refreshInterval, setRefreshInterval] = useState<FreightRefreshValue>(getInitialRefreshInterval);
  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const [autoRefreshFlash, setAutoRefreshFlash] = useState(false);
  const wasFetchingRef = useRef(false);
  const { lastFreightEventAt } = useOrderNotificationsContext();

  const handleRefreshIntervalChange = (value: string) => {
    const next = value as FreightRefreshValue;
    setRefreshInterval(next);
    try { localStorage.setItem(FREIGHT_REFRESH_LS_KEY, next); } catch {}
  };

  const {
    data: shipments,
    isLoading,
    isFetching,
    refetch,
  } = useListFreightShipments(undefined, { query: { queryKey: getListFreightShipmentsQueryKey(), refetchInterval: refetchIntervalMs(refreshInterval) } });

  useEffect(() => {
    if (wasFetchingRef.current && !isFetching) {
      setLastRefreshed(new Date());
    }
    wasFetchingRef.current = isFetching;
  }, [isFetching]);

  useEffect(() => {
    if (!lastFreightEventAt) return;
    refetch();
    setLastRefreshed(new Date());
    setAutoRefreshFlash(true);
    const t = setTimeout(() => setAutoRefreshFlash(false), 2500);
    return () => clearTimeout(t);
  }, [lastFreightEventAt]);

  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    const intervalMs = refetchIntervalMs(refreshInterval);
    if (!intervalMs || !lastRefreshed) {
      setSecondsLeft(null);
      return;
    }
    const tick = () => {
      const remaining = Math.round((lastRefreshed.getTime() + intervalMs - Date.now()) / 1000);
      setSecondsLeft(Math.max(0, remaining));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lastRefreshed, refreshInterval]);

  const formatCountdown = (secs: number): string => {
    if (secs <= 0) return "sebentar lagi";
    if (secs < 60) return `${secs}d`;
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return s > 0 ? `${m}m ${s}d` : `${m}m`;
  };

  const deleteShipment = useDeleteFreightShipment();
  const { data: _salesDocsPaginated } = useListSalesDocuments({ kind: "order", limit: 500 });
  const salesDocs = _salesDocsPaginated?.data ?? [];
  const soMap = Object.fromEntries(salesDocs.map((sd) => [sd.id, sd.docNumber]));

  void location;

  const initial = (() => {
    const fromUrl = parseParamsFromSearch(window.location.search);
    const urlSearch = new URLSearchParams(window.location.search);
    const urlHasDate = urlSearch.has("date") || urlSearch.has("from") || urlSearch.has("to");
    const urlHasStatus = urlSearch.has("status");
    let status = fromUrl.status;
    if (!urlHasStatus) {
      try {
        const saved = localStorage.getItem(FREIGHT_STATUS_LS_KEY);
        if (saved) status = saved;
      } catch {}
    }
    const urlHasBl = urlSearch.has("bl");
    let bl = fromUrl.bl;
    if (!urlHasBl) {
      try { bl = localStorage.getItem(FREIGHT_BL_LS_KEY) === "1"; } catch {}
    }
    if (urlHasDate) return { ...fromUrl, status, bl };
    const stored = loadDateFromStorage();
    return { status, bl, preset: stored.preset, from: stored.from, to: stored.to };
  })();

  const [statusFilter, setStatusFilterState] = useState<string | null>(initial.status);
  const [blReadyFilter, setBlReadyFilter] = useState(initial.bl);
  const [datePreset, setDatePresetState] = useState<DatePreset>(initial.preset);
  const [customDateFrom, setCustomDateFromState] = useState<string>(initial.from);
  const [customDateTo, setCustomDateToState] = useState<string>(initial.to);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [search, setSearch] = useState("");

  const syncStateFromUrl = useCallback(() => {
    const parsed = parseParamsFromSearch(window.location.search);
    setStatusFilterState(parsed.status);
    setBlReadyFilter(parsed.bl);
    setDatePresetState(parsed.preset);
    setCustomDateFromState(parsed.from);
    setCustomDateToState(parsed.to);
  }, []);

  useEffect(() => {
    window.addEventListener("popstate", syncStateFromUrl);
    return () => window.removeEventListener("popstate", syncStateFromUrl);
  }, [syncStateFromUrl]);

  useEffect(() => {
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (blReadyFilter) params.set("bl", "1");
    if (datePreset !== "all") params.set("date", datePreset);
    if (datePreset === "custom" && customDateFrom) params.set("from", customDateFrom);
    if (datePreset === "custom" && customDateTo) params.set("to", customDateTo);
    const qs = params.toString();
    const newUrl = qs ? `/logistics/freight?${qs}` : "/logistics/freight";
    const currentSearch = window.location.search;
    const currentFull = currentSearch ? `/logistics/freight${currentSearch}` : "/logistics/freight";
    if (newUrl !== currentFull) {
      navigate(newUrl, { replace: true });
    }
    try {
      if (statusFilter) {
        localStorage.setItem(FREIGHT_STATUS_LS_KEY, statusFilter);
      } else {
        localStorage.removeItem(FREIGHT_STATUS_LS_KEY);
      }
      localStorage.setItem(FREIGHT_DATE_LS_KEY, JSON.stringify({
        preset: datePreset,
        from: datePreset === "custom" ? customDateFrom : "",
        to: datePreset === "custom" ? customDateTo : "",
      }));
      if (blReadyFilter) {
        localStorage.setItem(FREIGHT_BL_LS_KEY, "1");
      } else {
        localStorage.removeItem(FREIGHT_BL_LS_KEY);
      }
    } catch {}
  }, [statusFilter, blReadyFilter, datePreset, customDateFrom, customDateTo]);

  const setStatusFilter = (value: string | null) => {
    setStatusFilterState(value);
    setPage(1);
  };

  const setDatePreset = (preset: DatePreset) => {
    if (preset !== "custom") {
      setCustomDateFromState("");
      setCustomDateToState("");
    }
    setDatePresetState(preset);
    setPage(1);
  };

  const customFrom = customDateFrom
    ? (() => { const [y, m, d] = customDateFrom.split("-").map(Number); return new Date(y, m - 1, d, 0, 0, 0, 0); })()
    : null;
  const customTo = customDateTo
    ? (() => { const [y, m, d] = customDateTo.split("-").map(Number); return new Date(y, m - 1, d, 23, 59, 59, 999); })()
    : null;
  const isCustomRangeInvalid = !!(customFrom && customTo && customFrom > customTo);

  const searchLower = search.trim().toLowerCase();

  const filteredShipments = (shipments ?? []).filter((s) => {
    if (statusFilter) {
      if (statusFilter === "active") {
        if (!ACTIVE_STATUSES.includes(s.status)) return false;
      } else {
        if (s.status !== statusFilter) return false;
      }
    }

    if (datePreset === "7days" || datePreset === "30days") {
      const days = datePreset === "7days" ? 7 : 30;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      cutoff.setHours(0, 0, 0, 0);
      if (new Date(s.createdAt) < cutoff) return false;
    } else if (datePreset === "custom" && !isCustomRangeInvalid) {
      if (customFrom && new Date(s.createdAt) < customFrom) return false;
      if (customTo && new Date(s.createdAt) > customTo) return false;
    }

    if (blReadyFilter && !hasBLData(s)) return false;

    if (searchLower) {
      const hay = [
        s.shipmentNumber,
        s.shipperName,
        s.consigneeName,
        s.commodity,
        s.origin,
        s.destination,
      ].filter(Boolean).join(" ").toLowerCase();
      if (!hay.includes(searchLower)) return false;
    }

    return true;
  });

  const blReadyCount = (shipments ?? []).filter(hasBLData).length;

  const getFilterCount = (value: string | null): number => {
    if (!shipments) return 0;
    if (value === null) return shipments.length;
    if (value === "active") return shipments.filter((s) => ACTIVE_STATUSES.includes(s.status)).length;
    return shipments.filter((s) => s.status === value).length;
  };

  const totalPages = Math.ceil(filteredShipments.length / pageSize);
  const pagedShipments = filteredShipments.slice((page - 1) * pageSize, page * pageSize);

  const handleDelete = (id: number, shipmentNumber: string) => {
    if (!confirm(`Hapus shipment ${shipmentNumber}?`)) return;
    deleteShipment.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListFreightShipmentsQueryKey() });
          toast({ title: t.common.success });
        },
        onError: () => {
          toast({ title: t.common.error, variant: "destructive" });
        },
      }
    );
  };

  const isFiltered = statusFilter !== null || datePreset !== "all" || blReadyFilter || !!searchLower;

  const clearFilters = () => {
    setStatusFilterState(null);
    setBlReadyFilter(false);
    setDatePreset("all");
    setSearch("");
    setPage(1);
    try { localStorage.removeItem(FREIGHT_BL_LS_KEY); } catch {}
  };

  const activeFilterParts: string[] = [];
  if (searchLower) activeFilterParts.push(`"${search.trim()}"`);
  if (statusFilter) {
    const label = STATUS_FILTERS.find((f) => f.value === statusFilter)?.label ?? statusFilter;
    activeFilterParts.push(`Status: ${label}`);
  }
  if (blReadyFilter) activeFilterParts.push("B/L Siap");
  if (datePreset === "7days") activeFilterParts.push("7 Hari Terakhir");
  else if (datePreset === "30days") activeFilterParts.push("30 Hari Terakhir");
  else if (datePreset === "custom") {
    const parts: string[] = [];
    if (customDateFrom) parts.push(customDateFrom.split("-").reverse().join("/"));
    if (customDateTo) parts.push(customDateTo.split("-").reverse().join("/"));
    activeFilterParts.push(parts.length ? parts.join(" – ") : "Tanggal kustom");
  }

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <PageHeader
          title="Freight Forwarding"
          breadcrumb={[{ label: "Dashboard", href: "/dashboard" }, { label: "Logistics", href: "/logistics" }, { label: "Freight Forwarding" }]}
          favoriteEnabled
          actions={
            <div className="flex flex-wrap items-center gap-2">
              <Select value={refreshInterval} onValueChange={handleRefreshIntervalChange}>
                <SelectTrigger className="h-8 text-xs w-auto min-w-[110px] gap-1" aria-label="Interval refresh">
                  <RefreshCw className={`h-3 w-3 shrink-0 ${isFetching ? "animate-spin" : ""}`} />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {FREIGHT_REFRESH_INTERVALS.map((opt) => (
                    <SelectItem key={opt.value} value={opt.value} className="text-xs">
                      {opt.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8"
                onClick={() => refetch()}
                title="Refresh sekarang"
                aria-label="Refresh daftar shipment freight"
              >
                <RefreshCw className={`h-4 w-4 ${isFetching ? "animate-spin" : ""}`} />
              </Button>
              <Link href="/logistics/freight/new">
                <Button>
                  <Plus className="h-4 w-4 mr-2" />
                  Buat Shipment
                </Button>
              </Link>
            </div>
          }
        />
        {lastRefreshed && (
          <p className={`text-xs text-muted-foreground -mt-4 flex items-center gap-1.5 transition-opacity ${isFetching && !isLoading ? "animate-pulse opacity-50" : ""}`}>
            <span>Diperbarui: {lastRefreshed.toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
            {secondsLeft !== null && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span className="flex items-center gap-0.5">
                  <Clock className="h-3 w-3" />
                  Refresh dalam {formatCountdown(secondsLeft)}
                </span>
              </>
            )}
            {autoRefreshFlash && (
              <>
                <span className="text-muted-foreground/40">·</span>
                <span className="flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-medium animate-pulse">
                  <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500 animate-ping" />
                  Diperbarui otomatis
                </span>
              </>
            )}
          </p>
        )}

        {isFiltered && (
          <div className="flex items-center gap-2 rounded-md border border-primary/25 bg-primary/5 px-3 py-1.5 text-sm w-fit max-w-full flex-wrap">
            <Filter className="h-3.5 w-3.5 text-primary shrink-0" />
            <span className="text-foreground font-medium">Filter aktif:</span>
            <span className="text-muted-foreground">{activeFilterParts.join(" · ")}</span>
            <span className="text-primary font-semibold">· {filteredShipments.length} shipment</span>
            <Button
              variant="ghost"
              size="sm"
              onClick={clearFilters}
              className="ml-auto h-auto py-0 px-1 gap-1 text-xs text-muted-foreground hover:text-foreground shrink-0"
              aria-label="Hapus semua filter"
            >
              <X className="h-3.5 w-3.5" />
              Hapus filter
            </Button>
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          {STATUS_FILTERS.map((f) => {
            const isActive = statusFilter === f.value;
            const count = getFilterCount(f.value);
            return (
              <Button
                key={f.value ?? "all"}
                variant={isActive ? "default" : "outline"}
                size="sm"
                onClick={() => setStatusFilter(f.value)}
                className="gap-1.5"
              >
                {f.label}
                {isLoading ? (
                  <Skeleton className="h-4 w-5 rounded-full" />
                ) : (
                  <span className={`inline-flex items-center justify-center rounded-full text-xs font-semibold min-w-[1.25rem] px-1 ${isActive ? "bg-white/20 text-inherit" : "bg-muted text-muted-foreground"} ${isFetching ? "animate-pulse" : ""}`}>
                    {count}
                  </span>
                )}
              </Button>
            );
          })}
          <Button
            variant={blReadyFilter ? "default" : "outline"}
            size="sm"
            onClick={() => { setBlReadyFilter((v) => !v); setPage(1); }}
            className="gap-1.5"
          >
            B/L Siap
            {isLoading ? (
              <Skeleton className="h-4 w-5 rounded-full" />
            ) : (
              <span className={`inline-flex items-center justify-center rounded-full text-xs font-semibold min-w-[1.25rem] px-1 ${blReadyFilter ? "bg-white/20 text-inherit" : "bg-muted text-muted-foreground"} ${isFetching ? "animate-pulse" : ""}`}>
                {blReadyCount}
              </span>
            )}
          </Button>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Cari no. shipment, shipper, consignee..."
              className={`pl-9 h-8 text-sm w-72 ${search ? "pr-8" : ""}`}
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            />
            {search && (
              <button
                onClick={() => { setSearch(""); setPage(1); }}
                className="absolute right-2.5 top-2 text-muted-foreground hover:text-foreground"
                aria-label="Hapus pencarian"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Select
            value={datePreset}
            onValueChange={(v) => setDatePreset(v as DatePreset)}
          >
            <SelectTrigger className="h-8 text-sm w-auto min-w-[160px]">
              <SelectValue placeholder="Semua Waktu" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Semua Waktu</SelectItem>
              <SelectItem value="7days">7 Hari Terakhir</SelectItem>
              <SelectItem value="30days">30 Hari Terakhir</SelectItem>
              <SelectItem value="custom">Kustom</SelectItem>
            </SelectContent>
          </Select>

          {datePreset === "custom" && (
            <>
              <DatePicker value={customDateFrom} onChange={(v) => setCustomDateFromState(v)} className={`h-8 text-sm w-auto px-2 ${isCustomRangeInvalid ? "border-destructive" : ""}`} aria-label="Dari tanggal" />
              <span className="text-sm text-muted-foreground">–</span>
              <DatePicker value={customDateTo} onChange={(v) => setCustomDateToState(v)} className={`h-8 text-sm w-auto px-2 ${isCustomRangeInvalid ? "border-destructive" : ""}`} aria-label="Sampai tanggal" />
              {isCustomRangeInvalid && (
                <span className="text-xs text-destructive">Tanggal awal harus sebelum tanggal akhir</span>
              )}
            </>
          )}

          {isFiltered && (
            <p className="text-xs text-muted-foreground">
              {filteredShipments.length} shipment ditemukan
            </p>
          )}
        </div>

        {/* Desktop table — hidden on mobile */}
        <Card className="hidden md:block">
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>No. Shipment</TableHead>
                  <TableHead>Shipper</TableHead>
                  <TableHead>Consignee</TableHead>
                  <TableHead>Komoditi</TableHead>
                  <TableHead>Origin → Destination</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Biaya</TableHead>
                  <TableHead>Tgl. Dibuat</TableHead>
                  <TableHead className="text-right">Aksi</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      {Array.from({ length: 9 }).map((_, j) => (
                        <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : !filteredShipments.length ? (
                  <TableRow>
                    <TableCell colSpan={9} className="text-center py-12 text-muted-foreground">
                      {isFiltered
                        ? "Tidak ada shipment dengan filter ini."
                        : "Belum ada freight shipment. Buat shipment pertama Anda."}
                    </TableCell>
                  </TableRow>
                ) : (
                  pagedShipments.map((s) => (
                    <TableRow key={s.id}>
                      <TableCell>
                        <div className="font-mono text-sm font-semibold">{s.shipmentNumber}</div>
                        {s.salesDocId && (
                          <Link href={`/sales/orders/${s.salesDocId}`}>
                            <span className="inline-flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:underline font-mono mt-0.5">
                              <ShoppingCart size={10} />
                              {soMap[s.salesDocId] ?? `SO #${s.salesDocId}`}
                            </span>
                          </Link>
                        )}
                        {hasBLData(s) && (
                          <div className="flex items-center gap-0.5 mt-0.5 text-xs text-sky-600 dark:text-sky-400 font-medium">
                            <Ship className="h-3 w-3" />
                            <span>B/L</span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell>{s.shipperName}</TableCell>
                      <TableCell>{s.consigneeName}</TableCell>
                      <TableCell>{s.commodity}</TableCell>
                      <TableCell>
                        <span className="text-muted-foreground">{s.origin}</span>
                        <span className="mx-1">→</span>
                        <span>{s.destination}</span>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={STATUS_COLORS[s.status] ?? ""}>
                          {STATUS_LABELS[s.status] ?? s.status}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-col items-start gap-0.5">
                          <CostBadge actualCost={s.actualCost} approvedQuoteCost={s.approvedQuoteCost} />
                          <ExpenseBadge totalExpenses={s.totalExpenses} actualCost={s.actualCost} approvedQuoteCost={s.approvedQuoteCost} />
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground text-sm whitespace-nowrap">
                        {new Date(s.createdAt).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
                      </TableCell>
                      <TableCell>
                        <div className="flex justify-end gap-1">
                          <Link href={`/logistics/freight/${s.id}`}>
                            <Button variant="ghost" size="icon" title="Detail">
                              <Eye className="h-4 w-4" />
                            </Button>
                          </Link>
                          <Button
                            variant="ghost"
                            size="icon"
                            title="Hapus"
                            onClick={() => handleDelete(s.id, s.shipmentNumber)}
                            disabled={deleteShipment.isPending}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>

          {/* Desktop pagination controls */}
          {totalPages > 1 && (
            <div className="flex items-center justify-between px-4 py-3 border-t">
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">Per halaman:</span>
                <Select value={String(pageSize)} onValueChange={(v) => { setPageSize(Number(v)); setPage(1); }}>
                  <SelectTrigger className="h-7 w-16 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {[20, 50, 100].map((n) => <SelectItem key={n} value={String(n)} className="text-xs">{n}</SelectItem>)}
                  </SelectContent>
                </Select>
                <span className="text-xs text-muted-foreground">
                  {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filteredShipments.length)} dari {filteredShipments.length}
                </span>
              </div>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs px-2">{page} / {totalPages}</span>
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </Card>

        {/* Mobile card list — hidden on md+ */}
        <div className="md:hidden space-y-3">
          {isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <Skeleton className="h-5 w-2/5" />
                    <Skeleton className="h-5 w-1/4 rounded-full" />
                  </div>
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </CardContent>
              </Card>
            ))
          ) : !filteredShipments.length ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                <Ship className="h-8 w-8 mb-2 opacity-50 mx-auto" />
                <p className="text-sm">
                  {isFiltered
                    ? "Tidak ada shipment dengan filter ini."
                    : "Belum ada freight shipment."}
                </p>
              </CardContent>
            </Card>
          ) : (
            pagedShipments.map((s) => (
              <Card
                key={s.id}
                data-testid={`card-shipment-${s.id}`}
                className="cursor-pointer hover:bg-muted/40 transition-colors"
                onClick={() => navigate(`/logistics/freight/${s.id}`)}
                {...prefetchHover(getGetFreightShipmentQueryOptions(s.id))}
              >
                <CardContent className="p-4 space-y-2">
                  {/* Header: shipment number + status */}
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-sm font-semibold truncate">{s.shipmentNumber}</span>
                    <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                      {hasBLData(s) && (
                        <span className="inline-flex items-center gap-0.5 text-xs font-medium text-sky-600 dark:text-sky-400" title="Bill of Lading tersedia">
                          <Ship className="h-3 w-3" />
                          B/L
                        </span>
                      )}
                      <Badge variant="outline" className={STATUS_COLORS[s.status] ?? ""}>
                        {STATUS_LABELS[s.status] ?? s.status}
                      </Badge>
                    </div>
                  </div>

                  {/* Shipper → Consignee */}
                  <div className="text-sm">
                    <span className="text-muted-foreground">{s.shipperName}</span>
                    <span className="mx-1.5 text-muted-foreground">→</span>
                    <span>{s.consigneeName}</span>
                  </div>

                  {/* Commodity + route */}
                  <div className="text-xs text-muted-foreground">
                    <span>{s.commodity}</span>
                    <span className="mx-1.5">·</span>
                    <span>{s.origin} → {s.destination}</span>
                  </div>

                  {/* SO ref badge */}
                  {s.salesDocId && (
                    <Link
                      href={`/sales/orders/${s.salesDocId}`}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="inline-flex items-center gap-1 text-xs text-indigo-600 dark:text-indigo-400 hover:underline font-mono">
                        <ShoppingCart size={10} />
                        {soMap[s.salesDocId] ?? `SO #${s.salesDocId}`}
                      </span>
                    </Link>
                  )}

                  {/* Cost comparison */}
                  {(s.actualCost || s.approvedQuoteCost || s.totalExpenses) && (
                    <div className="flex flex-col items-start gap-1">
                      <CostBadge actualCost={s.actualCost} approvedQuoteCost={s.approvedQuoteCost} />
                      <ExpenseBadge totalExpenses={s.totalExpenses} actualCost={s.actualCost} approvedQuoteCost={s.approvedQuoteCost} />
                    </div>
                  )}

                  {/* Date + delete action */}
                  <div className="flex items-center justify-between pt-1 border-t border-border">
                    <span className="text-xs text-muted-foreground">
                      {new Date(s.createdAt).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
                    </span>
                    <Button
                      variant="ghost"
                      size="icon"
                      title="Hapus"
                      onClick={(e) => { e.stopPropagation(); handleDelete(s.id, s.shipmentNumber); }}
                      disabled={deleteShipment.isPending}
                      data-testid={`button-delete-shipment-${s.id}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            ))
          )}

          {/* Mobile pagination controls */}
          {!isLoading && totalPages > 1 && (
            <div className="flex items-center justify-between py-2">
              <span className="text-xs text-muted-foreground">
                {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, filteredShipments.length)} dari {filteredShipments.length}
              </span>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}>
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="text-xs px-1">{page}/{totalPages}</span>
                <Button variant="outline" size="sm" onClick={() => setPage((p) => Math.min(totalPages, p + 1))} disabled={page >= totalPages}>
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </AppShell>
  );
}
