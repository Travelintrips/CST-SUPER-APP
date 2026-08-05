import { useCallback, useState, useEffect, type ElementType, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { getLastResponseTime, useListLogisticOrders } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ShoppingCart, DollarSign, Truck, Package, Activity, AlertTriangle, ChevronRight, Ship, ArrowRight, Clock, RefreshCw, TrendingUp, TrendingDown, Minus, PackageOpen, ChevronDown, ChevronUp, FilePlus, X, Users, CheckCircle2, CircleDot, FileText, BarChart2, ExternalLink, Globe, LayoutGrid, Receipt, GripVertical, Settings2, Eye, EyeOff } from "lucide-react";
import { useCompany } from "@/contexts/CompanyContext";
import { useQueryClient } from "@tanstack/react-query";
import { useUpdateLogisticOrderStatus, useCreateSalesDocument, getListLogisticOrdersQueryKey } from "@workspace/api-client-react";
import type { LogisticOrder } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Select as StatusSelect, SelectContent as StatusSelectContent, SelectItem as StatusSelectItem, SelectTrigger as StatusSelectTrigger, SelectValue as StatusSelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { useLanguage } from "@/contexts/LanguageContext";
import GeofenceAlertBanner from "@/components/logistics/GeofenceAlertBanner";
import { OrderProgressBar } from "@/components/logistics/OrderProgressBar";
import { TasksWidget } from "@/components/dashboard/TasksWidget";
import { RecentActivitiesWidget } from "@/components/dashboard/RecentActivitiesWidget";
import { AiInsightsWidget } from "@/components/dashboard/AiInsightsWidget";
import { OrderPipelineWidget } from "@/components/dashboard/OrderPipelineWidget";
import { QuickActionsWidget } from "@/components/dashboard/QuickActionsWidget";
import { SportCenterWidget } from "@/components/dashboard/SportCenterWidget";
import { PosWidget } from "@/components/dashboard/PosWidget";
import { AccountingWidget } from "@/components/dashboard/AccountingWidget";
import { LogisticsWidget } from "@/components/dashboard/LogisticsWidget";
import { PurchasingWidget } from "@/components/dashboard/PurchasingWidget";
import { SalesWidget } from "@/components/dashboard/SalesWidget";
import { ProfitLossComparisonWidget } from "@/components/dashboard/ProfitLossComparisonWidget";
import { QuickCreateWidget } from "@/components/dashboard/QuickCreateWidget";
import { QuickAccessWidget } from "@/components/dashboard/QuickAccessWidget";
import { RecentPagesWidget } from "@/components/dashboard/RecentPagesWidget";
import { MyWorkspaceWidget } from "@/components/dashboard/MyWorkspaceWidget";

interface ResponseTimeEntry {
  timestamp: string;
  path: string;
  durationMs: number;
}

interface PathStat {
  path: string;
  count: number;
  minMs: number;
  maxMs: number;
  avgMs: number;
  p95Ms: number;
}

const SLOW_THRESHOLD_MS = 500;

async function fetchResponseTimeTrend(): Promise<ResponseTimeEntry[]> {
  const res = await fetch("/api/dashboard/response-times?path=dashboard/summary");
  if (!res.ok) return [];
  const data = (await res.json()) as { entries: ResponseTimeEntry[] };
  return data.entries;
}

const RT_WINDOWS = [
  { label: "24 jam", value: "24h" },
  { label: "7 hari", value: "7d" },
  { label: "30 hari", value: "30d" },
] as const;
type RtWindow = typeof RT_WINDOWS[number]["value"];

async function fetchResponseTimeStats(window: RtWindow): Promise<PathStat[]> {
  const res = await fetch(`/api/dashboard/response-time-stats?window=${window}`);
  if (!res.ok) return [];
  const data = (await res.json()) as { stats: PathStat[] };
  return data.stats;
}

function rtColor(ms: number): string {
  if (ms < 200) return "text-emerald-500";
  if (ms < 500) return "text-amber-500";
  return "text-destructive";
}

function rtBg(ms: number): string {
  if (ms < 200) return "bg-emerald-500";
  if (ms < 500) return "bg-amber-500";
  return "bg-destructive";
}

const STORAGE_KEY = "dashboard_refresh_interval";

const INTERVAL_OPTIONS = [
  { label: "30 detik", value: "30000" },
  { label: "1 menit", value: "60000" },
  { label: "5 menit", value: "300000" },
  { label: "Mati", value: "off" },
] as const;

type IntervalValue = typeof INTERVAL_OPTIONS[number]["value"];

function getStoredInterval(): IntervalValue {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && INTERVAL_OPTIONS.some((o) => o.value === stored)) {
      return stored as IntervalValue;
    }
  } catch {
    /* ignore */
  }
  return "60000";
}

// ── Dashboard Summary Types ───────────────────────────────────────────────────
interface CompanyBreakdownItem {
  companyId: number;
  companyName: string;
  companyCode: string;
  revenueThisMonth: number;
  revenuePrevMonth: number;
  ordersThisMonth: number;
  totalRevenue: number;
  contributionPct: number;
}

interface PerCompanyEntry {
  companyId: number;
  companyName: string;
  companyCode: string;
  revenueThisMonth: number;
  revenuePrevMonth: number;
  ordersThisMonth: number;
  totalRevenue: number;
  contributionPct: number;
}

interface DashboardSummary {
  isConsolidated: boolean;
  scopeCompanyId: number | null;
  ordersThisMonth: number;
  contribution: number;
  totalOrders: number;
  totalRevenue: number;
  totalShipments: number;
  totalStockValue: number;
  todayTransactions: number;
  lowStockCount: number;
  activeFreightCount: number;
  awaitingQuoteCount: number;
  inTransitCount: number;
  salesRevenueThisMonth: number;
  salesRevenuePrevMonth: number;
  salesOrdersThisMonth: number;
  salesOrdersPrevMonth: number;
  quotesActive: number;
  salesOrdersConfirmed: number;
  monthlyRevenueTrend: { month: string; revenue: number }[];
  companyBreakdown: CompanyBreakdownItem[];
  consolidated?: boolean;
  companyId?: number | null;
  perCompany?: PerCompanyEntry[];
}

export default function DashboardPage() {
  const { t } = useLanguage();
  const { companyQueryParam, isConsolidated, activeCompany } = useCompany();
  const [intervalValue, setIntervalValue] = useState<IntervalValue>(getStoredInterval);

  const refetchInterval = intervalValue === "off" ? false : Number(intervalValue);

  const { data: summary, isLoading, isFetching, refetch, dataUpdatedAt } = useQuery<DashboardSummary>({
    queryKey: ["dashboard-summary", companyQueryParam],
    queryFn: async () => {
      const res = await fetch(`/api/dashboard/summary?${companyQueryParam}`, { credentials: "include" });
      if (!res.ok) throw new Error("Gagal mengambil data dashboard");
      return res.json() as Promise<DashboardSummary>;
    },
    staleTime: 60_000,
    refetchInterval,
  });

  const lastUpdated = dataUpdatedAt ? new Date(dataUpdatedAt) : null;

  const [responseTime, setResponseTime] = useState<string | null>(null);
  const responseTimeMs = responseTime ? parseFloat(responseTime) : null;
  const responseTimeColor = responseTimeMs === null ? "" : responseTimeMs < 200 ? "text-emerald-500" : responseTimeMs <= 500 ? "text-amber-500" : "text-destructive";

  useEffect(() => {
    if (!dataUpdatedAt) return;
    const rt = getLastResponseTime("/api/dashboard/summary");
    if (rt) setResponseTime(rt);
  }, [dataUpdatedAt]);

  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  useEffect(() => {
    if (intervalValue === "off" || !dataUpdatedAt) {
      setSecondsLeft(null);
      return;
    }
    const intervalMs = Number(intervalValue);
    const tick = () => {
      const remaining = Math.round((dataUpdatedAt + intervalMs - Date.now()) / 1000);
      setSecondsLeft(Math.max(0, remaining));
    };
    tick();
    const id = setInterval(tick, 1000);
    return () => clearInterval(id);
  }, [dataUpdatedAt, intervalValue]);

  const formatCountdown = (secs: number): string => {
    if (secs <= 0) return "sebentar lagi";
    if (secs < 60) return `${secs}d`;
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return s > 0 ? `${m}m ${s}d` : `${m}m`;
  };

  const handleRefresh = useCallback(async () => {
    await refetch();
  }, [refetch]);

  const handleIntervalChange = (value: string) => {
    const v = value as IntervalValue;
    setIntervalValue(v);
    try {
      localStorage.setItem(STORAGE_KEY, v);
    } catch {
      /* ignore */
    }
  };

  const { data: rtEntries = [], refetch: refetchRt } = useQuery({
    queryKey: ["dashboard-response-times"],
    queryFn: fetchResponseTimeTrend,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const [rtWindow, setRtWindow] = useState<RtWindow>("24h");

  const { data: rtStats = [], refetch: refetchStats } = useQuery({
    queryKey: ["dashboard-response-time-stats", rtWindow],
    queryFn: () => fetchResponseTimeStats(rtWindow),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  useEffect(() => {
    if (dataUpdatedAt) { void refetchRt(); void refetchStats(); }
  }, [dataUpdatedAt, refetchRt, refetchStats]);

  const activeFreightCount = summary?.activeFreightCount ?? 0;
  const awaitingQuoteCount = summary?.awaitingQuoteCount ?? 0;
  const inTransitCount = summary?.inTransitCount ?? 0;
  const companyBreakdown = summary?.companyBreakdown ?? [];

  const { data: portalOrders = [], isLoading: portalLoading, refetch: refetchPortal } = useListLogisticOrders(undefined, {
    query: { queryKey: getListLogisticOrdersQueryKey(), refetchInterval },
  });

  interface DashDriver { id: number; name: string; phone: string | null; vehiclePlate: string | null; vehicleType: string | null; isActive: boolean; }
  interface DashActiveJob { id: number; jobNumber: string; driverId: number; customerName: string | null; status: string; }
  const { data: dashDrivers = [], isLoading: driversLoading, refetch: refetchDrivers } = useQuery<DashDriver[]>({
    queryKey: ["dashboard-drivers"],
    queryFn: async () => {
      const res = await fetch("/api/drivers");
      return res.ok ? res.json() as Promise<DashDriver[]> : [];
    },
    staleTime: 30_000,
    refetchInterval,
  });
  const { data: dashJobs = [] } = useQuery<DashActiveJob[]>({
    queryKey: ["dashboard-driver-jobs"],
    queryFn: async () => {
      const res = await fetch("/api/drivers/jobs/list");
      return res.ok ? res.json() as Promise<DashActiveJob[]> : [];
    },
    staleTime: 30_000,
    refetchInterval,
  });
  const activeJobByDriver = dashJobs.reduce<Record<number, DashActiveJob>>((acc, job) => {
    if (job.status !== "COMPLETED" && job.status !== "CANCELLED") {
      if (!acc[job.driverId]) acc[job.driverId] = job;
    }
    return acc;
  }, {});
  const activeDrivers = dashDrivers.filter((d) => d.isActive);
  const driversBusy = activeDrivers.filter((d) => activeJobByDriver[d.id]).length;
  const driversAvail = activeDrivers.length - driversBusy;
  const portalNew = portalOrders.filter((o) => o.status === "New Order").length;
  const portalInProgress = portalOrders.filter((o) => o.status === "In Progress").length;
  const portalCompleted = portalOrders.filter((o) => o.status === "Completed").length;
  const portalCancelled = portalOrders.filter((o) => o.status === "Cancelled").length;

  const [selectedPortalStatus, setSelectedPortalStatus] = useState<string | null>(null);
  const [soDialog, setSoDialog] = useState<LogisticOrder | null>(null);
  const [updatingId, setUpdatingId] = useState<number | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const updateStatus = useUpdateLogisticOrderStatus();
  const createSalesDoc = useCreateSalesDocument();

  const portalDetailOrders = selectedPortalStatus === "all"
    ? [...portalOrders].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    : [...portalOrders]
        .filter((o) => o.status === selectedPortalStatus)
        .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  function handlePortalStatusChange(id: number, status: string) {
    setUpdatingId(id);
    const order = portalOrders.find((o) => o.id === id);
    updateStatus.mutate(
      { id, data: { status, clientUpdatedAt: order?.updatedAt } },
      {
        onSuccess: () => {
          toast({ title: t.common.success });
          queryClient.invalidateQueries({ queryKey: getListLogisticOrdersQueryKey() });
          void refetchPortal();
        },
        onError: () => toast({ title: t.common.error, variant: "destructive" }),
        onSettled: () => setUpdatingId(null),
      },
    );
  }

  function handleCreateSalesOrder() {
    if (!soDialog) return;
    const o = soDialog;
    createSalesDoc.mutate(
      {
        data: {
          kind: "order",
          customerName: o.companyName || o.customerName,
          origin: o.origin,
          destination: o.destination,
          notes: [
            `Ref Portal Order: ${o.orderNumber}`,
            `Tipe: ${o.shipmentType}`,
            o.commodity ? `Komoditi: ${o.commodity}` : null,
            o.cargoDescription ? `Kargo: ${o.cargoDescription}` : null,
            o.notes ?? null,
          ].filter(Boolean).join(" | "),
          lines: [
            {
              name: `Jasa Logistik ${o.shipmentType} — ${o.origin} → ${o.destination}`,
              description: `Portal Order #${o.orderNumber} (${o.customerName})`,
              quantity: 1,
              unitPrice: o.grandTotal,
            },
          ],
          logisticOrderId: o.id,
        } as Parameters<typeof createSalesDoc.mutate>[0]["data"],
      },
      {
        onSuccess: (doc) => {
          toast({ title: t.common.success, description: doc.docNumber });
          setSoDialog(null);
          queryClient.invalidateQueries({ queryKey: getListLogisticOrdersQueryKey() });
        },
        onError: (err: unknown) => {
          const msg = (err as { response?: { data?: { message?: string; existingDocNumber?: string } } })?.response?.data;
          if (msg?.existingDocNumber) {
            toast({ title: "SO sudah ada", description: `Sales Order ${msg.existingDocNumber} sudah pernah dibuat untuk order ini.`, variant: "destructive" });
            setSoDialog(null);
          } else {
            toast({ title: t.common.error, variant: "destructive" });
          }
        },
      },
    );
  }

  const STATUS_OPTIONS_PORTAL = ["New Order", "Confirmed", "In Progress", "Completed", "Cancelled"];
  const STATUS_COLORS_PORTAL: Record<string, string> = {
    "New Order":   "bg-yellow-100 text-yellow-800 border-yellow-200",
    "Confirmed":   "bg-blue-100 text-blue-800 border-blue-200",
    "In Progress": "bg-orange-100 text-orange-800 border-orange-200",
    "Completed":   "bg-green-100 text-green-800 border-green-200",
    "Cancelled":   "bg-red-100 text-red-800 border-red-200",
  };

  const formatIDR = (value: number) => {
    return new Intl.NumberFormat('id-ID', {
      style: 'currency',
      currency: 'IDR',
      minimumFractionDigits: 0,
      maximumFractionDigits: 0
    }).format(value);
  };

  const formatNumber = (value: number) => {
    return new Intl.NumberFormat('id-ID').format(value);
  };

  const formatLastUpdated = (date: Date) => {
    return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <PageHeader
          title={t.dashboard.title}
          description={t.dashboard.subtitle}
          favoriteEnabled
          actions={
            <div className="flex flex-col items-end gap-1.5">
              <div className="flex items-center gap-2">
                {isConsolidated && (
                  <Badge className="bg-purple-100 text-purple-800 border border-purple-200 gap-1 text-xs font-medium">
                    <LayoutGrid className="h-3 w-3" /> Holding Consolidated
                  </Badge>
                )}
                <Select value={intervalValue} onValueChange={handleIntervalChange}>
                  <SelectTrigger
                    className="h-8 w-[120px] text-xs"
                    data-testid="dashboard-refresh-interval-select"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {INTERVAL_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value} className="text-xs">
                        {option.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleRefresh}
                  disabled={isFetching}
                  data-testid="dashboard-refresh-btn"
                  className="gap-1.5 h-8"
                >
                  <RefreshCw className={`h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
                  {isFetching ? t.common.loading : t.common.refresh}
                </Button>
              </div>
              {!isLoading && lastUpdated && (
                <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                  <span>{t.dashboard.updatedAt}: {formatLastUpdated(lastUpdated)}</span>
                  {secondsLeft !== null && (
                    <>
                      <span className="text-muted-foreground/40">·</span>
                      <span className="flex items-center gap-0.5">
                        <Clock className="h-3 w-3" />
                        {t.dashboard.refreshIn} {formatCountdown(secondsLeft)}
                      </span>
                    </>
                  )}
                  {responseTime && (
                    <>
                      <span className="text-muted-foreground/40">·</span>
                      <span className={`flex items-center gap-0.5 ${responseTimeColor}`}>
                        <Activity className="h-3 w-3" />
                        {t.dashboard.loadedIn} {responseTime}
                      </span>
                    </>
                  )}
                </p>
              )}
            </div>
          }
        />

        {/* ── Geofence Alert Banner ── */}
        <GeofenceAlertBanner />

        {/* ── Quick Nav ── */}
        <DashboardQuickNav />

        {/* ── Quick Create ── */}
        <QuickCreateWidget />

        {/* ── Quick Access (Favorites) ── */}
        <QuickAccessWidget />

        {/* ── Recently Opened ── */}
        <RecentPagesWidget />

        {/* ── My Workspace ── */}
        <MyWorkspaceWidget />

        {/* ── KPI Hero Section ── */}
        {(() => {
          const salesRevThis = summary?.salesRevenueThisMonth ?? 0;
          const salesRevPrev = summary?.salesRevenuePrevMonth ?? 0;
          const salesOrdThis = summary?.salesOrdersThisMonth ?? 0;
          const salesOrdPrev = summary?.salesOrdersPrevMonth ?? 0;
          const quotesAct = summary?.quotesActive ?? 0;
          const ordersConf = summary?.salesOrdersConfirmed ?? 0;
          const trend = summary?.monthlyRevenueTrend ?? [];

          const revDiff = salesRevPrev > 0 ? ((salesRevThis - salesRevPrev) / salesRevPrev) * 100 : null;
          const ordDiff = salesOrdPrev > 0 ? ((salesOrdThis - salesOrdPrev) / salesOrdPrev) * 100 : null;

          function TrendBadge({ diff }: { diff: number | null }) {
            if (diff === null) return <span className="text-xs text-muted-foreground">—</span>;
            if (diff > 0) return (
              <span className="inline-flex items-center gap-0.5 text-xs text-emerald-600 font-medium">
                <TrendingUp className="h-3.5 w-3.5" />+{diff.toFixed(1)}%
              </span>
            );
            if (diff < 0) return (
              <span className="inline-flex items-center gap-0.5 text-xs text-destructive font-medium">
                <TrendingDown className="h-3.5 w-3.5" />{diff.toFixed(1)}%
              </span>
            );
            return <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground"><Minus className="h-3.5 w-3.5" />0%</span>;
          }

          return (
            <div className="space-y-3">
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                {/* Revenue Bulan Ini */}
                <Link href="/sales/documents" className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl">
                  <Card className="h-full border-emerald-200/60 bg-gradient-to-br from-emerald-50 to-white hover:shadow-md hover:border-emerald-300 transition-all">
                    <CardContent className="pt-4 pb-3 px-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5">
                          <div className="p-1.5 rounded-lg bg-emerald-100">
                            <DollarSign className="h-3.5 w-3.5 text-emerald-600" />
                          </div>
                          <span className="text-xs font-medium text-muted-foreground">Revenue Bulan Ini</span>
                        </div>
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                      {isLoading
                        ? <Skeleton className="h-7 w-32 bg-muted mb-1" />
                        : <p className="text-xl font-bold text-emerald-700 truncate">{formatIDR(salesRevThis)}</p>
                      }
                      <div className="flex items-center gap-1.5 mt-1">
                        <TrendBadge diff={revDiff} />
                        <span className="text-[10px] text-muted-foreground">vs bulan lalu</span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>

                {/* Orders Terkonfirmasi Bulan Ini */}
                <Link href="/sales/documents?kind=order&status=confirmed" className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl">
                  <Card className="h-full border-blue-200/60 bg-gradient-to-br from-blue-50 to-white hover:shadow-md hover:border-blue-300 transition-all">
                    <CardContent className="pt-4 pb-3 px-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5">
                          <div className="p-1.5 rounded-lg bg-blue-100">
                            <ShoppingCart className="h-3.5 w-3.5 text-blue-600" />
                          </div>
                          <span className="text-xs font-medium text-muted-foreground">Order Bulan Ini</span>
                        </div>
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                      {isLoading
                        ? <Skeleton className="h-7 w-16 bg-muted mb-1" />
                        : <p className="text-3xl font-bold text-blue-700">{formatNumber(salesOrdThis)}</p>
                      }
                      <div className="flex items-center gap-1.5 mt-1">
                        <TrendBadge diff={ordDiff} />
                        <span className="text-[10px] text-muted-foreground">vs bulan lalu</span>
                      </div>
                    </CardContent>
                  </Card>
                </Link>

                {/* Quotation Aktif */}
                <Link href="/sales/documents?kind=quote&status=draft" className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl">
                  <Card className="h-full border-amber-200/60 bg-gradient-to-br from-amber-50 to-white hover:shadow-md hover:border-amber-300 transition-all">
                    <CardContent className="pt-4 pb-3 px-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5">
                          <div className="p-1.5 rounded-lg bg-amber-100">
                            <FileText className="h-3.5 w-3.5 text-amber-600" />
                          </div>
                          <span className="text-xs font-medium text-muted-foreground">Penawaran Aktif</span>
                        </div>
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                      {isLoading
                        ? <Skeleton className="h-7 w-16 bg-muted mb-1" />
                        : <p className="text-3xl font-bold text-amber-700">{formatNumber(quotesAct)}</p>
                      }
                      <p className="text-[10px] text-muted-foreground mt-1">{formatNumber(ordersConf)} order terkonfirmasi</p>
                    </CardContent>
                  </Card>
                </Link>

                {/* Freight Aktif */}
                <Link href="/logistics/freight" className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-xl">
                  <Card className="h-full border-indigo-200/60 bg-gradient-to-br from-indigo-50 to-white hover:shadow-md hover:border-indigo-300 transition-all">
                    <CardContent className="pt-4 pb-3 px-4">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-1.5">
                          <div className="p-1.5 rounded-lg bg-indigo-100">
                            <Ship className="h-3.5 w-3.5 text-indigo-600" />
                          </div>
                          <span className="text-xs font-medium text-muted-foreground">Freight Aktif</span>
                        </div>
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
                      </div>
                      {isLoading
                        ? <Skeleton className="h-7 w-16 bg-muted mb-1" />
                        : <p className="text-3xl font-bold text-indigo-700">{formatNumber(activeFreightCount)}</p>
                      }
                      <div className="flex items-center gap-2 mt-1">
                        {awaitingQuoteCount > 0 && (
                          <span className="text-[10px] text-amber-600">{awaitingQuoteCount} menunggu quote</span>
                        )}
                        {inTransitCount > 0 && (
                          <span className="text-[10px] text-indigo-500">{inTransitCount} dalam transit</span>
                        )}
                        {awaitingQuoteCount === 0 && inTransitCount === 0 && (
                          <span className="text-[10px] text-muted-foreground">Tidak ada pengiriman aktif</span>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                </Link>
              </div>

              {/* Mini Sparkline Revenue 6 Bulan */}
              {!isLoading && trend.length > 0 && (
                <Card className="border-border">
                  <CardHeader className="pb-2 pt-3 px-4">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <BarChart2 className="h-4 w-4 text-muted-foreground" />
                        <CardTitle className="text-sm font-medium">Tren Revenue Sales (6 Bulan Terakhir)</CardTitle>
                      </div>
                      <Button variant="ghost" size="sm" asChild className="h-7 text-xs">
                        <Link href="/sales/documents">Lihat Semua <ArrowRight className="ml-1 h-3.5 w-3.5" /></Link>
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="px-4 pb-3">
                    <RevenueSparkline data={trend} />
                  </CardContent>
                </Card>
              )}
            </div>
          );
        })()}

        {/* ── Consolidated Company Breakdown (hanya tampil saat mode konsolidasi) ── */}
        {isConsolidated && companyBreakdown.length > 0 && (
          <Card className="border-violet-200/60 bg-gradient-to-br from-violet-50/50 to-white">
            <CardHeader className="pb-3 pt-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Globe className="h-4 w-4 text-violet-600" />
                  <CardTitle className="text-sm font-medium text-violet-900">Konsolidasi Per Perusahaan — Bulan Ini</CardTitle>
                </div>
                {!isLoading && (
                  <span className="text-xs text-muted-foreground">{companyBreakdown.length} perusahaan aktif</span>
                )}
              </div>
              <CardDescription className="text-xs">Perbandingan revenue sales order (confirmed/done) antar entitas</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 pb-4">
              {isLoading ? (
                <div className="space-y-2">
                  {[1,2,3].map(i => <Skeleton key={i} className="h-14 w-full" />)}
                </div>
              ) : (
                <>
                  {/* Summary totals */}
                  <div className="grid grid-cols-3 gap-3 pb-2 border-b border-violet-100">
                    <div className="text-center">
                      <p className="text-[10px] text-muted-foreground mb-0.5">Total Revenue Bulan Ini</p>
                      <p className="text-sm font-bold text-violet-700">
                        {formatIDR(companyBreakdown.reduce((s, c) => s + c.revenueThisMonth, 0))}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] text-muted-foreground mb-0.5">Total Order</p>
                      <p className="text-sm font-bold text-blue-700">
                        {formatNumber(companyBreakdown.reduce((s, c) => s + c.ordersThisMonth, 0))}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-[10px] text-muted-foreground mb-0.5">Perusahaan Aktif</p>
                      <p className="text-sm font-bold text-slate-700">{companyBreakdown.length}</p>
                    </div>
                  </div>

                  {/* Per-company bars */}
                  <div className="space-y-2.5">
                    {companyBreakdown.map((co) => {
                      const prevDiff = co.revenuePrevMonth > 0
                        ? ((co.revenueThisMonth - co.revenuePrevMonth) / co.revenuePrevMonth) * 100
                        : null;
                      return (
                        <div key={co.companyId} className="space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded bg-indigo-100 text-indigo-700 text-[9px] font-bold">
                                {co.companyCode.slice(0, 3).toUpperCase()}
                              </div>
                              <span className="text-xs font-medium text-slate-700 truncate">{co.companyName}</span>
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {prevDiff !== null && (
                                <span className={`text-[10px] font-medium ${prevDiff > 0 ? "text-emerald-600" : prevDiff < 0 ? "text-destructive" : "text-muted-foreground"}`}>
                                  {prevDiff > 0 ? "+" : ""}{prevDiff.toFixed(1)}%
                                </span>
                              )}
                              <span className="text-xs font-semibold text-slate-800 tabular-nums">{formatIDR(co.revenueThisMonth)}</span>
                              <span className="text-[10px] text-muted-foreground w-8 text-right tabular-nums">{co.contributionPct}%</span>
                            </div>
                          </div>
                          {/* Contribution bar */}
                          <div className="h-1.5 w-full bg-violet-100 rounded-full overflow-hidden">
                            <div
                              className="h-full rounded-full bg-gradient-to-r from-violet-500 to-indigo-500 transition-all duration-500"
                              style={{ width: `${co.contributionPct}%` }}
                            />
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        )}

        {/* ── Holding Consolidated Breakdown ── */}
        {isConsolidated && summary?.perCompany && summary.perCompany.length > 0 && (
          <Card className="border-purple-200/60">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2">
                <LayoutGrid className="h-5 w-5 text-purple-600" />
                <CardTitle className="text-base">Revenue per Perusahaan — Bulan Ini</CardTitle>
              </div>
              <CardDescription className="text-xs">Perbandingan kontribusi revenue masing-masing perusahaan</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {summary.perCompany.map((co) => {
                const barW = Math.max(co.contributionPct, 2);
                return (
                  <div key={co.companyId} className="space-y-1">
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="inline-flex h-5 w-12 shrink-0 items-center justify-center rounded bg-indigo-100 text-indigo-700 text-[10px] font-bold">
                          {co.companyCode.slice(0, 3).toUpperCase()}
                        </span>
                        <span className="font-medium truncate">{co.companyName}</span>
                      </div>
                      <div className="flex items-center gap-3 shrink-0 text-right">
                        <span className="text-xs text-muted-foreground">{co.ordersThisMonth} order</span>
                        <span className="font-semibold text-emerald-700 tabular-nums">
                          {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(co.revenueThisMonth)}
                        </span>
                        <span className="text-xs font-medium text-purple-700 w-8 text-right">{co.contributionPct}%</span>
                      </div>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-indigo-500 to-purple-500 transition-all duration-500"
                        style={{ width: `${barW}%` }}
                      />
                    </div>
                  </div>
                );
              })}
              {/* Total row */}
              <div className="pt-2 border-t border-border flex items-center justify-between text-sm font-semibold">
                <span>Total Holding</span>
                <span className="text-emerald-700 tabular-nums">
                  {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(
                    summary.perCompany.reduce((s, c) => s + c.revenueThisMonth, 0)
                  )}
                </span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Portal Orders — always at the TOP ── */}
        <Card className="border-primary/20">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <PackageOpen className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">{t.dashboard.portalOrdersTitle}</CardTitle>
                {portalNew > 0 && (
                  <Badge className="bg-yellow-100 text-yellow-800 border border-yellow-200 text-xs">
                    {portalNew} {t.common.new}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" className="gap-1.5 h-7 text-xs" onClick={() => void refetchPortal()}>
                  <RefreshCw className="h-3 w-3" /> {t.common.refresh}
                </Button>
                <Button variant="ghost" size="sm" asChild className="h-7 text-xs">
                  <Link href="/logistics/portal-orders">
                    {t.logistics.viewAll} <ArrowRight className="ml-1 h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>
            </div>
            <CardDescription>{t.dashboard.portalOrdersTitle}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* 4 clickable stat cards */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { key: "all",         label: t.common.all,          value: portalOrders.length,  color: "text-slate-900",     bg: "bg-slate-50 hover:bg-slate-100",         ring: "ring-slate-300"  },
                { key: "New Order",   label: t.common.new,          value: portalNew,             color: "text-yellow-700",    bg: "bg-yellow-50 hover:bg-yellow-100",       ring: "ring-yellow-400" },
                { key: "In Progress", label: t.common.inProgress,   value: portalInProgress,      color: "text-orange-700",    bg: "bg-orange-50 hover:bg-orange-100",       ring: "ring-orange-400" },
                { key: "Completed",   label: t.common.completed,    value: portalCompleted,       color: "text-green-700",     bg: "bg-green-50 hover:bg-green-100",         ring: "ring-green-500"  },
              ].map((s) => {
                const isSelected = selectedPortalStatus === s.key;
                return (
                  <button
                    key={s.key}
                    onClick={() => setSelectedPortalStatus(isSelected ? null : s.key)}
                    className={`rounded-xl border-2 p-4 text-left transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring
                      ${isSelected ? `${s.bg} ring-2 ${s.ring} border-transparent shadow-md` : `border-border ${s.bg}`}
                    `}
                  >
                    <p className="text-xs text-muted-foreground mb-1 font-medium">{s.label}</p>
                    {portalLoading
                      ? <Skeleton className="h-7 w-10 bg-muted" />
                      : <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                    }
                    <p className="text-[10px] text-muted-foreground mt-1.5 flex items-center gap-0.5">
                      {isSelected
                        ? <><ChevronUp className="h-3 w-3" /> {t.common.close}</>
                        : <><ChevronDown className="h-3 w-3" /> {t.common.view}</>
                      }
                    </p>
                  </button>
                );
              })}
            </div>

            {/* Inline detail panel — shown when a card is selected */}
            {selectedPortalStatus && (
              <div className="rounded-xl border border-border overflow-hidden bg-background">
                <div className="px-4 py-2.5 border-b border-border bg-muted/40 flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">
                    {selectedPortalStatus === "all" ? t.dashboard.allPortalOrders : `${t.logistics.deliveryStatus}: ${selectedPortalStatus}`}
                    <span className="ml-2 text-xs font-normal text-muted-foreground">({portalDetailOrders.length} {t.dashboard.totalOrders})</span>
                  </p>
                  <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => setSelectedPortalStatus(null)}>
                    <X className="h-3.5 w-3.5" />
                  </Button>
                </div>

                {portalLoading ? (
                  <div className="p-4 space-y-2">
                    {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-12 w-full bg-muted" />)}
                  </div>
                ) : portalDetailOrders.length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    {t.dashboard.noOrdersForStatus}
                  </div>
                ) : (
                  <div className="divide-y divide-border/60">
                    {portalDetailOrders.map((o) => (
                      <div key={o.id} className="px-4 pt-3 pb-2">
                        <div className="flex flex-wrap md:flex-nowrap items-start md:items-center gap-3">
                          {/* Order info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-xs text-muted-foreground">{o.orderNumber}</span>
                              <Badge className={`text-[10px] px-1.5 py-0 border ${STATUS_COLORS_PORTAL[o.status] ?? "bg-gray-100 text-gray-700 border-gray-200"}`}>
                                {o.status}
                              </Badge>
                            </div>
                            <p className="text-sm font-medium truncate mt-0.5">{o.customerName}
                              {o.companyName ? <span className="text-muted-foreground font-normal"> · {o.companyName}</span> : null}
                            </p>
                            <p className="text-xs text-muted-foreground truncate">{o.origin} → {o.destination} · {o.shipmentType}</p>
                          </div>

                          {/* Amount + date */}
                          <div className="text-right shrink-0 hidden sm:block">
                            <p className="text-sm font-semibold">
                              {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(o.grandTotal)}
                            </p>
                            <p className="text-xs text-muted-foreground">
                              {new Date(o.createdAt).toLocaleDateString("id-ID", { day: "2-digit", month: "short", year: "numeric" })}
                            </p>
                          </div>

                          {/* Actions */}
                          <div className="flex items-center gap-2 shrink-0">
                            <StatusSelect
                              value={o.status}
                              onValueChange={(v) => handlePortalStatusChange(o.id, v)}
                              disabled={updatingId === o.id}
                            >
                              <StatusSelectTrigger className="h-7 w-32 text-xs">
                                <StatusSelectValue />
                              </StatusSelectTrigger>
                              <StatusSelectContent>
                                {STATUS_OPTIONS_PORTAL.map((s) => (
                                  <StatusSelectItem key={s} value={s} className="text-xs">{s}</StatusSelectItem>
                                ))}
                              </StatusSelectContent>
                            </StatusSelect>
                            <Button
                              size="sm"
                              variant="outline"
                              className="gap-1.5 text-xs h-7 whitespace-nowrap"
                              onClick={() => setSoDialog(o)}
                              disabled={o.status === "Cancelled"}
                            >
                              <FilePlus className="h-3.5 w-3.5" /> {t.dashboard.createSalesOrder}
                            </Button>
                          </div>
                        </div>
                        {/* Progress bar */}
                        <div className="mt-2">
                          <OrderProgressBar
                            orderId={o.id}
                            onUpdate={() => refetchPortal()}
                            order={{
                              status: o.status,
                              latestRfq: (o as any).latestRfq ?? null,
                              fulfillmentStatus: (o as any).fulfillmentStatus ?? null,
                              linkedSalesDocId: (o as any).linkedSalesDocId ?? null,
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Manajemen Driver ── */}
        <Card className="border-border">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary" />
                <CardTitle className="text-base">{t.dashboard.driverStatus}</CardTitle>
                {driversBusy > 0 && (
                  <Badge className="bg-orange-100 text-orange-800 border border-orange-200 text-xs">
                    {driversBusy} {t.common.inProgress}
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" className="gap-1.5 h-7 text-xs" onClick={() => void refetchDrivers()}>
                  <RefreshCw className="h-3 w-3" /> {t.common.refresh}
                </Button>
                <Button variant="ghost" size="sm" asChild className="h-7 text-xs">
                  <Link href="/logistics/drivers">
                    {t.dashboard.driverStatus} <ArrowRight className="ml-1 h-3.5 w-3.5" />
                  </Link>
                </Button>
              </div>
            </div>
            <CardDescription>{t.dashboard.driverStatus}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {/* Summary chips */}
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: t.dashboard.driverStatus, value: dashDrivers.length, icon: <Users className="h-4 w-4 text-slate-500" />, color: "text-slate-900", bg: "bg-slate-50" },
                { label: t.dashboard.available, value: driversAvail, icon: <CheckCircle2 className="h-4 w-4 text-emerald-500" />, color: "text-emerald-700", bg: "bg-emerald-50" },
                { label: t.dashboard.busy, value: driversBusy, icon: <CircleDot className="h-4 w-4 text-orange-500" />, color: "text-orange-700", bg: "bg-orange-50" },
              ].map((s) => (
                <div key={s.label} className={`rounded-xl border border-border p-4 ${s.bg}`}>
                  <div className="flex items-center gap-1.5 mb-1">
                    {s.icon}
                    <p className="text-xs text-muted-foreground font-medium">{s.label}</p>
                  </div>
                  {driversLoading
                    ? <Skeleton className="h-7 w-10 bg-muted" />
                    : <p className={`text-2xl font-bold ${s.color}`}>{s.value}</p>
                  }
                </div>
              ))}
            </div>

            {/* Driver list */}
            {driversLoading ? (
              <div className="space-y-2">
                {[1, 2, 3].map((i) => <Skeleton key={i} className="h-12 w-full bg-muted" />)}
              </div>
            ) : activeDrivers.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4 text-center">{t.dashboard.noActiveDrivers}</p>
            ) : (
              <div className="rounded-xl border border-border overflow-hidden divide-y divide-border/60">
                {activeDrivers.map((d) => {
                  const job = activeJobByDriver[d.id];
                  return (
                    <div key={d.id} className="px-4 py-3 flex flex-wrap md:flex-nowrap items-center gap-3">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm truncate">{d.name}</span>
                          {job ? (
                            <Badge className="text-[10px] px-1.5 py-0 border bg-orange-100 text-orange-800 border-orange-200 shrink-0">
                              {t.dashboard.busy}
                            </Badge>
                          ) : (
                            <Badge className="text-[10px] px-1.5 py-0 border bg-emerald-100 text-emerald-800 border-emerald-200 shrink-0">
                              {t.dashboard.available}
                            </Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground truncate">
                          {[d.vehicleType, d.vehiclePlate].filter(Boolean).join(" · ") || t.logistics.vehicle}
                          {d.phone ? ` · ${d.phone}` : ""}
                        </p>
                      </div>
                      {job && (
                        <div className="text-xs text-muted-foreground shrink-0 text-right">
                          <p className="font-mono">{job.jobNumber}</p>
                          <p className="truncate max-w-[160px]">{job.customerName ?? "—"}</p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="grid gap-3 sm:gap-4 grid-cols-2 lg:grid-cols-3">
          <StatCard
            title={t.dashboard.totalRevenue}
            href="/ecommerce?tab=orders"
            icon={<DollarSign className="h-4 w-4 text-emerald-500" />}
            isLoading={isLoading}
            value={formatIDR(summary?.totalRevenue || 0)}
            testId="stat-revenue"
          />

          <StatCard
            title={t.dashboard.totalOrders}
            href="/ecommerce?tab=orders"
            icon={<ShoppingCart className="h-4 w-4 text-blue-500" />}
            isLoading={isLoading}
            value={formatNumber(summary?.totalOrders || 0)}
            testId="stat-orders"
          />

          <StatCard
            title={t.dashboard.pendingShipments}
            href="/logistics"
            icon={<Truck className="h-4 w-4 text-indigo-500" />}
            isLoading={isLoading}
            value={formatNumber(summary?.totalShipments || 0)}
            testId="stat-shipments"
          />

          <StatCard
            title={t.trading.stock}
            href="/trading"
            icon={<Package className="h-4 w-4 text-violet-500" />}
            isLoading={isLoading}
            value={formatIDR(summary?.totalStockValue || 0)}
            testId="stat-stock-value"
          />

          <StatCard
            title={t.pos.txCount}
            href="/kasir"
            icon={<Activity className="h-4 w-4 text-amber-500" />}
            isLoading={isLoading}
            value={formatNumber(summary?.todayTransactions || 0)}
            testId="stat-today-tx"
          />

          <StatCard
            title={t.dashboard.activeCustomers}
            href="/trading"
            icon={<AlertTriangle className="h-4 w-4 text-destructive" />}
            isLoading={isLoading}
            value={formatNumber(summary?.lowStockCount || 0)}
            valueClassName="text-destructive"
            titleClassName="text-destructive"
            testId="stat-low-stock"
          />
        </div>

        {/* Freight Forwarding Mini-Card */}
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
            {isLoading ? (
              <div className="grid grid-cols-3 gap-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className="space-y-1">
                    <Skeleton className="h-7 w-10 bg-muted" />
                    <Skeleton className="h-4 w-24 bg-muted" />
                  </div>
                ))}
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-4">
                <Link href="/logistics/freight?status=active" className="group block rounded-lg p-2 -m-2 transition-colors hover:bg-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <div className="space-y-1">
                    <p className="text-2xl font-bold">{activeFreightCount}</p>
                    <p className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">{t.dashboard.activeFreight}</p>
                  </div>
                </Link>
                <Link href="/logistics/freight?status=rfq_sent" className="group block rounded-lg p-2 -m-2 transition-colors hover:bg-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <div className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <p className="text-2xl font-bold text-amber-500">{awaitingQuoteCount}</p>
                      {awaitingQuoteCount > 0 && (
                        <Clock className="h-4 w-4 text-amber-500 shrink-0" />
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">{t.dashboard.awaitingQuote}</p>
                  </div>
                </Link>
                <Link href="/logistics/freight?status=in_transit" className="group block rounded-lg p-2 -m-2 transition-colors hover:bg-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                  <div className="space-y-1">
                    <p className="text-2xl font-bold text-indigo-500">{inTransitCount}</p>
                    <p className="text-xs text-muted-foreground group-hover:text-foreground transition-colors">{t.logistics.statusInTransit}</p>
                  </div>
                </Link>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Dashboard Widgets ── */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SalesWidget />
          <SportCenterWidget />
          <PosWidget />
          <AccountingWidget />
          <ProfitLossComparisonWidget />
          <LogisticsWidget />
          <PurchasingWidget />
          <TasksWidget />
          <RecentActivitiesWidget />
          <AiInsightsWidget />
          <OrderPipelineWidget
            isLoading={isLoading || portalLoading}
            portalNew={portalNew}
            portalInProgress={portalInProgress}
            portalCompleted={portalCompleted}
            portalCancelled={portalCancelled}
            portalTotal={portalOrders.length}
            quotesActive={summary?.quotesActive ?? 0}
            salesOrdersConfirmed={summary?.salesOrdersConfirmed ?? 0}
            salesOrdersThisMonth={summary?.salesOrdersThisMonth ?? 0}
          />
          <div className="lg:col-span-2">
            <QuickActionsWidget />
          </div>
        </div>

        {rtEntries.length > 0 && (
          <ResponseTimeTrendCard entries={rtEntries} />
        )}
        {rtStats.length > 0 && (
          <ResponseTimeStatsCard stats={rtStats} window={rtWindow} onWindowChange={setRtWindow} />
        )}
      </div>

      {/* Create Sales Order Dialog */}
      <Dialog open={!!soDialog} onOpenChange={(open) => { if (!open) setSoDialog(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FilePlus className="h-5 w-5" /> {t.dashboard.createSalesOrder}
            </DialogTitle>
          </DialogHeader>
          {soDialog && (
            <div className="space-y-3 py-2">
              <div className="rounded-lg border bg-muted/40 p-4 space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t.common.number} Order</span>
                  <span className="font-mono font-medium">{soDialog.orderNumber}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t.common.name}</span>
                  <span className="font-medium">{soDialog.customerName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t.common.category}</span>
                  <span>{soDialog.companyName}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t.logistics.origin} → {t.logistics.destination}</span>
                  <span>{soDialog.origin} → {soDialog.destination}</span>
                </div>
                <div className="flex justify-between border-t pt-2 mt-1">
                  <span className="text-muted-foreground font-medium">Total</span>
                  <span className="font-bold text-base">
                    {new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(soDialog.grandTotal)}
                  </span>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                {t.dashboard.createSalesOrder} — status <strong>Draft</strong>.
              </p>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setSoDialog(null)}>{t.common.cancel}</Button>
            {(soDialog as any)?.linkedSalesDocId ? (
              <Button
                variant="secondary"
                className="gap-2"
                onClick={() => { setSoDialog(null); window.location.href = "/sales/orders"; }}
              >
                <ExternalLink className="h-4 w-4" />
                Lihat SO: {(soDialog as any).linkedSalesDocNumber}
              </Button>
            ) : (
              <Button onClick={handleCreateSalesOrder} disabled={createSalesDoc.isPending} className="gap-2">
                <FilePlus className="h-4 w-4" />
                {createSalesDoc.isPending ? t.common.saving : t.dashboard.createSalesOrder}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

interface StatCardProps {
  title: string;
  href: string;
  icon: ReactNode;
  isLoading: boolean;
  value: string;
  valueClassName?: string;
  titleClassName?: string;
  testId?: string;
}

function StatCard({ title, href, icon, isLoading, value, valueClassName, titleClassName, testId }: StatCardProps) {
  return (
    <Link href={href} data-testid={testId} className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg">
      <Card className="bg-card border-border transition-all hover:border-primary/50 hover:shadow-md group-hover:bg-accent/40 cursor-pointer h-full">
        <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
          <CardTitle className={`text-sm font-medium ${titleClassName ?? ""}`}>{title}</CardTitle>
          <div className="flex items-center gap-1">
            {icon}
            <ChevronRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <Skeleton className="h-7 w-[80px] bg-muted" />
          ) : (
            <div className={`text-xl sm:text-2xl font-bold truncate ${valueClassName ?? ""}`}>{value}</div>
          )}
        </CardContent>
      </Card>
    </Link>
  );
}

function ResponseTimeStatsCard({
  stats,
  window,
  onWindowChange,
}: {
  stats: PathStat[];
  window: RtWindow;
  onWindowChange: (w: RtWindow) => void;
}) {
  if (!stats.length) return null;
  const windowLabel = RT_WINDOWS.find((w) => w.value === window)?.label ?? window;
  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">Statistik Performa per Endpoint</CardTitle>
          </div>
          <div className="flex items-center gap-1 rounded-md border border-border/60 p-0.5 bg-muted/30">
            {RT_WINDOWS.map((opt) => (
              <button
                key={opt.value}
                onClick={() => onWindowChange(opt.value)}
                className={`px-2 py-0.5 text-xs rounded transition-colors ${
                  window === opt.value
                    ? "bg-background shadow-sm font-medium text-foreground"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>
        <CardDescription className="text-xs">Min / Avg / p95 / Max · {windowLabel} terakhir</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border/50 text-muted-foreground">
                <th className="text-left pb-1.5 font-medium pr-4">Endpoint</th>
                <th className="text-right pb-1.5 font-medium pr-3 tabular-nums">N</th>
                <th className="text-right pb-1.5 font-medium pr-3 tabular-nums">Min</th>
                <th className="text-right pb-1.5 font-medium pr-3 tabular-nums">Avg</th>
                <th className="text-right pb-1.5 font-medium pr-3 tabular-nums">p95</th>
                <th className="text-right pb-1.5 font-medium tabular-nums">Max</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/30">
              {stats.map((s) => (
                <tr key={s.path}>
                  <td className="py-1.5 pr-4 font-mono text-[10px] text-muted-foreground truncate max-w-[160px]" title={s.path}>
                    {s.path.replace(/^\/api\//, "")}
                  </td>
                  <td className="py-1.5 pr-3 text-right tabular-nums text-muted-foreground">{s.count}</td>
                  <td className={`py-1.5 pr-3 text-right tabular-nums font-medium ${rtColor(s.minMs)}`}>{s.minMs}ms</td>
                  <td className={`py-1.5 pr-3 text-right tabular-nums font-medium ${rtColor(s.avgMs)}`}>{s.avgMs}ms</td>
                  <td className={`py-1.5 pr-3 text-right tabular-nums font-medium ${rtColor(s.p95Ms)}`}>{s.p95Ms}ms</td>
                  <td className={`py-1.5 text-right tabular-nums font-medium ${rtColor(s.maxMs)}`}>{s.maxMs}ms</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  );
}

function ResponseTimeTrendCard({ entries }: { entries: ResponseTimeEntry[] }) {
  const last20 = entries.slice(-20);
  const avg = last20.reduce((s, e) => s + e.durationMs, 0) / last20.length;
  const firstHalf = last20.slice(0, Math.floor(last20.length / 2));
  const secondHalf = last20.slice(Math.floor(last20.length / 2));
  const avgFirst = firstHalf.length ? firstHalf.reduce((s, e) => s + e.durationMs, 0) / firstHalf.length : avg;
  const avgSecond = secondHalf.length ? secondHalf.reduce((s, e) => s + e.durationMs, 0) / secondHalf.length : avg;
  const trendDiff = avgSecond - avgFirst;
  const TrendIcon = Math.abs(trendDiff) < 20 ? Minus : trendDiff > 0 ? TrendingUp : TrendingDown;
  const trendColor = Math.abs(trendDiff) < 20 ? "text-muted-foreground" : trendDiff > 0 ? "text-destructive" : "text-emerald-500";
  const maxMs = Math.max(...last20.map((e) => e.durationMs), 1);
  const hasSlow = last20.some((e) => e.durationMs >= SLOW_THRESHOLD_MS);

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">Tren Waktu Respons API</CardTitle>
          </div>
          <div className={`flex items-center gap-1 text-xs font-medium ${trendColor}`}>
            <TrendIcon className="h-3.5 w-3.5" />
            {Math.abs(trendDiff) < 20 ? "Stabil" : trendDiff > 0 ? "Melambat" : "Membaik"}
          </div>
        </div>
        <CardDescription className="text-xs">
          {last20.length} permintaan terakhir · rata-rata{" "}
          <span className={`font-medium ${rtColor(avg)}`}>{avg.toFixed(0)}ms</span>
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {hasSlow && (
          <div className="flex items-center gap-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Ada respons yang melebihi {SLOW_THRESHOLD_MS}ms. Periksa performa server.
          </div>
        )}
        <div className="flex items-end gap-0.5 h-12">
          {last20.map((e, i) => (
            <div
              key={i}
              className={`flex-1 rounded-sm opacity-80 hover:opacity-100 transition-opacity ${rtBg(e.durationMs)}`}
              style={{ height: `${Math.max(4, (e.durationMs / maxMs) * 100)}%` }}
              title={`${new Date(e.timestamp).toLocaleTimeString("id-ID")}: ${e.durationMs.toFixed(1)}ms`}
            />
          ))}
        </div>
        <div className="flex items-center gap-3 text-[10px] text-muted-foreground">
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-emerald-500" />{"< 200ms"}</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-amber-500" />200–499ms</span>
          <span className="flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-sm bg-destructive" />{"≥ 500ms"}</span>
        </div>
        <div className="space-y-1 max-h-36 overflow-y-auto">
          {[...last20].reverse().slice(0, 10).map((e, i) => (
            <div key={i} className="flex items-center justify-between text-xs py-0.5">
              <span className="text-muted-foreground tabular-nums">
                {new Date(e.timestamp).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </span>
              <span className={`font-medium tabular-nums ${rtColor(e.durationMs)}`}>
                {e.durationMs.toFixed(1)}ms
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function RevenueSparkline({ data }: { data: { month: string; revenue: number }[] }) {
  if (!data.length) return null;

  const W = 600;
  const H = 72;
  const PAD = 8;
  const maxRev = Math.max(...data.map((d) => d.revenue), 1);
  const step = (W - PAD * 2) / Math.max(data.length - 1, 1);

  const pts = data.map((d, i) => ({
    x: PAD + i * step,
    y: PAD + (1 - d.revenue / maxRev) * (H - PAD * 2),
    ...d,
  }));

  const polyline = pts.map((p) => `${p.x},${p.y}`).join(" ");
  const areaPath = `M ${pts[0]!.x},${H} ${pts.map((p) => `L ${p.x},${p.y}`).join(" ")} L ${pts[pts.length - 1]!.x},${H} Z`;

  const formatMonth = (m: string) => {
    const [y, mo] = m.split("-");
    const d = new Date(Number(y), Number(mo) - 1, 1);
    return d.toLocaleDateString("id-ID", { month: "short" });
  };

  const formatIDRShort = (v: number) => {
    if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1)}M`;
    if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(0)}jt`;
    if (v >= 1_000) return `${(v / 1_000).toFixed(0)}rb`;
    return String(v);
  };

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-16 overflow-visible" preserveAspectRatio="none">
        <defs>
          <linearGradient id="sparkGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgb(16,185,129)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="rgb(16,185,129)" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={areaPath} fill="url(#sparkGrad)" />
        <polyline points={polyline} fill="none" stroke="rgb(16,185,129)" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="3" fill="white" stroke="rgb(16,185,129)" strokeWidth="2" />
        ))}
      </svg>
      <div className="flex justify-between mt-1 px-1">
        {pts.map((p, i) => (
          <div key={i} className="flex flex-col items-center gap-0.5" style={{ minWidth: 0 }}>
            <span className="text-[10px] font-semibold text-emerald-700">{formatIDRShort(p.revenue)}</span>
            <span className="text-[9px] text-muted-foreground">{formatMonth(p.month)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Dashboard Quick Nav ────────────────────────────────────────────────────────

interface DashNavItem { label: string; href: string; }
interface DashNavCard { label: string; icon: ElementType; color: string; bg: string; items: DashNavItem[]; }

const DASH_NAV_CARDS: DashNavCard[] = [
  {
    label: "Logistics",
    icon: Truck,
    color: "text-cyan-500",
    bg: "bg-cyan-500/10",
    items: [
      { label: "Semua Shipment",  href: "/logistics/freight" },
      { label: "Air Freight",     href: "/logistics/air-freight" },
      { label: "Ocean Freight",   href: "/logistics/ocean-freight" },
      { label: "Trucking",        href: "/logistics/trucking" },
      { label: "Portal Orders",   href: "/logistics/portal-orders" },
    ],
  },
  {
    label: "Sales",
    icon: ShoppingCart,
    color: "text-emerald-500",
    bg: "bg-emerald-500/10",
    items: [
      { label: "Sales Orders",   href: "/sales/orders" },
      { label: "Quotations",     href: "/sales/quotations" },
      { label: "Invoice",        href: "/sales/invoices" },
      { label: "Customers",      href: "/sales/customers" },
      { label: "Sales Items",    href: "/sales/items" },
    ],
  },
  {
    label: "Purchase",
    icon: Package,
    color: "text-amber-500",
    bg: "bg-amber-500/10",
    items: [
      { label: "Purchase Orders", href: "/purchase/orders" },
      { label: "Vendors",         href: "/purchase/vendors" },
      { label: "Bills",           href: "/purchase/bills" },
      { label: "RFQ",             href: "/purchase/rfq" },
      { label: "Goods Receipt",   href: "/purchase/gr" },
    ],
  },
  {
    label: "Accounting",
    icon: DollarSign,
    color: "text-green-500",
    bg: "bg-green-500/10",
    items: [
      { label: "Dashboard",      href: "/accounting/dashboard" },
      { label: "Jurnal",         href: "/accounting/journals" },
      { label: "Pembayaran",     href: "/accounting/payments" },
      { label: "Profit & Loss",  href: "/accounting/reports/profit-loss" },
      { label: "Trial Balance",  href: "/accounting/reports/trial-balance" },
    ],
  },
  {
    label: "Expense",
    icon: Receipt,
    color: "text-rose-500",
    bg: "bg-rose-500/10",
    items: [
      { label: "Daftar Expense", href: "/expense" },
      { label: "Kasbon",         href: "/expense/kasbon" },
      { label: "Talangan",       href: "/expense/talangan" },
      { label: "Anggaran",       href: "/expense/budget" },
      { label: "Laporan",        href: "/expense/reports" },
    ],
  },
  {
    label: "Laporan",
    icon: BarChart2,
    color: "text-indigo-500",
    bg: "bg-indigo-500/10",
    items: [
      { label: "Sales Report",    href: "/reports/sales" },
      { label: "Purchase Report", href: "/reports/purchase" },
      { label: "AR Aging",        href: "/reports/ar-aging" },
      { label: "AP Aging",        href: "/reports/ap-aging" },
      { label: "Audit Log",       href: "/reports/audit-log" },
    ],
  },
  {
    label: "Sport Center",
    icon: Users,
    color: "text-teal-500",
    bg: "bg-teal-500/10",
    items: [
      { label: "Dashboard",     href: "/sport-center/dashboard" },
      { label: "Bookings",      href: "/sport-center/bookings" },
      { label: "Members",       href: "/sport-center/members" },
      { label: "Pembayaran",    href: "/sport-center/payments" },
      { label: "Laporan",       href: "/sport-center/reports" },
    ],
  },
  {
    label: "Tenant",
    icon: FileText,
    color: "text-orange-500",
    bg: "bg-orange-500/10",
    items: [
      { label: "Dashboard",     href: "/tenant/dashboard" },
      { label: "Daftar Tenant", href: "/tenant/tenants" },
      { label: "Unit",          href: "/tenant/units" },
      { label: "Pembayaran",    href: "/tenant/payments" },
      { label: "Invoice",       href: "/tenant/invoices" },
    ],
  },
];

const QUICKNAV_ORDER_KEY = "dashboard_quicknav_order_v1";
const QUICKNAV_HIDDEN_KEY = "dashboard_quicknav_hidden_v1";

function loadCardOrder(): string[] {
  try {
    const saved = localStorage.getItem(QUICKNAV_ORDER_KEY);
    if (saved) {
      const parsed: string[] = JSON.parse(saved);
      const validLabels = DASH_NAV_CARDS.map((c) => c.label);
      const filtered = parsed.filter((l) => validLabels.includes(l));
      const missing = validLabels.filter((l) => !filtered.includes(l));
      return [...filtered, ...missing];
    }
  } catch {}
  return DASH_NAV_CARDS.map((c) => c.label);
}

function loadHiddenCards(): Set<string> {
  try {
    const saved = localStorage.getItem(QUICKNAV_HIDDEN_KEY);
    if (saved) {
      const parsed: string[] = JSON.parse(saved);
      return new Set(parsed);
    }
  } catch {}
  return new Set();
}

function DashboardQuickNav() {
  const [open, setOpen] = useState(() => {
    try { return localStorage.getItem("dashboard_quicknav_open") !== "false"; } catch { return true; }
  });
  const [editMode, setEditMode] = useState(false);
  const [cardOrder, setCardOrder] = useState<string[]>(loadCardOrder);
  const [hiddenCards, setHiddenCards] = useState<Set<string>>(loadHiddenCards);
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

  const toggle = () => setOpen((v) => {
    const next = !v;
    try { localStorage.setItem("dashboard_quicknav_open", String(next)); } catch {}
    if (!next) setEditMode(false);
    return next;
  });

  const orderedCards = cardOrder
    .map((label) => DASH_NAV_CARDS.find((c) => c.label === label))
    .filter(Boolean) as typeof DASH_NAV_CARDS;

  const visibleCards = orderedCards.filter((c) => !hiddenCards.has(c.label));

  const toggleHidden = (label: string) => {
    setHiddenCards((prev) => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label); else next.add(label);
      try { localStorage.setItem(QUICKNAV_HIDDEN_KEY, JSON.stringify([...next])); } catch {}
      return next;
    });
  };

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    setDragOverIndex(index);
  };

  const handleDrop = (e: React.DragEvent, dropIndex: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === dropIndex) {
      setDragIndex(null);
      setDragOverIndex(null);
      return;
    }
    const newOrder = [...cardOrder];
    const [moved] = newOrder.splice(dragIndex, 1);
    newOrder.splice(dropIndex, 0, moved);
    setCardOrder(newOrder);
    try { localStorage.setItem(QUICKNAV_ORDER_KEY, JSON.stringify(newOrder)); } catch {}
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const resetAll = () => {
    const defaultOrder = DASH_NAV_CARDS.map((c) => c.label);
    setCardOrder(defaultOrder);
    setHiddenCards(new Set());
    try {
      localStorage.removeItem(QUICKNAV_ORDER_KEY);
      localStorage.removeItem(QUICKNAV_HIDDEN_KEY);
    } catch {}
  };

  const hiddenCount = hiddenCards.size;

  return (
    <div className="rounded-xl border bg-card">
      <div className="flex items-center justify-between px-4 py-3">
        <button
          onClick={toggle}
          className="flex items-center gap-2 hover:text-foreground text-foreground transition-colors"
        >
          <span className="text-sm font-semibold">Navigasi Cepat</span>
          {!editMode && hiddenCount > 0 && (
            <span className="text-xs text-muted-foreground/60 font-normal">({hiddenCount} disembunyikan)</span>
          )}
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform duration-200 ${open ? "rotate-180" : ""}`} />
        </button>
        {open && (
          <div className="flex items-center gap-2">
            {editMode && (
              <button
                onClick={resetAll}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded-md hover:bg-muted/60"
              >
                Reset Semua
              </button>
            )}
            <button
              onClick={() => setEditMode((v) => !v)}
              className={`flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-lg border transition-colors font-medium ${
                editMode
                  ? "bg-primary text-primary-foreground border-primary"
                  : "text-amber-400 border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/20 hover:border-amber-400"
              }`}
            >
              <Settings2 className="h-3 w-3" />
              {editMode ? "Selesai" : "Kustomisasi"}
            </button>
          </div>
        )}
      </div>
      {open && (
        <div className="px-4 pb-4">
          {editMode && (
            <p className="text-xs text-muted-foreground mb-3 flex items-center gap-1.5">
              <GripVertical className="h-3 w-3" />
              Drag untuk ubah urutan · klik ikon mata untuk sembunyikan/tampilkan
            </p>
          )}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {(editMode ? orderedCards : visibleCards).map(({ label, icon: Icon, color, bg, items }, index) => {
              const isHidden = hiddenCards.has(label);
              const isDragging = editMode && dragIndex === index;
              const isDragOver = editMode && dragOverIndex === index && dragIndex !== index;
              return (
                <div
                  key={label}
                  draggable={editMode && !isHidden}
                  onDragStart={editMode && !isHidden ? (e) => handleDragStart(e, index) : undefined}
                  onDragOver={editMode && !isHidden ? (e) => handleDragOver(e, index) : undefined}
                  onDrop={editMode && !isHidden ? (e) => handleDrop(e, index) : undefined}
                  onDragEnd={editMode ? handleDragEnd : undefined}
                  className={`rounded-xl border bg-background p-4 flex flex-col gap-3 transition-all duration-150 ${
                    editMode && !isHidden ? "cursor-grab active:cursor-grabbing" : ""
                  } ${isDragging ? "opacity-40 scale-95" : "opacity-100"} ${
                    isDragOver ? "border-primary ring-2 ring-primary/30 bg-primary/5" : ""
                  } ${isHidden ? "opacity-40" : ""}`}
                >
                  <div className="flex items-center gap-2">
                    {editMode && !isHidden && (
                      <GripVertical className="h-4 w-4 text-muted-foreground/50 shrink-0 -ml-1" />
                    )}
                    <div className={`rounded-lg p-2 ${bg} shrink-0`}>
                      <Icon className={`h-4 w-4 ${color}`} />
                    </div>
                    <p className="text-sm font-semibold text-foreground leading-tight flex-1 min-w-0 truncate">{label}</p>
                    {editMode && (
                      <button
                        onClick={() => toggleHidden(label)}
                        className={`shrink-0 rounded-md p-1 transition-colors ${
                          isHidden
                            ? "text-muted-foreground/40 hover:text-muted-foreground"
                            : "text-muted-foreground hover:text-foreground hover:bg-muted/60"
                        }`}
                        title={isHidden ? "Tampilkan" : "Sembunyikan"}
                      >
                        {isHidden ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                      </button>
                    )}
                  </div>
                  {!editMode && (
                    <div className="flex flex-col gap-0.5">
                      {items.map((item) => (
                        <Link
                          key={item.href}
                          href={item.href}
                          className="group flex items-center justify-between rounded-md px-2 py-1.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted/60 transition-colors"
                        >
                          <span>{item.label}</span>
                          <ArrowRight className="h-3 w-3 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                        </Link>
                      ))}
                    </div>
                  )}
                  {editMode && (
                    <div className="flex flex-col gap-0.5">
                      {items.slice(0, 2).map((item) => (
                        <span key={item.href} className="px-2 py-1 text-xs text-muted-foreground/60 truncate">
                          {item.label}
                        </span>
                      ))}
                      {items.length > 2 && (
                        <span className="px-2 text-xs text-muted-foreground/40">+{items.length - 2} lainnya</span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
