import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { TrendingUp, ArrowRight } from "lucide-react";

interface OrderPipelineWidgetProps {
  isLoading: boolean;
  portalNew: number;
  portalInProgress: number;
  portalCompleted: number;
  portalCancelled: number;
  portalTotal: number;
  quotesActive: number;
  salesOrdersConfirmed: number;
  salesOrdersThisMonth: number;
}

interface PipelineStage {
  label: string;
  value: number;
  color: string;
  bg: string;
  href: string;
}

export function OrderPipelineWidget({
  isLoading,
  portalNew,
  portalInProgress,
  portalCompleted,
  portalCancelled,
  portalTotal,
  quotesActive,
  salesOrdersConfirmed,
  salesOrdersThisMonth,
}: OrderPipelineWidgetProps) {
  const logisticStages: PipelineStage[] = [
    { label: "Baru", value: portalNew, color: "bg-yellow-500", bg: "bg-yellow-50 text-yellow-700", href: "/logistics/portal-orders" },
    { label: "Proses", value: portalInProgress, color: "bg-orange-500", bg: "bg-orange-50 text-orange-700", href: "/logistics/portal-orders" },
    { label: "Selesai", value: portalCompleted, color: "bg-emerald-500", bg: "bg-emerald-50 text-emerald-700", href: "/logistics/portal-orders" },
    { label: "Batal", value: portalCancelled, color: "bg-red-400", bg: "bg-red-50 text-red-600", href: "/logistics/portal-orders" },
  ];

  const salesStages: PipelineStage[] = [
    { label: "Penawaran Aktif", value: quotesActive, color: "bg-blue-400", bg: "bg-blue-50 text-blue-700", href: "/sales/quotations" },
    { label: "Order Bulan Ini", value: salesOrdersThisMonth, color: "bg-indigo-500", bg: "bg-indigo-50 text-indigo-700", href: "/sales/orders" },
    { label: "Terkonfirmasi", value: salesOrdersConfirmed, color: "bg-emerald-500", bg: "bg-emerald-50 text-emerald-700", href: "/sales/orders" },
  ];

  return (
    <Card>
      <CardHeader className="pb-3 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-indigo-500" />
            <CardTitle className="text-sm font-medium">Order Pipeline</CardTitle>
          </div>
          <Button variant="ghost" size="sm" asChild className="h-7 text-xs">
            <Link href="/logistics/portal-orders">
              Portal Orders <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Logistic pipeline */}
        <div>
          <p className="text-[10px] text-muted-foreground font-medium mb-2 uppercase tracking-wide">Logistik Portal</p>
          <div className="grid grid-cols-4 gap-1.5">
            {logisticStages.map((stage) => {
              const pct = portalTotal > 0 ? Math.round((stage.value / portalTotal) * 100) : 0;
              return (
                <Link key={stage.label} href={stage.href} className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg">
                  <div className={`rounded-lg border border-border px-2 py-2 hover:shadow-sm transition-shadow ${stage.bg.split(" ")[0]} hover:brightness-95`}>
                    <p className={`text-xs font-medium truncate ${stage.bg.split(" ").slice(1).join(" ")}`}>{stage.label}</p>
                    {isLoading
                      ? <Skeleton className="h-6 w-full bg-muted mt-1" />
                      : <p className="text-xl font-bold mt-0.5">{stage.value}</p>
                    }
                    <div className="mt-1.5 h-1 w-full bg-black/10 rounded-full overflow-hidden">
                      <div
                        className={`h-full ${stage.color} rounded-full transition-all duration-500`}
                        style={{ width: isLoading ? "0%" : `${pct}%` }}
                      />
                    </div>
                    <p className="text-[9px] text-current/60 mt-0.5 opacity-70">{pct}%</p>
                  </div>
                </Link>
              );
            })}
          </div>
        </div>

        {/* Sales funnel */}
        <div>
          <p className="text-[10px] text-muted-foreground font-medium mb-2 uppercase tracking-wide">Sales Funnel</p>
          <div className="grid grid-cols-3 gap-1.5">
            {salesStages.map((stage) => (
              <Link key={stage.label} href={stage.href} className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg">
                <div className={`rounded-lg border border-border px-2 py-2 hover:shadow-sm transition-shadow ${stage.bg.split(" ")[0]} hover:brightness-95`}>
                  <p className={`text-[10px] font-medium truncate ${stage.bg.split(" ").slice(1).join(" ")}`}>{stage.label}</p>
                  {isLoading
                    ? <Skeleton className="h-6 w-full bg-muted mt-1" />
                    : <p className="text-xl font-bold mt-0.5">{stage.value}</p>
                  }
                </div>
              </Link>
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
