import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { Activity, AlertCircle, ArrowRight, User } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { id as localeId } from "date-fns/locale";

interface AuditLogEntry {
  id: number;
  user_email: string | null;
  action: string;
  module: string;
  reference_id: string | null;
  created_at: string;
  branch_name?: string | null;
}

const MODULE_COLORS: Record<string, string> = {
  sales: "bg-emerald-100 text-emerald-700",
  purchase: "bg-blue-100 text-blue-700",
  logistics: "bg-indigo-100 text-indigo-700",
  accounting: "bg-purple-100 text-purple-700",
  pos: "bg-amber-100 text-amber-700",
  ecommerce: "bg-pink-100 text-pink-700",
};

function moduleColor(mod: string): string {
  const key = mod.toLowerCase();
  for (const [k, v] of Object.entries(MODULE_COLORS)) {
    if (key.includes(k)) return v;
  }
  return "bg-slate-100 text-slate-600";
}

function formatAction(action: string): string {
  return action
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function RecentActivitiesWidget() {
  const { data, isLoading, error } = useQuery<{ rows: AuditLogEntry[]; total: number }>({
    queryKey: ["dashboard-audit-log"],
    queryFn: async () => {
      const res = await fetch("/api/audit-logs?limit=10", { credentials: "include" });
      if (!res.ok) throw new Error("Gagal memuat aktivitas");
      return res.json() as Promise<{ rows: AuditLogEntry[]; total: number }>;
    },
  });

  const entries = data?.rows ?? [];

  return (
    <Card>
      <CardHeader className="pb-3 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-slate-500" />
            <CardTitle className="text-sm font-medium">Aktivitas Terbaru</CardTitle>
          </div>
          <Button variant="ghost" size="sm" asChild className="h-7 text-xs">
            <Link href="/reports/audit-log">
              Semua Log <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {error ? (
          <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            Gagal memuat aktivitas
          </div>
        ) : isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3, 4, 5].map((i) => <Skeleton key={i} className="h-10 w-full bg-muted" />)}
          </div>
        ) : entries.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">Belum ada aktivitas tercatat</p>
        ) : (
          <div className="space-y-0 divide-y divide-border/50">
            {entries.map((entry) => (
              <div key={entry.id} className="flex items-start gap-2.5 py-2 first:pt-0 last:pb-0">
                <div className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted">
                  <User className="h-3 w-3 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-xs font-medium truncate">
                      {entry.user_email?.split("@")[0] ?? "System"}
                    </span>
                    <span className={`rounded px-1.5 py-0 text-[10px] font-medium ${moduleColor(entry.module)}`}>
                      {entry.module}
                    </span>
                  </div>
                  <p className="text-[11px] text-muted-foreground mt-0.5 truncate">
                    {formatAction(entry.action)}
                    {entry.reference_id ? <span className="font-mono ml-1">#{entry.reference_id}</span> : null}
                  </p>
                </div>
                <span className="shrink-0 text-[10px] text-muted-foreground whitespace-nowrap">
                  {formatDistanceToNow(new Date(entry.created_at), { addSuffix: true, locale: localeId })}
                </span>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
