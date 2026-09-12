import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/layout/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  RefreshCw, Package, ClipboardList, Clock, Users, Truck,
  CheckCircle2, MessageSquareX, AlertTriangle, ArrowRight,
  Ship, Plane, Container, Wifi, WifiOff, Volume2, VolumeX, Bell, BellOff,
} from "lucide-react";
import { useCompany } from "@/contexts/CompanyContext";
import { Link } from "wouter";
import { subscribeToInvalidation, subscribeToConnection } from "@/hooks/useAlertWebSocket";

// ── Types ─────────────────────────────────────────────────────────────────────

interface OperationalData {
  todayOrders: number;
  pendingRfq: number;
  waitingVendor: number;
  waitingCustomer: number;
  inFulfillment: number;
  podCompleted: number;
  failedWa: number;
  recentOrders: {
    orderNumber: string;
    status: string;
    customerName: string;
    origin: string;
    destination: string;
    createdAt: string;
    transportMode: string | null;
    hasVendor: boolean;
  }[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  "Order Received":    "bg-slate-100 text-slate-700",
  "Admin Review":      "bg-yellow-100 text-yellow-700",
  "RFQ Sent":          "bg-blue-100 text-blue-700",
  "Quote Received":    "bg-indigo-100 text-indigo-700",
  "Customer Approval": "bg-orange-100 text-orange-700",
  "Vendor Confirmed":  "bg-teal-100 text-teal-700",
  "In Progress":       "bg-cyan-100 text-cyan-700",
  "Pickup":            "bg-violet-100 text-violet-700",
  "In Transit":        "bg-blue-200 text-blue-800",
  "Arrived":           "bg-emerald-100 text-emerald-700",
  "Delivered":         "bg-green-100 text-green-700",
  "POD Uploaded":      "bg-lime-100 text-lime-700",
  "Invoice Issued":    "bg-purple-100 text-purple-700",
  "Payment Received":  "bg-emerald-200 text-emerald-800",
  "Completed":         "bg-green-200 text-green-800",
  "Cancelled":         "bg-red-100 text-red-600",
};

const STATUS_LABEL_ID: Record<string, string> = {
  "Order Received":    "Order Masuk",
  "Admin Review":      "Review Admin",
  "RFQ Sent":          "RFQ Terkirim",
  "Quote Received":    "Quote Masuk",
  "Customer Approval": "Tunggu Customer",
  "Vendor Confirmed":  "Vendor Konfirmasi",
  "In Progress":       "Diproses",
  "Pickup":            "Penjemputan",
  "In Transit":        "Dalam Perjalanan",
  "Arrived":           "Tiba",
  "Delivered":         "Terkirim",
  "POD Uploaded":      "POD Upload",
  "Invoice Issued":    "Invoice Terbit",
  "Payment Received":  "Lunas",
  "Completed":         "Selesai",
  "Cancelled":         "Dibatalkan",
};

function ModeIcon({ mode }: { mode: string | null }) {
  if (!mode) return <Package className="h-3.5 w-3.5 text-muted-foreground" />;
  if (mode.toLowerCase().includes("sea") || mode.toLowerCase().includes("laut"))
    return <Ship className="h-3.5 w-3.5 text-blue-500" />;
  if (mode.toLowerCase().includes("air") || mode.toLowerCase().includes("udara"))
    return <Plane className="h-3.5 w-3.5 text-sky-500" />;
  if (mode.toLowerCase().includes("land") || mode.toLowerCase().includes("darat"))
    return <Truck className="h-3.5 w-3.5 text-amber-500" />;
  return <Container className="h-3.5 w-3.5 text-muted-foreground" />;
}

// ── Stat Card ─────────────────────────────────────────────────────────────────

interface StatCardProps {
  label: string;
  value: number;
  icon: React.ReactNode;
  colorClass: string;
  href?: string;
  urgent?: boolean;
}

function StatCard({ label, value, icon, colorClass, href, urgent }: StatCardProps) {
  const inner = (
    <Card className={`relative overflow-hidden transition-shadow hover:shadow-md ${urgent && value > 0 ? "ring-2 ring-red-400" : ""}`}>
      <CardContent className="p-5 flex items-center gap-4">
        <div className={`p-3 rounded-xl ${colorClass}`}>
          {icon}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground font-medium truncate">{label}</p>
          <p className={`text-3xl font-bold tabular-nums leading-tight ${urgent && value > 0 ? "text-red-600" : ""}`}>
            {value}
          </p>
        </div>
        {href && (
          <ArrowRight className="h-4 w-4 text-muted-foreground shrink-0" />
        )}
        {urgent && value > 0 && (
          <span className="absolute top-2 right-2">
            <AlertTriangle className="h-3.5 w-3.5 text-red-500" />
          </span>
        )}
      </CardContent>
    </Card>
  );

  if (href) {
    return <Link href={href} className="block">{inner}</Link>;
  }
  return inner;
}

// ── Live Indicator ─────────────────────────────────────────────────────────────

function LiveIndicator({ isLive }: { isLive: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${
      isLive
        ? "bg-emerald-50 border-emerald-200 text-emerald-700 dark:bg-emerald-950/30 dark:border-emerald-800 dark:text-emerald-400"
        : "bg-muted border-border text-muted-foreground"
    }`}>
      {isLive ? (
        <>
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
          </span>
          <Wifi className="h-3 w-3" />
          Live
        </>
      ) : (
        <>
          <WifiOff className="h-3 w-3" />
          Offline
        </>
      )}
    </div>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function OperationalDashboardPage() {
  const { selectedCompanyId } = useCompany();

  const params = new URLSearchParams();
  if (selectedCompanyId) params.set("companyId", String(selectedCompanyId));

  const { data, isLoading, isFetching, refetch, dataUpdatedAt } = useQuery<OperationalData>({
    queryKey: ["operational-dashboard", selectedCompanyId],
    queryFn: async () => {
      const r = await fetch(`/api/dashboard/operational?${params}`);
      if (!r.ok) throw new Error("Gagal memuat data");
      return r.json();
    },
    refetchInterval: 60_000,
  });

  // ── Real-time state ──────────────────────────────────────────────────────────
  const [isLive, setIsLive] = useState(false);
  const [newOrderNums, setNewOrderNums] = useState<Set<string>>(new Set());
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [notifPermission, setNotifPermission] = useState<NotificationPermission>(
    () => (typeof Notification !== "undefined" ? Notification.permission : "denied")
  );
  const seenRef = useRef<Set<string>>(new Set());
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  async function requestNotifPermission() {
    if (typeof Notification === "undefined") return;
    const result = await Notification.requestPermission();
    setNotifPermission(result);
  }

  function sendPushNotification(count: number, orderNums: string[]) {
    if (typeof Notification === "undefined" || Notification.permission !== "granted") return;
    const label = count === 1 ? (orderNums[0] ?? "") : `${count} order baru`;
    new Notification("📦 Order Baru Masuk", {
      body: label,
      icon: "/api/storage/public-objects/portal-assets/static/customer-portal/images/logo.png",
      tag: "new-logistic-order",
      renotify: true,
    } as any);
  }

  function playOrderAlert() {
    try {
      if (!audioCtxRef.current || audioCtxRef.current.state === "closed") {
        audioCtxRef.current = new AudioContext();
      }
      const ctx = audioCtxRef.current;
      if (ctx.state === "suspended") ctx.resume();
      // Two-tone notification beep
      [[880, 0, 0.12], [1100, 0.15, 0.12]].forEach(([freq, delay, dur]) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = "sine";
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0, ctx.currentTime + delay);
        gain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + delay + 0.02);
        gain.gain.linearRampToValueAtTime(0, ctx.currentTime + delay + dur);
        osc.start(ctx.currentTime + delay);
        osc.stop(ctx.currentTime + delay + dur + 0.01);
      });
    } catch {
      // AudioContext not available — silently ignore
    }
  }

  // Subscribe to SSE connection status
  useEffect(() => {
    return subscribeToConnection(setIsLive);
  }, []);

  // Subscribe to logistic_orders invalidation → force refetch
  useEffect(() => {
    return subscribeToInvalidation((scope) => {
      if (scope === "logistic_orders") {
        void refetch();
      }
    });
  }, [refetch]);

  // Detect newly appeared orders when data updates
  useEffect(() => {
    if (!data?.recentOrders) return;
    const currentNums = data.recentOrders.map((o) => o.orderNumber);

    if (seenRef.current.size === 0) {
      // First load — just populate seenRef, no highlight
      currentNums.forEach((n) => seenRef.current.add(n));
      return;
    }

    const brandNew = currentNums.filter((n) => !seenRef.current.has(n));
    currentNums.forEach((n) => seenRef.current.add(n));

    if (brandNew.length > 0) {
      setNewOrderNums(new Set(brandNew));
      if (soundEnabled) playOrderAlert();
      sendPushNotification(brandNew.length, brandNew);
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
      flashTimerRef.current = setTimeout(() => {
        setNewOrderNums(new Set());
      }, 12_000);
    }
  }, [dataUpdatedAt, data?.recentOrders, soundEnabled]);

  useEffect(() => () => {
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
  }, []);

  const lastUpdated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString("id-ID", { hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : null;

  return (
    <AppShell>
      <div className="p-6 space-y-6 max-w-7xl mx-auto">

        {/* ── Header ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h1 className="text-2xl font-bold">Operational Dashboard</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Snapshot real-time status order logistik
              {lastUpdated && <span className="ml-2 text-xs">• diperbarui {lastUpdated}</span>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <LiveIndicator isLive={isLive} />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSoundEnabled((v) => !v)}
              title={soundEnabled ? "Matikan suara notifikasi" : "Aktifkan suara notifikasi"}
            >
              {soundEnabled
                ? <Volume2 className="h-4 w-4 text-emerald-600" />
                : <VolumeX className="h-4 w-4 text-muted-foreground" />}
            </Button>
            {typeof Notification !== "undefined" && (
              <Button
                variant="ghost"
                size="sm"
                onClick={notifPermission === "granted" ? undefined : requestNotifPermission}
                title={
                  notifPermission === "granted"
                    ? "Notifikasi browser aktif"
                    : notifPermission === "denied"
                    ? "Notifikasi diblokir browser — ubah di pengaturan browser"
                    : "Aktifkan notifikasi browser"
                }
                className={notifPermission === "denied" ? "opacity-40 cursor-not-allowed" : ""}
              >
                {notifPermission === "granted"
                  ? <Bell className="h-4 w-4 text-emerald-600" />
                  : <BellOff className="h-4 w-4 text-muted-foreground" />}
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isFetching}>
              <RefreshCw className={`h-4 w-4 mr-1.5 ${isFetching ? "animate-spin" : ""}`} />
              Refresh
            </Button>
          </div>
        </div>

        {/* ── KPI Cards ──────────────────────────────────────────────── */}
        {isLoading ? (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {Array.from({ length: 7 }).map((_, i) => (
              <Card key={i}>
                <CardContent className="p-5">
                  <div className="h-16 animate-pulse bg-muted rounded-lg" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <>
            {/* Row 1 — Today + pipeline funnel */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <StatCard
                label="Order Hari Ini"
                value={data?.todayOrders ?? 0}
                icon={<Package className="h-5 w-5 text-blue-600" />}
                colorClass="bg-blue-50"
                href="/logistics/portal-orders"
              />
              <StatCard
                label="Pending RFQ"
                value={data?.pendingRfq ?? 0}
                icon={<ClipboardList className="h-5 w-5 text-yellow-600" />}
                colorClass="bg-yellow-50"
                href="/logistics/portal-orders"
                urgent={(data?.pendingRfq ?? 0) > 5}
              />
              <StatCard
                label="Waiting Vendor"
                value={data?.waitingVendor ?? 0}
                icon={<Clock className="h-5 w-5 text-indigo-600" />}
                colorClass="bg-indigo-50"
                href="/logistics/rfq"
              />
              <StatCard
                label="Waiting Customer"
                value={data?.waitingCustomer ?? 0}
                icon={<Users className="h-5 w-5 text-orange-600" />}
                colorClass="bg-orange-50"
                href="/logistics/quote-requests"
              />
            </div>

            {/* Row 2 — Active + done + alert */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <StatCard
                label="In Fulfillment"
                value={data?.inFulfillment ?? 0}
                icon={<Truck className="h-5 w-5 text-cyan-600" />}
                colorClass="bg-cyan-50"
                href="/logistics"
              />
              <StatCard
                label="POD Completed"
                value={data?.podCompleted ?? 0}
                icon={<CheckCircle2 className="h-5 w-5 text-emerald-600" />}
                colorClass="bg-emerald-50"
                href="/logistics"
              />
              <StatCard
                label="Failed WA (7 hari)"
                value={data?.failedWa ?? 0}
                icon={<MessageSquareX className="h-5 w-5 text-red-600" />}
                colorClass="bg-red-50"
                href="/notification-history"
                urgent
              />
            </div>
          </>
        )}

        {/* ── Active Orders Table ─────────────────────────────────────── */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CardTitle className="text-base">Order Aktif Terkini</CardTitle>
                {newOrderNums.size > 0 && (
                  <Badge className="bg-emerald-500 hover:bg-emerald-500 text-white text-[10px] px-1.5 py-0 animate-pulse">
                    +{newOrderNums.size} baru
                  </Badge>
                )}
              </div>
              <Link href="/logistics/portal-orders">
                <Button variant="ghost" size="sm" className="text-xs gap-1">
                  Lihat Semua <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              </Link>
            </div>
          </CardHeader>
          <CardContent className="p-0">
            {isLoading ? (
              <div className="p-6 space-y-3">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="h-10 animate-pulse bg-muted rounded" />
                ))}
              </div>
            ) : !data?.recentOrders?.length ? (
              <div className="p-8 text-center text-muted-foreground text-sm">
                Tidak ada order aktif saat ini
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-muted/40">
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground whitespace-nowrap">No. Order</th>
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Status</th>
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground">Customer</th>
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground hidden md:table-cell">Rute</th>
                      <th className="px-4 py-2.5 text-left font-medium text-muted-foreground hidden lg:table-cell whitespace-nowrap">Dibuat</th>
                      <th className="px-4 py-2.5 text-center font-medium text-muted-foreground hidden sm:table-cell">Moda</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentOrders.map((order, i) => {
                      const isNew = newOrderNums.has(order.orderNumber);
                      return (
                        <tr
                          key={order.orderNumber}
                          className={`border-b last:border-0 transition-colors ${
                            isNew
                              ? "bg-emerald-50/80 dark:bg-emerald-950/30 ring-1 ring-inset ring-emerald-200 dark:ring-emerald-800"
                              : i % 2 === 0
                                ? "hover:bg-muted/30"
                                : "bg-muted/10 hover:bg-muted/30"
                          }`}
                        >
                          <td className="px-4 py-2.5 font-mono text-xs font-medium">
                            <div className="flex items-center gap-1.5">
                              {isNew && (
                                <span className="relative flex h-2 w-2 shrink-0">
                                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                                </span>
                              )}
                              <Link href={`/logistics/${order.orderNumber}`} className="text-blue-600 hover:underline">
                                {order.orderNumber}
                              </Link>
                            </div>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLOR[order.status] ?? "bg-gray-100 text-gray-700"}`}>
                              {STATUS_LABEL_ID[order.status] ?? order.status}
                            </span>
                          </td>
                          <td className="px-4 py-2.5 max-w-[160px] truncate text-sm">
                            {order.customerName}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground hidden md:table-cell max-w-[200px] truncate">
                            {order.origin} → {order.destination}
                          </td>
                          <td className="px-4 py-2.5 text-xs text-muted-foreground hidden lg:table-cell whitespace-nowrap">
                            {order.createdAt}
                          </td>
                          <td className="px-4 py-2.5 text-center hidden sm:table-cell">
                            <ModeIcon mode={order.transportMode} />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ── Pipeline Summary ────────────────────────────────────────── */}
        {data && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Pipeline Funnel</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-1 flex-wrap">
                {[
                  { label: "Pending RFQ",      value: data.pendingRfq,      color: "bg-yellow-400" },
                  { label: "Waiting Vendor",   value: data.waitingVendor,   color: "bg-indigo-400" },
                  { label: "Waiting Customer", value: data.waitingCustomer, color: "bg-orange-400" },
                  { label: "In Fulfillment",   value: data.inFulfillment,   color: "bg-cyan-400"   },
                  { label: "POD Completed",    value: data.podCompleted,    color: "bg-emerald-400" },
                ].map((stage, i, arr) => {
                  const total = arr.reduce((s, x) => s + x.value, 0) || 1;
                  const pct = Math.max((stage.value / total) * 100, stage.value > 0 ? 4 : 0);
                  return (
                    <div key={stage.label} className="flex flex-col items-center gap-1 flex-1 min-w-[60px]">
                      <div className="w-full rounded-full bg-muted h-3 overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${stage.color}`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                      <span className="text-xs text-muted-foreground text-center leading-tight">{stage.label}</span>
                      <span className="text-sm font-bold tabular-nums">{stage.value}</span>
                    </div>
                  );
                })}
              </div>
            </CardContent>
          </Card>
        )}

      </div>
    </AppShell>
  );
}
