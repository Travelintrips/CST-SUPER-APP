import { useQuery } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Link } from "wouter";
import {
  ShoppingCart, ArrowRight, ChevronRight, FileText,
  AlertTriangle, PlusCircle, TrendingUp, Users, DollarSign,
} from "lucide-react";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n);

interface SalesWidgetKPI {
  activeSoCount: number;
  outstandingInvoicesCount: number;
  outstandingAmount: number;
  revenuePipelineThisMonth: number;
  revenuePipelineSoCount: number;
  top3Customers: { name: string; revenue: number; orderCount: number }[];
}

const TILES = [
  {
    key: "activeSoCount" as const,
    label: "SO Aktif",
    icon: ShoppingCart,
    color: "text-blue-600 dark:text-blue-400",
    bg: "bg-blue-50 dark:bg-blue-950/30",
    border: "border-blue-200/60 dark:border-blue-800/40",
    href: "/sales/documents?kind=order",
  },
  {
    key: "outstandingInvoicesCount" as const,
    label: "Invoice Outstanding",
    icon: FileText,
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-50 dark:bg-amber-950/30",
    border: "border-amber-200/60 dark:border-amber-800/40",
    href: "/sales/invoices?paymentStatus=unpaid",
  },
  {
    key: "revenuePipelineSoCount" as const,
    label: "SO Pipeline",
    icon: TrendingUp,
    color: "text-emerald-600 dark:text-emerald-400",
    bg: "bg-emerald-50 dark:bg-emerald-950/30",
    border: "border-emerald-200/60 dark:border-emerald-800/40",
    href: "/sales/documents?kind=order&status=confirmed",
  },
];

export function SalesWidget() {
  const { activeCompanyId } = useCompany();

  const { data, isLoading } = useQuery<SalesWidgetKPI>({
    queryKey: ["sales-dashboard-widget", activeCompanyId],
    queryFn: async () => {
      const qs = new URLSearchParams();
      if (activeCompanyId) qs.set("companyId", String(activeCompanyId));
      const r = await fetch(`/api/sales/dashboard-widget?${qs}`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error("Gagal memuat data sales");
      return r.json() as Promise<SalesWidgetKPI>;
    },
    refetchInterval: 10 * 60_000,
    retry: 1,
  });

  const hasOutstanding = (data?.outstandingInvoicesCount ?? 0) > 0;

  return (
    <Card className="lg:col-span-2 border-border/70">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-900/40">
              <ShoppingCart className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <CardTitle className="text-base">Penjualan</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">SO, Invoice & Pipeline Bulan Ini</p>
            </div>
            {hasOutstanding && (
              <Badge variant="destructive" className="ml-1 text-[10px] py-0 h-4 gap-0.5">
                <AlertTriangle className="h-2.5 w-2.5" />
                {data!.outstandingInvoicesCount} Belum Lunas
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="sm" asChild>
              <Link href="/sales/documents/new?kind=order">
                <PlusCircle className="h-3.5 w-3.5 mr-1" />
                SO
              </Link>
            </Button>
            <Button variant="ghost" size="sm" asChild>
              <Link href="/sales/documents">
                Semua <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </Link>
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Status tiles */}
        {isLoading ? (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
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
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Link
              href="/sales/documents?kind=order&status=confirmed"
              className="block group rounded-md bg-muted/30 border border-border/40 px-3 py-2 hover:bg-accent/40 transition-colors"
            >
              <div className="flex items-center gap-2">
                <TrendingUp className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-[10px] text-muted-foreground">Revenue Pipeline Bulan Ini</p>
                  <p className="text-sm font-bold tabular-nums text-emerald-600 dark:text-emerald-400 truncate">
                    {idr(data?.revenuePipelineThisMonth ?? 0)}
                  </p>
                </div>
                <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/40 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              </div>
            </Link>
            {hasOutstanding && (
              <Link
                href="/sales/invoices?paymentStatus=unpaid"
                className="block group rounded-md bg-destructive/10 border border-destructive/30 px-3 py-2 hover:bg-destructive/15 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <DollarSign className="h-3.5 w-3.5 text-destructive shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] text-destructive/80">Total Tagihan Belum Lunas</p>
                    <p className="text-sm font-bold tabular-nums text-destructive truncate">
                      {idr(data?.outstandingAmount ?? 0)}
                    </p>
                  </div>
                  <ChevronRight className="h-3.5 w-3.5 text-destructive/40 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                </div>
              </Link>
            )}
          </div>
        )}

        {/* Top 3 pelanggan bulan ini */}
        {!isLoading && (data?.top3Customers ?? []).length > 0 && (
          <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
            <div className="flex items-center justify-between mb-2.5">
              <div className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">Top Pelanggan Bulan Ini</span>
              </div>
              <Link href="/sales/customers" className="text-[10px] text-muted-foreground hover:text-foreground transition-colors flex items-center gap-0.5">
                Semua <ChevronRight className="h-3 w-3" />
              </Link>
            </div>
            <div className="space-y-1.5">
              {data!.top3Customers.map((c, i) => (
                <div key={c.name} className="flex items-center gap-2 text-xs">
                  <span className="w-4 shrink-0 font-bold text-muted-foreground/60 tabular-nums">
                    {i + 1}.
                  </span>
                  <span className="flex-1 truncate text-foreground">{c.name}</span>
                  <span className="text-[10px] text-muted-foreground shrink-0 tabular-nums mr-1">
                    {c.orderCount} SO
                  </span>
                  <span className="tabular-nums font-medium text-blue-600 dark:text-blue-400 shrink-0">
                    {idr(c.revenue)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && (data?.activeSoCount ?? 0) === 0 && (data?.revenuePipelineSoCount ?? 0) === 0 && (
          <p className="text-center text-xs text-muted-foreground py-1">
            Belum ada Sales Order aktif
          </p>
        )}
      </CardContent>
    </Card>
  );
}
