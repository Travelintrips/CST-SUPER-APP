import { DatePicker } from "@/components/ui/date-picker";
import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "wouter";
import { AppShell } from "@/components/layout/AppShell";
import { PageHeader } from "@/components/layout/PageHeader";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useCompany } from "@/contexts/CompanyContext";
import {
  CalendarDays, Users, DollarSign, Clock, TrendingUp,
  Activity, AlertCircle, Building2, Wifi, WifiOff,
  Dumbbell, ShoppingBag, RefreshCw, CloudUpload, CheckCircle2,
  XCircle, Database, BookOpen, Flame, CheckCheck, BarChart2,
  ArrowDownRight, Zap, Filter, ChevronLeft, ChevronRight, ChevronDown,
  Bug, FileText, AlertTriangle, Info, ShieldAlert, Network, Key,
  GitMerge, Copy, Hash, Server,
} from "lucide-react";
import { fetchSportCenterData, fetchAllBookingsFromSportCenter, type SportCenterSupabaseData } from "@/lib/sportCenterSupabase";
import { supabase } from "@/lib/supabaseClient";
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell,
} from "recharts";
import { useSportCostCenter } from "@/hooks/useSportCostCenter";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", maximumFractionDigits: 0 }).format(n);

const fmtDate = (d: string | undefined | null): string => {
  if (!d || d === "-") return "-";
  try {
    return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(d));
  } catch {
    return d;
  }
};

const STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  pending_payment: "Menunggu Bayar",
  confirmed: "Konfirmasi",
  checked_in: "Check-In",
  completed: "Selesai",
  cancelled: "Dibatal",
};
const STATUS_COLOR: Record<string, string> = {
  pending:         "bg-yellow-900/40 text-yellow-300 border-yellow-600",
  pending_payment: "bg-orange-900/40 text-orange-300 border-orange-600",
  confirmed:       "bg-blue-900/40 text-blue-300 border-blue-600",
  checked_in:      "bg-purple-900/40 text-purple-300 border-purple-600",
  completed:       "bg-emerald-900/40 text-emerald-300 border-emerald-600",
  cancelled:       "bg-red-900/40 text-red-300 border-red-600",
};

interface LocalDashboardData {
  totalBookings: number; todayBookings: number; pendingPayment: number;
  pendingPaymentAmount: number;
  totalRevenue: number; monthRevenue: number; totalMembers: number;
  byStatus: { status: string; count: string }[];
  topFacilities: { facility_name: string; bookings: string; revenue: string }[];
  recentBookings: Record<string, unknown>[];
}

interface KpiLiveData {
  revenue_today: number;
  bookings_today: number;
  active_bookings_now: number;
  occupancy_today: number;
  occupied_hours_today: number;
  available_hours_today: number;
  checkins_today: number;
  members_active: number;
  refunds_today: number;
  net_profit_today: number;
}

interface HeatmapRow { hour: string; booking_count: number; }

interface RevenueTxRow {
  entry_id: number;
  payment_date: string;
  amount: number;
  ref: string | null;
  booking_number: string | null;
  customer_name: string | null;
  facility_name: string | null;
  booking_date: string | null;
  start_time: string | null;
  end_time: string | null;
  status: string | null;
  payment_status: string | null;
  total_amount: string | null;
}
type RevenueTxQueryResult = { data: RevenueTxRow[]; total: number };

interface AllBookingRow {
  booking_code: string | null;
  customer_name: string | null;
  facility_name: string | null;
  date: string | null;
  start_time: string | null;
  end_time: string | null;
  status: string | null;
  payment_status: string | null;
  total_price: number | null;
  created_at: string | null;
}

export default function SportCenterDashboard() {
  const qc = useQueryClient();
  const [, navigate] = useLocation();
  const { activeCompanyId } = useCompany();
  const esRef = useRef<EventSource | null>(null);
  const bookingTableRef = useRef<HTMLDivElement | null>(null);
  const [realtimeCount, setRealtimeCount] = useState(0);
  const [supabaseConnected, setSupabaseConnected] = useState(false);
  const [cardFilter, setCardFilter] = useState<string | null>(null);
  const { costCenters, selectedId: costCenterId, setSelectedId: setCostCenterId, selectedLabel: costCenterLabel } = useSportCostCenter();

  // ── State: expandable card ────────────────────────────────────────────────
  const [expandedCard, setExpandedCard] = useState<string | null>(null);

  const handleCardClick = (cardId: string) => {
    setExpandedCard(prev => (prev === cardId ? null : cardId));
  };

  // ── State: KPI date picker ────────────────────────────────────────────────
  const todayStr = new Date().toISOString().split("T")[0];
  const [kpiDate, setKpiDate] = useState<string>(todayStr);

  const kpiDateLabel = (() => {
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const tomorrow  = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
    if (kpiDate === todayStr) return "Hari Ini";
    if (kpiDate === yesterday.toISOString().split("T")[0]) return "Kemarin";
    if (kpiDate === tomorrow.toISOString().split("T")[0]) return "Besok";
    return new Intl.DateTimeFormat("id-ID", { day: "2-digit", month: "short", year: "numeric" }).format(new Date(kpiDate));
  })();

  const shiftDate = (days: number) => {
    const d = new Date(kpiDate);
    d.setDate(d.getDate() + days);
    setKpiDate(d.toISOString().split("T")[0]);
  };

  // ── Query 0: KPI Live realtime ────────────────────────────────────────────
  const { data: kpiLive, isLoading: kpiLoading } = useQuery<KpiLiveData>({
    queryKey: ["sport-center-kpi-live", activeCompanyId, costCenterId, kpiDate],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (activeCompanyId) qs.set("companyId", String(activeCompanyId));
      if (costCenterId) qs.set("costCenterId", String(costCenterId));
      qs.set("date", kpiDate);
      const r = await fetch(`/api/sport-center/kpi-live?${qs}`, { credentials: "include" });
      if (!r.ok) throw new Error("Gagal memuat KPI live");
      return r.json() as Promise<KpiLiveData>;
    },
    refetchInterval: kpiDate === todayStr ? 30_000 : false,
  });

  // ── Query Heatmap: Jam Ramai ──────────────────────────────────────────────
  const { data: heatmapData } = useQuery<HeatmapRow[]>({
    queryKey: ["sport-center-heatmap", activeCompanyId, costCenterId],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (activeCompanyId) qs.set("companyId", String(activeCompanyId));
      if (costCenterId) qs.set("costCenterId", String(costCenterId));
      const r = await fetch(`/api/sport-center/heatmap?${qs}`, { credentials: "include" });
      if (!r.ok) throw new Error("Gagal memuat heatmap");
      return r.json() as Promise<HeatmapRow[]>;
    },
    refetchInterval: 120_000,
  });

  // ── Query 1: PostgreSQL lokal via API server ───────────────────────────────
  const { data: localData, isLoading: localLoading } = useQuery<LocalDashboardData>({
    queryKey: ["sport-center-dashboard", activeCompanyId],
    queryFn: async () => {
      const qs = activeCompanyId ? `?companyId=${activeCompanyId}` : "";
      const r = await fetch(`/api/sport-center/dashboard${qs}`, { credentials: "include" });
      if (!r.ok) throw new Error("Gagal memuat dashboard lokal");
      return r.json() as Promise<LocalDashboardData>;
    },
    refetchInterval: 60_000,
  });

  // ── Query 2: Supabase langsung via fetchSportCenterData() ─────────────────
  const {
    data: supaData,
    isLoading: supaLoading,
    isError: supaError,
    error: supaErrorObj,
    refetch: refetchSupa,
  } = useQuery<SportCenterSupabaseData>({
    queryKey: ["sport-center-supabase"],
    queryFn: fetchSportCenterData,
    refetchInterval: 60_000,
    retry: 1,
  });


  // ── Query: Revenue Transactions (lazy — hanya saat expandedCard === 'revenue') ──────────
  const {
    data: revenueTxData,
    isLoading: revenueTxLoading,
  } = useQuery<RevenueTxQueryResult>({
    queryKey: ["sport-center-revenue-tx", activeCompanyId, costCenterId, kpiDate],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (activeCompanyId) qs.set("companyId", String(activeCompanyId));
      if (costCenterId) qs.set("costCenterId", String(costCenterId));
      qs.set("date", kpiDate);
      const r = await fetch(`/api/sport-center/revenue-transactions?${qs}`, { credentials: "include" });
      if (!r.ok) throw new Error("Gagal memuat transaksi revenue");
      return r.json() as Promise<RevenueTxQueryResult>;
    },
    enabled: expandedCard === "revenue",
    staleTime: 30_000,
  });

  // ── Query: Sync Logs (riwayat + ringkasan lokal) ─────────────────────────
  type SyncLogRow = {
    id: number; entity: string; action: string; entity_id: string | null;
    status: string; detail: string | null; created_at: string;
  };
  type SyncLogsData = {
    recent_logs: SyncLogRow[];
    last_facility_sync: SyncLogRow | null;
    last_booking_sync:  SyncLogRow | null;
    local: { bookings: number; payments: number; facilities: number };
  };
  const {
    data: syncData,
    isLoading: syncLoading,
    refetch: refetchSync,
  } = useQuery<SyncLogsData>({
    queryKey: ["sport-center-sync-logs", activeCompanyId],
    queryFn: async () => {
      const qs = activeCompanyId ? `?companyId=${activeCompanyId}` : "";
      const r = await fetch(`/api/sport-center/sync/logs${qs}`, { credentials: "include" });
      if (!r.ok) throw new Error("Gagal ambil log");
      return r.json() as Promise<SyncLogsData>;
    },
    refetchInterval: 30_000,
    retry: 1,
  });

  // ── Query: Sync Status (koneksi Supabase + hitungan data lokal vs remote) ────
  type SyncStatusData = {
    supabase: { connected: boolean; error: string | null; bookings: number; payments: number; facilities: number; project?: string; envConfigured?: boolean };
    local:    { bookings: number; payments: number; facilities: number };
    circuitBreaker?: { open: boolean; openedAt: string | null; remainingCooldownSeconds: number };
  };
  const {
    data: syncStatus,
    isLoading: syncStatusLoading,
    refetch: refetchSyncStatus,
  } = useQuery<SyncStatusData>({
    queryKey: ["sport-center-sync-status", activeCompanyId],
    queryFn: async () => {
      const qs = activeCompanyId ? `?companyId=${activeCompanyId}` : "";
      const r = await fetch(`/api/sport-center/sync/status${qs}`, { credentials: "include" });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        throw new Error((body as any)?.error ?? "Gagal cek status");
      }
      return r.json() as Promise<SyncStatusData>;
    },
    refetchInterval: 60_000,
    retry: 1,
  });

  // ── State: Toggle debug panel ─────────────────────────────────────────────
  const [showDebugPanel, setShowDebugPanel] = useState(false);

  // ── Query: CB Audit Debug ─────────────────────────────────────────────────
  type DebugErrorEntry = {
    id: number; entity: string; action: string; entity_id: number | null;
    status: string; detail: string | null; company_id: number | null;
    created_at: string; errorCategory: string;
  };
  type SyncDebugData = {
    env: string;
    dbSource: string;
    dbHost: string;
    supabaseProject: string;
    supabaseUrlConfigured: boolean;
    supabaseKeyConfigured: boolean;
    dbAccessible: boolean;
    circuitBreaker: {
      open: boolean;
      openedAt: string | null;
      remainingCooldownSeconds: number;
      lastTrigger: { source: string; message: string; openedAt: string } | null;
    };
    lastSuccessfulSyncAt: string | null;
    recentErrors: DebugErrorEntry[];
    errorsByCategory: Record<string, number>;
    firstEcbOpeningError: DebugErrorEntry | null;
    rootCause: string;
    affectedFiles: string[];
    recommendations: string[];
  };
  const {
    data: debugData,
    isLoading: debugLoading,
    refetch: refetchDebug,
    error: debugError,
  } = useQuery<SyncDebugData>({
    queryKey: ["sport-center-sync-debug"],
    queryFn: async () => {
      const r = await fetch("/api/sport-center/sync/debug", { credentials: "include" });
      if (!r.ok) {
        const body = await r.json().catch(() => ({}));
        const msg = (body as any)?.error ?? (body as any)?.message ?? `HTTP ${r.status}`;
        if (r.status === 401) throw new Error(`Sesi habis atau belum login (401) — coba refresh halaman`);
        if (r.status === 403) throw new Error(`Akses ditolak — hanya admin (403)`);
        throw new Error(`Gagal ambil debug info: ${msg}`);
      }
      return r.json() as Promise<SyncDebugData>;
    },
    enabled: showDebugPanel,
    staleTime: 15_000,
    retry: 1,
  });

  // ── Query: Semua booking dari Supabase (lazy — hanya saat expandedCard === 'totalBooking') ──
  const {
    data: allBookingsData,
    isLoading: allBookingsLoading,
  } = useQuery<AllBookingRow[]>({
    queryKey: ["sport-center-supabase-all-bookings"],
    queryFn: async () => {
      const rows = await fetchAllBookingsFromSportCenter();
      return rows as AllBookingRow[];
    },
    enabled: expandedCard === "totalBooking",
    staleTime: 30_000,
  });

  // ── Realtime: SSE dari API server ─────────────────────────────────────────
  useEffect(() => {
    const qs = activeCompanyId ? `?companyId=${activeCompanyId}` : "";
    const es = new EventSource(`/api/sport-center/events${qs}`);
    esRef.current = es;
    es.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data as string) as { type?: string; entity?: string };
        if (ev.type === "connected") return;
        if (["booking", "payment", "refund", "dashboard"].includes(ev.entity ?? "")) {
          qc.invalidateQueries({ queryKey: ["sport-center-dashboard"] });
          qc.invalidateQueries({ queryKey: ["sport-center-supabase"] });
          qc.invalidateQueries({ queryKey: ["sport-center-kpi-live"] });
          qc.invalidateQueries({ queryKey: ["sport-center-heatmap"] });
          setRealtimeCount((c) => c + 1);
        }
      } catch { /* ignore */ }
    };
    return () => { es.close(); esRef.current = null; };
  }, [activeCompanyId, qc]);

  // ── Realtime: Supabase postgres_changes ──────────────────────────────────
  useEffect(() => {
    if (!supabase) return;
    const channel = supabase
      .channel("sport-center-dashboard-rt")
      .on("postgres_changes", { event: "*", schema: "sport_center", table: "bookings" }, (payload) => {
        qc.invalidateQueries({ queryKey: ["sport-center-supabase"] });
        qc.invalidateQueries({ queryKey: ["sport-center-supabase-all-bookings"] });
        setRealtimeCount((c) => c + 1);
        const row = (payload as { new?: Record<string, unknown> }).new;
        if (row && row.order_number) {
          void fetch("/api/sport-center/sync/pull-from-supabase", {
            method: "POST", credentials: "include",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ companyId: activeCompanyId }),
          });
        }
      })
      .on("postgres_changes", { event: "*", schema: "sport_center", table: "payments" }, () => {
        qc.invalidateQueries({ queryKey: ["sport-center-supabase"] });
        qc.invalidateQueries({ queryKey: ["sport-center-dashboard"] });
        setRealtimeCount((c) => c + 1);
      })
      .on("postgres_changes", { event: "*", schema: "sport_center", table: "facilities" }, () => {
        qc.invalidateQueries({ queryKey: ["sport-center-supabase"] });
        setRealtimeCount((c) => c + 1);
      })
      .subscribe((status) => {
        setSupabaseConnected(status === "SUBSCRIBED");
      });
    return () => { void supabase?.removeChannel(channel); };
  }, [qc, activeCompanyId]);

  // ── Merge: Supabase jadi sumber utama, lokal sebagai fallback ─────────────
  const hasSupaBookings = (supaData?.totalBookings ?? 0) > 0 || (supaData?.recentBookings?.length ?? 0) > 0;

  // Metrics utama
  const totalBookings   = supaData?.totalBookings   ?? localData?.totalBookings   ?? 0;
  const pendingPayment  = supaData?.pendingPayment  ?? localData?.pendingPayment  ?? 0;
  const pendingPaymentAmount = supaData?.pendingPaymentAmount ?? localData?.pendingPaymentAmount ?? 0;
  const uniqueCustomers = supaData?.uniqueCustomers ?? 0;
  const activeServices  = supaData?.activeServices  ?? 0;
  const totalRevenue    = supaData?.totalRevenue    ?? localData?.totalRevenue    ?? 0;
  const monthRevenue    = supaData?.monthRevenue    ?? localData?.monthRevenue    ?? 0;
  const todayBookings   = localData?.todayBookings  ?? 0;

  // Section data
  const byStatus       = hasSupaBookings ? (supaData?.byStatus       ?? []) : (localData?.byStatus       ?? []);
  const topFacilities  = hasSupaBookings ? (supaData?.topFacilities  ?? []) : (localData?.topFacilities  ?? []);
  const recentBookings = useMemo(
    () => hasSupaBookings ? (supaData?.recentBookings ?? []) : (localData?.recentBookings ?? []),
    [hasSupaBookings, supaData?.recentBookings, localData?.recentBookings],
  );

  useEffect(() => {
    if (cardFilter && cardFilter !== "all" && bookingTableRef.current) {
      setTimeout(() => {
        bookingTableRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
      }, 80);
    }
  }, [cardFilter]);

  const CARD_FILTER_LABEL: Record<string, string> = {
    all:     "Semua Booking",
    today:   "Booking Hari Ini",
    pending: "Belum Bayar",
  };

  const displayBookings = useMemo(() => {
    if (!cardFilter || cardFilter === "all") return recentBookings;
    if (cardFilter === "today") {
      return recentBookings.filter((b) =>
        String(b.booking_date ?? "").startsWith(todayStr),
      );
    }
    if (cardFilter === "pending") {
      const pendingStatus     = ["pending", "pending_payment"];
      const pendingPayStatus  = ["pending", "pending_payment", "unpaid"];
      return recentBookings.filter((b) =>
        pendingStatus.includes(String(b.status ?? "")) ||
        pendingPayStatus.includes(String(b.payment_status ?? "")),
      );
    }
    return recentBookings;
  }, [cardFilter, recentBookings, todayStr]);

  const isLoading = localLoading && supaLoading;

  // ── Query 3: Sync status dari API ─────────────────────────────────────────
  interface SyncLog {
    id: number; entity: string; action: string; entity_id: number | null;
    status: "ok" | "error"; detail: string | null; company_id: number | null;
    created_at: string;
  }
  // ── Auto-push: Supabase → local saat local kosong ────────────────────────
  const pushBookingsDone = useRef(false);
  const pushBookings = useMutation({
    mutationFn: async (bookings: unknown[]) => {
      const r = await fetch("/api/sport-center/sync/push-bookings", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bookings, companyId: activeCompanyId }),
      });
      if (!r.ok) throw new Error("Push gagal");
      return r.json();
    },
    onSuccess: (res) => {
      if (res.pushed > 0) {
        qc.invalidateQueries({ queryKey: ["sport-center-dashboard"] });
        qc.invalidateQueries({ queryKey: ["sport-center-kpi-live"] });
        void refetchSync();
      }
    },
  });

  useEffect(() => {
    pushBookingsDone.current = false;
  }, [activeCompanyId]);

  useEffect(() => {
    if (pushBookingsDone.current) return;
    if (!supaData) return;
    const localCount = syncData?.local?.bookings ?? null;
    if (localCount === null) return;                          // belum load sync status
    if (localCount > 0) { pushBookingsDone.current = true; return; } // sudah ada data lokal
    const rawBookings = supaData.recentBookings;             // SupabaseBooking raw via recentBookings
    if (!rawBookings || rawBookings.length === 0) return;
    pushBookingsDone.current = true;
    void fetchAllBookingsFromSportCenter().then((data) => {
      if (data && data.length > 0) void pushBookings.mutateAsync(data);
    }).catch(() => {});
  }, [supaData, syncData, activeCompanyId, pushBookings]);

  // ── Mutations: trigger resync manual ─────────────────────────────────────
  const resyncFacilities = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/sport-center/facilities/resync-all", {
        method: "POST", credentials: "include",
      });
      if (!r.ok) throw new Error("Resync fasilitas gagal");
      return r.json();
    },
    onSuccess: () => { void refetchSync(); },
  });

  const resyncAll = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/sport-center/facilities/resync-all?include=bookings", {
        method: "POST", credentials: "include",
      });
      if (!r.ok) throw new Error("Resync semua gagal");
      return r.json();
    },
    onSuccess: () => { void refetchSync(); void qc.invalidateQueries({ queryKey: ["sport-center-dashboard"] }); },
  });

  const resyncBookings = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/sport-center/sync/bookings", {
        method: "POST", credentials: "include",
      });
      if (!r.ok) throw new Error("Resync booking gagal");
      return r.json();
    },
    onSuccess: () => { void refetchSync(); },
  });

  const syncAccounting = useMutation({
    mutationFn: async () => {
      const r = await fetch("/api/sport-center/sync/accounting", {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ companyId: activeCompanyId }),
      });
      if (!r.ok) throw new Error("Sync akuntansi gagal");
      return r.json() as Promise<{
        ok: boolean;
        bookings: { pulled: number; deleted: number; errors: number; total: number };
        payments: { pulled: number; deleted: number; skipped: number; errors: number; total: number };
        accounting: { synced: number; skipped: number; errors: number };
      }>;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["accounting-payments"] });
      void qc.invalidateQueries({ queryKey: ["sport-center-payments"] });
      void qc.invalidateQueries({ queryKey: ["sport-center-dashboard"] });
    },
  });

  const fmtTs = (ts: string | null | undefined) => {
    if (!ts) return "-";
    try {
      return new Intl.DateTimeFormat("id-ID", {
        day: "2-digit", month: "short", year: "numeric",
        hour: "2-digit", minute: "2-digit", second: "2-digit",
      }).format(new Date(ts));
    } catch { return ts; }
  };

  const syncBusy = resyncFacilities.isPending || resyncAll.isPending || resyncBookings.isPending || syncAccounting.isPending;

  const stats: {
    title: string; value: string | number;
    icon: React.ElementType; color: string; bg: string; sub: string;
    filter?: string; href?: string; expand?: string;
  }[] = [
    {
      title: "Total Booking",
      value: totalBookings,
      icon: CalendarDays,
      color: "text-blue-400",
      bg: "bg-blue-900/20",
      sub: `Dari Supabase${hasSupaBookings ? " ✓" : " (lokal)"}`,
      expand: "totalBooking",
    },
    {
      title: "Pelanggan Unik",
      value: uniqueCustomers,
      icon: Users,
      color: "text-emerald-400",
      bg: "bg-emerald-900/20",
      sub: "DISTINCT customer_phone",
      href: "/sport-center/customers",
    },
    {
      title: "Layanan Aktif",
      value: activeServices,
      icon: Dumbbell,
      color: "text-pink-400",
      bg: "bg-pink-900/20",
      sub: "sport_center_services",
      href: "/sport-center/facilities",
    },
    {
      title: "Revenue Bulan Ini",
      value: idr(monthRevenue),
      icon: TrendingUp,
      color: "text-green-400",
      bg: "bg-green-900/20",
      sub: "Bulan berjalan",
      href: "/sport-center/payments",
    },
    {
      title: "Total Revenue",
      value: idr(totalRevenue),
      icon: DollarSign,
      color: "text-cyan-400",
      bg: "bg-cyan-900/20",
      sub: "SUM(total_price)",
      href: "/sport-center/reports",
    },
    {
      title: "Booking per Status",
      value: byStatus.reduce((s, r) => s + Number(r.count), 0),
      icon: ShoppingBag,
      color: "text-orange-400",
      bg: "bg-orange-900/20",
      sub: `${byStatus.length} status berbeda`,
      href: "/sport-center/bookings",
    },
    {
      title: "Booking Hari Ini",
      value: todayBookings,
      icon: Clock,
      color: "text-purple-400",
      bg: "bg-purple-900/20",
      sub: "klik untuk filter tabel",
      filter: "today",
    },
    {
      title: "Belum Bayar",
      value: idr(pendingPaymentAmount),
      icon: AlertCircle,
      color: "text-yellow-400",
      bg: "bg-yellow-900/20",
      sub: "Total nominal belum dibayar",
      filter: "pending",
    },
  ];

  return (
    <AppShell>
      <div className="p-6 space-y-6">
        <PageHeader
          title="Sport Center Dashboard"
          description="Overview aktivitas & performa realtime"
          breadcrumb={[{ label: "Dashboard", href: "/dashboard" }, { label: "Sport Center" }]}
          favoriteEnabled
          actions={
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5">
                <Filter className="h-3.5 w-3.5 text-gray-400" />
                <Select
                  value={costCenterId != null ? String(costCenterId) : "__all__"}
                  onValueChange={v => setCostCenterId(v === "__all__" ? null : Number(v))}
                >
                  <SelectTrigger className="h-7 w-44 bg-gray-800 border-gray-700 text-gray-200 text-xs">
                    <SelectValue placeholder="Semua Cost Center" />
                  </SelectTrigger>
                  <SelectContent className="bg-gray-800 border-gray-700">
                    <SelectItem value="__all__" className="text-xs text-gray-200">Semua Cost Center</SelectItem>
                    {costCenters.map(cc => (
                      <SelectItem key={cc.id} value={String(cc.id)} className="text-xs text-gray-200">
                        {cc.code} — {cc.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {supabaseConnected ? (
                <Badge className="bg-emerald-900/40 text-emerald-300 border-emerald-600 text-xs gap-1">
                  <Wifi className="h-3 w-3" /> Realtime aktif
                </Badge>
              ) : (
                <Badge className="bg-slate-800 text-slate-400 border-slate-600 text-xs gap-1">
                  <WifiOff className="h-3 w-3" /> Menghubungkan…
                </Badge>
              )}
              {realtimeCount > 0 && (
                <Badge className="bg-blue-900/40 text-blue-300 border-blue-600 text-xs gap-1">
                  <Activity className="h-3 w-3" /> {realtimeCount} update
                </Badge>
              )}
              {costCenterId != null && (
                <Badge className="bg-indigo-900/40 text-indigo-300 border-indigo-700 text-xs gap-1">
                  <Filter className="h-3 w-3" /> {costCenterLabel}
                </Badge>
              )}
            </div>
          }
        />

        {/* ── FASE 6D-G: KPI Hari Ini (Live) ──────────────────────────────── */}
        <div>
          <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
            <div className="flex items-center gap-2">
              <Zap className="h-4 w-4 text-yellow-400" />
              <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">KPI — Live</h2>
              {kpiDate === todayStr && realtimeCount > 0 && (
                <Badge className="bg-yellow-900/40 text-yellow-300 border-yellow-600 text-xs">
                  {realtimeCount} update realtime
                </Badge>
              )}
              {kpiDate !== todayStr && (
                <Badge className="bg-slate-700 text-slate-300 border-slate-600 text-xs">
                  Histori
                </Badge>
              )}
            </div>
            {/* Date navigator */}
            <div className="flex items-center gap-1">
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => shiftDate(-1)}>
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <div className="relative">
                <span className="px-3 py-1 text-xs font-medium bg-accent/40 border border-border/60 rounded-md text-foreground min-w-[90px] text-center block">
                  {kpiDateLabel}
                </span>
                <DatePicker value={kpiDate} onChange={(v) => v && setKpiDate(v)} className="absolute inset-0 opacity-0 cursor-pointer w-full" />
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => shiftDate(1)}>
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
              {kpiDate !== todayStr && (
                <Button variant="ghost" size="sm" className="h-7 text-xs text-yellow-400 hover:text-yellow-300 px-2" onClick={() => setKpiDate(todayStr)}>
                  Hari Ini
                </Button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
            {kpiLoading ? (
              Array.from({ length: 6 }).map((_, i) => (
                <Card key={i} className="animate-pulse"><CardContent className="p-4 h-20" /></Card>
              ))
            ) : (
              <>
                <Card
                  className={`border-border/60 cursor-pointer transition-all duration-150 group ${
                    expandedCard === "revenueToday"
                      ? "bg-blue-900/20 border-blue-500/60 ring-1 ring-blue-500/30"
                      : "bg-blue-950/20 hover:bg-blue-950/40 hover:border-blue-800/60"
                  }`}
                  onClick={() => handleCardClick("revenueToday")}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <DollarSign className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                      <p className="text-xs text-muted-foreground truncate">Revenue Hari Ini</p>
                      <span className={`text-[9px] font-semibold px-1 py-0.5 rounded border leading-none shrink-0 ${
                        expandedCard === "revenueToday"
                          ? "bg-blue-900/60 text-blue-300 border-blue-600"
                          : "bg-muted/60 text-muted-foreground border-border/60"
                      }`}>DETAIL</span>
                    </div>
                    <p className="text-lg font-bold text-blue-300">{idr(kpiLive?.revenue_today ?? 0)}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {expandedCard === "revenueToday" ? "▲ klik untuk tutup" : "klik untuk detail"}
                    </p>
                  </CardContent>
                </Card>
                <Card
                  className={`border-border/60 cursor-pointer transition-all duration-150 group ${
                    expandedCard === "revenue"
                      ? "bg-blue-950/40 border-blue-500/60 ring-1 ring-blue-500/30"
                      : "bg-blue-950/20 hover:bg-blue-950/40 hover:border-blue-800/60"
                  }`}
                  onClick={() => handleCardClick("revenue")}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between gap-1 mb-1">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <DollarSign className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                        <p className="text-xs text-muted-foreground truncate">Revenue (Transaksi)</p>
                      </div>
                      <ChevronDown className={`h-3 w-3 shrink-0 text-blue-400 transition-transform duration-200 ${expandedCard === "revenue" ? "rotate-180" : ""}`} />
                    </div>
                    <p className="text-lg font-bold text-blue-300">{idr(kpiLive?.revenue_today ?? 0)}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {expandedCard === "revenue" ? "▲ klik untuk tutup" : "klik untuk detail transaksi"}
                    </p>
                  </CardContent>
                </Card>
                <Card
                  className="border-border/60 bg-purple-950/20 cursor-pointer hover:bg-purple-950/40 hover:border-purple-800/60 transition-all duration-150 group"
                  onClick={() => navigate("/sport-center/bookings")}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <CalendarDays className="h-3.5 w-3.5 text-purple-400 shrink-0" />
                      <p className="text-xs text-muted-foreground truncate">Booking Hari Ini</p>
                    </div>
                    <p className="text-lg font-bold text-purple-300">{kpiLive?.bookings_today ?? 0}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{kpiLive?.active_bookings_now ?? 0} aktif sekarang</p>
                  </CardContent>
                </Card>
                <Card
                  className="border-border/60 bg-emerald-950/20 cursor-pointer hover:bg-emerald-950/40 hover:border-emerald-800/60 transition-all duration-150 group"
                  onClick={() => navigate("/sport-center/bookings")}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <CheckCheck className="h-3.5 w-3.5 text-emerald-400 shrink-0" />
                      <p className="text-xs text-muted-foreground truncate">Check-In Hari Ini</p>
                    </div>
                    <p className="text-lg font-bold text-emerald-300">{kpiLive?.checkins_today ?? 0}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">sudah check-in</p>
                  </CardContent>
                </Card>
                <Card
                  className="border-border/60 bg-orange-950/20 cursor-pointer hover:bg-orange-950/40 hover:border-orange-800/60 transition-all duration-150 group"
                  onClick={() => navigate("/sport-center/reports")}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <Flame className="h-3.5 w-3.5 text-orange-400 shrink-0" />
                      <p className="text-xs text-muted-foreground truncate">Occupancy Hari Ini</p>
                    </div>
                    <p className="text-lg font-bold text-orange-300">{kpiLive?.occupancy_today ?? 0}%</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{kpiLive?.occupied_hours_today ?? 0}h / {kpiLive?.available_hours_today ?? 0}h</p>
                  </CardContent>
                </Card>
                <Card
                  className={`border-border/60 cursor-pointer transition-all duration-150 group ${(kpiLive?.net_profit_today ?? 0) >= 0 ? "bg-teal-950/20 hover:bg-teal-950/40 hover:border-teal-800/60" : "bg-red-950/20 hover:bg-red-950/40 hover:border-red-800/60"}`}
                  onClick={() => navigate("/sport-center/profitability")}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <TrendingUp className={`h-3.5 w-3.5 shrink-0 ${(kpiLive?.net_profit_today ?? 0) >= 0 ? "text-teal-400" : "text-red-400"}`} />
                      <p className="text-xs text-muted-foreground truncate">Profit Hari Ini</p>
                    </div>
                    <p className={`text-lg font-bold ${(kpiLive?.net_profit_today ?? 0) >= 0 ? "text-teal-300" : "text-red-300"}`}>
                      {idr(kpiLive?.net_profit_today ?? 0)}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">net (revenue − refund)</p>
                  </CardContent>
                </Card>
                <Card
                  className="border-border/60 bg-red-950/20 cursor-pointer hover:bg-red-950/40 hover:border-red-800/60 transition-all duration-150 group"
                  onClick={() => navigate("/sport-center/payments")}
                >
                  <CardContent className="p-4">
                    <div className="flex items-center gap-2 mb-1">
                      <ArrowDownRight className="h-3.5 w-3.5 text-red-400 shrink-0" />
                      <p className="text-xs text-muted-foreground truncate">Refund Hari Ini</p>
                    </div>
                    <p className="text-lg font-bold text-red-300">{idr(kpiLive?.refunds_today ?? 0)}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">dikembalikan</p>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </div>


        {/* ── Expandable Detail: Revenue Transaksi ─────────────────────────── */}
        {!kpiLoading && (expandedCard === "revenue" || expandedCard === "revenueToday") && (
          <div className="border border-blue-700/40 rounded-xl bg-blue-950/10 transition-all">
            <div className="flex items-center justify-between px-4 py-3 border-b border-blue-700/30">
              <div className="flex items-center gap-2">
                <DollarSign className="h-4 w-4 text-blue-400" />
                <span className="text-sm font-semibold text-blue-300">
                  Transaksi Revenue — {kpiDateLabel}
                </span>
                {!revenueTxLoading && revenueTxData && (
                  <>
                    <Badge className="bg-blue-900/40 text-blue-300 border-blue-600 text-xs">
                      {revenueTxData.data.length} transaksi
                    </Badge>
                    <Badge className="bg-emerald-900/40 text-emerald-300 border-emerald-600 text-xs">
                      {idr(revenueTxData.total)}
                    </Badge>
                  </>
                )}
              </div>
              <button
                onClick={() => setExpandedCard(null)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted/40"
              >
                Tutup ✕
              </button>
            </div>
            {revenueTxLoading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-10 rounded-lg bg-muted/20 animate-pulse" />
                ))}
              </div>



            ) : !revenueTxData || revenueTxData.data.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground text-sm">
                Tidak ada transaksi revenue untuk {kpiDateLabel}.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-blue-700/20 bg-blue-950/20">
                      {["No. Booking", "Pelanggan", "Fasilitas", "Tgl Booking", "Jam", "Status", "Pembayaran", "Total"].map(h => (
                        <th key={h} className="text-left py-2.5 px-3 text-blue-300/70 font-medium whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {revenueTxData.data.map((tx, i) => {
                      const statusKey = (tx.status ?? "").toLowerCase();
                      const statusCls = STATUS_COLOR[statusKey] ?? "bg-gray-800/40 text-gray-300 border-gray-600";
                      const statusLbl = STATUS_LABEL[statusKey] ?? (tx.status ?? "-");
                      const payKey = (tx.payment_status ?? "").toLowerCase();
                      const payCls = payKey === "paid" || payKey === "completed"
                        ? "bg-emerald-900/40 text-emerald-300 border-emerald-600"
                        : payKey === "pending" || payKey === "unpaid"
                          ? "bg-yellow-900/40 text-yellow-300 border-yellow-600"
                          : "bg-gray-800/40 text-gray-300 border-gray-600";
                      const timeRange = (tx.start_time || tx.end_time)
                        ? `${tx.start_time ?? "?"} – ${tx.end_time ?? "?"}`
                        : "-";
                      return (
                        <tr key={tx.entry_id ?? i} className="border-b border-blue-700/10 hover:bg-blue-950/20 transition-colors">
                          <td className="py-2 px-3 font-mono text-blue-300/80 whitespace-nowrap">{tx.booking_number ?? tx.ref ?? "-"}</td>
                          <td className="py-2 px-3 text-foreground max-w-[140px] truncate">{tx.customer_name ?? "-"}</td>
                          <td className="py-2 px-3 text-muted-foreground max-w-[120px] truncate">{tx.facility_name ?? "-"}</td>
                          <td className="py-2 px-3 text-muted-foreground whitespace-nowrap">{tx.booking_date ? fmtDate(tx.booking_date) : "-"}</td>
                          <td className="py-2 px-3 text-muted-foreground whitespace-nowrap">{timeRange}</td>
                          <td className="py-2 px-3">
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-medium ${statusCls}`}>{statusLbl}</span>
                          </td>
                          <td className="py-2 px-3">
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-medium ${payCls}`}>{tx.payment_status ?? "-"}</span>
                          </td>
                          <td className="py-2 px-3 text-right font-semibold text-foreground whitespace-nowrap">{idr(Number(tx.amount ?? 0))}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-blue-700/30 bg-blue-950/20">
                      <td colSpan={7} className="py-2 px-3 text-xs text-blue-300/70 font-medium">
                        Total ({revenueTxData.data.length} transaksi)
                      </td>
                      <td className="py-2 px-3 text-right font-bold text-blue-300 whitespace-nowrap">
                        {idr(revenueTxData.total)}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Error card — Supabase gagal ──────────────────────────────────── */}
        {supaError && (
          <Alert className="border-red-700 bg-red-950/40 text-red-300">
            <AlertCircle className="h-4 w-4 text-red-400" />
            <AlertDescription className="flex items-center justify-between gap-3">
              <span>
                <strong>Gagal memuat data dari Supabase</strong>
                {supaErrorObj instanceof Error && (
                  <span className="ml-2 text-xs opacity-70">— {supaErrorObj.message}</span>
                )}
              </span>
              <button
                onClick={() => void refetchSupa()}
                className="flex items-center gap-1 text-xs px-2 py-1 bg-red-900/50 hover:bg-red-800/60 rounded transition-colors"
              >
                <RefreshCw className="h-3 w-3" /> Coba lagi
              </button>
            </AlertDescription>
          </Alert>
        )}

        {/* ── Sumber data indicator ─────────────────────────────────────────── */}
        {!isLoading && !supaError && (
          <p className="text-xs text-muted-foreground">
            Sumber:{" "}
            {hasSupaBookings
              ? <span className="text-emerald-400 font-medium">✓ Supabase ({supaData?.totalBookings ?? 0} booking)</span>
              : <span className="text-slate-400">Supabase (kosong) — menampilkan data lokal</span>
            }
          </p>
        )}

        {/* ── Stats Cards ──────────────────────────────────────────────────── */}
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Card key={i} className="animate-pulse"><CardContent className="p-5 h-24" /></Card>
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {stats.map((s) => {
              const isActive = s.filter != null && cardFilter === s.filter;
              const isExpanded = s.expand != null && expandedCard === s.expand;
              return (
                <Card
                  key={s.title}
                  className={`border-border/60 cursor-pointer transition-all duration-150 group ${
                    isExpanded
                      ? "border-blue-500/60 bg-blue-900/10 ring-1 ring-blue-500/30"
                      : isActive
                        ? "border-yellow-500/60 bg-yellow-900/10 ring-1 ring-yellow-500/30"
                        : "hover:border-border hover:bg-accent/30"
                  }`}
                  onClick={() => {
                    if (s.expand != null) {
                      handleCardClick(s.expand);
                    } else if (s.filter != null) {
                      setCardFilter(cardFilter === s.filter ? null : s.filter);
                    } else if (s.href) {
                      navigate(s.href);
                    }
                  }}
                >
                  <CardContent className="p-4">
                    <div className="flex items-start justify-between">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-1.5 mb-1">
                          <p className="text-xs text-muted-foreground truncate group-hover:text-foreground/70 transition-colors">{s.title}</p>
                          {s.filter != null && (
                            <span className={`text-[9px] font-semibold px-1 py-0.5 rounded border leading-none shrink-0 ${
                              isActive
                                ? "bg-yellow-900/60 text-yellow-300 border-yellow-600"
                                : "bg-muted/60 text-muted-foreground border-border/60"
                            }`}>FILTER</span>
                          )}
                          {s.expand != null && (
                            <span className={`text-[9px] font-semibold px-1 py-0.5 rounded border leading-none shrink-0 ${
                              isExpanded
                                ? "bg-blue-900/60 text-blue-300 border-blue-600"
                                : "bg-muted/60 text-muted-foreground border-border/60"
                            }`}>DETAIL</span>
                          )}
                        </div>
                        <p className={`text-xl font-bold ${isExpanded ? "text-blue-300" : isActive ? "text-yellow-300" : "text-foreground"}`}>{s.value}</p>
                        <p className="text-xs text-muted-foreground mt-1 truncate">{s.sub}</p>
                      </div>
                      <div className={`p-2 rounded-lg ml-2 shrink-0 ${isExpanded ? "bg-blue-900/40" : isActive ? "bg-yellow-900/40" : s.bg} group-hover:scale-110 transition-transform`}>
                        {s.expand != null ? (
                          <ChevronDown className={`h-4 w-4 transition-transform duration-200 ${isExpanded ? "rotate-180 text-blue-400" : s.color}`} />
                        ) : (
                          <s.icon className={`h-4 w-4 ${isExpanded ? "text-blue-400" : isActive ? "text-yellow-400" : s.color}`} />
                        )}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>

        )}

        {/* ── Expandable Detail: Total Booking ─────────────────────────────── */}
        {!isLoading && expandedCard === "totalBooking" && (
          <div className="border border-blue-700/40 rounded-xl bg-blue-950/10">
            <div className="flex items-center justify-between px-4 py-3 border-b border-blue-700/30">
              <div className="flex items-center gap-2">
                <CalendarDays className="h-4 w-4 text-blue-400" />
                <span className="text-sm font-semibold text-blue-300">Detail Semua Booking</span>
                {!allBookingsLoading && allBookingsData && (
                  <Badge className="bg-blue-900/40 text-blue-300 border-blue-600 text-xs">
                    {allBookingsData.length} booking
                  </Badge>
                )}
              </div>
              <button
                onClick={() => setExpandedCard(null)}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors px-2 py-1 rounded hover:bg-muted/40"
              >
                Tutup ✕
              </button>
            </div>

            {allBookingsLoading ? (
              <div className="p-4 space-y-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-10 rounded-lg bg-muted/20 animate-pulse" />
                ))}
              </div>
            ) : !allBookingsData || allBookingsData.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground text-sm">
                Belum ada data booking di Supabase.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-blue-700/20 bg-blue-950/20">
                      {["Kode", "Pelanggan", "Fasilitas", "Tanggal", "Jam", "Status", "Pembayaran", "Total"].map(h => (
                        <th key={h} className="text-left py-2.5 px-3 text-blue-300/70 font-medium whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {allBookingsData.map((b, i) => {
                      const statusKey = (b.status ?? "").toLowerCase();
                      const statusCls = STATUS_COLOR[statusKey] ?? "bg-gray-800/40 text-gray-300 border-gray-600";
                      const statusLbl = STATUS_LABEL[statusKey] ?? (b.status ?? "-");
                      const payKey = (b.payment_status ?? "").toLowerCase();
                      const payCls = payKey === "paid" || payKey === "completed"
                        ? "bg-emerald-900/40 text-emerald-300 border-emerald-600"
                        : payKey === "pending" || payKey === "unpaid"
                          ? "bg-yellow-900/40 text-yellow-300 border-yellow-600"
                          : "bg-gray-800/40 text-gray-300 border-gray-600";
                      const timeRange = (b.start_time || b.end_time)
                        ? `${b.start_time ?? "?"} – ${b.end_time ?? "?"}`
                        : "-";
                      return (
                        <tr
                          key={b.booking_code ?? i}
                          className="border-b border-blue-700/10 hover:bg-blue-950/20 transition-colors"
                        >
                          <td className="py-2 px-3 font-mono text-blue-300/80 whitespace-nowrap">{b.booking_code ?? "-"}</td>
                          <td className="py-2 px-3 text-foreground max-w-[140px] truncate">{b.customer_name ?? "-"}</td>
                          <td className="py-2 px-3 text-muted-foreground max-w-[120px] truncate">{b.facility_name ?? "-"}</td>
                          <td className="py-2 px-3 text-muted-foreground whitespace-nowrap">{b.date ? fmtDate(b.date) : "-"}</td>
                          <td className="py-2 px-3 text-muted-foreground whitespace-nowrap">{timeRange}</td>
                          <td className="py-2 px-3">
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-medium ${statusCls}`}>
                              {statusLbl}
                            </span>
                          </td>
                          <td className="py-2 px-3">
                            <span className={`inline-flex items-center px-1.5 py-0.5 rounded border text-[10px] font-medium ${payCls}`}>
                              {b.payment_status ?? "-"}
                            </span>
                          </td>
                          <td className="py-2 px-3 text-right font-semibold text-foreground whitespace-nowrap">
                            {idr(Number(b.total_price ?? 0))}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t border-blue-700/30 bg-blue-950/20">
                      <td colSpan={7} className="py-2 px-3 text-xs text-blue-300/70 font-medium">
                        Total ({allBookingsData.length} booking)
                      </td>
                      <td className="py-2 px-3 text-right font-bold text-blue-300 whitespace-nowrap">
                        {idr(allBookingsData.reduce((s, b) => s + Number(b.total_price ?? 0), 0))}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── Booking per Status & Top Fasilitas ───────────────────────────── */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {/* Booking per Status */}
          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Activity className="h-4 w-4" /> Booking per Status
                <span className="text-xs font-normal opacity-50 ml-1">— klik untuk filter</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {byStatus.map((s) => (
                  <div
                    key={s.status}
                    className="flex items-center justify-between cursor-pointer hover:bg-accent/30 -mx-2 px-2 py-1 rounded-md transition-colors"
                    onClick={() => navigate(`/sport-center/bookings?status=${s.status}`)}
                  >
                    <Badge className={`text-xs border ${STATUS_COLOR[s.status] ?? "bg-muted text-muted-foreground border-border"}`}>
                      {STATUS_LABEL[s.status] ?? s.status}
                    </Badge>
                    <span className="text-sm font-medium text-foreground">{s.count} booking</span>
                  </div>
                ))}
                {byStatus.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4">Belum ada data</p>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Top Fasilitas */}
          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <TrendingUp className="h-4 w-4" /> Top Fasilitas
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {topFacilities.map((f, i) => (
                  <div key={f.facility_name} className="flex items-center gap-3">
                    <span className="text-xs font-bold text-muted-foreground w-5 shrink-0">{i + 1}.</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-foreground truncate">{f.facility_name}</p>
                      <p className="text-xs text-muted-foreground">{f.bookings} booking</p>
                    </div>
                    <span className="text-sm font-medium text-emerald-400 shrink-0">
                      {idr(Number(f.revenue))}
                    </span>
                  </div>
                ))}
                {topFacilities.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4">Belum ada data</p>
                )}
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ── Booking Terbaru ───────────────────────────────────────────────── */}
        <div ref={bookingTableRef} className="scroll-mt-6">
        <Card className={`border-border/60 transition-all ${cardFilter ? "border-yellow-500/40" : ""}`}>
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <CalendarDays className="h-4 w-4" /> Booking Terbaru
                {cardFilter ? (
                  <Badge className="bg-yellow-900/40 text-yellow-300 border-yellow-600 text-xs ml-1">
                    Filter: {CARD_FILTER_LABEL[cardFilter] ?? cardFilter}
                  </Badge>
                ) : (
                  <span className="text-xs font-normal ml-1 opacity-60">— klik kartu di atas untuk filter</span>
                )}
              </CardTitle>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">
                  {displayBookings.length} dari {recentBookings.length} booking
                </span>
                {cardFilter && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 text-xs text-yellow-400 hover:text-yellow-300 hover:bg-yellow-900/30"
                    onClick={() => setCardFilter(null)}
                  >
                    <XCircle className="h-3 w-3 mr-1" /> Hapus filter
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                  onClick={() => navigate("/sport-center/bookings")}
                >
                  Lihat semua →
                </Button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border/40">
                    {["No. Booking", "Pelanggan", "Fasilitas", "Tanggal", "Status", "Total"].map((h) => (
                      <th key={h} className="text-left py-2 px-3 text-xs text-muted-foreground font-medium">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {displayBookings.map((b, idx) => (
                    <tr key={String(b.id ?? idx)} className="border-b border-border/20 hover:bg-muted/30">
                      <td className="py-2 px-3 font-mono text-xs text-muted-foreground">
                        {String(b.booking_number ?? b.id ?? "-")}
                      </td>
                      <td className="py-2 px-3 text-foreground">{String(b.customer_name ?? "-")}</td>
                      <td className="py-2 px-3 text-muted-foreground">{String(b.facility_name ?? "-")}</td>
                      <td className="py-2 px-3 text-muted-foreground whitespace-nowrap">
                        {fmtDate(String(b.booking_date ?? ""))}
                      </td>
                      <td className="py-2 px-3">
                        <Badge className={`text-xs border ${STATUS_COLOR[String(b.status ?? "")] ?? "bg-muted text-muted-foreground border-border"}`}>
                          {STATUS_LABEL[String(b.status ?? "")] ?? String(b.status ?? "-")}
                        </Badge>
                      </td>
                      <td className="py-2 px-3 text-right font-medium text-foreground whitespace-nowrap">
                        {idr(Number(b.total_amount ?? b.total ?? 0))}
                      </td>
                    </tr>
                  ))}
                  {displayBookings.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-8 text-center text-muted-foreground text-sm">
                        {cardFilter
                          ? `Tidak ada booking dengan filter "${CARD_FILTER_LABEL[cardFilter] ?? cardFilter}"`
                          : "Belum ada booking"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
        </div>
        {/* ── FASE 6D-F: Heatmap Jam Ramai ────────────────────────────────── */}
        {(heatmapData?.length ?? 0) > 0 && (
          <Card className="border-border/60">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <BarChart2 className="h-4 w-4 text-yellow-400" /> Heatmap Jam Ramai
                <span className="text-xs font-normal opacity-60">— historis booking per jam</span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ResponsiveContainer width="100%" height={160}>
                <BarChart data={heatmapData ?? []} margin={{ left: 0, right: 0, top: 4, bottom: 0 }}>
                  <XAxis dataKey="hour" stroke="#6b7280" tick={{ fontSize: 10 }} />
                  <YAxis stroke="#6b7280" tick={{ fontSize: 10 }} width={28} allowDecimals={false} />
                  <Tooltip
                    formatter={(v: number) => [`${v} booking`, "Jumlah"]}
                    contentStyle={{ backgroundColor: "#1f2937", border: "1px solid #374151", borderRadius: 8 }}
                    labelStyle={{ color: "#e5e7eb", fontSize: 12 }}
                  />
                  <Bar dataKey="booking_count" name="Booking" radius={[3, 3, 0, 0]}>
                    {(heatmapData ?? []).map((entry, i) => {
                      const max = Math.max(...(heatmapData ?? []).map(r => r.booking_count), 1);
                      const intensity = entry.booking_count / max;
                      const color = intensity > 0.7 ? "#ef4444" : intensity > 0.4 ? "#f59e0b" : intensity > 0.1 ? "#3b82f6" : "#374151";
                      return <Cell key={i} fill={color} />;
                    })}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
              <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-500 inline-block" /> Sangat ramai</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500 inline-block" /> Ramai</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-blue-500 inline-block" /> Normal</span>
                <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-gray-700 inline-block" /> Sepi</span>
              </div>
            </CardContent>
          </Card>
        )}

        {/* ── Sync Status Panel ─────────────────────────────────────────────── */}
        <Card className="border-border/60">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
              <CardTitle className="text-sm font-medium text-muted-foreground flex items-center gap-2 flex-wrap">
                <CloudUpload className="h-4 w-4" /> Sinkronisasi ke Supabase
                {syncStatusLoading ? (
                  <span className="text-xs font-normal opacity-60 animate-pulse">— memeriksa koneksi...</span>
                ) : syncStatus?.circuitBreaker?.open ? (
                  <span className="text-xs font-normal text-orange-400">
                    — ⏸ Koneksi DB cooldown {syncStatus.circuitBreaker.remainingCooldownSeconds}s (ECIRCUITBREAKER)
                  </span>
                ) : syncStatus?.supabase.connected ? (
                  <span className="text-xs font-normal text-emerald-400">
                    — ✓ Terhubung [{syncStatus.supabase.project}] | {syncStatus.supabase.bookings} booking, {syncStatus.supabase.payments} payment, {syncStatus.supabase.facilities} fasilitas
                  </span>
                ) : syncStatus?.supabase.envConfigured === false ? (
                  <span className="text-xs font-normal text-yellow-400">
                    — ⚠ Env vars belum dikonfigurasi
                  </span>
                ) : (
                  <span className="text-xs font-normal text-red-400" title={syncStatus?.supabase.error ?? ""}>
                    — ✗ {(syncStatus?.supabase.error ?? "Tidak terhubung").slice(0, 80)}
                  </span>
                )}
              </CardTitle>
              <div className="flex items-center gap-2 flex-wrap">
                <Button
                  size="sm" variant="outline"
                  className="h-7 text-xs gap-1.5"
                  disabled={syncBusy}
                  onClick={() => { void refetchSync(); void refetchSyncStatus(); }}
                >
                  <RefreshCw className={`h-3 w-3 ${syncLoading ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
                <Button
                  size="sm" variant="outline"
                  className="h-7 text-xs gap-1.5 border-blue-700 text-blue-300 hover:bg-blue-950/40"
                  disabled={syncBusy}
                  onClick={() => void resyncFacilities.mutateAsync()}
                >
                  {resyncFacilities.isPending
                    ? <RefreshCw className="h-3 w-3 animate-spin" />
                    : <Database className="h-3 w-3" />}
                  Resync Fasilitas
                </Button>
                <Button
                  size="sm" variant="outline"
                  className="h-7 text-xs gap-1.5 border-purple-700 text-purple-300 hover:bg-purple-950/40"
                  disabled={syncBusy}
                  onClick={() => void resyncBookings.mutateAsync()}
                >
                  {resyncBookings.isPending
                    ? <RefreshCw className="h-3 w-3 animate-spin" />
                    : <BookOpen className="h-3 w-3" />}
                  Resync Booking
                </Button>
                <Button
                  size="sm"
                  className="h-7 text-xs gap-1.5 bg-emerald-700 hover:bg-emerald-600 text-white"
                  disabled={syncBusy}
                  onClick={() => void resyncAll.mutateAsync()}
                >
                  {resyncAll.isPending
                    ? <RefreshCw className="h-3 w-3 animate-spin" />
                    : <CloudUpload className="h-3 w-3" />}
                  Resync Semua
                </Button>
                <Button
                  size="sm" variant="outline"
                  className="h-7 text-xs gap-1.5 border-amber-700 text-amber-300 hover:bg-amber-950/40"
                  disabled={syncBusy}
                  onClick={() => void syncAccounting.mutateAsync()}
                >
                  {syncAccounting.isPending
                    ? <RefreshCw className="h-3 w-3 animate-spin" />
                    : <CheckCheck className="h-3 w-3" />}
                  Sync Akuntansi
                </Button>
                <Button
                  size="sm" variant="outline"
                  className={`h-7 text-xs gap-1.5 ${showDebugPanel ? "border-orange-600 text-orange-300 bg-orange-950/30" : "border-slate-600 text-slate-400 hover:text-orange-300 hover:border-orange-700"}`}
                  onClick={() => {
                    setShowDebugPanel(v => !v);
                    if (!showDebugPanel) void refetchDebug();
                  }}
                >
                  <Bug className="h-3 w-3" />
                  Audit CB
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {/* Hasil resync terakhir */}
            {(resyncFacilities.isSuccess || resyncAll.isSuccess || resyncBookings.isSuccess) && (
              <Alert className="border-emerald-700 bg-emerald-950/40 text-emerald-300 py-2">
                <CheckCircle2 className="h-4 w-4 text-emerald-400" />
                <AlertDescription className="text-xs">
                  {resyncAll.isSuccess && resyncAll.data && (
                    <span>
                      Resync selesai —{" "}
                      Fasilitas: <strong>{(resyncAll.data as any).facilities?.synced ?? 0}/{(resyncAll.data as any).facilities?.total ?? 0}</strong>,{" "}
                      Booking: <strong>{(resyncAll.data as any).bookings?.synced ?? 0}/{(resyncAll.data as any).bookings?.total ?? 0}</strong>
                    </span>
                  )}
                  {resyncFacilities.isSuccess && !resyncAll.isSuccess && resyncFacilities.data && (
                    <span>
                      Fasilitas berhasil disync —{" "}
                      <strong>{(resyncFacilities.data as any).synced ?? 0}/{(resyncFacilities.data as any).total ?? 0}</strong> fasilitas
                    </span>
                  )}
                  {resyncBookings.isSuccess && !resyncAll.isSuccess && resyncBookings.data && (
                    <span>
                      Booking berhasil disync —{" "}
                      <strong>{(resyncBookings.data as any).synced ?? 0}/{(resyncBookings.data as any).total ?? 0}</strong> booking
                    </span>
                  )}
                </AlertDescription>
              </Alert>
            )}
            {syncAccounting.isSuccess && syncAccounting.data && (
              <Alert className="border-amber-700 bg-amber-950/40 text-amber-300 py-2">
                <CheckCheck className="h-4 w-4 text-amber-400" />
                <AlertDescription className="text-xs space-y-0.5">
                  <span className="block">
                    Booking ditarik:{" "}
                    <strong>{syncAccounting.data.bookings?.pulled ?? 0}</strong> baru
                    {(syncAccounting.data.bookings?.deleted ?? 0) > 0 && (
                      <span>, <strong className="text-orange-400">{syncAccounting.data.bookings.deleted}</strong> dihapus (sudah tidak ada di Sport Center)</span>
                    )}
                    {(syncAccounting.data.bookings?.errors ?? 0) > 0 && (
                      <span>, <strong className="text-red-400">{syncAccounting.data.bookings.errors}</strong> error</span>
                    )}
                  </span>
                  <span className="block">
                    Pembayaran ditarik:{" "}
                    <strong>{syncAccounting.data.payments?.pulled ?? 0}</strong> baru,{" "}
                    <strong>{syncAccounting.data.payments?.skipped ?? 0}</strong> sudah ada
                    {(syncAccounting.data.payments?.deleted ?? 0) > 0 && (
                      <span>, <strong className="text-orange-400">{syncAccounting.data.payments.deleted}</strong> dihapus</span>
                    )}
                    {(syncAccounting.data.payments?.errors ?? 0) > 0 && (
                      <span>, <strong className="text-red-400">{syncAccounting.data.payments.errors}</strong> error</span>
                    )}
                  </span>
                  <span className="block">
                    Akuntansi disync:{" "}
                    <strong>{syncAccounting.data.accounting?.synced ?? 0}</strong> jurnal baru,{" "}
                    <strong>{syncAccounting.data.accounting?.skipped ?? 0}</strong> sudah ada
                    {(syncAccounting.data.accounting?.errors ?? 0) > 0 && (
                      <span>, <strong className="text-red-400">{syncAccounting.data.accounting.errors}</strong> error</span>
                    )}
                  </span>
                </AlertDescription>
              </Alert>
            )}
            {(resyncFacilities.isError || resyncAll.isError || resyncBookings.isError || syncAccounting.isError) && (
              <Alert className="border-red-700 bg-red-950/40 text-red-300 py-2">
                <XCircle className="h-4 w-4 text-red-400 shrink-0 mt-0.5" />
                <AlertDescription className="text-xs space-y-1">
                  {(() => {
                    const activeErr = resyncAll.error ?? resyncFacilities.error ?? resyncBookings.error ?? syncAccounting.error;
                    const msg = activeErr instanceof Error ? activeErr.message : String(activeErr ?? "Sync gagal");
                    const which = resyncAll.isError ? "Resync Semua" : resyncFacilities.isError ? "Resync Fasilitas" : resyncBookings.isError ? "Resync Booking" : "Sync Akuntansi";
                    return (
                      <>
                        <span className="font-semibold block">{which} gagal:</span>
                        <span className="block text-red-300/80">{msg}</span>
                        {msg.includes("cooldown") && (
                          <span className="block text-orange-300/80 mt-1">
                            ⏸ DB sedang dalam mode cooldown ECIRCUITBREAKER. Tunggu beberapa menit lalu coba lagi.
                          </span>
                        )}
                      </>
                    );
                  })()}
                </AlertDescription>
              </Alert>
            )}

            {/* Ringkasan last sync */}
            {!syncLoading && syncData && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div className="rounded-lg border border-border/40 bg-muted/20 p-3 space-y-1">
                  <p className="text-muted-foreground">Fasilitas lokal</p>
                  <p className="text-xl font-bold text-foreground">{syncData.local.facilities}</p>
                </div>
                <div className="rounded-lg border border-border/40 bg-muted/20 p-3 space-y-1">
                  <p className="text-muted-foreground">Booking lokal</p>
                  <p className="text-xl font-bold text-foreground">{syncData.local.bookings}</p>
                </div>
                <div className={`rounded-lg border p-3 space-y-1 ${syncData.last_facility_sync?.status === "ok" ? "border-emerald-700/50 bg-emerald-950/20" : syncData.last_facility_sync ? "border-red-700/50 bg-red-950/20" : "border-border/40 bg-muted/20"}`}>
                  <p className="text-muted-foreground flex items-center gap-1">
                    {syncData.last_facility_sync?.status === "ok"
                      ? <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                      : syncData.last_facility_sync
                        ? <XCircle className="h-3 w-3 text-red-400" />
                        : <Database className="h-3 w-3 text-muted-foreground" />}
                    Sync Fasilitas Terakhir
                  </p>
                  <p className="text-foreground font-medium text-xs">{fmtTs(syncData.last_facility_sync?.created_at)}</p>
                  {syncData.last_facility_sync?.detail && (
                    <p className="text-muted-foreground text-xs opacity-70">{syncData.last_facility_sync.detail}</p>
                  )}
                </div>
                <div className={`rounded-lg border p-3 space-y-1 ${syncData.last_booking_sync?.status === "ok" ? "border-emerald-700/50 bg-emerald-950/20" : syncData.last_booking_sync ? "border-red-700/50 bg-red-950/20" : "border-border/40 bg-muted/20"}`}>
                  <p className="text-muted-foreground flex items-center gap-1">
                    {syncData.last_booking_sync?.status === "ok"
                      ? <CheckCircle2 className="h-3 w-3 text-emerald-400" />
                      : syncData.last_booking_sync
                        ? <XCircle className="h-3 w-3 text-red-400" />
                        : <BookOpen className="h-3 w-3 text-muted-foreground" />}
                    Sync Booking Terakhir
                  </p>
                  <p className="text-foreground font-medium text-xs">{fmtTs(syncData.last_booking_sync?.created_at)}</p>
                  {syncData.last_booking_sync?.detail && (
                    <p className="text-muted-foreground text-xs opacity-70">{syncData.last_booking_sync.detail}</p>
                  )}
                </div>
              </div>
            )}

            {/* Log table */}
            {syncLoading && (
              <div className="h-20 rounded-lg bg-muted/20 animate-pulse" />
            )}
            {!syncLoading && (
              <div className="overflow-x-auto rounded-lg border border-border/40">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-border/40 bg-muted/30">
                      {["Waktu", "Entity", "Aksi", "ID", "Status", "Detail"].map((h) => (
                        <th key={h} className="text-left py-2 px-3 text-muted-foreground font-medium">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(syncData?.recent_logs ?? []).map((log) => (
                      <tr key={log.id} className="border-b border-border/20 hover:bg-muted/20 transition-colors">
                        <td className="py-2 px-3 font-mono text-muted-foreground whitespace-nowrap">
                          {fmtTs(log.created_at)}
                        </td>
                        <td className="py-2 px-3">
                          <Badge className={`text-xs border ${log.entity === "facility" ? "bg-blue-900/40 text-blue-300 border-blue-700" : "bg-purple-900/40 text-purple-300 border-purple-700"}`}>
                            {log.entity === "facility" ? "Fasilitas" : "Booking"}
                          </Badge>
                        </td>
                        <td className="py-2 px-3 text-muted-foreground capitalize">{log.action}</td>
                        <td className="py-2 px-3 font-mono text-muted-foreground">
                          {log.entity_id ?? <span className="opacity-40">—</span>}
                        </td>
                        <td className="py-2 px-3">
                          {log.status === "ok" ? (
                            <span className="inline-flex items-center gap-1 text-emerald-400">
                              <CheckCircle2 className="h-3 w-3" /> OK
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-red-400">
                              <XCircle className="h-3 w-3" /> Error
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-muted-foreground max-w-[200px] truncate">
                          {log.detail ?? <span className="opacity-30">—</span>}
                        </td>
                      </tr>
                    ))}
                    {(syncData?.recent_logs ?? []).length === 0 && !syncLoading && (
                      <tr>
                        <td colSpan={6} className="py-8 text-center text-muted-foreground">
                          Belum ada riwayat sinkronisasi. Klik <strong>Resync Semua</strong> untuk memulai.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
            {/* ── SyncDebugPanel (Circuit Breaker Audit) ───────────────────── */}
            {showDebugPanel && (
              <div className="rounded-lg border border-orange-800/60 bg-orange-950/10 p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-orange-300 flex items-center gap-2">
                    <Bug className="h-4 w-4" /> Audit Circuit Breaker
                  </h3>
                  <Button
                    size="sm" variant="ghost"
                    className="h-6 w-6 p-0 text-muted-foreground"
                    onClick={() => void refetchDebug()}
                    disabled={debugLoading}
                  >
                    <RefreshCw className={`h-3 w-3 ${debugLoading ? "animate-spin" : ""}`} />
                  </Button>
                </div>

                {debugLoading && (
                  <div className="space-y-2">
                    {[1,2,3].map(i => <div key={i} className="h-10 rounded bg-muted/20 animate-pulse" />)}
                  </div>
                )}
                {debugError && (
                  <p className="text-xs text-red-400">{(debugError as Error).message}</p>
                )}

                {debugData && (
                  <div className="space-y-4 text-xs">

                    {/* ── 1. Circuit Breaker Status ──────────────────────── */}
                    <div className={`rounded-lg border p-3 space-y-2 ${debugData.circuitBreaker.open ? "border-red-700/60 bg-red-950/20" : "border-emerald-700/40 bg-emerald-950/10"}`}>
                      <p className="font-semibold text-sm flex items-center gap-2">
                        <ShieldAlert className={`h-4 w-4 ${debugData.circuitBreaker.open ? "text-red-400" : "text-emerald-400"}`} />
                        Circuit Breaker: {debugData.circuitBreaker.open ? <span className="text-red-400">TERBUKA</span> : <span className="text-emerald-400">TERTUTUP (normal)</span>}
                      </p>
                      <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                        <div>
                          <p className="text-muted-foreground">Dibuka Pada</p>
                          <p className="font-mono text-foreground">{debugData.circuitBreaker.openedAt ? fmtTs(debugData.circuitBreaker.openedAt) : "—"}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Sisa Cooldown</p>
                          <p className={`font-bold ${debugData.circuitBreaker.remainingCooldownSeconds > 0 ? "text-orange-400" : "text-emerald-400"}`}>
                            {debugData.circuitBreaker.remainingCooldownSeconds > 0 ? `${debugData.circuitBreaker.remainingCooldownSeconds}s` : "Sudah selesai"}
                          </p>
                        </div>
                        <div>
                          <p className="text-muted-foreground">Sync Sukses Terakhir</p>
                          <p className="font-mono text-foreground">{debugData.lastSuccessfulSyncAt ? fmtTs(debugData.lastSuccessfulSyncAt) : "Belum pernah"}</p>
                        </div>
                      </div>

                      {/* Trigger pertama yang membuka CB */}
                      {debugData.circuitBreaker.lastTrigger && (
                        <div className="rounded border border-red-800/40 bg-red-950/20 p-2 space-y-1">
                          <p className="font-semibold text-red-300 flex items-center gap-1">
                            <AlertTriangle className="h-3 w-3" /> Error Yang Membuka CB
                          </p>
                          <p className="text-muted-foreground">Source: <span className="font-mono text-orange-300">{debugData.circuitBreaker.lastTrigger.source}</span></p>
                          <p className="text-muted-foreground">Waktu: <span className="font-mono">{fmtTs(debugData.circuitBreaker.lastTrigger.openedAt)}</span></p>
                          <p className="text-red-300/80 break-all">{debugData.circuitBreaker.lastTrigger.message}</p>
                        </div>
                      )}
                    </div>

                    {/* ── 2. DB & Supabase Config ────────────────────────── */}
                    <div className="rounded-lg border border-border/40 bg-muted/10 p-3 space-y-2">
                      <p className="font-semibold flex items-center gap-2"><Server className="h-3.5 w-3.5 text-blue-400" /> Target Sync</p>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        <div>
                          <p className="text-muted-foreground flex items-center gap-1"><Database className="h-3 w-3" /> DB Mode</p>
                          <p className={`font-semibold ${debugData.env === "production" ? "text-red-400" : "text-yellow-400"}`}>{debugData.env.toUpperCase()}</p>
                          <p className="font-mono text-muted-foreground/70 truncate" title={debugData.dbSource}>{debugData.dbSource}</p>
                          <p className="text-muted-foreground/60">Host: {debugData.dbHost}</p>
                        </div>
                        <div>
                          <p className="text-muted-foreground flex items-center gap-1"><Network className="h-3 w-3" /> Supabase Project</p>
                          <p className="font-mono text-blue-300">{debugData.supabaseProject}</p>
                          <div className="flex gap-2 mt-1">
                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs border ${debugData.supabaseUrlConfigured ? "border-emerald-700 text-emerald-400 bg-emerald-950/30" : "border-red-700 text-red-400 bg-red-950/30"}`}>
                              <Network className="h-3 w-3" /> URL {debugData.supabaseUrlConfigured ? "✓" : "✗"}
                            </span>
                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs border ${debugData.supabaseKeyConfigured ? "border-emerald-700 text-emerald-400 bg-emerald-950/30" : "border-red-700 text-red-400 bg-red-950/30"}`}>
                              <Key className="h-3 w-3" /> Key {debugData.supabaseKeyConfigured ? "✓" : "✗"}
                            </span>
                            <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs border ${debugData.dbAccessible ? "border-emerald-700 text-emerald-400 bg-emerald-950/30" : "border-orange-700 text-orange-400 bg-orange-950/30"}`}>
                              <Database className="h-3 w-3" /> DB {debugData.dbAccessible ? "aksesible" : "blokir"}
                            </span>
                          </div>
                        </div>
                      </div>
                    </div>

                    {/* ── 3. Root Cause ──────────────────────────────────── */}
                    <div className="rounded-lg border border-amber-700/50 bg-amber-950/10 p-3 space-y-2">
                      <p className="font-semibold text-amber-300 flex items-center gap-2">
                        <Info className="h-3.5 w-3.5" /> Root Cause
                      </p>
                      <p className="text-foreground leading-relaxed">{debugData.rootCause}</p>
                      {debugData.affectedFiles.length > 0 && (
                        <div>
                          <p className="text-muted-foreground mt-2">File yang perlu diperbaiki:</p>
                          <ul className="mt-1 space-y-0.5">
                            {debugData.affectedFiles.map(f => (
                              <li key={f} className="font-mono text-orange-300/80 flex items-center gap-1">
                                <FileText className="h-3 w-3 shrink-0" /> {f}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {debugData.recommendations.length > 0 && (
                        <div>
                          <p className="text-muted-foreground mt-2">Rekomendasi:</p>
                          <ul className="mt-1 space-y-1">
                            {debugData.recommendations.map((r, i) => (
                              <li key={i} className="text-foreground/80 flex gap-2">
                                <span className="text-emerald-500 shrink-0">{i + 1}.</span> {r}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>

                    {/* ── 4. Error Breakdown per Kategori ───────────────── */}
                    {(() => {
                      const cats = Object.entries(debugData.errorsByCategory).filter(([, v]) => v > 0);
                      if (cats.length === 0) return null;
                      const catColor: Record<string, string> = {
                        database: "bg-red-900/40 text-red-300 border-red-700",
                        auth: "bg-purple-900/40 text-purple-300 border-purple-700",
                        duplicate: "bg-yellow-900/40 text-yellow-300 border-yellow-700",
                        validation: "bg-orange-900/40 text-orange-300 border-orange-700",
                        schema_mismatch: "bg-blue-900/40 text-blue-300 border-blue-700",
                        foreign_key: "bg-pink-900/40 text-pink-300 border-pink-700",
                        network: "bg-cyan-900/40 text-cyan-300 border-cyan-700",
                        other: "bg-muted/40 text-muted-foreground border-border",
                      };
                      const catLabel: Record<string, string> = {
                        database: "Database/CB", auth: "Auth", duplicate: "Duplikat",
                        validation: "Validasi", schema_mismatch: "Schema Mismatch",
                        foreign_key: "Foreign Key", network: "Network", other: "Lainnya",
                      };
                      return (
                        <div>
                          <p className="font-semibold mb-2 flex items-center gap-2">
                            <BarChart2 className="h-3.5 w-3.5 text-muted-foreground" /> Jumlah Error per Kategori
                          </p>
                          <div className="flex flex-wrap gap-2">
                            {cats.sort((a,b) => b[1] - a[1]).map(([cat, count]) => (
                              <span key={cat} className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-xs font-medium ${catColor[cat] ?? catColor.other}`}>
                                {catLabel[cat] ?? cat} <strong>{count}</strong>
                              </span>
                            ))}
                          </div>
                        </div>
                      );
                    })()}

                    {/* ── 5. Error yang memicu CB (dari logs) ───────────── */}
                    {debugData.firstEcbOpeningError && (
                      <div className="rounded-lg border border-red-800/50 bg-red-950/15 p-3 space-y-2">
                        <p className="font-semibold text-red-300 flex items-center gap-2">
                          <AlertTriangle className="h-3.5 w-3.5" /> Error dari Log yang Membuka CB
                        </p>
                        <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                          <div><p className="text-muted-foreground">Modul</p><p className="capitalize text-foreground">{debugData.firstEcbOpeningError.entity}</p></div>
                          <div><p className="text-muted-foreground">Operasi</p><p className="capitalize text-foreground">{debugData.firstEcbOpeningError.action}</p></div>
                          <div><p className="text-muted-foreground">Entity ID</p><p className="font-mono text-foreground">{debugData.firstEcbOpeningError.entity_id ?? "—"}</p></div>
                          <div><p className="text-muted-foreground">Waktu</p><p className="font-mono">{fmtTs(debugData.firstEcbOpeningError.created_at)}</p></div>
                        </div>
                        <p className="text-red-300/80 break-all">{debugData.firstEcbOpeningError.detail}</p>
                      </div>
                    )}

                    {/* ── 6. 10 Error Terakhir ───────────────────────────── */}
                    {debugData.recentErrors.length > 0 && (
                      <div>
                        <p className="font-semibold mb-2 flex items-center gap-2">
                          <Hash className="h-3.5 w-3.5 text-muted-foreground" /> 10 Error Sync Terakhir
                        </p>
                        <div className="overflow-x-auto rounded-lg border border-border/40">
                          <table className="w-full text-xs">
                            <thead>
                              <tr className="border-b border-border/40 bg-muted/30">
                                {["Waktu", "Modul", "Operasi", "Entity ID", "Kategori", "Pesan Error"].map(h => (
                                  <th key={h} className="text-left py-2 px-3 text-muted-foreground font-medium whitespace-nowrap">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {debugData.recentErrors.map(e => {
                                const catColor: Record<string, string> = {
                                  database: "bg-red-900/30 text-red-300 border-red-800",
                                  auth: "bg-purple-900/30 text-purple-300 border-purple-800",
                                  duplicate: "bg-yellow-900/30 text-yellow-300 border-yellow-800",
                                  validation: "bg-orange-900/30 text-orange-300 border-orange-800",
                                  schema_mismatch: "bg-blue-900/30 text-blue-300 border-blue-800",
                                  foreign_key: "bg-pink-900/30 text-pink-300 border-pink-800",
                                  network: "bg-cyan-900/30 text-cyan-300 border-cyan-800",
                                  other: "bg-muted/30 text-muted-foreground border-border",
                                };
                                const catLabel: Record<string, string> = {
                                  database: "DB/CB", auth: "Auth", duplicate: "Duplikat",
                                  validation: "Validasi", schema_mismatch: "Schema", foreign_key: "FK", network: "Network", other: "Lain",
                                };
                                return (
                                  <tr key={e.id} className="border-b border-border/20 hover:bg-muted/10 transition-colors">
                                    <td className="py-2 px-3 font-mono text-muted-foreground whitespace-nowrap">{fmtTs(e.created_at)}</td>
                                    <td className="py-2 px-3 capitalize">{e.entity}</td>
                                    <td className="py-2 px-3 text-muted-foreground capitalize">{e.action}</td>
                                    <td className="py-2 px-3 font-mono text-center">{e.entity_id ?? <span className="opacity-30">—</span>}</td>
                                    <td className="py-2 px-3">
                                      <span className={`inline-block px-1.5 py-0.5 rounded border text-xs ${catColor[e.errorCategory] ?? catColor.other}`}>
                                        {catLabel[e.errorCategory] ?? e.errorCategory}
                                      </span>
                                    </td>
                                    <td className="py-2 px-3 text-red-300/70 max-w-[280px]">
                                      <span title={e.detail ?? ""} className="line-clamp-2 break-all">{e.detail ?? "—"}</span>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {debugData.recentErrors.length === 0 && !debugLoading && (
                      <p className="text-emerald-400 flex items-center gap-2">
                        <CheckCircle2 className="h-4 w-4" /> Tidak ada error sync yang tercatat.
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}

          </CardContent>
        </Card>

      </div>
    </AppShell>
  );
}
