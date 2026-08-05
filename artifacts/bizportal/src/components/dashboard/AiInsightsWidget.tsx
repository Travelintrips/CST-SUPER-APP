import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Brain, AlertCircle, AlertTriangle, Info, ArrowRight, ShieldAlert } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { id as localeId } from "date-fns/locale";

interface AlertSummary {
  total: number;
  open: { critical: number; warning: number; info: number };
  acknowledged: { critical: number; warning: number; info: number };
}

interface IntelligenceAlert {
  id: number;
  title: string;
  message: string;
  severity: "critical" | "warning" | "info";
  status: string;
  createdAt: string;
}

const SEV_CONFIG = {
  critical: { label: "Critical", color: "bg-red-100 text-red-800 border-red-200", icon: ShieldAlert, iconClass: "text-red-500" },
  warning: { label: "Warning", color: "bg-amber-100 text-amber-800 border-amber-200", icon: AlertTriangle, iconClass: "text-amber-500" },
  info: { label: "Info", color: "bg-blue-100 text-blue-800 border-blue-200", icon: Info, iconClass: "text-blue-500" },
} as const;

export function AiInsightsWidget() {
  const { data: summary, isLoading: summaryLoading, error: summaryError } = useQuery<AlertSummary>({
    queryKey: ["dashboard-ai-alerts-summary"],
    queryFn: async () => {
      const res = await fetch("/api/intelligence-alerts/summary", { credentials: "include" });
      if (!res.ok) throw new Error("Gagal memuat AI insights");
      return res.json() as Promise<AlertSummary>;
    },
  });

  const { data: alertsData, isLoading: alertsLoading, error: alertsError } = useQuery<{ alerts: IntelligenceAlert[]; total: number }>({
    queryKey: ["dashboard-ai-alerts-list"],
    queryFn: async () => {
      const res = await fetch("/api/intelligence-alerts?status=open&limit=3", { credentials: "include" });
      if (!res.ok) throw new Error("Gagal memuat alerts");
      return res.json() as Promise<{ alerts: IntelligenceAlert[]; total: number }>;
    },
  });

  const isLoading = summaryLoading || alertsLoading;
  const alerts = alertsData?.alerts ?? [];
  const openCritical = summary?.open.critical ?? 0;

  return (
    <Card className={openCritical > 0 ? "border-red-200/60" : ""}>
      <CardHeader className="pb-3 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-purple-500" />
            <CardTitle className="text-sm font-medium">AI Insights</CardTitle>
            {openCritical > 0 && (
              <Badge className="bg-red-100 text-red-800 border border-red-200 text-[10px] px-1.5 py-0">
                {openCritical} critical
              </Badge>
            )}
          </div>
          <Button variant="ghost" size="sm" asChild className="h-7 text-xs">
            <Link href="/settings/ai-chatbot">
              Lihat Semua <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Summary counters */}
        <div className="grid grid-cols-3 gap-2">
          {(["critical", "warning", "info"] as const).map((sev) => {
            const cfg = SEV_CONFIG[sev];
            const Icon = cfg.icon;
            const count = summary?.open[sev] ?? 0;
            return (
              <div key={sev} className={`rounded-lg border px-3 py-2 ${count > 0 && sev === "critical" ? "border-red-200 bg-red-50" : count > 0 && sev === "warning" ? "border-amber-200 bg-amber-50" : "border-border bg-muted/30"}`}>
                <div className="flex items-center gap-1 mb-0.5">
                  <Icon className={`h-3 w-3 ${cfg.iconClass}`} />
                  <p className="text-[10px] text-muted-foreground font-medium">{cfg.label}</p>
                </div>
                {isLoading
                  ? <Skeleton className="h-5 w-8 bg-muted" />
                  : <p className={`text-lg font-bold ${count > 0 ? cfg.iconClass : "text-muted-foreground"}`}>{count}</p>
                }
              </div>
            );
          })}
        </div>

        {/* Alert list */}
        {summaryError ? (
          <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            Gagal memuat ringkasan AI insights
          </div>
        ) : alertsError ? (
          <div className="flex items-center gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            Gagal memuat daftar alert
          </div>
        ) : alertsLoading ? (
          <div className="space-y-2">
            {[1, 2].map((i) => <Skeleton key={i} className="h-12 w-full bg-muted" />)}
          </div>
        ) : alerts.length === 0 ? (
          <p className="py-3 text-center text-xs text-muted-foreground">Tidak ada alert aktif</p>
        ) : (
          <div className="space-y-1.5">
            {alerts.map((alert) => {
              const cfg = SEV_CONFIG[alert.severity] ?? SEV_CONFIG.info;
              const Icon = cfg.icon;
              return (
                <div key={alert.id} className="flex items-start gap-2.5 rounded-md border border-border px-3 py-2 bg-background">
                  <Icon className={`h-3.5 w-3.5 mt-0.5 shrink-0 ${cfg.iconClass}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium truncate">{alert.title}</p>
                    <p className="text-[10px] text-muted-foreground truncate mt-0.5">{alert.message}</p>
                  </div>
                  <span className="shrink-0 text-[10px] text-muted-foreground whitespace-nowrap">
                    {formatDistanceToNow(new Date(alert.createdAt), { addSuffix: true, locale: localeId })}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
