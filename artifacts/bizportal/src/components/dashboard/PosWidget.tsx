import { useQuery } from "@tanstack/react-query";
import { useCompany } from "@/contexts/CompanyContext";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import {
  ShoppingBag, DollarSign, ReceiptText, Tag,
  Users, ArrowRight, ChevronRight, TrendingUp, Store,
} from "lucide-react";

const idr = (n: number) =>
  new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    maximumFractionDigits: 0,
  }).format(n);

function todayRange() {
  const now = new Date();
  const from = new Date(now);
  from.setHours(0, 0, 0, 0);
  const to = new Date(now);
  to.setHours(23, 59, 59, 999);
  return {
    from: from.toISOString(),
    to: to.toISOString(),
  };
}

interface PosSummary {
  jumlah_transaksi: number;
  total_penjualan: number;
  total_diskon: number;
  rata_rata_transaksi: number;
  jumlah_kasir_aktif: number;
  jumlah_cabang_aktif: number;
}

interface TopProduct {
  product_name: string;
  total_qty_terjual: number;
  total_pendapatan: number;
  jumlah_transaksi: number;
}

export function PosWidget() {
  const { activeCompanyId } = useCompany();
  const { from, to } = todayRange();

  const buildQs = () => {
    const qs = new URLSearchParams({ from, to });
    if (activeCompanyId) qs.set("companyId", String(activeCompanyId));
    return qs.toString();
  };

  const { data: summary, isLoading: loadingSummary } = useQuery<PosSummary>({
    queryKey: ["pos-widget-summary", activeCompanyId, from.slice(0, 10)],
    queryFn: async () => {
      const r = await fetch(`/api/reports/pos/summary?${buildQs()}`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error("Gagal memuat POS summary");
      return r.json() as Promise<PosSummary>;
    },
    refetchInterval: 5 * 60_000,
    retry: 1,
  });

  const { data: topProducts = [], isLoading: loadingTop } = useQuery<TopProduct[]>({
    queryKey: ["pos-widget-top-products", activeCompanyId, from.slice(0, 10)],
    queryFn: async () => {
      const qs = new URLSearchParams({ from, to, limit: "3" });
      if (activeCompanyId) qs.set("companyId", String(activeCompanyId));
      const r = await fetch(`/api/reports/pos/top-products?${qs}`, {
        credentials: "include",
      });
      if (!r.ok) throw new Error("Gagal memuat top produk");
      return r.json() as Promise<TopProduct[]>;
    },
    refetchInterval: 5 * 60_000,
    retry: 1,
  });

  const isLoading = loadingSummary || loadingTop;

  const kpis = [
    {
      label: "Revenue Hari Ini",
      value: idr(summary?.total_penjualan ?? 0),
      icon: DollarSign,
      color: "text-emerald-500",
      bg: "bg-emerald-50 dark:bg-emerald-950/30",
      border: "border-emerald-200/60 dark:border-emerald-800/40",
    },
    {
      label: "Transaksi",
      value: String(summary?.jumlah_transaksi ?? 0),
      icon: ReceiptText,
      color: "text-blue-500",
      bg: "bg-blue-50 dark:bg-blue-950/30",
      border: "border-blue-200/60 dark:border-blue-800/40",
    },
    {
      label: "Rata-rata / Tx",
      value: idr(summary?.rata_rata_transaksi ?? 0),
      icon: TrendingUp,
      color: "text-purple-500",
      bg: "bg-purple-50 dark:bg-purple-950/30",
      border: "border-purple-200/60 dark:border-purple-800/40",
    },
    {
      label: "Total Diskon",
      value: idr(summary?.total_diskon ?? 0),
      icon: Tag,
      color: "text-amber-500",
      bg: "bg-amber-50 dark:bg-amber-950/30",
      border: "border-amber-200/60 dark:border-amber-800/40",
    },
    {
      label: "Kasir Aktif",
      value: String(summary?.jumlah_kasir_aktif ?? 0),
      icon: Users,
      color: "text-indigo-500",
      bg: "bg-indigo-50 dark:bg-indigo-950/30",
      border: "border-indigo-200/60 dark:border-indigo-800/40",
    },
    {
      label: "Cabang Aktif",
      value: String(summary?.jumlah_cabang_aktif ?? 0),
      icon: Store,
      color: "text-rose-500",
      bg: "bg-rose-50 dark:bg-rose-950/30",
      border: "border-rose-200/60 dark:border-rose-800/40",
    },
  ];

  return (
    <Card className="lg:col-span-2 border-border/70">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-900/40">
              <ShoppingBag className="h-4 w-4 text-blue-600 dark:text-blue-400" />
            </div>
            <div>
              <CardTitle className="text-base">Point of Sale</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">Ringkasan Kasir Hari Ini</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" asChild>
            <Link href="/kasir">
              Lihat Detail <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* KPI grid */}
        {isLoading ? (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-lg" />
            ))}
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {kpis.map((m) => (
              <Link
                key={m.label}
                href="/kasir"
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
                </div>
              </Link>
            ))}
          </div>
        )}

        {/* Top 3 Produk */}
        {!isLoading && topProducts.length > 0 && (
          <div className="rounded-lg border border-border/50 bg-muted/20 p-3">
            <div className="flex items-center gap-1.5 mb-2.5">
              <TrendingUp className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-xs font-medium text-muted-foreground">Top Produk Hari Ini</span>
            </div>
            <div className="space-y-1.5">
              {topProducts.map((p, i) => (
                <div key={p.product_name} className="flex items-center gap-2 text-xs">
                  <span className="w-4 shrink-0 font-bold text-muted-foreground/60 tabular-nums">{i + 1}.</span>
                  <span className="flex-1 truncate text-foreground">{p.product_name}</span>
                  <span className="tabular-nums text-muted-foreground shrink-0">{p.total_qty_terjual.toLocaleString("id-ID")} unit</span>
                  <span className="tabular-nums font-medium text-emerald-600 dark:text-emerald-400 shrink-0">
                    {idr(p.total_pendapatan)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Empty state */}
        {!isLoading && (summary?.jumlah_transaksi ?? 0) === 0 && (
          <p className="text-center text-xs text-muted-foreground py-1">
            Belum ada transaksi hari ini
          </p>
        )}
      </CardContent>
    </Card>
  );
}
