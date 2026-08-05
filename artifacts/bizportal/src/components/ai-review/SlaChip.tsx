/**
 * SlaChip — compact badge showing SLA status for a review case.
 */

import { Badge } from "@/components/ui/badge";
import { Clock } from "lucide-react";

interface SlaInfo {
  slaStatus?: "ON_TRACK" | "AT_RISK" | "OVERDUE" | "COMPLETED";
  isOverdue?: boolean;
  hoursRemaining?: number;
}

interface SlaChipProps {
  sla?: SlaInfo;
}

const STATUS_COLORS: Record<string, string> = {
  OVERDUE: "bg-red-100 text-red-800 border-red-200",
  AT_RISK: "bg-orange-100 text-orange-800 border-orange-200",
  COMPLETED: "bg-gray-100 text-gray-600 border-gray-200",
  ON_TRACK: "bg-green-100 text-green-800 border-green-200",
};

const STATUS_LABELS: Record<string, string> = {
  OVERDUE: "Terlambat",
  AT_RISK: "Berisiko",
  COMPLETED: "Selesai",
  ON_TRACK: "Tepat Waktu",
};

export function SlaChip({ sla }: SlaChipProps) {
  if (!sla) return null;
  const key = sla.slaStatus ?? "ON_TRACK";
  const label = STATUS_LABELS[key] ?? key;
  const colorClass = STATUS_COLORS[key] ?? STATUS_COLORS.ON_TRACK;

  return (
    <Badge className={`text-[10px] px-1.5 py-0 border ${colorClass}`}>
      <Clock className="h-2.5 w-2.5 mr-1" />
      {label}
      {sla.hoursRemaining != null &&
        sla.slaStatus !== "OVERDUE" &&
        sla.slaStatus !== "COMPLETED" && (
          <span className="ml-1">({Math.round(sla.hoursRemaining)}j)</span>
        )}
    </Badge>
  );
}

/**
 * Inline SLA indicator for use inside table rows (no icon, compact text).
 */
export function SlaIndicator({ sla }: SlaChipProps) {
  if (!sla) return <span className="text-muted-foreground text-xs">—</span>;

  const color =
    sla.slaStatus === "OVERDUE"
      ? "text-red-600"
      : sla.slaStatus === "AT_RISK"
      ? "text-orange-600"
      : "text-green-600";

  const label =
    sla.slaStatus === "OVERDUE"
      ? "Terlambat"
      : sla.slaStatus === "AT_RISK"
      ? "Berisiko"
      : sla.slaStatus === "COMPLETED"
      ? "Selesai"
      : "Tepat Waktu";

  return (
    <span className={`text-xs font-medium ${color}`}>
      {label}
      {sla.hoursRemaining != null &&
        sla.slaStatus !== "OVERDUE" &&
        sla.slaStatus !== "COMPLETED" && (
          <span className="ml-1 text-muted-foreground font-normal">
            ({Math.round(sla.hoursRemaining)}j)
          </span>
        )}
    </span>
  );
}
