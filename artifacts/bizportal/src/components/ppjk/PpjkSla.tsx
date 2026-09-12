/**
 * PPJK Phase 7 — SLA badge and countdown
 */
import { useQuery } from "@tanstack/react-query";
import { Badge } from "@/components/ui/badge";
import { Clock, AlertTriangle } from "lucide-react";

interface SlaData {
  status: string;
  statusLabel: string;
  slaDeadline: string | null;
  isOverdue: boolean;
  remainingMs: number | null;
  remainingHours: number | null;
}

interface Props {
  orderId: number;
  compact?: boolean;
}

function fmtRemaining(ms: number): string {
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 24) return `${Math.floor(h / 24)} hari ${h % 24} jam`;
  if (h > 0) return `${h} jam ${m} menit`;
  return `${m} menit`;
}

export function PpjkSla({ orderId, compact = false }: Props) {
  const { data, isLoading } = useQuery<SlaData>({
    queryKey: ["ppjk-sla", orderId],
    queryFn: async () => {
      const r = await fetch(`/api/ppjk/orders/${orderId}/sla`, { credentials: "include" });
      if (!r.ok) throw new Error("Gagal");
      return r.json();
    },
    refetchInterval: 60_000, // refresh every minute
  });

  if (isLoading || !data) return null;
  if (!data.slaDeadline) return null;

  const { isOverdue, remainingMs, remainingHours } = data;
  const deadlineDate = new Date(data.slaDeadline);

  if (compact) {
    return (
      <Badge className={`text-xs border flex items-center gap-1 ${isOverdue ? "bg-red-100 text-red-700 border-red-200" : remainingHours !== null && remainingHours < 2 ? "bg-orange-100 text-orange-700 border-orange-200" : "bg-blue-50 text-blue-700 border-blue-200"}`}>
        {isOverdue ? <AlertTriangle className="w-3 h-3" /> : <Clock className="w-3 h-3" />}
        {isOverdue ? "OVERDUE" : remainingMs !== null ? fmtRemaining(remainingMs) : ""}
      </Badge>
    );
  }

  return (
    <div className={`rounded-lg border p-3 flex items-start gap-3 ${isOverdue ? "bg-red-50 border-red-200" : remainingHours !== null && remainingHours < 2 ? "bg-orange-50 border-orange-200" : "bg-blue-50 border-blue-200"}`}>
      {isOverdue ? (
        <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
      ) : (
        <Clock className={`w-5 h-5 shrink-0 mt-0.5 ${remainingHours !== null && remainingHours < 2 ? "text-orange-600" : "text-blue-600"}`} />
      )}
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-semibold ${isOverdue ? "text-red-700" : remainingHours !== null && remainingHours < 2 ? "text-orange-700" : "text-blue-700"}`}>
          {isOverdue ? "⚠️ Melewati SLA" : `SLA: ${remainingMs !== null ? fmtRemaining(remainingMs) : ""} lagi`}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Deadline: {deadlineDate.toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}
        </p>
      </div>
    </div>
  );
}

export function PpjkOverdueBadge({ isOverdue }: { isOverdue: boolean }) {
  if (!isOverdue) return null;
  return (
    <Badge className="bg-red-100 text-red-700 border-red-200 text-xs">
      <AlertTriangle className="w-3 h-3 mr-1" />OVERDUE
    </Badge>
  );
}
