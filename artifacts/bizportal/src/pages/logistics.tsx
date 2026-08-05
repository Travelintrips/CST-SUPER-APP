import { DatePicker } from "@/components/ui/date-picker";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { useState, useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Plus, Navigation2, RefreshCw, Ship, ArrowRight, Clock, ArrowUpDown, X, Filter, CheckCircle2, Car } from "lucide-react";
import { useCompany } from "@/contexts/CompanyContext";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useLanguage } from "@/contexts/LanguageContext";
import { Link, useLocation, useSearch } from "wouter";
import { CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  useListShipments,
  useCreateShipment,
  useUpdateShipmentStatus,
  getListShipmentsQueryKey,
  useListFreightShipments,
  getListFreightShipmentsQueryKey,
} from "@workspace/api-client-react";

const FREIGHT_REFRESH_INTERVALS = [
  { label: "30 detik", value: "30" },
  { label: "1 menit", value: "60" },
  { label: "5 menit", value: "300" },
  { label: "Mati", value: "off" },
] as const;

type FreightRefreshValue = "30" | "60" | "300" | "off";

const FREIGHT_REFRESH_LS_KEY = "freight-refresh-interval";

function getInitialRefreshInterval(): FreightRefreshValue {
  try {
    const stored = localStorage.getItem(FREIGHT_REFRESH_LS_KEY);
    if (stored === "30" || stored === "60" || stored === "300" || stored === "off") {
      return stored;
    }
  } catch {}
  return "60";
}

function refetchIntervalMs(value: FreightRefreshValue): number | false {
  if (value === "off") return false;
  return parseInt(value, 10) * 1000;
}

export default function LogisticsPage() {
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [location, navigate] = useLocation();
  const searchString = useSearch();
  const { activeCompany } = useCompany();
  const showFleetIntelligence = ["CST", "DVS"].includes(activeCompany?.companyCode ?? "");

  const [freightRefreshInterval, setFreightRefreshInterval] = useState<FreightRefreshValue>(getInitialRefreshInterval);

  const handleRefreshIntervalChange = (value: string) => {
    const next = value as FreightRefreshValue;
    setFreightRefreshInterval(next);
    try { localStorage.setItem(FREIGHT_REFRESH_LS_KEY, next); } catch {}
  };

  const { data: _shipmentsPaginated, isLoading } = useListShipments({ limit: 500 });
  const shipments = _shipmentsPaginated?.data;
  const createShipment = useCreateShipment();
  const updateStatus = useUpdateShipmentStatus();

  const {
    data: freightShipments,
    isLoading: freightLoading,
    isFetching: freightFetching,
    refetch: refetchFreight,
  } = useListFreightShipments(undefined, { query: { queryKey: getListFreightShipmentsQueryKey(), refetchInterval: refetchIntervalMs(freightRefreshInterval) } });

  const [lastRefreshed, setLastRefreshed] = useState<Date | null>(null);
  const wasFetchingRef = useRef(false);
  useEffect(() => {
    if (wasFetchingRef.current && !freightFetching) {
      setLastRefreshed(new Date());
    }
    wasFetchingRef.current = freightFetching;
  }, [freightFetching]);

  const [freightSecondsLeft, setFreightSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    const intervalMs = refetchIntervalMs(freightRefreshInterval);
    if (!intervalMs || !lastRefreshed) {
      setFreightSecondsLeft(null);
      return;
    }
    const tick = () => {
      const remaining = Math.round((lastRefreshed.getTime() + intervalMs - Date.now()) / 1000);
      setFreightSecondsLeft(Math.max(0, remaining));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [lastRefreshed, freightRefreshInterval]);

  const formatFreightCountdown = (secs: number): string => {
    if (secs <= 0) return "sebentar lagi";
    if (secs < 60) return `${secs}d`;
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return s > 0 ? `${m}m ${s}d` : `${m}m`;
  };

  const FREIGHT_STATUS_LABELS: Record<string, string> = {
    draft: "Draft",
    rfq_sent: "RFQ Dikirim",
    confirmed: "Dikonfirmasi",
    in_transit: "Dalam Perjalanan",
    completed: "Selesai",
    cancelled: "Dibatalkan",
  };

  const FREIGHT_STATUS_COLORS: Record<string, string> = {
    draft: "bg-muted text-muted-foreground",
    rfq_sent: "bg-amber-500/10 text-amber-500 border-amber-500/20",
    confirmed: "bg-blue-500/10 text-blue-500 border-blue-500/20",
    in_transit: "bg-indigo-500/10 text-indigo-500 border-indigo-500/20",
    completed: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
    cancelled: "bg-destructive/10 text-destructive border-destructive/20",
  };

  const rawSearch = searchString.startsWith("?") ? searchString.slice(1) : searchString;
  const initialParams = new URLSearchParams(rawSearch);

  const VALID_FREIGHT_STATUSES = ["all", "draft", "rfq_sent", "confirmed", "in_transit"];
  const initialStatus = initialParams.get("status") ?? "all";
  const [freightStatusFilter, setFreightStatusFilter] = useState<string>(
    VALID_FREIGHT_STATUSES.includes(initialStatus) ? initialStatus : "all"
  );
  const [dismissingFilter, setDismissingFilter] = useState<string | null>(null);
  const dismissTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleStatFilterToggle = (value: string) => {
    if (dismissTimerRef.current !== null) {
      clearTimeout(dismissTimerRef.current);
      dismissTimerRef.current = null;
      setDismissingFilter(null);
    }
    if (freightStatusFilter === value) {
      setDismissingFilter(value);
      dismissTimerRef.current = setTimeout(() => {
        setFreightStatusFilter("all");
        setDismissingFilter(null);
        dismissTimerRef.current = null;
      }, 120);
    } else {
      setFreightStatusFilter(value);
    }
  };

  useEffect(() => {
    return () => {
      if (dismissTimerRef.current !== null) clearTimeout(dismissTimerRef.current);
    };
  }, []);
  const [freightSortOrder, setFreightSortOrder] = useState<"newest" | "oldest">(
    initialParams.get("sort") === "oldest" ? "oldest" : "newest"
  );
  const [freightDateFilter, setFreightDateFilter] = useState<"all" | "7days" | "30days" | "custom">(
    (["all", "7days", "30days", "custom"].includes(initialParams.get("date") ?? "")
      ? (initialParams.get("date") as "all" | "7days" | "30days" | "custom")
      : "all")
  );
  const [customDateFrom, setCustomDateFrom] = useState<string>(initialParams.get("from") ?? "");
  const [customDateTo, setCustomDateTo] = useState<string>(initialParams.get("to") ?? "");

  useEffect(() => {
    const params = new URLSearchParams();
    if (freightStatusFilter !== "all") params.set("status", freightStatusFilter);
    if (freightSortOrder !== "newest") params.set("sort", freightSortOrder);
    if (freightDateFilter !== "all") params.set("date", freightDateFilter);
    if (freightDateFilter === "custom" && customDateFrom) params.set("from", customDateFrom);
    if (freightDateFilter === "custom" && customDateTo) params.set("to", customDateTo);
    const qs = params.toString();
    const newUrl = qs ? `${location}?${qs}` : location;
    const currentFull = rawSearch ? `${location}?${rawSearch}` : location;
    if (newUrl !== currentFull) {
      navigate(newUrl, { replace: true });
    }
  }, [freightStatusFilter, freightSortOrder, freightDateFilter, customDateFrom, customDateTo]);

  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const activeFreight = freightShipments?.filter(
    (s) => s.status !== "cancelled" && s.status !== "completed"
  ) ?? [];
  const awaitingQuote = freightShipments?.filter((s) => s.status === "rfq_sent") ?? [];
  const inTransit = freightShipments?.filter((s) => s.status === "in_transit") ?? [];

  const freightStatusCounts = {
    draft: activeFreight.filter((s) => s.status === "draft").length,
    rfq_sent: awaitingQuote.length,
    confirmed: activeFreight.filter((s) => s.status === "confirmed").length,
    in_transit: inTransit.length,
  };

  const customFrom = customDateFrom
    ? (() => { const [y, m, d] = customDateFrom.split("-").map(Number); return new Date(y, m - 1, d, 0, 0, 0, 0); })()
    : null;
  const customTo = customDateTo
    ? (() => { const [y, m, d] = customDateTo.split("-").map(Number); return new Date(y, m - 1, d, 23, 59, 59, 999); })()
    : null;
  const isCustomRangeInvalid = !!(customFrom && customTo && customFrom > customTo);

  const isAnyFilterActive =
    freightStatusFilter !== "all" ||
    freightSortOrder !== "newest" ||
    freightDateFilter !== "all";

  const isFreightFiltered = freightStatusFilter !== "all" || freightDateFilter !== "all";

  const DATE_FILTER_LABELS: Record<string, string> = {
    "7days": "7 Hari Terakhir",
    "30days": "30 Hari Terakhir",
    "custom": customDateFrom && customDateTo ? `${customDateFrom} – ${customDateTo}` : "Kustom",
  };

  const activeFreightFilterParts: string[] = [];
  if (freightStatusFilter !== "all") activeFreightFilterParts.push(FREIGHT_STATUS_LABELS[freightStatusFilter] ?? freightStatusFilter);
  if (freightDateFilter !== "all") activeFreightFilterParts.push(DATE_FILTER_LABELS[freightDateFilter] ?? freightDateFilter);

  const clearFreightFilters = () => {
    setFreightStatusFilter("all");
    setFreightSortOrder("newest");
    setFreightDateFilter("all");
    setCustomDateFrom("");
    setCustomDateTo("");
  };

  const recentFreightBase = (() => {
    let list = freightStatusFilter === "all"
      ? activeFreight
      : activeFreight.filter((s) => s.status === freightStatusFilter);

    if (freightDateFilter === "7days" || freightDateFilter === "30days") {
      const days = freightDateFilter === "7days" ? 7 : 30;
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - days);
      cutoff.setHours(0, 0, 0, 0);
      list = list.filter((s) => new Date(s.createdAt) >= cutoff);
    } else if (freightDateFilter === "custom" && !isCustomRangeInvalid) {
      if (customFrom) list = list.filter((s) => new Date(s.createdAt) >= customFrom);
      if (customTo) list = list.filter((s) => new Date(s.createdAt) <= customTo);
    }

    return list;
  })();

  const recentFreight = [...recentFreightBase]
    .sort((a, b) => {
      const diff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
      return freightSortOrder === "newest" ? diff : -diff;
    })
    .slice(0, 5);

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return 'bg-amber-500/10 text-amber-500 hover:bg-amber-500/20 border-amber-500/20';
      case 'picked_up': return 'bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 border-blue-500/20';
      case 'in_transit': return 'bg-indigo-500/10 text-indigo-500 hover:bg-indigo-500/20 border-indigo-500/20';
      case 'out_for_delivery': return 'bg-violet-500/10 text-violet-500 hover:bg-violet-500/20 border-violet-500/20';
      case 'delivered': return 'bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500/20 border-emerald-500/20';
      case 'failed': return 'bg-destructive/10 text-destructive hover:bg-destructive/20 border-destructive/20';
      default: return 'bg-muted text-muted-foreground';
    }
  };

  const handleCreateShipment = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);

    createShipment.mutate({
      data: {
        carrier: formData.get("carrier") as string,
        origin: formData.get("origin") as string,
        destination: formData.get("destination") as string,
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListShipmentsQueryKey() });
        setIsDialogOpen(false);
        toast({ title: t.common.success });
      },
      onError: () => toast({ title: t.common.error, variant: "destructive" })
    });
  };

  const handleStatusChange = (id: number, status: "pending" | "picked_up" | "in_transit" | "out_for_delivery" | "delivered" | "failed") => {
    updateStatus.mutate({ id, data: { status } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListShipmentsQueryKey() });
        toast({ title: t.common.success });
      },
      onError: () => toast({ title: t.common.error, variant: "destructive" })
    });
  };

  const statuses: Array<"pending" | "picked_up" | "in_transit" | "out_for_delivery" | "delivered" | "failed"> = [
    "pending", "picked_up", "in_transit", "out_for_delivery", "delivered", "failed"
  ];

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title={t.logistics.title}
          description={t.logistics.subtitle}
          favoriteEnabled
        />

        {/* Gojek Fleet Intelligence Shortcut */}
        {showFleetIntelligence && (
          <Link href="/logistics/fleet-intelligence">
            <Card className="cursor-pointer border-green-500/40 bg-green-500/5 hover:bg-green-500/10 transition-colors">
              <CardContent className="flex items-center justify-between py-4 px-5">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-green-500/15">
                    <Car className="h-5 w-5 text-green-500" />
                  </div>
                  <div>
                    <p className="font-semibold text-sm text-green-400">Gojek Fleet Intelligence</p>
                    <p className="text-xs text-muted-foreground">Monitor driver, transaksi, dan outstanding armada Gojek</p>
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 text-green-500 shrink-0" />
              </CardContent>
            </Card>
          </Link>
        )}

        {/* Freight Forwarding Summary Card */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Ship className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">{t.logistics.freightTitle}</CardTitle>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/logistics/freight">
                  {t.logistics.viewAll} <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                </Link>
              </Button>
            </div>
            <CardDescription>{t.logistics.freightSubtitle}</CardDescription>
          </CardHeader>
          <CardContent>
            {freightLoading ? (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="space-y-1">
                    <Skeleton className="h-7 w-10" />
                    <Skeleton className="h-4 w-24" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <button
                  type="button"
                  onClick={() => setFreightStatusFilter("all")}
                  className={`space-y-1 text-left rounded-md p-2 -m-2 transition-colors cursor-pointer hover:bg-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${freightStatusFilter === "all" ? "ring-2 ring-primary bg-muted/40" : ""}`}
                  title="Tampilkan semua shipment aktif"
                >
                  <p className="text-2xl font-bold">{activeFreight.length}</p>
                  <p className="text-xs text-muted-foreground">{t.dashboard.activeFreight}</p>
                </button>
                <button
                  type="button"
                  onClick={() => handleStatFilterToggle("rfq_sent")}
                  className={`relative space-y-1 text-left rounded-md p-2 -m-2 transition-colors cursor-pointer hover:bg-amber-50 dark:hover:bg-amber-950/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${(freightStatusFilter === "rfq_sent" || dismissingFilter === "rfq_sent") ? "ring-2 ring-amber-400 bg-amber-50 dark:bg-amber-950/20" : ""}`}
                  title={freightStatusFilter === "rfq_sent" ? "Klik untuk hapus filter" : "Filter: Menunggu Persetujuan Quote"}
                >
                  {(freightStatusFilter === "rfq_sent" || dismissingFilter === "rfq_sent") && (
                    <span className={`absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-amber-400 text-white ${dismissingFilter === "rfq_sent" ? "animate-out zoom-out-50 fade-out-0 duration-100 [animation-fill-mode:forwards]" : "animate-in zoom-in-0 duration-150"}`} aria-label="Hapus filter">
                      <X className="h-2.5 w-2.5" />
                    </span>
                  )}
                  <div className="flex items-center gap-1.5">
                    <p className="text-2xl font-bold text-amber-500">{awaitingQuote.length}</p>
                    {awaitingQuote.length > 0 && (
                      <Clock className="h-4 w-4 text-amber-500 shrink-0" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{t.dashboard.awaitingQuote}</p>
                </button>
                <button
                  type="button"
                  onClick={() => handleStatFilterToggle("confirmed")}
                  className={`relative space-y-1 text-left rounded-md p-2 -m-2 transition-colors cursor-pointer hover:bg-blue-50 dark:hover:bg-blue-950/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${(freightStatusFilter === "confirmed" || dismissingFilter === "confirmed") ? "ring-2 ring-blue-400 bg-blue-50 dark:bg-blue-950/20" : ""}`}
                  title={freightStatusFilter === "confirmed" ? "Klik untuk hapus filter" : "Filter: Dikonfirmasi"}
                >
                  {(freightStatusFilter === "confirmed" || dismissingFilter === "confirmed") && (
                    <span className={`absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-blue-400 text-white ${dismissingFilter === "confirmed" ? "animate-out zoom-out-50 fade-out-0 duration-100 [animation-fill-mode:forwards]" : "animate-in zoom-in-0 duration-150"}`} aria-label="Hapus filter">
                      <X className="h-2.5 w-2.5" />
                    </span>
                  )}
                  <div className="flex items-center gap-1.5">
                    <p className="text-2xl font-bold text-blue-500">{freightStatusCounts.confirmed}</p>
                    {freightStatusCounts.confirmed > 0 && (
                      <CheckCircle2 className="h-4 w-4 text-blue-500 shrink-0" />
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">{t.logistics.statusConfirmed}</p>
                </button>
                <button
                  type="button"
                  onClick={() => handleStatFilterToggle("in_transit")}
                  className={`relative space-y-1 text-left rounded-md p-2 -m-2 transition-colors cursor-pointer hover:bg-indigo-50 dark:hover:bg-indigo-950/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${(freightStatusFilter === "in_transit" || dismissingFilter === "in_transit") ? "ring-2 ring-indigo-400 bg-indigo-50 dark:bg-indigo-950/20" : ""}`}
                  title={freightStatusFilter === "in_transit" ? "Klik untuk hapus filter" : "Filter: Dalam Perjalanan"}
                >
                  {(freightStatusFilter === "in_transit" || dismissingFilter === "in_transit") && (
                    <span className={`absolute top-1 right-1 flex h-4 w-4 items-center justify-center rounded-full bg-indigo-400 text-white ${dismissingFilter === "in_transit" ? "animate-out zoom-out-50 fade-out-0 duration-100 [animation-fill-mode:forwards]" : "animate-in zoom-in-0 duration-150"}`} aria-label="Hapus filter">
                      <X className="h-2.5 w-2.5" />
                    </span>
                  )}
                  <p className="text-2xl font-bold text-indigo-500">{inTransit.length}</p>
                  <p className="text-xs text-muted-foreground">{t.logistics.statusInTransit}</p>
                </button>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Active Freight Shipments */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <CardTitle className="text-base shrink-0">{t.logistics.freightTitle}</CardTitle>
              <div className="flex items-center gap-1 shrink-0">
                <Select value={freightRefreshInterval} onValueChange={handleRefreshIntervalChange}>
                  <SelectTrigger className="h-7 text-xs w-auto min-w-[110px] gap-1" aria-label="Interval refresh">
                    <RefreshCw className={`h-3 w-3 shrink-0 ${freightFetching ? "animate-spin" : ""}`} />
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent align="end">
                    {FREIGHT_REFRESH_INTERVALS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>
                        {opt.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => refetchFreight()}
                  disabled={freightFetching}
                  title="Refresh sekarang"
                  aria-label="Refresh daftar shipment freight"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${freightFetching ? "animate-spin" : ""}`} />
                </Button>
                <Button variant="ghost" size="sm" asChild>
                  <Link href="/logistics/freight">
                    {t.logistics.viewAll} <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>
            </div>
            {lastRefreshed && (
              <p className="text-[11px] text-muted-foreground flex items-center gap-1.5">
                <span>{t.dashboard.updatedAt}: {lastRefreshed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</span>
                {freightSecondsLeft !== null && (
                  <>
                    <span className="text-muted-foreground/40">·</span>
                    <span className="flex items-center gap-0.5">
                      <Clock className="h-3 w-3" />
                      {t.dashboard.refreshIn} {formatFreightCountdown(freightSecondsLeft)}
                    </span>
                  </>
                )}
              </p>
            )}
            {isFreightFiltered && (
              <div className="flex items-center gap-2 rounded-md border border-primary/25 bg-primary/5 px-3 py-1.5 text-sm w-fit max-w-full flex-wrap">
                <Filter className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="text-foreground font-medium">{t.logistics.filters}:</span>
                <span className="text-muted-foreground">{activeFreightFilterParts.join(" · ")}</span>
                <span className="text-primary font-semibold">· {recentFreight.length} shipment</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={clearFreightFilters}
                  className="ml-auto h-auto py-0 px-1 gap-1 text-xs text-muted-foreground hover:text-foreground shrink-0"
                  aria-label="Hapus semua filter"
                >
                  <X className="h-3.5 w-3.5" />
                  {t.logistics.clearFilters}
                </Button>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Select value={freightStatusFilter} onValueChange={setFreightStatusFilter}>
                <SelectTrigger className="h-7 text-xs w-auto min-w-[130px]">
                  <SelectValue placeholder="Semua Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t.logistics.allStatus} ({activeFreight.length})</SelectItem>
                  <SelectItem value="draft">{t.logistics.statusDraft} ({freightStatusCounts.draft})</SelectItem>
                  <SelectItem value="rfq_sent">{t.logistics.statusRfqSent} ({freightStatusCounts.rfq_sent})</SelectItem>
                  <SelectItem value="confirmed">{t.logistics.statusConfirmed} ({freightStatusCounts.confirmed})</SelectItem>
                  <SelectItem value="in_transit">{t.logistics.statusInTransit} ({freightStatusCounts.in_transit})</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={freightDateFilter}
                onValueChange={(v) => {
                  const next = v as "all" | "7days" | "30days" | "custom";
                  if (next !== "custom") {
                    setCustomDateFrom("");
                    setCustomDateTo("");
                  }
                  setFreightDateFilter(next);
                }}
              >
                <SelectTrigger className="h-7 text-xs w-auto min-w-[140px]">
                  <SelectValue placeholder="Semua Waktu" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{t.logistics.allStatus}</SelectItem>
                  <SelectItem value="7days">{t.logistics.last7Days}</SelectItem>
                  <SelectItem value="30days">{t.logistics.last30Days}</SelectItem>
                  <SelectItem value="custom">{t.logistics.custom}</SelectItem>
                </SelectContent>
              </Select>
              {freightDateFilter === "custom" && (
                <>
                  <DatePicker value={customDateFrom} onChange={(v) => setCustomDateFrom(v)} className={`h-7 text-xs w-auto px-2 ${isCustomRangeInvalid ? "border-destructive" : ""}`} aria-label="Dari tanggal" />
                  <span className="text-xs text-muted-foreground">–</span>
                  <DatePicker value={customDateTo} onChange={(v) => setCustomDateTo(v)} className={`h-7 text-xs w-auto px-2 ${isCustomRangeInvalid ? "border-destructive" : ""}`} aria-label="Sampai tanggal" />
                  {isCustomRangeInvalid && (
                    <span className="text-xs text-destructive">{"Rentang tanggal tidak valid"}</span>
                  )}
                </>
              )}
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs px-2 gap-1"
                onClick={() => setFreightSortOrder((prev) => prev === "newest" ? "oldest" : "newest")}
              >
                <ArrowUpDown className="h-3 w-3" />
                {freightSortOrder === "newest" ? t.logistics.newest : t.logistics.oldest}
              </Button>
              {isAnyFilterActive && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs px-2 gap-1 text-muted-foreground hover:text-foreground"
                  onClick={clearFreightFilters}
                >
                  <X className="h-3 w-3" />
                  {t.logistics.clearFilters}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {freightLoading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <Skeleton className="h-4 w-28" />
                    <Skeleton className="h-4 w-40 flex-1" />
                    <Skeleton className="h-6 w-24 rounded-full" />
                  </div>
                ))}
              </div>
            ) : recentFreight.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-muted-foreground gap-2">
                <img src="/images/logo.png" alt="B2B Marketplace and Logistic" className="h-8 w-auto object-contain opacity-50" />
                <p className="text-sm">
                  {freightStatusFilter !== "all" && freightDateFilter !== "all"
                    ? `${t.logistics.noShipments} (${FREIGHT_STATUS_LABELS[freightStatusFilter] ?? freightStatusFilter})`
                    : freightStatusFilter !== "all"
                    ? `${t.logistics.noShipments} (${FREIGHT_STATUS_LABELS[freightStatusFilter] ?? freightStatusFilter})`
                    : freightDateFilter !== "all"
                    ? t.logistics.noShipments
                    : t.logistics.noShipments}
                </p>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.common.number}</TableHead>
                    <TableHead className="hidden sm:table-cell">{t.logistics.origin} → {t.logistics.destination}</TableHead>
                    <TableHead className="hidden md:table-cell whitespace-nowrap">{t.common.date}</TableHead>
                    <TableHead>{t.logistics.deliveryStatus}</TableHead>
                    <TableHead className="text-right"></TableHead>
                  </TableRow>
                </TableHeader>
                {/*
                 * Tappable row pattern: add cursor-pointer + onClick on <TableRow> to navigate
                 * to the detail page. If a row contains interactive elements (buttons, dropdowns),
                 * add onClick={(e) => e.stopPropagation()} on their wrapping <TableCell> so
                 * clicks don't bubble up and trigger row navigation unintentionally.
                 * All shipment tables in this file should follow this pattern.
                 */}
                <TableBody>
                  {recentFreight.map((s) => (
                    <TableRow
                      key={s.id}
                      className="cursor-pointer"
                      onClick={() => navigate(`/logistics/freight/${s.id}`)}
                    >
                      <TableCell className="font-mono text-sm font-semibold">
                        <div>{s.shipmentNumber}</div>
                        <div className="sm:hidden font-normal font-sans text-xs text-muted-foreground mt-0.5">
                          {s.origin} → {s.destination}
                        </div>
                        <div className="md:hidden font-normal font-sans text-xs text-muted-foreground mt-0.5">
                          {new Date(s.createdAt).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                        {s.origin} → {s.destination}
                      </TableCell>
                      <TableCell className="hidden md:table-cell text-sm text-muted-foreground whitespace-nowrap">
                        {new Date(s.createdAt).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={FREIGHT_STATUS_COLORS[s.status] ?? ""}>
                          {FREIGHT_STATUS_LABELS[s.status] ?? s.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right">
                        <ArrowRight className="h-4 w-4 text-muted-foreground" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3">
          <h2 className="text-lg sm:text-xl font-semibold tracking-tight">{t.logistics.shipmentsTitle}</h2>
          <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
            <DialogTrigger asChild>
              <Button><Plus className="mr-2 h-4 w-4" /> {t.logistics.newShipment}</Button>
            </DialogTrigger>
            <DialogContent>
              <form onSubmit={handleCreateShipment}>
                <DialogHeader>
                  <DialogTitle>{t.logistics.newShipment}</DialogTitle>
                </DialogHeader>
                <div className="grid gap-4 py-4">
                  <div className="grid gap-2">
                    <Label htmlFor="carrier">{t.logistics.carrier}</Label>
                    <Input id="carrier" name="carrier" required placeholder="JNE, TIKI, SiCepat..." />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="origin">{t.logistics.origin}</Label>
                    <Input id="origin" name="origin" required placeholder="Jakarta" />
                  </div>
                  <div className="grid gap-2">
                    <Label htmlFor="destination">{t.logistics.destination}</Label>
                    <Input id="destination" name="destination" required placeholder="Surabaya" />
                  </div>
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={createShipment.isPending}>
                    {createShipment.isPending ? t.common.saving : t.common.save}
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.logistics.trackingNumber}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t.logistics.carrier}</TableHead>
                  <TableHead className="hidden sm:table-cell">{t.logistics.origin} → {t.logistics.destination}</TableHead>
                  <TableHead>{t.logistics.deliveryStatus}</TableHead>
                  <TableHead className="text-right">{t.common.actions}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  Array.from({ length: 4 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell><Skeleton className="h-4 w-[120px]" /></TableCell>
                      <TableCell className="hidden sm:table-cell"><Skeleton className="h-4 w-[100px]" /></TableCell>
                      <TableCell className="hidden sm:table-cell"><Skeleton className="h-4 w-[150px]" /></TableCell>
                      <TableCell><Skeleton className="h-6 w-[100px] rounded-full" /></TableCell>
                      <TableCell className="text-right"><Skeleton className="h-8 w-[80px] ml-auto rounded-md" /></TableCell>
                    </TableRow>
                  ))
                ) : !shipments || shipments.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-32 text-center">
                      <div className="flex flex-col items-center justify-center text-muted-foreground">
                        <Navigation2 className="h-8 w-8 mb-2 opacity-50" />
                        <p>{t.logistics.noShipments}</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  shipments.map((shipment) => (
                    <TableRow key={shipment.id} className="cursor-pointer" onClick={() => navigate(`/logistics/freight/${shipment.id}`)}>
                      <TableCell className="font-mono text-sm font-medium">
                        <div>{shipment.trackingNumber}</div>
                        <div className="sm:hidden font-normal font-sans text-xs text-muted-foreground mt-0.5">
                          {shipment.origin} → {shipment.destination}
                        </div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">{shipment.carrier}</TableCell>
                      <TableCell className="hidden sm:table-cell">
                        <div className="flex items-center gap-2 text-sm">
                          <span className="text-muted-foreground">{shipment.origin}</span>
                          <span>-&gt;</span>
                          <span className="font-medium">{shipment.destination}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={`capitalize ${getStatusColor(shipment.status)}`}>
                          {shipment.status.replace(/_/g, ' ')}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right" onClick={(e) => e.stopPropagation()}>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="outline" size="sm" className="h-8">
                              <RefreshCw className="mr-2 h-3.5 w-3.5" />
                              Update
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {statuses.map(s => (
                              <DropdownMenuItem key={s} onClick={() => handleStatusChange(shipment.id, s)} className="capitalize">
                                Tandai: {s.replace(/_/g, ' ')}
                              </DropdownMenuItem>
                            ))}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>

      </div>
    </AppShell>
  );
}
