import { useQuery } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import {
  ShoppingCart, ArrowRight, ChevronRight, FileSearch,
  ClipboardList, ReceiptText, AlertTriangle, PlusCircle,
  TrendingUp, Clock,
} from "lucide-react";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n);

interface PurchasingKPI {
  activeRfqs: number;
  activePOs: number;
  toBill: number;
  billedUnpaid: number;
  overdueCount: number;
  overdueAmount: number;
  monthSpend: number;
  newToday: number;
  topSuppliers: { name: string; total: number }[];
}

const TILES = [
  {
    key: "activeRfqs" as const,
    label: "RFQ Aktif",
    icon: FileSearch,
    color: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-50 dark:bg-blue-950/30",
    border: "border-blue-200/60 dark:border-blue-800/40",
    href: "/purchase/rfq",
  },
  {
    key: "activePOs" as const,
    label: "PO Aktif",
    icon: ClipboardList,
    color: "text-indigo-600 dark:text-indigo-400",
    bg: "bg-indigo-50 dark:bg-indigo-950/30",
    border: "border-indigo-200/60 dark:border-indigo-800/40",
    href: "/purchase/orders",
  },
  {
    key: "toBill" as const,
    label: "Perlu Dibill",
    icon: ReceiptText,
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-50 dark:bg-amber-950/30",
    border: "border-amber-200/60 dark:border-amber-800/40",
    href: "/purchase/orders?billStatus=to_bill",
  },
  {
    key: "billedUnpaid" as const,
    label: "Belum Lunas",
    icon: Clock,
    color: "text-purple-600 dark:text-purple-400",
    bg: "bg-purple-50 dark:bg-purple-950/30",
    border: "border-purple-200/60 dark:border-purple-800/40",
    href: "/purchase/orders?paymentStatus=unpaid",
  },
];

export function PurchasingWidget() {
  const { activeCompanyId } = useCompany();

  const { data, isLoading } = useQuery<PurchasingKPI>({
    queryKey: ["purchase-dashboard-kpi", activeCompanyId],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (activeCompanyId) qs.set("companyId", String(activeCompanyId));
      const r = await fetch(`/api/purchase/dashboard-kpi?${qs}`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error("Gagal memuat data purchasing");
      return r.json() as Promise<PurchasingKPI>;
    },
    refetchInterval: 10 * 60_000,
    retry: 1,
  });

  const hasOverdue = (data?.overdueCount ?? 0) > 0;

  return (
    <Card className="lg:col-span-2 border-border/70">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-orange-100 dark:bg-orange-900/40">
              <ShoppingCart className="h-4 w-4 text-orange-600 dark:text-orange-400" />
            </div>
            <div>
              <CardTitle className="text-base">Pembelian</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">RFQ & Purchase Order</p>
            </div>
            {hasOverdue && (
              <Badge variant="destructive" className="ml-1 text-[10px] py-0 h-4 gap-0.5">
                <AlertTriangle className="h-2.5 w-2.5" />
                {data!.overdueCount} Overdue
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/purchase/rfq/new">
                <PlusCircle className="h-3.5 w-3.5 mr-1" />
                RFQ
              </Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/purchase">
                Semua <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Status tiles */}
        {isLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            {TILES.map((t) => {
              const val = data?.[t.key] ?? 0;
              return (
                <Link
                  key={t.key}
                  href={t.href}
                  className="block group focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg"
                >
                  <div
                    className={`rounded-lg border p-3 transition-all hover:shadow-sm hover:scale-[1.02] ${t.bg} ${t.border}`}
                  >
                    <div className="flex items-center gap-1.5 mb-1.5">
                      <t.icon className={`h-3.5 w-3.5 shrink-0 ${t.color}`} />
                      <span className={`text-xs font-medium ${t.color}`}>{t.label}</span>
                      <ChevronRight className="h-3 w-3 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity ml-auto shrink-0" />
                    </div>
                    <p className={`text-2xl font-bold tabular-nums ${t.color}`}>{val}</p>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        {/* Summary row */}
        {!isLoading && (
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <div className="rounded-md bg-muted/30 border border-border/40 px-3 py-2 flex items-center gap-2">
              <TrendingUp className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
              <div className="min-w-0">
                <p className="text-[10px] text-muted-foreground">Spending Bulan Ini</p>
                <p className="text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400 truncate">
                  {idr(data?.monthSpend ?? 0)}
                </p>
              </div>
            </div>
            <div className="rounded-md bg-muted/30 border border-border/40 px-3 py-2 flex items-center gap-2">
              <PlusCircle className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-[10px] text-muted-foreground">PO Masuk Hari Ini</p>
                <p className="text-sm font-bold tabular-nums">{data?.newToday ?? 0}</p>
              </div>
            </div>
            {hasOverdue && (
              <div className="rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5 text-destructive shrink-0" />
                <div className="min-w-0">
                  <p className="text-[10px] text-destructive/80">Bill Overdue</p>
                  <p className="text-sm font-bold tabular-nums text-destructive truncate">
                    {idr(data?.overdueAmount ?? 0)}
                  </p>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Top suppliers bulan ini */}
        {!isLoading && (data?.topSuppliers ?? []).length > 0 && (
          <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
            <div className="flex items-center gap-1.5 mb-2.5">
              <ShoppingCart className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">Top Supplier Bulan Ini</span>
            </div>
            <div className="space-y-1.5">
              {data!.topSuppliers.map((s, i) => (
                <div key={s.name} className="flex items-center gap-2 text-xs">
                  <span className="w-4 shrink-0 font-bold text-muted-foreground/60 tabular-nums">
                    {i + 1}.
                  </span>
                  <span className="flex-1 truncate text-foreground">{s.name}</span>
                  <span className="tabular-nums font-medium text-orange-600 dark:text-orange-400 shrink-0">
                    {idr(s.total)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && (data?.activePOs ?? 0) === 0 && (data?.activeRfqs ?? 0) === 0 && (
          <p className="text-center text-xs text-muted-foreground py-1">
            Belum ada RFQ atau PO aktif
          </p>
        )}
      </CardContent>
    </Card>
  );
}
