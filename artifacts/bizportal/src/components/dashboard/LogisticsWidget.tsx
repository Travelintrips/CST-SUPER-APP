import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import {
  Truck, ArrowRight, ChevronRight, PackageSearch,
  FileText, Navigation, ReceiptText, CheckCircle2,
  AlertTriangle, PlusCircle, TrendingUp,
} from "lucide-react";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n);

interface LogisticsKPI {
  phases: {
    preOps: number;
    quotation: number;
    inTransit: number;
    billing: number;
  };
  completedAll: number;
  cancelledAll: number;
  totalAll: number;
  newToday: number;
  completedToday: number;
  stalled: number;
  activeRevenue: number;
  monthCompletedRevenue: number;
}

const PHASES = [
  {
    key: "preOps" as const,
    label: "Perlu Review",
    desc: "Order Received · Admin Review",
    icon: PackageSearch,
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-50 dark:bg-amber-950/30",
    border: "border-amber-200/60 dark:border-amber-800/40",
    href: "/logistics/portal-orders?status=New+Order",
  },
  {
    key: "quotation" as const,
    label: "Penawaran",
    desc: "RFQ · Quote · Approval · Confirmed",
    icon: FileText,
    color: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-50 dark:bg-blue-950/30",
    border: "border-blue-200/60 dark:border-blue-800/40",
    href: "/logistics/portal-orders?status=In+Progress",
  },
  {
    key: "inTransit" as const,
    label: "Pengiriman",
    desc: "Pickup · In Transit · Arrived · Delivered",
    icon: Navigation,
    color: "text-indigo-600 dark:text-indigo-400",
    bg: "bg-indigo-50 dark:bg-indigo-950/30",
    border: "border-indigo-200/60 dark:border-indigo-800/40",
    href: "/logistics/portal-orders?status=In+Progress",
  },
  {
    key: "billing" as const,
    label: "Penagihan",
    desc: "POD · Invoice · Payment",
    icon: ReceiptText,
    color: "text-purple-600 dark:text-purple-400",
    bg: "bg-purple-50 dark:bg-purple-950/30",
    border: "border-purple-200/60 dark:border-purple-800/40",
    href: "/logistics/portal-orders?status=In+Progress",
  },
];

export function LogisticsWidget() {
  const { data, isLoading } = useQuery<LogisticsKPI>({
    queryKey: ["logistics-dashboard-kpi"],
    queryFn: async () => {
      const r = await fetch("/api/logistic/orders/dashboard-kpi", {
        credentials: "include",
      });
      if (!r.ok) throw new Error("Gagal memuat data logistik");
      return r.json() as Promise<LogisticsKPI>;
    },
    refetchInterval: 5 * 60_000,
    retry: 1,
  });

  const activeOrders =
    (data?.phases.preOps ?? 0) +
    (data?.phases.quotation ?? 0) +
    (data?.phases.inTransit ?? 0) +
    (data?.phases.billing ?? 0);

  return (
    <Card className="lg:col-span-2 border-border/70">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-900/40">
              <Truck className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <CardTitle className="text-base">Logistik</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">Pipeline Order Aktif</p>
            </div>
            {(data?.stalled ?? 0) > 0 && (
              <Badge variant="destructive" className="ml-1 text-[10px] py-0 h-4 gap-0.5">
                <AlertTriangle className="h-2.5 w-2.5" />
                {data!.stalled} Stalled
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/logistics/portal-orders/new">
                <PlusCircle className="h-3.5 w-3.5 mr-1" />
                Order
              </Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/logistics/portal-orders">
                Semua <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Pipeline phases */}
        {isLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-20 rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {PHASES.map((ph) => {
              const count = data?.phases[ph.key] ?? 0;
              return (
                <Link
                  key={ph.key}
                  href={ph.href}
                  className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
                >
                  <div
                    className={`rounded-lg border p-3 transition-all hover:shadow-sm hover:scale-[1.02] ${ph.bg} ${ph.border}`}
                  >
                    <div className="flex items-center gap-1.5 mb-2">
                      <ph.icon className={`h-3.5 w-3.5 shrink-0 ${ph.color}`} />
                      <span className={`text-xs font-semibold ${ph.color}`}>{ph.label}</span>
                      <ChevronRight className="h-3 w-3 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity ml-auto shrink-0" />
                    </div>
                    <p className={`text-2xl font-bold tabular-nums ${ph.color}`}>{count}</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5 leading-tight">
                      {ph.desc}
                    </p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {/* Summary row */}
        {!isLoading && (
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div className="rounded-md bg-muted/30 border border-border/40 px-3 py-2 flex items-center gap-2">
              <Truck className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-[10px] text-muted-foreground">Aktif</p>
                <p className="text-sm font-bold tabular-nums">{activeOrders}</p>
              </div>
            </div>
            <div className="rounded-md bg-muted/30 border border-border/40 px-3 py-2 flex items-center gap-2">
              <PlusCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-[10px] text-muted-foreground">Masuk Hari Ini</p>
                <p className="text-sm font-bold tabular-nums">{data?.newToday ?? 0}</p>
              </div>
            </div>
            <div className="rounded-md bg-muted/30 border border-border/40 px-3 py-2 flex items-center gap-2">
              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
              <div>
                <p className="text-[10px] text-muted-foreground">Selesai Hari Ini</p>
                <p className="text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {data?.completedToday ?? 0}
                </p>
              </div>
            </div>
            <div className="rounded-md bg-muted/30 border border-border/40 px-3 py-2 flex items-center gap-2">
              <TrendingUp className="h-3.5 w-3.5 text-purple-500 shrink-0" />
              <div>
                <p className="text-[10px] text-muted-foreground">Revenue Bulan Ini</p>
                <p className="text-sm font-bold tabular-nums text-purple-600 dark:text-purple-400 truncate">
                  {idr(data?.monthCompletedRevenue ?? 0)}
                </p>
              </div>
            </div>
          </div>
        )}

        {/* Stalled warning */}
        {!isLoading && (data?.stalled ?? 0) > 0 && (
          <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 flex items-center gap-2">
            <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
            <p className="text-xs text-destructive">
              <span className="font-semibold">{data!.stalled} order</span> tidak ada update lebih dari 7 hari.{" "}
              <Link href="/logistics/portal-orders?status=In+Progress" className="underline underline-offset-2">
                Tinjau sekarang
              </Link>
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
