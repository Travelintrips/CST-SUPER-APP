import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Link } from "wouter";
import { ClipboardCheck, AlertCircle, Clock, ArrowRight, CheckCircle2, Circle, Loader2 } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { id as localeId } from "date-fns/locale";

interface InternalTask {
  id: number;
  title: string;
  status: string;
  priority: string;
  department: string;
  deadline: string | null;
  createdAt: string;
}

interface TaskRow {
  task: InternalTask;
  assignee: { id: number; name: string; email: string } | null;
}

interface StatRow {
  department: string;
  total: number;
  open: number;
  in_progress: number;
  completed: number;
  overdue: number;
}

const STATUS_COLORS: Record<string, string> = {
  open: "bg-blue-100 text-blue-800 border-blue-200",
  in_progress: "bg-amber-100 text-amber-800 border-amber-200",
  completed: "bg-emerald-100 text-emerald-800 border-emerald-200",
  cancelled: "bg-gray-100 text-gray-600 border-gray-200",
};

const PRIORITY_COLORS: Record<string, string> = {
  high: "text-red-500",
  medium: "text-amber-500",
  low: "text-slate-400",
};

function StatusIcon({ status }: { status: string }) {
  if (status === "completed") return <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />;
  if (status === "in_progress") return <Loader2 className="h-3.5 w-3.5 text-amber-500 shrink-0" />;
  return <Circle className="h-3.5 w-3.5 text-blue-400 shrink-0" />;
}

export function TasksWidget() {
  const { data: taskRows = [], isLoading, error } = useQuery<TaskRow[]>({
    queryKey: ["dashboard-tasks-list"],
    queryFn: async () => {
      const res = await fetch("/api/internal-tasks?limit=5", { credentials: "include" });
      if (!res.ok) throw new Error("Gagal memuat tasks");
      return res.json() as Promise<TaskRow[]>;
    },
  });

  const { data: stats = [], error: statsError } = useQuery<StatRow[]>({
    queryKey: ["dashboard-tasks-stats"],
    queryFn: async () => {
      const res = await fetch("/api/internal-tasks/stats/summary", { credentials: "include" });
      if (!res.ok) throw new Error("Gagal memuat stats");
      return res.json() as Promise<StatRow[]>;
    },
  });

  const totalOpen = stats.reduce((s, r) => s + r.open, 0);
  const totalInProgress = stats.reduce((s, r) => s + r.in_progress, 0);
  const totalOverdue = stats.reduce((s, r) => s + r.overdue, 0);

  return (
    <Card>
      <CardHeader className="pb-3 pt-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <ClipboardCheck className="h-4 w-4 text-blue-500" />
            <CardTitle className="text-sm font-medium">Internal Tasks</CardTitle>
          </div>
          <Button variant="ghost" size="sm" asChild className="h-7 text-xs">
            <Link href="/logistics/internal-tasks">
              Lihat Semua <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Link>
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Stats row */}
        {statsError ? (
          <div className="flex items-center gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-700">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            Gagal memuat statistik tasks
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {[
              { label: "Open", value: totalOpen, color: "text-blue-700", bg: "bg-blue-50" },
              { label: "In Progress", value: totalInProgress, color: "text-amber-700", bg: "bg-amber-50" },
              { label: "Overdue", value: totalOverdue, color: "text-red-700", bg: "bg-red-50", icon: totalOverdue > 0 },
            ].map((s) => (
              <div key={s.label} className={`rounded-lg border border-border px-3 py-2 ${s.bg}`}>
                <div className="flex items-center gap-1 mb-0.5">
                  {s.icon && <AlertCircle className="h-3 w-3 text-red-500" />}
                  <p className="text-[10px] text-muted-foreground font-medium">{s.label}</p>
                </div>
                {isLoading
                  ? <Skeleton className="h-5 w-8 bg-muted" />
                  : <p className={`text-lg font-bold ${s.color}`}>{s.value}</p>
                }
              </div>
            ))}
          </div>
        )}

        {/* Task list */}
        {error ? (
          <div className="flex items-center gap-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            Gagal memuat tasks
          </div>
        ) : isLoading ? (
          <div className="space-y-2">
            {[1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full bg-muted" />)}
          </div>
        ) : taskRows.length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">Tidak ada task aktif</p>
        ) : (
          <div className="space-y-1.5">
            {taskRows.slice(0, 5).map(({ task, assignee }) => (
              <div key={task.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50 transition-colors">
                <StatusIcon status={task.status} />
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{task.title}</p>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <span className="text-[10px] text-muted-foreground">{task.department}</span>
                    {assignee && (
                      <>
                        <span className="text-muted-foreground/40">·</span>
                        <span className="text-[10px] text-muted-foreground truncate">{assignee.name}</span>
                      </>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {task.deadline && (
                    <span className="flex items-center gap-0.5 text-[10px] text-muted-foreground">
                      <Clock className="h-2.5 w-2.5" />
                      {formatDistanceToNow(new Date(task.deadline), { addSuffix: true, locale: localeId })}
                    </span>
                  )}
                  <Badge className={`text-[10px] px-1.5 py-0 border ${STATUS_COLORS[task.status] ?? "bg-gray-100 text-gray-700 border-gray-200"}`}>
                    {task.status.replace("_", " ")}
                  </Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
