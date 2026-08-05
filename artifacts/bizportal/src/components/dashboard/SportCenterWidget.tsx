import { useState, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import {
  Dumbbell, DollarSign, CalendarDays, Flame,
  TrendingUp, ArrowDownRight, ChevronRight, ArrowRight,
  CheckCheck, Users, Radio,
} from "lucide-react";
import { useSportCenterEvents, type SportCenterEvent } from "@/hooks/useSportCenterEvents";

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

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n);

export function SportCenterWidget() {
  const { activeCompanyId } = useCompany();
  const [newCount, setNewCount] = useState(0);
  const [pulse, setPulse] = useState(false);

  const { data: kpi, isLoading } = useQuery<KpiLiveData>({
    queryKey: ["sport-center-kpi-live-main-dash", activeCompanyId],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (activeCompanyId) qs.set("companyId", String(activeCompanyId));
      const r = await fetch(`/api/sport-center/kpi-live?${qs}`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error("Gagal memuat KPI Sport Center");
      return r.json() as Promise<KpiLiveData>;
    },
    refetchInterval: 60_000,
    retry: 1,
  });

  const handleEvent = useCallback((ev: SportCenterEvent) => {
    if (ev.entity === "booking" && ev.action === "created") {
      setNewCount((n) => n + 1);
      setPulse(true);
      setTimeout(() => setPulse(false), 2_000);
    }
  }, []);

  useSportCenterEvents({
    companyId: activeCompanyId,
    onEvent: handleEvent,
    showToast: true,
  });

  const metrics = [
    {
      label: "Revenue Hari Ini",
      value: idr(kpi?.revenue_today ?? 0),
      icon: DollarSign,
      color: "text-blue-500",
      bg: "bg-blue-50 dark:bg-blue-950/30",
      border: "border-blue-200/60 dark:border-blue-800/40",
    },
    {
      label: "Booking Hari Ini",
      value: String(kpi?.bookings_today ?? 0),
      sub: `${kpi?.active_bookings_now ?? 0} aktif sekarang`,
      icon: CalendarDays,
      color: "text-purple-500",
      bg: "bg-purple-50 dark:bg-purple-950/30",
      border: "border-purple-200/60 dark:border-purple-800/40",
    },
    {
      label: "Check-In",
      value: String(kpi?.checkins_today ?? 0),
      icon: CheckCheck,
      color: "text-emerald-500",
      bg: "bg-emerald-50 dark:bg-emerald-950/30",
      border: "border-emerald-200/60 dark:border-emerald-800/40",
    },
    {
      label: "Occupancy",
      value: `${kpi?.occupancy_today ?? 0}%`,
      sub: `${kpi?.occupied_hours_today ?? 0}h / ${kpi?.available_hours_today ?? 0}h`,
      icon: Flame,
      color: "text-orange-500",
      bg: "bg-orange-50 dark:bg-orange-950/30",
      border: "border-orange-200/60 dark:border-orange-800/40",
    },
    {
      label: "Net Profit",
      value: idr(kpi?.net_profit_today ?? 0),
      icon: TrendingUp,
      color: (kpi?.net_profit_today ?? 0) >= 0 ? "text-teal-500" : "text-destructive",
      bg: (kpi?.net_profit_today ?? 0) >= 0
        ? "bg-teal-50 dark:bg-teal-950/30"
        : "bg-red-50 dark:bg-red-950/30",
      border: (kpi?.net_profit_today ?? 0) >= 0
        ? "border-teal-200/60 dark:border-teal-800/40"
        : "border-red-200/60 dark:border-red-800/40",
    },
    {
      label: "Member Aktif",
      value: String(kpi?.members_active ?? 0),
      icon: Users,
      color: "text-indigo-500",
      bg: "bg-indigo-50 dark:bg-indigo-950/30",
      border: "border-indigo-200/60 dark:border-indigo-800/40",
    },
  ];

  return (
    <Card
      className={`lg:col-span-2 border-border/70 transition-all duration-700 ${
        pulse ? "ring-2 ring-emerald-400/60 shadow-emerald-400/20 shadow-lg" : ""
      }`}
    >
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-emerald-100 dark:bg-emerald-900/40">
              <Dumbbell className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
            </div>
            <div>
              <CardTitle className="text-base">Sport Center</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">KPI Hari Ini — Live</p>
            </div>

            {/* Live indicator */}
            <Badge className="ml-1 text-xs bg-emerald-100 text-emerald-700 border-emerald-200 dark:bg-emerald-900/40 dark:text-emerald-300 dark:border-emerald-700 gap-1">
              <Radio className="h-2.5 w-2.5 animate-pulse" />
              Live
            </Badge>

            {/* New booking counter badge */}
            {newCount > 0 && (
              <button
                onClick={() => setNewCount(0)}
                className="focus:outline-none"
                title="Klik untuk reset"
              >
                <Badge className="text-xs bg-purple-100 text-purple-700 border-purple-300 dark:bg-purple-900/40 dark:text-purple-300 dark:border-purple-700 gap-1 cursor-pointer hover:bg-purple-200 dark:hover:bg-purple-800/50 transition-colors">
                  +{newCount} booking baru
                </Badge>
              </button>
            )}
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/sport-center/dashboard">
              Lihat Detail <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {metrics.map((m) => (
              <Link
                key={m.label}
                href="/sport-center/dashboard"
                className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
              >
                <div
                  className={`rounded-lg border p-3 transition-all hover:shadow-sm hover:scale-[1.02] ${m.bg} ${m.border}`}
                >
                  <div className="flex items-center gap-1.5 mb-1.5">
                    <m.icon className={`h-3.5 w-3.5 shrink-0 ${m.color}`} />
                    <span className="text-[10px] text-muted-foreground leading-tight truncate">
                      {m.label}
                    </span>
                    <ChevronRight className="h-3 w-3 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity ml-auto shrink-0" />
                  </div>
                  <p className={`text-base font-bold truncate ${m.color}`}>{m.value}</p>
                  {m.sub && (
                    <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{m.sub}</p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Refund info strip */}
        {!isLoading && (kpi?.refunds_today ?? 0) > 0 && (
          <div className="mt-3 flex items-center gap-2 rounded-md border border-red-200/60 bg-red-50/60 dark:border-red-800/30 dark:bg-red-950/20 px-3 py-2">
            <ArrowDownRight className="h-3.5 w-3.5 text-red-500 shrink-0" />
            <span className="text-xs text-red-600 dark:text-red-400">
              Refund hari ini: <strong>{idr(kpi?.refunds_today ?? 0)}</strong>
            </span>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
